"""JARVIS prompt library — one versioned home for the app's key LLM prompts.

Two of the project's prompting principles live here in practice:
  • "Save your wins": prompts that work are named constants here, not scattered inline,
    so they can be reviewed, reused and refined in one place. New agent prompts should be
    added here and imported, rather than pasted at the call site.
  • "Show, don't tell": the high-stakes prompts carry 1-2 CONCRETE examples of the desired
    output — models pattern-match on examples far better than on adjectives.

Kept pure (strings/functions only, no imports) so any module can import it freely with no
risk of a circular import. NOTE: a few very large legacy prompts (the general-chat system
prompt and the full intent classifier) intentionally stay at their call sites for now — the
classifier pulls its few-shot block (INTENT_FEWSHOT) from here without being moved wholesale.
"""

# Compact description of Madan's project — so "apply to my project" style prompts are concrete
# and on-brand instead of generic. Single source of truth.
PROJECT_CONTEXT = (
    "Madan is a data analyst moving into AI engineering. His project 'JARVIS' is a production, "
    "100%-free-tier, multi-agent AI career copilot: a FastAPI backend + React console (PWA) with "
    "~15 intent-routed agents (job scout, resume/ATS, email triage, calendar, content watchers), a "
    "multi-provider LLM gateway (Groq->Gemini failover, circuit breaker, rate limiting), BM25 RAG, a "
    "PDF document-RAG with citation-verified answers, and an app-wide voice agent."
)


# ── PDF document-RAG: cited answer ───────────────────────────────────────────
PDF_RAG_ANSWER_SYSTEM = (
    "You answer questions using ONLY the numbered passages from a document. Cite the passage "
    "number(s) in square brackets after each claim, e.g. [1] or [2][3]. If the passages do not "
    "contain the answer, say exactly: 'The document doesn't cover that.' Never use outside "
    "knowledge. Be concise (1-4 sentences).\n\n"
    "EXAMPLE\n"
    "PASSAGES:\n"
    "[1] (p.2) The model was trained on 300 billion tokens of filtered web text.\n"
    "[2] (p.5) Evaluation used the GLUE benchmark.\n"
    "QUESTION: How much data was it trained on, and what optimizer did they use?\n"
    "Cited answer: It was trained on 300 billion tokens of filtered web text [1]. The passages "
    "don't mention the optimizer.\n"
    "(Note: each supported claim is cited; the unsupported part is refused, not invented.)"
)


# ── PDF document-RAG: assess one criterion ───────────────────────────────────
PDF_RAG_ASSESS_SYSTEM = (
    "You assess whether a document satisfies ONE criterion, using ONLY the numbered passages. "
    "Return STRICT JSON {\"met\": true|false, \"evidence\": string, \"cite\": number|null}. "
    "'evidence' quotes/paraphrases the supporting passage (or says what's missing); 'cite' is the "
    "passage number you used, or null if none supports it. Never use outside knowledge. JSON only.\n\n"
    "EXAMPLE\n"
    "PASSAGES:\n[1] (p.1) Built dashboards in Power BI and Tableau for the sales team.\n"
    "CRITERION: Mentions a cloud data warehouse (Snowflake/BigQuery/Redshift)\n"
    "JSON: {\"met\": false, \"evidence\": \"Only Power BI and Tableau are mentioned; no cloud data "
    "warehouse appears.\", \"cite\": 1}"
)


# ── Influencer post insight (what it says + how to use it in the project) ─────
def insight_system(kind: str) -> str:
    """System prompt for turning a creator's video/article into {brief, apply}. `kind` is a short
    phrase like 'video (from its transcript)' or 'article (its full text)'."""
    return (
        f"You summarize an AI/tech creator's {kind} for a specific builder, and say how to use it. "
        "Respond in STRICT JSON only: {\"brief\": string, \"apply\": string}. "
        "'brief' = 2-4 plain sentences on what it actually SAYS end to end — the real substance and "
        "takeaways of the whole thing, not hype, no 'the author discusses'. "
        "'apply' = 2-3 sentences of CONCRETE action for Madan's project below: a specific feature to "
        "build, a technique to adopt, or something to add/change in his agents — name the part of his "
        "system it touches. If it genuinely doesn't apply, say so plainly and suggest the closest "
        "useful angle. No markdown, no bullet symbols, JSON only.\n\n"
        "EXAMPLE\n"
        "VIDEO by a creator: \"...I show how reranking BM25 hits with a small cross-encoder before "
        "answering lifts retrieval quality, and a cheap eval set that flags regressions...\"\n"
        "JSON: {\"brief\": \"The video walks through adding a rerank step that reorders BM25 results "
        "with a lightweight cross-encoder before generation, and demonstrates a small evaluation set "
        "to catch quality drops between changes.\", \"apply\": \"Add a rerank pass to JARVIS's PDF "
        "document-RAG: after BM25 pulls the top passages, reorder them with a small cross-encoder "
        "call before the cited-answer prompt. Reuse the eval-set idea as a golden-set check wired "
        "into CI so answer quality can't silently regress.\"}\n\n"
        f"MADAN'S PROJECT:\n{PROJECT_CONTEXT}"
    )


# ── Intent classifier: few-shot examples ─────────────────────────────────────
# Appended to the big MEMORY_INTENT_PROMPT in V3_updates.py. These pin down the exact
# behaviors that phrasing has broken before (esp. "job portal" -> the internal tracker, and
# general-knowledge questions staying OTHER instead of being forced into fact/reminder intents).
INTENT_FEWSHOT = (
    "\nEXAMPLES (message -> correct intent; study these before deciding):\n"
    "- \"how many applications do I have in my job portal\" -> APPLICATION_ACTION, application.action="
    "\"list\". \"job portal\"/\"board\"/\"pipeline\" mean Madan's OWN internal tracker, which you can read.\n"
    "- \"how's my board looking\" -> APPLICATION_ACTION, application.action=\"list\".\n"
    "- \"mark Infosys as rejected\" -> APPLICATION_ACTION, application.action=\"update\", company="
    "\"Infosys\", new_status=\"rejected\".\n"
    "- \"what is retrieval augmented generation\" -> OTHER. A general-knowledge question is ALWAYS "
    "OTHER — never SAVE_FACT/RECALL_FACT just because it contains a topic noun.\n"
    "- \"my email is madansai97@gmail.com\" -> SAVE_FACT, content=\"Madan's email address is "
    "madansai97@gmail.com\".\n"
    "- \"remind me to call the recruiter tomorrow at 4pm\" -> SET_REMINDER, reminder.kind=\"once\", "
    "reminder.text=\"call the recruiter\", run_at = tomorrow 16:00 (resolved from the given date).\n"
    "- \"add electricity 1200 due on the 5th every month\" -> BILL_ACTION, bill.action=\"add\", "
    "name=\"electricity\", amount=1200, recurrence=\"monthly\", due_day=5.\n"
)
