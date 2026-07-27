# AGENTS.md — shared memory for AI assistants

> **Auto-generated — do not edit by hand.** This file is the shared brain for **Claude Code** and **Antigravity** working in this repo. Antigravity reads it natively; Claude Code reads it via `CLAUDE.md`'s `@AGENTS.md` import.
>
> To remember something for *both* assistants, add it to the store (it regenerates this file):
> ```bash
> python3 shared_memory.py add --key <slug> --category <user|feedback|project|reference|decision> --source <claude-code|antigravity|user> "the fact"
> ```
> List / remove: `python3 shared_memory.py list` · `python3 shared_memory.py rm <key>`

_20 shared memories · last rendered 2026-07-27 05:40 UTC_

## Feedback — how to work

### feedback_safe_mode_for_local_tests _(via claude-code)_
Always launch local test runs of the engine with SAFE_MODE=1 to avoid real Twilio sends

When testing V3_updates.py locally, launch with `SAFE_MODE=1` (e.g. `SAFE_MODE=1 PORT=80xx uvicorn V3_updates:app`). Added 2026-06-29.

**Why:** Twilio creds load from .env regardless of DB backend, so any non-SAFE local test that reaches send_whatsapp_chunked sends a REAL WhatsApp to Madan's phone. During this session several test triggers (/cron/health-check, /cron/checkin, /cron/weekly) sent real messages and buzzed him. Also note: `import db_compat` runs at line ~4 BEFORE `load_dotenv()` at line ~26, so on local launches TURSO_DATABASE_URL isn't in the env yet → the app uses the LOCAL agent_memory.db, NOT prod Turso (prod was never polluted). Prod (Render) sets TURSO in the dashboard, so it does use Turso.

**How to apply:** SAFE_MODE (added this session) pops TURSO env → forces throwaway /tmp/jarvis_safe_mode.db, and short-circuits send_whatsapp_chunked to a logged no-op. Set it on every local/dev launch. Leave it UNSET in production (Render). The startup self-check line `🩺 Self-check: ... safe_mode=ON/off` confirms which mode is active. See [[feedback_local_test_before_render]] and [[project_external_scheduler_mode]].

**CRITICAL nuance (learned 2026-07-02, polluted then cleaned real Turso):** SAFE_MODE's TURSO-popping only happens inside `V3_updates.py`'s startup (its early lines). A standalone test that imports a module DIRECTLY (e.g. `import job_scout_agent`, which imports `db_compat`) does NOT run that code, so `SAFE_MODE=1` env alone does NOTHING. Worse, `db_compat.connect(db_path_ignored=None)` IGNORES the DB_PATH argument whenever `TURSO_DATABASE_URL` is in the env — so if the test does `load_dotenv()` (which loads TURSO creds), every read/write hits the REAL prod Turso DB, even with DB_PATH set and SAFE_MODE=1. This happened while testing job_scout_agent — 18+18+1 test rows landed in prod Turso; dropped the tables to clean up. **Correct pattern for standalone module tests:** use `dotenv_values(".env")` (not load_dotenv), copy ONLY the non-Turso keys (GROQ/GEMINI/ADZUNA/etc) into os.environ, `os.environ.pop("TURSO_DATABASE_URL"/"TURSO_AUTH_TOKEN")`, set DB_PATH to a local file, THEN import the module. Assert `db_compat.USE_TURSO is False` before running.

### feedback-no-commit-without-explicit-go _(via claude-code)_
"Never run git commit (or any Render-related action) until the user explicitly says \"commit to render\""

Do not run `git commit` OR `git push` — not even a local-only commit — unless the user explicitly says so in that same message (e.g. "commit", "push", "push it to render", "yeah push"). Testing/verifying code changes locally (running scripts, hitting a local server, checking DB state, `npm run build`) is always fine without asking; committing and pushing are not.

**Why:** User stated this emphatically and repeated it. Reaffirmed 2026-07-02 after I had drifted into auto-committing AND auto-pushing several consecutive turns without being asked — they called it out directly ("you are just pushing to render without asking me nowadays"). A one-time "push it" is NOT standing permission for future turns; each commit/push needs its own explicit go-ahead. They distinguish "test locally" from "commit/push" as separate gated steps. Related: [[feedback_local_test_before_render]].

**How to apply:** After making + verifying code changes, STOP and report results, then explicitly offer to push and wait. Only run `git add`/`git commit`/`git push` when the current message contains an explicit go-ahead. Do not carry a prior turn's "push" forward to the next change. If unsure whether a message counts as the go-ahead, ask rather than assume.

### feedback-local-test-before-render _(via claude-code)_
Always test new agent code locally before deploying to Render

Test every new feature/agent module locally first. Only push to Render once the local test confirms it works.

**Why:** User explicitly stated this as a standing workflow rule while building the Email Triage Agent (Phase 1) — they want a local-pass gate before anything reaches the deployed Render service, not a deploy-and-debug-in-prod approach.

**How to apply:** For each new agent module (see [[project_phased_agent_roadmap]]), walk through local setup (env vars in `.env`, run the relevant script/function directly or via a local server), verify the behavior works as expected, and only then help commit/push and set the same env vars in Render. Don't suggest skipping straight to deployment.

