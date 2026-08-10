"""
routers/protocol_sovereign.py — APIRouter for JARVIS Protocol Sovereign (Life OS & Self-Mastery Suite).

Pillars:
1. Mind Shield & Clarity (Overthinking breaker, Nightly Stoic Brain-Dump, Solo Decision Ledger)
2. Social Gravitas & Boundaries ("The Mirror" post-interaction power debrief, Anti-Apology converter, Script vault)
3. Monk Protocol & Physical Armor (Encrypted Dopamine / No-Porn streak tracker, Capsule wardrobe, Grooming checklist, 4-day strength split)
4. 90-Day Obsession & Sovereign Runway (Deep work craft incubator, sovereign cash runway tracker)
"""

import os
import json
import httpx
from datetime import datetime, timezone, timedelta
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
import db_compat as aiosqlite

DB_PATH = os.getenv("DB_PATH", "agent_memory.db")

router = APIRouter(prefix="/api/protocol", tags=["Protocol Sovereign"])


# ─────────────────────────────────────────────────────────────
# DATABASE INITIALIZATION
# ─────────────────────────────────────────────────────────────

async def init_protocol_tables():
    async with aiosqlite.connect(DB_PATH) as db:
        # Streaks Table
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_streaks (
                habit_key TEXT PRIMARY KEY,
                title TEXT NOT NULL,
                category TEXT NOT NULL,
                current_streak INTEGER DEFAULT 0,
                best_streak INTEGER DEFAULT 0,
                last_logged_date TEXT,
                history_json TEXT
            )
        """)

        # Nightly Clarity & Brain Dump Logs
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_clarity_logs (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                raw_thoughts TEXT,
                trigger_cause TEXT,
                stoic_reframe TEXT,
                tomorrow_action TEXT,
                action_completed INTEGER DEFAULT 0,
                created_at TEXT
            )
        """)

        # Solo Decision Ledger (Micro-Sovereignty)
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_solo_decisions (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                decision_text TEXT NOT NULL,
                category TEXT,
                felt_discomfort INTEGER DEFAULT 0,
                outcome_notes TEXT,
                created_at TEXT
            )
        """)

        # The Mirror: Social Calibration & Interaction Power Debrief
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_mirror_debriefs (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                interaction_title TEXT NOT NULL,
                context TEXT,
                what_happened TEXT NOT NULL,
                boundary_score INTEGER,
                power_leaks TEXT,
                high_status_reframe TEXT,
                future_script TEXT,
                created_at TEXT
            )
        """)

        # Grooming & Style Checkpoints
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_grooming_tasks (
                id INTEGER PRIMARY KEY,
                task_name TEXT NOT NULL,
                category TEXT NOT NULL,
                frequency_days INTEGER DEFAULT 7,
                last_completed_date TEXT,
                notes TEXT
            )
        """)

        # 4-Day Strength Workout Logs
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_workouts (
                id INTEGER PRIMARY KEY,
                date TEXT NOT NULL,
                workout_split TEXT NOT NULL,
                exercises_json TEXT,
                energy_rating INTEGER,
                notes TEXT,
                created_at TEXT
            )
        """)

        # 90-Day Obsession Deep Work
        await db.execute("""
            CREATE TABLE IF NOT EXISTS protocol_obsession (
                id INTEGER PRIMARY KEY,
                craft_title TEXT NOT NULL,
                description TEXT,
                start_date TEXT,
                target_date TEXT,
                total_deep_mins INTEGER DEFAULT 0,
                milestones_json TEXT,
                is_active INTEGER DEFAULT 1
            )
        """)

        await db.commit()

        # Seed default streaks if empty
        cur = await db.execute("SELECT COUNT(*) FROM protocol_streaks")
        count = (await cur.fetchone())[0]
        if count == 0:
            default_streaks = [
                ("no_porn", "Dopamine Purity (No Porn / No Fap)", "monk", 0, 0, None, "[]"),
                ("heavy_training", "Daily Physical Training / Heavy Compound", "physical", 0, 0, None, "[]"),
                ("zero_apology", "Zero Unnecessary Apologies", "social", 0, 0, None, "[]"),
                ("deep_work_60", "60-Min Obsession Deep Work", "mission", 0, 0, None, "[]"),
                ("grooming_standards", "Visual Armor & Daily Grooming", "physical", 0, 0, None, "[]")
            ]
            for s in default_streaks:
                await db.execute("""
                    INSERT INTO protocol_streaks (habit_key, title, category, current_streak, best_streak, last_logged_date, history_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, s)

        # Seed default grooming tasks if empty
        cur = await db.execute("SELECT COUNT(*) FROM protocol_grooming_tasks")
        g_count = (await cur.fetchone())[0]
        if g_count == 0:
            default_grooming = [
                ("Sharp Haircut & Fade Refresh", "Hair", 14, None, "Keep sides crisp and neckline clean"),
                ("Beard Lineup & Shaping", "Beard", 4, None, "Clean cheek lines and neck taper"),
                ("Skincare Routine (Cleanse + Moisturize + SPF)", "Skin", 1, None, "Every morning & before bed"),
                ("Capsule Wardrobe Ironing & Shoe Polish", "Wardrobe", 7, None, "Inspect fits, press collars, clean sneakers/boots"),
                ("Nails & Eyebrow Cleanup", "Details", 7, None, "Trimmed, clean, professional presentation")
            ]
            for g in default_grooming:
                await db.execute("""
                    INSERT INTO protocol_grooming_tasks (task_name, category, frequency_days, last_completed_date, notes)
                    VALUES (?, ?, ?, ?, ?)
                """, g)

        # Seed default 90-Day Obsession if empty
        cur = await db.execute("SELECT COUNT(*) FROM protocol_obsession")
        o_count = (await cur.fetchone())[0]
        if o_count == 0:
            now_iso = datetime.now(timezone.utc).date().isoformat()
            target_iso = (datetime.now(timezone.utc) + timedelta(days=90)).date().isoformat()
            milestones = json.dumps([
                {"id": 1, "title": "Foundation & Core Architecture Mastery", "completed": False},
                {"id": 2, "title": "Build 3 Production High-Leverage Systems", "completed": False},
                {"id": 3, "title": "Monetize & Scale Sovereign Cashflow", "completed": False}
            ])
            await db.execute("""
                INSERT INTO protocol_obsession (craft_title, description, start_date, target_date, total_deep_mins, milestones_json, is_active)
                VALUES (?, ?, ?, ?, 0, ?, 1)
            """, ("Full-Stack AI Systems & Algorithmic Automation", "Mastering high-leverage software architecture and AI automation to generate sovereign income.", now_iso, target_iso, milestones))

        await db.commit()


# ─────────────────────────────────────────────────────────────
# LLM HELPER WITH MULTI-PROVIDER FALLBACKS
# ─────────────────────────────────────────────────────────────

async def call_protocol_llm(system_prompt: str, user_prompt: str, temperature: float = 0.5) -> str:
    """Multi-tiered LLM invocation for high-status stoic coaching & clarity."""
    groq_key = os.getenv("GROQ_API_KEY", "")
    gemini_key = os.getenv("GEMINI_API_KEY", "")
    openrouter_key = os.getenv("OPENROUTER_API_KEY", "")

    # 1. Groq (Fastest)
    if groq_key:
        try:
            async with httpx.AsyncClient(timeout=12.0) as client:
                res = await client.post(
                    "https://api.groq.com/openai/v1/chat/completions",
                    headers={"Authorization": f"Bearer {groq_key}", "Content-Type": "application/json"},
                    json={
                        "model": "llama-3.3-70b-versatile",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": temperature,
                        "max_tokens": 1000
                    }
                )
                if res.status_code == 200:
                    data = res.json()
                    return data["choices"][0]["message"]["content"].strip()
        except Exception:
            pass

    # 2. Gemini fallback
    if gemini_key:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
                payload = {
                    "systemInstruction": {"parts": [{"text": system_prompt}]},
                    "contents": [{"parts": [{"text": user_prompt}]}],
                    "generationConfig": {"temperature": temperature, "maxOutputTokens": 1000}
                }
                res = await client.post(url, json=payload)
                if res.status_code == 200:
                    data = res.json()
                    return data["candidates"][0]["content"]["parts"][0]["text"].strip()
        except Exception:
            pass

    # 3. OpenRouter fallback
    if openrouter_key:
        try:
            async with httpx.AsyncClient(timeout=15.0) as client:
                res = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openrouter_key}", "Content-Type": "application/json"},
                    json={
                        "model": "moonshotai/kimi-k3",
                        "messages": [
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": user_prompt}
                        ],
                        "temperature": temperature
                    }
                )
                if res.status_code == 200:
                    data = res.json()
                    return data["choices"][0]["message"]["content"].strip()
        except Exception:
            pass

    return "Focus on what is within your absolute control. Eliminate emotional noise and execute with cold precision."


# ─────────────────────────────────────────────────────────────
# 1. COCKPIT SUMMARY ENDPOINT
# ─────────────────────────────────────────────────────────────

@router.get("/cockpit")
async def get_protocol_cockpit():
    await init_protocol_tables()
    today_iso = datetime.now(timezone.utc).date().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row

        # Streaks
        cur = await db.execute("SELECT * FROM protocol_streaks")
        streaks = [dict(r) for r in await cur.fetchall()]

        # Solo Decisions count
        cur = await db.execute("SELECT COUNT(*) FROM protocol_solo_decisions")
        decisions_count = (await cur.fetchone())[0]

        # Clarity log today
        cur = await db.execute("SELECT * FROM protocol_clarity_logs WHERE date = ?", (today_iso,))
        today_clarity = await cur.fetchone()
        today_clarity_dict = dict(today_clarity) if today_clarity else None

        # Grooming pending count
        cur = await db.execute("SELECT * FROM protocol_grooming_tasks")
        grooming_tasks = [dict(r) for r in await cur.fetchall()]

        # Obsession stats
        cur = await db.execute("SELECT * FROM protocol_obsession WHERE is_active = 1 LIMIT 1")
        obsession = await cur.fetchone()
        obsession_dict = dict(obsession) if obsession else None

    # Calculate Self-Trust Score (0-100)
    avg_streak = sum(s["current_streak"] for s in streaks) / max(len(streaks), 1)
    base_score = min(50, int(avg_streak * 7))
    decision_bonus = min(30, decisions_count * 3)
    clarity_bonus = 20 if today_clarity_dict else 0
    self_trust_score = min(100, base_score + decision_bonus + clarity_bonus)

    return JSONResponse({
        "ok": True,
        "self_trust_score": self_trust_score,
        "streaks": streaks,
        "today_clarity": today_clarity_dict,
        "grooming_tasks": grooming_tasks,
        "obsession": obsession_dict,
        "decisions_count": decisions_count,
        "today_date": today_iso
    })


# ─────────────────────────────────────────────────────────────
# 2. STREAKS & MONK MODE
# ─────────────────────────────────────────────────────────────

@router.get("/streaks")
async def get_streaks():
    await init_protocol_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_streaks")
        rows = await cur.fetchall()
        return JSONResponse({"ok": True, "streaks": [dict(r) for r in rows]})


@router.post("/streaks/{habit_key}/checkin")
async def streak_checkin(habit_key: str):
    await init_protocol_tables()
    today_iso = datetime.now(timezone.utc).date().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_streaks WHERE habit_key = ?", (habit_key,))
        row = await cur.fetchone()
        if not row:
            return JSONResponse({"ok": False, "error": "Habit not found"}, status_code=404)

        current = row["current_streak"]
        best = row["best_streak"]
        last_logged = row["last_logged_date"]
        history = json.loads(row["history_json"] or "[]")

        if last_logged == today_iso:
            return JSONResponse({"ok": True, "message": "Already checked in today", "current_streak": current})

        new_streak = current + 1
        new_best = max(best, new_streak)
        history.append({"date": today_iso, "type": "checkin"})
        history = history[-60:]

        await db.execute("""
            UPDATE protocol_streaks
            SET current_streak = ?, best_streak = ?, last_logged_date = ?, history_json = ?
            WHERE habit_key = ?
        """, (new_streak, new_best, today_iso, json.dumps(history), habit_key))
        await db.commit()

    return JSONResponse({"ok": True, "current_streak": new_streak, "best_streak": new_best, "message": "Streak incremented! Keep the shield up."})


@router.post("/streaks/{habit_key}/reset")
async def streak_reset(habit_key: str, req: Request):
    await init_protocol_tables()
    try:
        body = await req.json()
    except Exception:
        body = {}
    reason = body.get("reason", "Slip-up / Reset")
    today_iso = datetime.now(timezone.utc).date().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_streaks WHERE habit_key = ?", (habit_key,))
        row = await cur.fetchone()
        if not row:
            return JSONResponse({"ok": False, "error": "Habit not found"}, status_code=404)

        history = json.loads(row["history_json"] or "[]")
        history.append({"date": today_iso, "type": "reset", "reason": reason})
        history = history[-60:]

        await db.execute("""
            UPDATE protocol_streaks
            SET current_streak = 0, last_logged_date = ?, history_json = ?
            WHERE habit_key = ?
        """, (today_iso, json.dumps(history), habit_key))
        await db.commit()

    return JSONResponse({"ok": True, "current_streak": 0, "message": "Reset logged. Stoic law: Never allow one mistake to become a pattern. Re-engage immediately."})


# ─────────────────────────────────────────────────────────────
# 3. NIGHTLY CLARITY & BRAIN DUMP ENGINE
# ─────────────────────────────────────────────────────────────

@router.post("/clarity")
async def submit_clarity_brain_dump(req: Request):
    await init_protocol_tables()
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid payload"}, status_code=400)

    raw_thoughts = body.get("raw_thoughts", "").strip()
    trigger_cause = body.get("trigger_cause", "").strip()
    if not raw_thoughts:
        return JSONResponse({"ok": False, "error": "Thoughts cannot be empty"}, status_code=400)

    system_prompt = """You are JARVIS operating as a calm, penetrating Stoic Advisor and clarity strategist.
The user is brain-dumping raw thoughts, anxiety, or overthinking.
Your task:
1. Reframe their chaos into cold, objective Stoic clarity (2-3 razor-sharp sentences). Separate what is within their control from what is outside.
2. Extract THE ONE non-negotiable, concrete physical action they must execute tomorrow to move forward.

Return ONLY a valid JSON object matching this exact format:
{
  "stoic_reframe": "...",
  "tomorrow_action": "..."
}"""

    user_prompt = f"TRIGGER / THEME: {trigger_cause}\nRAW THOUGHTS: {raw_thoughts}"

    llm_resp = await call_protocol_llm(system_prompt, user_prompt, temperature=0.3)
    try:
        clean_json = llm_resp.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(clean_json)
        reframe = parsed.get("stoic_reframe", "Focus entirely on your immediate execution. Discard opinions and uncontrollable outcomes.")
        action = parsed.get("tomorrow_action", "Execute 60 minutes of uninterrupted craft work first thing in the morning.")
    except Exception:
        reframe = "Everything disturbing your mind exists only in your judgment of it. Master your response."
        action = "Complete your primary priority tomorrow before checking messages."

    today_iso = datetime.now(timezone.utc).date().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO protocol_clarity_logs
            (date, raw_thoughts, trigger_cause, stoic_reframe, tomorrow_action, action_completed, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?)
        """, (today_iso, raw_thoughts, trigger_cause, reframe, action, now_iso))
        await db.commit()

    return JSONResponse({
        "ok": True,
        "stoic_reframe": reframe,
        "tomorrow_action": action,
        "message": "Brain-dump deconstructed. Mental clarity restored."
    })


