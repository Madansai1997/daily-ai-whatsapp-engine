"""
Application Email Tracker — reads Gmail and drives the Kanban board automatically.

Runs twice a day (morning + evening) via cron. For each email it can read, it asks
the LLM: is this about a job the user personally applied to, and what stage does it
signal — applied / interviewing / offer / accepted / rejected?

Then, per the user's chosen behaviour:
  • confident match to a board card → moves the card FORWARD automatically (+ notify, undoable)
  • confident, but the job isn't on the board yet → auto-adds the card at that stage
  • not sure which card it belongs to (generic sender, two roles at one company) → parks a
    "pending confirmation" the user resolves from the Jobs board; nothing moves silently.

Never moves a card backwards. 'rejected' can arrive from any stage (except accepted).
This module owns its own scan-state tables and drives application_tracker directly.
"""

import os
import re
import json
from datetime import datetime, timezone

import db_compat as aiosqlite

# Reuse the Gmail plumbing and header helpers from the triage agent.
from email_triage import _get_gmail_service, _extract_header, _short_sender
# This agent's whole job is to drive the application tracker, so it imports it directly.
from application_tracker import (
    list_applications,
    add_application,
    update_status_by_id,
    get_application,
    VALID_STATUSES,
)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

# Pipeline order for forward-only progression. 'rejected' is handled separately (terminal).
_RANK = {"interested": 0, "applied": 1, "interviewing": 2, "offer": 3, "accepted": 4}

CLASSIFY_PROMPT = (
    "You are JARVIS's application-tracking assistant. You are given a numbered list of the user's "
    "recent emails (sender, subject, snippet). For EACH email decide whether it is about the status of "
    "a job the USER PERSONALLY APPLIED TO — i.e. an application confirmation, an interview invite / "
    "scheduling / assessment, an offer, an acceptance, or a rejection.\n\n"
    "IMPORTANT: job ALERTS, newsletters, 'jobs you may like', marketing, recruiter cold-outreach for a "
    "role the user did NOT apply to, and general promotions are NOT application-status emails — mark those "
    "is_job=false.\n\n"
    "For each email return an object with:\n"
    '  "i": the email number,\n'
    '  "is_job": true/false,\n'
    '  "company": the employer name (best guess, or ""),\n'
    '  "role": the job title if stated (or ""),\n'
    '  "stage": one of "applied","interviewing","offer","accepted","rejected","none",\n'
    '  "confidence": "high" or "low" (how sure you are this is a real application-status email AND which '
    "company/role it is for).\n\n"
    "Use stage='applied' for 'we received your application' confirmations. Use 'interviewing' for any "
    "interview invite, scheduling, or online assessment/test. Use 'offer' for a job offer. Use 'accepted' "
    "only if the user has clearly accepted / is joining. Use 'rejected' for 'not moving forward', 'position "
    "filled', regret emails. If it's not an application-status email, is_job=false and stage='none'.\n\n"
    "Respond with STRICT JSON only — an array of these objects, no markdown, no commentary."
)