### feedback_jarvis_movie_quality_bar _(via claude-code)_
"Standing quality bar for all JARVIS-persona output across the project — aim for movie-JARVIS, not a generic templated bot"

All user-facing JARVIS responses across this project (WhatsApp replies, web chat UI, daily briefings, notifications, any future module) should aim for movie-JARVIS quality — composed, witty, conversational, in-character — not flat, templated, or "basic" output.

**Why:** User explicitly said (2026-06-22, after seeing the weather feature go from a flat bullet-list template to an LLM-phrased JARVIS-voice briefing): "whatever you are doing for me on all of these projects, you should feel like a real-life movie-like Jarvis thing... don't say it in a basic con thing... make it to that level where real Jarvis, the movie Jarvis, looks like." This is a standing direction for the whole project's persona, not a one-off request about weather.

**How to apply:** When building or editing anything that produces user-facing text in this bot's voice:
- Default to routing raw facts/data through the LLM (`call_llm` in `V3_updates.py`) with a JARVIS-style system prompt — composed, dry wit, conversational, 2-3 sentences, no markdown headers/bullet dumps — rather than hardcoded template strings, mirroring the fix in [[project_phased_agent_roadmap]]'s weather feature (`weather_agent.py get_weather()`).
- This applies to new features (reminders firing, briefing intros, email triage notifications, local-bridge results, etc.) as well as edits to existing ones — when touching a response path, consider upgrading it to this bar even if not explicitly asked, but flag the change rather than silently replacing tested behavior.
- Always keep a non-LLM plain-text fallback for when the LLM call fails (same pattern used in `get_weather()` — try the JARVIS phrasing, fall back to plain facts on exception), since this bot must keep working even when OpenRouter is down or rate-limited.
- The existing WhatsApp/general-chat system prompt in `process_message()`'s `GENERAL CONVERSATIONAL CHAT` fallback must NOT be touched per earlier standing instruction — this quality bar applies to new/other response paths, not as license to rewrite that specific prompt.

## Project — ongoing work & constraints

### project_deploy_watcher_agent _(via antigravity)_
Built Phase 5 deploy_watcher_agent.py (RSS memory, GitHub commits, health probes) and wired /api/deploy-watcher/status + /cron/deploy-watcher endpoints into V3_updates.py.

### project_whatsapp_engine_oom _(via claude-code)_
"WhatsApp engine OOM on Render — root cause is glibc malloc-arena ratcheting, not a single spike"

The Daily AI WhatsApp engine (V3_updates.py) hit Render's memory limit (~512MB tier). Diagnosed 2026-06-29.

**Root cause:** cumulative RSS ratcheting, NOT a single spike. Local test showed RSS climbs and never returns to baseline (idle 113MB → 190 → 239 → 301 → 309MB after repeated 52MB PDF uploads). Large transients (PDF bytes, scraped digest HTML, big LLM prompt/response strings) are freed by Python but not returned to the OS. On Render (Linux/glibc) the mechanism is glibc malloc arenas — blocking work runs in threads via run_in_executor (requests.get, pdfplumber), and glibc creates one memory arena per thread (up to 8×cores), each hoarding freed memory. Over daily digests + hourly inbox checks + chat + occasional PDFs it ratchets past 512MB.

A single PDF is NOT the killer — even a 52MB scanned PDF only peaks ~190MB (scanned/image PDFs are cheap; pdfplumber skips them, no OCR). Baseline import cost ~100-113MB (openai alone 52MB); RAG is pure-Python BM25, no ML models.

**Fix SHIPPED 2026-06-29 (commit a8bbd4d, pushed to main → Render auto-deploy):** in-process glibc tuning that travels with the code — `_tune_malloc_arenas()` calls `mallopt(M_ARENA_MAX=-8, 2)` at lifespan startup (MALLOC_ARENA_MAX=2 equivalent), and `_malloc_trim()` (ctypes `malloc_trim(0)`) runs after PDF parse and after the digest; raw PDF bytes are `del`'d before the trim so the heap can be reclaimed. All glibc-only, no-op on macOS dev. If it still creeps: also set `MALLOC_ARENA_MAX=2` env var on Render, cap PDF upload size, or bump plan.

**Verify deploy:** startup log should show "✅ malloc arenas capped at 2"; watch `GET /health/mem` stays flat over a day instead of ratcheting.

**Diagnostic probe added (uncommitted):** `_rss_mb()`/`_mem_probe()` helpers + `GET /health/mem` endpoint + MEM[...] log lines around upload_pdf, run_morning_digest, and the privachat proxy. Keep to verify the fix — idle /health/mem should stay flat. See [[feedback_local_test_before_render]] and [[feedback_no_commit_without_explicit_go]].

### project_shared_memory_bridge _(via claude-code)_
How Claude Code and Antigravity share memory in this repo (shared_memory.py + AGENTS.md)

Claude Code and Antigravity share one memory store in this repo (built + committed `ed87c44`, 2026-07-05).

