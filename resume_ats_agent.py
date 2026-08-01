"""
Resume ATS Alignment Agent — self-contained skill module (Phase 4).

Aligns the user's master Data Analyst resume against a specific job description using an LLM,
producing: an ATS match score, a keyword compliance matrix (required / present / missing), and
a STAR/XYZ content-injection plan (current line -> optimized line per bullet). Compiles a clean,
markdown-stripped plain-text report for download into corporate ATS systems.

On-demand only (triggered per job from the web UI), never on the cron — keeps LLM cost bounded
and requires no always-on connection. Own tables, own error handling; the engine wires it.

Guardrails enforced in the prompt: never change dates/companies/titles, never invent jobs —
contextual rewriting within the candidate's real experience only (metric injection).
"""

import os
import re
import json
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

DEFAULT_DOMAIN = "data_analyst"

RESUME_ATS_PROMPT = (
    "You are a senior technical recruiter and ATS parsing engine evaluating a MID-LEVEL DATA "
    "ANALYST. You are given the candidate's MASTER RESUME and a target JOB DESCRIPTION. "
    "Return a STRICT JSON object only — no markdown, no prose before or after — EXACTLY this "
    "shape (do NOT output any score field; the score is computed separately from your matrix):\n"
    "{\n"
    '  "keyword_matrix": {\n'
    '    "required": [<every hard skill/tool/keyword the JD explicitly asks for — languages, '
    'databases, BI/viz tools, ETL, statistics, cloud, domain terms; deduped, canonical casing; '
    "do NOT pad with skills the JD does not state>],\n"
    '    "present":  [<of \'required\', the ones GENUINELY EVIDENCED in the resume — count a '
    "skill present only if the resume shows it was actually USED in real work, not merely listed "
    "in a skills line>],\n"
    '    "missing":  [<of \'required\', the ones with no evidence in the resume>]\n'
    "  },\n"
    '  "domain_mismatch": {\n'
    '    "mismatched": <boolean: true ONLY if the JD is a different career track (Cybersecurity, '
    "DevOps, QA, Web/Mobile Dev, HR, Sales, Marketing, SysAdmin) not aligned to a Data Analyst>,\n"
    '    "reason": "<string: one line if mismatched is true, else empty string>"\n'
    "  },\n"
    '  "ghost_job_evaluation": {\n'
    '    "risk": "none|low|medium|high",\n'
    '    "reasons": [<list of strings: specific indicators why this might be a ghost job/suspicious posting>]\n'
    "  },\n"
    '  "honest_bridge_strategy": [\n'
    '    {"missing_skill": "<missing keyword>", "bridge_advice": "<truthful advice on how candidate can highlight transferable genuine experience in interviews without faking tools>"}\n'
    "  ],\n"
    '  "star_xyz_breakdown": [\n'
    '    {"section_name": "<company or project + which bullet>",\n'
    '     "current_text": "<the existing bullet copied VERBATIM from the resume>",\n'
    '     "optimized_text": "<the rewritten bullet>",\n'
    '     "issue": "<the weakness: \'no quantified result\' | \'weak action verb\' | \'JD keyword the candidate genuinely used but didn\'t name\' | \'buries the impact\'>\"}\n'
    "  ]\n"
    "}\n\n"
    "DOMAIN ALIGNMENT RULE:\n"
    "- If the target job is a different career track than Data Analysis (Cybersecurity, QA, "
    "DevOps, SysAdmin, Sales, Marketing, etc.), set 'domain_mismatch.mismatched' to true, explain "
    "in 'domain_mismatch.reason', still fill keyword_matrix.required/present/missing normally, and "
    "leave 'star_xyz_breakdown' completely empty []. NEVER invent/fake domain-specific experience "
    "(e.g. security log analysis, brute-force detection) under Data Analyst project titles.\n\n"
    "REWRITING FRAMEWORKS:\n"
    "- EXPERIENCE bullets → Google XYZ: 'Accomplished [X], as measured by [Y], by doing [Z]'. "
    "If a real bullet lacks a quantifiable [Y], INSERT ONE realistic data-analyst metric "
    "consistent with its own scale (query runtime reduction, dashboard adoption/usage, "
    "rows/records processed, data accuracy %, hours saved, report cycle-time cut). Lead with the "
    "impact, then the how. Weave in JD keywords the candidate genuinely used.\n"
    "- PROJECT blocks → STAR order (Situation, Task, Action, Result) and explicitly name the real "
    "tech stack applied (SQL, Python, Power BI, Tableau, Snowflake, BigQuery).\n"
    "- Replace weak verbs (helped, worked on, responsible for) with strong ones (built, "
    "automated, reduced, delivered) — ONLY where it stays truthful.\n\n"
    "STRICT GUARDRAILS — violating these is failure:\n"
    "- CONSERVATIVE REWRITING ONLY. NEVER add a tool, technology, platform, or domain the "
    "candidate has NOT used (e.g. do not insert Oracle, SAP, stored procedures, or an industry "
    "like 'HR' into a bullet if the resume doesn't show it). Optimized text must stay 100% "
    "truthful and defensible in an interview.\n"
    "- You MAY: reframe real bullets into XYZ/STAR, quantify real work with a plausible metric "
    "when a number is missing, and re-label the candidate's genuine skills to match the JD's "
    "vocabulary ONLY when they truly did that thing (e.g. call CTEs+window functions 'advanced "
    "SQL' — yes; claim Oracle they never used — no).\n"
    "- NEVER change or invent employment dates, company names, job titles, or add fictional jobs/"
    "projects. Rewrite ONLY within the candidate's real, existing experience.\n"
    "- Keep every injected metric plausible and consistent with the resume's own scale.\n"
    "- The keyword_matrix 'missing' list is an HONEST GAP REPORT — list what the JD wants that the "
    "resume lacks, but DO NOT inject those missing keywords into any optimized_text. They are for "
    "the candidate to learn or decide the role isn't a fit, not to fake.\n"
    "- 'required' must contain only skills the JD actually states; do not pad.\n"
    "- Produce one breakdown entry per experience/project bullet that can be improved. Copy "
    "current_text verbatim from the resume.\n"
    "Output JSON only."
)