@router.get("/clarity/history")
async def get_clarity_history():
    await init_protocol_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_clarity_logs ORDER BY id DESC LIMIT 30")
        rows = await cur.fetchall()
        return JSONResponse({"ok": True, "history": [dict(r) for r in rows]})


# ─────────────────────────────────────────────────────────────
# 4. "THE MIRROR" SOCIAL CALIBRATION & INTERACTION DEBRIEF
# ─────────────────────────────────────────────────────────────

@router.post("/mirror/analyze")
async def analyze_social_interaction(req: Request):
    await init_protocol_tables()
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid payload"}, status_code=400)

    title = body.get("title", "Interaction").strip()
    context = body.get("context", "").strip()
    what_happened = body.get("what_happened", "").strip()

    if not what_happened:
        return JSONResponse({"ok": False, "error": "Interaction details are required"}, status_code=400)

    system_prompt = """You are JARVIS Social Calibration & High-Status Coach.
Analyze this real-world interaction where the user may have over-apologized, acted too available, struggled to say No, or leaked authority.

Provide:
1. "boundary_score" (1 to 100, where 100 is sovereign boundary mastery).
2. "power_leaks": Bullet list of 2-3 specific places they surrendered status, over-explained, or apologized.
3. "high_status_reframe": How a truly confident, grounded man sees this situation.
4. "future_script": The exact high-status, unapologetic script they should use next time.

Return ONLY a valid JSON object:
{
  "boundary_score": 65,
  "power_leaks": ["Apologized for responding 2 hours later", "Over-explained reasons instead of a clean No"],
  "high_status_reframe": "Your time is valuable. You do not owe immediate justification to anyone.",
  "future_script": "I won't be able to take this on right now. Let's revisit next month if timing aligns."
}"""

    user_prompt = f"TITLE: {title}\nCONTEXT: {context}\nWHAT HAPPENED:\n{what_happened}"

    llm_resp = await call_protocol_llm(system_prompt, user_prompt, temperature=0.4)
    try:
        clean_json = llm_resp.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(clean_json)
    except Exception:
        parsed = {
            "boundary_score": 70,
            "power_leaks": ["Justified personal decision unnecessarily", "Reflexive apology used"],
            "high_status_reframe": "State your boundaries without apology. Calm brevity conveys authority.",
            "future_script": "That won't work for my schedule. I'll reach out when my calendar opens up."
        }

    now_iso = datetime.now(timezone.utc).isoformat()
    today_iso = datetime.now(timezone.utc).date().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO protocol_mirror_debriefs
            (date, interaction_title, context, what_happened, boundary_score, power_leaks, high_status_reframe, future_script, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            today_iso,
            title,
            context,
            what_happened,
            parsed.get("boundary_score", 70),
            json.dumps(parsed.get("power_leaks", [])),
            parsed.get("high_status_reframe", ""),
            parsed.get("future_script", ""),
            now_iso
        ))
        await db.commit()

    return JSONResponse({"ok": True, "analysis": parsed})


