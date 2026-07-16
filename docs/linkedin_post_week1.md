# LinkedIn post — Week 1 (draft)

> Honesty check before posting: every claim below maps to real code in this repo. Don't add
> a metric (%, "faster", "reduced") unless you've measured it. Swap `<demo link>` for the live
> URL only after you've set `JARVIS_DEMO_PIN` on Render and clicked "Explore the demo" yourself.

---

## Version A — the "I built infrastructure, not a toy" angle (recommended)

I kept seeing "AI projects that get you hired" checklists on my feed. So I checked mine against them — turns out I'd already built most of it without calling it that.

I'm a data analyst moving into AI engineering, and I've been building **JARVIS** — a multi-agent AI career copilot that runs my whole job search. This week I stopped treating it like a hobby project and started treating it like production software.

What's actually under the hood:

🔹 **A multi-provider LLM gateway** — every model call routes through a circuit breaker + rate limiter with automatic Groq → Gemini failover. When a provider rate-limits or goes down, it fails over instantly instead of hanging. It even exposes live metrics (circuit state, breaker trips, provider split) on a dashboard.

🔹 **~15 specialized agents** behind one AI intent classifier — job scout, résumé/ATS scoring, application tracking, email triage, calendar, content watchers — each its own module, no hardcoded trigger phrases.

🔹 **A React PWA console** you can install like a native app, with a full analytics layer (application funnel, skill-gap vs. market demand, LLM routing health).

🔹 **100% free-tier** — Groq + Gemini free models, SQLite/Turso, deployed on Render. It costs me nothing to run.

The realization: the gap between "side project" and "hireable project" often isn't more features — it's the boring production stuff. Failover. Metrics. A read-only demo mode so anyone can click through it without touching real data.

Try it yourself (sample data, nothing real): <demo link>
Architecture + code: <repo link>

Building in public — what would you want to see next?

#AIEngineering #LLM #Python #FastAPI #React #BuildInPublic #DataAnalytics

---

## Version B — shorter / punchier

"AI projects that get you hired" checklists kept showing up on my feed. So I audited my own project against them.

I'm a data analyst → AI engineer, and I've been building JARVIS: a multi-agent AI career copilot that runs my entire job search on 100% free-tier infra.

This week I added the stuff that separates a demo from a product:
→ an LLM gateway with circuit breakers, rate limiting and Groq→Gemini failover
→ live gateway metrics (breaker trips, provider split) on a dashboard
→ a one-click read-only demo mode — real data physically unreachable
→ an installable PWA console

Turns out I'd already built ~15 intent-routed agents (job scout, ATS scoring, email triage, calendar, content watchers). I just hadn't framed it as engineering.

Lesson: "hireable" is less about more features, more about failover, metrics, and letting people actually click your thing.

Live demo (sample data): <demo link>
Code: <repo link>

#AIEngineering #LLM #FastAPI #BuildInPublic

---

## Posting tips
- Post Tue–Thu morning IST for reach.
- Attach a 15–30s screen recording of the Insights → LLM gateway card + the Jobs board. Motion outperforms static.
- First comment: drop the repo link there too (LinkedIn suppresses posts with outbound links in the body — putting the link in a comment often does better).
- Reply to every comment in the first hour.