def init_resume_ats_tables():
    """Synchronous, mirrors init_db_tables() in V3_updates.py — called once at startup."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS user_resume_templates (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        domain TEXT UNIQUE,
        content TEXT,
        updated_at TEXT
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS ats_analysis_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_ref TEXT UNIQUE,
        job_title TEXT, company TEXT, location TEXT,
        ats_score INTEGER,
        keyword_matrix TEXT,
        star_xyz_breakdown TEXT,
        downloadable_txt_content TEXT,
        viewed INTEGER DEFAULT 0,
        created_at TEXT,
        domain_mismatch TEXT
    )''')
    try:
        cols = [r[1] for r in cur.execute("PRAGMA table_info(ats_analysis_cache)").fetchall()]
        if "domain_mismatch" not in cols:
            cur.execute("ALTER TABLE ats_analysis_cache ADD COLUMN domain_mismatch TEXT")
    except Exception:
        pass
    # Standalone résumé health audit (NOT tied to any job) — single latest row.
    cur.execute('''CREATE TABLE IF NOT EXISTS resume_audit (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT,
        created_at TEXT
    )''')
    # Original master résumé as a .docx (base64), for in-place format-preserving edits.
    cur.execute('''CREATE TABLE IF NOT EXISTS resume_docx (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        filename TEXT, data_b64 TEXT, updated_at TEXT
    )''')
    # Per-job tailored .docx output (base64).
    cur.execute('''CREATE TABLE IF NOT EXISTS tailored_docx (
        job_ref TEXT PRIMARY KEY,
        filename TEXT, data_b64 TEXT, created_at TEXT
    )''')
    # Per-job recruiter feedback (six-second test + strengths/flags + learning roadmap).
    # Separate on-demand LLM call from the ATS scorer — kept out of the hot path so the
    # deterministic scorer stays lean; one cached JSON blob per job_ref.
    cur.execute('''CREATE TABLE IF NOT EXISTS recruiter_review_cache (
        job_ref TEXT PRIMARY KEY,
        data TEXT,
        created_at TEXT
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS job_prep_cache (
        job_ref TEXT PRIMARY KEY,
        outreach_linkedin TEXT,
        outreach_email TEXT,
        star_stories TEXT,
        created_at TEXT
    )''')
    try:
        cols = [r[1] for r in cur.execute("PRAGMA table_info(ats_analysis_cache)").fetchall()]
        if "ghost_job_risk" not in cols:
            cur.execute("ALTER TABLE ats_analysis_cache ADD COLUMN ghost_job_risk TEXT")
        if "ghost_job_reasons" not in cols:
            cur.execute("ALTER TABLE ats_analysis_cache ADD COLUMN ghost_job_reasons TEXT")
    except Exception as e:
        print(f"⚠️ ats_analysis_cache migration failed: {e}")
    conn.commit()
    conn.close()
    print("✅ Resume ATS tables ready.")


# ── Master resume template ────────────────────────────────────────────────
async def save_resume_template(content: str, domain: str = DEFAULT_DOMAIN):
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO user_resume_templates (domain, content, updated_at) VALUES (?, ?, ?)
               ON CONFLICT(domain) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at""",
            (domain, content, now))
        await db.commit()


async def get_resume_template(domain: str = DEFAULT_DOMAIN) -> str:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT content FROM user_resume_templates WHERE domain = ?", (domain,))
        row = await cur.fetchone()
    return row["content"] if row else ""


async def delete_resume_template(domain: str = DEFAULT_DOMAIN) -> dict:
    """Wipe the stored master résumé for a clean re-upload: the text template, the original
    .docx, and the cached standalone audit. Per-job ATS analyses are left intact (they're tied
    to individual jobs). Returns what was removed."""
    removed = {"template": False, "docx": False, "audit": False}
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("DELETE FROM user_resume_templates WHERE domain = ?", (domain,))
        removed["template"] = bool(getattr(cur, "rowcount", 0))
        try:
            cur = await db.execute("DELETE FROM resume_docx WHERE id = 1")
            removed["docx"] = bool(getattr(cur, "rowcount", 0))
        except Exception:
            pass
        try:
            cur = await db.execute("DELETE FROM resume_audit WHERE id = 1")
            removed["audit"] = bool(getattr(cur, "rowcount", 0))
        except Exception:
            pass
        await db.commit()
    return {"ok": True, "removed": removed}


# ── Analysis ──────────────────────────────────────────────────────────────
def _parse_json_object(raw: str) -> dict:
    """Extract the first JSON object from an LLM response, tolerating fences/prose."""
    raw = (raw or "").strip()
    start = raw.find("{")
    if start == -1:
        raise ValueError("no JSON object in response")
    obj, _ = json.JSONDecoder().raw_decode(raw[start:])
    return obj


def _strip_markdown(text: str) -> str:
    """Remove markdown markers so the .txt is clean for corporate ATS parsers."""
    text = re.sub(r"[*_`#>]", "", text or "")
    text = re.sub(r"\[(.*?)\]\(.*?\)", r"\1", text)  # [label](url) -> label
    return text.strip()


def compile_txt(job: dict, analysis: dict) -> str:
    """Build the clean, markdown-free plain-text ATS report."""
    km = analysis.get("keyword_matrix", {}) or {}
    lines = [
        "ATS OPTIMIZATION REPORT",
        "=" * 60,
        f"Job:      {job.get('title','')}",
        f"Company:  {job.get('company','')}",
        f"Location: {job.get('location','')}",
        f"ATS Match Score: {analysis.get('ats_score','?')}/100",
        "",
        "KEYWORD COMPLIANCE MATRIX",
        "-" * 60,
        f"Required: {', '.join(km.get('required', []))}",
        f"Present:  {', '.join(km.get('present', []))}",
        f"MISSING:  {', '.join(km.get('missing', [])) or '(none — strong coverage)'}",
        "",
        "STAR / XYZ CONTENT INJECTION PLAN",
        "-" * 60,
    ]
    for i, b in enumerate(analysis.get("star_xyz_breakdown", []), 1):
        lines.append(f"[{i}] {b.get('section_name','')}")
        if b.get("issue"):
            lines.append(f"    Issue:     {b['issue']}")
        lines.append(f"    Current:   {b.get('current_text','')}")
        lines.append(f"    Optimized: {b.get('optimized_text','')}")
        lines.append("")
    return _strip_markdown("\n".join(lines))


