"""
Unified AI Learning Engine for JARVIS.
Combines:
 1. Multi-LLM Perspective Synthesis (Intuition, Under-the-Hood Mechanics, Edge Cases)
 2. Socratic Flight Simulator (Interactive scenarios, error-driven retrieval)
 3. Dynamic Memory Radar & SM-2 Spaced Repetition Scheduler
 4. Signal Filter ("What to Learn vs What to Skip")
 5. RAG Integration (Retrieves context from vault documents & notes)
"""

import os
import re
import json
import sqlite3
import datetime
from typing import Dict, Any, List, Optional
from pydantic import BaseModel

import db_compat as aiosqlite
from rag_engine import tokenize, compute_bm25

DB_PATH = os.getenv("DB_PATH", "agent_memory.db")

async def query_vault_rag(query: str, top_k: int = 3) -> Dict[str, Any]:
    """Queries SQLite knowledge_store, user_facts, and pdf_passages using BM25."""
    tokens = tokenize(query)
    if not tokens:
        return {"results": []}

    documents = []
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            # Knowledge store docs
            try:
                async with db.execute("SELECT title, content, 'Knowledge Store' FROM knowledge_store ORDER BY id DESC LIMIT 40") as cursor:
                    rows = await cursor.fetchall()
                    for r in rows:
                        documents.append({"title": r[0] or "", "content": r[1] or "", "source": r[2]})
            except Exception:
                pass

            # PDF passages
            try:
                async with db.execute("SELECT doc_id, text, 'PDF Vault' FROM pdf_passages ORDER BY id DESC LIMIT 40") as cursor:
                    rows = await cursor.fetchall()
                    for r in rows:
                        documents.append({"title": f"PDF Doc #{r[0]}", "content": r[1] or "", "source": r[2]})
            except Exception:
                pass

            # User facts
            try:
                async with db.execute("SELECT fact, 'User Vault Fact' FROM user_facts ORDER BY id DESC LIMIT 30") as cursor:
                    rows = await cursor.fetchall()
                    for r in rows:
                        documents.append({"title": "Fact", "content": r[0] or "", "source": r[1]})
            except Exception:
                pass
    except Exception:
        return {"results": []}

    if not documents:
        return {"results": []}

    ranked = compute_bm25(tokens, documents)
    results = []
    for doc, score in ranked[:top_k]:
        if score > 0:
            results.append({
                "title": doc.get("title", ""),
                "text": doc.get("content", "")[:600],
                "source": doc.get("source", "Vault Document")
            })

    return {"results": results}

DEFAULT_TOPICS = [
    "SQL Window Functions & Execution Tuning",
    "RAG Architecture & Context Window Management",
    "Python Asyncio & Event Loop Performance",
    "Agentic Reasoning & Tool-Calling Loops",
    "Dimensional Data Modeling & Schema Design",
]

# --- Database Initialization ---
async def init_learning_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS learning_mastery (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT UNIQUE NOT NULL,
                category TEXT DEFAULT 'General',
                mastery_score REAL DEFAULT 0.0,
                interval_days INTEGER DEFAULT 1,
                repetition_count INTEGER DEFAULT 0,
                ease_factor REAL DEFAULT 2.5,
                next_review_date TEXT,
                last_reviewed_at TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await db.execute("""
            CREATE TABLE IF NOT EXISTS daily_drills (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT NOT NULL,
                title TEXT NOT NULL,
                scenario TEXT NOT NULL,
                broken_snippet TEXT,
                hint TEXT,
                rag_context TEXT,
                solution_criteria TEXT,
                status TEXT DEFAULT 'pending',
                user_response TEXT,
                ai_feedback TEXT,
                score INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        """)

        await db.commit()

# --- Helper: LLM Provider Invocation ---
def call_llm(prompt: str, system_prompt: str = "You are JARVIS, an elite AI tutor.") -> str:
    """Calls primary OpenRouter / Groq / Gemini API."""
    import requests
    
    openrouter_key = os.getenv("OPENROUTER_API_KEY")
    gemini_key = os.getenv("GEMINI_API_KEY")
    groq_key = os.getenv("GROQ_API_KEY")

    if openrouter_key:
        try:
            res = requests.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {openrouter_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "meta-llama/llama-3.3-70b-instruct",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.4
                },
                timeout=25
            )
            if res.status_code == 200:
                data = res.json()
                return data["choices"][0]["message"]["content"].strip()
        except Exception:
            pass

    if groq_key:
        try:
            res = requests.post(
                "https://api.groq.com/openai/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {groq_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "llama-3.3-70b-versatile",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.4
                },
                timeout=20
            )
            if res.status_code == 200:
                data = res.json()
                return data["choices"][0]["message"]["content"].strip()
        except Exception:
            pass

    return "JARVIS Learning Engine offline. Check API key configuration."

