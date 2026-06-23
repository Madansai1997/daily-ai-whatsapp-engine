import os
import sqlite3
import aiosqlite
import asyncio
import json
import random
import requests
import subprocess
import re
import base64
import datetime as dt
from datetime import date
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from bs4 import BeautifulSoup
from fastapi import FastAPI, Response, Form, Request
from fastapi.responses import JSONResponse, HTMLResponse
from twilio.rest import Client
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from openai import AsyncOpenAI

load_dotenv()

from rag_engine import retrieve_relevant_context, search_user_facts
from email_triage import (
    init_email_tables,
    check_inbox_and_notify,
    get_active_draft,
    activate_next_draft,
    delete_draft,
    count_pending_drafts,
    get_medium_count,
    get_low_count,
    approve_draft,
    edit_draft,
    save_composed_draft,
    get_latest_composed_draft,
    cancel_composed_draft,
    send_composed_email,
    create_gmail_draft,
)
from reminders import (
    init_reminder_tables,
    register_all_active_reminders,
    create_reminder_from_intent,
    get_active_reminders,
)
try:
    from weather_agent import get_weather, get_weather_brief
except Exception as e:
    print(f"❌ weather_agent import failed: {e}")
    async def get_weather(call_llm_fn=None):
        return "⚠️ Weather agent not available."
    async def get_weather_brief():
        return "Weather unavailable"

# Core Credentials
TWILIO_SID = os.getenv("TWILIO_SID")
TWILIO_TOKEN = os.getenv("TWILIO_TOKEN")
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


OPENROUTER_MODEL = "openai/gpt-oss-120b:free"
OPENROUTER_MODEL_FAST = "openai/gpt-oss-120b:free"

FREE_MODELS = [
    "openai/gpt-oss-120b:free",                 # GPT OSS — currently the most reliable free tier
    "meta-llama/llama-4-maverick:free",         # Llama 4 — reliable backup
    "nvidia/nemotron-3-super-120b-a12b:free",   # Nemotron Super — best for agents, but daily free quota exhausts fast
    "google/gemma-4-31b-it:free",               # Gemma 4 — highest quality score, tight per-min rate limit
    # "nvidia/nemotron-3-ultra:free" removed — not a valid OpenRouter model ID, always 400s
]

MEMORY_INTENT_PROMPT = (
    "Classify the user's message into exactly one intent. The message is preceded by the current date/time "
    "(Asia/Kolkata) for resolving relative dates. Respond with STRICT JSON only, no markdown, no commentary, "
    "matching exactly this shape:\n"
    '{"intent": "SAVE_FACT" or "RECALL_FACT" or "SET_REMINDER" or "LIST_REMINDERS" or "COMPOSE_EMAIL" or "OTHER", '
    '"content": "string" or null, '
    '"reminder": {"text": "string", "kind": "once" or "daily" or "weekly", "run_at": "ISO 8601 datetime" or null, '
    '"hour": 0-23 or null, "minute": 0-59 or null, "day_of_week": "mon"/"tue"/"wed"/"thu"/"fri"/"sat"/"sun" or null} '
    "or null, "
    '"email": {"to": "recipient email address or empty string", "subject": "email subject line", '
    '"body": "full professional email body text", "save_as_draft": true or false} or null}\n'
    "Use SAVE_FACT when the user is asking you to remember/note/save a fact about themselves or their plans "
    '(e.g. "remember that my exam is in August", "note that I prefer Python"). content = the fact itself, '
    "cleaned up as a standalone statement. reminder = null.\n"
    "Use RECALL_FACT when the user is asking what you remember/know about something "
    '(e.g. "do you remember my exam date", "what do you know about my AWS plans"). content = the topic/keywords '
    "to search for. reminder = null.\n"
    "Use SET_REMINDER when the user asks to be reminded/notified about something at a specific time, or on a "
    'recurring schedule (e.g. "remind me to call mom tomorrow at 5pm", "remind me every day at 9am to drink '
    'water"). content = null. Fill reminder: kind="once" with run_at as a full ISO 8601 datetime (resolve relative '
    'phrases like "tomorrow"/"in 2 hours" against the given current date/time) for a single occurrence; '
    'kind="daily" with hour/minute for every-day reminders; kind="weekly" with day_of_week/hour/minute for a '
    "specific weekday. reminder.text = the reminder message itself.\n"
    "Use LIST_REMINDERS when the user wants to see, view, check, or be shown their current/upcoming reminders "
    '(e.g. "show me my reminders list", "what reminders do I have", "bring up my reminders", "list reminders", '
    '"hey jarvis show off the reminders") — any phrasing asking to see existing reminders, not set a new one. '
    "content = null, reminder = null, email = null.\n"
    "Use COMPOSE_EMAIL when the user wants you to write/draft/compose a brand-new outbound email — any phrasing "
    '(e.g. "draft an email to x@example.com about...", "draft me an email and put it in a draft...", "write an '
    'email to... and send it"). This is NOT for editing/sending/cancelling an email already shown to the user in '
    "this conversation — those are separate explicit commands (SEND, EDIT EMAIL:, CANCEL) and should be OTHER. "
    "Extract the recipient address; write a complete, professional email body based on the key points given (not "
    "just a one-line summary), signed 'Madan'. Set email.save_as_draft = true if the user wants it saved/put in "
    "their Gmail Drafts without sending yet (e.g. \"put it in a draft\", \"just save it\", \"don't send it\"); set "
    "it to false if they want it sent right away (e.g. \"send an email to...\", \"send it now\"). If no recipient "
    'email address is given anywhere in the request, set email.to to an empty string. content = null, reminder = '
    "null.\n"
    "Use OTHER for everything else — general conversation, questions, commands. content = null, reminder = null, "
    "email = null."
)

def get_llm_client() -> AsyncOpenAI:
    key = os.environ.get("OPENROUTER_API_KEY", "")
    if not key:
        print("⚠️ WARNING: OPENROUTER_API_KEY not set!")
    return AsyncOpenAI(
        base_url="https://openrouter.ai/api/v1",
        api_key=key or "missing",
    )

anthropic_client = get_llm_client()  # kept same name so all call sites work unchanged

async def call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1000) -> str:
    """Call LLM with automatic fallback through FREE_MODELS on rate limit or error."""
    for model in FREE_MODELS:
        try:
            response = await anthropic_client.chat.completions.create(
                model=model,
                max_tokens=max_tokens,
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": user_prompt},
                ]
            )
            return response.choices[0].message.content
        except Exception as e:
            print(f"⚠️ Model {model} failed: {e}. Trying next...")
            continue
    raise Exception("All free models failed")


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
        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    # Migration: rename old 'timestamp' column to 'saved_at' if it exists
    try:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(knowledge_store)").fetchall()]
        if 'timestamp' in cols and 'saved_at' not in cols:
            cursor.execute("ALTER TABLE knowledge_store RENAME COLUMN timestamp TO saved_at")
    except Exception:
        pass  # SQLite < 3.25 doesn't support RENAME COLUMN — handled below via recreate

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

    cursor.execute('''CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT,
        status TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS digest_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        content TEXT,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent INTEGER DEFAULT 0)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS local_command_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_type TEXT,
        payload TEXT,
        status TEXT DEFAULT 'pending',
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME)''')

    conn.commit()
    conn.close()
    print("✅ State Engine: All database tables verified and ready.")

init_db_tables()
init_email_tables()
init_reminder_tables()


# ==========================================
# USER SETTINGS HELPERS (sync, single-user)
# ==========================================
def _get_db_conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_setting(key: str, default=None):
    """Get a value from user_settings table."""
    try:
        conn = _get_db_conn()
        row = conn.execute("SELECT value FROM user_settings WHERE key = ?", (key,)).fetchone()
        conn.close()
        return row["value"] if row else default
    except Exception as e:
        print(f"⚠️ get_setting error: {e}")
        return default

def save_setting(key: str, value: str):
    """Save or update a value in user_settings table."""
    try:
        conn = _get_db_conn()
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (key, value)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ save_setting error: {e}")


# ==========================================
# LIFESPAN & SCHEDULER
# ==========================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    missing_env = []
    if not TWILIO_SID: missing_env.append("TWILIO_SID")
    if not TWILIO_TOKEN: missing_env.append("TWILIO_TOKEN")
    if not os.environ.get("OPENROUTER_API_KEY"): missing_env.append("OPENROUTER_API_KEY")

    if missing_env:
        print(f"⚠️ STARTUP WARNING: Missing: {', '.join(missing_env)}")
    else:
        print("✅ Environment Variables Verified.")

    scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")
    scheduler.add_job(run_morning_digest, "cron", hour=SCHEDULE_CONFIG["digest_hour"], minute=0)
    for r in SCHEDULE_CONFIG["reminders"]:
        scheduler.add_job(send_checkin_reminder, "cron", hour=r["hour"], minute=0, kwargs={"reminder_number": r["number"]})
    scheduler.add_job(send_weekly_report, "cron", day_of_week="sun", hour=SCHEDULE_CONFIG["weekly_report_hour"], minute=0)
    scheduler.add_job(check_inbox_and_notify, "interval", hours=1, args=[call_llm, send_whatsapp_chunked])
    scheduler.start()
    app.state.scheduler = scheduler
    restored = await register_all_active_reminders(scheduler, send_whatsapp_chunked)
    reminder_times = ", ".join([f"{r['hour']}:00" for r in SCHEDULE_CONFIG["reminders"]])
    print(f"⏰ Scheduler: Digest {SCHEDULE_CONFIG['digest_hour']}:00 | Check-ins {reminder_times} | Report Sunday {SCHEDULE_CONFIG['weekly_report_hour']}:00 | Restored {restored} reminder(s)")

    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

def _split_message(text: str, limit: int = 1500) -> list[str]:
    """Split a long string into ≤limit-char chunks at sentence boundaries."""
    if len(text) <= limit:
        return [text]
    parts = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind('. ', 0, limit)
        if cut == -1:
            cut = remaining.rfind('\n', 0, limit)
        if cut == -1:
            cut = limit
        else:
            cut += 1  # include the period
        parts.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        parts.append(remaining)
    return parts


