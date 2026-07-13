"""Company Watch — turns the companies on your Kanban into a live news feed.

For every company you're actively pursuing (a card whose status isn't rejected/accepted), it
polls FREE Google News RSS for hiring / funding / layoff / leadership signals, LLM-filters the
noise, dedups, and drops a JARVIS-voice briefing in the console inbox. Reuses the scraping
engine's `fetch_rss` (RSS/Atom parser) and the shared `relevance.rank_relevance` ranker — this
module is wiring, not new capability.

Slice 1a: news signals only (stored in `company_news` + notification). Slice 1b will attach
these to individual Kanban cards and generate interview-prep briefs from calendar events.
"""
import os
from urllib.parse import quote_plus
from datetime import datetime, timezone
import db_compat as aiosqlite  # Turso in prod, local file in dev — MUST match V3_updates
from influencer_agent import fetch_rss
from relevance import rank_relevance

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")

# Statuses we stop watching — the outcome is already decided.
_INACTIVE = ("rejected", "accepted")


def init_company_watch_tables():
    """company_news doubles as the dedup ledger (item_id PK) AND the stored signal history.
    interview_briefs caches one prep brief per calendar event (event_id PK = dedup)."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS company_news (
        item_id TEXT PRIMARY KEY,
        company TEXT,
        title TEXT,
        url TEXT,
        source TEXT,
        relevant INTEGER DEFAULT 1,
        why TEXT,
        published_at TEXT,
        created_at TEXT,
        app_id INTEGER,
        seen INTEGER DEFAULT 0)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS interview_briefs (
        event_id TEXT PRIMARY KEY,
        app_id INTEGER,
        company TEXT,
        title TEXT,
        brief TEXT,
        event_start TEXT,
        created_at TEXT)''')
    conn.commit()
    conn.close()
    print("✅ Company Watch tables ready.")


def _gnews_url(company: str) -> str:
    """Google News RSS for job-seeker-relevant signals about one company (free, no key)."""
    q = f'"{company}" (hiring OR "now hiring" OR careers OR layoffs OR funding OR acquisition OR raises)'
    return f"https://news.google.com/rss/search?q={quote_plus(q)}&hl=en-IN&gl=IN&ceid=IN:en"


async def get_watch_companies(db) -> list:
    """Distinct companies from active Kanban cards (not rejected/accepted), preserving one per name."""
    cur = await db.execute(
        "SELECT DISTINCT company FROM applications "
        "WHERE COALESCE(company,'') != '' AND LOWER(COALESCE(status,'')) NOT IN ('rejected','accepted')"
    )
    rows = await cur.fetchall()
    seen, out = set(), []
    for r in rows:
        c = (r[0] or "").strip()
        if c and c.lower() not in seen:
            seen.add(c.lower())
            out.append(c)
    return out


async def _fetch_fresh(db, company: str, cap: int) -> list:
    """Fetch the company's news feed and return only items not already in company_news."""
    items = await fetch_rss(_gnews_url(company))
    fresh = []
    for it in items[:cap]:
        iid = it.get("post_id")
        if not iid:
            continue
        cur = await db.execute("SELECT 1 FROM company_news WHERE item_id = ?", (iid,))
        if await cur.fetchone():
            continue
        fresh.append(it)
    return fresh


