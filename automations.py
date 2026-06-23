"""
Automations Agent — generalized scheduling engine (Phase 3 infrastructure).

reminders.py proved out the pattern (persist to SQLite, restore into APScheduler on
restart, handle missed-while-down jobs) but it's hardcoded to one action: fire a
WhatsApp message. This module generalizes that pattern so future phases (calendar
digests, job-scout searches, deadline watchers, ...) don't each reinvent their own
scheduler-table-plus-restore-function.

A row carries an action_type (a string key) and a payload (JSON) — V3_updates.py
supplies a dispatch_fn(action_type, payload) that knows how to actually execute
each action_type. This module only owns persistence/scheduling, never business logic.
"""

import os
import json
import sqlite3
import aiosqlite
from datetime import datetime, timezone
from apscheduler.triggers.date import DateTrigger

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))


def init_automation_tables():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS scheduled_automations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        action_type TEXT NOT NULL,
        payload TEXT,
        kind TEXT NOT NULL,
        run_at TEXT,
        hour INTEGER,
        minute INTEGER,
        day_of_week TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Automation tables ready.")


async def save_automation(action_type: str, payload: dict, kind: str, run_at=None, hour=None, minute=None, day_of_week=None) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """INSERT INTO scheduled_automations
               (action_type, payload, kind, run_at, hour, minute, day_of_week, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)""",
            (action_type, json.dumps(payload or {}), kind, run_at, hour, minute, day_of_week,
             datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()
        return cur.lastrowid


async def get_active_automations() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM scheduled_automations WHERE status = 'active'")
        rows = await cur.fetchall()
        out = []
        for row in rows:
            d = dict(row)
            d["payload"] = json.loads(d["payload"] or "{}")
            out.append(d)
        return out


async def mark_fired(automation_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE scheduled_automations SET status = 'fired' WHERE id = ?", (automation_id,))
        await db.commit()


async def fire_automation(automation_id: int, action_type: str, payload: dict, kind: str, dispatch_fn):
    try:
        result = dispatch_fn(action_type, payload)
        if hasattr(result, "__await__"):
            await result
    except Exception as e:
        print(f"⚠️ [automations] dispatch_fn failed for automation {automation_id} ({action_type}): {e}")
    if kind == "once":
        await mark_fired(automation_id)


def register_automation_job(scheduler, row: dict, dispatch_fn):
    """Add (or re-add, e.g. after a restart) this automation's job on the live scheduler."""
    job_id = f"automation_{row['id']}"
    args = [row["id"], row["action_type"], row["payload"], row["kind"], dispatch_fn]
    misfire_grace_time = 300
    try:
        if row["kind"] == "once":
            run_at = datetime.fromisoformat(row["run_at"])
            scheduler.add_job(fire_automation, DateTrigger(run_date=run_at), args=args, id=job_id,
                               replace_existing=True, misfire_grace_time=misfire_grace_time)
        elif row["kind"] == "daily":
            scheduler.add_job(fire_automation, "cron", hour=row["hour"], minute=row["minute"],
                               args=args, id=job_id, replace_existing=True, misfire_grace_time=misfire_grace_time)
        elif row["kind"] == "weekly":
            scheduler.add_job(fire_automation, "cron", day_of_week=row["day_of_week"], hour=row["hour"],
                               minute=row["minute"], args=args, id=job_id, replace_existing=True,
                               misfire_grace_time=misfire_grace_time)
        else:
            print(f"⚠️ [automations] Unknown kind '{row['kind']}' for automation {row['id']}")
    except Exception as e:
        print(f"⚠️ [automations] Failed to register job for automation {row['id']}: {e}")


async def register_all_active_automations(scheduler, dispatch_fn) -> int:
    """Call once at startup so automations survive a server restart.

    Same missed-while-down handling as reminders.py: a 'once' automation whose
    run_at already passed gets dispatched immediately (marked fired) instead of
    silently dropped by APScheduler's misfire window.
    """
    rows = await get_active_automations()
    restored = 0
    now = datetime.now()
    for row in rows:
        if row["kind"] == "once" and datetime.fromisoformat(row["run_at"]) <= now:
            try:
                result = dispatch_fn(row["action_type"], row["payload"])
                if hasattr(result, "__await__"):
                    await result
            except Exception as e:
                print(f"⚠️ [automations] Failed to dispatch missed automation {row['id']}: {e}")
            await mark_fired(row["id"])
            continue
        register_automation_job(scheduler, row, dispatch_fn)
        restored += 1
    return restored
