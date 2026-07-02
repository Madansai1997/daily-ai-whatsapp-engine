# Job Scout Agent — Build Spec

Phase 4 agent for the JARVIS engine. Finds relevant job postings from free APIs, ranks them
against a saved profile with an LLM, and sends a daily WhatsApp digest. Built as a
self-contained module (`job_scout_agent.py`) following the `add-agent-module` skill.

Facts verified July 2026 — re-check API limits before relying on them.

---

## 1. Tools (verified)

### A. Job data sources — free, NO scraping
**Rule: use official APIs, never scrape LinkedIn/Indeed** (ToS + IP bans + infra we don't have
on free Render).

| Source | Auth | Coverage | Endpoint | Limits / gotchas |
|---|---|---|---|---|
| **Adzuna** ⭐ | `app_id`+`app_key` (free) | 12 countries incl. India, all industries | `https://api.adzuna.com/v1/api/jobs/{country}/search/{page}?app_id=..&app_key=..` | Best all-round. Free quota not published — register at developer.adzuna.com, check dashboard. |
| **Remotive** ⭐ | None | Remote, tech-heavy | `https://remotive.com/api/remote-jobs?search=..&category=..&limit=..` | **Hard rules: max 4 calls/day, blocked if >2/min, data delayed 24h.** Daily cron only. |
| **Himalayas** | None | Remote, global | Public JSON — filters: keyword, country, seniority, employment type, timezone | Rich filters, no auth. |
| **Arbeitnow** | None | Germany/EU + remote, visa sponsors | Public JSON feed | Best for EU / visa-sponsor roles. |
| **RemoteOK** | None | Remote, startups/dev | JSON feed | Tech/indie focus. |
| **ATS boards** (Greenhouse / Lever / Ashby) | None | Per-company | Greenhouse: `api.greenhouse.io/v1/boards/{company}/jobs?content=true` · Lever: `api.lever.co/v0/postings/{company}?mode=json` (filters: team/location/level) · Ashby: public feed, `includeCompensation=true` | **Per-company watchlist.** Highest signal, freshest, salary data (Ashby). |

**Strategy:** aggregate **Adzuna + Remotive + Himalayas** for breadth + an **ATS watchlist** of
~20 target companies for depth.

### B. LLM tools — already in the stack
- **Groq `gpt-oss-120b`** — fast primary (conversational replies).
- **Gemini 2.5 Flash** (fallback wired into `_complete_with_fallback`) — **use for bulk job
  scoring**: cheap, generous free tier, ideal for scoring ~50 postings/run.

### C. Frameworks — only for the autonomous version (§3B)
- **Google ADK** — `LoopAgent` (`max_iterations` + early exit via `escalate=True`) and the
  **Generator↔Critic** pattern. Native Gemini, open-source. Home for the "loop until excellent
  + sub-agents" idea.

---

## 2. How to use them
- **Adapter per source:** each returns a normalized dict
  `{id, title, company, location, remote, salary, url, description, source, posted_at}`.
  One `fetch_all()` fans out, merges, dedups.
- **Dedup:** hash `source + external_id` (or URL) into `seen_jobs` → never re-notify.
- **ATS watchlist:** store target-company board slugs; loop them daily.
- **Respect limits:** Remotive daily only; cache; cap postings scored per run (~50).

---

## 3. Framework structure

### 3A. Production agent on Render — RECOMMENDED: deterministic pipeline, NOT an autonomous loop
On 512 MB sleeping free tier, a runtime multi-agent loop is too slow/expensive/memory-heavy.
Keep the live agent a clean pipeline; save the loop for §3B.

```
job_scout_agent.py
├── init_job_scout_tables()      # job_profile, seen_jobs, matched_jobs
├── sources/                      # one adapter fn per source → normalized dicts
│   ├── fetch_adzuna(profile)
│   ├── fetch_remotive(profile)
│   ├── fetch_himalayas(profile)
│   └── fetch_ats_watchlist(slugs)
├── fetch_all(profile)            # fan-out + merge + dedup(seen_jobs)
├── prefilter(jobs, profile)      # cheap keyword/location/exclusion cut (NO LLM) → ~50
├── rank_jobs(jobs, profile, call_llm)   # LLM scores 0-100 + one-line why (Gemini Flash)
├── persist_matches(scored)       # store, mark seen
└── run_job_scout_digest(call_llm, notify_fn)   # cron entrypoint
```

