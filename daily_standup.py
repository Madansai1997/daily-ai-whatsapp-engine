"""
Voice Daily Standup — a single spoken briefing that pulls the whole job search together.

Aggregates today's signal from the other agents (interviews, follow-ups due, pipeline movement,
bills, stale profile assets, contacts to reach) and has JARVIS deliver it as a short, natural
spoken brief. The console reads it aloud with the browser's built-in speech synthesis — no TTS
API, no cost. The text is also shown, so it doubles as a written standup.
"""

from datetime import datetime, timezone, timedelta


async def _safe(coro, default):
    try:
        return await coro
    except Exception:
        return default


async def gather() -> dict:
    """Collect the raw facts for the briefing. Every source is best-effort — a missing calendar
    or empty board never breaks the standup."""
    from interview_prep import list_interview_events
    from followup_agent import list_followup_candidates
    from application_tracker import response_analytics
    from bill_watcher import upcoming as upcoming_bills
    from profile_freshness import stale_assets
    from networking_crm import due_contacts
    from calendar_shield import analyze as shield_analyze

    now = datetime.now(timezone.utc)
    soon = now + timedelta(hours=36)

    interviews = await _safe(list_interview_events(), [])
    today_interviews = []
    for ev in interviews:
        try:
            s = datetime.fromisoformat((ev.get("start") or "").replace("Z", "+00:00"))
            if s.tzinfo is None:
                s = s.replace(tzinfo=timezone.utc)
            if now - timedelta(hours=2) <= s <= soon:
                today_interviews.append(ev)
        except Exception:
            continue

    followups = await _safe(list_followup_candidates(), [])
    analytics = await _safe(response_analytics(), {})
    bills = await _safe(upcoming_bills(3), [])
    stale = await _safe(stale_assets(), [])
    contacts = await _safe(due_contacts(), [])
    shield = await _safe(shield_analyze(), {"clear": True, "conflicts": [], "unbuffered": []})

    return {
        "date": now.astimezone().strftime("%A %d %B"),
        "interviews": today_interviews,
        "followups": followups,
        "pipeline": analytics.get("funnel", []),
        "response_rate": analytics.get("response_rate"),
        "ghosted": analytics.get("ghosted", 0),
        "bills": bills,
        "stale_assets": stale,
        "contacts_due": contacts,
        "calendar": shield,
    }


_STANDUP_SYS = (
    "You are JARVIS delivering Madan's morning job-search standup OUT LOUD. Composed, warm, a "
    "little dry wit — a trusted chief-of-staff, never a robot reading a list. You're given "
    "today's facts as JSON. Deliver a tight 4-7 sentence spoken briefing: lead with anything "
    "time-critical (interviews today, schedule conflicts), then what needs action (follow-ups "
    "due, contacts to reach, stale profile, bills), then one crisp encouraging close. Synthesize "
    "— don't enumerate every item; call out what matters and give counts for the rest. If a day "
    "is genuinely quiet, say so gracefully. PLAIN TEXT ONLY — no markdown, no bullets, no emoji "
    "(this is read aloud by a speech synthesizer)."
)


def _condense(facts: dict) -> dict:
    """Trim the raw facts to what the model needs (keeps the prompt cheap)."""
    return {
        "date": facts["date"],
        "interviews_today": [
            {"summary": i.get("summary"), "start": i.get("start"),
             "company": i.get("company")} for i in facts["interviews"]
        ],
        "followups_due": [
            {"title": f.get("title"), "company": f.get("company"),
             "days_silent": f.get("days_since_applied")} for f in facts["followups"][:8]
        ],
        "followups_due_count": len(facts["followups"]),
        "pipeline": {p.get("stage"): p.get("count") for p in facts["pipeline"]},
        "response_rate": facts["response_rate"],
        "ghosted": facts["ghosted"],
        "bills_due_soon": [
            {"name": b.get("name"), "amount": b.get("amount")} for b in facts["bills"]
        ],
        "stale_profile": [a.get("name") for a in facts["stale_assets"]],
        "contacts_to_reach": [
            {"name": c.get("name"), "company": c.get("company")}
            for c in facts["contacts_due"][:8]
        ],
        "calendar_conflicts": facts["calendar"].get("conflicts", []),
        "calendar_unbuffered": facts["calendar"].get("unbuffered", []),
    }


async def standup_briefing(call_llm_fn) -> dict:
    """Compose the spoken standup. Returns {ok, text, facts}."""
    facts = await gather()
    condensed = _condense(facts)
    import json
    try:
        text = await call_llm_fn(_STANDUP_SYS, json.dumps(condensed, default=str), max_tokens=500)
    except Exception as e:
        return {"ok": False, "error": f"Standup failed: {e}", "facts": condensed}
    return {"ok": True, "text": (text or "").strip(), "facts": condensed}