async def run_company_watch(call_llm_fn, per_company: int = 8) -> str:
    """Poll every active company, LLM-filter fresh signals, store them, and post a briefing.
    Returns the digest text (also saved to the notifications inbox)."""
    init_company_watch_tables()
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        companies = await get_watch_companies(db)
    if not companies:
        return "No active companies to watch — track some applications first."

    print(f"🔭 Company Watch scanning {len(companies)} companies...")
    kept = []  # (company, title, url, why)
    for company in companies:
        async with aiosqlite.connect(DB_PATH) as db:
            fresh = await _fetch_fresh(db, company, per_company)
            if not fresh:
                continue
            interests = (
                f"news that matters to someone who applied to {company}: NEW job openings / hiring, "
                f"funding or fundraising, layoffs, acquisitions, and leadership or major product changes "
                f"AT {company}. Drop generic listicles, unrelated companies, and stale/rehashed items."
            )
            verdicts = await rank_relevance(call_llm_fn, [{"text": it["text"]} for it in fresh], interests)
            for it, v in zip(fresh, verdicts):
                rel = 1 if v.get("relevant", True) else 0
                await db.execute(
                    "INSERT OR IGNORE INTO company_news "
                    "(item_id, company, title, url, relevant, why, published_at, created_at) "
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (it["post_id"], company, it["text"], it.get("url", ""), rel,
                     v.get("note", ""), it.get("published_at", ""), now),
                )
                if rel:
                    kept.append((company, it["text"], it.get("url", ""), v.get("note", "")))
            await db.commit()

    if not kept:
        return "Scanned your companies — nothing new worth flagging."

    listing = "\n".join(f"- {c}: {t}" + (f" ({w})" if w else "") for c, t, _u, w in kept[:20])
    system = (
        "You are JARVIS. These are fresh news signals about companies Madan has applied to. Write a "
        "crisp, dryly witty briefing — group by company, one line each, and note why it matters to a "
        "job-seeker (a hiring wave = apply now; layoffs = tread carefully; funding = expansion soon). "
        "No hashtags, no links, 2-4 sentences per company max."
    )
    try:
        digest = await call_llm_fn(system, listing)
    except Exception:
        digest = "Company signals:\n" + listing

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO notifications (body, category) VALUES (?, 'company_watch')",
            (digest.strip(),),
        )
        await db.commit()
    print(f"✅ Company Watch: {len(kept)} signal(s) flagged across {len(companies)} companies.")
    return digest


async def list_company_news(company: str = None, limit: int = 50) -> list:
    """Relevant stored signals, newest first — optionally for one company (for card attachment in 1b)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        if company:
            cur = await db.execute(
                "SELECT * FROM company_news WHERE company = ? AND relevant = 1 "
                "ORDER BY created_at DESC, rowid DESC LIMIT ?", (company, limit))
        else:
            cur = await db.execute(
                "SELECT * FROM company_news WHERE relevant = 1 "
                "ORDER BY created_at DESC, rowid DESC LIMIT ?", (limit,))
        return [dict(r) for r in await cur.fetchall()]


async def news_counts_by_company() -> dict:
    """{normalized company -> relevant-signal count} — cheap enrichment for the Kanban board."""
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT company, COUNT(*) FROM company_news WHERE relevant = 1 GROUP BY company")
        return {(r[0] or "").strip().lower(): int(r[1]) for r in await cur.fetchall()}


# ─────────────────────────── interview prep (Part B) ───────────────────────────

def _match_event_to_app(ev: dict, apps: list):
    """Best-effort: does this calendar event look like an interview with a tracked company?
    Matches the company name in the event title or an attendee's email domain."""
    summary = (ev.get("summary") or "").lower()
    domains = [e.split("@")[-1].lower() for e in (ev.get("attendees") or []) if "@" in e]
    for a in apps:
        company = (a.get("company") or "").strip().lower()
        if not company:
            continue
        token = company.split()[0]  # first word, e.g. "google" from "Google India"
        if len(token) < 3:
            token = company
        if company in summary or token in summary:
            return a
        if any(token in d for d in domains):
            return a
    return None


async def _active_apps(db) -> list:
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
        "SELECT id, title, company, description, job_key, status FROM applications "
        "WHERE LOWER(COALESCE(status,'')) NOT IN ('rejected','accepted')")
    return [dict(r) for r in await cur.fetchall()]