# --- Pattern A, D & RAG: Topic Exploration & Multi-LLM Synthesis ---
async def explore_topic_synthesis(topic: str, enable_rag: bool = True) -> Dict[str, Any]:
    """Generates a 3-tier synthesis + Signal Filter ('What to Learn vs Skip') + RAG context."""
    await init_learning_db()

    rag_text = ""
    sources = []
    if enable_rag:
        try:
            rag_res = await query_vault_rag(topic, top_k=3)
            if isinstance(rag_res, dict) and rag_res.get("results"):
                rag_text = "\n\n".join([r.get("text", "") for r in rag_res["results"]])
                sources = [r.get("source", "Vault Document") for r in rag_res["results"]]
            elif isinstance(rag_res, str) and rag_res.strip():
                rag_text = rag_res
                sources = ["Vault Memory RAG"]
        except Exception:
            pass

    sys_prompt = """You are JARVIS, an elite AI technical educator.
You break down complex technical topics into high-signal learning modules with zero fluff.
Produce output strictly as valid JSON matching this structure:
{
  "topic": "topic name",
  "intuitive_summary": "1-2 paragraph intuitive analogy or mental model (Claude style)",
  "mechanics_under_the_hood": "Deep architectural step-by-step breakdown of how it works under the hood (Gemini/System style)",
  "production_realities": ["Real-world edge case 1", "Pitfall/Gotcha 2", "Production optimization tip 3"],
  "signal_filter": {
    "must_learn": ["Core high-ROI concept 1", "High-ROI pattern 2"],
    "must_skip": ["Outdated theoretical fluff 1", "Low-ROI syntax memorization 2"]
  },
  "suggested_exercises": ["Hands-on problem statement 1", "Practical scenario 2"]
}
Only output pure JSON. No markdown codeblock fences."""

    user_prompt = f"Deconstruct this topic for an ambitious Data Analytics & AI Engineer:\nTopic: {topic}\n"
    if rag_text:
        user_prompt += f"\nRelevant Internal Vault RAG Context:\n{rag_text[:1500]}\n"

    raw = call_llm(user_prompt, sys_prompt)
    raw_clean = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
    raw_clean = re.sub(r"^```\s*", "", raw_clean, flags=re.MULTILINE).strip()

    try:
        parsed = json.loads(raw_clean)
        parsed["rag_sources"] = sources
        return parsed
    except Exception:
        return {
            "topic": topic,
            "intuitive_summary": raw,
            "mechanics_under_the_hood": "Detailed technical breakdown generated above.",
            "production_realities": ["Test queries against real data volumes.", "Profile memory footprint before deploying."],
            "signal_filter": {
                "must_learn": ["Core Execution Mechanics", "Edge Case Debugging"],
                "must_skip": ["Academic Syntax Memorization", "Legacy Framework Trivia"]
            },
            "suggested_exercises": ["Build a working mini-script or optimized query."],
            "rag_sources": sources
        }

