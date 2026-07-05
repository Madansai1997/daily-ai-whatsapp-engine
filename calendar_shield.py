"""
Calendar Shield — guards your schedule around interviews.

Reads the upcoming calendar and flags two things worth catching before they bite:
  • double-bookings — two events that overlap in time.
  • unbuffered interviews — an interview with a meeting butting right up against it (no room to
    breathe, prep, or run over), or back-to-back with another commitment.

Read-only over Google Calendar (already connected). No LLM cost.
"""

from datetime import datetime, timezone, timedelta

from calendar_agent import list_upcoming_events
from interview_prep import _looks_like_interview

BUFFER_MIN = 30  # minimum breathing room wanted on each side of an interview


def _parse_dt(s):
    if not s:
        return None
    try:
        s = s.strip().replace("Z", "+00:00")
        d = datetime.fromisoformat(s)
        return d.replace(tzinfo=timezone.utc) if d.tzinfo is None else d
    except Exception:
        return None


def _fmt(dt):
    return dt.astimezone().strftime("%a %d %b, %H:%M") if dt else ""


async def analyze(max_events: int = 25) -> dict:
    events = await list_upcoming_events(max_results=max_events)
    # Keep only timed events (skip all-day, which have date-only starts we can't overlap-check).
    timed = []
    for e in events:
        s, en = _parse_dt(e.get("start")), _parse_dt(e.get("end"))
        if s and en and "T" in (e.get("start") or ""):
            timed.append({**e, "_s": s, "_e": en,
                          "_interview": _looks_like_interview(e.get("summary", ""))})
    timed.sort(key=lambda x: x["_s"])

    conflicts, unbuffered = [], []
    for i, a in enumerate(timed):
        for b in timed[i + 1:]:
            if b["_s"] >= a["_e"]:
                break  # sorted — no later event can overlap this one
            # overlap
            if b["_s"] < a["_e"] and a["_s"] < b["_e"]:
                conflicts.append({
                    "a": a.get("summary"), "b": b.get("summary"),
                    "when": _fmt(max(a["_s"], b["_s"])),
                    "interview_involved": a["_interview"] or b["_interview"],
                })
    # Buffer check around interviews.
    for i, ev in enumerate(timed):
        if not ev["_interview"]:
            continue
        before = timed[i - 1] if i > 0 else None
        after = timed[i + 1] if i + 1 < len(timed) else None
        gap_before = (ev["_s"] - before["_e"]).total_seconds() / 60 if before else None
        gap_after = (after["_s"] - ev["_e"]).total_seconds() / 60 if after else None
        tight = []
        if gap_before is not None and 0 <= gap_before < BUFFER_MIN:
            tight.append(f"only {int(gap_before)}m after “{before['summary']}”")
        if gap_after is not None and 0 <= gap_after < BUFFER_MIN:
            tight.append(f"only {int(gap_after)}m before “{after['summary']}”")
        if tight:
            unbuffered.append({
                "summary": ev.get("summary"), "when": _fmt(ev["_s"]),
                "issues": tight,
            })

    return {
        "checked": len(timed),
        "conflicts": conflicts,
        "unbuffered": unbuffered,
        "buffer_min": BUFFER_MIN,
        "clear": not conflicts and not unbuffered,
    }
