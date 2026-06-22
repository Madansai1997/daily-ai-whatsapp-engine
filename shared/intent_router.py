async def classify_intent(message: str, call_llm_fn) -> str:
    msg = message.lower().strip()

    if msg.startswith("remind me") or msg.startswith("don't forget") or msg.startswith("ping me at") or msg.startswith("set reminder"):
        return "reminder"
    if "calendar" in msg or "schedule" in msg or "am i free" in msg or "what's my day" in msg:
        return "calendar"
    if msg.startswith("remember this") or msg.startswith("save this") or msg.startswith("note:"):
        return "notes"
    if msg.startswith("email") or msg.startswith("check email") or msg.startswith("check inbox") or msg.startswith("any emails"):
        return "email"
    if msg == "yes":
        return "approve_draft"
    if msg.startswith("edit:"):
        return "edit_draft"
    if "pending" in msg or "drafts" in msg:
        return "pending_drafts"
    if msg in ("digest", "briefing", "morning"):
        return "briefing"
    if msg in ("quiz", "done", "skip", "end quiz", "too easy", "too hard", "bad content", "wrong answer"):
        return "learning"
    if msg.startswith("explain:") or msg.startswith("set topic:") or msg.startswith("deep dive:") or msg.startswith("clear topic"):
        return "learning"
    if msg in ("hi", "hello", "hey", "help", "menu", "commands", "start"):
        return "greeting"
    if msg in ("reset", "weekly report", "report", "my progress"):
        return "learning"

    system_prompt = (
        "Classify this message into exactly one of these categories: "
        "reminder, calendar, notes, email, approve_draft, edit_draft, "
        "pending_drafts, briefing, learning, greeting, general. "
        "Return only the category label, nothing else."
    )
    result = await call_llm_fn(system_prompt, message)
    return result.strip()