async def get_interview_brief(app_id: int):
    """Most recent stored brief for a card (surfaced in the ⋯ menu / Prep view)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM interview_briefs WHERE app_id = ? ORDER BY created_at DESC LIMIT 1", (app_id,))
        row = await cur.fetchone()
        return dict(row) if row else None


async def run_interview_prep(call_llm_fn) -> str:
    """Scan upcoming calendar events; for any that match a tracked company, assemble a prep brief
    from the role JD + recent company news + résumé-fit gaps. One brief per event (event_id dedup)."""
    init_company_watch_tables()
    try:
        from calendar_agent import list_upcoming_events
        events = await list_upcoming_events(max_results=15)
    except Exception as e:
        print(f"⚠️ interview prep: calendar unavailable ({e})")
        return "Calendar unavailable — skipped interview prep."
    if not events:
        return "No upcoming calendar events."

    try:
        from resume_ats_agent import get_scores_map
    except Exception:
        get_scores_map = None

    now = datetime.now(timezone.utc).isoformat()
    prepared = []
    async with aiosqlite.connect(DB_PATH) as db:
        apps = await _active_apps(db)
        if not apps:
            return "No active applications to match against upcoming events."
        for ev in events:
            eid = ev.get("id")
            if not eid:
                continue
            cur = await db.execute("SELECT 1 FROM interview_briefs WHERE event_id = ?", (eid,))
            if await cur.fetchone():
                continue  # already briefed
            app = _match_event_to_app(ev, apps)
            if not app:
                continue

            news = await list_company_news(app["company"], limit=5)
            news_block = "\n".join(f"- {n['title']}" + (f" ({n['why']})" if n.get("why") else "") for n in news) or "(no recent news)"
            ats_line = ""
            if get_scores_map:
                try:
                    smap = await get_scores_map([app.get("job_key") or f"app:{app['id']}"])
                    s = smap.get(app.get("job_key") or f"app:{app['id']}")
                    if s:
                        ats_line = f"Résumé ATS match for this role: {s.get('ats_score')}/100."
                except Exception:
                    pass

            context = (
                f"Role: {app.get('title')} at {app.get('company')}\n"
                f"Interview event: {ev.get('summary')} (starts {ev.get('start')})\n"
                f"{ats_line}\n\n"
                f"Role description:\n{(app.get('description') or '(none on file)')[:1500]}\n\n"
                f"Recent company news:\n{news_block}"
            )
            system = (
                f"You are JARVIS, prepping Madan for an interview at {app.get('company')} for the "
                f"{app.get('title')} role. From the role description, recent company news, and his "
                "résumé-fit, write a TIGHT prep brief: 3 likely focus areas, 2 sharp questions he "
                "should ask, and 1 gap to shore up beforehand. Composed, specific, no filler."
            )
            try:
                brief = await call_llm_fn(system, context)
            except Exception as e:
                print(f"⚠️ interview brief LLM failed for {app.get('company')}: {e}")
                continue

            await db.execute(
                "INSERT OR IGNORE INTO interview_briefs (event_id, app_id, company, title, brief, event_start, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?)",
                (eid, app["id"], app["company"], app.get("title"), brief.strip(), ev.get("start"), now))
            await db.execute(
                "INSERT INTO notifications (body, category) VALUES (?, 'interview_prep')",
                (f"🎯 Interview prep — {app.get('title')} @ {app.get('company')}\n\n{brief.strip()}",))
            prepared.append(f"{app.get('title')} @ {app.get('company')}")
        await db.commit()

    if not prepared:
        return "No upcoming events matched a tracked company."
    print(f"✅ Interview prep: {len(prepared)} brief(s) prepared.")
    return "Prepared briefs for: " + "; ".join(prepared)


async def run_company_watch_and_prep(call_llm_fn) -> str:
    """Combined daily job: company news scan + interview-prep briefs (fired from /cron/company-watch)."""
    news = await run_company_watch(call_llm_fn)
    prep = await run_interview_prep(call_llm_fn)
    return f"{news}\n\n{prep}"
