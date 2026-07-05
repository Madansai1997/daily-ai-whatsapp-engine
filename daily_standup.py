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
