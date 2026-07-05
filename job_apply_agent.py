"""
Job Apply Agent — apply-prep + (approval-gated) auto-apply for the Job Scout pipeline.

Same self-contained pattern as the other agents: own tables, own error handling. V3_updates.py
imports the public functions; job_scout_agent.py calls run_apply_prep(...) as a post-digest hook.

There is no universal "apply" API — a job's real apply target is either an email address
(legitimately auto-sendable via the user's Gmail) or a web form URL (link only). So this module
tiers by REVERSIBILITY, matching how a disciplined recruiter would run the top of the funnel:

  • Prepare + 1-tap (score >= APPLY_PREP_THRESHOLD, default 75, capped at APPLY_PREP_DAILY_CAP/day):
    tailor the resume to the JD (resume_ats_agent.analyze) + draft a cover note, stash the package,
    and notify with the apply link. The user taps to submit. Reversible → cast wide.
  • Email auto-apply (method == email AND score >= AUTO_EMAIL_THRESHOLD, default 88): the irreversible
    path, so it is approval-gated by default. AUTO_EMAIL_MODE = 'confirm' (default) parks it in
    pending_confirm and asks for a one-tap OK; 'auto' sends immediately; 'off' downgrades to link-prep.

Everything LLM-generated that leaves for a third party goes through the pending_confirm hold unless
the user has explicitly opted into 'auto' — the project's approval-before-send rule.
"""

import os
import re
import json
import base64
import db_compat as aiosqlite
from datetime import datetime, timezone
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.mime.application import MIMEApplication

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

# Settings keys (stored in user_settings; all overridable from the UI/API). Defaults follow the
# "wide but disciplined" recruiter tuning we agreed on.
_DEFAULTS = {
    "apply_prep_enabled": "1",
    "apply_prep_threshold": "75",
    "apply_prep_daily_cap": "6",
    "auto_email_threshold": "88",
    "auto_email_mode": "confirm",  # 'off' | 'confirm' | 'auto'
}

_EMAIL_RE = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}")

COVER_NOTE_PROMPT = (
    "You are JARVIS drafting a concise, senior-recruiter-grade application note for Madan. "
    "3 short paragraphs, max ~140 words: (1) the role + one genuine hook on why it fits, "
    "(2) 2-3 concrete, quantified proof points pulled ONLY from the resume highlights given, "
    "(3) a crisp close. No fluff, no invented facts, no placeholders like [Company]. "
    "Return ONLY the note body — no subject line, no signature."
)