# --- Pattern B & RAG: Socratic Flight Simulator (Drill Generation & Grading) ---
async def generate_daily_drill(topic_override: Optional[str] = None) -> Dict[str, Any]:
    """Generates today's active 10-minute Socratic Flight Drill."""
    await init_learning_db()

    async with aiosqlite.connect(DB_PATH) as db:
        # Check if a pending drill exists for today
        async with db.execute("SELECT id, topic, title, scenario, broken_snippet, hint, rag_context FROM daily_drills WHERE status = 'pending' ORDER BY id DESC LIMIT 1") as cursor:
            row = await cursor.fetchone()
            if row:
                return {
                    "id": row[0],
                    "topic": row[1],
                    "title": row[2],
                    "scenario": row[3],
                    "broken_snippet": row[4],
                    "hint": row[5],
                    "rag_context": row[6]
                }

        # Pick topic
        topic = topic_override or DEFAULT_TOPICS[int(datetime.datetime.now().timestamp()) % len(DEFAULT_TOPICS)]

        # Fetch RAG context
        rag_text = ""
        try:
            rag_res = await query_vault_rag(topic, top_k=2)
            if isinstance(rag_res, dict) and rag_res.get("results"):
                rag_text = "\n".join([r.get("text", "") for r in rag_res["results"]])
            elif isinstance(rag_res, str):
                rag_text = rag_res
        except Exception:
            pass

        sys_prompt = """You are JARVIS Flight Instructor. Generate an interactive 10-minute Socratic flight drill for a developer/analyst.
Format output as pure JSON matching:
{
  "title": "Short punchy title",
  "scenario": "Real-world production problem description (e.g. broken query, performance bottleneck, or failing AI agent)",
  "broken_snippet": "Intentionally flawed SQL/Python snippet or design spec (or empty if purely conceptual)",
  "hint": "A guiding hint without giving away the exact solution",
  "solution_criteria": "Key points that a correct answer must address"
}
Output ONLY valid JSON."""

        user_prompt = f"Create a Socratic drill for topic: {topic}\n"
        if rag_text:
            user_prompt += f"Vault RAG Context: {rag_text[:1000]}\n"

        raw = call_llm(user_prompt, sys_prompt)
        raw_clean = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
        raw_clean = re.sub(r"^```\s*", "", raw_clean, flags=re.MULTILINE).strip()

        try:
            data = json.loads(raw_clean)
        except Exception:
            data = {
                "title": f"Production Drill: {topic}",
                "scenario": f"Analyze and optimize a critical bottleneck in {topic}.",
                "broken_snippet": "-- Example flawed query\nSELECT id, name FROM users WHERE status = 'active';",
                "hint": "Look closely at indexing and execution order.",
                "solution_criteria": "Correct root cause identified and valid code fix provided."
            }

        async with db.execute("""
            INSERT INTO daily_drills (topic, title, scenario, broken_snippet, hint, rag_context, solution_criteria)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (topic, data["title"], data["scenario"], data.get("broken_snippet", ""), data.get("hint", ""), rag_text, data.get("solution_criteria", ""))) as cur:
            drill_id = cur.lastrowid

        await db.commit()

        data["id"] = drill_id
        data["topic"] = topic
        data["rag_context"] = rag_text
        return data

async def evaluate_user_drill(drill_id: int, user_response: str) -> Dict[str, Any]:
    """Evaluates a Socratic drill submission and updates the SM-2 Mastery Radar."""
    await init_learning_db()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT topic, title, scenario, solution_criteria FROM daily_drills WHERE id = ?", (drill_id,)) as cursor:
            row = await cursor.fetchone()
            if not row:
                return {"error": "Drill not found"}

        topic, title, scenario, solution_criteria = row

        sys_prompt = """You are JARVIS, evaluating a developer's solution to a Socratic technical drill.
Provide diagnostic, encouraging, concise feedback. Output ONLY JSON matching:
{
  "score": integer between 0 and 100,
  "verdict": "Mastered" | "Proficient" | "Needs Practice",
  "strengths": ["What the user did right"],
  "gaps": ["Key points missed or improvements"],
  "corrected_code": "Optimized/Correct solution snippet if applicable",
  "explanation": "2-3 sentence clear diagnostic summary"
}
Output ONLY valid JSON."""

        user_prompt = f"Drill Title: {title}\nTopic: {topic}\nScenario: {scenario}\nSolution Criteria: {solution_criteria}\n\nUser Response:\n{user_response}"

        raw = call_llm(user_prompt, sys_prompt)
        raw_clean = re.sub(r"^```json\s*", "", raw, flags=re.MULTILINE)
        raw_clean = re.sub(r"^```\s*", "", raw_clean, flags=re.MULTILINE).strip()

        try:
            eval_data = json.loads(raw_clean)
        except Exception:
            eval_data = {
                "score": 75,
                "verdict": "Proficient",
                "strengths": ["Solid approach to addressing the problem."],
                "gaps": ["Consider edge case handling for high concurrency."],
                "corrected_code": "",
                "explanation": "Good technical attempt. Review memory footprint for scale."
            }

        score = eval_data.get("score", 70)
        ai_feedback_str = json.dumps(eval_data)

        await db.execute("""
            UPDATE daily_drills 
            SET status = 'completed', user_response = ?, ai_feedback = ?, score = ?
            WHERE id = ?
        """, (user_response, ai_feedback_str, score, drill_id))

        # Update SM-2 Mastery Radar
        await update_mastery_sm2(db, topic, score)
        await db.commit()

        eval_data["id"] = drill_id
        eval_data["topic"] = topic
        return eval_data

# --- Pattern C: SM-2 Spaced Repetition Mastery Scheduler ---
async def update_mastery_sm2(db, topic: str, score_100: float):
    """Updates SuperMemo SM-2 interval and mastery factor based on user score (0-100)."""
    quality = max(0, min(5, int(score_100 / 20.0)))
    
    async with db.execute("SELECT mastery_score, interval_days, repetition_count, ease_factor FROM learning_mastery WHERE topic = ?", (topic,)) as cursor:
        row = await cursor.fetchone()

    now_str = datetime.date.today().isoformat()

    if not row:
        mastery_score = score_100
        repetition_count = 1 if quality >= 3 else 0
        ease_factor = 2.5
        interval_days = 1 if quality >= 3 else 1
    else:
        mastery_score = (row[0] * 0.4) + (score_100 * 0.6)
        repetition_count = row[2]
        ease_factor = row[3]
        interval_days = row[1]

        if quality >= 3:
            if repetition_count == 0:
                interval_days = 1
            elif repetition_count == 1:
                interval_days = 6
            else:
                interval_days = int(interval_days * ease_factor)
            repetition_count += 1
        else:
            repetition_count = 0
            interval_days = 1

        ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
        if ease_factor < 1.3:
            ease_factor = 1.3

    next_review = (datetime.date.today() + datetime.timedelta(days=interval_days)).isoformat()

    await db.execute("""
        INSERT INTO learning_mastery (topic, mastery_score, interval_days, repetition_count, ease_factor, next_review_date, last_reviewed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(topic) DO UPDATE SET
            mastery_score = excluded.mastery_score,
            interval_days = excluded.interval_days,
            repetition_count = excluded.repetition_count,
            ease_factor = excluded.ease_factor,
            next_review_date = excluded.next_review_date,
            last_reviewed_at = excluded.last_reviewed_at
    """, (topic, round(mastery_score, 1), interval_days, repetition_count, round(ease_factor, 2), next_review, now_str))

async def get_mastery_radar() -> Dict[str, Any]:
    """Retrieves current mastery scores, scheduled items, and shaky topics."""
    await init_learning_db()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("""
            SELECT topic, category, mastery_score, interval_days, next_review_date, last_reviewed_at
            FROM learning_mastery
            ORDER BY mastery_score ASC
        """) as cursor:
            rows = await cursor.fetchall()

    topics_list = []
    for r in rows:
        topics_list.append({
            "topic": r[0],
            "category": r[1],
            "mastery_score": r[2],
            "interval_days": r[3],
            "next_review_date": r[4],
            "last_reviewed_at": r[5]
        })

    # Add defaults if database is fresh
    if not topics_list:
        today_str = datetime.date.today().isoformat()
        for t in DEFAULT_TOPICS:
            topics_list.append({
                "topic": t,
                "category": "Core",
                "mastery_score": 45.0,
                "interval_days": 1,
                "next_review_date": today_str,
                "last_reviewed_at": None
            })

    shaky = [t for t in topics_list if t["mastery_score"] < 70]
    mastered = [t for t in topics_list if t["mastery_score"] >= 70]

    return {
        "topics": topics_list,
        "shaky_count": len(shaky),
        "mastered_count": len(mastered),
        "overall_mastery": round(sum([t["mastery_score"] for t in topics_list]) / max(1, len(topics_list)), 1)
    }