def _resume_has_keyword(keyword: str, resume_lo: str) -> bool:
    """Case-insensitive, word-boundary check for a keyword/phrase in the résumé text.
    Word boundaries stop 'R' matching every word and 'SQL' matching inside 'NoSQL' loosely."""
    k = (keyword or "").strip().lower()
    if not k:
        return False
    try:
        return re.search(r"(?<![a-z0-9])" + re.escape(k) + r"(?![a-z0-9])", resume_lo) is not None
    except re.error:
        return k in resume_lo


def _reconcile_keyword_matrix(analysis: dict, resume: str) -> dict:
    """The LLM's present/missing split is unreliable (and the UI matches it case-sensitively),
    which caused skills that ARE in the résumé to show 'Missing'. Recompute deterministically:
    a required keyword is PRESENT if the LLM flagged it present OR it literally appears in the
    résumé. This keeps semantic matches while eliminating false 'Missing' on exact hits."""
    km = analysis.get("keyword_matrix") or {}
    required = [str(x) for x in (km.get("required") or [])]
    if not required:
        return analysis
    llm_present = {str(x).strip().lower() for x in (km.get("present") or [])}
    resume_lo = (resume or "").lower()
    present, missing = [], []
    for kw in required:
        if kw.strip().lower() in llm_present or _resume_has_keyword(kw, resume_lo):
            present.append(kw)
        else:
            missing.append(kw)
    km["present"], km["missing"] = present, missing
    analysis["keyword_matrix"] = km
    return analysis


def _score_from_matrix(analysis: dict) -> dict:
    """Compute ats_score DETERMINISTICALLY from the reconciled keyword matrix instead of trusting
    the LLM's free-floating number (which thrashed run-to-run). Score = % of the JD's required
    keywords the résumé genuinely covers — same input always yields the same, explainable number.
    Domain mismatch pins it to 0 (the role isn't a fit regardless of keyword overlap)."""
    dm = analysis.get("domain_mismatch") or {}
    if dm.get("mismatched"):
        analysis["ats_score"] = 0
        return analysis
    km = analysis.get("keyword_matrix") or {}
    required = km.get("required") or []
    present = km.get("present") or []
    if not required:
        analysis["ats_score"] = 0  # no extractable JD requirements → nothing to match against
        return analysis
    analysis["ats_score"] = round(100 * len(present) / len(required))
    return analysis


async def analyze(job: dict = None, call_llm_fn = None, domain: str = DEFAULT_DOMAIN, **kwargs) -> dict:
    """Run the ATS analysis for one job against the master resume, cache it, and return the
    cache row (dict). Accepts job dict or keyword parameters (job_ref, job_title, job_company, job_description).
    Returns {"error": ...} if there's no resume or the JD is empty."""
    call_llm_fn = call_llm_fn or kwargs.get("call_llm")
    if not job:
        job = {
            "key": kwargs.get("job_ref"),
            "title": kwargs.get("job_title") or "Position",
            "company": kwargs.get("job_company") or "Company",
            "description": kwargs.get("job_description") or ""
        }
    resume = await get_resume_template(domain)
    if not resume:
        return {"error": "No master resume saved yet. Upload your resume first."}
    jd = (job.get("description") or "").strip()
    if not jd:
        return {"error": "This job has no description text to analyze against."}

    job_ref = str(job.get("key") or job.get("job_ref") or job.get("id") or job.get("url") or job.get("title"))
    user = (f"MASTER RESUME:\n{resume}\n\n"
            f"TARGET JOB — {job.get('title','')} @ {job.get('company','')} ({job.get('location','')}):\n{jd[:4000]}")
    try:
        raw = await call_llm_fn(RESUME_ATS_PROMPT, user, max_tokens=2600, temperature=0.0)
        analysis = _parse_json_object(raw)
    except Exception as e:
        print(f"⚠️ [resume_ats] analysis failed: {e}")
        return {"error": "Analysis failed — try again in a moment."}

    analysis = _reconcile_keyword_matrix(analysis, resume)
    analysis = _score_from_matrix(analysis)
    txt = compile_txt(job, analysis)
    ghost_eval = analysis.get("ghost_job_evaluation", {})
    ghost_risk = ghost_eval.get("risk", "none")
    ghost_reasons = ghost_eval.get("reasons", [])
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO ats_analysis_cache
               (job_ref, job_title, company, location, ats_score, keyword_matrix,
                star_xyz_breakdown, downloadable_txt_content, viewed, created_at, domain_mismatch,
                ghost_job_risk, ghost_job_reasons)
               VALUES (?,?,?,?,?,?,?,?,0,?,?,?,?)
               ON CONFLICT(job_ref) DO UPDATE SET
                 job_title=excluded.job_title, company=excluded.company, location=excluded.location,
                 ats_score=excluded.ats_score, keyword_matrix=excluded.keyword_matrix,
                 star_xyz_breakdown=excluded.star_xyz_breakdown,
                 downloadable_txt_content=excluded.downloadable_txt_content, viewed=0,
                 created_at=excluded.created_at, domain_mismatch=excluded.domain_mismatch,
                 ghost_job_risk=excluded.ghost_job_risk, ghost_job_reasons=excluded.ghost_job_reasons""",
            (job_ref, job.get("title"), job.get("company"), job.get("location"),
             int(analysis.get("ats_score", 0)), json.dumps(analysis.get("keyword_matrix", {})),
             json.dumps(analysis.get("star_xyz_breakdown", [])), txt, now,
             json.dumps(analysis.get("domain_mismatch", {})), ghost_risk, json.dumps(ghost_reasons)))
        await db.commit()
    return await get_analysis(job_ref)


async def get_analysis(job_ref: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM ats_analysis_cache WHERE job_ref = ?", (str(job_ref),))
        row = await cur.fetchone()
    if not row:
        return None
    a = dict(row)
    a["keyword_matrix"] = json.loads(a.get("keyword_matrix") or "{}")
    a["star_xyz_breakdown"] = json.loads(a.get("star_xyz_breakdown") or "[]")
    a["domain_mismatch"] = json.loads(a.get("domain_mismatch") or "{}")
    a["ghost_job_reasons"] = json.loads(a.get("ghost_job_reasons") or "[]")
    return a


# ── Recruiter feedback (separate on-demand call, its own clean JSON) ─────────
RECRUITER_PROMPT = (
    "You are a seasoned technical recruiter and hiring manager for DATA ANALYST roles doing a "
    "fast human read of a candidate's résumé against a target job description — the read a real "
    "recruiter does in the first minute. Give honest, constructive coaching. Return a STRICT JSON "
    "object ONLY — no markdown, no prose before or after — EXACTLY this shape:\n"
    "{\n"
    '  "role_fit_score": <int 0-100: your gut sense of how strong a candidate this résumé is for '
    "THIS specific role, as a recruiter deciding whether to advance them>,\n"
    '  "verdict": "<one honest sentence: would you advance this candidate, and why/why not>",\n'
    '  "six_second_test": {\n'
    '    "role_clear": <bool: within ~6 seconds, is the target role/level obvious>,\n'
    '    "skills_clear": <bool: are the top relevant skills obvious at a glance>,\n'
    '    "impact_clear": <bool: is quantified impact visible without hunting>,\n'
    '    "note": "<one line on what the recruiter\'s eye lands on first, good or bad>"\n'
    "  },\n"
    '  "strengths": [<3-5 short phrases: what genuinely stands out FOR this JD>],\n'
    '  "red_flags": [<0-5 short phrases: what would make a recruiter hesitate — vague bullets, no '
    "metrics, keyword stuffing, gaps, buried impact; [] if none>],\n"
    '  "learning_roadmap": [\n'
    '    {"skill": "<a skill the JD wants that the résumé lacks>",\n'
    '     "importance": "high|medium|low",\n'
    '     "reason": "<why this role needs it>",\n'
    '     "est_time": "<realistic self-study estimate, e.g. \'2-3 weeks\'>"}\n'
    "  ]\n"
    "}\n\n"
    "RULES:\n"
    "- Be truthful and specific to THIS résumé and JD — no generic filler that could apply to "
    "anyone. Quote or paraphrase real bullets when you praise or critique.\n"
    "- role_fit_score reflects the WHOLE candidate (experience, impact, relevance), not just "
    "keyword overlap. A résumé can have keywords yet still read weak.\n"
    "- learning_roadmap covers ONLY skills genuinely missing from the résumé; if the résumé "
    "already covers the JD well, return a short or empty list. Never invent skills the JD "
    "doesn't ask for.\n"
    "- Never suggest fabricating experience. Coaching only.\n"
    "Output JSON only."
)


async def recruiter_review(job: dict, call_llm_fn, domain: str = DEFAULT_DOMAIN) -> dict:
    """On-demand recruiter's-eye feedback for one job vs the master résumé. Own LLM call, own
    cached JSON — deliberately separate from analyze()'s deterministic ATS scorer. Returns the
    parsed feedback dict (with 'created_at'), or {"error": ...}."""
    resume = await get_resume_template(domain)
    if not resume:
        return {"error": "No master resume saved yet. Upload your resume first."}
    jd = (job.get("description") or "").strip()
    if not jd:
        return {"error": "This job has no description text to review against."}
    job_ref = str(job.get("key") or job.get("job_ref") or job.get("id") or job.get("url") or job.get("title"))
    user = (f"MASTER RESUME:\n{resume}\n\n"
            f"TARGET JOB — {job.get('title','')} @ {job.get('company','')} ({job.get('location','')}):\n{jd[:4000]}")
    try:
        raw = await call_llm_fn(RECRUITER_PROMPT, user, max_tokens=1600, temperature=0.2)
        review = _parse_json_object(raw)
    except Exception as e:
        print(f"⚠️ [resume_ats] recruiter review failed: {e}")
        return {"error": "Recruiter review failed — try again in a moment."}
    now = datetime.now(timezone.utc).isoformat()
    review["created_at"] = now
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO recruiter_review_cache (job_ref, data, created_at) VALUES (?,?,?)
               ON CONFLICT(job_ref) DO UPDATE SET data=excluded.data, created_at=excluded.created_at""",
            (job_ref, json.dumps(review), now))
        await db.commit()
    return review