**Mechanism:** `shared_memory.py` keeps a `shared_memory` table in the LOCAL `agent_memory.db` and renders `AGENTS.md`. Antigravity reads `AGENTS.md` natively; Claude Code reads it via `CLAUDE.md`'s `@AGENTS.md` import. A SessionStart hook re-renders it each session.

**Key gotcha:** the two SQLite MCP servers are NOT a shared channel — Claude's `mcp_sqlite_server.py` does `load_dotenv()` → hits prod Turso, while Antigravity's `server-sqlite` reads the local file. The shared channel is the `AGENTS.md` FILE, not the DB.

**How to apply:** when the user asks to remember something for both tools (or just says "remember this" while working across both IDEs), run:
`python3 shared_memory.py add --key <slug> --category <user|feedback|project|reference|decision> --source claude-code "the fact"`
This upserts and regenerates AGENTS.md. Use `list`/`rm <key>` to review/forget. See [[feedback_safe_mode_for_local_tests]] for why local == agent_memory.db here.

### project_repo_skills _(via claude-code)_
The repo has Claude Code skills under .claude/skills/ encoding project workflows — mention/use them when relevant

Created 2026-07-01: the Daily_AI_updates repo now has project-scoped Claude Code skills at
`.claude/skills/<name>/SKILL.md` (git-tracked, so they version with the repo; excluded from
Docker builds via .dockerignore). They encode the recurring workflows so any session follows
the project's conventions automatically instead of re-deriving them from memory.

Skills present:
- **add-agent-module** — scaffold a new phase/agent (`<name>_agent.py`): one-file-per-agent, AI-classifier routing (no hardcoded triggers), approval-before-send hold tables, SAFE_MODE local test, plus how to add a pattern-learning category. Fires on "add a Slack agent" / "start Phase 4" / "add a pattern category".
- **deploy-engine** — the commit/push→Render sequence with the "never commit until user says commit" gate, secret-file exclusions, and post-deploy Render env-var + cron-job.org reminders.
- **refresh-gmail-token** — diagnose `invalid_grant`, re-run get_gmail_token.py for combined gmail.modify+calendar scopes, update BOTH local .env and Render, verify. Fires on the calendar/gmail "Token has been expired or revoked" error.

**How to apply:** when a task matches one of these, invoke the skill (or at least follow it) rather than improvising. NOTE: skills are discovered at session start — one created mid-session needs a restart to register. These overlap with existing feedback memories ([[feedback_no_commit_without_explicit_go]], [[feedback_safe_mode_for_local_tests]], [[feedback_local_test_before_render]]) on purpose — the skill is the actionable playbook, the memory is the standing rule. Related: [[project_phased_agent_roadmap]].

### project-phased-agent-roadmap _(via claude-code)_
"Multi-phase roadmap for adding agent modules (email, calendar, slack, etc.) to the WhatsApp bot project"

The project (V3_updates.py, a FastAPI WhatsApp bot deployed on Render) is being extended in phases, one new agent module per phase, all sharing the same repo/deployment/SQLite DB:

- Phase 1 (done): Email Triage Agent — `email_triage.py`. Gmail OAuth, inbox watch, LLM priority classification, draft generation, `pending_drafts`/`processed_emails` tables, APPROVE EMAIL / EDIT: routing, hourly APScheduler job. Later extended with compose-and-send/draft-to-Gmail (`save_composed_draft`/`send_composed_email`/`create_gmail_draft`), routed via the shared AI intent classifier, not hardcoded phrases.
- Phase 2 (mostly done): Reminders (`reminders.py`, full CRUD + restart-recovery + missed-reminder notice) and Notes/Facts (`user_facts` + BM25 `rag_engine.py`) are done. Voice Note Support (Twilio media → Whisper) was never built — skipped, not currently planned to revisit. Daily Briefing exists (`run_morning_digest`) with weather folded in.
- Phase 3 (current, in progress as of 2026-06-23): Google Calendar Agent (`calendar_agent.py`) + generalized `scheduled_automations` table (`automations.py`). Built: list/check-availability/create/delete events via the same AI-classifier routing (`CALENDAR_ACTION` intent, no hardcoded phrases); events with attendees are held in `pending_calendar_events` for explicit CONFIRM EVENT before Google auto-emails the invite (mirrors the email compose-hold pattern). `automations.py` generalizes reminders.py's persist/restore-on-restart/missed-job pattern with an `action_type`+JSON `payload` shape and a `dispatch_automation()` function in `V3_updates.py` that maps action_type to real logic (`send_message`, `calendar_digest` built so far) — future phases (job scout, deadline watcher) should reuse this engine rather than building their own scheduler-table-plus-restore function. **Blocker CLEARED 2026-07-01**: re-ran `get_gmail_token.py`; new `GMAIL_REFRESH_TOKEN` now carries both `gmail.modify` + `calendar`. Verified live — token refreshes cleanly and a real `events.list` on `primary` succeeded. Both local `.env` AND Render's `GMAIL_REFRESH_TOKEN` updated (Render's first paste missed — old revoked token lingered and threw `invalid_grant` on live `create_event`; re-pasting the token into Render's env var + redeploy fixed it). Confirmed 2026-07-01: JARVIS creates real calendar events end-to-end over WhatsApp. Phase 3 is DONE — code-complete AND auth-working live. NOTE: the previous local token had gone fully expired/revoked (`invalid_grant`), which also broke Phase 1 Gmail until this refresh.
- Phase 4 (in progress as of 2026-07-02): Slack Agent, Job Scout Agent, Resume Tailoring Agent, Application Tracker Agent.
  - **Job Scout (`job_scout_agent.py`) — DONE & live-tested (uncommitted):** daily cron pipeline (Adzuna India-primary + Remotive filtered → dedup via seen_jobs → prefilter → LLM rank Groq-first/Gemini-fallback → WhatsApp digest) via `POST /cron/job-scout`; on-demand `JOB_SEARCH` intent uses JSearch (RapidAPI `jsearch.p.rapidapi.com/search-v2`, v5, key `RAPIDAPI_KEY`, 200/mo, read-only+ephemeral+tags-seen) falling back to live Adzuna if no key. Sources decided empirically for Data-Analyst/India: Adzuna primary, Remotive secondary, JSearch on-demand; Himalayas/Jobicy dropped. Spec: `docs/job_scout_spec.md`.
  - **Application Tracker (`application_tracker.py`) — DONE & tested (uncommitted):** `applications` table, statuses interested/applied/interviewing/offer/accepted/rejected. Explicit `TRACK <n>` command (resolves against job_scout `job_scout_last_shown` display-state table via `get_last_shown`) + `APPLICATION_ACTION` intent (list/update-by-company). Wired in V3.
  - **Resume ATS Alignment (`resume_ats_agent.py`) — DONE & tested (uncommitted):** on-demand per application (chosen over auto-per-job to bound LLM cost). Tables `user_resume_templates` (master DA resume) + `ats_analysis_cache`. Gemini/Groq NLP producing ats_score + keyword_matrix (required/present/missing) + STAR/XYZ current→optimized breakdown + clean markdown-stripped downloadable .txt. **CONSERVATIVE tailoring** (user chose 2026-07-02): reframe+quantify REAL experience only, re-label genuine skills to JD vocab, NEVER inject tools/domains not used (no Oracle/SAP fabrication); missing keywords shown as honest gap report, not inserted into bullets. UI: 🎯 button on each application card → 2-tab modal (Keyword Matrix / STAR-XYZ delta) + Download .txt + badge on Jobs tab (poll `/ats/pending/count`, NOT SSE — SSE rejected to keep the free instance asleep). Endpoints: POST /applications/{id}/ats, GET /ats/{ref}, GET /ats/{ref}/download, /resume/upload, /resume/status. Master resume stored DB-only + git-ignored `master_da_resume.txt` (personal data, never committed). JD `description` now stored on applications (job_scout `_norm` desc bumped 400→2500 chars).
  - **Session 2026-07-03 (committed + pushed, c65f498):** big extension of the job-hunting core — see [[project_application_email_tracker]]. Added `application_email_tracker.py` (Gmail→Kanban auto-advance 2×/day), chat quick-add + manual Add-Job, paste-JD-on-demand ATS for JD-less/quick-apply cards, deterministic ATS keyword reconciliation (fixed false "Missing"), per-card ATS score badges (colour + high→low sort), PENDING-ANALYSES = roles-not-yet-scored, orphan-analysis cleanup on card delete. Also diagnosed: locally `db_compat` reads `TURSO_DATABASE_URL` at import BEFORE `load_dotenv`, so `python V3_updates.py` silently uses local `agent_memory.db` not Turso — export the Turso vars into the env before launch to test against the real cloud board. Migrated 4 real local-only cards into Turso.
  - **Slack Agent: OUT OF SCOPE (user, 2026-07-03)** — deferred to a possible future phase, not building now (WhatsApp being retired, everything routes to the JARVIS web console). Phase 4's job-hunting trio is functionally complete and deployed.
  - Still TODO in Phase 4: Slack Agent (deferred, see above). Job Scout+Tracker+ATS need Render env vars (RAPIDAPI_KEY/GEMINI_API_KEY/ADZUNA_*) + daily cron-job.org hit + deploy; master resume must be re-seeded into prod Turso (via /resume/upload once deployed).