def init_application_email_tracker_tables():
    """Sync, mirrors the other init_*_tables() — called once at startup."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    # Emails we've already looked at, so a twice-daily scan never re-processes them.
    cur.execute('''CREATE TABLE IF NOT EXISTS application_scan_emails (
        email_id TEXT PRIMARY KEY,
        scanned_at TEXT
    )''')
    # Small key/value for scan bookkeeping (e.g. last_scan_at — controls first-run lookback).
    cur.execute('''CREATE TABLE IF NOT EXISTS application_scan_meta (
        key TEXT PRIMARY KEY,
        value TEXT
    )''')
    # Low-confidence / ambiguous matches parked for the user to confirm from the Jobs board.
    cur.execute('''CREATE TABLE IF NOT EXISTS application_email_pending (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email_id TEXT,
        kind TEXT,               -- 'move' or 'add'
        app_id INTEGER,          -- target application (for 'move')
        title TEXT, company TEXT, location TEXT, url TEXT, source TEXT,
        from_status TEXT, to_status TEXT,
        reason TEXT,
        sender TEXT, subject TEXT,
        created_at TEXT,
        resolved INTEGER DEFAULT 0   -- 0 open, 1 confirmed, 2 dismissed
    )''')
    conn.commit()
    conn.close()
    print("✅ Application Email Tracker tables ready.")


# ── small helpers ─────────────────────────────────────────────────────────────

def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (s or "").lower())


def _extract_json(text: str):
    """Pull a JSON array/object out of an LLM reply, tolerating ```fences``` and stray prose."""
    if not text:
        return None
    t = text.strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z]*\n?", "", t).rstrip("`").strip()
    # find the outermost [ ... ] or { ... }
    for open_c, close_c in (("[", "]"), ("{", "}")):
        i, j = t.find(open_c), t.rfind(close_c)
        if i != -1 and j != -1 and j > i:
            try:
                return json.loads(t[i:j + 1])
            except Exception:
                pass
    try:
        return json.loads(t)
    except Exception:
        return None


def _should_move(current: str, target: str) -> bool:
    """Forward-only. 'rejected' allowed from any stage except accepted/already-rejected."""
    current = (current or "").lower()
    target = (target or "").lower()
    if target == "rejected":
        return current not in ("accepted", "rejected")
    if current not in _RANK or target not in _RANK:
        return False
    return _RANK[target] > _RANK[current]


def _match_application(apps: list, company: str, role: str):
    """Return (kind, matches): kind is 'one' | 'none' | 'many'."""
    cn = _norm(company)
    if not cn:
        return "none", []
    matches = []
    for a in apps:
        acn = _norm(a.get("company"))
        if not acn:
            continue
        if cn == acn or cn in acn or acn in cn:
            matches.append(a)
    if len(matches) == 1:
        return "one", matches
    if not matches:
        return "none", []
    # Multiple cards at that company → try to disambiguate by role/title.
    rn = _norm(role)
    if rn:
        role_matches = [a for a in matches if rn in _norm(a.get("title")) or _norm(a.get("title")) in rn]
        if len(role_matches) == 1:
            return "one", role_matches
    return "many", matches


async def _meta_get(key: str, default: str = "") -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT value FROM application_scan_meta WHERE key = ?", (key,))
        row = await cur.fetchone()
    if not row:
        return default
    try:
        return row["value"]
    except Exception:
        return row[0]


async def _meta_set(key: str, value: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO application_scan_meta (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, value),
        )
        await db.commit()


async def _already_scanned(email_id: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT 1 FROM application_scan_emails WHERE email_id = ?", (email_id,))
        return (await cur.fetchone()) is not None


async def _mark_scanned(email_id: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO application_scan_emails (email_id, scanned_at) VALUES (?, ?)",
            (email_id, datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


async def _add_pending(row: dict):
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO application_email_pending
               (email_id, kind, app_id, title, company, location, url, source,
                from_status, to_status, reason, sender, subject, created_at, resolved)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,0)""",
            (row.get("email_id"), row.get("kind"), row.get("app_id"),
             row.get("title"), row.get("company"), row.get("location"), row.get("url"),
             row.get("source"), row.get("from_status"), row.get("to_status"),
             row.get("reason"), row.get("sender"), row.get("subject"), now),
        )
        await db.commit()


# ── main scan ─────────────────────────────────────────────────────────────────

