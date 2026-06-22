"""
Email Triage Agent — self-contained skill module.

Isolated from V3_updates.py on purpose: its own tables, its own Gmail client,
its own error handling. V3_updates.py only imports the public functions below.
"""

import os
import json
import base64
import sqlite3
import aiosqlite
from datetime import datetime, timezone
from email.mime.text import MIMEText

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleAuthRequest
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

GMAIL_CLIENT_ID = os.getenv("GMAIL_CLIENT_ID")
GMAIL_CLIENT_SECRET = os.getenv("GMAIL_CLIENT_SECRET")
GMAIL_REFRESH_TOKEN = os.getenv("GMAIL_REFRESH_TOKEN")

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.modify"]

TRIAGE_SYSTEM_PROMPT = (
    "You are an email triage assistant. Given an email, classify it into exactly one of three tiers "
    "and optionally draft a reply. Respond with STRICT JSON only, no markdown, no commentary, matching "
    "exactly this shape:\n"
    '{"priority": "PRIORITY" or "MEDIUM" or "LOW", "reason": "short reason", "draft": "2-4 sentence reply" or null}\n'
    "Use PRIORITY for emails that need a timely human response (requests, questions, deadlines, important "
    "people) — these get a drafted reply.\n"
    "Use MEDIUM for things worth knowing about but that don't need a reply (account/security alerts, "
    "application or order status updates, FYI threads from real people or services about your accounts).\n"
    "Use LOW for pure noise (newsletters, marketing, promotions, spam-like content).\n"
    "Only include a non-null draft when priority is PRIORITY."
)