# ─────────────────────────────────────────────────────────────
# 5. ANTI-APOLOGY & GRATITUDE CONVERTER
# ─────────────────────────────────────────────────────────────

@router.post("/anti-apology")
async def convert_apology(req: Request):
    try:
        body = await req.json()
    except Exception:
        body = {}
    apology_text = body.get("text", "").strip()
    if not apology_text:
        return JSONResponse({"ok": False, "error": "Text is required"}, status_code=400)

    system_prompt = """You are JARVIS High-Status Communication Copilot.
Convert the user's weak, apologetic, or people-pleasing draft into 3 high-status assertive variations:
1. "Gratitude Reframe" (replaces 'sorry' with 'thank you')
2. "Direct & Assertive" (crisp, confident, zero fluff)
3. "Executive Diplomatic" (polite but completely firm)

Return ONLY a valid JSON object:
{
  "gratitude_reframe": "...",
  "direct_assertive": "...",
  "executive_diplomatic": "..."
}"""

    llm_resp = await call_protocol_llm(system_prompt, f"WEAK DRAFT:\n{apology_text}", temperature=0.3)
    try:
        clean_json = llm_resp.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(clean_json)
    except Exception:
        parsed = {
            "gratitude_reframe": "Thank you for your patience while I reviewed this.",
            "direct_assertive": "I won't be able to accommodate this request.",
            "executive_diplomatic": "Thank you for thinking of me. My current commitments prevent me from participating."
        }

    return JSONResponse({"ok": True, "conversions": parsed})


