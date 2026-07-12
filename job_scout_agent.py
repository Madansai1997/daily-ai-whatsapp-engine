"""
Job Scout Agent — self-contained skill module (Phase 4).

Same pattern as the other agents (reminders.py, calendar_agent.py): own tables, own error
handling, own HTTP clients. V3_updates.py only imports the public functions below.

Pipeline (deterministic, free-tier friendly — no autonomous loop at runtime):
    profile -> fetch_all (Adzuna + Remotive) -> dedup(seen_jobs) -> prefilter(no LLM)
    -> rank_jobs(LLM 0-100) -> keep >= min_score -> persist -> WhatsApp digest

Sources were live-validated for "Data Analyst / India": Adzuna is primary (real India roles,
keyword search works); Remotive is a filtered secondary (remote-global, keep India/worldwide);
Himalayas was dropped (no usable server-side search). Add sources as new fetch_* adapters.
"""

import os
import re
import json
import asyncio
import httpx
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

ADZUNA_APP_ID = os.getenv("ADZUNA_APP_ID")
ADZUNA_APP_KEY = os.getenv("ADZUNA_APP_KEY")

# JSearch (RapidAPI) — ON-DEMAND ONLY. Aggregates LinkedIn/Indeed/Glassdoor via Google Jobs.
# Free tier = 200 req/month, so it's gated behind an explicit user request, never the cron.
# No-op until RAPIDAPI_KEY is set — on-demand then falls back to a live Adzuna fetch.
RAPIDAPI_KEY = os.getenv("RAPIDAPI_KEY", "").strip()
JSEARCH_HOST = "jsearch.p.rapidapi.com"

# Extra free aggregators — each aggregates many boards (incl. Indeed/Dice/LinkedIn). No-op until
# its key is set, so the pipeline degrades gracefully. Jooble: free key by email. Careerjet: free
# affiliate id (affid). Both cover India.
JOOBLE_API_KEY = os.getenv("JOOBLE_API_KEY", "").strip()
CAREERJET_AFFID = os.getenv("CAREERJET_AFFID", "").strip()

HTTP_TIMEOUT = 25.0
UA = {"User-Agent": "Mozilla/5.0 (JARVIS JobScout)"}

# Default profile — overridden by whatever is saved in job_profile.
DEFAULT_PROFILE = {
    "role": "data analyst",
    "country": "in",                       # Adzuna country code
    "keywords": ["data analyst", "analyst"],
    "locations": ["india", "remote", "anywhere", "worldwide"],
    "remote_ok": True,
    "salary_min": None,
    "must_have": [],
    "exclude": ["senior", "lead", "principal", "head", "intern", "junior"],  # mid-level
}

RANKING_SYSTEM_PROMPT = (
    "You score job postings for a candidate. You are given the candidate PROFILE and a numbered "
    "list of JOBS. For EACH job return an object in a STRICT JSON array — no markdown, no prose:\n"
    '[{"id": "<the job id given>", "score": 0-100, "why": "<one short line>", '
    '"flags": ["visa","salary_below","seniority_mismatch","location_mismatch"]}]\n'
    "Score on: title/skill match, seniority fit (candidate is MID-LEVEL — penalize senior/lead/"
    "intern roles), location/remote fit, salary vs floor, and freshness. Be harsh: 80+ means "
    "'apply today'. Only include flags that actually apply. Never invent details not in the "
    "posting. Return one array element per job, ids matching exactly. Keep 'why' under 10 words "
    "and never use double-quote characters inside it. JSON array only, no trailing text."
)


# =========================================================================
# TABLES
# =========================================================================
def init_job_scout_tables():
    """Synchronous, mirrors init_db_tables() in V3_updates.py — called once at import/startup."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS job_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        data TEXT,
        updated_at TEXT
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS seen_jobs (
        job_key TEXT PRIMARY KEY,
        first_seen TEXT
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS matched_jobs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_key TEXT UNIQUE,
        title TEXT, company TEXT, location TEXT, url TEXT, source TEXT, publisher TEXT,
        remote INTEGER, salary TEXT, posted_at TEXT,
        score INTEGER, why TEXT, flags TEXT,
        status TEXT DEFAULT 'new',
        created_at TEXT
    )''')
    try:  # migrate older DBs that predate the publisher (real-board) column
        cur.execute("ALTER TABLE matched_jobs ADD COLUMN publisher TEXT")
    except Exception:
        pass
    # Display state (NOT the dedup ledger): the exact list last shown to the user, so a
    # "TRACK <n>" reply can resolve index n back to a job — works for both the daily digest
    # and read-only on-demand results. Overwritten each time a digest/search is shown.
    cur.execute('''CREATE TABLE IF NOT EXISTS job_scout_last_shown (
        idx INTEGER PRIMARY KEY,
        job TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Job Scout tables ready.")


async def record_last_shown(jobs: list):
    """Persist the exact list just shown (1-indexed) so TRACK <n> can resolve it later.
    Display state only — never the seen/matched ledger."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM job_scout_last_shown")
        for i, j in enumerate(jobs, 1):
            await db.execute("INSERT INTO job_scout_last_shown (idx, job) VALUES (?, ?)",
                             (i, json.dumps(j)))
        await db.commit()