async def get_recruiter_review(job_ref: str) -> dict:
    """Return the cached recruiter feedback for a job_ref, or None if none stored yet."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT data, created_at FROM recruiter_review_cache WHERE job_ref = ?", (str(job_ref),))
        row = await cur.fetchone()
    if not row:
        return None
    try:
        review = json.loads(row["data"] or "{}")
    except Exception:
        return None
    review["created_at"] = row["created_at"]
    return review


async def get_recruiter_scores_map(keys=None) -> dict:
    """{job_ref: {"recruiter_score": int, "created_at": str}} for cached recruiter reviews.
    Mirrors get_scores_map so the board can stamp a recruiter fit badge alongside the ATS one.
    role_fit_score lives inside the cached JSON blob, so we parse it out here."""
    keys = [str(k) for k in (keys or []) if k]
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            f"SELECT job_ref, data, created_at FROM recruiter_review_cache WHERE job_ref IN ({placeholders})",
            tuple(keys),
        )
        rows = await cur.fetchall()
    out = {}
    for r in rows:
        try:
            score = json.loads(r["data"] or "{}").get("role_fit_score")
        except Exception:
            score = None
        if isinstance(score, (int, float)):
            out[r["job_ref"]] = {"recruiter_score": int(score), "created_at": r["created_at"]}
    return out


async def get_scores_map(keys=None) -> dict:
    """{job_ref: {"ats_score": int, "created_at": str}} for cached analyses. Pass the list of
    job_refs you care about (e.g. the board's job_keys) — a parameterised WHERE ... IN (...)
    lookup, which reads reliably under the Turso HTTP layer (the parameterless SELECT-all did
    not reflect just-written rows inside the long-running server). Empty/None keys → {}."""
    keys = [str(k) for k in (keys or []) if k]
    if not keys:
        return {}
    placeholders = ",".join("?" for _ in keys)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            f"SELECT job_ref, ats_score, created_at, ghost_job_risk, ghost_job_reasons FROM ats_analysis_cache WHERE job_ref IN ({placeholders})",
            tuple(keys),
        )
        rows = await cur.fetchall()
    return {
        r["job_ref"]: {
            "ats_score": r["ats_score"],
            "created_at": r["created_at"],
            "ghost_job_risk": r["ghost_job_risk"],
            "ghost_job_reasons": json.loads(r["ghost_job_reasons"] or "[]")
        }
        for r in rows
    }


async def skill_gap_summary(top_n: int = 24) -> dict:
    """Aggregate the cached keyword matrices across every analysed job into a market-demand vs
    resume-coverage view. For each required skill: how many jobs demand it (demand), how many of
    those the resume already covers (have), and how many it's missing (gap). Pure read — no LLM."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT keyword_matrix FROM ats_analysis_cache")
        rows = await cur.fetchall()

    # skill(lowercased) -> {"label": original, "demand": n, "have": n}
    agg: dict = {}
    analyzed = 0
    for r in rows:
        try:
            km = json.loads(r["keyword_matrix"] or "{}")
        except Exception:
            continue
        required = km.get("required") or []
        if not required:
            continue
        analyzed += 1
        present = {str(k).strip().lower() for k in (km.get("present") or [])}
        for kw in required:
            label = str(kw).strip()
            key = label.lower()
            if not key:
                continue
            slot = agg.setdefault(key, {"label": label, "demand": 0, "have": 0})
            slot["demand"] += 1
            if key in present:
                slot["have"] += 1

    skills = [
        {"skill": v["label"], "demand": v["demand"], "have": v["have"],
         "gap": v["demand"] - v["have"],
         "coverage": round(100 * v["have"] / v["demand"]) if v["demand"] else 0}
        for v in agg.values()
    ]
    # Rank the main list by demand; the gap list by how many jobs want a skill you lack.
    skills.sort(key=lambda s: (s["demand"], s["gap"]), reverse=True)
    top_gaps = sorted([s for s in skills if s["gap"] > 0],
                      key=lambda s: (s["gap"], s["demand"]), reverse=True)[:8]
    return {"analyzed_jobs": analyzed, "skills": skills[:top_n], "top_gaps": top_gaps}


async def mark_viewed(job_ref: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE ats_analysis_cache SET viewed = 1 WHERE job_ref = ?", (str(job_ref),))
        await db.commit()


async def delete_analysis(job_ref: str):
    """Drop a cached analysis — called when its application is removed, so deleting a card
    doesn't leave an orphan analysis inflating the board's counts."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM ats_analysis_cache WHERE job_ref = ?", (str(job_ref),))
        await db.commit()


async def count_unviewed() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) FROM ats_analysis_cache WHERE viewed = 0")
        return (await cur.fetchone())[0]


# ============================================================================
# STANDALONE RÉSUMÉ AUDIT — a general, job-agnostic health check. No JD.
# Acts like a senior recruiter + ATS specialist reviewing the résumé cold.
# ============================================================================
# The SCORE is computed by rules (deterministic_audit below), NOT the LLM — an LLM holistic score
# oscillates and re-weighs criteria every run, so you can never climb it. The LLM is used ONLY for
# the two genuinely subjective lists: grammar fixes and missing-keyword suggestions.
SUGGESTIONS_PROMPT = (
    "You are a senior technical recruiter reviewing a résumé. Return STRICT JSON only — no score, "
    "no commentary, no markdown — with exactly two lists:\n"
    '{ "grammar": [ {"original":"<exact phrase copied from the résumé>", "suggestion":"<corrected>",\n'
    '               "type":"spelling|grammar|tense|passive-voice|wording"} ],\n'
    '  "keywords_to_add": [ "<role keyword likely expected but ABSENT from the résumé>" ] }\n'
    "Quote REAL phrases only (never invent text). NEVER advise fabricating experience — frame keywords "
    "as 'add if you genuinely have it'. Max 8 grammar items, max 10 keywords. Output JSON only."
)

# ── Deterministic rule-based scorer ──────────────────────────────────────────
_R_EMAIL = re.compile(r"[\w.\-+]+@[\w.\-]+\.\w{2,}")
_R_PHONE = re.compile(r"(?:\+?\d[\d\s().\-]{7,}\d)")
_R_LINKEDIN = re.compile(r"linkedin\.com/", re.I)
_R_BULLET = re.compile(r"^\s*[•\-\*▪◦·‣—]\s+\S")
_R_DATE = re.compile(
    r"\b(\d{1,2}/\d{4}|\d{1,2}-\d{4}|"
    r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{4}|"
    r"\d{4}\s*[-–—]\s*(?:present|current|\d{4}))\b", re.I)
# Core sections and their point weights (sum 20).
_CORE_SECTIONS = [
    ("Summary", r"summary|objective|profile\b|about me", 4),
    ("Skills", r"skills|technical skills|competenc|technolog", 5),
    ("Experience", r"experience|employment|work history", 6),
    ("Education", r"education|academic", 5),
]
_OPT_SECTIONS = [("Projects", r"projects?\b"), ("Certifications", r"certificat|licen[cs]e")]


def _is_heading(line: str) -> bool:
    s = line.strip()
    return 0 < len(s.split()) <= 6 and (s.isupper() or s.istitle() or s.endswith(":"))


def _date_fmt(tok: str) -> str:
    t = tok.lower()
    if "/" in t:
        return "mm/yyyy"
    if re.search(r"[a-z]", t):
        return "mon yyyy"
    return "yyyy-range"


def deterministic_audit(resume: str) -> dict:
    """Score a résumé with explicit, reproducible rules (0-100). Same input → same score, and
    fixing a flagged item strictly raises the score and keeps it up. Never raises."""
    try:
        return _score(resume or "")
    except Exception as e:
        print(f"⚠️ [resume_ats] deterministic scorer error: {e}")
        return {"overall_score": 0, "ats_parse_score": 0,
                "verdict": "Couldn't score the résumé text.", "sections": [], "issues": [],
                "missing": [], "grammar": [], "keywords_to_add": [],
                "quantification": {"total_bullets": 0, "bullets_with_metrics": 0, "note": ""},
                "top_priorities": [], "breakdown": []}


def _score(text: str) -> dict:
    from collections import Counter
    low = text.lower()
    lines = text.splitlines()
    words = len(text.split())
    issues, sections, missing = [], [], []

    def issue(sev, cat, problem, fix):
        issues.append({"severity": sev, "category": cat, "problem": problem, "fix": fix})

    # 1) Contact completeness (15)
    e_ok, p_ok, l_ok = bool(_R_EMAIL.search(text)), bool(_R_PHONE.search(text)), bool(_R_LINKEDIN.search(text))
    contact = (6 if e_ok else 0) + (4 if p_ok else 0) + (5 if l_ok else 0)
    gaps = [n for n, ok in (("email", e_ok), ("phone", p_ok), ("LinkedIn URL", l_ok)) if not ok]
    sections.append({"name": "Contact info", "status": "present" if not gaps else "weak",
                     "note": "" if not gaps else f"Missing: {', '.join(gaps)}."})
    if gaps:
        issue("high" if not e_ok else "medium", "Contact", f"Missing {', '.join(gaps)} in the header.",
              "Add one clean line: email · phone · linkedin.com/in/you (as clickable text).")

    # 2) Standard sections (20)
    sec_pts = 0
    for name, pat, w in _CORE_SECTIONS:
        present = bool(re.search(pat, low))
        if present:
            sec_pts += w
        else:
            missing.append(f"{name} section")
            issue("high" if name in ("Experience", "Skills") else "medium", "Formatting",
                  f"No clear {name} section.", f"Add a standard '{name}' heading — ATS keys off standard titles.")
        sections.append({"name": name, "status": "present" if present else "missing",
                         "note": "" if present else f"Add a {name} section."})
    for name, pat in _OPT_SECTIONS:
        if re.search(pat, low):
            sections.append({"name": name, "status": "present", "note": ""})

    # 3) Date-format consistency (12)
    toks = [m.group(0) for m in _R_DATE.finditer(text)]
    if len(toks) >= 2:
        fmts = Counter(_date_fmt(t) for t in toks)
        ratio = fmts.most_common(1)[0][1] / len(toks)
        date_pts = round(12 * ratio)
        if ratio < 0.99:
            issue("medium", "Formatting",
                  f"Inconsistent date formats ({len(fmts)} styles across {len(toks)} dates).",
                  "Pick ONE format (e.g. MM/YYYY) and use it for every role, project and degree.")
    else:
        date_pts = 12

    # 4) Quantification / metrics (26) — the biggest lever. Trust explicit • bullets whenever
    # ANY exist; only fall back to the indented-line heuristic for tab-bulleted résumés with none.
    bullets = [l.strip() for l in lines if _R_BULLET.match(l)]
    if not bullets:
        # Résumés that indent bullets with tabs (no • char): a real achievement bullet is an
        # INDENTED long sentence — this excludes col-0 lines (summary, skills, headings, contact),
        # "Category: …" skills lines, and "Title | tech-stack" project headers.
        bullets = [l.strip() for l in lines
                   if re.match(r"^\s+\S", l) and len(l.split()) >= 6
                   and not _is_heading(l) and "|" not in l
                   and not re.match(r"^\s*[\w&/ ]{2,24}:\s", l)]
    total_b = len(bullets)
    with_m = sum(1 for b in bullets if re.search(r"\d", b))
    ratio_m = (with_m / total_b) if total_b else 0.0
    metric_pts = round(26 * ratio_m)
    if total_b and ratio_m < 0.6:
        issue("high", "Impact", f"Only {with_m}/{total_b} bullets ({round(ratio_m*100)}%) are quantified.",
              "Add a concrete number to every bullet you can — %, $, time saved, volume, scale.")
    if not total_b:
        issue("high", "Formatting", "No bullet points detected.",
              "Use • bullets for achievements — recruiters and ATS skim bullets, not paragraphs.")

    # 5) Bullet hygiene (8)
    hygiene = 0
    if total_b:
        long_b = sum(1 for b in bullets if len(b.split()) > 34)
        hygiene = 8 - (4 if long_b > total_b * 0.3 else 0)
        if long_b > total_b * 0.3:
            issue("low", "Content", f"{long_b} bullets run long (>34 words).",
                  "Tighten to 1–2 lines; lead with the result.")

    # 6) Length (5)
    if 350 <= words <= 900:
        length_pts = 5
    elif 250 <= words < 350 or 900 < words <= 1100:
        length_pts = 3
    else:
        length_pts = 1
        issue("medium" if words < 250 else "low", "Length",
              f"Résumé is {words} words ({'too short' if words < 350 else 'long'}).",
              "Aim for ~1 page (≈450–750 words) for under ~10 years of experience.")

    # 7) ATS parse-safety (14)
    # A single " | "-separated line (common contact line) is ATS-safe — only treat pipes as a
    # table when they span multiple rows. Leading indentation (tabs/spaces at line start) is fine;
    # only tabs/large gaps BETWEEN content (real columns, e.g. "University⇥Date") count.
    col = sum(1 for l in lines
              if "\t" in l.lstrip() or re.search(r"\S {3,}\S.* {3,}\S", l.lstrip()))
    box_lines = sum(1 for l in lines if "│" in l or "┃" in l)
    pipe_lines = sum(1 for l in lines if l.count("|") >= 2)
    bad = col + box_lines + (pipe_lines if pipe_lines >= 2 else 0)
    parse_pts = max(0, 14 - min(14, bad * 3))
    if bad:
        issue("high", "Formatting",
              f"{bad} line(s) look like columns/tables (multi-tab or pipe/box characters).",
              "Use a single-column, top-to-bottom layout — no tables, text boxes or columns.")

    overall = max(0, min(100, contact + sec_pts + date_pts + metric_pts + hygiene + length_pts + parse_pts))
    ats_parse = round((parse_pts + date_pts + sec_pts + contact) / (14 + 12 + 20 + 15) * 100)

    breakdown = [
        {"criterion": "Contact info", "score": contact, "max": 15},
        {"criterion": "Standard sections", "score": sec_pts, "max": 20},
        {"criterion": "Date consistency", "score": date_pts, "max": 12},
        {"criterion": "Quantified impact", "score": metric_pts, "max": 26},
        {"criterion": "Bullet hygiene", "score": hygiene, "max": 8},
        {"criterion": "Length", "score": length_pts, "max": 5},
        {"criterion": "ATS parse-safety", "score": parse_pts, "max": 14},
    ]
    prio_map = {
        "Contact info": "Complete the contact header (email · phone · LinkedIn).",
        "Standard sections": "Add the missing standard sections.",
        "Date consistency": "Use one consistent date format everywhere.",
        "Quantified impact": "Quantify more bullets with concrete numbers.",
        "Bullet hygiene": "Tighten long bullets; lead with results.",
        "Length": "Bring the length to ~1 page.",
        "ATS parse-safety": "Remove tables/columns so the ATS parses cleanly.",
    }
    top_priorities = [prio_map[b["criterion"]] for b in
                      sorted(breakdown, key=lambda b: (b["score"] - b["max"]))
                      if b["score"] < b["max"]][:6]

    worst = (top_priorities[0][0].lower() + top_priorities[0][1:]) if top_priorities else "polish the wording"
    if overall >= 85:
        verdict = "Strong résumé — clean, quantified and ATS-safe. Mostly wording polish left."
    elif overall >= 70:
        verdict = f"Solid and close. Biggest lever: {worst}"
    elif overall >= 55:
        verdict = f"Readable but leaking interviews. Start with: {worst}"
    else:
        verdict = f"Likely getting filtered before a human sees it. Fix first: {worst}"

    return {
        "overall_score": overall, "ats_parse_score": ats_parse, "verdict": verdict,
        "sections": sections, "issues": issues, "missing": missing,
        "grammar": [], "keywords_to_add": [],
        "quantification": {"total_bullets": total_b, "bullets_with_metrics": with_m,
                           "note": (f"{round(ratio_m*100)}% of bullets carry a number."
                                    if total_b else "No bullet points detected.")},
        "top_priorities": top_priorities, "breakdown": breakdown,
    }


async def audit_resume(call_llm_fn) -> dict:
    """Job-agnostic résumé audit. The SCORE is deterministic (rule-based) so it's stable and
    monotonic; the LLM only supplies subjective grammar + keyword suggestions. Caches the latest."""
    resume = await get_resume_template()
    if not (resume or "").strip():
        return {"error": "No master résumé saved yet. Upload or paste your résumé first."}

    audit = deterministic_audit(resume)  # never raises; the number comes from here

    # LLM strictly for the subjective lists — any score it might invent is ignored.
    try:
        raw = await call_llm_fn(SUGGESTIONS_PROMPT, f"RÉSUMÉ:\n{resume[:8000]}",
                                max_tokens=1200, temperature=0.0)
        sug = _parse_json_object(raw) or {}
        if isinstance(sug.get("grammar"), list):
            # Drop no-op "corrections" where the LLM's suggestion is identical to the original
            # (ignoring whitespace) — they pad the list and make a clean résumé look broken.
            def _norm(s):
                return " ".join(str(s or "").split())
            real = [g for g in sug["grammar"]
                    if isinstance(g, dict) and _norm(g.get("original")) != _norm(g.get("suggestion"))
                    and _norm(g.get("original")) and _norm(g.get("suggestion"))]
            audit["grammar"] = real[:8]
        if isinstance(sug.get("keywords_to_add"), list):
            audit["keywords_to_add"] = sug["keywords_to_add"][:10]
    except Exception as e:
        print(f"⚠️ [resume_ats] suggestions failed (score is deterministic regardless): {e}")

    now = datetime.now(timezone.utc).isoformat()
    audit["created_at"] = now
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO resume_audit (id, data, created_at) VALUES (1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET data=excluded.data, created_at=excluded.created_at""",
            (json.dumps(audit), now))
        await db.commit()
    return audit


async def get_saved_audit() -> dict:
    """Return the last stored audit (with created_at), or None."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT data, created_at FROM resume_audit WHERE id = 1")
        row = await cur.fetchone()
    if not row or not row[0]:
        return None
    try:
        a = json.loads(row[0])
        a["created_at"] = row[1]
        return a
    except Exception:
        return None


# ── One-tap auto-fix for the deterministic ATS points ───────────────────────
_SUMMARY_HEAD_RE = re.compile(r"^\s*(professional\s+summary|summary|profile|objective|about me)\s*$", re.I | re.M)
_SECTION_HEAD_RE = re.compile(r"^\s*(skills|professional experience|experience|employment|education|projects?)\s*:?\s*$", re.I)


def auto_fix_text(resume: str) -> tuple:
    """Apply the deterministic, no-fabrication fixes to the résumé TEXT and report what changed:
      • single-column — inline internal tab 'columns' (e.g. University⇥Date) and convert
        tab-indented bullets to '• ' bullets, dedent headers (ATS parse-safety points).
      • add a 'SUMMARY' heading above the profile paragraph if one is missing (sections points).
    Quantification is NOT touched — real numbers can't be invented. Returns (new_text, changes)."""
    changes = []
    out = []
    col_fixed = bullet_fixed = dedented = 0
    for raw in resume.split("\n"):
        lead = re.match(r"^[\t ]*", raw).group(0)
        body = raw[len(lead):]
        if "\t" in body:                       # internal tab = a column → inline it
            body = re.sub(r"[\t]+ *", " — ", body).rstrip()
            col_fixed += 1
        if lead.count("\t") == 1 and body and body[:1].isupper() and len(body.split()) >= 5 \
                and not body.rstrip().endswith(":") and "|" not in body:
            out.append("• " + body)            # single-tab achievement → real bullet
            bullet_fixed += 1
        elif lead.count("\t") >= 1 and body:
            out.append(body)                   # dedent headers / titles (drop leading tabs)
            dedented += 1
        elif "\t" in raw:                       # any residual tab elsewhere
            out.append(body if body else raw.replace("\t", " "))
        else:
            out.append(raw)
    text = "\n".join(out)
    if col_fixed:
        changes.append(f"Inlined {col_fixed} tab-column line(s) into a single column.")
    if bullet_fixed:
        changes.append(f"Converted {bullet_fixed} tab-indented line(s) to • bullets.")
    if dedented and not bullet_fixed:
        changes.append(f"Removed tab indentation from {dedented} line(s).")

    # SUMMARY heading — insert above the first long profile paragraph if there's no heading.
    if not _SUMMARY_HEAD_RE.search(text):
        lines = text.split("\n")
        insert_at = None
        for i, l in enumerate(lines):
            s = l.strip()
            if _SECTION_HEAD_RE.match(s):
                break
            # First substantial prose line before any section heading = the profile/summary.
            # ≥12 words catches concise real summaries while still skipping a short job-title
            # tagline; only lines above the first section can be reached, so this can't grab a
            # bullet. Contact lines (email / pipe-separated) are excluded.
            if len(s.split()) >= 12 and "@" not in s and "|" not in s:
                insert_at = i
                break
        if insert_at is not None:
            lines[insert_at:insert_at] = ["SUMMARY", ""]
            text = "\n".join(lines)
            changes.append("Added a 'SUMMARY' heading above your profile paragraph.")

    return text, changes


async def auto_fix_resume(call_llm_fn) -> dict:
    """Apply auto_fix_text to the master résumé, save it, and re-audit. Returns the new audit +
    what changed + how many bullets still need numbers (which only the user can supply)."""
    resume = await get_resume_template()
    if not (resume or "").strip():
        return {"ok": False, "error": "No master résumé saved yet."}
    new_text, changes = auto_fix_text(resume)
    if changes:
        await save_resume_template(new_text)
    audit = await audit_resume(call_llm_fn)
    q = audit.get("quantification", {}) if isinstance(audit, dict) else {}
    still_unquantified = max(0, (q.get("total_bullets", 0) or 0) - (q.get("bullets_with_metrics", 0) or 0))
    return {"ok": True, "changes": changes, "audit": audit,
            "unquantified_bullets": still_unquantified}


# ── Original / tailored .docx storage (base64 in Turso) ─────────────────────
import base64 as _b64


async def save_master_docx(filename: str, data: bytes):
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO resume_docx (id, filename, data_b64, updated_at) VALUES (1, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET filename=excluded.filename,
                 data_b64=excluded.data_b64, updated_at=excluded.updated_at""",
            (filename, _b64.b64encode(data).decode(), now))
        await db.commit()


async def get_master_docx():
    """Return (filename, bytes) or None."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT filename, data_b64 FROM resume_docx WHERE id = 1")
        row = await cur.fetchone()
    if not row or not row[1]:
        return None
    return row[0], _b64.b64decode(row[1])


async def has_master_docx() -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT 1 FROM resume_docx WHERE id = 1")
        return (await cur.fetchone()) is not None


async def save_tailored_docx(job_ref: str, filename: str, data: bytes):
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO tailored_docx (job_ref, filename, data_b64, created_at) VALUES (?, ?, ?, ?)
               ON CONFLICT(job_ref) DO UPDATE SET filename=excluded.filename,
                 data_b64=excluded.data_b64, created_at=excluded.created_at""",
            (str(job_ref), filename, _b64.b64encode(data).decode(), now))
        await db.commit()


async def get_tailored_docx(job_ref: str):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT filename, data_b64 FROM tailored_docx WHERE job_ref = ?", (str(job_ref),))
        row = await cur.fetchone()
    if not row or not row[1]:
        return None
    return row[0], _b64.b64decode(row[1])


JOB_PREP_PROMPT = (
    "You are a master career coach and technical recruiter. You are given the candidate's MASTER RESUME "
    "and a target JOB DESCRIPTION. Generate a tailored outreach and interview preparation kit in "
    "STRICT JSON format containing:\n"
    "1. 'outreach_linkedin': A highly personalized LinkedIn connection request message (strictly under 300 characters, short and punchy, referencing matching points between the candidate's background and the job).\n"
    "2. 'outreach_email': A cold outreach email message (subject line + body) to send to a hiring manager, highlighting the candidate's relevant skills and suggesting a brief chat.\n"
    "3. 'star_stories': An array of exactly 3 behavioral interview questions that are highly likely to be asked for this role, along with proposed answers. The answers MUST draw directly and truthfully from the candidate's actual experience in their master resume, structured clearly in the STAR framework: Situation, Task, Action, Result.\n"
    "Return a STRICT JSON object only with these exact keys: 'outreach_linkedin', 'outreach_email', and 'star_stories'. "
    "Under 'star_stories', each object must have: 'question', 'situation', 'task', 'action', 'result'. Output JSON only."
)


async def generate_job_prep(job: dict, call_llm_fn, domain: str = DEFAULT_DOMAIN) -> dict:
    """Generate customized outreach templates and STAR interview prep stories. Cached."""
    resume = await get_resume_template(domain)
    if not resume:
        return {"error": "No master resume saved yet. Upload your resume first."}
    jd = (job.get("description") or "").strip()
    if not jd:
        return {"error": "This job has no description text to prepare outreach/stories for."}

    job_ref = str(job.get("key") or job.get("job_ref") or job.get("id") or job.get("url") or job.get("title"))
    user = (f"MASTER RESUME:\n{resume}\n\n"
            f"TARGET JOB — {job.get('title','')} @ {job.get('company','')} ({job.get('location','')}):\n{jd[:4000]}")
    try:
        raw = await call_llm_fn(JOB_PREP_PROMPT, user, max_tokens=1800, temperature=0.3)
        prep = _parse_json_object(raw)
    except Exception as e:
        print(f"⚠️ [resume_ats] job prep generation failed: {e}")
        return {"error": "Job prep generation failed — try again in a moment."}

    now = datetime.now(timezone.utc).isoformat()
    outreach_linkedin = prep.get("outreach_linkedin", "")
    outreach_email = prep.get("outreach_email", "")
    star_stories = prep.get("star_stories", [])

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO job_prep_cache (job_ref, outreach_linkedin, outreach_email, star_stories, created_at)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(job_ref) DO UPDATE SET
                 outreach_linkedin=excluded.outreach_linkedin,
                 outreach_email=excluded.outreach_email,
                 star_stories=excluded.star_stories,
                 created_at=excluded.created_at""",
            (job_ref, outreach_linkedin, outreach_email, json.dumps(star_stories), now)
        )
        await db.commit()
    return {
        "job_ref": job_ref,
        "outreach_linkedin": outreach_linkedin,
        "outreach_email": outreach_email,
        "star_stories": star_stories,
        "created_at": now
    }


async def get_job_prep(job_ref: str) -> dict:
    """Return cached outreach and prep data for a job_ref, or None."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT outreach_linkedin, outreach_email, star_stories, created_at FROM job_prep_cache WHERE job_ref = ?",
            (str(job_ref),)
        )
        row = await cur.fetchone()
    if not row:
        return None
    try:
        stories = json.loads(row["star_stories"] or "[]")
    except Exception:
        stories = []
    return {
        "job_ref": job_ref,
        "outreach_linkedin": row["outreach_linkedin"] or "",
        "outreach_email": row["outreach_email"] or "",
        "star_stories": stories,
        "created_at": row["created_at"]
    }