async def scan_and_sync(call_llm_fn, notify_fn=None, max_emails: int = 40) -> dict:
    """Read recent Gmail and advance the board. Returns a summary dict. `notify_fn(body, category)`
    is the engine's notification sink (stored to the JARVIS inbox + pushed); optional."""
    def _notify(body, category="jobs"):
        if notify_fn and body:
            try:
                notify_fn(body, category)
            except Exception as e:
                print(f"⚠️ [app-email] notify failed: {e}")

    summary = {"scanned": 0, "moved": 0, "added": 0, "pending": 0, "skipped": 0, "error": None}

    try:
        service = _get_gmail_service()
    except Exception as e:
        summary["error"] = f"Gmail unreachable: {e}"
        print(f"⚠️ [app-email] {summary['error']}")
        return summary

    # First run looks back 30 days to catch existing applications; then just the last 3 days.
    first_run = not (await _meta_get("last_scan_at"))
    days = 30 if first_run else 3
    query = f"in:inbox newer_than:{days}d"

    try:
        resp = service.users().messages().list(userId="me", q=query, maxResults=max_emails).execute()
        msgs = resp.get("messages", [])
    except Exception as e:
        summary["error"] = f"Couldn't list inbox: {e}"
        print(f"⚠️ [app-email] {summary['error']}")
        return summary

    # Fetch details for the ones we haven't scanned yet.
    emails = []
    for m in msgs:
        eid = m.get("id")
        if not eid or await _already_scanned(eid):
            continue
        try:
            full = service.users().messages().get(
                userId="me", id=eid, format="metadata",
                metadataHeaders=["From", "Subject"]).execute()
            headers = full.get("payload", {}).get("headers", [])
            emails.append({
                "id": eid,
                "from_raw": _extract_header(headers, "From"),
                "sender": _short_sender(_extract_header(headers, "From")),
                "subject": _extract_header(headers, "Subject") or "(no subject)",
                "snippet": full.get("snippet", ""),
            })
        except Exception:
            continue

    if not emails:
        await _meta_set("last_scan_at", datetime.now(timezone.utc).isoformat())
        return summary

    # One LLM call classifies the whole batch (cheap on instance-hours).
    listing = "\n".join(
        f"{i+1}. From: {e['sender']} <{e['from_raw']}> | Subject: {e['subject']} | {e['snippet'][:200]}"
        for i, e in enumerate(emails)
    )
    classifications = []
    try:
        raw = await call_llm_fn(CLASSIFY_PROMPT, listing, max_tokens=900)
        parsed = _extract_json(raw)
        if isinstance(parsed, list):
            classifications = parsed
        elif isinstance(parsed, dict):
            classifications = [parsed]
    except Exception as e:
        print(f"⚠️ [app-email] classification failed: {e}")

    by_index = {}
    for c in classifications:
        try:
            by_index[int(c.get("i"))] = c
        except Exception:
            continue

    for idx, e in enumerate(emails, start=1):
        summary["scanned"] += 1
        await _mark_scanned(e["id"])  # never look at this email again
        c = by_index.get(idx)
        if not c or not c.get("is_job"):
            continue
        stage = (c.get("stage") or "none").lower()
        if stage not in VALID_STATUSES or stage == "interested":
            summary["skipped"] += 1
            continue
        company = (c.get("company") or "").strip()
        role = (c.get("role") or "").strip()
        confidence = (c.get("confidence") or "low").lower()

        apps = await list_applications()
        kind, matches = _match_application(apps, company, role)

        # Low confidence anywhere, OR genuinely ambiguous company → ask the user to confirm.
        if confidence != "high" or kind == "many":
            if kind in ("one", "many"):
                # 'many' = several cards at that company; propose a move on the best candidate
                # (one that can still advance to `stage`), naming the alternatives for context.
                if kind == "one":
                    app = matches[0]
                    extra = ""
                else:
                    cands = [a for a in matches if _should_move(a.get("status"), stage)] or matches
                    app = cands[0]  # list_applications is ordered most-recently-updated first
                    others = [a.get("title") for a in matches if a["id"] != app["id"]]
                    extra = f" (other roles at {company}: {', '.join(others)})" if others else ""
                await _add_pending({
                    "email_id": e["id"], "kind": "move", "app_id": app["id"],
                    "title": app.get("title"), "company": app.get("company"),
                    "from_status": app.get("status"), "to_status": stage,
                    "reason": f"Email from {e['sender']} — {e['subject']}{extra}",
                    "sender": e["sender"], "subject": e["subject"],
                })
                desc = f"{app.get('title')} — {app.get('company','')}"
            else:  # kind == 'none' → not on the board; propose adding it
                add_title = role or (f"Role at {company}" if company else e["subject"][:80])
                await _add_pending({
                    "email_id": e["id"], "kind": "add",
                    "title": add_title, "company": company,
                    "source": "Email", "to_status": stage,
                    "reason": f"Email from {e['sender']} — {e['subject']}",
                    "sender": e["sender"], "subject": e["subject"],
                })
                desc = f"{add_title}{f' — {company}' if company else ''}"
            summary["pending"] += 1
            _notify(
                f"🔎 *Possible update — confirm?* {desc} looks like it moved to *{stage}* "
                f"(email from {e['sender']}). Open *Jobs* to confirm or dismiss.",
                "jobs",
            )
            continue

        # Confident match to exactly one card → move it forward automatically.
        if kind == "one":
            app = matches[0]
            if _should_move(app.get("status"), stage):
                ok, _ = await update_status_by_id(app["id"], stage)
                if ok:
                    summary["moved"] += 1
                    _notify(
                        f"📨 Moved *{app.get('title')}* — {app.get('company','')} "
                        f"→ *{stage.upper()}* (email from {e['sender']}).",
                        "jobs",
                    )
            else:
                summary["skipped"] += 1
            continue

        # Confident, but not on the board yet → auto-add at that stage.
        if kind == "none":
            slug = _norm(f"{role}{company}")
            job = {
                "key": f"email:{slug}" if slug else f"email:{e['id']}",
                "title": role or (e["subject"][:80]) or "Job application",
                "company": company, "location": "", "url": "", "source": "Email",
            }
            added, _ = await add_application(job, status=stage)
            if added:
                summary["added"] += 1
                _notify(
                    f"➕ Added *{job['title']}*{f' — {company}' if company else ''} "
                    f"to your board at *{stage.upper()}* (from an email — {e['sender']}).",
                    "jobs",
                )

    await _meta_set("last_scan_at", datetime.now(timezone.utc).isoformat())
    print(f"📬 [app-email] scan done: {summary}")
    return summary


