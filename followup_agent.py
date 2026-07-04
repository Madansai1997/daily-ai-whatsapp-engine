"""
Follow-up Agent — nudges stale 'applied' cards with a drafted recruiter follow-up.

Finds applications sitting in 'applied' past a threshold with no recruiter response, drafts a
short, JARVIS-composed follow-up e-mail, and (only on an explicit user action) sends it via
Gmail. The Send click in the console IS the approval — nothing leaves the outbox on its own.

Self-contained: reuses the tracker's read helpers and the apply-agent's e-mail sniffer, but
owns no table of its own (state lives on the applications rows + event ledger).
"""

import os
import json
from datetime import datetime, timezone

from application_tracker import (
    list_applications, list_application_events, get_application, _days_between,
)
from job_apply_agent import _find_apply_email

FOLLOWUP_STALE_DAYS = int(os.environ.get("FOLLOWUP_STALE_DAYS", "7"))


async def list_followup_candidates(stale_days: int = None) -> list:
    """Cards in 'applied' with no recruiter response, older than `stale_days`. Newest-stale
    first. `recipient` is the best-guess apply address (may be None → user copies the draft)."""
    stale_days = FOLLOWUP_STALE_DAYS if stale_days is None else stale_days
    apps = await list_applications("applied")
    events = await list_application_events()
    ev_by_app = {}
    for e in events:
        ev_by_app.setdefault(e["app_id"], []).append(e)
    now_iso = datetime.now(timezone.utc).isoformat()
    out = []
    for a in apps:
        evs = ev_by_app.get(a["id"], [])
        applied_at = next((e["at"] for e in evs if e.get("to_status") == "applied"), None) \
            or a.get("applied_at") or a.get("updated_at")
        age = _days_between(applied_at, now_iso)
        if age is None or age < stale_days:
            continue
        recipient = _find_apply_email({"url": a.get("url"), "description": a.get("description")})
        out.append({
            "id": a["id"], "title": a.get("title"), "company": a.get("company"),
            "location": a.get("location"), "url": a.get("url"), "source": a.get("source"),
            "days_since_applied": int(age), "recipient": recipient,
        })
    out.sort(key=lambda x: -x["days_since_applied"])
    return out


_DRAFT_SYS = (
    "You are JARVIS, drafting a brief, gracious follow-up e-mail on the user's behalf after a "
    "job application has gone quiet. Composed and confident, never needy or templated. 90-130 "
    "words. Reiterate genuine interest in ONE specific line, offer to share anything further, "
    "and close warmly. No fabricated details, no exclamation-mark spam. "
    'Return ONLY JSON: {"subject": "...", "body": "..."} — body uses \\n for line breaks.'
)


async def draft_followup(app_id: int, call_llm_fn, profile: dict = None) -> dict:
    """LLM-draft a follow-up for one card. Returns {ok, subject, body, recipient, card}."""
    a = await get_application(app_id)
    if not a:
        return {"ok": False, "error": "Application not found."}
    name = (profile or {}).get("name") or (profile or {}).get("full_name") or "the applicant"
    days = None
    recipient = _find_apply_email({"url": a.get("url"), "description": a.get("description")})
    user_prompt = (
        f"Applicant name: {name}\n"
        f"Role: {a.get('title')}\n"
        f"Company: {a.get('company') or '(unknown)'}\n"
        f"Location: {a.get('location') or ''}\n"
        "Draft the follow-up now."
    )
    try:
        raw = await call_llm_fn(_DRAFT_SYS, user_prompt, max_tokens=500)
    except Exception as e:
        return {"ok": False, "error": f"Draft failed: {e}"}
    subject, body = _parse_draft(raw, a)
    return {"ok": True, "subject": subject, "body": body, "recipient": recipient,
            "card": {"id": a["id"], "title": a.get("title"), "company": a.get("company")}}


def _parse_draft(raw: str, card: dict) -> tuple:
    company = card.get("company") or "your team"
    role = card.get("title") or "the role"
    fallback_subject = f"Following up — {role}" + (f" at {company}" if card.get("company") else "")
    try:
        s = raw.strip()
        if s.startswith("```"):
            s = s.split("```", 2)[1].lstrip("json").strip() if "```" in s[3:] else s
        start, end = s.find("{"), s.rfind("}")
        if start != -1 and end != -1:
            obj = json.loads(s[start:end + 1])
            subject = (obj.get("subject") or "").strip() or fallback_subject
            body = (obj.get("body") or "").strip()
            if body:
                return subject, body
    except Exception:
        pass
    # Non-JSON reply — treat whole thing as the body.
    return fallback_subject, raw.strip()


async def send_followup(to_address: str, subject: str, body: str, send_email_fn) -> dict:
    """Send a follow-up. `send_email_fn(to, subject, body)` is injected by the caller (the
    engine passes the Gmail sender; tests pass a stub). Refuses to send with no recipient."""
    if not (to_address or "").strip():
        return {"ok": False, "error": "No recipient address — copy the draft and send manually."}
    if not (subject and body):
        return {"ok": False, "error": "Nothing to send — draft the follow-up first."}
    ok = await send_email_fn(to_address.strip(), subject.strip(), body)
    if ok:
        return {"ok": True, "message": f"Follow-up sent to {to_address.strip()}."}
    return {"ok": False, "error": "Gmail send failed — check the connected account."}
