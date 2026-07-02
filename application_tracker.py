"""
Application Tracker Agent — self-contained skill module (Phase 4).

Tracks job applications through their lifecycle. Sibling to job_scout_agent.py: a "TRACK <n>"
reply on a Job Scout digest hands the nth job here (the engine wires the two — this module
never imports job_scout). Also supports listing the pipeline and updating a status by name.

Own table, own error handling. No third-party sends, so no approval-hold pattern needed.
"""

import os
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

# Lifecycle stages, in pipeline order. LLM/user phrasing is mapped onto these.
VALID_STATUSES = ["interested", "applied", "interviewing", "offer", "accepted", "rejected"]
_STATUS_EMOJI = {
    "interested": "👀", "applied": "📨", "interviewing": "🗣️",
    "offer": "🎉", "accepted": "✅", "rejected": "❌",
}


def init_application_tracker_tables():
    """Synchronous, mirrors init_db_tables() in V3_updates.py — called once at startup."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS applications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_key TEXT UNIQUE,
        title TEXT, company TEXT, location TEXT, url TEXT, source TEXT,
        description TEXT,
        status TEXT DEFAULT 'applied',
        notes TEXT,
        applied_at TEXT,
        updated_at TEXT
    )''')
    # Migration: add description to a pre-existing applications table if missing.
    try:
        cols = [r[1] for r in cur.execute("PRAGMA table_info(applications)").fetchall()]
        if "description" not in cols:
            cur.execute("ALTER TABLE applications ADD COLUMN description TEXT")
    except Exception:
        pass
    conn.commit()
    conn.close()
    print("✅ Application Tracker tables ready.")


def _normalize_status(raw: str) -> str:
    """Map free phrasing onto a canonical stage (e.g. 'interview' -> 'interviewing')."""
    s = (raw or "").strip().lower()
    aliases = {
        "interview": "interviewing", "interviews": "interviewing",
        "applied to": "applied", "apply": "applied",
        "got an offer": "offer", "offered": "offer",
        "accept": "accepted", "accepted offer": "accepted",
        "reject": "rejected", "rejection": "rejected", "declined": "rejected",
        "watching": "interested", "saved": "interested",
    }
    if s in VALID_STATUSES:
        return s
    return aliases.get(s, s)


async def add_application(job: dict, status: str = "applied") -> tuple:
    """Add a job (usually from a Job Scout digest) to the tracker. Idempotent on job_key."""
    job = job or {}
    title = (job.get("title") or "").strip()
    if not title:
        return False, "Couldn't read that job — try TRACK on a fresh search."
    status = _normalize_status(status) or "applied"
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        # Already tracked? (same job_key)
        if job.get("key"):
            cur = await db.execute("SELECT id FROM applications WHERE job_key = ?", (job["key"],))
            if await cur.fetchone():
                return False, f"📌 *{title}* — {job.get('company','')} is already in your tracker."
        await db.execute(
            """INSERT OR IGNORE INTO applications
               (job_key, title, company, location, url, source, description, status, applied_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?)""",
            (job.get("key"), title, job.get("company"), job.get("location"),
             job.get("url"), job.get("source"), job.get("description"), status, now, now),
        )
        await db.commit()
    emoji = _STATUS_EMOJI.get(status, "📌")
    return True, f"{emoji} *Tracked:* {title} — {job.get('company','')}\n_Status: {status}_"


async def list_applications(status_filter: str = None) -> list:
    q = "SELECT * FROM applications"
    args = ()
    if status_filter:
        q += " WHERE status = ?"
        args = (_normalize_status(status_filter),)
    q += " ORDER BY updated_at DESC"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(q, args)
        return [dict(r) for r in await cur.fetchall()]


async def update_status(query: str, new_status: str) -> tuple:
    """Update the status of the application whose company/title matches `query` (substring,
    case-insensitive). Ambiguity is surfaced rather than guessed."""
    status = _normalize_status(new_status)
    if status not in VALID_STATUSES:
        return False, (f"Not a known status. Use one of: {', '.join(VALID_STATUSES)}.")
    like = f"%{(query or '').strip().lower()}%"
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, title, company FROM applications "
            "WHERE lower(company) LIKE ? OR lower(title) LIKE ?", (like, like))
        rows = [dict(r) for r in await cur.fetchall()]
        if not rows:
            return False, f"🤷 No tracked application matching \"{query}\"."
        if len(rows) > 1:
            names = "\n".join(f"- {r['title']} — {r['company']}" for r in rows)
            return False, f"⚠️ More than one match — be more specific:\n\n{names}"
        await db.execute("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?",
                         (status, now, rows[0]["id"]))
        await db.commit()
    emoji = _STATUS_EMOJI.get(status, "📌")
    return True, f"{emoji} *{rows[0]['title']}* — {rows[0]['company']} → *{status}*"


async def get_application(app_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM applications WHERE id = ?", (app_id,))
        row = await cur.fetchone()
    return dict(row) if row else None


async def update_status_by_id(app_id: int, new_status: str) -> tuple:
    """Update by primary key — used by the web UI (kanban), which knows exact ids."""
    status = _normalize_status(new_status)
    if status not in VALID_STATUSES:
        return False, f"Invalid status. Use one of: {', '.join(VALID_STATUSES)}."
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?",
                         (status, now, app_id))
        await db.commit()
    return True, status


async def delete_application(app_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        await db.commit()
    return True


def format_applications(apps: list) -> str:
    if not apps:
        return "📭 *Your job tracker is empty.* Reply TRACK <n> on a job search to add one."
    # Group by status in pipeline order.
    by_status = {s: [] for s in VALID_STATUSES}
    for a in apps:
        by_status.setdefault(a["status"], []).append(a)
    lines = [f"📋 *Your applications ({len(apps)}):*"]
    for s in VALID_STATUSES:
        group = by_status.get(s) or []
        if not group:
            continue
        lines.append(f"\n{_STATUS_EMOJI.get(s,'📌')} *{s.title()}* ({len(group)})")
        for a in group:
            loc = f" — {a['company']}" if a.get("company") else ""
            lines.append(f"  • {a['title']}{loc}")
    return "\n".join(lines)