async def get_last_shown(n: int) -> dict:
    """Return the nth (1-indexed) job from the last digest/search, or None."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT job FROM job_scout_last_shown WHERE idx = ?", (n,))
        row = await cur.fetchone()
    return json.loads(row["job"]) if row else None


# =========================================================================
# PROFILE
# =========================================================================
async def get_profile() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT data FROM job_profile WHERE id = 1")
        row = await cur.fetchone()
    if row and row["data"]:
        try:
            p = dict(DEFAULT_PROFILE)
            p.update(json.loads(row["data"]))
            return p
        except Exception:
            pass
    return dict(DEFAULT_PROFILE)


async def save_profile(profile: dict):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO job_profile (id, data, updated_at) VALUES (1, ?, ?)
               ON CONFLICT(id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at""",
            (json.dumps(profile), datetime.now(timezone.utc).isoformat()),
        )
        await db.commit()


# =========================================================================
# NORMALIZATION + SOURCE ADAPTERS
# =========================================================================
def _norm(external_id, title, company, location, remote, salary, url, source, posted_at, desc, publisher=None):
    return {
        "key": f"{source}:{external_id}",
        "title": (title or "").strip(),
        "company": (company or "").strip(),
        "location": (location or "").strip(),
        "remote": bool(remote),
        "salary": salary,
        "url": url,
        "source": source,
        # Human-facing board this posting actually came from (Indeed / Dice / LinkedIn / …). For
        # aggregators that expose the origin (JSearch, Jooble) it's that; otherwise the aggregator name.
        "publisher": (publisher or (source or "").title()).strip() or (source or "").title(),
        "posted_at": posted_at,
        # Kept long enough for the ATS resume analysis (full JD); ranking only reads a slice.
        "description": (desc or "")[:2500],
    }


def _looks_remote(*texts) -> bool:
    blob = " ".join(t for t in texts if t).lower()
    return any(k in blob for k in ("remote", "work from home", "wfh", "anywhere"))


async def fetch_adzuna(profile: dict, limit: int = 30) -> list:
    """Primary source. Real India coverage; keyword search works. Adzuna doesn't reliably flag
    remote, so we infer it from the title/description."""
    if not (ADZUNA_APP_ID and ADZUNA_APP_KEY):
        print("⚠️ [job_scout] Adzuna keys missing — skipping.")
        return []
    country = profile.get("country", "in")
    params = {
        "app_id": ADZUNA_APP_ID, "app_key": ADZUNA_APP_KEY,
        "results_per_page": limit, "what": profile.get("role", "data analyst"),
        "content-type": "application/json", "sort_by": "date", "max_days_old": 30,
    }
    url = f"https://api.adzuna.com/v1/api/jobs/{country}/search/1"
    data = None
    for attempt in range(2):  # Adzuna occasionally 503s; one quick retry clears it.
        try:
            async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers=UA) as c:
                r = await c.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            break
        except Exception as e:
            if attempt == 0:
                await asyncio.sleep(1.5)
                continue
            print(f"⚠️ [job_scout] Adzuna fetch failed: {e}")
            return []
    out = []
    for j in data.get("results", []):
        title, desc = j.get("title"), j.get("description")
        salary = None
        if j.get("salary_min"):
            salary = f"{int(j['salary_min'])}-{int(j.get('salary_max', j['salary_min']))}"
        out.append(_norm(
            j.get("id"), title, (j.get("company") or {}).get("display_name"),
            (j.get("location") or {}).get("display_name"), _looks_remote(title, desc),
            salary, j.get("redirect_url"), "adzuna", j.get("created"), desc,
        ))
    return out


