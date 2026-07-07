# JARVIS — Personal AI Operations Engine

A self-hosted AI assistant and **job-search cockpit**. A FastAPI engine runs a set of focused
agents (email triage, calendar, job scout, résumé/ATS, application tracker, follow-ups,
interview prep, bills, and more), and a React/Vite console — served at `/console` — presents it
all as a single guided workflow, from discovering a role to landing the offer.

> Built to be cheap to run: free-tier LLMs (Groq → Gemini fallback), SQLite/Turso storage, and
> the browser's own voice for speech, with an optional natural Gemini voice.

## Highlights

- **Home cockpit** — opens to a JARVIS greeting, a prioritized "next steps" queue that deep-links
  into the right tool, and a pipeline pulse.
- **Job-search lifecycle** — Discover → Assess → Apply → Track → Follow-up → Interview → Reflect,
  reflected in the layout, the tools menu, and inline card cues.
- **Agents** — one self-contained module per capability (see the inventory below).
- **Shared memory bridge** — a common memory store both Claude Code and Antigravity read via
  `AGENTS.md`, so context carries across tools.

## Console screens

`Home` (cockpit) · `Jobs` (kanban + tools) · `Insights` (analytics, funnel, skill-gap, calendar
shield, profile freshness) · `Bills` · `JARVIS` (chat) · `Terminal`.

## Tech

FastAPI · SQLite / Turso (`db_compat`) · React + Vite + Tailwind · Recharts · Groq & Gemini LLMs ·
Gmail & Google Calendar APIs · Web Push. Deployed on Render (free tier).

## Modules

<!-- AUTO:modules -->
- **`application_email_tracker.py`** — Application Email Tracker — reads Gmail and drives the Kanban board automatically.
- **`application_tracker.py`** — Application Tracker Agent — self-contained skill module (Phase 4).
- **`automations.py`** — Automations Agent — generalized scheduling engine (Phase 3 infrastructure).
- **`bill_watcher.py`** — Deadline / Bill Watcher — Phase 5 agent, self-contained module.
- **`calendar_agent.py`** — Calendar Agent — self-contained skill module (Phase 3).
- **`calendar_shield.py`** — Calendar Shield — guards your schedule around interviews.
- **`daily_standup.py`** — Voice Daily Standup — a single spoken briefing that pulls the whole job search together.
- **`db_compat.py`** — aiosqlite/sqlite3-compatible shim, so the ~91 existing DB call sites across this app.
- **`email_triage.py`** — Email Triage Agent — self-contained skill module.
- **`followup_agent.py`** — Follow-up Agent — nudges stale 'applied' cards with a drafted recruiter follow-up.
- **`gemini_tts.py`** — Gemini text-to-speech — an optional natural voice for JARVIS.
- **`get_gmail_token.py`** — One-time local script to mint a combined Gmail + Calendar OAuth refresh token.
- **`google_docs_agent.py`** — Google Docs Agent — turns an ATS analysis into a tailored-résumé Google Doc.
- **`interview_prep.py`** — Interview Prep Dock — surfaces upcoming interviews from Calendar and, on demand, drafts a.
- **`job_apply_agent.py`** — Job Apply Agent — apply-prep + (approval-gated) auto-apply for the Job Scout pipeline.
- **`job_scout_agent.py`** — Job Scout Agent — self-contained skill module (Phase 4).
- **`local_bridge.py`** — JARVIS Local Bridge.
- **`mcp_sqlite_server.py`** — SQLite MCP Server.
- **`networking_crm.py`** — Thin Networking CRM — track the people behind the applications.
- **`pattern_learning.py`** — Pattern Learning Agent — self-contained skill module.
- **`pdf_import.py`** — PDF Import — self-contained skill module.
- **`profile_freshness.py`** — Profile-Freshness Nudge — keep your shop-window current.
- **`reminders.py`** — Reminders Agent — self-contained skill module.
- **`resume_ats_agent.py`** — Resume ATS Alignment Agent — self-contained skill module (Phase 4).
- **`resume_editor.py`** — Résumé Editor — in-place .docx editing that PRESERVES formatting.
- **`shared_memory.py`** — Shared memory bridge for Claude Code ⇄ Antigravity.
- **`trend_lab_agent.py`** — Trend Lab Agent — weekly app-idea discovery from Reddit + YouTube (free-tier only).
- **`weather_agent.py`** — Weather Agent — self-contained skill module.
- **`workspace_notes.py`** — Workspace Notes — a small DB-backed markdown scratchpad for the console.
<!-- /AUTO:modules -->

## Running locally

```bash
# Engine (always use SAFE_MODE for local runs — throwaway DB, no real sends)
SAFE_MODE=1 .venv/bin/python -m uvicorn V3_updates:app --port 8080

# Console (from jarvis-system-core/)
npm install && npm run build     # served by the engine at /console
```

## Recent changes

<!-- AUTO:changelog -->
- `1a1bef0` feat(trends): richer YouTube (comment mining) + RapidAPI Reddit path _(2026-07-07)_
- `16e1159` feat(trends): Trend Lab — weekly app-idea discovery from Reddit + YouTube _(2026-07-07)_
- `edbbb56` feat: integrate OmniRoute local AI gateway and rebuild master resume with audit updates _(2026-07-07)_
- `4106740` feat(jobs): dual ATS+recruiter score badges, header help button, audit fixes _(2026-07-07)_
- `231ab42` feat(console): Help & Guide screen, delete-résumé, cleaner audit suggestions _(2026-07-06)_
- `f3cc0e1` feat(ats): recruiter-read feedback panel + deterministic per-JD score _(2026-07-06)_
- `fddc490` feat(ats): one-tap AUTO-FIX for the deterministic résumé points + fairer scorer _(2026-07-06)_
- `cfc9738` fix(ats): deterministic rule-based résumé score (ends the audit thrash) _(2026-07-06)_
- `6c30c53` feat(ats): support checkable grammar list with date-change confirmation popups _(2026-07-06)_
- `675e482` feat(ats): add rebuild_resume.py master cv restructuring script _(2026-07-06)_
- `658cc96` feat(ats): support interactive keyword selection and injection in resume audit _(2026-07-06)_
- `d88175a` feat(ats): upgrade apply_rewrites matching robustness and add changes details dialog _(2026-07-06)_
<!-- /AUTO:changelog -->

---

_Last updated: 2026-07-07 · this README's inventory and changelog are auto-maintained by
`scripts/gen_readme.py` on every commit._
