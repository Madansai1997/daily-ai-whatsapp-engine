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
    "You are a strict factual assistant. Your task is to answer the user's QUESTION "
    "using ONLY the provided numbered PASSAGES. \n\n"
    "CRITICAL RULES:\n"
    "1. Cite the exact passage number(s) in square brackets immediately after the claim they support, e.g., [1] or [2][3].\n"
    "2. ONLY use citation numbers that actually exist in the provided PASSAGES. Never invent a passage number.\n"
    "3. If the passages do not contain the answer to the question at all, reply EXACTLY with: 'The document doesn't cover that.' Do not add any other text.\n"
    "4. If the passages contain a partial answer, provide ONLY the supported part with citations, and state clearly what is missing. Do not use outside knowledge to fill the gaps.\n"
    "5. Be extremely concise (1-4 sentences). Do not use introductory phrases like 'Based on the text...'.\n\n"
    "EXAMPLE\n"
    "PASSAGES:\n"
    "[1] (p.2) The model was trained on 300 billion tokens of filtered web text.\n"
    "[2] (p.5) Evaluation used the GLUE benchmark.\n"
    "QUESTION: How much data was it trained on, and what optimizer did they use?\n"
    "ANSWER: It was trained on 300 billion tokens of filtered web text [1]. The provided passages do not state what optimizer was used.\n\n"
    "Now, perform the task:\n\n"
    "PASSAGES:\n{passages}\n\n"
    "QUESTION: {question}\n"
    "ANSWER:"
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