# ─────────────────────────────────────────────────────────────
# 6. SOLO DECISION LEDGER (MICRO-SOVEREIGNTY)
# ─────────────────────────────────────────────────────────────

@router.get("/decisions")
async def get_solo_decisions():
    await init_protocol_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_solo_decisions ORDER BY id DESC LIMIT 50")
        rows = await cur.fetchall()
        return JSONResponse({"ok": True, "decisions": [dict(r) for r in rows]})


@router.post("/decisions")
async def add_solo_decision(req: Request):
    await init_protocol_tables()
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid payload"}, status_code=400)

    decision_text = body.get("decision_text", "").strip()
    category = body.get("category", "General").strip()
    felt_discomfort = 1 if body.get("felt_discomfort") else 0
    outcome_notes = body.get("outcome_notes", "").strip()

    if not decision_text:
        return JSONResponse({"ok": False, "error": "Decision text is required"}, status_code=400)

    today_iso = datetime.now(timezone.utc).date().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO protocol_solo_decisions
            (date, decision_text, category, felt_discomfort, outcome_notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (today_iso, decision_text, category, felt_discomfort, outcome_notes, now_iso))
        await db.commit()

    return JSONResponse({"ok": True, "message": "Solo decision recorded. Self-trust score strengthened."})


# ─────────────────────────────────────────────────────────────
# 7. GROOMING, WARDROBE & STRENGTH PROTOCOL
# ─────────────────────────────────────────────────────────────