def init_job_apply_tables():
    """Synchronous table setup — called once at engine startup."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    try:
        conn.execute(
            """CREATE TABLE IF NOT EXISTS job_application_prep (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                job_key TEXT UNIQUE,
                title TEXT, company TEXT, location TEXT, url TEXT,
                method TEXT,            -- 'email' | 'link'
                apply_email TEXT,
                ats_score INTEGER DEFAULT 0,
                resume_txt TEXT,
                cover_note TEXT,
                status TEXT DEFAULT 'ready',  -- 'ready' | 'pending_confirm' | 'applied' | 'cancelled'
                created_at TEXT, updated_at TEXT,
                domain_mismatch TEXT)"""
        )
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(job_application_prep)").fetchall()]
            if "domain_mismatch" not in cols:
                conn.execute("ALTER TABLE job_application_prep ADD COLUMN domain_mismatch TEXT")
        except Exception:
            pass
        conn.commit()
    finally:
        conn.close()


def _get_settings() -> dict:
    """Read apply settings from user_settings, falling back to _DEFAULTS. Sync (small, cached-free)."""
    out = dict(_DEFAULTS)
    try:
        conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
        try:
            rows = conn.execute(
                "SELECT key, value FROM user_settings WHERE key IN (%s)"
                % ",".join("?" * len(_DEFAULTS)),
                tuple(_DEFAULTS.keys()),
            ).fetchall()
            for k, v in rows:
                if v is not None and str(v).strip() != "":
                    out[k] = str(v).strip()
        finally:
            conn.close()
    except Exception as e:
        print(f"⚠️ [job_apply] settings read failed, using defaults: {e}")
    return out


def _as_int(v, default: int) -> int:
    try:
        return int(float(v))
    except Exception:
        return default


def _find_apply_email(job: dict) -> str | None:
    """Return an application email if the job is email-apply, else None. Prefers a mailto: in the
    apply URL, then an address in the description near an apply cue (to avoid grabbing a random
    contact address)."""
    # 1. Check URL for email or mailto link
    url = (job.get("url") or "").strip()
    if url:
        if "mailto:" in url.lower():
            m = _EMAIL_RE.search(url)
            if m:
                return m.group(0)
        # If URL itself is a raw email address
        m = _EMAIL_RE.match(url)
        if m:
            return m.group(0)
            
    desc = job.get("description") or ""
    if not desc:
        return None
        
    # 2. Extract all emails from description
    emails = _EMAIL_RE.findall(desc)
    if not emails:
        return None
        
    # Clean and dedup emails preserving order
    unique_emails = []
    for email in emails:
        cleaned = email.strip().lower()
        if cleaned not in unique_emails:
            unique_emails.append(cleaned)
            
    if not unique_emails:
        return None
        
    # Keywords indicating job application context
    apply_keywords = ["apply", "send", "email", "resume", "cv", "cover letter", "careers", "jobs", "hiring", "recruitment", "recruiting", "hr", "talent"]
    email_hiring_prefixes = ["hr", "careers", "jobs", "apply", "recruiting", "hiring", "work", "resume", "cv", "talent", "join", "people"]
    
    # If only one email exists, check if there are any apply keywords in the description or if the email matches hiring prefix
    if len(unique_emails) == 1:
        email = unique_emails[0]
        # Check if email prefix contains hiring keywords
        prefix = email.split("@")[0]
        if any(p in prefix for p in email_hiring_prefixes):
            return email
        # Or if the description mentions any apply keyword
        desc_lower = desc.lower()
        if any(kw in desc_lower for kw in apply_keywords):
            return email
        return None
        
    # 3. Score multiple emails to find the best match
    best_email = None
    best_score = -1
    desc_lower = desc.lower()
    
    for email in unique_emails:
        score = 0
        prefix = email.split("@")[0]
        
        # Rule A: Prefix match (+5 points)
        if any(p in prefix for p in email_hiring_prefixes):
            score += 5
            
        # Rule B: Find distance to nearest apply keyword
        # Search in a window of 120 characters before and after the email
        email_idx = desc_lower.find(email)
        if email_idx != -1:
            window_start = max(0, email_idx - 120)
            window_end = min(len(desc_lower), email_idx + len(email) + 120)
            window_text = desc_lower[window_start:window_end]
            
            for kw in apply_keywords:
                if kw in window_text:
                    score += 3
                    
        if score > best_score:
            best_score = score
            best_email = email
            
    # Require at least a threshold score (e.g. 3) to prevent matching random footer links/contact emails
    if best_score >= 3:
        return best_email
        
    return None



async def _already_prepped(job_key: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT 1 FROM job_application_prep WHERE job_key = ? AND status != 'cancelled'",
            (job_key,),
        )
        return (await cur.fetchone()) is not None


async def _prepped_today() -> int:
    today = datetime.now(timezone.utc).date().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT COUNT(*) FROM job_application_prep WHERE substr(created_at,1,10) = ?",
            (today,),
        )
        row = await cur.fetchone()
        return int(row[0]) if row else 0


async def _draft_cover_note(job: dict, analysis: dict, call_llm_fn) -> str:
    """LLM-draft a short cover note grounded ONLY in the resume highlights from the ATS analysis."""
    highlights = analysis.get("star_xyz_breakdown") or analysis.get("keyword_matrix") or {}
    user = (
        f"ROLE: {job.get('title','')} @ {job.get('company','')} ({job.get('location','')})\n\n"
        f"JOB DESCRIPTION (excerpt):\n{(job.get('description') or '')[:1500]}\n\n"
        f"RESUME HIGHLIGHTS / PROOF POINTS (use only these):\n{json.dumps(highlights)[:1500]}"
    )
    try:
        note = await call_llm_fn(COVER_NOTE_PROMPT, user, max_tokens=320)
        return (note or "").strip()
    except Exception as e:
        print(f"⚠️ [job_apply] cover-note draft failed: {e}")
        return ""


async def prepare_one(job: dict, call_llm_fn) -> dict | None:
    """Tailor resume + draft cover note + detect apply method for one job. Upserts a prep row with
    status 'ready' (final routing is decided by run_apply_prep). Returns the prep dict or None."""
    job_key = str(job.get("key") or job.get("job_key") or job.get("url") or job.get("title") or "")
    if not job_key:
        return None
    try:
        # resume_ats_agent.analyze returns a cache row with ats_score + downloadable_txt_content
        # (the JD-tailored resume). Imported lazily to avoid any import cycle at module load.
        import resume_ats_agent
        analysis = await resume_ats_agent.analyze(job, call_llm_fn)
    except Exception as e:
        print(f"⚠️ [job_apply] resume analyze failed for {job_key}: {e}")
        analysis = {}
    ats_score = _as_int(analysis.get("ats_score"), 0) if isinstance(analysis, dict) else 0
    resume_txt = analysis.get("downloadable_txt_content", "") if isinstance(analysis, dict) else ""
    if not resume_txt:
        # Tailoring failed — fall back to the master resume so we never attach nothing.
        try:
            import resume_ats_agent
            resume_txt = await resume_ats_agent.get_resume_template() or ""
        except Exception:
            resume_txt = ""
    domain_mismatch = analysis.get("domain_mismatch") or {} if isinstance(analysis, dict) else {}
    is_mismatched = bool(domain_mismatch.get("mismatched"))
    status = "blocked" if is_mismatched else "ready"
    mismatch_str = json.dumps(domain_mismatch)

    cover_note = ""
    if not is_mismatched:
        cover_note = await _draft_cover_note(job, analysis if isinstance(analysis, dict) else {}, call_llm_fn)

    apply_email = _find_apply_email(job)
    method = "email" if apply_email else "link"
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO job_application_prep
               (job_key, title, company, location, url, method, apply_email, ats_score,
                resume_txt, cover_note, status, created_at, updated_at, domain_mismatch)
               VALUES (?,?,?,?,?,?,?,?,?,?, ?, ?, ?, ?)
               ON CONFLICT(job_key) DO UPDATE SET
                 method=excluded.method, apply_email=excluded.apply_email,
                 ats_score=excluded.ats_score, resume_txt=excluded.resume_txt,
                 cover_note=excluded.cover_note, status=excluded.status,
                 updated_at=excluded.updated_at, domain_mismatch=excluded.domain_mismatch""",
            (job_key, job.get("title"), job.get("company"), job.get("location"), job.get("url"),
             method, apply_email, ats_score, resume_txt, cover_note, status, now, now, mismatch_str),
        )
        await db.commit()
    return {
        "job_key": job_key, "title": job.get("title"), "company": job.get("company"),
        "url": job.get("url"), "method": method, "apply_email": apply_email,
        "ats_score": ats_score, "cover_note": cover_note, "resume_txt": resume_txt,
        "status": status, "domain_mismatch": domain_mismatch,
    }