# ── PDF document-RAG: whole-document overview ────────────────────────────────
# System prompt (the excerpt is sent as the user turn — NOT a .format() template, because the
# example below contains literal JSON braces that str.format would choke on).
PDF_RAG_SUMMARY_SYSTEM = (
    "You write a short overview of a document from an excerpt of its text. Respond in STRICT JSON "
    "only: {\"overview\": string, \"topics\": [string, ...]}. "
    "'overview' = 2-4 plain sentences on what this document IS and what it's telling the reader — the "
    "gist and purpose, not a table of contents. 'topics' = 3-6 short key topics/sections it covers. "
    "Base it ONLY on the excerpt; never invent. No markdown, JSON only.\n\n"
    "EXAMPLE\n"
    "DOCUMENT EXCERPT: \"...Level 1 covers five prompting rules. Level 2 is about connecting the model "
    "to your data with RAG and MCP so it can act on your business...\"\n"
    "JSON: {\"overview\": \"A practical playbook for leveling up how you use AI, from prompting "
    "technique to connected, action-taking assistants. It's aimed at builders who want AI that knows "
    "their business and can act, not just chat.\", \"topics\": [\"Prompting principles\", \"RAG over "
    "your own data\", \"MCP connectors / taking actions\", \"Projects to ship\"]}"
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


# ── AI Data Analyst: natural language -> pandas ──────────────────────────────
# The generated code runs client-side in the browser's Pyodide sandbox (no server exec, no
# host filesystem/network), on a DataFrame `df` that's already loaded. System prompt; the
# schema+question go in the user turn.
ANALYST_SYSTEM = (
    "You are a senior data analyst. A pandas DataFrame named `df` is already loaded, and `pd` "
    "(pandas), `np` (numpy) and `plt` (matplotlib.pyplot, non-interactive AGG backend) are already "
    "imported. Given the DataFrame's profile and a question, write Python that computes the answer. "
    "Respond in STRICT JSON only: {\"code\": string, \"explanation\": string, \"chart\": {\"type\": "
    "\"bar\"|\"line\"|\"pie\", \"x\": string, \"y\": string} | null}.\n"
    "RULES:\n"
    "- Assign the final tabular/scalar answer to a variable named `result` (a pandas DataFrame or "
    "Series is preferred; a scalar is fine). Keep `result` small — aggregate or limit to ~50 rows.\n"
    "- Use ONLY pandas / numpy / matplotlib (`plt`). Do NOT import os/sys/subprocess/requests/socket, "
    "do NOT read or write files, do NOT touch the network. You MAY `import matplotlib` variants and "
    "`from scipy import stats` if genuinely needed for a statistic.\n"
    "- Only reference columns that exist in the profile. Coerce dtypes defensively "
    "(pd.to_numeric(..., errors='coerce'), pd.to_datetime(..., errors='coerce')) rather than assuming.\n"
    "- Think like an analyst, not a calculator: when the question invites it, surface the DRIVERS "
    "(Pareto 80/20 cohorts), distribution shape / outliers (IQR), or correlations — not just a raw "
    "mean. Compute domain KPIs where the columns imply them.\n"
    "VISUALS — pick exactly ONE path per answer:\n"
    "- SIMPLE categorical/temporal comparison (a value per category, or a value over time): set "
    "`chart` to a Recharts spec with x/y columns that exist in `result` (pie: x=label, y=value), and "
    "do NOT draw with matplotlib.\n"
    "- STATISTICAL visual that Recharts can't do — correlation heatmap, box/violin distribution, "
    "Pareto, scatter, histogram: DRAW it with `plt` (a single clean figure: title, labelled axes, "
    "plt.tight_layout(), a muted palette, no overlapping text) and set `chart` to null. The figure is "
    "captured automatically — do NOT call plt.show() or plt.savefig().\n"
    "- No chart needed: chart=null and no plt drawing.\n"
    "'explanation' = 1-2 plain sentences on WHAT the analysis computes and why it answers the "
    "question. Do NOT assert specific result values, correlation coefficients, rankings or "
    "percentages you have not actually computed — the quantified finding is delivered separately "
    "after the code runs. JSON only, no markdown.\n\n"
    "EXAMPLE\n"
    "PROFILE: 1200 rows; columns: region (object), sales (float64), month (object)\n"
    "QUESTION: total sales by region, biggest first\n"
    "JSON: {\"code\": \"result = df.groupby('region', as_index=False)['sales'].sum()"
    ".sort_values('sales', ascending=False)\", \"explanation\": \"Sales concentrate in the top "
    "regions — the leader outsells the tail several times over.\", \"chart\": {\"type\": \"bar\", "
    "\"x\": \"region\", \"y\": \"sales\"}}\n"
    "EXAMPLE\n"
    "PROFILE: 800 rows; columns: age (int64), income (float64), score (float64)\n"
    "QUESTION: how do the numeric fields relate\n"
    "JSON: {\"code\": \"num = df[['age','income','score']].apply(pd.to_numeric, errors='coerce'); "
    "corr = num.corr(); result = corr.round(2); import numpy as _np; fig, ax = plt.subplots(figsize="
    "(4.5,3.8)); im = ax.imshow(corr, cmap='cividis', vmin=-1, vmax=1); ax.set_xticks(range(len("
    "corr.columns))); ax.set_yticks(range(len(corr.columns))); ax.set_xticklabels(corr.columns, "
    "rotation=45, ha='right', fontsize=8); ax.set_yticklabels(corr.columns, fontsize=8); "
    "[ax.text(j,i,f'{corr.iloc[i,j]:.2f}',ha='center',va='center',fontsize=8,color='white') for i in "
    "range(len(corr)) for j in range(len(corr))]; ax.set_title('Correlation matrix', fontsize=10); "
    "fig.colorbar(im, fraction=0.046); plt.tight_layout()\", \"explanation\": \"Income and score move "
    "together most strongly; age is weakly related to both.\", \"chart\": null}"
)


# ── AI Data Analyst: Phase 1 — hypotheses + KPIs + starter questions ──────────
# Fed a DETERMINISTIC profile computed client-side (dtypes, missingness, numeric stats, top
# categoricals). Returns an analyst's opening read, so the screen is useful before the first
# question. JSON only.
ANALYST_HYPOTHESES_SYSTEM = (
    "You are a senior data analyst doing structural reconnaissance on a fresh dataset. You are given "
    "an automated profile (shape, per-column dtype + missing%, numeric distributions, top categorical "
    "values). WITHOUT any further computation, respond in STRICT JSON only: {\"read\": string, "
    "\"hypotheses\": [string], \"kpis\": [{\"name\": string, \"why\": string}], \"questions\": "
    "[string]}.\n"
    "- 'read' = one grounded sentence on what this dataset appears to be and its grain (one row = ?).\n"
    "- 'hypotheses' = 3-5 concrete, testable business hypotheses grounded strictly in the columns "
    "and types shown (e.g. 'churn concentrates in month-to-month contracts'). No generic filler.\n"
    "- 'kpis' = 2-4 KPIs native to this dataset's domain (SaaS→LTV/CAC/MRR/churn; e-commerce→AOV/"
    "conversion; ops→throughput; finance→burn), each with a one-line 'why it matters here'. Only "
    "propose KPIs the columns can actually support.\n"
    "- 'questions' = 4-6 specific, clickable analysis questions phrased the way a user would type them "
    "(short, plain English), each answerable from these columns.\n"
    "Ground everything in the actual column names. JSON only, no markdown."
)


# ── AI Data Analyst: Phase 6 — executive SCR synthesis ───────────────────────
# Runs AFTER the generated code executes, on the actual (small) result. Turns a table/number into a
# decision, using the Situation-Complication-Resolution + Descriptive/Diagnostic/Prescriptive frame.
ANALYST_SCR_SYSTEM = (
    "You are JARVIS delivering a senior analyst's read-out. You are given the user's question and the "
    "ACTUAL computed result (already small). Translate it into decision-ready business logic — never "
    "restate raw numbers without their operational implication. Respond in STRICT JSON only: "
    "{\"scorecard\": [string], \"descriptive\": string, \"diagnostic\": string, \"prescriptive\": "
    "string}.\n"
    "- 'scorecard' = 1-3 punchy headline metrics/takeaways (each a short phrase, e.g. 'Top 3 SKUs = "
    "62% of revenue').\n"
    "- 'descriptive' = what the data shows (1-2 sentences, reference the actual figures).\n"
    "- 'diagnostic' = the likely driver / hidden anomaly behind it (1-2 sentences; reason from the "
    "numbers, flag if it's inference).\n"
    "- 'prescriptive' = the concrete operational action to take next (1-2 sentences).\n"
    "Composed, confident, plain spoken sentences — no markdown, no bullet characters inside the "
    "strings. If the result is too thin to support a claim, say so honestly in 'descriptive' and keep "
    "the rest brief. JSON only."
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
