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
    # Append-only stage-transition ledger. The applications row only keeps the CURRENT status
    # (updated_at is overwritten on every change), so per-stage history — needed for response
    # time, ghost rate, and funnel analytics — is captured here and never mutated.
    cur.execute('''CREATE TABLE IF NOT EXISTS application_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        app_id INTEGER,
        from_status TEXT,
        to_status TEXT,
        at TEXT
    )''')
    # Migrations on a pre-existing applications table.
    try:
        cols = [r[1] for r in cur.execute("PRAGMA table_info(applications)").fetchall()]
        if "description" not in cols:
            cur.execute("ALTER TABLE applications ADD COLUMN description TEXT")
        # `reviewed` drives the Job Scout review queue. DEFAULT 1 so existing/manual/email
        # cards are NOT dumped into the queue — only fresh scout matches (added with
        # reviewed=0) surface for review.
        if "reviewed" not in cols:
            cur.execute("ALTER TABLE applications ADD COLUMN reviewed INTEGER DEFAULT 1")
    except Exception:
        pass
    conn.commit()
    conn.close()
    print("✅ Application Tracker tables ready.")


async def _log_event(db, app_id: int, from_status, to_status: str):
    """Append a stage-transition row. Called within an existing connection so it shares the
    caller's transaction. No-op when the stage didn't actually change."""
    if from_status == to_status:
        return
    await db.execute(
        "INSERT INTO application_events (app_id, from_status, to_status, at) VALUES (?,?,?,?)",
        (app_id, from_status, to_status, datetime.now(timezone.utc).isoformat()),
    )


async def list_application_events(app_id: int = None) -> list:
    """Stage-transition history, oldest first — for the response-analytics funnel."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if app_id is not None:
            cur = await db.execute(
                "SELECT * FROM application_events WHERE app_id = ? ORDER BY at ASC", (app_id,))
        else:
            cur = await db.execute("SELECT * FROM application_events ORDER BY at ASC")
        return [dict(r) for r in await cur.fetchall()]


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


async def add_application(job: dict, status: str = "applied", reviewed: int = 1,
                          notes: str = None) -> tuple:
    """Add a job to the tracker. Idempotent on job_key. `reviewed=0` puts it in the Job Scout
    review queue (used by the scout auto-track path); manual/email adds stay reviewed=1."""
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
        cur = await db.execute(
            """INSERT OR IGNORE INTO applications
               (job_key, title, company, location, url, source, description, status,
                notes, reviewed, applied_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?)""",
            (job.get("key"), title, job.get("company"), job.get("location"),
             job.get("url"), (job.get("publisher") or job.get("source")), job.get("description"), status,
             (notes if notes is not None else job.get("notes")), int(reviewed), now, now),
        )
        if cur.lastrowid:  # a row was actually inserted (not ignored as a dup)
            await _log_event(db, cur.lastrowid, None, status)
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
        cur = await db.execute("SELECT status FROM applications WHERE id = ?", (rows[0]["id"],))
        prev = (await cur.fetchone() or {})
        await db.execute("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?",
                         (status, now, rows[0]["id"]))
        await _log_event(db, rows[0]["id"], prev["status"] if prev else None, status)
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
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT status FROM applications WHERE id = ?", (app_id,))
        prev = await cur.fetchone()
        await db.execute("UPDATE applications SET status = ?, updated_at = ? WHERE id = ?",
                         (status, now, app_id))
        await _log_event(db, app_id, prev["status"] if prev else None, status)
        await db.commit()
    return True, status


async def delete_application(app_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM applications WHERE id = ?", (app_id,))
        await db.commit()
    return True


async def update_description(app_id: int, description: str) -> bool:
    """Attach/replace the job description on a card — used so manually/email-added jobs
    (which arrive with no JD) can still be ATS-analysed once the user pastes the posting."""
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE applications SET description = ?, updated_at = ? WHERE id = ?",
                         ((description or "").strip(), now, app_id))
        await db.commit()
    return True


async def add_scout_application(job: dict, status: str = "interested") -> tuple:
    """track_fn for the Job Scout digest — files the match AND flags it reviewed=0 so it lands
    in the console review queue."""
    return await add_application(job, status=status, reviewed=0)


async def list_review_queue() -> list:
    """Fresh scout matches awaiting review (reviewed=0), newest first."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM applications WHERE COALESCE(reviewed, 1) = 0 ORDER BY applied_at DESC")
        return [dict(r) for r in await cur.fetchall()]


