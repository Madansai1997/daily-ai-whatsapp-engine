"""
Pattern Learning Agent — self-contained skill module.

Deliberately deferred until a real agent phase had shipped and accumulated genuine
usage to learn from (see project memory) rather than tuning on near-zero data. Mines
actual behavioral signal — for now, the diff between an AI-drafted email reply and the
human edit it received — into a short LLM-distilled note that other modules' generation
prompts can optionally pull in.

Every category writes into the same generic `learned_patterns` table, keyed by category
name. Adding a new category (reminder timing, calendar preferences, ...) once those
tables have real rows means a new analyze_*() function here, not new schema.
"""

import os
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

MIN_SAMPLES_TO_ANALYZE = 3

EMAIL_TONE_ANALYSIS_PROMPT = (
    "You analyze edits a user made to AI-drafted email replies, to learn their actual "
    "writing preferences. You'll get pairs of (AI draft, user's edited version). Write a "
    "short note (2-4 sentences) describing consistent patterns in how the edits differ from "
    "the drafts — tone, length, phrasing, what they tend to cut or add. If the edits don't "
    "show a consistent pattern yet, say so plainly instead of inventing one. Plain text only."
)

REMINDER_TIMING_ANALYSIS_PROMPT = (
    "You analyze a user's reminder history to learn their habitual timing preferences, so an "
    "assistant can fill in a sensible default time when the user asks for a reminder WITHOUT "
    "stating one. You'll get a list of past reminders, each as 'kind | time | text'. Write a "
    "short note (2-4 sentences) describing consistent patterns: favored times of day, common "
    "exact times (e.g. 9am, 6pm), morning vs evening lean, any weekday habits, and whether "
    "certain kinds of task cluster at certain times. If there is no consistent pattern yet, "
    "say so plainly. Do NOT invent precise times the data doesn't support. Plain text only."
)

CALENDAR_PREFS_ANALYSIS_PROMPT = (
    "You analyze a user's created calendar events to learn their scheduling habits, so an "
    "assistant can pick sensible defaults (duration, time of day) when the user asks to "
    "schedule something WITHOUT giving full details. You'll get a list of events as "
    "'start -> end | attendees:yes/no | title'. Write a short note (2-4 sentences) on "
    "consistent patterns: typical event duration, favored meeting hours, morning vs "
    "afternoon lean, and whether meetings-with-others cluster at particular times. If "
    "there is no consistent pattern yet, say so plainly. Do NOT invent specifics the data "
    "doesn't support. Plain text only."
)

REPLY_STYLE_ANALYSIS_PROMPT = (
    "You analyze how a user (Madan) writes his own messages to his assistant, so the "
    "assistant can mirror his register and answer the way he'd want. You'll get a sample of "
    "his recent messages. Write a short note (2-4 sentences) describing HIS communication "
    "style: message length, formality, capitalization/punctuation habits, directness, emoji "
    "use, and how terse vs detailed he tends to be. Frame it as guidance for the assistant "
    "(e.g. 'He writes short, lowercase, blunt messages — match that: be terse and skip "
    "pleasantries'). If there's no consistent style yet, say so plainly. Plain text only."
)


def init_pattern_tables():
    """Synchronous, mirrors init_db_tables() in V3_updates.py — called once at import/startup time."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS draft_edits (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        draft_id INTEGER,
        original_text TEXT,
        edited_text TEXT,
        created_at TEXT
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS learned_patterns (
        category TEXT PRIMARY KEY,
        note TEXT,
        sample_count INTEGER DEFAULT 0,
        updated_at TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Pattern learning tables ready.")


async def record_email_edit(draft_id: int, original_text: str, edited_text: str):
    """Log an edit BEFORE the caller overwrites pending_drafts.draft_reply — this is the
    only place the original AI draft survives long enough to learn from."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO draft_edits (draft_id, original_text, edited_text, created_at) VALUES (?, ?, ?, ?)",
            (draft_id, original_text, edited_text, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def _count_edits() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) FROM draft_edits")
        row = await cur.fetchone()
        return row[0]


async def refresh_email_tone_pattern(call_llm_fn) -> None:
    """Re-derives the email_tone pattern note from every edit on file. Cheap enough (a few
    dozen short rows, capped output) to recompute from scratch each time rather than update
    incrementally. No-ops below MIN_SAMPLES_TO_ANALYZE — a couple of edits is just noise,
    not a pattern."""
    count = await _count_edits()
    if count < MIN_SAMPLES_TO_ANALYZE:
        return

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT original_text, edited_text FROM draft_edits ORDER BY created_at DESC LIMIT 30"
        )
        rows = await cur.fetchall()

    pairs_text = "\n\n".join(
        f"DRAFT: {r['original_text']}\nEDITED: {r['edited_text']}" for r in rows
    )
    try:
        note = await call_llm_fn(EMAIL_TONE_ANALYSIS_PROMPT, pairs_text, max_tokens=200)
    except Exception as e:
        print(f"⚠️ [pattern_learning] email tone analysis failed: {e}")
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO learned_patterns (category, note, sample_count, updated_at)
               VALUES ('email_tone', ?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET note=excluded.note,
               sample_count=excluded.sample_count, updated_at=excluded.updated_at""",
            (note.strip(), count, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def _recent_reminders(limit: int = 40) -> list:
    """Newest reminders first. Reads the reminders table directly — it lives in the same DB,
    and this module only ever reads it, never writes, so no coupling to reminders.py."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT text, kind, run_at, hour, minute, day_of_week FROM reminders "
            "ORDER BY created_at DESC LIMIT ?",
            (limit,),
        )
        return [dict(r) for r in await cur.fetchall()]