async def _set_status(job_key: str, status: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE job_application_prep SET status = ?, updated_at = ? WHERE job_key = ?",
            (status, datetime.now(timezone.utc).isoformat(), job_key),
        )
        await db.commit()


async def send_application_email(prep: dict, profile: dict, send_email_fn=None) -> bool:
    """Send the application email (cover note body + tailored resume attached) via Gmail.
    send_email_fn(to, subject, body, attachment_bytes, attachment_name) may be injected for tests;
    otherwise the real Gmail API is used. Returns True on success."""
    to_addr = prep.get("apply_email")
    if not to_addr:
        return False
    if not (prep.get("resume_txt") or "").strip():
        # Never email an application with no resume attached.
        print(f"⚠️ [job_apply] no resume for {prep.get('title')} — refusing to auto-send.")
        return False
    name = (profile or {}).get("name") or "Madan Sai Daram"
    subject = f"Application — {prep.get('title','')} — {name}"
    body = prep.get("cover_note") or f"Please find my application for {prep.get('title','')} attached."
    resume_bytes = (prep.get("resume_txt") or "").encode("utf-8")
    fname = f"{name.replace(' ', '_')}_Resume.txt"

    if send_email_fn is not None:
        try:
            return bool(await send_email_fn(to_addr, subject, body, resume_bytes, fname))
        except Exception as e:
            print(f"⚠️ [job_apply] injected send failed: {e}")
            return False
    try:
        import email_triage
        service = email_triage._get_gmail_service()
        msg = MIMEMultipart()
        msg["to"] = to_addr
        msg["subject"] = subject
        msg.attach(MIMEText(body))
        if resume_bytes:
            part = MIMEApplication(resume_bytes, _subtype="plain")
            part.add_header("Content-Disposition", "attachment", filename=fname)
            msg.attach(part)
        raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
        service.users().messages().send(userId="me", body={"raw": raw}).execute()
        print(f"✅ [job_apply] application email sent to {to_addr} for {prep.get('title')}")
        return True
    except Exception as e:
        print(f"⚠️ [job_apply] Gmail send failed: {e}")
        return False