@router.get("/grooming")
async def get_grooming_tasks():
    await init_protocol_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_grooming_tasks ORDER BY id ASC")
        rows = await cur.fetchall()
        return JSONResponse({"ok": True, "tasks": [dict(r) for r in rows]})


@router.post("/grooming/{task_id}/complete")
async def complete_grooming_task(task_id: int):
    await init_protocol_tables()
    today_iso = datetime.now(timezone.utc).date().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE protocol_grooming_tasks SET last_completed_date = ? WHERE id = ?", (today_iso, task_id))
        await db.commit()
    return JSONResponse({"ok": True, "message": "Grooming standard completed."})


@router.get("/workouts")
async def get_workouts():
    await init_protocol_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_workouts ORDER BY id DESC LIMIT 30")
        rows = await cur.fetchall()
        return JSONResponse({"ok": True, "workouts": [dict(r) for r in rows]})


@router.post("/workouts")
async def log_workout(req: Request):
    await init_protocol_tables()
    try:
        body = await req.json()
    except Exception:
        return JSONResponse({"ok": False, "error": "Invalid payload"}, status_code=400)

    workout_split = body.get("workout_split", "Upper Heavy").strip()
    exercises = body.get("exercises", [])
    energy_rating = int(body.get("energy_rating", 8))
    notes = body.get("notes", "").strip()

    today_iso = datetime.now(timezone.utc).date().isoformat()
    now_iso = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO protocol_workouts
            (date, workout_split, exercises_json, energy_rating, notes, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (today_iso, workout_split, json.dumps(exercises), energy_rating, notes, now_iso))

        # Also check in the heavy_training streak!
        cur = await db.execute("SELECT * FROM protocol_streaks WHERE habit_key = 'heavy_training'")
        row = await cur.fetchone()
        if row and row[5] != today_iso: # last_logged_date
            new_streak = row[3] + 1
            new_best = max(row[4], new_streak)
            await db.execute("UPDATE protocol_streaks SET current_streak = ?, best_streak = ?, last_logged_date = ? WHERE habit_key = 'heavy_training'", (new_streak, new_best, today_iso))

        await db.commit()

    return JSONResponse({"ok": True, "message": "Physical strength session logged! Neural drive reinforced."})


