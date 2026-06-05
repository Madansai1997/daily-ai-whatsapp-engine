import os
import sqlite3
import aiosqlite
import asyncio
import json
import requests
import subprocess
import re
import base64
import datetime as dt
from datetime import date
from bs4 import BeautifulSoup
from fastapi import FastAPI, Response, Form
from twilio.rest import Client
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from anthropic import AsyncAnthropic
from rag_engine import retrieve_relevant_context

# Core Credentials
TWILIO_SID = os.getenv("TWILIO_SID")
TWILIO_TOKEN = os.getenv("TWILIO_TOKEN")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
CLAUDE_MODEL = "claude-sonnet-4-6"
FROM_WHATSAPP = "whatsapp:+14155238886"
TO_WHATSAPP = "whatsapp:+919963214141"

# GitHub REST API Credentials
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_REPO = os.getenv("GITHUB_REPO")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))
STAGED_CODE_FILE = "/tmp/staged_code_update.json"
QUIZ_STATE_FILE = "/tmp/quiz_state.json"

# Scheduler times (24-hour, Asia/Kolkata). Edit here to change all reminders.
SCHEDULE_CONFIG = {
    "digest_hour": 9,
    "reminders": [
        {"hour": 11, "number": 1},
        {"hour": 13, "number": 2},
        {"hour": 15, "number": 3},
        {"hour": 17, "number": 4},
        {"hour": 19, "number": 5},
    ],
    "weekly_report_hour": 9,
}


def get_anthropic_client():
    key = os.getenv("CLAUDE_API_KEY")
    if not key:
        print("⚠️ WARNING: CLAUDE_API_KEY not set!")
        return AsyncAnthropic(api_key="dummy_key_for_compilation_safety", max_retries=0)
    return AsyncAnthropic(api_key=key, max_retries=5)

anthropic_client = get_anthropic_client()