**Pipeline:** `profile → fetch_all → prefilter (no LLM) → LLM rank → keep score ≥ threshold →
persist → WhatsApp top-5 digest`.

**Wiring into the engine (per `add-agent-module` skill):**
- Tables: `job_profile` (role, keywords, locations, remote, salary_min, must_have, exclude),
  `seen_jobs`, `matched_jobs`.
- **Cron:** `POST /cron/job-scout` → `_run_bg(run_job_scout_digest(call_llm, send_whatsapp_chunked))`,
  fired **once daily** by cron-job.org (respects Remotive 4×/day + instance-hour budget).
- **Intent:** add `JOB_SEARCH` to `MEMORY_INTENT_PROMPT` for on-demand ("find me jobs").
- **Handoff:** "track #3" pushes a `matched_job` into the Application Tracker (sibling agent).
- **Profile setup:** short WhatsApp Q&A (or reuse `user_facts`) to fill `job_profile`.

### 3B. Optional "Deep Scout" — autonomous loop (offline / on-demand, ADK)
Run occasionally, not per-cron:
```
PlannerAgent → splits by source/role
  ├─ ScoutAgent × N (parallel sub-agents, one per source)   ← divide & conquer
  → RankerAgent (generator: scores + drafts digest)
  → CriticAgent (checks rubric: relevance, salary fit, freshness)
  → LoopAgent(max_iterations=3): Critic fails → feedback → Ranker redraft; else escalate=True → done
```
Powered by Gemini Flash. Keep SEPARATE from the Render pipeline; trigger manually for a deep dive.

---

## 4. Prompts

**Ranking prompt (core):**
> You score job postings for a candidate. Given PROFILE and a JOB, return STRICT JSON:
> `{"score":0-100,"why":"<one line>","flags":["visa","salary_below","seniority_mismatch"]}`.
> Score on: title/skill match, seniority fit, location/remote fit, salary vs floor, freshness.
> Be harsh — 80+ means "apply today." Never invent details not in the posting. JSON only.

Batch 5–10 jobs/call; run on Gemini Flash.

**Intent classifier addition (`MEMORY_INTENT_PROMPT`):**
> Use `JOB_SEARCH` when the user wants to find/check/see job openings (e.g. "find me remote ML
> jobs", "any new roles today"). Extract job.role/location/remote/keywords if stated; else use
> the saved profile.

**ADK Critic rubric (for §3B):**
> Review this digest vs the profile. Fail (`pass:false` + specific fixes) if: any listing <70,
> salaries unchecked vs floor, duplicates slipped through, or <5 strong matches when more were
> available. Else `pass:true`.

---

## 5. Maximizing output with current tools
- **Union of sources beats any single one** (Adzuna breadth + Remotive/Himalayas remote + ATS depth).
- **Gemini Flash for bulk scoring** = the payoff of the wired fallback; Groq stays for fast replies.
- **Daily cadence** respects Remotive limits AND instance-hour budget (one wake/day).
- **Pre-filter before the LLM** — cheap keyword/location cut; only pay tokens on ~50 finalists.
- **Research phase:** run §1 through Multi (GPT-5 + Opus + Gemini) with the critique-loop prompt;
  union the source lists.

---

## 6. Build order (start here)
1. **Get Adzuna keys** (developer.adzuna.com → `app_id` + `app_key` into `.env` + Render). No other source needs auth.
2. **Set `GEMINI_API_KEY`** (aistudio.google.com) — needed for cheap bulk ranking.
3. **Write the source adapters standalone** (`fetch_adzuna`, `fetch_remotive`, `fetch_himalayas`) and test them from a plain script against the live APIs — confirm real data returns and normalizes cleanly. NOTHING wired into the engine yet.
4. **Add the schema + dedup** (`job_profile`, `seen_jobs`, `matched_jobs`); test locally with `SAFE_MODE=1`.
5. **Add `rank_jobs`** (the ranking prompt on Gemini Flash); test scoring on real fetched jobs.
6. **Assemble `run_job_scout_digest`** (fetch → prefilter → rank → persist → digest) and test end-to-end with `SAFE_MODE=1` (no real WhatsApp send).
7. **Wire into the engine:** `/cron/job-scout`, `JOB_SEARCH` intent, profile setup Q&A.
8. **Deploy** (deploy-engine skill), add the daily cron-job.org job, verify one live digest.
9. **Later:** Application Tracker handoff, then optional §3B ADK Deep Scout.

Prerequisite before coding: steps 1–2 (the two API keys). Everything else follows from there.
