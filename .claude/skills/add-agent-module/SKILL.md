---
name: add-agent-module
description: Use when adding or extending an agent capability in the Daily_AI_updates WhatsApp/JARVIS engine — a new phase/agent (Slack, job scout, deadline watcher, etc.), a new scheduled automation, or a new pattern-learning category. Covers the project's module layout, AI-classifier routing, approval-before-send rule, SAFE_MODE local testing, and the Render deploy guardrails. Follow this instead of improvising a new structure.
---

# Add an Agent Module (JARVIS Engine)

Standing architecture for `V3_updates.py` (FastAPI WhatsApp bot on Render). Every new
capability is its own top-level module file sharing the one SQLite DB. Follow this exactly.

## Non-negotiable guardrails
- **Never `git commit` until the user explicitly says "commit"** (their phrase is "commit to render"). Build and test locally first, then wait.
- **Always test locally with `SAFE_MODE=1`** — it swaps in a throwaway `/tmp` DB and suppresses real Twilio sends. `SAFE_MODE` must be read before `import db_compat` (top of the file). Never run engine tests that hit `/cron/*` without it — those send real WhatsApp messages to the user's phone.
- **Never hardcode trigger phrases.** All natural-language intent goes through the shared `MEMORY_INTENT_PROMPT` AI classifier in `V3_updates.py`. Add a new intent enum there; don't substring-match `user_message`. (Weather, reminders, email-compose all broke on natural phrasing before this rule.)
- **Anything LLM-generated that goes to someone else needs approval before sending.** Use a `pending_*` hold table + an explicit confirm keyword (mirror `pending_drafts` for email, `pending_calendar_events` for invites). Fixed pre-approved recurring content is the only exception → use `automations.py`, not a bespoke table.
- **One file per agent.** Top-level module (`reminders.py`, `email_triage.py`, `calendar_agent.py`, `weather_agent.py`, `automations.py`, `pattern_learning.py`). Do NOT use the unused `shared/` folder. Never monkeypatch logic into `V3_updates.py`.
- **The general-chat fallback must never claim an action succeeded it can't verify**, and must never invent a capability. Ground real capabilities as explicit facts in the web system prompt.
- All JARVIS-voice output should sound like movie-JARVIS (witty, composed), never a templated bot.

## Steps to add a module `<name>_agent.py`
1. **Create the module** with:
   - `init_<name>_tables()` — synchronous, uses `db_compat.connect_sync(DB_PATH, check_same_thread=False)`, `CREATE TABLE IF NOT EXISTS`. Mirror the style in `reminders.py`.
   - Async public functions using `db_compat as aiosqlite`. Own error handling — log `⚠️ [<name>] ...` and return a safe default; never raise into the request path.
   - If it schedules future work, prefer `automations.py` (`action_type` + JSON `payload`, restore-on-restart handled) over a new scheduler table.
   - If it sends to third parties, add a `pending_*` table + confirm/cancel path.
2. **Wire into `V3_updates.py`:**
   - `from <name>_agent import (...)` near the other agent imports.
   - Call `init_<name>_tables()` at startup, next to the other `init_*` calls.
   - Add the intent to `MEMORY_INTENT_PROMPT` (enum value + a "Use X when ..." line), and handle it in `process_message()` alongside `SET_REMINDER` / `CALENDAR_ACTION`.
   - Register any scheduled jobs in the lifespan startup (respect `SCHEDULER_MODE`: `external` persists rows for `/cron/*` to fire, `internal` adds in-process jobs — pass `register=(SCHEDULER_MODE != "external")`).
3. **Local test** (from the project dir, never scratchpad — imports need `db_compat`):
   ```bash
   SAFE_MODE=1 DB_PATH=/private/tmp/.../scratchpad/test.db python3 - <<'PY'
   # init tables, exercise the public functions with a stub call_llm, assert results
   PY
   python3 -c "import ast; ast.parse(open('V3_updates.py').read()); print('ok')"
   ```
4. **Report** what changed and the test result. Then STOP and wait for "commit".

## Adding a pattern-learning category (`pattern_learning.py`)
The `learned_patterns` table is generic (one row per `category`). To add one:
1. Write a `<CATEGORY>_ANALYSIS_PROMPT` and an async `refresh_<category>_pattern(call_llm_fn)` that: reads the relevant source table (read-only), no-ops below `MIN_SAMPLES_TO_ANALYZE`, calls the LLM (capped `max_tokens`), and upserts under the category name. Wrap the LLM call so a failure preserves the prior note.
2. Add it to `refresh_all_patterns()`.
3. In `V3_updates.py`, pull it with `get_pattern_context("<category>")` and inject as **optional** context at the generation point. Learned values fill in only what the user omits — **never override an explicit value**.

## Deploy (only after the user says "commit")
```bash
python3 -c "import ast; ast.parse(open('V3_updates.py').read())"   # sanity first
git add <files> && git commit -m "..." && git push origin main
```
Commit message ends with the Co-Authored-By trailer. Never commit `.env` / `.env.save`.
After push, remind the user of any Render env vars or cron-job.org jobs the change needs.
