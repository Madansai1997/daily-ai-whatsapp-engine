"""
Interview Prep Dock — surfaces upcoming interviews from Calendar and, on demand, drafts a
prep brief (what to expect, company talking points, questions to ask).

Reads the primary calendar for events that look like interviews, cross-references the tracked
applications so it can pull the role/JD, and only calls the LLM when the user opens a specific
event's brief (no LLM cost on load). Free-tier friendly.
"""

from datetime import datetime, timezone

from calendar_agent import list_upcoming_events
from application_tracker import list_applications

_INTERVIEW_HINTS = (
    "interview", "screen", "screening", "phone screen", "onsite", "on-site", "hiring",
    "recruiter", "hr round", "technical round", "tech screen", "final round", "loop",
    "chat with", "call with", "meet with",
)


def _looks_like_interview(summary: str) -> bool:
    s = (summary or "").lower()
    return any(h in s for h in _INTERVIEW_HINTS)


def _match_company(text: str, companies: list) -> dict:
    """Return the tracked application whose company appears in the event text, if any."""
    t = (text or "").lower()
    for a in companies:
        c = (a.get("company") or "").strip().lower()
        if c and len(c) >= 3 and c in t:
            return a
    return None


async def list_interview_events(max_results: int = 15) -> list:
    """Upcoming calendar events that look like interviews, tagged with the matched application
    (if the company lines up with a tracked card)."""
    events = await list_upcoming_events(max_results=max_results)
    apps = await list_applications()
    out = []
    for ev in events:
        summary = ev.get("summary") or ""
        attendee_blob = " ".join(ev.get("attendees") or [])
        matched = _match_company(f"{summary} {attendee_blob}", apps)
        if not (_looks_like_interview(summary) or matched):
            continue
        out.append({
            "id": ev.get("id"),
            "summary": summary,
            "start": ev.get("start"),
            "end": ev.get("end"),
            "attendees": ev.get("attendees"),
            "html_link": ev.get("html_link"),
            "matched_app_id": matched.get("id") if matched else None,
            "company": (matched or {}).get("company"),
            "role": (matched or {}).get("title"),
        })
    return out


_PREP_SYS = (
    "You are JARVIS, preparing the user for a specific job interview. Be sharp, concrete and "
    "confidence-building — a trusted advisor, not a listicle. Use the role and any JD provided; "
    "never invent company facts you can't reasonably infer. Return markdown with exactly these "
    "sections:\n"
    "## What to expect\n## Talking points (map your strengths to the role)\n"
    "## Smart questions to ask them\n## One-line pep\n"
    "Keep the whole thing under ~300 words."
)


async def prep_brief(event: dict, call_llm_fn, app: dict = None) -> dict:
    """On-demand prep brief for one interview event. `app` (if the event matched a card) supplies
    role + JD context. Returns {ok, markdown}."""
    role = (app or {}).get("title") or event.get("role") or "the role"
    company = (app or {}).get("company") or event.get("company") or "the company"
    jd = ((app or {}).get("description") or "").strip()
    jd_block = f"\nJob description:\n{jd[:1500]}" if jd else ""
    when = event.get("start") or ""
    user_prompt = (
        f"Interview: {event.get('summary')}\n"
        f"Role: {role}\nCompany: {company}\nWhen: {when}{jd_block}\n\n"
        "Write the prep brief now."
    )
    try:
        md = await call_llm_fn(_PREP_SYS, user_prompt, max_tokens=900)
    except Exception as e:
        return {"ok": False, "error": f"Prep failed: {e}"}
    return {"ok": True, "markdown": (md or "").strip(),
            "company": company, "role": role, "when": when}