def _fmt_reminder(r: dict) -> str:
    kind = r.get("kind")
    text = (r.get("text") or "").strip()
    if kind == "once":
        return f"once | {r.get('run_at')} | {text}"
    if kind == "daily":
        return f"daily | {r.get('hour'):02d}:{r.get('minute'):02d} | {text}"
    if kind == "weekly":
        return f"weekly {r.get('day_of_week')} | {r.get('hour'):02d}:{r.get('minute'):02d} | {text}"
    return f"{kind} | {text}"


async def refresh_reminder_timing_pattern(call_llm_fn) -> None:
    """Re-derives the reminder_timing note from recent reminder history. Same shape as
    refresh_email_tone_pattern: no-ops below MIN_SAMPLES_TO_ANALYZE, recomputes from scratch,
    caps output. Fire-and-forget from the reminder-set path — never block the confirmation."""
    rows = await _recent_reminders()
    if len(rows) < MIN_SAMPLES_TO_ANALYZE:
        return

    listing = "\n".join(_fmt_reminder(r) for r in rows)
    try:
        note = await call_llm_fn(REMINDER_TIMING_ANALYSIS_PROMPT, listing, max_tokens=200)
    except Exception as e:
        print(f"⚠️ [pattern_learning] reminder timing analysis failed: {e}")
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO learned_patterns (category, note, sample_count, updated_at)
               VALUES ('reminder_timing', ?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET note=excluded.note,
               sample_count=excluded.sample_count, updated_at=excluded.updated_at""",
            (note.strip(), len(rows), datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def _recent_calendar_events(limit: int = 40) -> list:
    """Newest created events first, read from calendar_agent's local log table. Read-only."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        try:
            cur = await db.execute(
                "SELECT summary, start_dt, end_dt, has_attendees FROM calendar_events_log "
                "ORDER BY created_at DESC LIMIT ?",
                (limit,),
            )
        except Exception:
            return []  # table not created yet (calendar agent never initialized)
        return [dict(r) for r in await cur.fetchall()]


def _fmt_calendar_event(r: dict) -> str:
    att = "yes" if r.get("has_attendees") else "no"
    return f"{r.get('start_dt')} -> {r.get('end_dt')} | attendees:{att} | {(r.get('summary') or '').strip()}"


async def refresh_calendar_prefs_pattern(call_llm_fn) -> None:
    """Re-derives the calendar_prefs note from recent created-event history. Same shape as the
    other refreshers: no-ops below MIN_SAMPLES_TO_ANALYZE, recomputes from scratch, capped."""
    rows = await _recent_calendar_events()
    if len(rows) < MIN_SAMPLES_TO_ANALYZE:
        return

    listing = "\n".join(_fmt_calendar_event(r) for r in rows)
    try:
        note = await call_llm_fn(CALENDAR_PREFS_ANALYSIS_PROMPT, listing, max_tokens=200)
    except Exception as e:
        print(f"⚠️ [pattern_learning] calendar prefs analysis failed: {e}")
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO learned_patterns (category, note, sample_count, updated_at)
               VALUES ('calendar_prefs', ?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET note=excluded.note,
               sample_count=excluded.sample_count, updated_at=excluded.updated_at""",
            (note.strip(), len(rows), datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def _recent_user_messages(limit: int = 40) -> list:
    """Newest first: only the user's own messages (role='user') from chat_history — the signal
    for how Madan writes. Assistant turns are excluded so we learn his voice, not our own."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        try:
            cur = await db.execute(
                "SELECT content FROM chat_history WHERE role = 'user' ORDER BY id DESC LIMIT ?",
                (limit,),
            )
        except Exception:
            return []
        return [r["content"] for r in await cur.fetchall() if (r["content"] or "").strip()]


async def refresh_reply_style_pattern(call_llm_fn) -> None:
    """Re-derives the reply_style note from how Madan writes his own messages. This is the
    cross-cutting one — its note feeds every JARVIS-generated reply, not a single agent.
    Needs a slightly larger sample than the others; short bursts aren't a style."""
    msgs = await _recent_user_messages()
    if len(msgs) < 5:
        return

    sample = "\n".join(f"- {m}" for m in msgs)
    try:
        note = await call_llm_fn(REPLY_STYLE_ANALYSIS_PROMPT, sample, max_tokens=200)
    except Exception as e:
        print(f"⚠️ [pattern_learning] reply style analysis failed: {e}")
        return

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO learned_patterns (category, note, sample_count, updated_at)
               VALUES ('reply_style', ?, ?, ?)
               ON CONFLICT(category) DO UPDATE SET note=excluded.note,
               sample_count=excluded.sample_count, updated_at=excluded.updated_at""",
            (note.strip(), len(msgs), datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def refresh_all_patterns(call_llm_fn) -> None:
    """Recompute every category from whatever history exists — for periodic upkeep (the weekly
    cron). Each refresher self-guards on its own minimum sample count, so this is safe to call
    anytime; categories with too little data simply stay empty. One failing category never
    blocks the others."""
    for fn in (
        refresh_email_tone_pattern,
        refresh_reminder_timing_pattern,
        refresh_calendar_prefs_pattern,
        refresh_reply_style_pattern,
    ):
        try:
            await fn(call_llm_fn)
        except Exception as e:
            print(f"⚠️ [pattern_learning] {fn.__name__} failed in refresh_all: {e}")


async def get_pattern_context(category: str) -> str:
    """Returns a short prompt-ready note for the given category, or '' if nothing learned
    yet for it — callers must treat this as optional context, never required, since most
    categories will be empty until their source table has real usage history."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT note FROM learned_patterns WHERE category = ?", (category,))
        row = await cur.fetchone()
        return row["note"] if row else ""
