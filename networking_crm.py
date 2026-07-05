"""
Thin Networking CRM — track the people behind the applications.

Recruiters, referrers, hiring managers, peers. Just enough to never let a warm contact go cold:
who they are, when you last talked, and when you're due to reach out again. No enrichment APIs
(out of budget) — you type what you know. Pairs with the follow-up agent, but for humans rather
than job cards.
"""

import os
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

RELATIONSHIPS = ["recruiter", "referrer", "hiring_manager", "peer", "mentor", "other"]


def init_networking_crm_tables():
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS contacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT,
        role TEXT,
        company TEXT,
        email TEXT,
        linkedin TEXT,
        relationship TEXT DEFAULT 'other',
        follow_up_days INTEGER DEFAULT 14,
        last_contacted TEXT,
        notes TEXT,
        created_at TEXT,
        updated_at TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Networking CRM table ready.")


def _parse(s):
    if not s:
        return None
    try:
        s = s.strip().replace("Z", "+00:00")
        if "T" not in s and " " in s:
            s = s.replace(" ", "T", 1)
        d = datetime.fromisoformat(s)
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
    except Exception:
        return None


def _enrich(row: dict) -> dict:
    """Attach follow-up status: days_since_contact + whether a nudge is due."""
    now = datetime.now(timezone.utc)
    lc = _parse(row.get("last_contacted"))
    if lc is None:
        row["days_since_contact"] = None
        row["due"] = True  # never contacted → reach out
    else:
        days = (now - lc).total_seconds() / 86400.0
        row["days_since_contact"] = int(days)
        row["due"] = days >= (row.get("follow_up_days") or 14)
    return row


async def list_contacts() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM contacts ORDER BY company, name")
        return [_enrich(dict(r)) for r in await cur.fetchall()]


async def due_contacts() -> list:
    return [c for c in await list_contacts() if c.get("due")]


async def get_contact(cid: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM contacts WHERE id = ?", (cid,))
        row = await cur.fetchone()
    return _enrich(dict(row)) if row else None


async def add_contact(data: dict) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    rel = (data.get("relationship") or "other").strip().lower()
    rel = rel if rel in RELATIONSHIPS else "other"
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """INSERT INTO contacts (name, role, company, email, linkedin, relationship,
               follow_up_days, last_contacted, notes, created_at, updated_at)
               VALUES (?,?,?,?,?,?,?,?,?,?,?)""",
            ((data.get("name") or "").strip() or "Unnamed", (data.get("role") or "").strip(),
             (data.get("company") or "").strip(), (data.get("email") or "").strip(),
             (data.get("linkedin") or "").strip(), rel,
             int(data.get("follow_up_days") or 14),
             (data.get("last_contacted") or None), (data.get("notes") or "").strip(), now, now))
        await db.commit()
        cid = cur.lastrowid
    return await get_contact(cid)


async def update_contact(cid: int, data: dict) -> dict:
    fields = {k: data[k] for k in
              ("name", "role", "company", "email", "linkedin", "relationship",
               "follow_up_days", "last_contacted", "notes") if k in data}
    if "relationship" in fields:
        r = (fields["relationship"] or "other").strip().lower()
        fields["relationship"] = r if r in RELATIONSHIPS else "other"
    if "follow_up_days" in fields:
        fields["follow_up_days"] = int(fields["follow_up_days"] or 14)
    if not fields:
        return await get_contact(cid)
    fields["updated_at"] = datetime.now(timezone.utc).isoformat()
    sets = ", ".join(f"{k} = ?" for k in fields)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE contacts SET {sets} WHERE id = ?", (*fields.values(), cid))
        await db.commit()
    return await get_contact(cid)


async def mark_contacted(cid: int) -> dict:
    """Stamp last_contacted = now (resets the follow-up clock)."""
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE contacts SET last_contacted = ?, updated_at = ? WHERE id = ?", (now, now, cid))
        await db.commit()
    return await get_contact(cid)


async def delete_contact(cid: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM contacts WHERE id = ?", (cid,))
        await db.commit()
    return True
