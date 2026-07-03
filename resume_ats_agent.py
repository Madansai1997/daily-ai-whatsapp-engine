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
    "You are an ATS (Applicant Tracking System) optimization engine for a MID-LEVEL DATA "
    "ANALYST. You are given the candidate's MASTER RESUME and a target JOB DESCRIPTION. "
    "Return a STRICT JSON object only — no markdown, no prose before or after — with EXACTLY "
    "this shape:\n"
    "{\n"
    '  "ats_score": <int 0-100: how well the CURRENT resume matches this JD on keywords+relevance>,\n'
    '  "keyword_matrix": {\n'
    '    "required": [<hard skills/tools/keywords the JD explicitly requires>],\n'
    '    "present":  [<of those required, the ones already in the resume>],\n'
    '    "missing":  [<of those required, the ones absent from the resume>]\n'
    "  },\n"
    '  "star_xyz_breakdown": [\n'
    '    {"section_name": "<company or project + which bullet>",\n'
    '     "current_text": "<the exact existing bullet copied from the resume>",\n'
    '     "optimized_text": "<the rewritten bullet>",\n'
    '     "issue": "<short: what was weak, e.g. no quantifiable result / missing tool keyword>"}\n'
    "  ]\n"
    "}\n\n"
    "REWRITING FRAMEWORKS:\n"
    "- EXPERIENCE bullets → Google XYZ: 'Accomplished [X], as measured by [Y], by doing [Z]'. "
    "If a bullet lacks a quantifiable [Y], INSERT a realistic data-analyst metric (query runtime "
    "reduction, dashboard adoption/usage, rows/records processed, data accuracy %, hours saved, "
    "report cycle-time cut). Weave in JD keywords the candidate genuinely used.\n"
    "- PROJECT blocks → STAR order (Situation, Task, Action, Result) and explicitly name the tech "
    "stack applied (SQL, Python, Power BI, Tableau, Snowflake, BigQuery).\n\n"
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
        created_at TEXT
    )''')
    # Standalone résumé health audit (NOT tied to any job) — single latest row.
    cur.execute('''CREATE TABLE IF NOT EXISTS resume_audit (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT,
        created_at TEXT
    )''')
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


async def analyze(job: dict, call_llm_fn, domain: str = DEFAULT_DOMAIN) -> dict:
    """Run the ATS analysis for one job against the master resume, cache it, and return the
    cache row (dict). `job` needs: job_key/id, title, company, location, description.
    Returns {"error": ...} if there's no resume or the JD is empty."""
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
        raw = await call_llm_fn(RESUME_ATS_PROMPT, user, max_tokens=2600)
        analysis = _parse_json_object(raw)
    except Exception as e:
        print(f"⚠️ [resume_ats] analysis failed: {e}")
        return {"error": "Analysis failed — try again in a moment."}

    txt = compile_txt(job, analysis)
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO ats_analysis_cache
               (job_ref, job_title, company, location, ats_score, keyword_matrix,
                star_xyz_breakdown, downloadable_txt_content, viewed, created_at)
               VALUES (?,?,?,?,?,?,?,?,0,?)
               ON CONFLICT(job_ref) DO UPDATE SET
                 job_title=excluded.job_title, company=excluded.company, location=excluded.location,
                 ats_score=excluded.ats_score, keyword_matrix=excluded.keyword_matrix,
                 star_xyz_breakdown=excluded.star_xyz_breakdown,
                 downloadable_txt_content=excluded.downloadable_txt_content, viewed=0,
                 created_at=excluded.created_at""",
            (job_ref, job.get("title"), job.get("company"), job.get("location"),
             int(analysis.get("ats_score", 0)), json.dumps(analysis.get("keyword_matrix", {})),
             json.dumps(analysis.get("star_xyz_breakdown", [])), txt, now))
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
    return a


async def mark_viewed(job_ref: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE ats_analysis_cache SET viewed = 1 WHERE job_ref = ?", (str(job_ref),))
        await db.commit()


async def count_unviewed() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute("SELECT COUNT(*) FROM ats_analysis_cache WHERE viewed = 0")
        return (await cur.fetchone())[0]


# ============================================================================
# STANDALONE RÉSUMÉ AUDIT — a general, job-agnostic health check. No JD.
# Acts like a senior recruiter + ATS specialist reviewing the résumé cold.
# ============================================================================
RESUME_AUDIT_PROMPT = (
    "You are a SENIOR TECHNICAL RECRUITER and ATS (Applicant Tracking System) specialist with 15 "
    "years hiring data/analytics talent. A candidate who has gotten ZERO interview calls in ~6 "
    "months hands you their résumé with no job description. Audit it COLD and BRUTALLY HONESTLY — "
    "your job is to explain why it isn't landing interviews and exactly how to fix it. Do not be "
    "polite-vague; be specific and actionable. Judge it the way a real ATS parses it AND the way a "
    "human recruiter skims it in 7 seconds.\n\n"
    "Return STRICT JSON only — no markdown, no prose outside the JSON — with EXACTLY this shape:\n"
    "{\n"
    '  "overall_score": <int 0-100: overall résumé strength>,\n'
    '  "ats_parse_score": <int 0-100: how cleanly an ATS parses/reads it>,\n'
    '  "verdict": "<2-3 sentence blunt honest summary of why it is or isn\'t getting calls>",\n'
    '  "sections": [ {"name":"Contact info|Summary|Skills|Experience|Education|Projects|Certifications",\n'
    '                 "status":"present|missing|weak", "note":"<short specific note>"} ],\n'
    '  "issues": [ {"severity":"high|medium|low",\n'
    '               "category":"Formatting|Content|Keywords|Impact|Grammar|Length|Contact",\n'
    '               "problem":"<what is wrong, specific>", "fix":"<exactly what to do about it>"} ],\n'
    '  "missing": [ "<things entirely absent that recruiters/ATS expect>" ],\n'
    '  "grammar": [ {"original":"<exact phrase from résumé>", "suggestion":"<corrected>",\n'
    '                "type":"spelling|grammar|tense|passive-voice|wording"} ],\n'
    '  "quantification": {"total_bullets":<int>, "bullets_with_metrics":<int>,\n'
    '                     "note":"<how well achievements are quantified and what to add>"},\n'
    '  "keywords_to_add": [ "<industry/role keywords likely expected that appear ABSENT — honest, '
    'do not tell them to lie>" ],\n'
    '  "top_priorities": [ "<the 3-6 highest-leverage changes, ordered, that will most increase '
    'interview callbacks>" ]\n'
    "}\n\n"
    "RULES:\n"
    "- Infer the target role from the résumé itself (e.g. Data Analyst). No job description is given.\n"
    "- Quote REAL phrases from the résumé in 'grammar.original' and be precise — do not invent text.\n"
    "- 'keywords_to_add' = skills the role generally expects that are missing; NEVER advise fabricating "
    "experience — frame as 'add if you genuinely have it / learn it'.\n"
    "- Cover ATS-parse killers (tables, columns, graphics, headers/footers, non-standard section titles, "
    "date-format inconsistency, missing standard sections), impact/quantification, weak verbs, passive "
    "voice, tense consistency, length, and contact completeness (email/phone/LinkedIn).\n"
    "- 'issues' must be concrete and each have a real 'fix'. Prioritize by actual callback impact.\n"
    "Output JSON only."
)


async def audit_resume(call_llm_fn) -> dict:
    """Run a general (job-agnostic) ATS/recruiter audit on the saved master résumé,
    cache the single latest result, and return it. {"error": ...} if no résumé."""
    resume = await get_resume_template()
    if not (resume or "").strip():
        return {"error": "No master résumé saved yet. Upload or paste your résumé first."}
    try:
        raw = await call_llm_fn(RESUME_AUDIT_PROMPT, f"RÉSUMÉ:\n{resume[:8000]}", max_tokens=3000)
        audit = _parse_json_object(raw)
    except Exception as e:
        print(f"⚠️ [resume_ats] audit failed: {e}")
        return {"error": "Audit failed — try again in a moment."}
    if not audit or "overall_score" not in audit:
        return {"error": "Audit couldn't be parsed — try again."}

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
