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
    """company_news doubles as the dedup ledger (item_id PK) AND the stored signal history."""
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
