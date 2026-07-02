---
name: deploy-engine
description: Use when committing and deploying the Daily_AI_updates WhatsApp/JARVIS engine to Render — after the user explicitly says "commit". Covers the pre-commit sanity check, what must never be committed, the commit/push sequence, and the post-deploy Render env-var and cron-job.org reminders. Do NOT run any of this until the user has said "commit".
---

# Deploy the JARVIS Engine to Render

The engine (`V3_updates.py`, FastAPI) deploys via `git push origin main` → Render auto-builds
from `main`. Follow this only when the user has explicitly authorized it.

## Gate — do not skip
- **Only proceed after the user explicitly says "commit"** (their phrase: "commit to render"). Approval for one commit does NOT carry to the next. If they haven't said it this turn, stop and ask.
- **Verify locally first.** If code changed and wasn't tested this session, test with `SAFE_MODE=1` before committing.

## Steps
1. **Sanity check the syntax** of every changed Python file:
   ```bash
   python3 -c "import ast; [ast.parse(open(f).read()) for f in ('V3_updates.py', ...)]; print('ok')"
   ```
2. **Confirm what's staged** and that no secret is included:
   ```bash
   git status -sb
   ```
   **Never commit** `.env`, `.env.save`, `agent_memory.db`, or `start_bridge.sh` (local-only helper). If any appear, exclude them / confirm they're gitignored.
3. **Commit only the intended files** (don't blanket `git add .`):
   ```bash
   git add <specific files>
   git commit -m "<type>: <summary>

   <body>

   Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
   git push origin main
   ```
4. **Confirm the push** landed (`<old>..<new>  main -> main`) and report the commit hash.

## Post-deploy reminders (tell the user)
- **Render env vars:** if the change relies on a new/changed env var (e.g. `GMAIL_REFRESH_TOKEN`, `SCHEDULER_MODE`, `SAFE_MODE` must stay UNSET in prod), the deployed service reads its OWN copy — remind the user to set it in Render → service → Environment (saving triggers a redeploy).
- **cron-job.org:** if a new `/cron/*` endpoint was added, remind the user to add the schedule (token-gated: `?token=CLAUDE_CODE_TRIGGER_SECRET`). Current jobs: `/cron/digest`, `/cron/inbox`, `/cron/checkin?n=`, `/cron/weekly`, `/cron/reminders-due`, `/cron/learn-patterns`.
- **Scheduler mode:** prod runs `SCHEDULER_MODE=external` (in-process APScheduler off; `/cron/*` fires jobs) to let the free instance sleep and save instance-hours. Don't assume in-process jobs run in prod.
- **Verify live:** `GET /health/status?token=SECRET` on `https://daily-ai-whatsapp-engine.onrender.com` — check `scheduler_mode`, `mem_status`, uptime (low uptime ⇒ it just redeployed).

## Notes
- `.claude/` is git-tracked (skills version with the repo) but excluded from Docker builds via `.dockerignore` — fine, it's not needed at runtime.
- Render free tier: 512MB RAM, 750 instance-hours/month, spins down after ~15 min idle. Keep memory and wake-ups low.