async def fetch_remotive(profile: dict, limit: int = 50) -> list:
    """Secondary source (remote-global). Its search is loose, so we filter client-side by
    keyword AND keep only roles a candidate in the profile's region could take (India /
    Worldwide / Anywhere)."""
    ok_locs = [l.lower() for l in profile.get("locations", [])] + ["worldwide", "anywhere"]
    keywords = [k.lower() for k in profile.get("keywords", [profile.get("role", "")])]
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers=UA) as c:
            r = await c.get("https://remotive.com/api/remote-jobs",
                            params={"search": profile.get("role", ""), "limit": limit})
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"⚠️ [job_scout] Remotive fetch failed: {e}")
        return []
    out = []
    for j in data.get("jobs", []):
        title = (j.get("title") or "").lower()
        loc = (j.get("candidate_required_location") or "").lower()
        if not any(k in title for k in keywords):
            continue
        if loc and not any(l in loc for l in ok_locs):
            continue  # geo-locked away from the candidate's region
        out.append(_norm(
            j.get("id"), j.get("title"), j.get("company_name"),
            j.get("candidate_required_location") or "Remote", True, j.get("salary") or None,
            j.get("url"), "remotive", j.get("publication_date"), j.get("description"),
        ))
    return out


async def fetch_jsearch(profile: dict, limit: int = 10) -> list:
    """ON-DEMAND source (RapidAPI JSearch → Google Jobs → LinkedIn/Indeed/etc). Freshest, broadest.
    Returns [] if no key so the caller can fall back to a live Adzuna fetch."""
    if not RAPIDAPI_KEY:
        return []
    role = profile.get("role", "data analyst")
    loc = profile.get("query_location") or (profile.get("locations") or ["India"])[0]
    country = profile.get("country", "in")
    query = f"{role} in {loc}"
    # JSearch v5: endpoint is /search-v2, with a dedicated `country` (ISO code) param.
    params = {"query": query, "num_pages": "1", "country": country, "date_posted": "week"}
    headers = {"x-rapidapi-key": RAPIDAPI_KEY, "x-rapidapi-host": JSEARCH_HOST}
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT) as c:
            r = await c.get(f"https://{JSEARCH_HOST}/search-v2", params=params, headers=headers)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"⚠️ [job_scout] JSearch fetch failed: {e}")
        return []
    out = []
    jobs_list = (data.get("data") or {}).get("jobs") or []  # v5: data.data.jobs (+ cursor)
    for j in jobs_list[:limit]:
        loc_str = ", ".join(x for x in [j.get("job_city"), j.get("job_country")] if x) or "—"
        salary = None
        if j.get("job_min_salary"):
            salary = f"{int(j['job_min_salary'])}-{int(j.get('job_max_salary') or j['job_min_salary'])}"
        out.append(_norm(
            j.get("job_id"), j.get("job_title"), j.get("employer_name"), loc_str,
            j.get("job_is_remote"), salary,
            j.get("job_apply_link") or j.get("job_google_link"), "jsearch",
            j.get("job_posted_at_datetime_utc"), j.get("job_description"),
            publisher=j.get("job_publisher"),  # the real board: Indeed / LinkedIn / Dice / …
        ))
    return out


async def fetch_jooble(profile: dict, limit: int = 30) -> list:
    """Free aggregator (key by email). Aggregates many boards incl. Indeed/LinkedIn; its per-job
    `source` is the origin board, so publisher shows the real site. No-op without a key."""
    if not JOOBLE_API_KEY:
        return []
    role = profile.get("role", "data analyst")
    loc = profile.get("query_location") or (profile.get("locations") or ["India"])[0]
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers=UA) as c:
            r = await c.post(f"https://jooble.org/api/{JOOBLE_API_KEY}",
                             json={"keywords": role, "location": loc})
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"⚠️ [job_scout] Jooble fetch failed: {e}")
        return []
    out = []
    for j in (data.get("jobs") or [])[:limit]:
        desc = re.sub(r"<[^>]+>", " ", j.get("snippet") or "")
        out.append(_norm(
            j.get("id") or j.get("link"), j.get("title"), j.get("company"),
            j.get("location"), _looks_remote(j.get("title"), desc, j.get("location")),
            j.get("salary") or None, j.get("link"), "jooble", j.get("updated"), desc,
            publisher=(j.get("source") or "Jooble"),
        ))
    return out


