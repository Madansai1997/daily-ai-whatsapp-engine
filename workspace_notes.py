"""
Workspace Notes — a small DB-backed markdown scratchpad for the console.

Deliberately minimal: one table, plain CRUD, no LLM. A place to keep interview prep, salary
targets, recruiter names, "why this company" notes — anything that shouldn't live only in the
user's head. Rendered as markdown in the console.
"""

import os
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))


def init_workspace_notes_tables():
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS workspace_notes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        body TEXT,
        pinned INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Workspace Notes table ready.")


async def list_notes() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM workspace_notes ORDER BY pinned DESC, updated_at DESC")
        return [dict(r) for r in await cur.fetchall()]


async def get_note(note_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM workspace_notes WHERE id = ?", (note_id,))
        row = await cur.fetchone()
    return dict(row) if row else None


async def create_note(title: str = "", body: str = "") -> dict:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO workspace_notes (title, body, created_at, updated_at) VALUES (?,?,?,?)",
            ((title or "Untitled").strip() or "Untitled", (body or "").strip(), now, now))
        await db.commit()
        nid = cur.lastrowid
    return await get_note(nid)


async def update_note(note_id: int, title: str = None, body: str = None,
                      pinned: int = None) -> dict:
    sets, args = [], []
    if title is not None:
        sets.append("title = ?"); args.append((title or "Untitled").strip() or "Untitled")
    if body is not None:
        sets.append("body = ?"); args.append((body or "").strip())
    if pinned is not None:
        sets.append("pinned = ?"); args.append(1 if pinned else 0)
    if not sets:
        return await get_note(note_id)
    sets.append("updated_at = ?"); args.append(datetime.now(timezone.utc).isoformat())
    args.append(note_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE workspace_notes SET {', '.join(sets)} WHERE id = ?", args)
        await db.commit()
    return await get_note(note_id)


async def delete_note(note_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM workspace_notes WHERE id = ?", (note_id,))
        await db.commit()
    return True
