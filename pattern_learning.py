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


async def get_pattern_context(category: str) -> str:
    """Returns a short prompt-ready note for the given category, or '' if nothing learned
    yet for it — callers must treat this as optional context, never required, since most
    categories will be empty until their source table has real usage history."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT note FROM learned_patterns WHERE category = ?", (category,))
        row = await cur.fetchone()
        return row["note"] if row else ""