- Phase 5 (started 2026-07-03): Deadline/Bill Watcher, Web Scraper/Research Agent, Code/Deploy Watcher, Scoped Local File Reader.
  - **Scoped Local File Reader — DONE** (pre-existing): `read_file`/`search_files`/`system_info`/`list_recent_files` wired into chat routing via `_queue_local_command`.
  - **Deadline/Bill Watcher (`bill_watcher.py`) — DONE + UI, pushed (commits ~4f3e278, 2026-07-03):** `bills` table (name/amount/currency ₹/recurrence monthly|once|yearly/due_day|due_date/notify_days_before/last_notified_cycle/paid_cycle). `BILL_ACTION` intent (add/list/paid/delete) via the shared AI classifier — natural phrasing ("add electricity 1200 due on the 5th every month", "mark rent paid"). Daily check `check_bills_and_notify` → `/cron/bills` + run-job "bills-check" + internal scheduler 08:00 IST; notifies once per occurrence, `paid_cycle` (distinct from `last_notified_cycle`) rolls `next_due` forward. Notifications via `_store_notification` (web inbox). **Dedicated BILLS console tab** (`Bills.tsx`): summary tiles, due-date status dots, add-bill modal, Mark Paid, delete — REST `GET/POST /api/bills`, `/api/bills/{id}/paid`, `/delete`. **User must add a daily cron-job.org hit to `/cron/bills?token=<secret>` on Render (external scheduler).**
  - Still TODO in Phase 5: **Code/Deploy Watcher** (needs user's RENDER_API_KEY + service id) and **Web Scraper/Research Agent** (search-source design decision pending). No console UI for bills yet — chat-only so far.
- Phase 6: Twilio outbound voice calling (separate project phase, built last).
- **Pattern-learning layer (in progress)**: `pattern_learning.py` — generic `learned_patterns` table keyed by category, distilled by LLM, pulled into generation via `get_pattern_context(category)`. Categories built: (1) `email_tone` — mines `draft_edits` (AI draft vs user EDIT:) → tone note injected into email triage prompt; (2) `reminder_timing` (added 2026-07-01) — mines the `reminders` table via `refresh_reminder_timing_pattern(call_llm)`, fired background after each successful SET_REMINDER; the note is injected into the MEMORY_INTENT_PROMPT classifier call in `V3_updates.py` as a `timing_hint` that fills in a default time ONLY when the user states none (never overrides an explicit time). MIN_SAMPLES_TO_ANALYZE=3 gates both (no learning on near-zero data). Adding a category = a new `refresh_*` fn here + one injection point, no schema change. Next candidate: calendar prefs. Still worth noting the original caution: these only get useful after real usage accumulates.

**Why:** User wants each capability isolated as its own module file (never monkeypatched into the main file), proven reliable before the next phase starts.

**How to apply:** Standing architecture rules apply to every phase: (1) any LLM-generated content going to someone else needs approval before sending — `pending_drafts`-style for email, `pending_calendar_events`-style for attendee invites; (2) `scheduled_automations` (now built, in `automations.py`) is for fixed pre-approved content only, no per-send approval — use it for new recurring/one-off jobs instead of a bespoke table; (3) one file per agent; the `shared/` folder exists but was never actually wired in — current convention is top-level module files (`reminders.py`, `email_triage.py`, `calendar_agent.py`, `weather_agent.py`, `automations.py`), follow that, not `shared/`; (4) no agent gets write/delete access beyond what it's explicitly scoped for; (5) [[feedback-local-test-before-render]] — test locally, then deploy; (6) route natural-language intent through the shared `MEMORY_INTENT_PROMPT` AI classifier in `V3_updates.py`, never hardcoded exact-phrase/substring trigger lists — this was a recurring bug class (weather, reminders-list, email-compose all broke on natural phrasing before being moved to AI classification); (7) [[feedback_jarvis_movie_quality_bar]] applies to every new response path; (8) the general-chat fallback must never claim an action succeeded or confidently deny/confirm a capability it has no way to verify (see the Gmail-access and reminder-fabrication incidents) — ground real capabilities as explicit facts in the web system prompt instead of leaving the LLM to guess.

### project_koyeb_migration _(via claude-code)_
Engine migrating from Render to Koyeb free (no hours cap); privachat stays on Render

Decided 2026-06-29: move the WhatsApp **engine** to **Koyeb free**, keep **privachat on Render** (one free service per provider — not a failover, a split). Reason: Koyeb free has **NO monthly instance-hours cap** (Render's 750-hr cap was the core pain) — it just **sleeps after 1h idle** and wakes on traffic. Same 512MB RAM as Render (so OOM risk carries over; the malloc fix handles it — see [[project_whatsapp_engine_oom]]). Koyeb free = 1 instance/org, 512MB/0.1vCPU/2GB SSD, Frankfurt or Washington region. Railway rejected (free tier is a one-time ~$5 trial then paid). Hetzner VPS (~€4/mo) offered as the paid clean-exit but user chose free Koyeb.

**Shipped (commit d5df396, pushed to main):** Dockerfile (python:3.11-slim, bakes in MALLOC_ARENA_MAX=2) + .dockerignore. Verified: builds clean, container boots ~94MB. The Render engine service will switch to Docker build on its next deploy (harmless; being abandoned).

**Koyeb service settings:** GitHub repo daily-ai-whatsapp-engine, branch main, Dockerfile builder, Free Nano, Frankfurt, port 8000, health check /ping. Env vars to copy from .env: TWILIO_SID/TOKEN, GROQ_API_KEY, OPENROUTER_API_KEY, GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN, TURSO_DATABASE_URL/AUTH_TOKEN, GITHUB_REPO/TOKEN, CLAUDE_CODE_TRIGGER_SECRET. Do NOT set SAFE_MODE. Leave SCHEDULER_MODE unset (internal).

**Keep-alive plan:** since hours are free on Koyeb, run effectively always-on via cron-job.org GET /ping every 40min (under the 1h sleep) → use SCHEDULER_MODE=internal for precise on-time jobs (no need for the external /cron/* model that [[project_external_scheduler_mode]] built for Render).

**Twilio switch (last step):** webhook "When a message comes in" → https://<app>.koyeb.app/whatsapp-webhook (POST). Webhook path is /whatsapp-webhook. Verify /health/status?token=SECRET before flipping.

### project_external_scheduler_mode _(via claude-code)_
SCHEDULER_MODE=external + /cron/* endpoints let the Render free instance sleep to save instance-hours

To stop the WhatsApp engine exhausting Render's free **750 instance-hours/month** (one always-on free service ≈730 hrs, and there are two free services: the engine + privachat.onrender.com), scheduling can be externalized. Shipped 2026-06-29 (commit 8d26964, pushed to main).

**`SCHEDULER_MODE` env var** (default `internal` = old behavior, in-process APScheduler, unchanged). Set `SCHEDULER_MODE=external` on Render to make the instance sleep and be woken only at job times by an external cron, dropping ~730 hrs/mo to ~180.

In external mode the fixed jobs and reminder/automation DateTriggers are NOT registered; instead secret-guarded endpoints (token = existing `CLAUDE_CODE_TRIGGER_SECRET`, passed as `?token=`) drive them, returning 202 after launching the job in the background:
- POST /cron/digest, /cron/inbox (also fires due reminders+automations), /cron/checkin?n=1..5, /cron/weekly, /cron/reminders-due
- Dedup: once-items via status column, daily/weekly via cron_fire_log table (per IST date); reminders.create_reminder_from_intent(register=False) so externally-polled reminders don't double-fire when awake.

**cron-job.org schedule (TZ Asia/Kolkata, POST):** digest `0 9 * * *`, inbox `0 * * * *` (hourly = main wake, ~180 hrs/mo; drop to `0 */2 * * *` for ~90), checkins `0 11/13/15/17/19 * * *` with matching n, weekly `0 9 * * 0`. Reminders fire within-the-hour (agreed trade-off; to-the-minute would need always-on or the $7 plan).

**Operational gotcha:** for the instance to actually sleep, any keep-alive pinger (UptimeRobot/cron hitting `/`) on the engine AND privachat must be removed — that's the likely real cause of the 730-hr burn. See [[project_whatsapp_engine_oom]].

### project_console_react_ui _(via claude-code)_
"A second web UI (React/Vite) lives in jarvis-system-core/, served at /console; how to build/update it"

Added 2026-07-02 (commit 00f5fdc): a second web UI — a **React 19 + Vite + Tailwind v4** app
in `jarvis-system-core/` (originally from Google AI Studio "Build"; cinematic dark HUD, "refined
dark" style). Served by FastAPI as **pre-built static files at `/console`** via a StaticFiles
mount in `V3_updates.py` (guarded by `os.path.isdir(dist)`). The OLD vanilla-HTML UI is untouched
at `/chat` (that's `CHAT_UI_HTML`). Both coexist.

Screens (one `.tsx` component each under `src/components/`) are wired to the SAME real endpoints
the /chat UI uses: JobsBoard→/applications + /applications/{id}/ats + /resume; SecureChat→
/chat-message + /chat-history (+ Web Speech voice in/out, PrivaChat iframe); SystemTerminal→
/local-queue/history + /web-terminal/upload-pdf (field name `file`) + Claude Code; CoreInterface→
/ping + counts. No LLM/Gemini calls in the frontend — everything goes through the backend.

**How to update the console UI:**
1. Edit the `.tsx` in `jarvis-system-core/src/`.
2. `cd jarvis-system-core && npm run build` (Vite `base` is `/console/` — do not change).
3. **Commit the rebuilt `jarvis-system-core/dist/`** — it's intentionally un-ignored (Render has
   NO Node build step; FastAPI serves the committed dist). `node_modules/` stays git-ignored.

**Gotcha:** `npm install` fails with EACCES on `~/.npm/_cacache` (stale perms from a past sudo).
Work around with a custom cache: `npm install --cache /tmp/somedir --no-audit --no-fund`.

To make /console the primary UI later: point `/chat` at it (redirect) or swap. Right now it's
side-by-side for browser click-testing. Build was verified: tsc clean, vite build clean, /console
serves 200, all wired endpoints respond. Runtime click-behavior needs a real browser to confirm.
Related: [[project_phased_agent_roadmap]].

### project_application_email_tracker _(via claude-code)_
"Email→Kanban auto-sync agent — reads Gmail twice daily, advances job-application cards"

`application_email_tracker.py` (new agent, built 2026-07-03) reads Gmail and drives the Kanban board in [[project_phased_agent_roadmap]]. Twice daily (morning catch-up + evening sweep) it classifies each recent email via one batched LLM call → stage (applied/interviewing/offer/accepted/rejected).

Behavior (user's chosen rules):
- **Confident + single card match** → moves the card forward automatically (forward-only; rejected allowed from any stage except accepted) + undoable notification.
- **Confident + not on board** → auto-adds the card at that stage (source "Email").
- **Low confidence OR ambiguous (two roles at same company)** → parks a row in `application_email_pending`; nothing moves silently. User resolves via the "Needs your confirmation" strip on the Jobs board (Confirm/Dismiss), or the notification.

Wiring: cron endpoint `POST /cron/scan-applications`; run-job name `scan-applications` (⌘K palette "Scan emails → update board" + Jobs toolbar "SCAN EMAILS"); pending API `/applications/pending` (+ `/{id}/confirm`, `/{id}/dismiss`). Reuses existing Gmail auth (read-only, no new scope). First run looks back 30 days, then 3 days; `application_scan_emails` table prevents reprocessing.

**User must add to cron-job.org (external scheduler on Render): two daily hits to `/cron/scan-applications?token=<CLAUDE_CODE_TRIGGER_SECRET>` — ~8:30 AM & ~9:00 PM IST.** Internal-scheduler (local) already registers both.

Committed + pushed to Render 2026-07-03 (commit c65f498), together with: manual Add-Job + chat quick-add ("applied to X at Y on Naukri" → APPLICATION_ACTION add), paste-JD-on-demand ATS for JD-less cards, deterministic ATS keyword present/missing reconciliation, per-card ATS score badges (colour + high→low sort), and PENDING ANALYSES = roles-not-yet-scored. Still pending on Render: the 2 cron-job.org entries above, and verify the master résumé in prod Turso is the real one (not the 66-char stub) via RÉSUMÉ → Upload on the live site.

### content_watcher_next_steps _(via claude-code)_
Content-watcher engine — status as of 2026-07-13. ALL PLANNED WATCHERS BUILT + DEPLOYED. Done: foundation (relevance.py shared ranker; company_watch_agent.py Google-News signals; Daily 'Watch these'); slice 1b (company news on Kanban cards via 📰 badge + ⋯-menu intel; interview-prep briefs from calendar); People Watch (people_watch_agent.py — contact_feeds table + influencer_posts.contact_id; watch a CRM contact's free RSS/YouTube feeds → networking nudges in the Networking modal; /cron/people-watch; creator-feed isolation verified); Unified Trends Pulse (GET /api/trends/pulse read-time UNION of trend_lab ideas + influencer feed; PULSE toggle in Trend Lab). See [[content_watcher_engine]]. Phase 5 (watcher_core.py refactor + namespaced watch_items table) DELIBERATELY NOT DONE — shared primitives (relevance.py, influencer_agent fetch/store) already reused; remaining dup is ~15 lines/ watcher; full migration would rewrite 4 live features reading influencer_posts/seen_jobs (no Turso rollback) for marginal gain. Only revisit if a future watcher makes duplication genuinely painful. OUTSTANDING DEPLOY TODOs on Render (cron-job.org, all ?token=CLAUDE_CODE_TRIGGER_SECRET): daily hits to /cron/company-watch (news+interview-prep), /cron/influencer-digest, and NEW /cron/people-watch.

### content_watcher_engine _(via claude-code)_
Content-intelligence engine + integrations (built 2026-07-13, pushed commit 5b919f4). The influencer scraper was generalized into reusable pieces: relevance.py (pure DB-free LLM ranker; boolean-keep mode for feeds + 0-100 scoring mode for jobs; fails open) — influencer_agent.rank_relevance now wraps it. company_watch_agent.py: for every ACTIVE Kanban company (applications.status NOT IN rejected/accepted) polls FREE Google News RSS (news.google.com/rss/search) for hiring/funding/layoff signals, LLM-filters via relevance.rank_relevance, dedups into company_news table, posts a JARVIS briefing to notifications. Endpoints /cron/company-watch, /api/company-watch/run, /api/company-watch/news. Design choice: these are NEWS SIGNALS not applyable jobs (Google News != job postings). Daily AI Update got a 'Watch these' section: watch_json column on daily_web_digest (Turso-safe migration), _watch_these_for_concept() keyword-matches relevant influencer_posts to the day's concept (Tier-1, no extra LLM), rendered in DailyUpdate.tsx. NOT YET BUILT (planned phases from the 4-subagent analysis): 1b Company Watch->attach news to Kanban cards + interview-prep briefs from calendar; People Watch->Networking CRM (contact_feeds table); Unified Trends Pulse (Reddit+YouTube UNION); Phase 5 watcher_core.py full refactor + job_scout dedup onto it. POST-DEPLOY TODO on Render: add daily cron-job.org hit to /cron/company-watch?token=<CLAUDE_CODE_TRIGGER_SECRET> (alongside the existing /cron/influencer-digest one).

### influencer_watcher_upgrade _(via claude-code)_
Influencer Watcher upgraded + deployed 2026-07-12 (commits c9b1db2 backend-half by external tool, 7c77459 finished UI+dist by claude-code). Fixed a prod-breaking split-brain: influencer_agent.py/watch_influencer.py used real 'import aiosqlite' (local file) while V3 endpoints use db_compat (Turso) -> add wrote to Turso, list/sync/digest read the local file -> feature was dead on Render. Now both use 'import db_compat as aiosqlite'. Also added db_compat.IntegrityError export (duplicate-add was 500, now 400). New: free fetch_rss() source (RSS/Atom: Substack/Medium/blogs/Reddit .rss/arXiv) + 'rss' platform; persistent influencer_posts table (dedup ledger + feed history + is_read); batched LLM relevance ranking vs Madan's interests (fails open); feed endpoints GET /api/influencers/feed, /unread-count, POST /feed/read; Influencers.tsx 'Latest Updates' feed + unread badge (Discover tab) + RSS option; HomeCockpit 'Watching' strip folds top relevant posts into Home newspaper. IG/X still need paid RAPIDAPI_KEY (marked in UI). POST-DEPLOY TODO on Render: add a daily cron-job.org hit to /cron/influencer-digest?token=<CLAUDE_CODE_TRIGGER_SECRET>.

### project_render_postdeploy_todo _(via claude-code)_
Render post-deploy TODO after commit 2808551 (Daily Update threaded tutor + knowledge base + Pyodide run; weekly-project removed; Home 'The Daily AI' front page). Outstanding manual steps on the live Render instance: (1) cron-job.org — add a DAILY hit to /cron/web-digest?token=<CLAUDE_CODE_TRIGGER_SECRET> and RETIRE the old /cron/digest (WhatsApp morning digest is no longer the primary path; the web daily digest is). (2) REGENERATE the RapidAPI key that leaked in chat earlier, then set the Reddit Trend Lab env vars on Render: RAPIDAPI_KEY1, REDDIT_RAPIDAPI_HOST=reddit34.p.rapidapi.com, REDDIT_RAPIDAPI_PATH=/getPostsBySubreddit, REDDIT_RAPIDAPI_QUERY_PARAM=subreddit, REDDIT_RAPIDAPI_MODE=subreddit. (3) Verify the master resume in prod Turso is the real one (not the 66-char stub) via RESUME -> Upload on the live site. (4) Pyodide 'Run (Python)' on the Daily tab loads its runtime from cdn.jsdelivr.net at click-time (~6MB first run) — confirm reachable from the browser; degrades to an 'offline?' message otherwise. Also for the 2x/day email->Kanban scan: two daily cron-job.org hits to /cron/scan-applications?token=<secret> (~8:30 AM & ~9:00 PM IST) if not already added.

### console-guided-flow-plan _(via claude-code)_
PLAN — reorganize the whole JARVIS console into a proper guided, ordered flow (approved 2026-07-05). Reference model = job-search lifecycle: (1) Discover (2) Assess (3) Apply (4) Track (5) Follow-up (6) Interview (7) Reflect. Everything's layout + 'next step' logic obeys this spine. Execution steps, in order: Step 2 = HOME COCKPIT (make Core the default landing screen: greeting + JARVIS voice, a prioritized clickable 'Next steps' queue that deep-links into each tool, a Pipeline pulse with week-momentum folded in, and an 'Ask JARVIS' footer that opens chat). Reuses daily_standup.gather() data — cheap, free-tier. Needs a small 'navigation intents' mechanism so a Home button can open a specific modal on the Jobs screen. Step 3 = reorder Jobs Tools dropdown into lifecycle groups (Discover/Assess/Apply/Follow-up/Interview; Standup moves to Home; Notes=Workspace). Step 4 = reorder top nav HOME→JOBS→INSIGHTS→BILLS→JARVIS→TERMINAL, rename Core→HOME (fixes the two-JARVIS-screens redundancy; chat stays in the Assistant screen). Step 5 = inline next-step cues on kanban cards (Applied>7d shows 'Follow up', interview-matched shows 'Prep'). Each step ships alone, tested under SAFE_MODE, no commit until user says. Started with Step 2.

## Reference — pointers & resources

### shared-memory-bridge _(via claude-code)_
Claude Code ⇄ Antigravity shared memory. Canonical store: shared_memory table in LOCAL agent_memory.db, managed by shared_memory.py. Both IDEs read the generated AGENTS.md (Antigravity natively; Claude via CLAUDE.md @import). NOTE: the two SQLite MCP servers are NOT a shared channel — Claude's mcp_sqlite_server.py loads .env and hits prod Turso, while Antigravity's server-sqlite reads the local file; AGENTS.md is the real bridge. To add: python3 shared_memory.py add --key <slug> --category <cat> --source <who> "fact" (regenerates AGENTS.md). A Claude SessionStart hook re-renders AGENTS.md each session.

## Decisions — settled choices

### analyst_pyodide_same_origin_proxy _(via claude-code)_
The Data Analyst's Pyodide runtime MUST load from the same-origin engine proxy (GET /pyodide/{path} in V3_updates.py -> streams from jsdelivr server-side, disk-cached, immutable cache headers), NOT directly from jsdelivr. Root cause (2026-07-17): loading Pyodide straight from cdn.jsdelivr.net hung forever on the user's Hyderabad ISP because several Indian ISPs throttle/block jsdelivr; it worked from other networks, making it look like slowness. Multi-CDN fallbacks (fastly/gcore.jsdelivr) DON'T help - all jsdelivr edges. Frontend DataAnalyst.tsx sets indexURL='/pyodide/'. Excel wheels (openpyxl+et_xmlfile) are self-hosted under jarvis-system-core/public/wheels and micropip-installed from /console/wheels with deps=False, so Excel doesn't need PyPI either. In Pyodide 0.26.4 loadPackage lacks openpyxl/pyarrow/python-calamine (use micropip wheels for openpyxl; fastparquet+cramjam for parquet; xlrd for .xls). DO NOT revert to direct-CDN loading.