async def run_apply_prep(matches: list, call_llm_fn, notify_fn=None, profile: dict = None,
                         track_fn=None, send_email_fn=None) -> str:
    """Post-digest hook: prep strong matches, route by reversibility, notify. `matches` are the
    already-ranked, already-shown Job Scout matches (each a dict with score/key/title/...)."""
    s = _get_settings()
    if str(s["apply_prep_enabled"]).lower() not in ("1", "true", "on", "yes"):
        return ""
    prep_threshold = _as_int(s["apply_prep_threshold"], 75)
    daily_cap = _as_int(s["apply_prep_daily_cap"], 6)
    auto_email_threshold = _as_int(s["auto_email_threshold"], 88)
    email_mode = str(s["auto_email_mode"]).lower().strip()

    remaining = max(0, daily_cap - await _prepped_today())
    candidates = [m for m in (matches or []) if _as_int(m.get("score"), 0) >= prep_threshold]
    candidates.sort(key=lambda m: _as_int(m.get("score"), 0), reverse=True)

    applied, ready, awaiting = [], [], []
    for job in candidates:
        if remaining <= 0:
            break
        job_key = str(job.get("key") or job.get("url") or job.get("title") or "")
        if not job_key or await _already_prepped(job_key):
            continue
        prep = await prepare_one(job, call_llm_fn)
        if not prep:
            continue
        remaining -= 1
        score = _as_int(job.get("score"), 0)
        is_email = prep["method"] == "email" and score >= auto_email_threshold and email_mode != "off"
        if is_email and email_mode == "auto":
            ok = await send_application_email(prep, profile, send_email_fn)
            if ok:
                await _set_status(job_key, "applied")
                if track_fn:
                    try:
                        await track_fn(job, "applied")
                    except Exception:
                        pass
                applied.append(prep)
            else:
                await _set_status(job_key, "ready")
                ready.append(prep)
        elif is_email and email_mode == "confirm":
            await _set_status(job_key, "pending_confirm")
            awaiting.append(prep)
        else:
            ready.append(prep)  # link, or email below the auto bar / mode off

    msg = _format_notice(applied, ready, awaiting)
    if msg and notify_fn:
        notify_fn(msg)
    return msg