# ─────────────────────────────────────────────────────────────
# 8. 90-DAY OBSESSION INCUBATOR
# ─────────────────────────────────────────────────────────────

@router.get("/obsession")
async def get_obsession_data():
    await init_protocol_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM protocol_obsession WHERE is_active = 1 LIMIT 1")
        row = await cur.fetchone()
        return JSONResponse({"ok": True, "obsession": dict(row) if row else None})


@router.post("/obsession/log-session")
async def log_obsession_session(req: Request):
    await init_protocol_tables()
    try:
        body = await req.json()
    except Exception:
        body = {}
    mins = int(body.get("minutes", 60))
    today_iso = datetime.now(timezone.utc).date().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT id, total_deep_mins FROM protocol_obsession WHERE is_active = 1 LIMIT 1")
        row = await cur.fetchone()
        if row:
            new_mins = row["total_deep_mins"] + mins
            await db.execute("UPDATE protocol_obsession SET total_deep_mins = ? WHERE id = ?", (new_mins, row["id"]))

        # Check in deep_work_60 streak
        cur = await db.execute("SELECT * FROM protocol_streaks WHERE habit_key = 'deep_work_60'")
        s_row = await cur.fetchone()
        if s_row and s_row["last_logged_date"] != today_iso:
            ns = s_row["current_streak"] + 1
            nb = max(s_row["best_streak"], ns)
            await db.execute("UPDATE protocol_streaks SET current_streak = ?, best_streak = ?, last_logged_date = ? WHERE habit_key = 'deep_work_60'", (ns, nb, today_iso))

        await db.commit()

    return JSONResponse({"ok": True, "total_deep_mins": new_mins if row else mins, "message": f"Logged {mins} mins of pure craft obsession."})