def _when_phrase(start_iso: str) -> str:
    try:
        s = datetime.fromisoformat((start_iso or "").replace("Z", "+00:00"))
        if s.tzinfo is None:
            s = s.replace(tzinfo=timezone.utc)
        d = s.astimezone().date()
        today = datetime.now().astimezone().date()
        delta = (d - today).days
        if delta <= 0:
            return "today"
        if delta == 1:
            return "tomorrow"
        return s.astimezone().strftime("%a %d %b")
    except Exception:
        return "soon"


async def cockpit() -> dict:
    """The Home-screen brief: a greeting, a PRIORITIZED, deep-linkable 'next steps' queue, and a
    glanceable pipeline pulse. Reuses gather() (+ review queue and a week-momentum count) — a
    presentation of data we already compute, no LLM, no cost. Targets like 'jobs:review' tell the
    console which screen/modal a step opens."""
    from application_tracker import (
        count_review_queue, list_applications, list_application_events, _parse_iso,
    )
    facts = await gather()
    now = datetime.now(timezone.utc)

    apps = await _safe(list_applications(), [])
    active = sum(1 for a in apps if a.get("status") in ("interested", "applied", "interviewing", "offer"))
    events = await _safe(list_application_events(), [])
    wk_cut = now - timedelta(days=7)
    week_applied = sum(
        1 for e in events
        if e.get("to_status") == "applied" and (_parse_iso(e.get("at")) or now) >= wk_cut
    )
    review = await _safe(count_review_queue(), 0)

    steps = []
    for c in facts.get("calendar", {}).get("conflicts", []):
        steps.append({"key": "conflict", "severity": "red", "icon": "alert",
                      "label": f"Schedule clash — {c.get('a')} ↔ {c.get('b')}",
                      "action": "Review", "target": "insights"})
    for iv in facts["interviews"]:
        who = iv.get("company") or iv.get("summary") or "interview"
        steps.append({"key": "interview", "severity": "green", "icon": "calendar",
                      "label": f"Interview {_when_phrase(iv.get('start'))} · {who}",
                      "action": "Prep", "target": "jobs:interviews"})
    if review:
        steps.append({"key": "review", "severity": "purple", "icon": "sparkles",
                      "label": f"{review} new match{'es' if review > 1 else ''} to review",
                      "count": review, "action": "Review", "target": "jobs:review"})
    fu = len(facts["followups"])
    if fu:
        steps.append({"key": "followups", "severity": "amber", "icon": "clock",
                      "label": f"{fu} follow-up{'s' if fu > 1 else ''} overdue",
                      "count": fu, "action": "Follow up", "target": "jobs:followups"})
    for b in facts["bills"]:
        nm = b.get("name") or "A bill"
        steps.append({"key": "bill", "severity": "red", "icon": "wallet",
                      "label": f"{nm} due soon", "action": "Pay", "target": "bills"})
    cd = len(facts["contacts_due"])
    if cd:
        steps.append({"key": "contacts", "severity": "amber", "icon": "users",
                      "label": f"{cd} contact{'s' if cd > 1 else ''} to reach out to",
                      "count": cd, "action": "Network", "target": "jobs:network"})
    stale = facts["stale_assets"]
    if stale:
        names = ", ".join(a.get("name") for a in stale[:3])
        steps.append({"key": "freshness", "severity": "grey", "icon": "refresh",
                      "label": f"{len(stale)} profile{'s' if len(stale) > 1 else ''} going stale ({names})",
                      "action": "Refresh", "target": "insights"})

    hour = now.astimezone().hour
    greeting = "Good morning" if hour < 12 else "Good afternoon" if hour < 17 else "Good evening"
    n = len(steps)
    urgent = any(s["severity"] in ("red", "green") for s in steps)
    if n == 0:
        headline = "Clear runway today — a good day to get ahead."
    elif urgent:
        headline = f"{n} thing{'s' if n > 1 else ''} want your attention today."
    else:
        headline = f"A calm one — {n} thing{'s' if n > 1 else ''} to tidy up when you can."

    return {
        "greeting": greeting,
        "name": "Madan",
        "date": facts["date"],
        "headline": headline,
        "next_steps": steps,
        "pulse": {
            "active": active,
            "response_rate": facts.get("response_rate"),
            "week_applied": week_applied,
            "funnel": facts.get("pipeline", []),
        },
    }