def send_whatsapp_chunked(body: str, to_number: str = None, from_number: str = None):
    """Send a WhatsApp message, splitting into chunks if over 1500 chars."""
    import time
    MAX_CHARS = 1500
    to_number = to_number or TO_WHATSAPP
    from_number = from_number or FROM_WHATSAPP
    twilio_client = Client(TWILIO_SID, TWILIO_TOKEN)

    if len(body) <= MAX_CHARS:
        twilio_client.messages.create(body=body, from_=from_number, to=to_number)
        print(f"✅ Sent single message: {len(body)} chars")
        return

    # Split into chunks at sentence boundaries
    chunks = []
    remaining = body
    while len(remaining) > MAX_CHARS:
        split_at = remaining.rfind('. ', 0, MAX_CHARS)
        if split_at == -1:
            split_at = remaining.rfind(' ', 0, MAX_CHARS)
        if split_at == -1:
            split_at = MAX_CHARS
        chunks.append(remaining[:split_at + 1].strip())
        remaining = remaining[split_at + 1:].strip()
    if remaining:
        chunks.append(remaining)

    total = len(chunks)
    for i, chunk in enumerate(chunks, 1):
        part_label = f"\n\n({i}/{total})" if total > 1 else ""
        twilio_client.messages.create(body=chunk + part_label, from_=from_number, to=to_number)
        print(f"✅ Sent chunk {i}/{total}: {len(chunk)} chars")
        time.sleep(1)


@app.get("/")
def health_check():
    return {"status": "healthy", "message": "Engine is awake"}


@app.get("/ping")
def ping():
    return {"status": "alive", "timestamp": dt.datetime.utcnow().isoformat()}


# =========================================================================
# LOCAL COMMAND QUEUE — bridge between Render and the local_bridge.py
# process running on Madan's Mac (see local_bridge.py, bridge_setup.md)
# =========================================================================
LOCAL_QUEUE_ALLOWED_COMMANDS = [
    "list_folder", "read_file",
    "search_files", "system_info",
    "list_recent_files",
]


@app.post("/local-queue")
async def queue_local_command(request: Request):
    body = await request.json()
    command_type = body.get("command_type", "")
    payload = body.get("payload", "")

    if command_type not in LOCAL_QUEUE_ALLOWED_COMMANDS:
        return JSONResponse({
            "error": f"Command {command_type} not allowed"
        }, status_code=400)

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO local_command_queue "
            "(command_type, payload) VALUES (?, ?)",
            (command_type, payload)
        )
        command_id = cursor.lastrowid
        await db.commit()

    return JSONResponse({
        "status": "queued",
        "command_id": command_id
    })


@app.get("/local-queue/pending")
async def get_pending_commands():
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT id, command_type, payload "
            "FROM local_command_queue "
            "WHERE status='pending' "
            "ORDER BY created_at ASC LIMIT 5"
        )
        rows = await cur.fetchall()

    commands = [
        {"id": r[0], "command_type": r[1], "payload": r[2]}
        for r in rows
    ]
    return JSONResponse({"commands": commands})


@app.post("/local-queue/result")
async def post_command_result(request: Request):
    body = await request.json()
    command_id = body.get("command_id")
    result = body.get("result", "")
    status = body.get("status", "completed")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE local_command_queue "
            "SET status=?, result=?, "
            "completed_at=datetime('now') "
            "WHERE id=?",
            (status, result, command_id)
        )
        await db.commit()

    return JSONResponse({"status": "saved"})


@app.get("/local-queue/result/{command_id}")
async def get_command_result(command_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT status, result FROM local_command_queue "
            "WHERE id=?",
            (command_id,)
        )
        row = await cur.fetchone()

    if not row:
        return JSONResponse({"error": "Not found"},
                          status_code=404)
    return JSONResponse({
        "status": row[0],
        "result": row[1]
    })


@app.get("/admin", response_class=Response)
async def admin_panel():
    """Hermes control panel — overview of engine state."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='skill_level'") as c:
            row = await c.fetchone(); skill = row[0] if row else "?"
        async with db.execute("SELECT value FROM user_profile WHERE key='study_streak'") as c:
            row = await c.fetchone(); streak = row[0] if row else "0"
        async with db.execute("SELECT COUNT(*) FROM sent_history") as c:
            row = await c.fetchone(); total_concepts = row[0] if row else 0
        async with db.execute("SELECT concept, timestamp FROM sent_history ORDER BY timestamp DESC LIMIT 5") as c:
            recent = await c.fetchall()
        async with db.execute("SELECT date, quiz_score, max_score, concept FROM performance_log ORDER BY date DESC LIMIT 5") as c:
            quiz_rows = await c.fetchall()
        async with db.execute("SELECT COUNT(*) FROM review_queue WHERE completed=0") as c:
            row = await c.fetchone(); pending_reviews = row[0] if row else 0
        async with db.execute("SELECT value FROM user_profile WHERE key='override_topic'") as c:
            row = await c.fetchone(); override = row[0] if row else None
        async with db.execute("SELECT value FROM user_profile WHERE key='difficulty_preference'") as c:
            row = await c.fetchone(); diff_pref = row[0] if row else "not set"

    recent_html = "".join(f"<li>{r[0]} <small style='color:#888'>({r[1][:10]})</small></li>" for r in recent) or "<li>None yet</li>"
    quiz_html = "".join(f"<li>{r[0]}: <b>{r[1]}/{r[2]}</b> — {r[3]}</li>" for r in quiz_rows) or "<li>No quizzes yet</li>"
    override_html = f"<span style='color:#e67e22'>⚠️ Topic override active: <b>{override}</b></span>" if override else "<span style='color:#27ae60'>Auto-selection active</span>"

    html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'>
<title>Hermes Control Center</title>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<style>
  body{{font-family:system-ui,sans-serif;background:#0f1117;color:#e0e0e0;margin:0;padding:20px}}
  h1{{color:#7c3aed;margin-bottom:4px}}
  .subtitle{{color:#888;font-size:13px;margin-bottom:24px}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}}
  .card{{background:#1a1d27;border-radius:10px;padding:16px;border:1px solid #2a2d3a}}
  .card h3{{margin:0 0 8px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.5px}}
  .card .val{{font-size:28px;font-weight:700;color:#a78bfa}}
  .card .sub{{font-size:12px;color:#666;margin-top:4px}}
  .section{{background:#1a1d27;border-radius:10px;padding:16px;margin-bottom:16px;border:1px solid #2a2d3a}}
  .section h2{{margin:0 0 12px;font-size:15px;color:#c4b5fd}}
  ul{{margin:0;padding-left:18px;line-height:1.8}}
  li small{{font-size:11px}}
  .btn{{display:inline-block;padding:8px 18px;background:#7c3aed;color:#fff;border-radius:6px;
        text-decoration:none;font-size:13px;margin-right:8px;margin-top:8px}}
  .btn:hover{{background:#6d28d9}}
  .pill{{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;
         background:#2a2d3a;color:#a78bfa;margin-left:6px}}
</style></head><body>
<h1>⚡ Hermes Control Center</h1>
<div class='subtitle'>Daily AI Learning Engine — live status</div>

<div class='grid'>
  <div class='card'><h3>Skill Level</h3><div class='val'>{skill}</div><div class='sub'>current track</div></div>
  <div class='card'><h3>Study Streak</h3><div class='val'>{streak} 🔥</div><div class='sub'>days in a row</div></div>
  <div class='card'><h3>Concepts Sent</h3><div class='val'>{total_concepts}</div><div class='sub'>total digests</div></div>
  <div class='card'><h3>Pending Reviews</h3><div class='val'>{pending_reviews}</div><div class='sub'>spaced repetition queue</div></div>
</div>

<div class='section'>
  <h2>📡 Topic Control</h2>
  <p style='margin:0 0 8px'>{override_html}</p>
  <p style='margin:0;font-size:13px;color:#888'>Difficulty preference: <span class='pill'>{diff_pref}</span></p>
  <p style='margin:8px 0 0;font-size:12px;color:#555'>To override next topic, send WhatsApp: <code>set topic: &lt;topic name&gt;</code></p>
</div>

<div class='section'>
  <h2>📚 Recent Digests</h2>
  <ul>{recent_html}</ul>
</div>

<div class='section'>
  <h2>🏆 Recent Quiz Scores</h2>
  <ul>{quiz_html}</ul>
</div>

<div class='section'>
  <h2>🚀 Manual Triggers</h2>
  <a class='btn' href='/run-morning-digest' onclick="this.textContent='Running…';fetch('/run-morning-digest',{{method:'POST'}}).then(r=>r.json()).then(d=>this.textContent=d.status||'Done');return false;">▶ Run Morning Digest</a>
  <a class='btn' href='/ping' style='background:#374151'>🏓 Ping</a>
</div>
</body></html>"""
    return Response(content=html, media_type="text/html")


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
        async with db.execute("SELECT role, content FROM chat_history ORDER BY id DESC LIMIT ?", (limit,)) as cursor:
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
                    "INSERT OR IGNORE INTO knowledge_store (url, title, content, saved_at) VALUES (?, ?, ?, datetime('now'))",
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
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=300, temperature=0.0,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
        try:
            raw = text.strip() if text else ""
            if not raw:
                raise ValueError("Empty response from LLM")
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            facts = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
            facts = []  # safe fallback — list expected here
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
        import socket
        socket.setdefaulttimeout(3)
        res = requests.get(
            f"https://html.duckduckgo.com/html/?q={unified_query.replace(' ', '+')}",
            headers={"User-Agent": "Mozilla/5.0 (compatible; DailyAIBot/1.0)"}, timeout=3
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
        print(f"DuckDuckGo search failed, continuing without web results")

    if not articles:
        articles = [
            {"url": "https://openai.com/news", "title": "Scaling multi-agent frameworks", "content": "Enterprise agentic frameworks with robust assertion loops."},
            {"url": "https://github.com/blog", "title": "Agentic Infrastructure Testing", "content": "Sandboxed runtimes for continuous code quality assertion."}
        ]
    return articles


# ==========================================
# 3. CURRICULUM PLANNER AGENT
# ==========================================
FALLBACK_TOPICS = [
    {"concept": "The Feynman Technique", "pedagogical_focus": "How to learn anything deeply by teaching it simply", "assert_template": "Explain quantum entanglement as if to a 10-year-old"},
    {"concept": "Bayes Theorem", "pedagogical_focus": "How to update beliefs with new evidence", "assert_template": "If a test is 99% accurate and disease affects 1% of people, what is P(disease|positive test)?"},
    {"concept": "Asymptotic Complexity", "pedagogical_focus": "How to measure algorithm efficiency with Big O notation", "assert_template": "What is the time complexity of binary search and why?"},
    {"concept": "Supply and Demand", "pedagogical_focus": "How prices emerge from buyer and seller behaviour", "assert_template": "What happens to price when supply drops but demand stays constant?"},
    {"concept": "Cognitive Biases", "pedagogical_focus": "How confirmation bias affects decision making", "assert_template": "Give a real-world example where confirmation bias led to a bad decision"},
    {"concept": "Neural Networks", "pedagogical_focus": "How layers of weights transform inputs to outputs", "assert_template": "Draw and label a simple 3-layer neural network"},
    {"concept": "The Socratic Method", "pedagogical_focus": "How to find truth through disciplined questioning", "assert_template": "List 3 Socratic questions you would ask to challenge the claim: AI will replace all jobs"},
    {"concept": "Compounding Interest", "pedagogical_focus": "How exponential growth works with money over time", "assert_template": "Calculate the value of 10000 rupees after 10 years at 8% annual compound interest"},
    {"concept": "First Principles Thinking", "pedagogical_focus": "How to break problems down to fundamental truths", "assert_template": "Use first principles to rethink how you would design a better chair"},
    {"concept": "The Unix Philosophy", "pedagogical_focus": "Do one thing well, chain simple tools together", "assert_template": "Write a one-line bash command that counts unique words in a text file"},
]

_FALLBACK_CONCEPTS = [
    ("Transformer Architecture", "Understand self-attention, positional encoding, and the encoder-decoder structure."),
    ("RAG Pipelines", "Build retrieval-augmented generation systems with vector stores and re-rankers."),
    ("Fine-tuning LLMs", "Apply LoRA and QLoRA to adapt large language models to specific tasks."),
    ("Vector Databases", "Index and query high-dimensional embeddings with FAISS, Pinecone, or Chroma."),
    ("Multi-Agent Systems", "Design systems where multiple AI agents collaborate, hand off tasks, and share state."),
    ("LLM Evaluation & Evals", "Measure LLM output quality with automated metrics, human eval, and benchmark suites."),
    ("MLOps Fundamentals", "Automate model training, versioning, deployment, and monitoring pipelines."),
    ("Prompt Engineering", "Master few-shot prompting, chain-of-thought, and structured output techniques."),
    ("Reinforcement Learning from Human Feedback", "Understand RLHF, reward modelling, and PPO as used in LLM alignment."),
    ("Neural Network Fundamentals", "Backpropagation, gradient descent, activation functions, and regularisation."),
    ("Data Pipelines & Feature Stores", "Build reliable data ingestion and feature engineering pipelines for ML."),
    ("Diffusion Models", "Learn the math and implementation of DDPM and score-based generative models."),
    ("Attention Mechanisms", "Deep-dive into multi-head attention, cross-attention, and Flash Attention."),
    ("Model Quantisation & Compression", "Reduce model size with INT8/INT4 quantisation, pruning, and distillation."),
    ("Computer Vision with CNNs", "Build and train convolutional networks for image classification and detection."),
]

def extract_json_from_response(response: str):
    """Extract JSON from model response even if surrounded by reasoning text."""
    if not response or not response.strip():
        return {}

    raw = response.strip()

    # Try 1: direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try 2: strip markdown fences
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                return json.loads(part)
            except json.JSONDecodeError:
                continue

    # Try 3: find first { and last } and extract just that
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end+1])
        except json.JSONDecodeError:
            pass

    # Try 4: find first [ and last ] for list responses
    start = raw.find('[')
    end = raw.rfind(']')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end+1])
        except json.JSONDecodeError:
            pass

    # Try 5: response was truncated mid-JSON — attempt to repair it
    if start != -1:
        fragment = raw[start:]
        # Count open vs close braces to detect truncation
        open_count = fragment.count('{')
        close_count = fragment.count('}')
        if open_count > close_count:
            # Add missing closing braces
            fragment = fragment + ('}' * (open_count - close_count))
            try:
                return json.loads(fragment)
            except json.JSONDecodeError:
                # Try trimming to last complete key-value pair
                last_comma = fragment.rfind(',')
                last_quote = fragment.rfind('"')
                trim_at = max(last_comma, last_quote)
                if trim_at > start:
                    try:
                        repaired = fragment[:trim_at] + "}"
                        return json.loads(repaired)
                    except json.JSONDecodeError:
                        pass

    print(f"⚠️ JSON extract failed. Raw: {repr(raw[:300])}")
    return {}