# ─────────────────────────────────────────────────────────────
# 9. CURATED BOUNDARY SCRIPT VAULT
# ─────────────────────────────────────────────────────────────

BOUNDARY_SCRIPTS = [
    {
        "category": "Saying No to Demands",
        "title": "Declining Extra Work / Unreasonable Requests",
        "script": "I won't be able to take that on right now given my current priorities. If the scope shifts later, I will let you know.",
        "context": "Use when asked to do work outside your role or when already at capacity."
    },
    {
        "category": "Saying No to Demands",
        "title": "Declining Social Invitations Firmly",
        "script": "Thank you for the invite, but I won't be able to make it. Have a great time!",
        "context": "Notice zero excuses or over-explaining. A simple, warm, unmovable boundary."
    },
    {
        "category": "Anti-Apology Reflexes",
        "title": "Replacing 'Sorry for the Delay'",
        "script": "Thank you for your patience while I gave this the focus it needed.",
        "context": "Elevates your status and frames your time as deliberate rather than negligent."
    },
    {
        "category": "Anti-Apology Reflexes",
        "title": "Replacing 'Sorry, can I ask a question?'",
        "script": "Quick question on this: [Your question].",
        "context": "Removes unnecessary submissiveness from professional communication."
    },
    {
        "category": "Handling Pressure & Over-Availability",
        "title": "Delaying Immediate Responses (Availability Gate)",
        "script": "Received. I am currently in deep work and will review this by 4:00 PM today.",
        "context": "Trains people that you are focused on high-value missions, not on-demand standby."
    },
    {
        "category": "Handling Pressure & Over-Availability",
        "title": "Addressing Disrespect / Interruption Calmly",
        "script": "Please let me finish my thought, then I would be glad to hear your perspective.",
        "context": "Neutral, unbreakable vocal tone. Stops steamrolling immediately."
    }
]

@router.get("/scripts")
async def get_boundary_scripts():
    return JSONResponse({"ok": True, "scripts": BOUNDARY_SCRIPTS})