async def fetch_careerjet(profile: dict, limit: int = 30) -> list:
    """Free aggregator (affiliate id). Aggregates many boards; good India coverage. No-op without affid."""
    if not CAREERJET_AFFID:
        return []
    role = profile.get("role", "data analyst")
    loc = profile.get("query_location") or (profile.get("locations") or ["India"])[0]
    params = {
        "keywords": role, "location": loc, "affid": CAREERJET_AFFID,
        "user_ip": "8.8.8.8", "user_agent": UA["User-Agent"],
        "locale_code": profile.get("careerjet_locale", "en_IN"),
        "pagesize": limit, "sort": "date",
    }
    try:
        async with httpx.AsyncClient(timeout=HTTP_TIMEOUT, headers=UA) as c:
            r = await c.get("https://public.api.careerjet.net/search", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        print(f"⚠️ [job_scout] Careerjet fetch failed: {e}")
        return []
    out = []
    for j in (data.get("jobs") or [])[:limit]:
        desc = re.sub(r"<[^>]+>", " ", j.get("description") or "")
        out.append(_norm(
            j.get("url"), j.get("title"), j.get("company"), j.get("locations"),
            _looks_remote(j.get("title"), desc, j.get("locations")),
            j.get("salary") or None, j.get("url"), "careerjet", j.get("date"), desc,
            publisher="Careerjet",
        ))
    return out


# Daily-cron sources. JSearch is now included (≈1 call/day, well under its 200/mo free cap) so the
# digest also pulls Indeed/LinkedIn/Dice via Google Jobs. Jooble/Careerjet no-op until keyed.
SOURCES = [fetch_adzuna, fetch_remotive, fetch_jsearch, fetch_jooble, fetch_careerjet]


# =========================================================================
# FETCH + DEDUP + PREFILTER
# =========================================================================
async def _already_seen(keys: list) -> set:
    if not keys:
        return set()
    async with aiosqlite.connect(DB_PATH) as db:
        qmarks = ",".join("?" * len(keys))
        cur = await db.execute(f"SELECT job_key FROM seen_jobs WHERE job_key IN ({qmarks})", keys)
        return {row[0] for row in await cur.fetchall()}


async def fetch_all(profile: dict) -> list:
    """Fan out across sources, merge, drop anything already in seen_jobs."""
    jobs = []
    for src in SOURCES:
        try:
            jobs.extend(await src(profile))
        except Exception as e:
            print(f"⚠️ [job_scout] source {src.__name__} failed: {e}")
    # de-dup within this batch by key
    unique = {j["key"]: j for j in jobs}
    seen = await _already_seen(list(unique.keys()))
    fresh = [j for k, j in unique.items() if k not in seen]
    print(f"ℹ️ [job_scout] fetched {len(jobs)} raw, {len(unique)} unique, {len(fresh)} new (unseen).")
    return fresh


def prefilter(jobs: list, profile: dict) -> list:
    """Cheap, no-LLM cut before spending tokens: keyword match, exclusion terms, remote pref."""
    keywords = [k.lower() for k in profile.get("keywords", [])]
    exclude = [x.lower() for x in profile.get("exclude", [])]
    kept = []
    for j in jobs:
        blob = f"{j['title']} {j['description']}".lower()
        if keywords and not any(k in blob for k in keywords):
            continue
        if any(x in j["title"].lower() for x in exclude):
            continue
        kept.append(j)
    return kept


# =========================================================================
# RANK (LLM)
# =========================================================================
def _profile_line(profile: dict) -> str:
    return (f"Role: {profile.get('role')} | Level: mid | "
            f"Locations OK: {', '.join(profile.get('locations', []))} | "
            f"Remote OK: {profile.get('remote_ok')} | "
            f"Salary floor: {profile.get('salary_min') or 'n/a'} | "
            f"Must-have: {', '.join(profile.get('must_have', [])) or 'none'}")


def _parse_scores(raw: str) -> list:
    """Bulletproof extraction of the score objects from an LLM response. Handles code fences,
    surrounding prose, trailing junk (raw_decode), and a single malformed object (per-object
    salvage) — so one bad character can't wipe a whole batch."""
    raw = (raw or "").strip()
    anchor = raw.find("[")
    if anchor == -1:
        anchor = raw.find("{")
    if anchor == -1:
        return []
    # 1) Try to decode the first complete JSON value, ignoring anything after it.
    try:
        obj, _ = json.JSONDecoder().raw_decode(raw[anchor:])
        if isinstance(obj, list):
            return obj
        if isinstance(obj, dict):
            for v in obj.values():
                if isinstance(v, list):
                    return v
            return [obj]
    except Exception:
        pass
    # 2) Salvage: pull out each individual {...} object that does parse.
    out = []
    for m in re.finditer(r"\{[^{}]*\}", raw):
        try:
            out.append(json.loads(m.group(0)))
        except Exception:
            continue
    return out


async def rank_jobs(jobs: list, profile: dict, call_llm_fn, batch_size: int = 6) -> list:
    """Score each job 0-100 via the LLM (batched). Returns jobs with score/why/flags added.
    A failed batch is skipped, not fatal."""
    ranked = []
    prof = _profile_line(profile)
    for i in range(0, len(jobs), batch_size):
        batch = jobs[i:i + batch_size]
        listing = "\n".join(
            f'id={j["key"]} | {j["title"]} @ {j["company"]} | loc={j["location"]} '
            f'| remote={j["remote"]} | salary={j["salary"]} | {j["description"][:180]}'
            for j in batch
        )
        user = f"PROFILE: {prof}\n\nJOBS:\n{listing}"
        try:
            raw = await call_llm_fn(RANKING_SYSTEM_PROMPT, user, max_tokens=900)
            parsed = _parse_scores(raw)
            scores = {str(s["id"]): s for s in parsed if isinstance(s, dict) and "id" in s}
            if not scores:
                print(f"⚠️ [job_scout] ranking batch {i // batch_size} yielded no parseable scores.")
        except Exception as e:
            print(f"⚠️ [job_scout] ranking batch {i // batch_size} failed: {e}")
            continue
        for j in batch:
            s = scores.get(j["key"])
            if not s:
                continue
            j = dict(j)
            j["score"] = int(s.get("score", 0))
            j["why"] = s.get("why", "")
            j["flags"] = s.get("flags", [])
            ranked.append(j)
    ranked.sort(key=lambda x: x["score"], reverse=True)
    return ranked


# =========================================================================
# PERSIST + DIGEST
# =========================================================================
async def persist_matches(scored: list):
    """Mark every scored job as seen (so it never re-notifies) and store the matches."""
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        for j in scored:
            await db.execute("INSERT OR IGNORE INTO seen_jobs (job_key, first_seen) VALUES (?, ?)",
                             (j["key"], now))
            await db.execute(
                """INSERT OR IGNORE INTO matched_jobs
                   (job_key, title, company, location, url, source, publisher, remote, salary, posted_at,
                    score, why, flags, status, created_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?, 'new', ?)""",
                (j["key"], j["title"], j["company"], j["location"], j["url"], j["source"],
                 j.get("publisher") or (j.get("source") or "").title(),
                 int(j["remote"]), j.get("salary"), j.get("posted_at"),
                 j.get("score", 0), j.get("why", ""), json.dumps(j.get("flags", [])), now),
            )
        await db.commit()


def format_digest(matches: list, top_n: int = 5, header: str = None, on_demand: bool = False) -> str:
    if not matches:
        return "📭 *Job Scout:* no matches right now."
    lines = [header or "🎯 *Job Scout — top matches today:*", ""]
    for i, j in enumerate(matches[:top_n], 1):
        tag = "🌐 remote" if j["remote"] else "📍 " + (j["location"] or "—")
        seen = "  🔖 already flagged" if (on_demand and j.get("seen")) else ""
        lines.append(f"{i}. *{j['title']}* — {j['company']}  ({j.get('score', 0)}/100, {tag}){seen}")
        if j.get("why"):
            lines.append(f"   _{j['why']}_")
        lines.append(f"   {j['url']}")
    lines.append("\nReply *TRACK <n>* to add one to your application tracker.")
    return "\n".join(lines)


async def _annotate_seen(jobs: list) -> list:
    """Read-only: tag each job with whether it's already in seen_jobs. Does NOT write."""
    seen = await _already_seen([j["key"] for j in jobs])
    for j in jobs:
        j["seen"] = j["key"] in seen
    return jobs


async def run_on_demand_search(call_llm_fn, override: dict = None, top_n: int = 5) -> str:
    """On-demand path ("JARVIS, find me jobs"). Per the behavioral contract:
      - source = JSearch if configured, else a live Adzuna fetch;
      - profile = a COPY with the ad-hoc override merged in (never mutates job_profile);
      - BYPASSES dedup (shows everything), but tags already-seen roles;
      - READ-ONLY on the ledger (persists nothing);
      - one batched ranking call, returns the top N.
    """
    profile = dict(await get_profile())
    if override:
        profile.update({k: v for k, v in override.items() if v is not None})

    if RAPIDAPI_KEY:
        jobs = await fetch_jsearch(profile, limit=10)
        src = "JSearch · live"
    else:
        jobs = await fetch_adzuna(profile, limit=12)
        src = "Adzuna · live"
    if not jobs:
        return "🔎 No live results right now — try a broader role or location."

    candidates = prefilter(jobs, profile) or jobs[:10]
    await _annotate_seen(candidates)                      # read-only tag
    scored = await rank_jobs(candidates, profile, call_llm_fn, batch_size=10)  # single call
    scored = scored or candidates                         # if ranking fully failed, still show something
    await record_last_shown(scored[:top_n])               # display state only (TRACK <n>), not the ledger
    return format_digest(scored, top_n=top_n, header=f"🎯 *Live job search — {src}:*", on_demand=True)


async def search_now_to_board(call_llm_fn, override: dict = None, track_fn=None, top_n: int = 8) -> dict:
    """Console 'Find jobs now': same live pipeline as run_on_demand_search, but PERSISTS the top
    matches into the NEW lane (reviewed=0, via track_fn) so on-demand search feeds the same funnel
    as the daily digest. add_application is idempotent on job_key, so jobs already on the board are
    skipped. Returns {found, added}."""
    profile = dict(await get_profile())
    if override:
        profile.update({k: v for k, v in override.items() if v is not None})
    jobs = await fetch_jsearch(profile, limit=15) if RAPIDAPI_KEY else await fetch_adzuna(profile, limit=15)
    if not jobs:
        return {"found": 0, "added": 0}
    candidates = prefilter(jobs, profile) or jobs[:top_n]
    scored = await rank_jobs(candidates, profile, call_llm_fn, batch_size=10) or candidates
    top = scored[:top_n]
    added = 0
    if track_fn:
        for j in top:
            try:
                ok, _ = await track_fn(j, "interested")
                added += 1 if ok else 0
            except Exception as e:
                print(f"⚠️ [job_scout] search-now track failed for {j.get('key')}: {e}")
    await record_last_shown(top)
    return {"found": len(jobs), "added": added}


async def run_job_scout_digest(call_llm_fn, notify_fn=None, track_fn=None, min_score: int = 70,
                               top_n: int = 10, profile: dict = None, apply_hook=None) -> str:
    """Cron entrypoint: fetch -> dedup -> prefilter -> rank -> persist -> digest.
    If notify_fn is given, sends the digest. If track_fn is given, EVERY shown match is
    auto-added to the application tracker as 'interested' (deduped by job key) — this is
    the automatic digest, so the board gets stocked without a manual TRACK reply."""
    profile = profile or await get_profile()
    fresh = await fetch_all(profile)
    candidates = prefilter(fresh, profile)
    print(f"ℹ️ [job_scout] {len(candidates)} candidates after prefilter.")
    if not candidates:
        digest = "📭 *Job Scout:* no new matches today."
        if notify_fn:
            notify_fn(digest)
        return digest
    scored = await rank_jobs(candidates, profile, call_llm_fn)
    strong = [j for j in scored if j.get("score", 0) >= min_score]
    await persist_matches(scored)  # mark ALL seen so weak ones don't re-appear
    shown = strong[:top_n]
    await record_last_shown(shown)  # so TRACK <n> can still resolve these
    digest = format_digest(strong, top_n=top_n)

    # Auto-add every shown match to the Kanban (deduped). Only for the digest — the
    # on-demand "search now" path stays look-only and uses TRACK on the user's say-so.
    if track_fn and shown:
        added = 0
        for j in shown:
            try:
                ok, _ = await track_fn(j, "interested")
                added += 1 if ok else 0
            except Exception as e:
                print(f"⚠️ [job_scout] auto-track failed for {j.get('key')}: {e}")
        header = (f"🎯 *Added {added} new match{'es' if added != 1 else ''} to your Jobs board* "
                  f"— review & remove in Jobs.\n\n") if added else \
                 "🎯 *Job Scout* — these are already on your Jobs board.\n\n"
        digest = header + digest

    if notify_fn:
        notify_fn(digest)

    # Apply-prep runs on the strong shown matches (own thresholds/cap/notifications inside).
    # Isolated so a failure here never breaks the digest that already went out.
    if apply_hook and shown:
        try:
            await apply_hook(shown)
        except Exception as e:
            print(f"⚠️ [job_scout] apply_hook failed: {e}")
    return digest