async def run_curriculum_planner(skill_level, history_concepts):
    print("📋 [Curriculum Planner]: Selecting today's concept...")

    # Check for manual topic override set via WhatsApp "set topic: ..."
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='override_topic'") as cursor:
            row = await cursor.fetchone()
    if row:
        override = row[0].strip()
        # Consume the override — one-shot, cleared after use
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM user_profile WHERE key='override_topic'")
            await db.commit()
        print(f"🎯 Using manual topic override: '{override}'")
        return {
            "concept": override,
            "pedagogical_focus": f"Deep dive into {override} with practical implementation.",
            "assert_template": "Write assertions that verify the core behaviour of the implementation."
        }

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

    exclusions = history_concepts

    current_topic = get_setting("topic", "")
    domain_display = get_setting("domain_display", "general knowledge")

    system_prompt = """You are a curriculum planner for a curious learner.
You can suggest concepts from ANY field of knowledge — not just technology.
Return only valid JSON. No thinking. No explanation. No markdown. No preamble.
Your entire response must be valid JSON starting with { and ending with }."""

    user_prompt = f"""Output JSON for a {skill_level} student.
Domain: {domain_display}.
Topic focus: {current_topic if current_topic else 'pick an interesting concept from ' + domain_display}.
Previously covered: {exclusions if exclusions else 'none'}.
Do not repeat previous topics.
OUTPUT ONLY THIS JSON, NOTHING ELSE:
{{"concept": "FILL IN", "pedagogical_focus": "FILL IN one sentence", "assert_template": "FILL IN a simple exercise"}}"""

    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=500, temperature=0.4,
            extra_body={"thinking": False},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        text = response.choices[0].message.content.strip()
        data = extract_json_from_response(text)
        if not data:
            data = random.choice(FALLBACK_TOPICS)
            print("📋 [Planner fallback]: Using random fallback topic")
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

You MUST respond with ONLY valid JSON. No explanation, no markdown, no code fences, no preamble.
Start your response with {{ and end with }}. If you cannot generate the content, return this exact JSON:
{{"topic": "LLM Architecture", "subtopic": "Transformers", "difficulty": "intermediate"}}

Return a JSON object with keys "project_title" and "subtasks" (array of 7 objects each with "day", "title", "description").
"""
    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=1500, temperature=0.3,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.choices[0].message.content.strip()
        project_data = extract_json_from_response(text)
        if not project_data:
            project_data = {
                "project_title": "Build a simple token counter that tracks API usage",
                "subtasks": [
                    {"day": i, "title": step, "description": step}
                    for i, step in enumerate([
                        "Set up a counter variable",
                        "Log each API call",
                        "Display total at end of day",
                        "Add persistence to SQLite",
                        "Build a summary report",
                        "Add alerting on high usage",
                        "Write tests for the counter",
                    ], start=1)
                ]
            }
            print("⚠️ [Project fallback]: Using default project")

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
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=600, temperature=0.0,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
        try:
            raw = text.strip() if text else ""
            if not raw:
                raise ValueError("Empty response from LLM")
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
            result = {}
        if not result:
            result = {"scores": [], "average_score": 5.0, "verdict": "PASS", "feedback": "Scorer unavailable."}
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
    import math, json as jmod, re as rmod, collections, itertools, functools
    clean = _sanitize_reference_code(code)
    full_code = clean + "\n\n" + "\n".join(assert_lines)
    sandbox_globals = {
        "math": math, "json": jmod, "re": rmod,
        "collections": collections, "itertools": itertools, "functools": functools,
        "__name__": "__main__",
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
def _sanitize_reference_code(code: str) -> str:
    """Strip constructs that break sandbox exec: __name__ guards, markdown fences,
    shebang lines, and bare ellipsis stubs that cause SyntaxError under exec."""
    import re as _re
    # Remove markdown code fences if Claude leaked them
    code = _re.sub(r'^```[a-zA-Z]*\s*', '', code, flags=_re.MULTILINE)
    code = _re.sub(r'^```\s*$', '', code, flags=_re.MULTILINE)
    # Remove `if __name__ == "__main__":` blocks entirely — they break exec()
    # because __name__ is undefined in a plain sandbox globals dict
    code = _re.sub(r'if\s+__name__\s*==\s*["\']__main__["\']\s*:.*', '', code, flags=_re.DOTALL)
    # Replace bare `...` stub bodies with `pass` so syntax is valid
    code = _re.sub(r'(def\s+\w+[^:]+:)\s*\n(\s+)\.\.\.\s*\n', r'\1\n\2pass\n', code)
    return code.strip()


def run_code_sandbox(reference_code: str, assert_lines: list) -> tuple[bool, str]:
    print("🧪 [Sandbox]: Verifying assertions...")
    import math, json as jmod, re as rmod, collections, itertools, functools
    # Sanitize before compiling — removes __name__ guards and markdown leaks
    clean_code = _sanitize_reference_code(reference_code)
    # Validate syntax before attempting exec so we get a clear error message
    try:
        compile(clean_code, "<reference>", "exec")
    except SyntaxError as e:
        return False, f"SyntaxError in reference_code line {e.lineno}: {e.msg}"

    full_code = clean_code + "\n\n" + "\n".join(assert_lines)
    sandbox_globals = {
        # Standard modules Claude commonly uses in implementations
        "math": math, "json": jmod, "re": rmod,
        "collections": collections, "itertools": itertools, "functools": functools,
        # __name__ so `if __name__ == "__main__":` guards don't NameError if any survive
        "__name__": "__main__",
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool,
            "chr": chr, "dict": dict, "divmod": divmod, "enumerate": enumerate,
            "filter": filter, "float": float, "format": format,
            "int": int, "isinstance": isinstance, "issubclass": issubclass,
            "iter": iter, "len": len, "list": list, "map": map, "max": max, "min": min,
            "next": next, "object": object, "ord": ord, "pow": pow, "print": print,
            "range": range, "repr": repr, "reversed": reversed, "round": round,
            "set": set, "slice": slice, "sorted": sorted, "str": str, "sum": sum,
            "tuple": tuple, "type": type, "zip": zip, "hash": hash, "hex": hex,
            "oct": oct, "open": open, "vars": vars, "hasattr": hasattr,
            "getattr": getattr, "setattr": setattr, "callable": callable,
            "AssertionError": AssertionError, "ValueError": ValueError,
            "TypeError": TypeError, "KeyError": KeyError, "IndexError": IndexError,
            "Exception": Exception, "StopIteration": StopIteration,
            "RuntimeError": RuntimeError, "NotImplementedError": NotImplementedError,
            "OverflowError": OverflowError, "ZeroDivisionError": ZeroDivisionError,
        }
    }
    # Run assertions one-by-one to pinpoint which one fails and show context
    try:
        exec(compile(clean_code, "<sandbox>", "exec"), sandbox_globals)
    except Exception as e:
        return False, f"{type(e).__name__} in reference_code: {str(e)}"

    for i, assertion in enumerate(assert_lines):
        try:
            exec(compile(assertion, "<assertion>", "exec"), sandbox_globals)
        except AssertionError:
            return False, (
                f"AssertionError on assertion {i+1}/{len(assert_lines)}: `{assertion}` — "
                f"the function returned a different value than expected. "
                f"Fix the assertion so it matches the actual output of your reference implementation."
            )
        except Exception as e:
            return False, f"{type(e).__name__} on assertion {i+1}: `{assertion}` — {str(e)}"

    return True, "All assertions passed."


# ==========================================
# 8. QA CRITIC AGENT
# ==========================================
async def run_qa_critic(content: str, reference_code: str) -> tuple[bool, str]:
    print("🕵️‍♂️ [QA Critic]: Verifying pipeline parameters...")

    has_updates = "*🔴 REGULAR DAILY AI UPDATES*" in content
    has_learnings = "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*" in content

    # Extract assert lines from BOTH the payload and the reference_code.
    # Claude reliably puts runnable assertions in <reference_implementation>, not
    # inside <whatsapp_payload> (where they appear as illustrative examples only).
    assert_lines = []
    for line in (content + "\n" + reference_code).split('\n'):
        clean_line = line.replace('*', '').replace('-', '').strip()
        if clean_line.startswith('assert '):
            assert_lines.append(clean_line)
    # Deduplicate while preserving order
    seen = set()
    assert_lines = [x for x in assert_lines if not (x in seen or seen.add(x))]

    has_assert_syntax = len(assert_lines) >= 3
    char_length = len(content)
    within_twilio_limit = char_length <= 10000  # chunker handles splitting; check pre-split total

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
    if not within_twilio_limit: errors.append(f"Payload out of size bounds ({char_length}/10000 chars).")
    if not (5 <= update_count <= 25): errors.append(f"Density check: Found {update_count} updates, expected 5-25.")

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
    print(f"  - Twilio Message Size Safety:    {char_length}/10000 chars ({'PASS' if within_twilio_limit else 'FAIL'})")
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

    prompt = f"""HARD LIMIT: Return EXACTLY 5 news items. Not 4. Not 6. Not 20.
