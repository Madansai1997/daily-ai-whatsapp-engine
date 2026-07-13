"""People Watch — turns a Networking CRM contact into a watchable feed.

Recruiters, hiring managers and thought-leaders often publish on free channels (Substack,
Medium, blogs, YouTube, podcasts). When a watched contact publishes something, we surface it
as a networking NUDGE ("X just posted Y — good moment to reach out"). Reuses the scraping
engine's fetchers + the shared relevance ranker; posts are stored in influencer_posts tagged
with contact_id, so they stay OUT of the creator feed and only appear as nudges.

HONEST LIMIT: no LinkedIn/X/Instagram (paid/blocked), so only people who publish on RSS or
YouTube are watchable — set that expectation in the UI.
"""
import os
from datetime import datetime, timezone
import db_compat as aiosqlite  # Turso in prod, local in dev — MUST match V3_updates
from influencer_agent import fetch_rss, fetch_youtube_videos, resolve_youtube_channel_id, store_new_posts
from relevance import rank_relevance

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")

# What counts as a networking-worthy post — filters obvious noise, keeps substantive updates.
_PEOPLE_INTERESTS = (
    "a professional update worth mentioning in a warm outreach message — a new article, talk, "
    "podcast, launch, job move, milestone, or strong take. Drop pure promo, giveaways, and filler."
)


def init_people_watch_tables():
    """contact_feeds links a CRM contact to one or more free feeds. Posts live in influencer_posts
    (tagged with contact_id via the shared store)."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS contact_feeds (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        contact_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        name TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT,
        UNIQUE(contact_id, platform, handle))''')
    # People-Watch posts live in influencer_posts tagged with contact_id — ensure the column exists
    # even if this agent runs before/without V3's init_db.
    cur.execute('''CREATE TABLE IF NOT EXISTS influencer_posts (
        post_id TEXT PRIMARY KEY, platform TEXT, handle TEXT, name TEXT, title TEXT, summary TEXT,
        url TEXT, relevant INTEGER DEFAULT 1, relevance_note TEXT, is_read INTEGER DEFAULT 0,
        published_at TEXT, domain TEXT DEFAULT '', contact_id INTEGER,
        seen_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    try:
        cur.execute("ALTER TABLE influencer_posts ADD COLUMN contact_id INTEGER")
    except Exception:
        pass
    conn.commit()
    conn.close()
    print("✅ People Watch tables ready.")


async def list_contact_feeds(contact_id: int) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM contact_feeds WHERE contact_id = ? ORDER BY created_at DESC", (contact_id,))
        return [dict(r) for r in await cur.fetchall()]


async def add_contact_feed(contact_id: int, platform: str, handle: str, name: str = "") -> dict:
    """Register a feed for a contact. Resolves YouTube handles; validates the feed returns items."""
    platform = (platform or "").strip().lower()
    handle = (handle or "").strip()
    if platform not in ("rss", "youtube"):
        return {"ok": False, "result": "Only RSS and YouTube feeds are supported (no LinkedIn/X)."}
    if not handle:
        return {"ok": False, "result": "Feed URL or channel is required."}

    if platform == "youtube":
        handle = await resolve_youtube_channel_id(handle)
        probe = await fetch_youtube_videos(handle, "all")
    else:
        probe = await fetch_rss(handle)
    if not probe:
        return {"ok": False, "result": "Couldn't read that feed — check the URL/handle."}

    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO contact_feeds (contact_id, platform, handle, name, created_at) VALUES (?, ?, ?, ?, ?)",
                (contact_id, platform, handle, name or handle, now))
            await db.commit()
        except aiosqlite.IntegrityError:
            return {"ok": False, "result": "That feed is already registered for this contact."}
    return {"ok": True, "result": f"Watching {name or handle} ({platform})"}


async def delete_contact_feed(feed_id: int) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM contact_feeds WHERE id = ?", (feed_id,))
        await db.commit()
    return {"ok": True}


async def _active_feeds(db) -> list:
    db.row_factory = aiosqlite.Row
    cur = await db.execute(
        "SELECT cf.*, c.name AS contact_name FROM contact_feeds cf "
        "JOIN contacts c ON c.id = cf.contact_id WHERE cf.active = 1")
    return [dict(r) for r in await cur.fetchall()]


async def run_people_watch(call_llm_fn) -> str:
    """Scrape every active contact feed, store new posts (tagged with contact_id), rank for
    substance, and drop a nudge notification for the relevant ones."""
    init_people_watch_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        feeds = await _active_feeds(db)
    if not feeds:
        return "No contact feeds to watch — add one from a contact card."

    print(f"👥 People Watch scanning {len(feeds)} contact feed(s)...")
    nudges = []  # (contact_name, title, url, note)
    for f in feeds:
        platform, handle = f["platform"], f["handle"]
        cname = f.get("contact_name") or f.get("name") or handle
        posts = await fetch_youtube_videos(handle, "all") if platform == "youtube" else await fetch_rss(handle)
        if not posts:
            continue
        async with aiosqlite.connect(DB_PATH) as db:
            new = await store_new_posts(db, platform, handle, cname, posts, contact_id=f["contact_id"])
            if not new:
                await db.commit()
                continue
            verdicts = await rank_relevance(call_llm_fn, [{"text": p["text"]} for p in new], _PEOPLE_INTERESTS)
            for p, v in zip(new, verdicts):
                rel = 1 if v.get("relevant", True) else 0
                await db.execute(
                    "UPDATE influencer_posts SET relevant = ?, relevance_note = ? WHERE post_id = ?",
                    (rel, v.get("note", ""), p["post_id"]))
                if rel:
                    nudges.append((cname, p["text"], p.get("url", ""), v.get("note", ""), f["contact_id"]))
            await db.commit()

    if not nudges:
        return "Scanned your contacts — nothing new worth a nudge."

    for cname, title, _url, _note, _cid in nudges[:20]:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO notifications (body, category) VALUES (?, 'people_watch')",
                (f"👋 {cname} just posted: \"{title[:120]}\" — good moment to reach out.",))
            await db.commit()
    print(f"✅ People Watch: {len(nudges)} nudge(s) across {len(feeds)} feed(s).")
    return f"{len(nudges)} new nudge(s) from your network."


async def get_nudges(limit: int = 40) -> list:
    """Relevant, unread posts from watched contacts, joined to the contact — the CRM nudge strip."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT p.post_id, p.title, p.url, p.platform, p.relevance_note, p.seen_at, "
            "p.contact_id, c.name AS contact_name, c.company AS contact_company "
            "FROM influencer_posts p JOIN contacts c ON c.id = p.contact_id "
            "WHERE p.contact_id IS NOT NULL AND p.relevant = 1 AND p.is_read = 0 "
            "ORDER BY p.seen_at DESC, p.rowid DESC LIMIT ?", (limit,))
        return [dict(r) for r in await cur.fetchall()]


async def dismiss_nudge(post_id: str) -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE influencer_posts SET is_read = 1 WHERE post_id = ?", (post_id,))
        await db.commit()
    return {"ok": True}
