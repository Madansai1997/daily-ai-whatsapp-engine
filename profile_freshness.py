"""
Profile-Freshness Nudge — keep your shop-window current.

Tracks the assets a job search actually depends on (résumé, LinkedIn, GitHub, portfolio) and
flags the ones going stale so a recruiter never lands on a six-month-old profile. The résumé's
freshness is read automatically from the résumé template's updated_at; the rest you mark done
when you refresh them. No external calls.
"""

import os
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

# (name, default interval days, auto-source). Seeded once so the panel isn't empty on day one.
_DEFAULTS = [
    ("Résumé", 30, "resume_template"),
    ("LinkedIn", 45, None),
    ("GitHub", 60, None),
    ("Portfolio", 90, None),
]


def init_profile_freshness_tables():
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS profile_assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE,
        url TEXT,
        interval_days INTEGER DEFAULT 30,
        auto_source TEXT,
        last_updated TEXT,
        created_at TEXT
    )''')
    # Seed the standard assets once (only if the table is empty).
    n = cur.execute("SELECT COUNT(*) FROM profile_assets").fetchone()[0]
    if n == 0:
        now = datetime.now(timezone.utc).isoformat()
        for name, interval, src in _DEFAULTS:
            cur.execute(
                "INSERT INTO profile_assets (name, interval_days, auto_source, created_at) "
                "VALUES (?,?,?,?)", (name, interval, src, now))
    conn.commit()
    conn.close()
    print("✅ Profile-Freshness table ready.")


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


async def _resume_updated_at(db):
    """Latest résumé-template updated_at (auto freshness source for the Résumé asset)."""
    try:
        cur = await db.execute("SELECT MAX(updated_at) FROM user_resume_templates")
        row = await cur.fetchone()
        return row[0] if row else None
    except Exception:
        return None


def _status(days_since, interval):
    if days_since is None:
        return "unknown"
    if days_since >= interval:
        return "stale"
    if days_since >= interval * 0.7:
        return "aging"
    return "fresh"


async def list_assets() -> list:
    now = datetime.now(timezone.utc)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        resume_auto = await _resume_updated_at(db)
        cur = await db.execute("SELECT * FROM profile_assets ORDER BY id")
        rows = [dict(r) for r in await cur.fetchall()]
    out = []
    for r in rows:
        last = r.get("last_updated")
        if r.get("auto_source") == "resume_template" and resume_auto:
            # Auto-tracked: whichever is more recent (manual mark or the template save).
            last = max([x for x in (last, resume_auto) if x], default=resume_auto)
        d = _parse(last)
        days = int((now - d).total_seconds() / 86400.0) if d else None
        interval = r.get("interval_days") or 30
        out.append({
            "id": r["id"], "name": r["name"], "url": r.get("url"),
            "interval_days": interval, "auto": bool(r.get("auto_source")),
            "last_updated": last, "days_since": days, "status": _status(days, interval),
        })
    return out


async def stale_assets() -> list:
    return [a for a in await list_assets() if a["status"] in ("stale", "unknown")]


async def mark_updated(asset_id: int) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE profile_assets SET last_updated = ? WHERE id = ?", (now, asset_id))
        await db.commit()
    return True


async def update_asset(asset_id: int, url: str = None, interval_days: int = None) -> bool:
    sets, args = [], []
    if url is not None:
        sets.append("url = ?"); args.append(url.strip())
    if interval_days is not None:
        sets.append("interval_days = ?"); args.append(int(interval_days))
    if not sets:
        return False
    args.append(asset_id)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(f"UPDATE profile_assets SET {', '.join(sets)} WHERE id = ?", args)
        await db.commit()
    return True


async def add_asset(name: str, url: str = "", interval_days: int = 30) -> bool:
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO profile_assets (name, url, interval_days, created_at) "
            "VALUES (?,?,?,?)", ((name or "").strip(), (url or "").strip(),
                                 int(interval_days or 30), now))
        await db.commit()
    return True


async def delete_asset(asset_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM profile_assets WHERE id = ?", (asset_id,))
        await db.commit()
    return True