Exactly 5 items in the updates section.
If you return more than 5 items the output will be rejected and thrown away.

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
(Return EXACTLY 5 news items maximum. Not 6, not 7, not 20. Exactly 5. Each item must be under 100 characters.)
Stop after item 5. Do not add item 6 or beyond under any circumstances.

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

CRITICAL OUTPUT FORMAT: Wrap your entire final answer in
<whatsapp_payload> and </whatsapp_payload> tags.
Put NOTHING outside these tags — no reasoning, no explanation,
no preamble. Everything outside the tags will be discarded.

Example:
<whatsapp_payload>
🔴 REGULAR DAILY AI UPDATES
[content here]

📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON
[content here]
</whatsapp_payload>
"""

    if feedback_loop_msg:
        prompt += f"\n\n⚠️ CRITICAL CORRECTION REQUIRED:\n{feedback_loop_msg}"

    response = await anthropic_client.chat.completions.create(
        model=OPENROUTER_MODEL, max_tokens=2000, temperature=0.2,
        extra_body={"thinking": False},
        messages=[{"role": "user", "content": prompt}]
    )

    text = response.choices[0].message.content
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
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL_FAST, max_tokens=2000, temperature=0.3,
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
        try:
            raw = text.strip() if text else ""
            if not raw:
                raise ValueError("Empty response from LLM")
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            questions = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
            questions = []  # safe fallback — list expected here

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
            response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=400, temperature=0.2,
                messages=[{"role": "user", "content": prompt}]
            )
            text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
            try:
                raw = text.strip() if text else ""
                if not raw:
                    raise ValueError("Empty response from LLM")
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                resources = json.loads(raw.strip())
            except (json.JSONDecodeError, ValueError) as e:
                print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
                resources = []
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


async def _log_job(job_name: str, status: str, message: str = ""):
    """Write a single row to job_logs. Fire-and-forget — never raises."""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO job_logs (job_name, status, message) VALUES (?, ?, ?)",
                (job_name, status, message)
            )
            await db.commit()
    except Exception:
        pass


# ==========================================
# 11. CHECK-IN REMINDER ENGINE
# — Asks about today's learning topic AND today's project subtask
# ==========================================
async def send_checkin_reminder(reminder_number: int):
    await _log_job("send_checkin_reminder", "started", f"reminder #{reminder_number}")
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

    await loop.run_in_executor(None, lambda: send_whatsapp_chunked(msg))
    await _log_job("send_checkin_reminder", "completed", f"reminder #{reminder_number} sent")
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
    await loop.run_in_executor(None, lambda: send_whatsapp_chunked(intro + first_question))
    print("🧠 Auto-triggered quiz after final reminder.")


# ==========================================
# 12. WEEKLY PERFORMANCE REPORT
# ==========================================
async def send_weekly_report():
    await _log_job("send_weekly_report", "started")
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
        await loop.run_in_executor(None, lambda: send_whatsapp_chunked(msg))
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

    await loop.run_in_executor(None, lambda: send_whatsapp_chunked(report))
    await _log_job("send_weekly_report", "completed")
    print("📊 Weekly report sent.")


# ==========================================
# 13. MORNING DIGEST ENDPOINT
# ==========================================
def extract_final_payload(raw_response: str) -> str:
    """
    Strips reasoning/thinking text from model output.
    Only keeps content between <whatsapp_payload> tags if present,
    otherwise strips common reasoning patterns.
    """
    if not raw_response:
        return ""

    text = raw_response.strip()

    # Method 1: If wrapped in <whatsapp_payload> tags, extract only that
    if "<whatsapp_payload>" in text and "</whatsapp_payload>" in text:
        start = text.find("<whatsapp_payload>") + len("<whatsapp_payload>")
        end = text.find("</whatsapp_payload>")
        return text[start:end].strip()

    # Method 2: If reasoning leaked without tags, detect and strip it
    reasoning_markers = [
        "We need to", "We must", "Let's", "I'll produce",
        "Thus we need", "Probably each", "We'll design",
        "Let's estimate", "We need assertions"
    ]

    lines = text.split('\n')
    content_start_idx = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        # Find where actual content starts (emoji headers are reliable markers)
        if stripped.startswith('🔴') or stripped.startswith('📘') or stripped.startswith('📊'):
            content_start_idx = i
            break
        # If we hit a reasoning marker, keep scanning past it
        if any(stripped.startswith(marker) for marker in reasoning_markers):
            continue

    cleaned = '\n'.join(lines[content_start_idx:])

    # Safety check: if cleaned result is still suspiciously long with
    # reasoning phrases, it's a hard failure — return empty so fallback kicks in
    if any(marker in cleaned[:200] for marker in reasoning_markers):
        print("⚠️ Reasoning leak detected even after cleaning — rejecting payload")
        return ""

    return cleaned.strip()


def enforce_content_limits(text: str, max_items: int = 5, max_chars: int = 7000) -> str:
    """
    Hard-cap the number of news/update items and total length.
    Runs after LLM generation, before QA check.
    """
    lines = text.split('\n')

    item_count = 0
    output_lines = []
    in_updates_section = False

    for line in lines:
        stripped = line.strip()

        # Detect updates section header
        if 'DAILY UPDATES' in stripped.upper() or 'NEWS' in stripped.upper():
            in_updates_section = True

        # Detect learning section — stop counting items
        if 'LEARN' in stripped.upper() or 'PROJECT' in stripped.upper():
            in_updates_section = False

        # Count items in updates section only
        is_item = (
            stripped.startswith('•') or
            stripped.startswith('-') or
            stripped.startswith('*') or
            (len(stripped) > 2 and stripped[0].isdigit() and stripped[1] in '.)')
        )

        if in_updates_section and is_item:
            item_count += 1
            if item_count > max_items:
                continue  # skip items beyond the limit

        output_lines.append(line)

    result = '\n'.join(output_lines)

    # Hard cap total length
    if len(result) > max_chars:
        result = result[:max_chars]
        # Find last complete sentence
        last_period = result.rfind('.')
        if last_period > max_chars * 0.8:
            result = result[:last_period + 1]
        result += "\n\n_(Content trimmed for delivery)_"

    print(f"✅ Content enforcer: {item_count} items found, capped at {max_items}. Final size: {len(result)} chars")
    return result


async def run_morning_digest():
    await _log_job("run_morning_digest", "started")
    try:
        _, recent_topics, _ = await get_db_state()
        skill_level = get_setting("skill_level", "intermediate")

        # Planner must run first — RAG needs the concept it returns
        planner_context = await run_curriculum_planner(skill_level, recent_topics)
        concept = planner_context.get("concept", "Agentic Scaffolding Testing")

        loop = asyncio.get_running_loop()

        async def _fetch_and_save_news():
            articles = await loop.run_in_executor(None, fetch_live_internet_updates)
            await save_articles_to_knowledge_store(articles)
            return articles

        # News fetch + RAG retrieval run in parallel
        raw_news, relevant_articles = await asyncio.gather(
            _fetch_and_save_news(),
            retrieve_relevant_context(concept, limit=3),
            return_exceptions=True,
        )
        if isinstance(raw_news, Exception):
            print(f"⚠️ News fetch failed: {raw_news}")
            raw_news = []
        if isinstance(relevant_articles, Exception):
            print(f"⚠️ RAG retrieval failed: {relevant_articles}")
            relevant_articles = []

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

        max_retries = 1
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
                final_text = enforce_content_limits(final_text)
                final_text = extract_final_payload(final_text)
                if not final_text or len(final_text) < 50:
                    print("⚠️ Creator Agent payload extraction failed — using safe fallback")
                    final_text = (
                        "🔴 *REGULAR DAILY AI UPDATES*\n"
                        "Content generation had an issue today. Check back tomorrow!\n\n"
                        "📘 *WHAT I NEED TO LEARN*\n"
                        "Today's concept: " + concept + "\n"
                        "Take a moment to research this topic on your own today."
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
            weather_brief = await get_weather_brief()
            final_text = f"🌤️ {weather_brief}\n\n{final_text}"
            await log_sent_concept(concept, final_text)
            today_str = date.today().isoformat()
            # Save to cache before sending
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO digest_cache (date, content, sent) VALUES (?, ?, 0)",
                    (today_str, final_text)
                )
                await db.commit()
            print(f"💾 [Digest Cache]: Saved digest for {today_str}")
            try:
                await loop.run_in_executor(None, lambda: send_whatsapp_chunked(final_text))
                # Mark as sent in cache
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        "UPDATE digest_cache SET sent=1 WHERE date=? AND sent=0",
                        (today_str,)
                    )
                    await db.commit()
                # Difficulty feedback prompt — separate message so digest stays clean
                feedback_prompt = (
                    f"📐 *Quick feedback:* Was today's concept (*{concept}*) the right difficulty?\n"
                    f"Reply *E* (too easy) · *J* (just right) · *H* (too hard)"
                )
                await loop.run_in_executor(None, lambda: send_whatsapp_chunked(feedback_prompt))
                await _log_job("run_morning_digest", "completed", f"concept: {concept}")
                return {"status": "Digest approved and dispatched.", "concept": concept}
            except Exception as e:
                await _log_job("run_morning_digest", "failed", f"Twilio error: {str(e)}")
                return {"status": "QA Passed but Twilio failed", "error": str(e)}
        else:
            await _log_job("run_morning_digest", "failed", f"QA rejected: {feedback}")
            return {"status": "Aborted. Failed structural validation.", "errors": feedback}

    except Exception as e:
        import traceback
        traceback.print_exc()
        await _log_job("run_morning_digest", "failed", str(e))
        return {"status": "Error running digest pipeline", "error": str(e)}


@app.post("/run-morning-digest")
async def morning_digest_endpoint():
    return await run_morning_digest()


# ==========================================
# ONBOARDING HANDLER
# ==========================================
async def handle_onboarding(incoming_message: str) -> str:
    """
    Manages a 3-step onboarding conversation.
    Returns the reply message to send back to the user.
    """
    msg = incoming_message.strip().upper()
    step = int(get_setting("onboarding_step", "0"))

    # ── STEP 0: Brand new — send welcome + domain question ──
    if step == 0:
        save_setting("onboarding_step", "1")
        return (
            "👋 *Welcome to your personal learning engine!*\n\n"
            "I'll send you one concept to learn every day, a quiz, and a mini project — "
            "all tailored to you.\n\n"
            "First, pick your learning domain:\n\n"
            "A) 💻 Technology & Programming\n"
            "B) 🤖 Data Science & AI\n"
            "C) 🔐 Cybersecurity\n"
            "D) 💼 Business & Finance\n"
            "E) 🔬 Science & Mathematics\n"
            "F) 📜 History & Philosophy\n"
            "G) 📣 Marketing & Product\n"
            "H) ✏️ Other — type your own"
        )

    # ── STEP 1: Waiting for domain answer ──
    if step == 1:
        domain_map = {
            "A": ("technology", "Technology & Programming"),
            "B": ("data_science", "Data Science & AI"),
            "C": ("cybersecurity", "Cybersecurity"),
            "D": ("business", "Business & Finance"),
            "E": ("science", "Science & Mathematics"),
            "F": ("philosophy", "History & Philosophy"),
            "G": ("marketing", "Marketing & Product"),
        }
        if msg in domain_map:
            domain, domain_display = domain_map[msg]
        else:
            domain = incoming_message.strip().lower().replace(" ", "_")
            domain_display = incoming_message.strip().title()

        save_setting("domain", domain)
        save_setting("domain_display", domain_display)
        save_setting("onboarding_step", "2")
        return (
            f"Got it — *{domain_display}* 👍\n\n"
            "Now pick your skill level:\n\n"
            "A) 🌱 Beginner — just starting out\n"
            "B) 📈 Intermediate — know the basics\n"
            "C) 🔥 Advanced — want deep content\n"
            "D) ⚡ Pro — challenge me hard"
        )

    # ── STEP 2: Waiting for skill level answer ──
    if step == 2:
        skill_map = {
            "A": "beginner",
            "B": "intermediate",
            "C": "advanced",
            "D": "pro"
        }
        skill_level = skill_map.get(msg, "intermediate")
        save_setting("skill_level", skill_level)
        save_setting("onboarding_step", "3")
        domain_display = get_setting("domain_display", "your chosen domain")
        return (
            f"Perfect! Last question 🎯\n\n"
            f"What specific topic within *{domain_display}* do you want to focus on?\n\n"
            f"Be specific: 'neural networks', 'stoic philosophy', 'options trading'\n"
            f"Or reply *surprise me* and I'll pick something great every day 🎲"
        )

    # ── STEP 3: Waiting for topic answer ──
    if step == 3:
        if incoming_message.strip().lower() == "surprise me":
            topic = ""
            topic_display = "Surprise me daily 🎲"
        else:
            topic = incoming_message.strip()
            topic_display = topic

        save_setting("topic", topic)
        save_setting("onboarded", "1")
        save_setting("onboarding_step", "4")
        domain_display = get_setting("domain_display", "your domain")
        skill_level = get_setting("skill_level", "intermediate")
        return (
            f"✅ *You're all set!*\n\n"
            f"📚 Domain: {domain_display}\n"
            f"📊 Level: {skill_level.capitalize()}\n"
            f"🎯 Topic: {topic_display}\n\n"
            f"Your first digest arrives tomorrow morning.\n"
            f"Until then, try:\n\n"
            f"*digest* — get today's learning now\n"
            f"*quiz* — take a quiz\n"
            f"*EXPLAIN: anything* — instant explanation\n"
            f"*SET TOPIC: anything* — change your topic\n"
            f"*HELP* — see all commands\n\n"
            f"Welcome aboard! 🚀"
        )

    # Should not reach here
    return "Type *RESET* to start setup again."


# ==========================================
# 14. WHATSAPP WEBHOOK
# ==========================================
async def process_message(user_message: str, source: str = "whatsapp") -> str:
    """
    Core intent-routing logic, shared by the WhatsApp webhook and the /chat-message web UI.
    Returns the reply text, or None when the block already sent its own message(s) directly
    (e.g. digest/weekly-report, which dispatch asynchronously and have nothing left to return).
    """
    user_message_clean = user_message.lower().strip().replace("’", "'")
    loop = asyncio.get_running_loop()
    today = date.today().isoformat()

    print(f"📥 [Incoming]: '{user_message_clean}'")

    def send_whatsapp(msg):
        try:
            send_whatsapp_chunked(msg)
        except Exception as e:
            print(f"❌ Twilio dispatch failed: {e}")

    async def advance_email_queue():
        """Move to the next queued priority draft, or send a wrap-up if none are left."""
        activated = await activate_next_draft(send_whatsapp)
        if not activated:
            medium = await get_medium_count()
            low = await get_low_count()
            msg = f"✅ *All priority emails handled.* {medium} medium, {low} low priority email(s) also came in."
            await log_chat_message("assistant", msg)
            send_whatsapp(msg)

    # =========================================================================
    # ONBOARDING GATE — runs before every other command
    # =========================================================================
    # RESET is always allowed, even mid-onboarding
    if user_message_clean == "reset":
        save_setting("onboarded", "0")
        save_setting("onboarding_step", "0")
        save_setting("domain", "")
        save_setting("domain_display", "")
        save_setting("skill_level", "")
        save_setting("topic", "")
        return "♻️ Profile reset! Send any message to start fresh."

    if source == "whatsapp":
        onboarded = get_setting("onboarded", "0")
        if onboarded != "1":
            return await handle_onboarding(user_message)

    # ── Normal command processing continues below ──

    # =========================================================================
    # WEB UI — natural greeting (bypasses the learning-engine help menu)
    # =========================================================================
    if source == "web" and user_message_clean in [
        "hi", "hello", "hey", "how are you",
        "hello jarvis", "hi jarvis", "hey jarvis",
        "hello jarvis, how are you", "how are you doing"
    ]:
        await log_chat_message("user", user_message)
        hour = dt.datetime.now().hour
        time_of_day = "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"
        greeting_msg = (
            f"Hey Madan! Good {time_of_day}. I'm running well — "
            f"all systems online. What do you need help with? "
            f"I can check your emails, set reminders, research something, "
            f"or just have a conversation."
        )
        await log_chat_message("assistant", greeting_msg)
        return greeting_msg

    # =========================================================================
    # GREETING / HELP MENU
    # =========================================================================
    if user_message_clean in ["hi", "hello", "hey", "start", "help", "menu", "commands"]:
        await log_chat_message("user", user_message)
        help_msg = (
            "📖 *Commands*\n\n"
            "*digest* — Today's learning now\n"
            "*quiz* — Start a quiz\n"
            "*EXPLAIN: topic* — Explain anything\n"
            "*SET TOPIC: topic* — Change your focus\n"
            "*too easy* — Make content harder\n"
            "*too hard* — Make content easier\n"
            "*bad content* — Flag bad quality\n"
            "*wrong answer* — Flag wrong quiz answer\n"
            "*RESET* — Start setup again\n"
            "*done* — Mark today complete\n"
            "*skip* — Skip quiz question\n"
            "*end quiz* — End quiz early"
        )
        return help_msg

    # =========================================================================
    # WEATHER — on-demand weather query
    # =========================================================================
    if any(phrase in user_message_clean for phrase in [
        "weather", "temperature", "climate today",
        "temp today", "current temp", "what's the temp", "whats the temp",
    ]):
        await log_chat_message("user", user_message)
        weather_msg = await get_weather(call_llm)
        await log_chat_message("assistant", weather_msg)
        return weather_msg

    # =========================================================================
    # LOCAL BRIDGE — queue a command for local_bridge.py (runs on the Mac)
    # and wait for it to poll, execute, and post the result back.
    # Same process as the /local-queue routes above, so this reads/writes
    # local_command_queue directly instead of calling its own HTTP routes.
    #
    # WhatsApp's webhook has a ~15s ack timeout — blocking incoming_whatsapp_
    # reply() for that long risks Twilio retrying and double-queuing the
    # command. So on WhatsApp we queue it, ack immediately (return None,
    # mirrors the digest/email-queue blocks), and poll in a background task
    # that self-sends the result when ready. The web chat UI has no such
    # timeout, so it keeps the original inline blocking wait.
    # =========================================================================
    if user_message_clean.startswith("show folder") or \
       user_message_clean.startswith("list folder") or \
       user_message_clean in ["show my project", "list my files", "show project folder"]:
        await log_chat_message("user", user_message)

        async with aiosqlite.connect(DB_PATH) as db:
            cursor = await db.execute(
                "INSERT INTO local_command_queue (command_type, payload) VALUES (?, ?)",
                ("list_folder", "/Users/madansaidaram/Desktop/Daily_AI_updates")
            )
            command_id = cursor.lastrowid
            await db.commit()

        async def _poll_local_result(cmd_id: int, max_wait_seconds: int) -> str:
            for _ in range(max_wait_seconds):
                await asyncio.sleep(1)
                async with aiosqlite.connect(DB_PATH) as db:
                    cur = await db.execute(
                        "SELECT status, result FROM local_command_queue WHERE id=?",
                        (cmd_id,)
                    )
                    row = await cur.fetchone()
                if row and row[0] == "completed":
                    return row[1] or "No result"
            return "⏳ Local bridge not running. Start local_bridge.py on your Mac."

        if source == "whatsapp":
            async def _deliver_when_ready():
                result = await _poll_local_result(command_id, max_wait_seconds=60)
                await log_chat_message("assistant", result)
                send_whatsapp(result)

            asyncio.create_task(_deliver_when_ready())
            return None
        else:
            result = await _poll_local_result(command_id, max_wait_seconds=15)
            await log_chat_message("assistant", result)
            return result

    # =========================================================================
    # EMAIL TRIAGE — approve the active draft reply, then advance the queue
    # =========================================================================
    if user_message_clean in ["approve email", "yes email"]:
        await log_chat_message("user", user_message)
        draft = await get_active_draft()
        if not draft:
            return "⚠️ *No active email draft.*"
        success, report = await approve_draft(draft["id"])
        msg = f"📤 *Email sent to {draft['sender']}.*" if success else f"❌ *Send failed:* {report}"
        await log_chat_message("assistant", msg)
        send_whatsapp(msg)
        if success:
            await advance_email_queue()
        return None

    # =========================================================================
    # EMAIL TRIAGE — discard the active draft entirely, then advance the queue
    # =========================================================================
    if user_message_clean == "don't send":
        await log_chat_message("user", user_message)
        draft = await get_active_draft()
        if not draft:
            return "⚠️ *No active email draft.*"
        await delete_draft(draft["id"])
        remaining = await count_pending_drafts()
        medium = await get_medium_count()
        low = await get_low_count()
        msg = f"🗑️ *Deleted.* {remaining} priority email(s) left, {medium} medium, {low} low priority email(s)."
        await log_chat_message("assistant", msg)
        send_whatsapp(msg)
        await advance_email_queue()
        return None

    # =========================================================================
    # EMAIL TRIAGE — edit the active draft reply
    # Usage: "edit: <new reply text>"
    # =========================================================================
    if user_message_clean.startswith("edit:"):
        await log_chat_message("user", user_message)
        new_text = user_message[len("edit:"):].strip()
        draft = await get_active_draft()
        if not draft:
            return "⚠️ *No active email draft.*"
        if not new_text:
            return "⚠️ Usage: EDIT: <your new reply text>"
        await edit_draft(draft["id"], new_text)
        msg = f"✏️ *Draft updated.*\n\n{new_text}\n\nReply *APPROVE EMAIL* to send it, or *DON'T SEND* to discard it."
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # EMAIL COMPOSE — send confirmation
    # =========================================================================
    if user_message_clean in [
        "send", "send it", "send this",
        "send this email", "yeah send",
        "yes send it", "yeah, send this email",
        "send the email", "go ahead send",
    ]:
        await log_chat_message("user", user_message)
        draft = await get_latest_composed_draft()
        if not draft:
            msg = "No pending email draft found. Compose one first."
            await log_chat_message("assistant", msg)
            return msg

        to_addr = draft.get("sender", "")  # recipient is stored in the sender column for composed drafts
        subject = draft.get("subject", "No Subject")
        body = draft.get("draft_reply", "")
        draft_id = draft.get("id")

        if not to_addr or not body:
            msg = "⚠️ Draft is incomplete — missing recipient or body. Please compose again."
            await log_chat_message("assistant", msg)
            return msg

        sent_ok = await send_composed_email(to_address=to_addr, subject=subject, body=body, draft_id=draft_id)
        if sent_ok:
            reply = (
                f"✅ *Email sent successfully!*\n\n"
                f"*To:* {to_addr}\n"
                f"*Subject:* {subject}\n\n"
                f"Check your Gmail sent folder to confirm."
            )
        else:
            reply = (
                "❌ Failed to send email.\n"
                "Check Render logs for details. Gmail credentials may need refreshing."
            )
        await log_chat_message("assistant", reply)
        return reply

    # =========================================================================
    # EMAIL COMPOSE — edit the pending composed draft
    # Usage: "edit email: <new text>"
    # =========================================================================
    if user_message_clean.startswith("edit email:"):
        await log_chat_message("user", user_message)
        new_body = user_message[len("edit email:"):].strip()
        draft = await get_latest_composed_draft()

        if not draft:
            msg = "No pending draft to edit."
        elif not new_body:
            msg = "⚠️ Usage: EDIT EMAIL: <your new text>"
        else:
            await edit_draft(draft["id"], new_body)
            msg = (
                f"✏️ *Draft updated:*\n\n{new_body}\n\n"
                f"─────────────────\n"
                f"Reply *SEND* to send · *EDIT EMAIL: <text>* to revise again"
            )
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # EMAIL COMPOSE — cancel the pending composed draft
    # Only handles bare "cancel" when a composed draft actually exists —
    # otherwise falls through to the CANCEL STAGED PATCH block further down,
    # which already handles "cancel"/"no"/"abort" for the AI-architect flow.
    # =========================================================================
    if user_message_clean == "cancel":
        composed_draft = await get_latest_composed_draft()
        if composed_draft:
            await log_chat_message("user", user_message)
            await cancel_composed_draft(composed_draft["id"])
            msg = "🗑️ Email draft cancelled."
            await log_chat_message("assistant", msg)
            return msg

    # =========================================================================
    # NOTES — force-save a fact on demand
    # Usage: "remember: <something>"
    # =========================================================================
    if user_message_clean.startswith("remember:"):
        await log_chat_message("user", user_message)
        fact_text = user_message[len("remember:"):].strip()
        if not fact_text:
            return "⚠️ Usage: REMEMBER: <something to remember>"
        await save_user_fact(fact_text)
        msg = f"🧠 *Got it, I'll remember:* {fact_text}"
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # NOTES — search saved facts
    # Usage: "what do i know about <topic>"
    # =========================================================================
    if user_message_clean.startswith("what do i know about"):
        await log_chat_message("user", user_message)
        topic = user_message[len("what do i know about"):].strip()
        if not topic:
            return "⚠️ Usage: WHAT DO I KNOW ABOUT <topic>"
        facts = await search_user_facts(topic)
        if facts:
            msg = "🧠 *Here's what I know:*\n\n" + "\n".join(f"- {f}" for f in facts)
        else:
            msg = f"🤷 Nothing saved about \"{topic}\" yet."
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # SET TOPIC — override what the bot teaches next morning
    # Usage: "set topic: Reinforcement Learning from Human Feedback"
    # =========================================================================
    if user_message_clean.startswith("set topic:"):
        await log_chat_message("user", user_message)
        new_topic = user_message[len("set topic:"):].strip()
        if new_topic:
            async with aiosqlite.connect(DB_PATH) as db:
                # Write to both user_settings (spec) and user_profile (curriculum planner reads it)
                await db.execute(
                    "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES ('current_topic', ?, datetime('now'))",
                    (new_topic,)
                )
                await db.execute(
                    "INSERT OR REPLACE INTO user_profile (key, value) VALUES ('override_topic', ?)",
                    (new_topic,)
                )
                await db.commit()
            reply = f"Got it! Your learning topic is now: *{new_topic}*\nI'll teach you concepts from this domain daily. Type SET TOPIC: anything to change it anytime — it can be literally any subject."
        else:
            reply = "⚠️ Usage: SET TOPIC: <your topic here>\nExample: SET TOPIC: Reinforcement Learning"
        return reply

    if user_message_clean == "clear topic":
        await log_chat_message("user", user_message)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM user_profile WHERE key='override_topic'")
            await db.commit()
        return "✅ Topic override cleared. Auto-selection resumes tomorrow."

    # =========================================================================
    # EXPLAIN — instant concept explanation
    # Usage: "EXPLAIN: transformer attention mechanism"
    # =========================================================================
    if user_message_clean.startswith("explain:"):
        await log_chat_message("user", user_message)
        concept_to_explain = user_message[len("explain:"):].strip()
        if not concept_to_explain:
            return "⚠️ Usage: EXPLAIN: <concept>\nExample: EXPLAIN: transformer attention"
        try:
            explain_system = """You are a world-class educator who can explain any concept
