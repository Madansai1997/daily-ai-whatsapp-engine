"""
Calendar Agent — self-contained skill module (Phase 3).

Isolated from V3_updates.py on purpose, same pattern as email_triage.py/reminders.py:
own table, own Google API client, own error handling. V3_updates.py only imports the
public functions below.

Reuses the Gmail OAuth credentials (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN) — the refresh
token must have been minted with BOTH the gmail.modify and calendar scopes together
(see get_gmail_token.py). A Gmail-only token will fail Calendar API calls with a 403.

Events with attendees are NOT created immediately — inviting someone is "sending
something to someone else" (Google auto-emails them), so it goes through the same
hold-for-confirmation pattern as composed emails (pending_drafts in email_triage.py).
Events with no attendees are created immediately, same as setting a reminder.
"""

import os
import json
import sqlite3
import db_compat as aiosqlite
from datetime import datetime, timezone

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleAuthRequest
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN")

CALENDAR_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]

TIMEZONE = "Asia/Kolkata"


def init_calendar_tables():
    """Synchronous, mirrors init_db_tables() in V3_updates.py — called once at import/startup time."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS pending_calendar_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT,
        start_dt TEXT,
        end_dt TEXT,
        description TEXT,
        attendees TEXT,
        status TEXT DEFAULT 'pending_send',
        created_at TEXT
    )''')
    # Local log of events we actually created — the only place event history lives
    # locally (the Google API is the source of truth, but we don't want a live API
    # call just to learn timing/duration habits). Written on every successful create.
    cursor.execute('''CREATE TABLE IF NOT EXISTS calendar_events_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary TEXT,
        start_dt TEXT,
        end_dt TEXT,
        has_attendees INTEGER DEFAULT 0,
        created_at TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Calendar tables ready.")


async def log_created_event(summary: str, start_dt: str, end_dt: str, has_attendees: bool = False):
    """Record a created event locally so pattern_learning can mine timing/duration habits.
    Read-only for pattern_learning; this is the sole writer. Never raises to the caller."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO calendar_events_log (summary, start_dt, end_dt, has_attendees, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (summary, start_dt, end_dt, 1 if has_attendees else 0, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