def init_db_tables():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_profile (key TEXT PRIMARY KEY, value TEXT)''')
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('skill_level', 'Foundational')")
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('study_streak', '0')")
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('last_study_date', '')")
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('difficulty_preference', 'just_right')")

    cursor.execute('''CREATE TABLE IF NOT EXISTS sent_history (
        concept TEXT PRIMARY KEY, summary TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS knowledge_store (
        url TEXT PRIMARY KEY, title TEXT, content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS quiz_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, concept TEXT, skill_level TEXT,
        total_questions INTEGER DEFAULT 10,
        score INTEGER DEFAULT 0, completed INTEGER DEFAULT 0,
        current_question INTEGER DEFAULT 0,
        assertion_quality_score REAL DEFAULT 0,
        mutation_passed INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS quiz_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER, question_number INTEGER,
        question_text TEXT, correct_answer TEXT,
        user_answer TEXT, difficulty TEXT,
        is_correct INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    # Weekly project table — project name + 7 subtasks all tied to week's concept
    cursor.execute('''CREATE TABLE IF NOT EXISTS weekly_project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start TEXT,
        project_title TEXT,
        concept TEXT,
        day_number INTEGER,
        subtask_title TEXT,
        subtask_description TEXT,
        status TEXT DEFAULT 'pending',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS daily_checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE,
        concept TEXT,
        reminder_count INTEGER DEFAULT 0,
        learning_status TEXT DEFAULT 'in_progress',
        quiz_triggered INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS review_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        concept TEXT,
        difficulty TEXT,
        reason TEXT,
        due_date TEXT,
        completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS performance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, concept TEXT,
        quiz_score INTEGER, max_score INTEGER DEFAULT 10,
        skill_level TEXT, weak_areas TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS assertion_quality_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, concept TEXT,
        assertion_text TEXT,
        quality_score REAL DEFAULT 0,
        mutation_survived INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    conn.commit()
    conn.close()
    print("✅ State Engine: All database tables verified and ready.")

init_db_tables()


# ==========================================
# LIFESPAN & SCHEDULER
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    missing_env = []
    if not TWILIO_SID: missing_env.append("TWILIO_SID")
    if not TWILIO_TOKEN: missing_env.append("TWILIO_TOKEN")
    if not CLAUDE_API_KEY: missing_env.append("CLAUDE_API_KEY")

    if missing_env:
        print(f"⚠️ STARTUP WARNING: Missing: {', '.join(missing_env)}")
    else:
        print("✅ Environment Variables Verified.")

    scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")
    scheduler.add_job(run_morning_digest, "cron", hour=SCHEDULE_CONFIG["digest_hour"], minute=0)
    for r in SCHEDULE_CONFIG["reminders"]:
        scheduler.add_job(send_checkin_reminder, "cron", hour=r["hour"], minute=0, kwargs={"reminder_number": r["number"]})
    scheduler.add_job(send_weekly_report, "cron", day_of_week="sun", hour=SCHEDULE_CONFIG["weekly_report_hour"], minute=0)
    scheduler.start()
    app.state.scheduler = scheduler
    reminder_times = ", ".join([f"{r['hour']}:00" for r in SCHEDULE_CONFIG["reminders"]])
    print(f"⏰ Scheduler: Digest {SCHEDULE_CONFIG['digest_hour']}:00 | Check-ins {reminder_times} | Report Sunday {SCHEDULE_CONFIG['weekly_report_hour']}:00")

    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

@app.get("/")
def health_check():
    return {"status": "healthy", "message": "Engine is awake"}


# ==========================================
# 1. DATABASE STATE UTILITIES
# ==========================================
async def get_db_state():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='skill_level'") as cursor:
            row = await cursor.fetchone()
            skill = row[0] if row else "Foundational"
        async with db.execute("SELECT concept, summary FROM sent_history ORDER BY timestamp DESC LIMIT 7") as cursor:
            rows = await cursor.fetchall()
    history_concepts = [row[0] for row in rows]
    full_history_log = "\n---\n".join([f"Concept: {row[0]}\nPayload:\n{row[1]}" for row in rows])
    return skill, history_concepts, full_history_log

async def update_db_skill(new_level):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE user_profile SET value=? WHERE key='skill_level'", (new_level,))
        await db.commit()

async def log_sent_concept(concept, summary):
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute("INSERT INTO sent_history (concept, summary) VALUES (?, ?)", (concept, summary))
            await db.commit()
        except sqlite3.IntegrityError:
            pass

async def log_chat_message(role, content):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO chat_history (role, content) VALUES (?, ?)", (role, content))
        await db.commit()

async def get_recent_chat_history(limit=5):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT role, content FROM chat_history ORDER BY timestamp DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
    return [{"role": row[0], "content": row[1]} for row in reversed(rows)]

async def save_user_fact(fact: str):
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute("INSERT OR IGNORE INTO user_facts (fact) VALUES (?)", (fact.strip(),))
            await db.commit()
        except sqlite3.IntegrityError:
            pass

async def get_user_facts(limit: int = 15) -> list[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT fact FROM user_facts ORDER BY created_at DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
    return [row[0] for row in rows]

async def save_articles_to_knowledge_store(articles: list[dict]):
    async with aiosqlite.connect(DB_PATH) as db:
        for article in articles:
            try:
                await db.execute(
                    "INSERT OR IGNORE INTO knowledge_store (url, title, content) VALUES (?, ?, ?)",
                    (article['url'], article['title'], article['content'])
                )
            except Exception as e:
                print(f"⚠️ Error saving article: {e}")
        await db.commit()

async def update_study_streak():
    """Increments study streak if not already updated today; resets if a day was skipped."""
    today = date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='last_study_date'") as cursor:
            row = await cursor.fetchone()
        last_date_str = row[0] if row and row[0] else ""
        async with db.execute("SELECT value FROM user_profile WHERE key='study_streak'") as cursor:
            streak_row = await cursor.fetchone()
        streak = int(streak_row[0]) if streak_row and streak_row[0].isdigit() else 0

        if last_date_str == today:
            return streak  # already counted today

        yesterday = (date.today() - dt.timedelta(days=1)).isoformat()
        new_streak = streak + 1 if last_date_str == yesterday else 1
        await db.execute("UPDATE user_profile SET value=? WHERE key='study_streak'", (str(new_streak),))
        await db.execute("UPDATE user_profile SET value=? WHERE key='last_study_date'", (today,))
        await db.commit()
    return new_streak

async def get_study_streak() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='study_streak'") as cursor:
            row = await cursor.fetchone()
    return int(row[0]) if row and row[0].isdigit() else 0

async def add_to_review_queue(concept: str, difficulties: list[str]):
    """Queue weak concept+difficulties for spaced repetition in 2 days."""
    due = (date.today() + dt.timedelta(days=2)).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        for diff in difficulties:
            await db.execute(
                "INSERT INTO review_queue (concept, difficulty, reason, due_date) VALUES (?, ?, ?, ?)",
                (concept, diff, "low quiz score", due)
            )
        await db.commit()

async def get_due_review(today_str: str) -> dict | None:
    """Returns the oldest incomplete review item due today or earlier."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, concept, difficulty FROM review_queue WHERE completed=0 AND due_date<=? ORDER BY due_date ASC LIMIT 1",
            (today_str,)
        ) as cursor:
            row = await cursor.fetchone()
    if row:
        return {"id": row[0], "concept": row[1], "difficulty": row[2]}
    return None

async def mark_review_done(review_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE review_queue SET completed=1 WHERE id=?", (review_id,))
        await db.commit()

async def extract_and_save_facts(user_message: str, assistant_response: str):
    prompt = f"""
Analyze this exchange and extract permanent facts about the user worth remembering.
User: {user_message}
Assistant: {assistant_response}
Extract: technical preferences, skill state, work environment, learning milestones.
Ignore greetings, acknowledgments, temporary state.
Output raw JSON array of strings only. If no facts, output [].
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL, max_tokens=300, temperature=0.0,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.content[0].text.strip(), flags=re.MULTILINE).strip()
        facts = json.loads(text)
        if isinstance(facts, list) and facts:
            for fact in facts:
                await save_user_fact(str(fact))
    except Exception as e:
        print(f"⚠️ Memory Agent error: {e}")


# ==========================================
# 2. WEB SOURCE INGESTION ENGINE
# ==========================================
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

def fetch_live_internet_updates() -> list[dict]:
    articles = []
    unified_query = "latest artificial intelligence breakthroughs enterprise multi agent frameworks production architectures LLM evaluation guardrails testing evals"

    if TAVILY_API_KEY:
        print("🔍 Ingestion: Fetching via Tavily API...")
        try:
            res = requests.post("https://api.tavily.com/search", json={
                "api_key": TAVILY_API_KEY, "query": unified_query,
                "search_depth": "advanced", "include_raw_content": False, "max_results": 8
            }, timeout=15)
            if res.status_code == 200:
                for item in res.json().get("results", []):
                    articles.append({"url": item.get("url",""), "title": item.get("title",""), "content": item.get("content","")})
                if articles:
                    return articles
        except Exception as e:
            print(f"⚠️ Tavily failed ({e}). Falling back...")

    print("🕷️ Ingestion: Scraping from DuckDuckGo...")
    try:
        res = requests.get(
            f"https://html.duckduckgo.com/html/?q={unified_query.replace(' ', '+')}",
            headers={"User-Agent": "Mozilla/5.0"}, timeout=12
        )
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            for result in soup.find_all('div', class_='result')[:8]:
                a = result.find('a', class_='result__a')
                snippet = result.find('a', class_='result__snippet')
                if a:
                    url = a.get('href', '')
                    if url and not url.startswith('http'):
                        url = "https://" + url
                    articles.append({"url": url, "title": a.text.strip(), "content": snippet.text.strip() if snippet else ""})
    except Exception as e:
        print(f"⚠️ DuckDuckGo failed: {e}")

    if not articles:
        articles = [
            {"url": "https://openai.com/news", "title": "Scaling multi-agent frameworks", "content": "Enterprise agentic frameworks with robust assertion loops."},
            {"url": "https://github.com/blog", "title": "Agentic Infrastructure Testing", "content": "Sandboxed runtimes for continuous code quality assertion."}
        ]
    return articles


# ==========================================
# 3. CURRICULUM PLANNER AGENT
# ==========================================
_FALLBACK_CONCEPTS = [
    ("RAG QA Testing", "Build evaluation harnesses that test retrieval quality and answer faithfulness."),
    ("Multi-Agent Systems Testing", "Write integration tests that validate agent handoff and task routing logic."),
    ("LLM Guardrails & Evals", "Implement policy checks and eval suites to catch unsafe or off-topic LLM outputs."),
    ("Advanced Prompting Scaffolding", "Master prompt chaining and few-shot patterns to control LLM behaviour reliably."),
    ("Agentic Scaffolding Testing", "Test control flow logic of complex agentic scaffolding with deterministic assertions."),
]

async def run_curriculum_planner(skill_level, history_concepts):
    print("📋 [Curriculum Planner]: Selecting today's concept...")

    # Check review queue first — re-test weak areas before new content
    today_str = date.today().isoformat()
    due_review = await get_due_review(today_str)
    if due_review:
        print(f"🔁 Review queue: revisiting '{due_review['concept']}' ({due_review['difficulty']} level)")
        await mark_review_done(due_review["id"])
        return {
            "concept": due_review["concept"],
            "pedagogical_focus": f"Revisit and solidify understanding at {due_review['difficulty']} level.",
            "assert_template": "Write assertions that specifically test the areas you previously struggled with."
        }

    prompt = f"""
You are the Lead Curriculum Planner for an engineer transitioning to Agentic AI Quality Engineering.
Student skill track: {skill_level}
Previously covered concepts: {history_concepts}

Select the next logical learning concept from:
1. Advanced Prompting/Scaffolding
2. RAG QA Testing
3. Multi-Agent Systems Testing
4. LLM Guardrails & Evals

Output raw valid JSON only inside <plan> tags.
Example: <plan>{{"concept": "...", "pedagogical_focus": "...", "assert_template": "..."}}</plan>
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL, max_tokens=300, temperature=0.4,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()
        plan_match = re.search(r'<plan>\s*(.*?)\s*</plan>', text, re.DOTALL | re.IGNORECASE)
        plan_content = plan_match.group(1).strip() if plan_match else text.strip()
        plan_content = re.sub(r'^```(?:json)?\s*|\s*```$', '', plan_content, flags=re.MULTILINE).strip()
        data = json.loads(plan_content)
        print(f"🎯 Concept selected: '{data.get('concept')}'")
        return data
    except Exception as e:
        print(f"⚠️ Planner fallback: {e}")
        # Pick the fallback concept least recently covered
        covered = set(history_concepts)
        for concept, focus in _FALLBACK_CONCEPTS:
            if concept not in covered:
                return {
                    "concept": concept,
                    "pedagogical_focus": focus,
                    "assert_template": "Write specific assertions that verify the core logic of this concept."
                }
        # All covered — cycle back to first
        concept, focus = _FALLBACK_CONCEPTS[0]
        return {
            "concept": concept,
            "pedagogical_focus": focus,
            "assert_template": "Write specific assertions that verify the core logic of this concept."
        }


# ==========================================
# 4. WEEKLY PROJECT ENGINE
# — Project title + 7 subtasks all match today's concept
# — Every morning shows full project name + today's subtask only
# ==========================================
async def get_or_create_weekly_project(concept: str, skill_level: str) -> dict:
    today = date.today()
    week_start = (today - dt.timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    day_of_week = today.weekday() + 1  # 1=Monday, 7=Sunday

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT project_title, day_number, subtask_title, subtask_description FROM weekly_project WHERE week_start=? AND day_number=?",
            (week_start, day_of_week)
        ) as cursor:
            row = await cursor.fetchone()

    if row:
        return {
            "project_title": row[0],
            "day_number": row[1],
            "subtask_title": row[2],
            "subtask_description": row[3],
            "week_start": week_start
        }

    # Check if project already generated this week
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM weekly_project WHERE week_start=?", (week_start,)
        ) as cursor:
            count_row = await cursor.fetchone()

    if count_row and count_row[0] > 0:
        # Project exists, just missing today's entry — return day 1
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT project_title, day_number, subtask_title, subtask_description FROM weekly_project WHERE week_start=? ORDER BY day_number ASC LIMIT 1",
                (week_start,)
            ) as cursor:
                first_row = await cursor.fetchone()
        if first_row:
            return {"project_title": first_row[0], "day_number": first_row[1], "subtask_title": first_row[2], "subtask_description": first_row[3], "week_start": week_start}

    # Generate new 7-day project matching this week's concept
    prompt = f"""
You are a project architect for an AI engineering student.
Skill level: {skill_level}
This week's concept: {concept}

Design a 7-day hands-on project where:
- The overall project is directly about: {concept}
- Each day builds on the previous day
- Day 7 is final integration and testing
- Every subtask is practical and buildable in 1-2 hours

Output raw JSON only:
{{
  "project_title": "A clear project name directly related to {concept}",
  "subtasks": [
    {{"day": 1, "title": "Short task title", "description": "Exactly what to build today in 2 sentences"}},
    {{"day": 2, "title": "...", "description": "..."}},
    {{"day": 3, "title": "...", "description": "..."}},
    {{"day": 4, "title": "...", "description": "..."}},
    {{"day": 5, "title": "...", "description": "..."}},
    {{"day": 6, "title": "...", "description": "..."}},
    {{"day": 7, "title": "Final Integration", "description": "..."}}
  ]
}}
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL, max_tokens=800, temperature=0.3,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.content[0].text.strip(), flags=re.MULTILINE).strip()
        project_data = json.loads(text)

        async with aiosqlite.connect(DB_PATH) as db:
            for subtask in project_data["subtasks"]:
                await db.execute(
                    "INSERT INTO weekly_project (week_start, project_title, concept, day_number, subtask_title, subtask_description) VALUES (?, ?, ?, ?, ?, ?)",
                    (week_start, project_data["project_title"], concept, subtask["day"], subtask["title"], subtask["description"])
                )
            await db.commit()

        today_subtask = project_data["subtasks"][day_of_week - 1] if day_of_week <= 7 else project_data["subtasks"][0]
        return {
            "project_title": project_data["project_title"],
            "day_number": today_subtask["day"],
            "subtask_title": today_subtask["title"],
            "subtask_description": today_subtask["description"],
            "week_start": week_start
        }
    except Exception as e:
        print(f"⚠️ Project engine error: {e}")
        return {
            "project_title": f"Build a {concept} System",
            "day_number": day_of_week,
            "subtask_title": "Set up project structure",
            "subtask_description": f"Create the base folder structure and initialize your Python environment for building the {concept} system.",
            "week_start": week_start
        }


# ==========================================
# 5. ASSERTION QUALITY SCORER
# ==========================================
async def score_assertion_quality(assertions: list[str], concept: str, reference_code: str) -> dict:
    print("🔍 [Assertion Quality Scorer]: Evaluating assertion strength...")
    prompt = f"""
You are an expert Python QA engineer evaluating assertion quality.
Concept being tested: {concept}

Reference implementation:
{reference_code}

Assertions to evaluate:
{chr(10).join([f"{i+1}. {a}" for i, a in enumerate(assertions)])}

Score each assertion 1-10:
- 1-3: USELESS. Always passes regardless of implementation.
- 4-6: SHALLOW. Checks type or basic existence but not logic.
- 7-10: STRONG. Checks specific business logic and concept behavior.

Output raw JSON only:
{{
  "scores": [
    {{"assertion": "assert ...", "score": 8, "reason": "Tests specific logic"}},
    {{"assertion": "assert ...", "score": 3, "reason": "Always passes"}}
  ],
  "average_score": 6.0,
  "verdict": "PASS",
  "feedback": "Brief feedback here"
}}
Verdict is PASS if average_score >= 6.0, otherwise FAIL.
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL, max_tokens=600, temperature=0.0,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.content[0].text.strip(), flags=re.MULTILINE).strip()
        result = json.loads(text)
        print(f"📊 Assertion Quality: {result.get('average_score', 0):.1f}/10 — {result.get('verdict')}")
        return result
    except Exception as e:
        print(f"⚠️ Quality scorer error: {e}")
        return {"scores": [], "average_score": 5.0, "verdict": "PASS", "feedback": "Scorer unavailable."}


# ==========================================
# 6. MUTATION TESTING ENGINE
# ==========================================
def apply_mutations(code: str) -> list[str]:
    mutations = []
    lines = code.split('\n')
    for i, line in enumerate(lines):
        mutated_lines = lines.copy()
        if '==' in line and 'assert' not in line:
            mutated_lines[i] = line.replace('==', '!=', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if ' + ' in line and 'assert' not in line:
            mutated_lines[i] = line.replace(' + ', ' - ', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if 'True' in line and 'assert' not in line:
            mutated_lines[i] = line.replace('True', 'False', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if ' > ' in line and 'assert' not in line:
            mutated_lines[i] = line.replace(' > ', ' < ', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if line.strip().startswith('return ') and 'None' not in line and 'assert' not in line:
            mutated_lines[i] = line.replace(line.strip(), 'return None', 1)
            mutations.append('\n'.join(mutated_lines))
    seen = set()
    unique = []
    for m in mutations:
        if m != code and m not in seen:
            seen.add(m)
            unique.append(m)
        if len(unique) >= 5:
            break
    return unique

def run_sandbox_silent(code: str, assert_lines: list) -> bool:
    import math, json as jmod, re as rmod
    full_code = code + "\n\n" + "\n".join(assert_lines)
    sandbox_globals = {
        "math": math, "json": jmod, "re": rmod,
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
            "enumerate": enumerate, "float": float, "int": int,
            "isinstance": isinstance, "len": len, "list": list,
            "map": map, "max": max, "min": min, "print": print,
            "range": range, "round": round, "set": set, "sorted": sorted,
            "str": str, "sum": sum, "tuple": tuple, "type": type, "zip": zip,
            "AssertionError": AssertionError, "ValueError": ValueError,
            "TypeError": TypeError, "Exception": Exception
        }
    }
    try:
        exec(compile(full_code, "<sandbox>", "exec"), sandbox_globals)
        return True
    except Exception:
        return False

def run_mutation_testing(reference_code: str, assert_lines: list) -> dict:
    print("🧬 [Mutation Tester]: Running mutation tests...")
    mutations = apply_mutations(reference_code)
    if not mutations:
        return {"verdict": "PASS", "mutations_tested": 0, "mutations_caught": 0, "kill_rate": 100.0, "feedback": "No mutations applicable."}
    caught = 0
    survived_examples = []
    for mutated_code in mutations:
        passed = run_sandbox_silent(mutated_code, assert_lines)
        if passed:
            orig_lines = reference_code.split('\n')
            mut_lines = mutated_code.split('\n')
            for ol, ml in zip(orig_lines, mut_lines):
                if ol != ml:
                    if len(survived_examples) < 2:
                        survived_examples.append(f"'{ol.strip()}' → '{ml.strip()}'")
                    break
        else:
            caught += 1
    total = len(mutations)
    kill_rate = (caught / total * 100) if total > 0 else 100.0
    verdict = "PASS" if kill_rate >= 60.0 else "FAIL"
    feedback = ""
    if verdict == "FAIL":
        feedback = f"Assertions only caught {caught}/{total} mutations ({kill_rate:.0f}%). "
        if survived_examples:
            feedback += f"Missed: {'; '.join(survived_examples)}. Write specific value checks."
    print(f"🧬 Mutation: {caught}/{total} caught. Kill rate: {kill_rate:.0f}% — {verdict}")
    return {"verdict": verdict, "mutations_tested": total, "mutations_caught": caught, "kill_rate": kill_rate, "feedback": feedback}


# ==========================================
# 7. EXECUTION SANDBOX
# ==========================================
def run_code_sandbox(reference_code: str, assert_lines: list) -> tuple[bool, str]:
    print("🧪 [Sandbox]: Verifying assertions...")
    import math, json as jmod, re as rmod
    full_code = reference_code + "\n\n" + "\n".join(assert_lines)
    sandbox_globals = {
        "math": math, "json": jmod, "re": rmod,
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool,
            "chr": chr, "dict": dict, "divmod": divmod, "enumerate": enumerate,
            "filter": filter, "float": float, "format": format,
            "int": int, "isinstance": isinstance, "issubclass": issubclass,
            "iter": iter, "len": len, "list": list, "map": map, "max": max, "min": min,
            "next": next, "object": object, "ord": ord, "pow": pow, "print": print,
            "range": range, "repr": repr, "reversed": reversed, "round": round,
            "set": set, "slice": slice, "sorted": sorted, "str": str, "sum": sum,
            "tuple": tuple, "type": type, "zip": zip,
            "AssertionError": AssertionError, "ValueError": ValueError,
            "TypeError": TypeError, "KeyError": KeyError, "IndexError": IndexError,
            "Exception": Exception, "StopIteration": StopIteration, "RuntimeError": RuntimeError
        }
    }
    try:
        exec(compile(full_code, "<sandbox>", "exec"), sandbox_globals)
        return True, "All assertions passed."
    except AssertionError as e:
        return False, f"AssertionError: {str(e) if str(e) else 'Assert failed.'}"
    except SyntaxError as e:
        return False, f"SyntaxError line {e.lineno}: {e.msg}"
    except Exception as e:
        return False, f"{type(e).__name__}: {str(e)}"


# ==========================================
# 8. QA CRITIC AGENT
# ==========================================
async def run_qa_critic(content: str, reference_code: str) -> tuple[bool, str]:
    print("🕵️‍♂️ [QA Critic]: Verifying pipeline parameters...")

    has_updates = "*🔴 REGULAR DAILY AI UPDATES*" in content
    has_learnings = "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*" in content

    assert_lines = []
    for line in content.split('\n'):
        clean_line = line.replace('*', '').replace('-', '').strip()
        if clean_line.startswith('assert '):
            assert_lines.append(clean_line)

    has_assert_syntax = len(assert_lines) >= 3
    char_length = len(content)
    within_twilio_limit = char_length <= 1600

    lines = content.split('\n')
    is_in_update_block = False
    update_count = 0
    for line in lines:
        if "*🔴 REGULAR DAILY AI UPDATES*" in line:
            is_in_update_block = True
            continue
        if "*📘 WHAT I NEED TO LEARN*" in line:
            is_in_update_block = False
        if is_in_update_block and (line.strip().startswith('-') or line.strip().startswith('*') or (line.strip() and line.strip()[0].isdigit())):
            update_count += 1

    errors = []
    if not has_updates: errors.append("Missing '*🔴 REGULAR DAILY AI UPDATES*' header.")
    if not has_learnings: errors.append("Missing '*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*' header.")
    if not has_assert_syntax: errors.append(f"Found {len(assert_lines)} assertions, expected at least 3.")
    if not within_twilio_limit: errors.append(f"Payload out of size bounds ({char_length}/1600 chars).")
    if not (3 <= update_count <= 8): errors.append(f"Density check: Found {update_count} updates, expected 5-7.")

    sandbox_passed = False
    quality_result = {"verdict": "SKIP", "average_score": 0, "feedback": ""}
    mutation_result = {"verdict": "SKIP", "kill_rate": 0, "feedback": ""}

    if has_assert_syntax and reference_code:
        sandbox_passed, sandbox_msg = run_code_sandbox(reference_code, assert_lines)
        if not sandbox_passed:
            errors.append(f"Sandbox Failed: {sandbox_msg}")
        else:
            quality_result = await score_assertion_quality(assert_lines, "today's concept", reference_code)
            if quality_result.get("verdict") == "FAIL":
                errors.append(f"Assertion Quality Failed (avg {quality_result.get('average_score',0):.1f}/10): {quality_result.get('feedback','')}")
            if quality_result.get("verdict") != "FAIL":
                mutation_result = run_mutation_testing(reference_code, assert_lines)
                if mutation_result.get("verdict") == "FAIL":
                    errors.append(f"Mutation Testing Failed (kill rate {mutation_result.get('kill_rate',0):.0f}%): {mutation_result.get('feedback','')}")

    print("\n" + "="*50)
    print("📊 QA CRITIC STATUS AND INTEGRITY METRICS")
    print("-"*50)
    print(f"  - Daily Updates Section:         {'PASS' if has_updates else 'FAIL'}")
    print(f"  - Learning & Projects Section:  {'PASS' if has_learnings else 'FAIL'}")
    print(f"  - Sandbox Assert Execution:      {'PASS' if sandbox_passed else 'FAIL'}")
    print(f"  - Assertion Quality Score:       {quality_result.get('average_score',0):.1f}/10 ({quality_result.get('verdict','SKIP')})")
    print(f"  - Mutation Test Kill Rate:       {mutation_result.get('kill_rate',0):.0f}% ({mutation_result.get('verdict','SKIP')})")
    print(f"  - Twilio Message Size Safety:    {char_length}/1600 chars ({'PASS' if within_twilio_limit else 'FAIL'})")
    print(f"  - Density Metric:                {update_count} updates processed")

    if not errors:
        print("\nSTATUS: ALL PARAMETERS WORKING FINE. RELEASING PAYLOAD.")
        print("="*50 + "\n")
        return True, ""
    else:
        feedback_report = " | ".join(errors)
        print(f"\nSTATUS: REJECTED. Violations: {feedback_report}")
        print("="*50 + "\n")
        return False, feedback_report


# ==========================================
# 9. CREATOR AGENT
# ==========================================
async def generate_daily_payload(raw_data, skill_level, exclusions, planner_context, project_context, feedback_loop_msg=""):
    print("🤖 [Creator Agent]: Requesting compact update from Claude...")

    concept = planner_context.get("concept")
    pedagogical_focus = planner_context.get("pedagogical_focus")
    assert_template = planner_context.get("assert_template")

    # Project section — always shows full project name + today's subtask only
    project_section = ""
    if project_context:
        project_section = (
            f"\n*🏗️ THIS WEEK'S PROJECT:*\n"
            f"_{project_context.get('project_title', '')}_\n\n"
            f"*Today — Day {project_context.get('day_number', 1)}: {project_context.get('subtask_title', '')}*\n"
            f"{project_context.get('subtask_description', '')}"
        )

    prompt = f"""
You are the Lead Curriculum Director for an Engineer tracking towards Agentic AI Test Architecture.
Current Student Skill Level: {skill_level}
Strict Exclusion List (DO NOT REPEAT): {exclusions}

Today's Curriculum Focus:
- Concept to Master: {concept}
- Pedagogical Focus: {pedagogical_focus}
- Assert Template Guide: {assert_template}

IMPORTANT: Today's mini project is directly about {concept}. 
The project, subtask, and learning content must all be on the same topic.

Using these fresh live internet updates:
{raw_data}

Provide two outputs:
1. A WhatsApp-friendly learning digest wrapped in <whatsapp_payload> tags.
2. A valid Python reference implementation wrapped in <reference_implementation> tags.

CRITICAL SIZE CONSTRAINT: Content inside <whatsapp_payload> must be strictly under 1200 characters.

Structure the <whatsapp_payload> EXACTLY as:

*🔴 REGULAR DAILY AI UPDATES*
(5 to 7 high-signal, short, single-sentence points)

*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*
- *Core Concept to Master Today*: {concept} — {pedagogical_focus}
- *Practical Mini-Project Blueprint*: A quick technical project loop.
- *QA Validation Lines*:
assert your_function_here() == expected_value
assert your_second_function(input) == specific_result
assert your_third_function() == True

CRITICAL ASSERTION RULES:
1. Every assertion MUST start with "assert " (lowercase)
2. Every assertion MUST check a SPECIFIC value not just is not None
3. Functions must match exactly what is defined in reference implementation
4. Assertions must test actual concept logic

Structure the <reference_implementation> as valid Python code with function definitions.
"""

    if feedback_loop_msg:
        prompt += f"\n\n⚠️ CRITICAL CORRECTION REQUIRED:\n{feedback_loop_msg}"

    response = await anthropic_client.messages.create(
        model=CLAUDE_MODEL, max_tokens=2000, temperature=0.2,
        messages=[{"role": "user", "content": prompt}]
    )

    text = response.content[0].text
    whatsapp_payload = ""
    reference_code = ""

    if "<whatsapp_payload>" in text and "</whatsapp_payload>" in text:
        whatsapp_payload = text.split("<whatsapp_payload>")[1].split("</whatsapp_payload>")[0].strip()
    else:
        whatsapp_payload = text

    if project_section:
        whatsapp_payload += f"\n\n{project_section}"

    if "<reference_implementation>" in text and "</reference_implementation>" in text:
        reference_code = text.split("<reference_implementation>")[1].split("</reference_implementation>")[0].strip()
        reference_code = re.sub(r'^```(?:python)?\s*|\s*```$', '', reference_code, flags=re.MULTILINE).strip()

    return whatsapp_payload, reference_code


# ==========================================
# 10. QUIZ ENGINE
# ==========================================
async def generate_quiz_questions(concept: str, skill_level: str) -> list[dict]:
    prompt = f"""
You are a strict quiz generator for an AI engineering student.
Concept: {concept}
Skill level: {skill_level}

Generate exactly 10 multiple choice questions. Every single question MUST have exactly 4 options labeled A, B, C, and D. No exceptions.

Distribution:
- Questions 1-2: Easy
- Questions 3-4: Medium
- Questions 5-6: Hard
- Questions 7-8: Difficult
- Questions 9-10: Advanced

CRITICAL RULES:
1. Every question MUST be a question ending with a question mark
2. Every question MUST have exactly 4 options: A, B, C, and D
3. Only ONE option is correct
4. Never write statements — always write questions
5. The "correct" field must be exactly one of: "A", "B", "C", or "D"

Follow this exact format. Do not deviate:

Output raw JSON array only — no markdown, no backticks, no extra text:
[
  {{
    "number": 1,
    "difficulty": "Easy",
    "question": "What does RAG stand for in AI systems?",
    "options": {{
      "A": "Random Access Generation",
      "B": "Retrieval Augmented Generation",
      "C": "Rapid Agent Grounding",
      "D": "Resource Allocation Graph"
    }},
    "correct": "B",
    "explanation": "RAG stands for Retrieval Augmented Generation which combines retrieval systems with LLMs."
  }},
  {{
    "number": 2,
    "difficulty": "Easy",
    "question": "Which component in a RAG system is responsible for finding relevant documents?",
    "options": {{
      "A": "The generator",
      "B": "The tokenizer",
      "C": "The retriever",
      "D": "The embedder"
    }},
    "correct": "C",
    "explanation": "The retriever searches the knowledge base to find documents relevant to the query."
  }}
]

Generate all 10 questions following this exact structure.
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL, max_tokens=2000, temperature=0.3,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.content[0].text.strip(), flags=re.MULTILINE).strip()
        questions = json.loads(text)

        # Validate structure — discard malformed questions
        valid = []
        required_keys = {"question", "options", "correct", "explanation", "difficulty"}
        for q in questions:
            if not isinstance(q, dict):
                continue
            if not required_keys.issubset(q.keys()):
                continue
            opts = q.get("options", {})
            if not isinstance(opts, dict) or not {"A", "B", "C", "D"}.issubset(opts.keys()):
                continue
            if q.get("correct", "").upper() not in {"A", "B", "C", "D"}:
                continue
            valid.append(q)

        if len(valid) < 5:
            print(f"⚠️ Quiz validation: only {len(valid)} valid questions — treating as generation failure")
            return []

        print(f"✅ Generated {len(valid)} valid quiz questions for '{concept}'")
        return valid
    except Exception as e:
        print(f"⚠️ Quiz generation error: {e}")
        return []

def load_quiz_state() -> dict:
    if os.path.exists(QUIZ_STATE_FILE):
        with open(QUIZ_STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_quiz_state(state: dict):
    with open(QUIZ_STATE_FILE, "w") as f:
        json.dump(state, f)

def clear_quiz_state():
    if os.path.exists(QUIZ_STATE_FILE):
        os.remove(QUIZ_STATE_FILE)

async def start_quiz_session(concept: str, skill_level: str) -> str:
    questions = await generate_quiz_questions(concept, skill_level)
    if not questions:
        return "⚠️ Could not generate quiz questions. Please try again later."

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO quiz_sessions (date, concept, skill_level, total_questions) VALUES (?, ?, ?, ?)",
            (date.today().isoformat(), concept, skill_level, len(questions))
        )
        session_id = cursor.lastrowid
        await db.commit()

    save_quiz_state({
        "session_id": session_id, "concept": concept,
        "skill_level": skill_level, "questions": questions,
        "current_index": 0, "score": 0, "answers": []
    })
    return format_question(questions[0], 1, len(questions))

def format_question(q: dict, current: int, total: int) -> str:
    emoji = {"Easy": "🟢", "Medium": "🟡", "Hard": "🟠", "Difficult": "🔴", "Advanced": "⚫"}.get(q["difficulty"], "⚪")
    progress_bar = "▓" * current + "░" * (total - current)
    return (
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🧠 *Question {current} of {total}*\n"
        f"{progress_bar}\n"
        f"{emoji} *{q['difficulty']}*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"{q['question']}\n\n"
        f"*A)* {q['options']['A']}\n"
        f"*B)* {q['options']['B']}\n"
        f"*C)* {q['options']['C']}\n"
        f"*D)* {q['options']['D']}\n\n"
        f"↩️ Reply *A*, *B*, *C*, or *D*"
    )

async def process_quiz_answer(user_answer: str) -> str:
    state = load_quiz_state()
    if not state:
        return ""

    questions = state["questions"]
    current_index = state["current_index"]
    current_q = questions[current_index]
    is_correct = user_answer.upper().strip() == current_q["correct"].upper()

    if is_correct:
        state["score"] += 1

    state["answers"].append({
        "question_number": current_index + 1,
        "question_text": current_q["question"],
        "correct_answer": current_q["correct"],
        "user_answer": user_answer.upper(),
        "difficulty": current_q["difficulty"],
        "is_correct": is_correct
    })

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO quiz_answers (session_id, question_number, question_text, correct_answer, user_answer, difficulty, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (state["session_id"], current_index+1, current_q["question"], current_q["correct"], user_answer.upper(), current_q["difficulty"], int(is_correct))
        )
        await db.commit()

    feedback = "✅ Correct!" if is_correct else f"❌ Wrong. Answer: *{current_q['correct']}* — {current_q.get('explanation','')}"
    state["current_index"] += 1
    save_quiz_state(state)

    if state["current_index"] >= len(questions):
        result_msg = await finalize_quiz(state)
        clear_quiz_state()
        return f"{feedback}\n\n{result_msg}"
    else:
        next_q = questions[state["current_index"]]
        next_question_text = format_question(next_q, state["current_index"]+1, len(questions))
        options_footer = (
            f"\n─────────────────────\n"
            f"*What do you want to do?*\n"
            f"▶️ Reply *A/B/C/D* — Answer next question\n"
            f"⏭️ Reply *skip* — Skip this question\n"
            f"🛑 Reply *end quiz* — End quiz and see results"
        )
        return f"{feedback}\n\n{next_question_text}{options_footer}"

async def finalize_quiz(state: dict) -> str:
    score = state["score"]
    total = len(state["questions"])
    concept = state["concept"]
    skill_level = state["skill_level"]
    answers = state["answers"]
    wrong_answers = [a for a in answers if not a["is_correct"]]
    correct_answers = [a for a in answers if a["is_correct"]]
    weak_areas = ", ".join(set([a["difficulty"] for a in wrong_answers])) if wrong_answers else "None"
    percentage = (score / total) * 100

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE quiz_sessions SET score=?, completed=1 WHERE id=?", (score, state["session_id"]))
        await db.execute(
            "INSERT INTO performance_log (date, concept, quiz_score, max_score, skill_level, weak_areas) VALUES (?, ?, ?, ?, ?, ?)",
            (date.today().isoformat(), concept, score, total, skill_level, weak_areas)
        )
        await db.commit()

    # Build missed topics list
    missed_questions = [a["question_text"][:70] for a in wrong_answers]
    missed_section = ""
    if missed_questions:
        missed_section = "\n*❌ Questions You Missed:*\n" + "\n".join([f"- {q}..." for q in missed_questions[:5]])

    # Build key concepts to practice
    missed_difficulties = list(set([a["difficulty"] for a in wrong_answers]))
    concepts_section = ""
    if missed_difficulties:
        concepts_section = f"\n*📌 Key Concepts to Practice:*\n- Focus on *{concept}* at {' and '.join(missed_difficulties)} level\n- Revisit the fundamentals before moving to harder questions"

    # Resources based on concept and score
    resources_section = ""
    if score < 8:
        prompt = f"""
The student just scored {score}/{total} on a quiz about {concept} at {skill_level} level.
They struggled with: {', '.join(missed_questions[:3]) if missed_questions else 'advanced questions'}

Suggest exactly 3 specific free learning resources for {concept}.
Output raw JSON only:
[
  {{"title": "Resource name", "url": "https://...", "why": "One sentence why this helps"}},
  {{"title": "...", "url": "https://...", "why": "..."}},
  {{"title": "...", "url": "https://...", "why": "..."}}
]
"""
        try:
            response = await anthropic_client.messages.create(
                model=CLAUDE_MODEL, max_tokens=400, temperature=0.2,
                messages=[{"role": "user", "content": prompt}]
            )
            text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.content[0].text.strip(), flags=re.MULTILINE).strip()
            resources = json.loads(text)
            resources_section = "\n*📚 Resources to Study:*\n" + "\n".join([f"- *{r['title']}*\n  {r['url']}\n  _{r['why']}_" for r in resources])
        except Exception as e:
            print(f"⚠️ Resource generation error: {e}")
            resources_section = f"\n*📚 Resources to Study:*\n- Search '{concept} tutorial' on YouTube\n- Check official documentation\n- Practice on GitHub"

    # Build final message based on score
    # Streak tracking
    new_streak = await update_study_streak()
    streak_msg = ""
    if new_streak in [3, 7, 14, 30]:
        streak_msg = f"\n\n🔥 *{new_streak}-day streak! Keep it up!*"
    elif new_streak > 1:
        streak_msg = f"\n\n📅 *Study streak: {new_streak} days*"

    if score < 5:
        header = f"📊 *Quiz Complete!*\n\nScore: *{score}/{total}* ({percentage:.0f}%) — Needs Work 📉"
        footer = "\n\n💪 Don't give up — review the resources above and try again tomorrow. Every expert started as a beginner!"
        await update_db_skill("Foundational")
        if missed_difficulties:
            await add_to_review_queue(concept, missed_difficulties)
    elif score < 8:
        header = f"📊 *Quiz Complete!*\n\nScore: *{score}/{total}* ({percentage:.0f}%) — Good Effort 👍"
        footer = "\n\n🚀 Solid progress! Study the missed topics and tomorrow you will score higher."
        if missed_difficulties:
            await add_to_review_queue(concept, missed_difficulties)
    else:
        header = f"📊 *Quiz Complete!*\n\nScore: *{score}/{total}* ({percentage:.0f}%) — Excellent! 🌟"
        missed_section = ""
        concepts_section = "\n*✅ Concepts Mastered:*\n- " + "\n- ".join([a["question_text"][:50] + "..." for a in correct_answers[:3]])
        resources_section = ""
        footer = "\n\n🔥 Outstanding work! Tomorrow we level up to something harder."
        await update_db_skill("Intermediate" if skill_level == "Foundational" else "Advanced")

    return header + missed_section + concepts_section + resources_section + footer + streak_msg


# ==========================================
# 11. CHECK-IN REMINDER ENGINE
# — Asks about today's learning topic AND today's project subtask
# ==========================================
async def send_checkin_reminder(reminder_number: int):
    today = date.today().isoformat()
    loop = asyncio.get_event_loop()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT reminder_count, learning_status, quiz_triggered, concept FROM daily_checkins WHERE date=?",
            (today,)
        ) as cursor:
            row = await cursor.fetchone()

    if not row:
        # Fetch today's concept from sent_history so reminders show the actual topic
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT concept FROM sent_history WHERE date(timestamp)=? ORDER BY timestamp DESC LIMIT 1",
                (today,)
            ) as cursor:
                concept_row = await cursor.fetchone()
        concept = concept_row[0] if concept_row else ""
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("INSERT OR IGNORE INTO daily_checkins (date, reminder_count, concept) VALUES (?, 0, ?)", (today, concept))
            await db.commit()
        reminder_count, learning_status, quiz_triggered = 0, "in_progress", 0
    else:
        reminder_count, learning_status, quiz_triggered, concept = row[0], row[1], row[2], row[3] or ""
        # Backfill missing concept from sent_history
        if not concept:
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    "SELECT concept FROM sent_history WHERE date(timestamp)=? ORDER BY timestamp DESC LIMIT 1",
                    (today,)
                ) as cursor:
                    concept_row = await cursor.fetchone()
            if concept_row:
                concept = concept_row[0]
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute("UPDATE daily_checkins SET concept=? WHERE date=?", (concept, today))
                    await db.commit()

    if quiz_triggered:
        return
    
    if learning_status == "done":
        return

    # Get today's project subtask
    week_start = (date.today() - dt.timedelta(days=date.today().weekday())).strftime("%Y-%m-%d")
    day_of_week = date.today().weekday() + 1
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT project_title, subtask_title FROM weekly_project WHERE week_start=? AND day_number=?",
            (week_start, day_of_week)
        ) as cursor:
            project_row = await cursor.fetchone()

    project_line = ""
    if project_row:
        project_line = f"\n\n📌 *Project:* _{project_row[0]}_\n*Today's task:* {project_row[1]}"

    concept_line = f" on *{concept}*" if concept else ""

    messages = {
        1: f"📚 Hey! How is your learning going{concept_line}? Reply *'done'* when you finish today's concept.{project_line}",
        2: f"⏰ Quick check-in — still working through today's topic{concept_line}? Reply *'done'* when you are ready for your quiz!{project_line}",
        3: f"🎯 How is the progress{concept_line}? Reply *'done'* to unlock your quiz whenever you are ready.{project_line}",
        4: f"🔔 Checking in again — how is it going{concept_line}? Reply *'done'* or let me know if you are stuck.{project_line}",
        5: f"⚡ Final reminder! Reply *'done'* to start your quiz now, or I will kick it off automatically in 30 minutes.{concept_line}{project_line}"
    }

    msg = messages.get(reminder_number, f"How is your learning going{concept_line}?")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE daily_checkins SET reminder_count=? WHERE date=?",
            (reminder_count + 1, today)
        )
        await db.commit()

    def send_msg():
        Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=msg, from_=FROM_WHATSAPP, to=TO_WHATSAPP)

    await loop.run_in_executor(None, send_msg)
    print(f"⏰ Check-in reminder {reminder_number} sent.")

    if reminder_number == 5:
        # Schedule auto-quiz 30 min from now via APScheduler so it survives server restarts
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.date import DateTrigger
        fire_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)
        try:
            from apscheduler.schedulers.base import STATE_RUNNING
            running_schedulers = [s for s in AsyncIOScheduler.__subclasses__() if getattr(s, 'state', None) == STATE_RUNNING]
        except Exception:
            running_schedulers = []
        # Use the app's global scheduler via the app's state if available, else fire inline
        app_scheduler = getattr(app.state, "scheduler", None)
        if app_scheduler:
            app_scheduler.add_job(auto_trigger_quiz, DateTrigger(run_date=fire_at), id="auto_quiz_today", replace_existing=True)
            print("⏰ Auto-quiz scheduled for 30 minutes from now.")
        else:
            asyncio.create_task(_delayed_auto_quiz())

async def _delayed_auto_quiz():
    await asyncio.sleep(1800)
    await auto_trigger_quiz()

async def auto_trigger_quiz():
    today = date.today().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT quiz_triggered FROM daily_checkins WHERE date=?", (today,)) as cursor:
            row = await cursor.fetchone()

    if row and row[0]:
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT concept FROM sent_history ORDER BY timestamp DESC LIMIT 1") as cursor:
            concept_row = await cursor.fetchone()

    concept = concept_row[0] if concept_row else _FALLBACK_CONCEPTS[0][0]
    skill_level, _, _ = await get_db_state()

    intro = f"⏰ Time is up! Let us test what you have learned on *{concept}*. Starting your quiz now...\n\n"
    first_question = await start_quiz_session(concept, skill_level)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE daily_checkins SET quiz_triggered=1 WHERE date=?", (today,))
        await db.commit()

    loop = asyncio.get_event_loop()
    def send_msg():
        Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=intro + first_question, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
    await loop.run_in_executor(None, send_msg)
    print("🧠 Auto-triggered quiz after final reminder.")


# ==========================================
# 12. WEEKLY PERFORMANCE REPORT
# ==========================================
async def send_weekly_report():
    loop = asyncio.get_event_loop()
    today = date.today()
    week_ago = (today - dt.timedelta(days=7)).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT date, concept, quiz_score, max_score, skill_level, weak_areas FROM performance_log WHERE date >= ? ORDER BY date ASC",
            (week_ago,)
        ) as cursor:
            rows = await cursor.fetchall()

    if not rows:
        msg = "📊 *Weekly Report*\n\nNo quiz data this week yet. Keep learning and completing your daily quizzes! 💪"
        def send_msg():
            Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=msg, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
        await loop.run_in_executor(None, send_msg)
        return

    total_score = sum(r[2] for r in rows)
    total_max = sum(r[3] for r in rows)
    avg_pct = (total_score / total_max * 100) if total_max > 0 else 0
    all_weak = [r[5] for r in rows if r[5] and r[5] != "None"]
    weak_summary = ", ".join(set(", ".join(all_weak).split(", "))) if all_weak else "None"
    trend = "📈 Improving!" if len(rows) >= 2 and rows[-1][2] >= rows[0][2] else "📉 Needs more focus"
    daily = "\n".join([f"- {r[0]}: *{r[1][:25]}* — {r[2]}/{r[3]} ({r[2]/r[3]*100:.0f}%)" for r in rows])

    report = (
        f"📊 *Weekly Performance Report*\n"
        f"{'='*28}\n\n"
        f"*Overall:* {total_score}/{total_max} ({avg_pct:.0f}%)\n"
        f"*Trend:* {trend}\n"
        f"*Days Active:* {len(rows)}/7\n\n"
        f"*Daily Breakdown:*\n{daily}\n\n"
        f"*Weak Areas:* {weak_summary}\n\n"
        f"*Next Week:* Strengthen {weak_summary if weak_summary != 'None' else 'Advanced concepts'}\n\n"
        f"Keep pushing — you are building something great! 🚀"
    )

    def send_msg():
        Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=report, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
    await loop.run_in_executor(None, send_msg)
    print("📊 Weekly report sent.")


# ==========================================
# 13. MORNING DIGEST ENDPOINT
# ==========================================
@app.post("/run-morning-digest")
async def run_morning_digest():
    try:
        skill_level, recent_topics, _ = await get_db_state()
        planner_context = await run_curriculum_planner(skill_level, recent_topics)
        concept = planner_context.get("concept", "Agentic Scaffolding Testing")

        loop = asyncio.get_running_loop()
        raw_news = await loop.run_in_executor(None, fetch_live_internet_updates)
        await save_articles_to_knowledge_store(raw_news)

        relevant_articles = await retrieve_relevant_context(concept, limit=3)
        if relevant_articles:
            context_blocks = [f"[{i+1}] Title: {a['title']}\nURL: {a['url']}\nSnippet: {a['content']}" for i, a in enumerate(relevant_articles)]
        else:
            context_blocks = [f"[{i+1}] Title: {a['title']}\nURL: {a['url']}\nSnippet: {a['content']}" for i, a in enumerate(raw_news[:3])]

        news_context = "\n\n".join(context_blocks)
        exclusions = ", ".join(recent_topics) if recent_topics else "None"

        # Get weekly project — concept-matched
        project_context = await get_or_create_weekly_project(concept, skill_level)

        today = date.today().isoformat()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT OR IGNORE INTO daily_checkins (date, reminder_count, concept) VALUES (?, 0, ?)",
                (today, concept)
            )
            await db.commit()

        max_retries = 3
        current_attempt = 1
        feedback = ""
        final_text = ""
        reference_code = ""
        is_valid_run = False

        while current_attempt <= max_retries:
            print(f"🔄 Evaluation Run Sequence: Loop {current_attempt}/{max_retries}")
            try:
                final_text, reference_code = await generate_daily_payload(
                    news_context, skill_level, exclusions, planner_context, project_context, feedback_loop_msg=feedback
                )
                is_valid_run, feedback = await run_qa_critic(final_text, reference_code)
                if is_valid_run:
                    break
                current_attempt += 1
            except Exception as e:
                import traceback
                print(f"❌ Generation failure: {e}")
                traceback.print_exc()
                feedback = f"Internal error: {str(e)}"
                current_attempt += 1

        if is_valid_run:
            await log_sent_concept(concept, final_text)
            try:
                def send_twilio():
                    Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=final_text, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
                await loop.run_in_executor(None, send_twilio)
                # Difficulty feedback prompt — separate message so digest stays clean
                feedback_prompt = (
                    f"📐 *Quick feedback:* Was today's concept (*{concept}*) the right difficulty?\n"
                    f"Reply *E* (too easy) · *J* (just right) · *H* (too hard)"
                )
                def send_feedback_prompt():
                    Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=feedback_prompt, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
                await loop.run_in_executor(None, send_feedback_prompt)
                return {"status": "Digest approved and dispatched.", "concept": concept}
            except Exception as e:
                return {"status": "QA Passed but Twilio failed", "error": str(e)}
        else:
            return {"status": "Aborted. Failed structural validation.", "errors": feedback}

    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "Error running digest pipeline", "error": str(e)}


# ==========================================
# 14. WHATSAPP WEBHOOK
# ==========================================
@app.post("/whatsapp-webhook")
async def incoming_whatsapp_reply(Body: str = Form(...)):
    user_message = Body.strip()
    user_message_clean = user_message.lower().strip()
    loop = asyncio.get_running_loop()
    today = date.today().isoformat()

    print(f"📥 [Incoming]: '{user_message_clean}'")

    def send_whatsapp(msg):
        Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=msg, from_=FROM_WHATSAPP, to=TO_WHATSAPP)

    # =========================================================================
    # GREETING / HELP MENU
    # =========================================================================
    if user_message_clean in ["hi", "hello", "hey", "start", "help", "menu", "commands"]:
        await log_chat_message("user", user_message)
        help_msg = (
            "👋 *Welcome to your Daily AI Learning Assistant!*\n\n"
            "*Available Commands:*\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "✅ *done* — Mark today's learning complete & start quiz\n"
            "📊 *status* — View your learning progress & streak\n"
            "📰 *digest* — Trigger today's morning digest manually\n"
            "📈 *report* — Get your weekly performance report\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "*During Quiz:*\n"
            "▶️ *A / B / C / D* — Answer a question\n"
            "⏭️ *skip* — Skip current question\n"
            "🛑 *end quiz* — End quiz and see results\n"
            "━━━━━━━━━━━━━━━━━━━━\n"
            "*Feedback:*\n"
            "🟢 *E* — Today's concept was too easy\n"
            "🟡 *J* — Just right\n"
            "🔴 *H* — Too hard\n\n"
            "Or just chat with me — I'm your AI coach! 💬"
        )
        await loop.run_in_executor(None, lambda: send_whatsapp(help_msg))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # STATUS / PROGRESS DASHBOARD
    # =========================================================================
    if user_message_clean in ["status", "progress", "my stats", "stats"]:
        await log_chat_message("user", user_message)
        skill_level, recent_topics, _ = await get_db_state()
        streak = await get_study_streak()
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT COUNT(*) FROM sent_history") as cursor:
                total_concepts = (await cursor.fetchone())[0]
            async with db.execute(
                "SELECT quiz_score, max_score, concept FROM performance_log ORDER BY timestamp DESC LIMIT 1"
            ) as cursor:
                last_quiz = await cursor.fetchone()
            async with db.execute(
                "SELECT COUNT(*) FROM review_queue WHERE completed=0"
            ) as cursor:
                pending_reviews = (await cursor.fetchone())[0]
        last_quiz_text = f"{last_quiz[0]}/{last_quiz[1]} on _{last_quiz[2][:30]}_" if last_quiz else "No quizzes yet"
        next_concept_hint = recent_topics[0] if recent_topics else "TBD"
        status_msg = (
            f"📊 *Your Learning Dashboard*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🎓 *Skill Level:* {skill_level}\n"
            f"🔥 *Study Streak:* {streak} day{'s' if streak != 1 else ''}\n"
            f"📚 *Concepts Learned:* {total_concepts}\n"
            f"📝 *Last Quiz:* {last_quiz_text}\n"
            f"🔁 *Pending Reviews:* {pending_reviews}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"Reply *done* after today's reading to start your quiz! 🚀"
        )
        await log_chat_message("assistant", status_msg)
        await loop.run_in_executor(None, lambda: send_whatsapp(status_msg))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # DIFFICULTY FEEDBACK (E / J / H)
    # =========================================================================
    if user_message_clean in ["e", "j", "h"]:
        mapping = {"e": "too_easy", "j": "just_right", "h": "too_hard"}
        pref = mapping[user_message_clean]
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE user_profile SET value=? WHERE key='difficulty_preference'", (pref,))
            await db.commit()
        labels = {"e": "too easy 🟢", "j": "just right 🟡", "h": "too hard 🔴"}
        reply = f"Got it! I noted today's concept felt *{labels[user_message_clean]}*. I'll adjust future concepts accordingly. 📐"
        await log_chat_message("user", user_message)
        await log_chat_message("assistant", reply)
        await loop.run_in_executor(None, lambda: send_whatsapp(reply))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # CODE REVIEW
    # =========================================================================
    if user_message_clean.startswith("review:"):
        await log_chat_message("user", user_message)
        code_snippet = user_message[7:].strip()
        if not code_snippet:
            await loop.run_in_executor(None, lambda: send_whatsapp("⚠️ Send: *review: <your code here>*"))
            return Response(content="<Response></Response>", media_type="text/xml")
        skill_level, recent_topics, _ = await get_db_state()
        concept = recent_topics[0] if recent_topics else "AI Engineering"
        try:
            review_response = await anthropic_client.messages.create(
                model=CLAUDE_MODEL, max_tokens=600, temperature=0.2,
                messages=[{"role": "user", "content": (
                    f"Review this code snippet for an {skill_level} student learning {concept}.\n"
                    f"```\n{code_snippet}\n```\n"
                    f"Give: 1) Correctness verdict, 2) One specific improvement, 3) One thing done well. "
                    f"Keep it under 200 words. Use WhatsApp *bold* formatting."
                )}]
            )
            review_msg = review_response.content[0].text.strip()
        except Exception as e:
            review_msg = f"⚠️ Code review unavailable: {e}"
        await log_chat_message("assistant", review_msg)
        await loop.run_in_executor(None, lambda: send_whatsapp(review_msg))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # QUIZ ANSWER HANDLER
    # =========================================================================
    quiz_state = load_quiz_state()
    if quiz_state:
        # Confirm end quiz
        if quiz_state.get("pending_end_confirm") and user_message_clean == "confirm":
            await log_chat_message("user", user_message)
            quiz_state.pop("pending_end_confirm", None)
            result_msg = await finalize_quiz(quiz_state)
            clear_quiz_state()
            final = f"🛑 *Quiz ended early.*\n\n{result_msg}"
            await log_chat_message("assistant", final)
            await loop.run_in_executor(None, lambda: send_whatsapp(final))
            return Response(content="<Response></Response>", media_type="text/xml")

        # End quiz early — ask for confirmation first
        if user_message_clean in ["end quiz", "end", "stop quiz", "finish"]:
            await log_chat_message("user", user_message)
            quiz_state["pending_end_confirm"] = True
            save_quiz_state(quiz_state)
            confirm_msg = (
                f"⚠️ Are you sure you want to end the quiz?\n\n"
                f"Current score: *{quiz_state.get('score', 0)}/{quiz_state.get('current_index', 0)}* answered\n\n"
                f"Reply *confirm* to end and see results, or keep answering to continue."
            )
            await log_chat_message("assistant", confirm_msg)
            await loop.run_in_executor(None, lambda: send_whatsapp(confirm_msg))
            return Response(content="<Response></Response>", media_type="text/xml")

        # Skip current question
        if user_message_clean == "skip":
            await log_chat_message("user", user_message)
            questions = quiz_state["questions"]
            current_index = quiz_state["current_index"]
            current_q = questions[current_index]

            # Log skipped as wrong
            quiz_state["answers"].append({
                "question_number": current_index + 1,
                "question_text": current_q["question"],
                "correct_answer": current_q["correct"],
                "user_answer": "SKIPPED",
                "difficulty": current_q["difficulty"],
                "is_correct": False
            })

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO quiz_answers (session_id, question_number, question_text, correct_answer, user_answer, difficulty, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (quiz_state["session_id"], current_index+1, current_q["question"], current_q["correct"], "SKIPPED", current_q["difficulty"], 0)
                )
                await db.commit()

            quiz_state["current_index"] += 1
            save_quiz_state(quiz_state)

            if quiz_state["current_index"] >= len(questions):
                result_msg = await finalize_quiz(quiz_state)
                clear_quiz_state()
                skip_msg = f"⏭️ *Question skipped.*\n\n{result_msg}"
            else:
                next_q = questions[quiz_state["current_index"]]
                next_question_text = format_question(next_q, quiz_state["current_index"]+1, len(questions))
                options_footer = (
                    f"\n─────────────────────\n"
                    f"*What do you want to do?*\n"
                    f"▶️ Reply *A/B/C/D* — Answer next question\n"
                    f"⏭️ Reply *skip* — Skip this question\n"
                    f"🛑 Reply *end quiz* — End quiz and see results"
                )
                skip_msg = f"⏭️ *Question skipped.* Moving on...\n\n{next_question_text}{options_footer}"

            await log_chat_message("assistant", skip_msg)
            await loop.run_in_executor(None, lambda: send_whatsapp(skip_msg))
            return Response(content="<Response></Response>", media_type="text/xml")

        # Answer A B C D
        if user_message_clean.upper() in ["A", "B", "C", "D"]:
            await log_chat_message("user", user_message)
            result = await process_quiz_answer(user_message_clean.upper())
            if result:
                await log_chat_message("assistant", result)
                await loop.run_in_executor(None, lambda: send_whatsapp(result))
            return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # LEARNING DONE — trigger quiz
    # =========================================================================
    if user_message_clean in ["done", "completed", "finished", "complete"]:
        await log_chat_message("user", user_message)

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT quiz_triggered, concept FROM daily_checkins WHERE date=?", (today,)) as cursor:
                row = await cursor.fetchone()

        if row and row[0]:
            await loop.run_in_executor(None, lambda: send_whatsapp("✅ Quiz already completed today! Come back tomorrow for a new concept. 🌟"))
            return Response(content="<Response></Response>", media_type="text/xml")

        concept = row[1] if row and row[1] else _FALLBACK_CONCEPTS[0][0]

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE daily_checkins SET learning_status='done' WHERE date=?", (today,))
            await db.commit()

        skill_level, _, _ = await get_db_state()
        intro = f"🎉 Great work finishing today's concept! Testing your knowledge on *{concept}* now.\n\n10 questions — Easy to Advanced. Here we go!\n\n"
        first_question = await start_quiz_session(concept, skill_level)

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE daily_checkins SET quiz_triggered=1 WHERE date=?", (today,))
            await db.commit()

        await log_chat_message("assistant", intro + first_question)
        await loop.run_in_executor(None, lambda: send_whatsapp(intro + first_question))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # APPROVE STAGED PATCH
    # =========================================================================
    if user_message_clean in ["approve", "yes", "confirm", "push"]:
        await log_chat_message("user", user_message)
        if not os.path.exists(STAGED_CODE_FILE):
            await loop.run_in_executor(None, lambda: send_whatsapp("⚠️ *No changes staged.* Send an upgrade instruction first!"))
            return Response(content="<Response></Response>", media_type="text/xml")

        def execute_staged_push():
            try:
                if not GITHUB_TOKEN or not GITHUB_REPO:
                    return False, "GITHUB_TOKEN or GITHUB_REPO missing."
                with open(STAGED_CODE_FILE, "r") as f:
                    staged_data = json.load(f)
                headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
                file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
                get_res = requests.get(file_url, headers=headers)
                if get_res.status_code != 200:
                    return False, f"GitHub fetch failed: {get_res.json().get('message')}"
                live_data = get_res.json()
                live_code = base64.b64decode(live_data["content"]).decode("utf-8")
                current_sha = live_data["sha"]
                find_text = staged_data.get("find")
                replace_text = staged_data.get("replace")
                if find_text not in live_code:
                    return False, "Patch target not found. File may have changed. Retry your instruction."
                patched_code = live_code.replace(find_text, replace_text, 1)
                put_res = requests.put(file_url, headers=headers, json={
                    "message": f"🤖 Surgical Patch: {staged_data['instruction'][:60]}",
                    "content": base64.b64encode(patched_code.encode("utf-8")).decode("utf-8"),
                    "sha": current_sha, "branch": "main"
                })
                if os.path.exists(STAGED_CODE_FILE):
                    os.remove(STAGED_CODE_FILE)
                return (True, "Success") if put_res.status_code in [200, 201] else (False, put_res.json().get("message", "Unknown error."))
            except Exception as e:
                return False, str(e)

        success, report = await loop.run_in_executor(None, execute_staged_push)
        msg = "🚀 *Approved!* Patch committed to GitHub.\n\n🔄 *Render Deployment Initiated.*" if success else f"❌ *Deployment Aborted.*\n\n`{report}`"
        await log_chat_message("assistant", msg)
        await loop.run_in_executor(None, lambda: send_whatsapp(msg))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # CANCEL STAGED PATCH
    # =========================================================================
    if user_message_clean in ["cancel", "no", "abort"]:
        await log_chat_message("user", user_message)
        if os.path.exists(STAGED_CODE_FILE):
            os.remove(STAGED_CODE_FILE)
            msg = "🛑 *Aborted.* Staged changes cleared."
        else:
            msg = "ℹ️ Nothing staged. Buffer is empty."
        await log_chat_message("assistant", msg)
        await loop.run_in_executor(None, lambda: send_whatsapp(msg))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # SYSTEM COMMANDS
    # =========================================================================
    if user_message_clean == "git status":
        await log_chat_message("user", user_message)
        def run_git():
            try: return subprocess.run(["git", "status"], capture_output=True, text=True, cwd=BASE_DIR).stdout.strip()
            except Exception as e: return str(e)
        output = await loop.run_in_executor(None, run_git)
        msg = f"📊 *Git Status*:\n\n```{output}```"
        await log_chat_message("assistant", msg)
        await loop.run_in_executor(None, lambda: send_whatsapp(msg))
        return Response(content="<Response></Response>", media_type="text/xml")

    if user_message_clean in ["digest", "refresh", "force digest"]:
        await log_chat_message("user", user_message)
        print("⚡ [Manual Override]: Triggering morning engine...")
        digest_status = await run_morning_digest()
        await log_chat_message("assistant", f"Manual trigger done. Status: {digest_status.get('status')}")
        return Response(content="<Response></Response>", media_type="text/xml")

    if user_message_clean in ["weekly report", "report", "my progress"]:
        await log_chat_message("user", user_message)
        await send_weekly_report()
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # UPGRADE INTENT — SURGICAL PATCH
    # =========================================================================
    is_upgrade_intent = any(k in user_message_clean for k in ["change", "update", "set", "add", "modify", "upgrade", "fix", "scheduler", "timings", "implement"])

    if is_upgrade_intent:
        await log_chat_message("user", user_message)
        if not GITHUB_TOKEN or not GITHUB_REPO:
            await loop.run_in_executor(None, lambda: send_whatsapp("❌ *Operation Denied.* `GITHUB_TOKEN` or `GITHUB_REPO` missing."))
            return Response(content="<Response></Response>", media_type="text/xml")

        try:
            headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
            file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
            res = await loop.run_in_executor(None, lambda: requests.get(file_url, headers=headers))
            if res.status_code != 200:
                await loop.run_in_executor(None, lambda: send_whatsapp(f"❌ *GitHub Error:* {res.json().get('message')}"))
                return Response(content="<Response></Response>", media_type="text/xml")

            file_data = res.json()
            current_sha = file_data["sha"]
            current_code = base64.b64decode(file_data["content"]).decode("utf-8")

            print("🧠 [AI Architect]: Generating surgical patch...")

            patch_response = await anthropic_client.messages.create(
                model=CLAUDE_MODEL, max_tokens=1500, temperature=0.1,
                system=(
                    "You are an expert Python code surgeon. "
                    "Given a user instruction and a Python file, identify the exact snippet to change. "
                    "Respond ONLY with a valid raw JSON object with exactly two keys: "
                    "\"find\" (exact existing code verbatim) and \"replace\" (new code). "
                    "No explanation, no markdown, no text outside the JSON."
                ),
                messages=[{"role": "user", "content": (
                    f"Instruction: {user_message}\n\n"
                    f"Current file:\n{current_code}\n\n"
                    f"Return ONLY: {{\"find\": \"exact old code\", \"replace\": \"new code\"}}"
                )}]
            )

            raw_text = re.sub(r'^```(?:json)?\s*|\s*```$', '', patch_response.content[0].text.strip(), flags=re.MULTILINE).strip()
            print(f"🔍 PATCH RESPONSE:\n{raw_text}")

            patch_data = json.loads(raw_text)
            find_text = patch_data.get("find", "").strip()
            replace_text = patch_data.get("replace", "").strip()

            if not find_text or not replace_text:
                raise ValueError("Patch JSON missing 'find' or 'replace' keys.")
            if find_text not in current_code:
                raise ValueError("Patch target not found. Claude may have paraphrased instead of copying verbatim.")

            preview_find = find_text[:150] + "..." if len(find_text) > 150 else find_text
            preview_replace = replace_text[:150] + "..." if len(replace_text) > 150 else replace_text

            with open(STAGED_CODE_FILE, "w") as f:
                json.dump({"instruction": user_message, "find": find_text, "replace": replace_text, "sha": current_sha}, f)

            msg = (
                f"🛠️ *Surgical Patch Staged!*\n\n"
                f"*Change:* {user_message[:80]}\n\n"
                f"*Removing:*\n`{preview_find}`\n\n"
                f"*Replacing with:*\n`{preview_replace}`\n\n"
                f"Reply *'Approve'* to push or *'Cancel'* to discard."
            )
            await log_chat_message("assistant", msg)
            await loop.run_in_executor(None, lambda: send_whatsapp(msg))
            return Response(content="<Response></Response>", media_type="text/xml")

        except Exception as e:
            err = "⏳ *Claude overloaded.* Try again in a moment." if "529" in str(e) or "overloaded" in str(e).lower() else f"❌ *Patch Error:* {str(e)}"
            await log_chat_message("assistant", err)
            await loop.run_in_executor(None, lambda: send_whatsapp(err))
            return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # GENERAL CONVERSATIONAL CHAT
    # =========================================================================
    try:
        skill_level, recent_topics, _ = await get_db_state()
        relevant_context = await retrieve_relevant_context(user_message, limit=2)
        user_facts = await get_user_facts(limit=10)
        chat_history = await get_recent_chat_history(limit=6)

        context_str = "\n".join([f"- {c['content']}" for c in relevant_context])
        facts_str = "\n".join([f"- {f}" for f in user_facts])

        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL, max_tokens=800,
            system=(
                f"You are the user's Curriculum Coach and AI Architect.\n"
                f"Facts about user:\n{facts_str}\n\nContext:\n{context_str}\n\n"
                f"RULES: 2-4 sentences max. Use asterisks (*) for bold. End with one open-ended learning question."
            ),
            messages=chat_history + [{"role": "user", "content": user_message}]
        )

        ai_response = response.content[0].text.strip()
        await log_chat_message("assistant", ai_response)

        if "to *Advanced*" in ai_response:
            await update_db_skill("Advanced")
        elif "to *Foundational*" in ai_response:
            await update_db_skill("Foundational")

        await extract_and_save_facts(user_message, ai_response)

    except Exception as e:
        print(f"❌ Webhook LLM error: {e}")
        ai_response = "⚠️ Coaching engine interrupted. Check console logs."

    try:
        await loop.run_in_executor(None, lambda: send_whatsapp(ai_response))
    except Exception as e:
        print(f"❌ Twilio dispatch failed: {e}")

    return Response(content="<Response></Response>", media_type="text/xml")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("V3_updates:app", host="0.0.0.0", port=port, reload=False)

#@app.get("/clear-today")
#async def clear_today():
        #from datetime import date
        #today = date.today().isoformat()
        #async with aiosqlite.connect(DB_PATH) as db:
         #   async with db.execute("SELECT id FROM quiz_sessions WHERE date=?", (today,)) as cursor:
          #      session_ids = [row[0] for row in await cursor.fetchall()]
           # for sid in session_ids:
             #   await db.execute("DELETE FROM quiz_answers WHERE session_id=?", (sid,))
            #await db.execute("DELETE FROM quiz_sessions WHERE date=?", (today,))
            #await db.execute("DELETE FROM performance_log WHERE date=?", (today,))
           # await db.execute("DELETE FROM daily_checkins WHERE date=?", (today,))
            #await db.execute("DELETE FROM sent_history WHERE timestamp LIKE ?", (f"{today}%",))
            #await db.commit()
        #return {"status": f"All data for {today} cleared successfully"}