# ── pending-confirmation API (used by the Jobs board) ─────────────────────────

async def list_pending() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM application_email_pending WHERE resolved = 0 ORDER BY created_at DESC")
        return [dict(r) for r in await cur.fetchall()]


async def count_pending() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT COUNT(*) AS n FROM application_email_pending WHERE resolved = 0")
        row = await cur.fetchone()
    try:
        return int(row["n"])
    except Exception:
        return 0


async def _get_pending(pending_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM application_email_pending WHERE id = ? AND resolved = 0", (pending_id,))
        row = await cur.fetchone()
    return dict(row) if row else None


async def _resolve_pending(pending_id: int, state: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE application_email_pending SET resolved = ? WHERE id = ?", (state, pending_id))
        await db.commit()


async def confirm_pending(pending_id: int) -> tuple:
    """Apply a parked suggestion the user confirmed."""
    p = await _get_pending(pending_id)
    if not p:
        return False, "That suggestion is no longer available."
    to_status = (p.get("to_status") or "").lower()
    if p.get("kind") == "move":
        app = await get_application(int(p["app_id"])) if p.get("app_id") else None
        if not app:
            await _resolve_pending(pending_id, 2)
            return False, "That application is no longer on the board."
        # Still enforce forward-only at confirm time (the user may have moved it since).
        if _should_move(app.get("status"), to_status):
            await update_status_by_id(app["id"], to_status)
        await _resolve_pending(pending_id, 1)
        return True, f"Moved {app.get('title')} — {app.get('company','')} → {to_status.upper()}."
    # kind == 'add'
    slug = _norm(f"{p.get('title')}{p.get('company')}")
    job = {
        "key": f"email:{slug}" if slug else f"email:{p.get('email_id')}",
        "title": p.get("title") or "Job application", "company": p.get("company") or "",
        "location": p.get("location") or "", "url": p.get("url") or "",
        "source": p.get("source") or "Email",
    }
    await add_application(job, status=to_status)
    await _resolve_pending(pending_id, 1)
    return True, f"Added {job['title']} to your board at {to_status.upper()}."


async def dismiss_pending(pending_id: int) -> bool:
    await _resolve_pending(pending_id, 2)
    return True