from any field — science, math, history, coding, philosophy, economics,
psychology, engineering, art, music, or anything else.

When explaining:
1. Start with a plain English explanation anyone can understand
2. Give one memorable real-world analogy
3. Give one concrete example or mini exercise
4. Keep the total response under 1400 characters so it fits in WhatsApp

You are not limited to any domain. Explain whatever the user asks."""
            explain_response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=500, temperature=0.3,
                messages=[
                    {"role": "system", "content": explain_system},
                    {"role": "user", "content": f"Explain this concept clearly: {concept_to_explain}"},
                ]
            )
            explanation = explain_response.choices[0].message.content.strip()
            return explanation
        except Exception as e:
            return f"⚠️ Could not explain that right now: {str(e)}"

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
        return status_msg

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
        return reply

    # =========================================================================
    # CODE REVIEW
    # =========================================================================
    if user_message_clean.startswith("review:"):
        await log_chat_message("user", user_message)
        code_snippet = user_message[7:].strip()
        if not code_snippet:
            return "⚠️ Send: *review: <your code here>*"
        skill_level, recent_topics, _ = await get_db_state()
        concept = recent_topics[0] if recent_topics else "AI Engineering"
        try:
            review_response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=600, temperature=0.2,
                messages=[{"role": "user", "content": (
                    f"Review this code snippet for an {skill_level} student learning {concept}.\n"
                    f"```\n{code_snippet}\n```\n"
                    f"Give: 1) Correctness verdict, 2) One specific improvement, 3) One thing done well. "
                    f"Keep it under 200 words. Use WhatsApp *bold* formatting."
                )}]
            )
            review_msg = review_response.choices[0].message.content.strip()
        except Exception as e:
            review_msg = f"⚠️ Code review unavailable: {e}"
        await log_chat_message("assistant", review_msg)
        return review_msg

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
            return final

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
            return confirm_msg

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
            return skip_msg

        # Answer A B C D
        if user_message_clean.upper() in ["A", "B", "C", "D"]:
            await log_chat_message("user", user_message)
            result = await process_quiz_answer(user_message_clean.upper())
            if result:
                await log_chat_message("assistant", result)
            return result

    # =========================================================================
    # LEARNING DONE — trigger quiz
    # =========================================================================
    if user_message_clean in ["done", "completed", "finished", "complete"]:
        await log_chat_message("user", user_message)

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT quiz_triggered, concept FROM daily_checkins WHERE date=?", (today,)) as cursor:
                row = await cursor.fetchone()

        if row and row[0]:
            return "✅ Quiz already completed today! Come back tomorrow for a new concept. 🌟"

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
        return intro + first_question

    # =========================================================================
    # APPROVE STAGED PATCH
    # =========================================================================
    if user_message_clean in ["approve", "yes", "confirm", "push"]:
        await log_chat_message("user", user_message)
        if not os.path.exists(STAGED_CODE_FILE):
            return "⚠️ *No changes staged.* Send an upgrade instruction first!"

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
        return msg

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
        return msg

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
        return msg

    if user_message_clean in ["digest", "refresh", "force digest"]:
        await log_chat_message("user", user_message)
        today_str = date.today().isoformat()
        # Check cache for today's pre-generated digest
        cached_content = None
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT content FROM digest_cache WHERE date=? AND sent=0 ORDER BY generated_at DESC LIMIT 1",
                (today_str,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    cached_content = row[0]
        if cached_content:
            print("⚡ [Cache HIT]: Sending pre-generated digest")
            send_whatsapp_chunked(cached_content)
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE digest_cache SET sent=1 WHERE date=? AND sent=0",
                    (today_str,)
                )
                await db.commit()
            await log_chat_message("assistant", "Cache HIT: sent pre-generated digest instantly")
        else:
            print("⚡ [Cache MISS]: Generating fresh digest, ~30 seconds...")
            send_whatsapp_chunked("⚡ Digest requested! Generating your update now — arrives in ~30 seconds...")
            digest_status = await run_morning_digest()
            await log_chat_message("assistant", f"Cache MISS: fresh digest done. Status: {digest_status.get('status')}")
        return None

    if user_message_clean in ["weekly report", "report", "my progress"]:
        await log_chat_message("user", user_message)
        await send_weekly_report()
        return None

    # =========================================================================
    # UPGRADE INTENT — SURGICAL PATCH
    # =========================================================================
    # Only trigger code patching for explicit code/system change requests
    UPGRADE_PHRASES = [
        "upgrade yourself",
        "modify your code",
        "update your code",
        "fix your code",
        "change your code",
        "patch yourself",
        "update the scheduler timings",
        "change the scheduler",
        "implement this change",
        "modify the bot",
        "update the bot",
        "change the bot",
    ]
    is_upgrade_intent = any(phrase in user_message_clean for phrase in UPGRADE_PHRASES)

    if is_upgrade_intent:
        await log_chat_message("user", user_message)
        if not GITHUB_TOKEN or not GITHUB_REPO:
            return "❌ *Operation Denied.* `GITHUB_TOKEN` or `GITHUB_REPO` missing."

        try:
            headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
            file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
            res = await loop.run_in_executor(None, lambda: requests.get(file_url, headers=headers))
            if res.status_code != 200:
                return f"❌ *GitHub Error:* {res.json().get('message')}"

            file_data = res.json()
            current_sha = file_data["sha"]
            current_code = base64.b64decode(file_data["content"]).decode("utf-8")

            print("🧠 [AI Architect]: Generating surgical patch...")

            patch_response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=1500, temperature=0.1,
                messages=[
                    {"role": "system", "content": (
                        "You are an expert Python code surgeon. "
                        "Given a user instruction and a Python file, identify the exact snippet to change. "
                        "Respond ONLY with a valid raw JSON object with exactly two keys: "
                        "\"find\" (exact existing code verbatim) and \"replace\" (new code). "
                        "No explanation, no markdown, no text outside the JSON."
                    )},
                    {"role": "user", "content": (
                        f"Instruction: {user_message}\n\n"
                        f"Current file:\n{current_code}\n\n"
                        f"Return ONLY: {{\"find\": \"exact old code\", \"replace\": \"new code\"}}"
                    )},
                ]
            )

            raw_text = re.sub(r'^```(?:json)?\s*|\s*```$', '', patch_response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
            print(f"🔍 PATCH RESPONSE:\n{raw_text}")

            try:
                raw = raw_text.strip() if raw_text else ""
                if not raw:
                    raise ValueError("Empty response from LLM")
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                patch_data = json.loads(raw.strip())
            except (json.JSONDecodeError, ValueError) as e:
                print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(raw_text[:200] if raw_text else 'EMPTY')}")
                patch_data = {}
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
            return msg

        except Exception as e:
            err = "⏳ *Claude overloaded.* Try again in a moment." if "529" in str(e) or "overloaded" in str(e).lower() else f"❌ *Patch Error:* {str(e)}"
            await log_chat_message("assistant", err)
            return err

    # =========================================================================
    # NOTES & REMINDERS — natural-language intent detection
    # =========================================================================
    try:
        now_str = dt.datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()
        intent_raw = await call_llm(MEMORY_INTENT_PROMPT, f"Current datetime: {now_str}\n\nMessage: {user_message}", max_tokens=300)
        intent_parsed = json.loads(intent_raw)
        memory_intent = intent_parsed.get("intent", "OTHER")
        memory_content = intent_parsed.get("content")
        memory_reminder = intent_parsed.get("reminder")
        memory_email = intent_parsed.get("email")
    except Exception as e:
        print(f"⚠️ Memory intent classification failed: {e}")
        memory_intent = "OTHER"
        memory_content = None
        memory_reminder = None
        memory_email = None

    if memory_intent == "SAVE_FACT" and memory_content:
        await log_chat_message("user", user_message)
        await save_user_fact(memory_content)
        msg = f"🧠 *Got it, I'll remember:* {memory_content}"
        await log_chat_message("assistant", msg)
        return msg

    if memory_intent == "RECALL_FACT" and memory_content:
        await log_chat_message("user", user_message)
        facts = await search_user_facts(memory_content)
        if facts:
            msg = "🧠 *Here's what I know:*\n\n" + "\n".join(f"- {f}" for f in facts)
        else:
            msg = f"🤷 Nothing saved about \"{memory_content}\" yet."
        await log_chat_message("assistant", msg)
        return msg

    if memory_intent == "SET_REMINDER" and memory_reminder:
        await log_chat_message("user", user_message)
        app_scheduler = getattr(app.state, "scheduler", None)
        if not app_scheduler:
            msg = "⚠️ *Scheduler not available right now.*"
        else:
            success, msg = await create_reminder_from_intent(app_scheduler, memory_reminder, send_whatsapp)
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # EMAIL COMPOSE — draft a brand-new outbound email via natural language
    # Routed entirely by the LLM intent classification above (COMPOSE_EMAIL) —
    # no hardcoded trigger phrases, so any natural phrasing reaches this real
    # Gmail-backed action instead of falling through to general chat (which
    # has no way to actually create a draft or send anything).
    # =========================================================================
    if memory_intent == "COMPOSE_EMAIL" and memory_email:
        await log_chat_message("user", user_message)
        to_address = (memory_email.get("to") or "").strip()
        subject = (memory_email.get("subject") or "").strip() or "No Subject"
        body = (memory_email.get("body") or "").strip()
        save_as_draft = bool(memory_email.get("save_as_draft"))

        if not to_address or not body:
            msg = (
                "⚠️ I need a recipient email address and what the email should say.\n"
                "Try: \"draft an email to x@example.com about ...\""
            )
            await log_chat_message("assistant", msg)
            return msg

        if save_as_draft:
            gmail_draft_id = await create_gmail_draft(to_address, subject, body)
            if gmail_draft_id:
                msg = (
                    f"✅ *Saved to your Gmail Drafts folder.*\n\n"
                    f"*To:* {to_address}\n"
                    f"*Subject:* {subject}\n\n"
                    f"*Body:*\n{body}\n\n"
                    f"Open Gmail → Drafts to review or send it from there."
                )
            else:
                msg = (
                    "❌ Failed to save the draft to Gmail.\n"
                    "Check Render logs for details — Gmail credentials may need refreshing."
                )
        else:
            await save_composed_draft(to_address, subject, body)
            msg = (
                f"📧 *Email Draft Ready*\n\n"
                f"*To:* {to_address}\n"
                f"*Subject:* {subject}\n\n"
                f"*Body:*\n{body}\n\n"
                f"─────────────────\n"
                f"Reply *SEND* to send this email\n"
                f"Reply *EDIT EMAIL: <new text>* to revise\n"
                f"Reply *CANCEL* to discard"
            )
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # REMINDERS — list pending reminders
    # Routed entirely by the LLM intent classification above (LIST_REMINDERS) —
    # no hardcoded phrase list, so any natural phrasing of "show my reminders"
    # reaches this real DB lookup instead of falling through to general chat.
    # =========================================================================
    if memory_intent == "LIST_REMINDERS":
        await log_chat_message("user", user_message)
        rows = await get_active_reminders()
        if not rows:
            msg = "📭 No pending reminders."
            await log_chat_message("assistant", msg)
            return msg

        def _format_when(row):
            if row["kind"] == "once":
                return dt.datetime.fromisoformat(row["run_at"]).strftime("%d %b at %I:%M %p")
            elif row["kind"] == "daily":
                return f"every day at {row['hour']:02d}:{row['minute']:02d}"
            else:
                return f"every {row['day_of_week']} at {row['hour']:02d}:{row['minute']:02d}"

        lines = [f"{i+1}. {row['text']} — {_format_when(row)}" for i, row in enumerate(rows)]
        result = f"⏰ *Your reminders ({len(rows)}):*\n\n" + "\n".join(lines)
        await log_chat_message("assistant", result)
        return result

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

        if source == "web":
            system_prompt = (
                "You are JARVIS, Madan's personal AI executive assistant. "
                "You are direct, concise, and conversational — like a smart "
                "assistant who knows Madan well, not a teacher or a chatbot.\n\n"
                "RESPONSE RULES — follow these strictly:\n"
                "1. Answer in 1-3 sentences maximum for simple questions\n"
                "2. Never show code unless Madan explicitly asks for code\n"
                "3. Never give tutorials, step-by-step guides, or long "
                "explanations unless specifically asked\n"
                "4. If the answer is yes or no, say yes or no first, "
                "then one sentence of context if needed\n"
                "5. Use plain conversational English, no markdown headers, "
                "no bullet lists unless listing actual items\n"
                "6. You know Madan's full system — here are the real facts:\n"
                "- Project folder: /Users/madansaidaram/Desktop/Daily_AI_updates\n"
                "- Main app file: V3_updates.py in that folder\n"
                "- Deployed on Render (always-on cloud hosting)\n"
                "- Reminders fire via WhatsApp using Twilio (already configured)\n"
                "- Emails triage to WhatsApp every hour\n"
                "- Briefings go to WhatsApp\n"
                "- Gmail is connected via OAuth — you CAN draft (save to Gmail Drafts) or send real "
                "emails when asked (e.g. 'draft an email to x@example.com about...'). Never deny this "
                "capability or claim you lack Gmail access. But you have NO WAY to know which exact "
                "address the OAuth connection points to — not madansai97@gmail.com, not any other "
                "address, nothing. If asked which exact account it is, or whether it's a specific "
                "address, say plainly that you can't confirm or name the exact linked address — never "
                "name ANY specific email address as 'the' connected one, even Madan's own. Only say the "
                "integration itself is live and working.\n"
                "- Database: agent_memory.db in the project folder\n"
                "- Do NOT invent or guess folder paths, file names, or "
                "project structure — use only what is stated here\n"
                "- If asked about something not in these facts, say "
                "'I don't have that info — check your project folder "
                "at /Users/madansaidaram/Desktop/Daily_AI_updates'\n\n"
                "7. Never suggest Madan install things or set things up "
                "that are already built into his system\n\n"
                "8. You are NOT shown Madan's actual reminders, emails, drafts, or schedule in this "
                "conversation, and reaching this fallback means nothing else handled the request — "
                "you have NO ability to actually create reminders, drafts, or sent emails, save files, "
                "or perform any other real action here. NEVER claim you did something or that something "
                "exists/is scheduled (e.g. 'Draft created in...', 'your next reminder is scheduled for...', "
                "'I've sent...') unless it is something you can see was already done. If Madan asked you to "
                "do something actionable, tell him plainly this specific phrasing didn't trigger a real "
                "action and suggest rephrasing (e.g. 'draft an email to x@example.com about...') instead of "
                "pretending it succeeded.\n\n"
                f"Facts about Madan:\n{facts_str}\n\n"
                f"Relevant context:\n{context_str}"
            )
        else:
            system_prompt = (
                f"You are the user's Curriculum Coach and AI Architect.\n"
                f"Facts about user:\n{facts_str}\n\nContext:\n{context_str}\n\n"
                f"RULES: 2-4 sentences max. Use asterisks (*) for bold. End with one open-ended learning question."
            )
        system_msg = {"role": "system", "content": system_prompt}
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=800,
            messages=[system_msg] + chat_history + [{"role": "user", "content": user_message}]
        )

        ai_response = response.choices[0].message.content.strip()
        await log_chat_message("assistant", ai_response)

        if "to *Advanced*" in ai_response:
            await update_db_skill("Advanced")
        elif "to *Foundational*" in ai_response:
            await update_db_skill("Foundational")

        await extract_and_save_facts(user_message, ai_response)

    except Exception as e:
        print(f"❌ Webhook LLM error: {e}")
        ai_response = "⚠️ Coaching engine interrupted. Check console logs."

    return ai_response


@app.post("/whatsapp-webhook")
async def incoming_whatsapp_reply(Body: str = Form(...)):
    reply = await process_message(Body.strip())
    if reply:
        try:
            send_whatsapp_chunked(reply)
        except Exception as e:
            print(f"❌ Twilio dispatch failed: {e}")
    return Response(content="<Response></Response>", media_type="text/xml")


@app.get("/chat-history")
async def chat_history_api(limit: int = 50):
    """Recent persisted chat_history rows, oldest first — lets the web UI
    re-render the conversation on page refresh instead of starting blank."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT role, content, timestamp FROM chat_history ORDER BY id DESC LIMIT ?",
            (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
    messages = [{"role": r[0], "content": r[1], "timestamp": r[2]} for r in reversed(rows)]
    return JSONResponse({"messages": messages})


@app.post("/chat-message")
async def chat_message(request: Request):
    body = await request.json()
    user_msg = body.get("message", "").strip()
    if not user_msg:
        return JSONResponse({"reply": "Please type a message."})
    try:
        reply = await process_message(user_msg, source="web")
        return JSONResponse({"reply": reply or "✅ Done — check WhatsApp for details."})
    except Exception as e:
        print(f"❌ chat-message error: {e}")
        return JSONResponse({"reply": "Something went wrong. Try again."})


CHAT_UI_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>JARVIS</title>
<style>
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: #0a0a0a; color: #fff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  #app { display: flex; flex-direction: column; height: 100vh; }

  header {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px;
    background: #0a0a0a;
    border-bottom: 1px solid #1a1a1a;
  }
  header .brand { font-size: 18px; font-weight: 700; color: #fff; }
  .pulse-dot {
    width: 10px; height: 10px; border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7);
    animation: pulse 1.6s infinite;
  }
  @keyframes pulse {
    0%   { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0.7); }
    70%  { box-shadow: 0 0 0 8px rgba(34, 197, 94, 0); }
    100% { box-shadow: 0 0 0 0 rgba(34, 197, 94, 0); }
  }

  #chat-window {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 16px;
    display: flex; flex-direction: column; gap: 12px;
  }
  .bubble-row { display: flex; flex-direction: column; max-width: 75%; }
  .bubble-row.user { align-self: flex-end; align-items: flex-end; }
  .bubble-row.agent { align-self: flex-start; align-items: flex-start; }
  .bubble {
    padding: 10px 14px; border-radius: 14px;
    white-space: pre-wrap; word-wrap: break-word;
    font-size: 16px; line-height: 1.4;
  }
  .bubble-row.user .bubble { background: #1a56db; color: #fff; }
  .bubble-row.agent .bubble { background: #1a1a1a; color: #fff; }
  .timestamp { font-size: 11px; color: #777; margin-top: 4px; padding: 0 4px; }

  .typing-dots { display: flex; gap: 4px; padding: 10px 14px; background: #1a1a1a; border-radius: 14px; width: fit-content; }
  .typing-dots span {
    width: 6px; height: 6px; border-radius: 50%; background: #888;
    animation: blink 1.2s infinite ease-in-out;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

  #input-bar {
    flex: 0 0 auto;
    display: flex; align-items: center; gap: 8px;
    padding: 10px 12px;
    padding-bottom: max(10px, env(safe-area-inset-bottom));
    background: #111111;
    border-top: 1px solid #1a1a1a;
  }
  #msg-input {
    flex: 1 1 auto;
    background: #1a1a1a; color: #fff;
    border: none; border-radius: 20px;
    padding: 12px 16px;
    font-size: 16px;
    outline: none;
  }
  #msg-input::placeholder { color: #777; }
  #send-btn {
    background: #1a56db; color: #fff; border: none;
    border-radius: 20px; padding: 12px 18px;
    font-size: 15px; font-weight: 600; cursor: pointer;
  }
  #mic-btn {
    background: #2a2a2a; color: #fff; border: none;
    border-radius: 50%; width: 44px; height: 44px;
    font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
  }
  #mic-btn.recording { background: #dc2626; }
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="brand">⚡ JARVIS</div>
    <div class="pulse-dot"></div>
  </header>
  <div id="chat-window"></div>
  <div id="input-bar">
    <input id="msg-input" type="text" placeholder="Message JARVIS..." autocomplete="off">
    <button id="mic-btn" title="Voice input">🎤</button>
    <button id="send-btn">Send</button>
  </div>
</div>

<script>
const chatWindow = document.getElementById('chat-window');
const input = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatStoredTimestamp(ts) {
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC, no timezone marker
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function appendBubble(text, who, timeStr) {
  const row = document.createElement('div');
  row.className = 'bubble-row ' + who;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  bubble.textContent = text;
  const ts = document.createElement('div');
  ts.className = 'timestamp';
  ts.textContent = timeStr || timeNow();
  row.appendChild(bubble);
  row.appendChild(ts);
  chatWindow.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

let typingRow = null;
function showTyping() {
  typingRow = document.createElement('div');
  typingRow.className = 'bubble-row agent';
  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';
  typingRow.appendChild(dots);
  chatWindow.appendChild(typingRow);
  scrollToBottom();
}
function hideTyping() {
  if (typingRow) {
    typingRow.remove();
    typingRow = null;
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  appendBubble(text, 'user');
  input.value = '';
  showTyping();
  try {
    const res = await fetch('/chat-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    hideTyping();
    appendBubble(data.reply, 'agent');
  } catch (err) {
    hideTyping();
    appendBubble('⚠️ Connection error. Try again.', 'agent');
  }
}

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});

// Voice input — webkitSpeechRecognition, fills input but does not auto-send
let recognizing = false;
let recognizer = null;
if ('webkitSpeechRecognition' in window) {
  recognizer = new webkitSpeechRecognition();
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.lang = 'en-US';

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    input.value = transcript;
  };
  recognizer.onend = () => {
    recognizing = false;
    micBtn.classList.remove('recording');
  };
  recognizer.onerror = () => {
    recognizing = false;
    micBtn.classList.remove('recording');
  };

  micBtn.addEventListener('click', () => {
    if (recognizing) {
      recognizer.stop();
      return;
    }
    recognizing = true;
    micBtn.classList.add('recording');
    recognizer.start();
  });
} else {
  micBtn.addEventListener('click', () => {
    appendBubble('⚠️ Voice input not supported in this browser.', 'agent');
  });
}

// Load persisted history on open so a refresh never wipes the conversation.
// Only show the canned greeting if there's no saved history yet.
async function loadHistory() {
  try {
    const res = await fetch('/chat-history');
    const data = await res.json();
    const messages = data.messages || [];
    if (messages.length > 0) {
      messages.forEach(m => {
        appendBubble(m.content, m.role === 'user' ? 'user' : 'agent', formatStoredTimestamp(m.timestamp));
      });
      return;
    }
  } catch (err) {
    console.error('Failed to load chat history', err);
  }
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : (hour < 17 ? 'afternoon' : 'evening');
  appendBubble('⚡ JARVIS online. Good ' + greeting + ', Madan.\\nWhat do you need?', 'agent');
}
loadHistory();
</script>
</body>
</html>"""


@app.get("/chat", response_class=HTMLResponse)
async def chat_ui():
    return HTMLResponse(content=CHAT_UI_HTML)


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