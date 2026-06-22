"""
Reminders Agent — self-contained skill module.

Isolated from V3_updates.py on purpose: its own table, its own job registration logic.
V3_updates.py owns the live APScheduler instance and only calls the public functions below.

APScheduler's default job store is in-memory only, so a server restart loses any scheduled
jobs that aren't re-added. To survive that, every reminder is persisted here first and
register_all_active_reminders() must be called once at startup to re-add anything pending.
"""

import os
import sqlite3
import aiosqlite
from datetime import datetime, timezone
from apscheduler.triggers.date import DateTrigger

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))


def init_reminder_tables():
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS reminders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        text TEXT NOT NULL,
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
    print("✅ Reminder tables ready.")


async def save_reminder(text, kind, run_at=None, hour=None, minute=None, day_of_week=None) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            """INSERT INTO reminders (text, kind, run_at, hour, minute, day_of_week, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'active', ?)""",
            (text, kind, run_at, hour, minute, day_of_week, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()
        return cur.lastrowid


async def get_active_reminders() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM reminders WHERE status = 'active'")
        rows = await cur.fetchall()
        return [dict(row) for row in rows]


async def mark_fired(reminder_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE reminders SET status = 'fired' WHERE id = ?", (reminder_id,))
        await db.commit()


async def fire_reminder(reminder_id: int, text: str, kind: str, notify_fn):
    try:
        notify_fn(f"⏰ *Reminder:* {text}")
    except Exception as e:
        print(f"⚠️ [reminders] notify_fn failed for reminder {reminder_id}: {e}")
    if kind == "once":
        await mark_fired(reminder_id)


def register_reminder_job(scheduler, row: dict, notify_fn):
    """Add (or re-add, e.g. after a restart) this reminder's job on the live scheduler."""
    job_id = f"reminder_{row['id']}"
    args = [row["id"], row["text"], row["kind"], notify_fn]
    # Generous grace period — classification latency or a missed scheduler tick shouldn't silently drop a reminder.
    misfire_grace_time = 300
    try:
        if row["kind"] == "once":
            run_at = datetime.fromisoformat(row["run_at"])
            scheduler.add_job(fire_reminder, DateTrigger(run_date=run_at), args=args, id=job_id,
                               replace_existing=True, misfire_grace_time=misfire_grace_time)
        elif row["kind"] == "daily":
            scheduler.add_job(fire_reminder, "cron", hour=row["hour"], minute=row["minute"],
                               args=args, id=job_id, replace_existing=True, misfire_grace_time=misfire_grace_time)
        elif row["kind"] == "weekly":
            scheduler.add_job(fire_reminder, "cron", day_of_week=row["day_of_week"], hour=row["hour"],
                               minute=row["minute"], args=args, id=job_id, replace_existing=True,
                               misfire_grace_time=misfire_grace_time)
        else:
            print(f"⚠️ [reminders] Unknown kind '{row['kind']}' for reminder {row['id']}")
    except Exception as e:
        print(f"⚠️ [reminders] Failed to register job for reminder {row['id']}: {e}")


async def register_all_active_reminders(scheduler, notify_fn) -> int:
    """Call once at startup so reminders survive a server restart.

    A 'once' reminder whose run_at already passed while the app was down would
    otherwise be silently dropped by APScheduler (misfire window exceeded, no
    notification, row stuck at status='active' forever). Catch that here:
    notify Madan it was missed and close the row instead of registering it.
    """
    rows = await get_active_reminders()
    restored = 0
    now = datetime.now()
    for row in rows:
        if row["kind"] == "once" and datetime.fromisoformat(row["run_at"]) <= now:
            run_at = datetime.fromisoformat(row["run_at"])
            try:
                notify_fn(
                    f"⏰ *Missed Reminder*\n\n"
                    f"You had a reminder that fired while the system was restarting:\n\n"
                    f"📌 {row['text']}\n"
                    f"🕐 Was due: {run_at.strftime('%d %b at %I:%M %p')}"
                )
            except Exception as e:
                print(f"⚠️ [reminders] Failed to send missed-reminder notice for {row['id']}: {e}")
            await mark_fired(row["id"])
            continue
        register_reminder_job(scheduler, row, notify_fn)
        restored += 1
    return restored


async def create_reminder_from_intent(scheduler, reminder: dict, notify_fn):
    """
    reminder: {"text": str, "kind": "once"|"daily"|"weekly", "run_at": iso str|None,
               "hour": int|None, "minute": int|None, "day_of_week": str|None}
    Validates, persists, and registers the job. Returns (success, human-readable message).
    """
    reminder = reminder or {}
    text = reminder.get("text")
    kind = reminder.get("kind")
    if not text or kind not in ("once", "daily", "weekly"):
        return False, "Couldn't understand the reminder details."

    run_at = reminder.get("run_at")
    hour = reminder.get("hour")
    minute = reminder.get("minute")
    day_of_week = reminder.get("day_of_week")

    if kind == "once":
        if not run_at:
            return False, "Couldn't figure out when to remind you."
        try:
            datetime.fromisoformat(run_at)
        except ValueError:
            return False, "Couldn't understand the date/time for this reminder."
    else:
        if hour is None or minute is None or (kind == "weekly" and not day_of_week):
            return False, "Couldn't figure out the recurring schedule."

    reminder_id = await save_reminder(text, kind, run_at, hour, minute, day_of_week)
    row = {"id": reminder_id, "text": text, "kind": kind, "run_at": run_at,
           "hour": hour, "minute": minute, "day_of_week": day_of_week}
    register_reminder_job(scheduler, row, notify_fn)

    if kind == "once":
        when = datetime.fromisoformat(run_at).strftime("%b %d at %I:%M %p")
    elif kind == "daily":
        when = f"every day at {hour:02d}:{minute:02d}"
    else:
        when = f"every {day_of_week} at {hour:02d}:{minute:02d}"
    return True, f"⏰ *Reminder set:* {text}\n_({when})_"