async def apply_now(job: dict, call_llm_fn, notify_fn=None, profile: dict = None,
                    track_fn=None, send_email_fn=None) -> dict:
    """Explicit, user-initiated apply for ONE job (e.g. the console review popup's Apply button).
    Unlike run_apply_prep this ignores the score threshold and daily cap — the user chose this
    job — but STILL honors auto_email_mode for the irreversible email path. Returns
    {"outcome": "applied"|"queued"|"ready", "message": str}."""
    prep = await prepare_one(job, call_llm_fn)
    if not prep:
        return {"outcome": "error", "message": "Couldn't prepare that job."}
    s = _get_settings()
    email_mode = str(s["auto_email_mode"]).lower().strip()
    job_key = prep["job_key"]

    if prep["method"] == "email" and email_mode == "auto":
        if await send_application_email(prep, profile, send_email_fn):
            await _set_status(job_key, "applied")
            if track_fn:
                try:
                    await track_fn(job, "applied")
                except Exception:
                    pass
            msg = f"✅ Applied — emailed your resume + note for {prep['title']} — {prep['company']}."
            if notify_fn:
                notify_fn(msg)
            return {"outcome": "applied", "message": msg}
        await _set_status(job_key, "ready")
        return {"outcome": "ready", "message": f"Couldn't email — prepped {prep['title']} for manual send."}

    if prep["method"] == "email" and email_mode == "confirm":
        await _set_status(job_key, "pending_confirm")
        msg = f"📧 Ready to email *{prep['title']}* — {prep['company']} (to {prep['apply_email']}). Reply APPLY to send."
        if notify_fn:
            notify_fn(msg)
        return {"outcome": "queued", "message": msg}

    # link method, or email with mode 'off'
    await _set_status(job_key, "ready")
    return {"outcome": "ready",
            "message": f"📝 Prepped {prep['title']} — resume tailored, cover note drafted. Apply: {prep['url']}"}


def _format_notice(applied: list, ready: list, awaiting: list) -> str:
    if not (applied or ready or awaiting):
        return ""
    lines = ["🤖 *Job Scout — apply desk*"]
    if applied:
        lines.append(f"\n✅ *Applied ({len(applied)})* — resume + note emailed:")
        for p in applied:
            lines.append(f"  • {p['title']} — {p['company']}")
    if awaiting:
        lines.append(f"\n📧 *Ready to email ({len(awaiting)})* — reply *APPLY {1}* (or APPLY <n>) to send:")
        for i, p in enumerate(awaiting, 1):
            lines.append(f"  {i}. {p['title']} — {p['company']}  (to {p['apply_email']})")
    if ready:
        lines.append(f"\n📝 *Prepped, 1-tap to apply ({len(ready)})* — resume tailored, note drafted:")
        for p in ready:
            lines.append(f"  • {p['title']} — {p['company']}\n     {p['url']}")
    return "\n".join(lines)


async def list_pending_confirm() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM job_application_prep WHERE status = 'pending_confirm' ORDER BY ats_score DESC, id ASC"
        )
        return [dict(r) for r in await cur.fetchall()]


async def confirm_apply(ref, notify_fn=None, profile: dict = None,
                        track_fn=None, send_email_fn=None) -> str:
    """User approved an email application. `ref` is a 1-based index into the pending list (from the
    'APPLY <n>' reply) or None for the top one. Sends the email, marks applied, notifies."""
    pending = await list_pending_confirm()
    if not pending:
        return "Nothing is queued for email apply right now."
    idx = 0
    if ref is not None:
        try:
            idx = max(0, min(len(pending) - 1, int(ref) - 1))
        except Exception:
            idx = 0
    row = pending[idx]
    ok = await send_application_email(row, profile, send_email_fn)
    if not ok:
        return f"⚠️ Couldn't send the application for {row['title']} — I've left it queued."
    await _set_status(row["job_key"], "applied")
    if track_fn:
        try:
            await track_fn({"key": row["job_key"], "title": row["title"], "company": row["company"],
                            "location": row["location"], "url": row["url"]}, "applied")
        except Exception:
            pass
    msg = f"✅ *Applied* — emailed your resume + note for *{row['title']}* — {row['company']}."
    if notify_fn:
        notify_fn(msg)
    return msg