def _get_calendar_service():
    if not (GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN):
        raise RuntimeError("Gmail/Calendar credentials missing: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN")
    creds = Credentials(
        token=None,
        refresh_token=GMAIL_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GMAIL_CLIENT_ID,
        client_secret=GMAIL_CLIENT_SECRET,
        scopes=CALENDAR_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return build("calendar", "v3", credentials=creds, cache_discovery=False)


def _event_body(summary, start_dt, end_dt, description=None, attendees=None):
    body = {
        "summary": summary,
        "start": {"dateTime": start_dt, "timeZone": TIMEZONE},
        "end": {"dateTime": end_dt, "timeZone": TIMEZONE},
    }
    if description:
        body["description"] = description
    if attendees:
        body["attendees"] = [{"email": a} for a in attendees]
    return body


def _simplify_event(event: dict) -> dict:
    start = event.get("start", {})
    end = event.get("end", {})
    return {
        "id": event.get("id"),
        "summary": event.get("summary", "(no title)"),
        "start": start.get("dateTime") or start.get("date"),
        "end": end.get("dateTime") or end.get("date"),
        "attendees": [a.get("email") for a in event.get("attendees", [])],
        "html_link": event.get("htmlLink"),
    }


async def list_upcoming_events(max_results: int = 10) -> list:
    """List upcoming events on the primary calendar, soonest first."""
    try:
        service = _get_calendar_service()
        now_iso = datetime.now(timezone.utc).isoformat()
        result = service.events().list(
            calendarId="primary", timeMin=now_iso, maxResults=max_results,
            singleEvents=True, orderBy="startTime",
        ).execute()
        return [_simplify_event(e) for e in result.get("items", [])]
    except Exception as e:
        print(f"⚠️ [calendar_agent] list_upcoming_events failed: {e}")
        return []


async def check_availability(start_dt: str, end_dt: str) -> list:
    """Return events overlapping the given ISO 8601 window — empty list means free."""
    try:
        service = _get_calendar_service()
        result = service.events().list(
            calendarId="primary", timeMin=start_dt, timeMax=end_dt, singleEvents=True,
        ).execute()
        return [_simplify_event(e) for e in result.get("items", [])]
    except Exception as e:
        print(f"⚠️ [calendar_agent] check_availability failed: {e}")
        return []


async def create_event(summary: str, start_dt: str, end_dt: str, description: str = None, attendees: list = None):
    """Actually create the event via the Calendar API. Returns a simplified event dict, or None on failure."""
    try:
        service = _get_calendar_service()
        body = _event_body(summary, start_dt, end_dt, description, attendees)
        created = service.events().insert(calendarId="primary", body=body, sendUpdates="all").execute()
        print(f"✅ Calendar event created: {summary} | ID: {created.get('id')}")
        try:
            await log_created_event(summary, start_dt, end_dt, bool(attendees))
        except Exception as e:
            print(f"⚠️ [calendar_agent] event log failed (non-fatal): {e}")
        return _simplify_event(created)
    except Exception as e:
        print(f"⚠️ [calendar_agent] create_event failed: {e}")
        return None


async def update_event(event_id: str, **fields) -> bool:
    """Patch an existing event. fields may include summary/start_dt/end_dt/description."""
    try:
        service = _get_calendar_service()
        body = {}
        if "summary" in fields:
            body["summary"] = fields["summary"]
        if "description" in fields:
            body["description"] = fields["description"]
        if "start_dt" in fields:
            body["start"] = {"dateTime": fields["start_dt"], "timeZone": TIMEZONE}
        if "end_dt" in fields:
            body["end"] = {"dateTime": fields["end_dt"], "timeZone": TIMEZONE}
        service.events().patch(calendarId="primary", eventId=event_id, body=body).execute()
        return True
    except Exception as e:
        print(f"⚠️ [calendar_agent] update_event failed: {e}")
        return False


async def delete_event(event_id: str) -> bool:
    try:
        service = _get_calendar_service()
        service.events().delete(calendarId="primary", eventId=event_id, sendUpdates="all").execute()
        return True
    except HttpError as e:
        if e.resp.status == 410:
            return True  # already deleted
        print(f"⚠️ [calendar_agent] delete_event failed: {e}")
        return False
    except Exception as e:
        print(f"⚠️ [calendar_agent] delete_event failed: {e}")
        return False


# =========================================================================
# PENDING EVENTS — events with attendees, held for confirmation before
# Google auto-emails the invite. Mirrors pending_drafts in email_triage.py.
# =========================================================================
async def save_pending_event(summary: str, start_dt: str, end_dt: str, description: str, attendees: list) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            """INSERT INTO pending_calendar_events
               (summary, start_dt, end_dt, description, attendees, status, created_at)
               VALUES (?, ?, ?, ?, ?, 'pending_send', ?)""",
            (summary, start_dt, end_dt, description, json.dumps(attendees or []), datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()
        return cursor.lastrowid


async def get_latest_pending_event():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM pending_calendar_events WHERE status = 'pending_send' ORDER BY created_at DESC LIMIT 1"
        )
        row = await cur.fetchone()
        if not row:
            return None
        event = dict(row)
        event["attendees"] = json.loads(event["attendees"] or "[]")
        return event


async def cancel_pending_event(pending_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE pending_calendar_events SET status = 'cancelled' WHERE id = ?", (pending_id,))
        await db.commit()


async def confirm_pending_event(pending_id: int):
    """Mark a pending event as sent after create_event() succeeds for it."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE pending_calendar_events SET status = 'sent' WHERE id = ?", (pending_id,))
        await db.commit()