def init_email_tables():
    """Synchronous, mirrors init_db_tables() in V3_updates.py — called once at import/startup time."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute('''CREATE TABLE IF NOT EXISTS pending_drafts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id TEXT UNIQUE,
        sender TEXT,
        subject TEXT,
        snippet TEXT,
        priority TEXT,
        draft_reply TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS processed_emails (
        email_id TEXT PRIMARY KEY,
        processed_at TEXT
    )''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS email_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Email triage tables ready.")


def _get_gmail_service():
    if not (GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN):
        raise RuntimeError("Gmail credentials missing: set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN")
    creds = Credentials(
        token=None,
        refresh_token=GMAIL_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GMAIL_CLIENT_ID,
        client_secret=GMAIL_CLIENT_SECRET,
        scopes=GMAIL_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def _extract_header(headers, name):
    for h in headers:
        if h.get("name", "").lower() == name.lower():
            return h.get("value", "")
    return ""


async def _is_processed(email_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT 1 FROM processed_emails WHERE email_id = ?", (email_id,))
        row = await cur.fetchone()
        return row is not None


async def _mark_processed(email_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO processed_emails (email_id, processed_at) VALUES (?, ?)",
            (email_id, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def _set_meta(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO email_meta (key, value) VALUES (?, ?)", (key, value)
        )
        await db.commit()


async def _get_meta(key: str, default: str = "0") -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT value FROM email_meta WHERE key = ?", (key,))
        row = await cur.fetchone()
        return row[0] if row else default


def _format_priority_message(draft) -> str:
    return (
        f"📧 *Priority Email*\n\n"
        f"*From:* {draft['sender']}\n"
        f"*Subject:* {draft['subject']}\n\n"
        f"*Draft reply:*\n{draft['draft_reply']}\n\n"
        f"Reply *APPROVE EMAIL* to send as-is, *EDIT: <your text>* to change it first, "
        f"or *DON'T SEND* to discard this one."
    )


async def _save_draft(email_id, sender, subject, snippet, priority, draft_reply):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT OR IGNORE INTO pending_drafts
               (email_id, sender, subject, snippet, priority, draft_reply, status, created_at)
               VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)""",
            (email_id, sender, subject, snippet, priority, draft_reply, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def check_inbox_and_notify(call_llm_fn, notify_fn):
    """
    Fetch unread Gmail messages, classify each with the LLM, draft replies for
    PRIORITY emails, persist them, and notify_fn() the formatted summary.
    Any single email's failure is caught and logged — it never aborts the rest of the inbox check.
    """
    try:
        service = _get_gmail_service()
    except Exception as e:
        print(f"⚠️ [email_triage] Gmail auth failed: {e}")
        return

    try:
        results = service.users().messages().list(userId="me", labelIds=["UNREAD", "INBOX"], maxResults=20).execute()
        messages = results.get("messages", [])
    except HttpError as e:
        print(f"⚠️ [email_triage] Gmail list failed: {e}")
        return
    except Exception as e:
        print(f"⚠️ [email_triage] Unexpected error listing messages: {e}")
        return

    medium_emails = []
    low_emails = []
    new_priority_count = 0

    for msg_meta in messages:
        email_id = msg_meta.get("id")
        if not email_id:
            continue
        try:
            if await _is_processed(email_id):
                continue

            msg = service.users().messages().get(userId="me", id=email_id, format="metadata",
                                                   metadataHeaders=["From", "Subject"]).execute()
            headers = msg.get("payload", {}).get("headers", [])
            sender = _extract_header(headers, "From")
            subject = _extract_header(headers, "Subject")
            snippet = msg.get("snippet", "")

            try:
                raw = await call_llm_fn(
                    TRIAGE_SYSTEM_PROMPT,
                    f"From: {sender}\nSubject: {subject}\nSnippet: {snippet}",
                    max_tokens=400,
                )
                parsed = json.loads(raw)
                priority = parsed.get("priority", "LOW")
                draft = parsed.get("draft")
            except Exception as e:
                print(f"⚠️ [email_triage] LLM classification failed for {email_id}: {e}")
                await _mark_processed(email_id)
                continue

            if priority == "PRIORITY" and draft:
                await _save_draft(email_id, sender, subject, snippet, priority, draft)
                new_priority_count += 1
            elif priority == "MEDIUM":
                medium_emails.append((sender, subject))
            else:
                low_emails.append((sender, subject))

            await _mark_processed(email_id)

        except Exception as e:
            print(f"⚠️ [email_triage] Failed processing email {email_id}: {e}")
            continue

    await _set_meta("last_medium_count", str(len(medium_emails)))
    await _set_meta("last_low_count", str(len(low_emails)))

    sections = []
    if medium_emails:
        examples = "\n".join(f"- {sender}: {subject}" for sender, subject in medium_emails[:2])
        more = f"\n...and {len(medium_emails) - 2} more" if len(medium_emails) > 2 else ""
        sections.append(f"*Medium:*\n{examples}{more}")
    if low_emails:
        examples = "\n".join(f"- {sender}: {subject}" for sender, subject in low_emails[:2])
        more = f"\n...and {len(low_emails) - 2} more" if len(low_emails) > 2 else ""
        sections.append(f"*Low:*\n{examples}{more}")
    detail = ("\n\n" + "\n\n".join(sections)) if sections else " All clear."

    try:
        notify_fn(
            f"📊 *Inbox check:* {new_priority_count} new priority, "
            f"{len(medium_emails)} medium, {len(low_emails)} low.{detail}"
        )
    except Exception as e:
        print(f"⚠️ [email_triage] notify_fn failed for inbox check status: {e}")

    if not await get_active_draft():
        await activate_next_draft(notify_fn)


async def get_active_draft():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM pending_drafts WHERE status = 'active' LIMIT 1")
        row = await cur.fetchone()
        return dict(row) if row else None


async def activate_next_draft(notify_fn) -> bool:
    """
    Pop the oldest queued ('pending') draft, mark it 'active', and notify_fn() it.
    Returns False if the queue is empty — caller is responsible for any wrap-up message.
    """
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM pending_drafts WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
        )
        row = await cur.fetchone()
        if not row:
            return False
        draft = dict(row)
        await db.execute("UPDATE pending_drafts SET status = 'active' WHERE id = ?", (draft["id"],))
        await db.commit()

    try:
        notify_fn(_format_priority_message(draft))
    except Exception as e:
        print(f"⚠️ [email_triage] notify_fn failed activating draft {draft['id']}: {e}")
    return True


async def delete_draft(draft_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM pending_drafts WHERE id = ?", (draft_id,))
        await db.commit()


async def count_pending_drafts() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) FROM pending_drafts WHERE status = 'pending'")
        row = await cur.fetchone()
        return row[0]


async def get_medium_count() -> int:
    return int(await _get_meta("last_medium_count", "0"))


async def get_low_count() -> int:
    return int(await _get_meta("last_low_count", "0"))


async def approve_draft(draft_id: int):
    """Send the stored draft as a Gmail reply and mark it sent. Returns (success, message)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM pending_drafts WHERE id = ?", (draft_id,))
        row = await cur.fetchone()
        if not row:
            return False, "Draft not found."
        draft = dict(row)

    try:
        service = _get_gmail_service()
        message = MIMEText(draft["draft_reply"])
        message["to"] = draft["sender"]
        message["subject"] = f"Re: {draft['subject']}"
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode("utf-8")
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
    except Exception as e:
        print(f"⚠️ [email_triage] Send failed for draft {draft_id}: {e}")
        return False, f"Failed to send: {e}"

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE pending_drafts SET status = 'sent' WHERE id = ?", (draft_id,))
        await db.commit()
    return True, "Sent."


async def edit_draft(draft_id: int, new_text: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE pending_drafts SET draft_reply = ? WHERE id = ?", (new_text, draft_id))
        await db.commit()