async def count_review_queue() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) FROM applications WHERE COALESCE(reviewed, 1) = 0")
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def mark_reviewed(app_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE applications SET reviewed = 1, updated_at = ? WHERE id = ?",
                         (now, app_id))
        await db.commit()
    return True


# ── Response-analytics funnel ────────────────────────────────────────────────
# The pipeline in forward order. `rejected` is terminal/off-pipeline (still counts as a
# recruiter *response*, just a negative one) and is reported separately.
_PIPELINE = ["interested", "applied", "interviewing", "offer", "accepted"]


def _parse_iso(s):
    if not s:
        return None
    try:
        s = s.strip().replace("Z", "+00:00")
        if "T" not in s and " " in s:  # SQLite CURRENT_TIMESTAMP style
            s = s.replace(" ", "T", 1)
        dt = datetime.fromisoformat(s)
        return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt
    except Exception:
        return None


def _days_between(a, b):
    da, db = _parse_iso(a), _parse_iso(b)
    if not da or not db:
        return None
    return (db - da).total_seconds() / 86400.0


async def response_analytics(ghost_days: int = 14) -> dict:
    """Funnel + response metrics over the applications table and the append-only event ledger.

    Reaching a stage is derived from the event history when present (an app that later moved
    backwards still 'reached' its furthest stage) and falls back to the card's current status
    for pre-ledger rows. Pure read — no LLM cost."""
    apps = await list_applications()
    events = await list_application_events()
    ev_by_app = {}
    for e in events:
        ev_by_app.setdefault(e["app_id"], []).append(e)

    idx = {s: i for i, s in enumerate(_PIPELINE)}
    funnel = {s: 0 for s in _PIPELINE}
    rejected = 0
    source_stats = {}      # source -> {"applied": n, "responded": n}
    response_days = []     # applied -> first recruiter response, in days
    ghosted = 0
    applied_total = 0
    responded_total = 0
    now_iso = datetime.now(timezone.utc).isoformat()

    for a in apps:
        aid = a["id"]
        cur_status = a.get("status")
        evs = ev_by_app.get(aid, [])

        reached = {idx[e["to_status"]] for e in evs if e.get("to_status") in idx}
        if cur_status in idx:
            reached.add(idx[cur_status])
        max_idx = max(reached) if reached else -1

        for s, i in idx.items():
            if max_idx >= i:
                funnel[s] += 1
        if cur_status == "rejected":
            rejected += 1

        applied_reached = max_idx >= idx["applied"] or cur_status == "rejected"
        if not applied_reached:
            continue

        # When did it hit 'applied'? Prefer the event; fall back to the card timestamp.
        applied_at = next((e["at"] for e in evs if e.get("to_status") == "applied"), None) \
            or a.get("applied_at") or a.get("updated_at")

        source = (a.get("source") or "Unknown").strip() or "Unknown"
        applied_total += 1
        st = source_stats.setdefault(source, {"applied": 0, "responded": 0})
        st["applied"] += 1

        responded = max_idx >= idx["interviewing"] or cur_status == "rejected"
        if responded:
            responded_total += 1
            st["responded"] += 1
            resp_at = next(
                (e["at"] for e in evs
                 if e.get("to_status") in ("interviewing", "offer", "accepted", "rejected")),
                None)
            d = _days_between(applied_at, resp_at)
            if d is not None and d >= 0:
                response_days.append(d)
        elif cur_status == "applied":
            d = _days_between(applied_at, now_iso)
            if d is not None and d >= ghost_days:
                ghosted += 1

    sources = []
    for name, st in source_stats.items():
        y = round(100 * st["responded"] / st["applied"]) if st["applied"] else 0
        sources.append({"source": name, "applied": st["applied"],
                        "responded": st["responded"], "yield": y})
    sources.sort(key=lambda s: (-s["applied"], s["source"]))

    return {
        "funnel": [{"stage": s, "count": funnel[s]} for s in _PIPELINE],
        "rejected": rejected,
        "applied_total": applied_total,
        "response_rate": round(100 * responded_total / applied_total) if applied_total else 0,
        "responded_total": responded_total,
        "avg_response_days": round(sum(response_days) / len(response_days), 1) if response_days else None,
        "ghost_rate": round(100 * ghosted / applied_total) if applied_total else 0,
        "ghosted": ghosted,
        "ghost_days": ghost_days,
        "sources": sources,
    }


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
