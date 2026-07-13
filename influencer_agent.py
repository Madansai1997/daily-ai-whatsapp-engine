import os
import re
import xml.etree.ElementTree as ET
import httpx
import db_compat as aiosqlite  # routes to Turso in prod, local file in dev — MUST match V3_updates
from datetime import datetime, timezone
import json

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")
RAPIDAPI_KEY = os.environ.get("RAPIDAPI_KEY", "")

# We only extract and summarize text metadata (captions, tweets, titles, RSS titles) to keep
# database storage footprint and prompt token costs to a minimum. Media payloads are ignored.

# What Madan actually cares about — used to rank/filter noisy feeds down to signal (free, one
# batched LLM call per digest). Keep this aligned with the Daily AI / job-scout themes.
INTERESTS = (
    "AI / machine learning, LLMs and generative AI, data analytics & data engineering, "
    "the tech industry, career growth for a data analyst, and genuinely useful new tools or launches"
)


async def _ensure_tables(db):
    """Create the persistent feed table if it's missing (idempotent; also lives in V3 init_db)."""
    await db.execute('''CREATE TABLE IF NOT EXISTS influencer_posts (
        post_id TEXT PRIMARY KEY,
        platform TEXT,
        handle TEXT,
        name TEXT,
        title TEXT,
        summary TEXT,
        url TEXT,
        relevant INTEGER DEFAULT 1,
        relevance_note TEXT,
        is_read INTEGER DEFAULT 0,
        published_at TEXT,
        domain TEXT DEFAULT '',
        seen_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    try:
        await db.execute("ALTER TABLE influencer_posts ADD COLUMN domain TEXT DEFAULT ''")
    except Exception:
        pass


async def fetch_instagram_posts(handle: str) -> list:
    """Fetch recent Instagram posts text captions using RapidAPI (needs RAPIDAPI_KEY)."""
    if not RAPIDAPI_KEY:
        print("⚠️ RAPIDAPI_KEY not set. Skipping Instagram scrape.")
        return []

    url = "https://instagram-scraper-api2.p.rapidapi.com/v1/user_posts"
    headers = {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "instagram-scraper-api2.p.rapidapi.com"
    }
    params = {"username_or_id_or_url": handle}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code != 200:
                print(f"⚠️ Instagram API failed for {handle}: {response.status_code}")
                return []

            data = response.json()
            posts = []
            items = data.get("data", {}).get("items", []) or data.get("items", []) or []
            for item in items:
                post_id = item.get("id") or item.get("code")
                caption = item.get("caption_text") or item.get("caption", {}).get("text", "")
                if post_id:
                    posts.append({
                        "post_id": str(post_id),
                        "text": caption.strip(),
                        "url": f"https://instagram.com/p/{item.get('code', '')}",
                        "published_at": "",
                    })
            return posts
    except Exception as e:
        print(f"⚠️ Error scraping Instagram for {handle}: {e}")
        return []


async def fetch_twitter_tweets(handle: str) -> list:
    """Fetch recent tweets text using RapidAPI (needs RAPIDAPI_KEY)."""
    if not RAPIDAPI_KEY:
        print("⚠️ RAPIDAPI_KEY not set. Skipping Twitter/X scrape.")
        return []

    url = "https://twitter-api45.p.rapidapi.com/user_tweets"
    headers = {
        "X-RapidAPI-Key": RAPIDAPI_KEY,
        "X-RapidAPI-Host": "twitter-api45.p.rapidapi.com"
    }
    params = {"username": handle}

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url, headers=headers, params=params)
            if response.status_code != 200:
                print(f"⚠️ Twitter API failed for {handle}: {response.status_code}")
                return []

            data = response.json()
            tweets = []
            items = data.get("tweets", []) or data.get("timeline", []) or []
            for item in items:
                tweet_id = item.get("tweet_id") or item.get("id")
                text = item.get("text") or item.get("full_text", "")
                if tweet_id and text:
                    tweets.append({
                        "post_id": str(tweet_id),
                        "text": text.strip(),
                        "url": f"https://x.com/{handle}/status/{tweet_id}",
                        "published_at": "",
                    })
            return tweets
    except Exception as e:
        print(f"⚠️ Error scraping Twitter for {handle}: {e}")
        return []


async def fetch_youtube_videos(channel_id: str, content_filter: str = "all") -> list:
    """Fetch recent YouTube uploads via the public RSS feed (free, no API key).

    content_filter: 'videos' (skip Shorts), 'shorts' (only Shorts), or 'all' (both).
    The feed's <link href> distinguishes them — Shorts use /shorts/<id>, long-form uses /watch?v=."""
    content_filter = (content_filter or "all").lower()
    url = f"https://www.youtube.com/feeds/videos.xml?channel_id={channel_id}"
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.get(url)
            if response.status_code != 200:
                print(f"⚠️ YouTube RSS failed for {channel_id}: {response.status_code}")
                return []

            root = ET.fromstring(response.content)
            ns = {"atom": "http://www.w3.org/2005/Atom"}

            videos = []
            for entry in root.findall("atom:entry", ns):
                video_id = entry.find("atom:id", ns)
                title = entry.find("atom:title", ns)
                link = entry.find("atom:link", ns)
                published = entry.find("atom:published", ns)

                vid_id = video_id.text if video_id is not None else None
                vid_title = title.text if title is not None else ""
                vid_url = link.attrib.get("href", "") if link is not None else ""
                vid_pub = published.text if published is not None else ""

                is_short = "/shorts/" in vid_url
                if content_filter == "videos" and is_short:
                    continue
                if content_filter == "shorts" and not is_short:
                    continue

                if vid_id:
                    videos.append({
                        "post_id": str(vid_id),
                        "text": vid_title.strip(),
                        "url": vid_url,
                        "published_at": vid_pub,
                    })
            return videos
    except Exception as e:
        print(f"⚠️ Error parsing YouTube RSS for {channel_id}: {e}")
        return []


async def fetch_rss(feed_url: str) -> list:
    """Fetch recent items from ANY RSS 2.0 or Atom feed — free, no API key.
    Works for Substack, Medium, most blogs, Reddit (add .rss), arXiv author feeds, etc."""
    if not feed_url:
        return []
    try:
        async with httpx.AsyncClient(timeout=15.0, follow_redirects=True) as client:
            headers = {"User-Agent": "Mozilla/5.0 (compatible; JARVIS-Watcher/1.0)"}
            response = await client.get(feed_url, headers=headers)
            if response.status_code != 200:
                print(f"⚠️ RSS fetch failed for {feed_url}: {response.status_code}")
                return []

            root = ET.fromstring(response.content)
            posts = []

            # RSS 2.0: <channel><item>...
            items = root.findall(".//item")
            if items:
                for it in items[:15]:
                    guid = it.findtext("guid") or it.findtext("link") or ""
                    title = (it.findtext("title") or "").strip()
                    link = (it.findtext("link") or "").strip()
                    pub = (it.findtext("pubDate") or "").strip()
                    pid = (guid or link).strip()
                    if pid and title:
                        posts.append({"post_id": pid, "text": title, "url": link or pid, "published_at": pub})
                return posts

            # Atom: <feed><entry>...
            ns = {"a": "http://www.w3.org/2005/Atom"}
            for e in root.findall(".//a:entry", ns):
                pid = (e.findtext("a:id", "", ns) or "").strip()
                title = (e.findtext("a:title", "", ns) or "").strip()
                link_el = e.find("a:link", ns)
                link = link_el.attrib.get("href", "") if link_el is not None else ""
                pub = (e.findtext("a:published", "", ns) or e.findtext("a:updated", "", ns) or "").strip()
                pid = pid or link
                if pid and title:
                    posts.append({"post_id": pid, "text": title, "url": link or pid, "published_at": pub})
            return posts[:15]
    except Exception as e:
        print(f"⚠️ Error parsing RSS for {feed_url}: {e}")
        return []


async def _scrape(platform: str, handle: str, yt_content: str = "all") -> list:
    """Dispatch to the right source for a platform. Returns raw posts (may be empty)."""
    platform = (platform or "").lower()
    if platform == "instagram":
        return await fetch_instagram_posts(handle)
    if platform in ("twitter", "x"):
        return await fetch_twitter_tweets(handle)
    if platform == "youtube":
        return await fetch_youtube_videos(handle, yt_content)
    if platform == "rss":
        return await fetch_rss(handle)
    return []


async def store_new_posts(db, platform: str, handle: str, name: str, posts: list, domain: str = "") -> list:
    """Insert posts that haven't been seen before into influencer_posts; return only the new ones.
    influencer_posts (post_id PK) doubles as the dedup ledger AND the persistent feed."""
    new_posts = []
    for post in posts:
        post_id = post["post_id"]
        cursor = await db.execute("SELECT 1 FROM influencer_posts WHERE post_id = ?", (post_id,))
        row = await cursor.fetchone()
        if row:
            continue
        await db.execute(
            "INSERT INTO influencer_posts (post_id, platform, handle, name, title, url, published_at, domain) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (post_id, platform, handle, name, post.get("text", ""), post.get("url", ""), post.get("published_at", ""), domain or ""),
        )
        new_posts.append({**post, "name": name, "platform": platform})
    return new_posts


# Back-compat alias: older callers (watch_influencer.py) imported filter_new_posts.
async def filter_new_posts(db, platform: str, handle: str, posts: list) -> list:
    await _ensure_tables(db)
    return await store_new_posts(db, platform, handle, "", posts)


def _extract_json_array(text: str):
    """Pull the first JSON array out of an LLM response, tolerating fenced/verbose output."""
    if not text:
        return None
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except Exception:
        return None


async def rank_relevance(call_llm_fn, posts: list) -> list:
    """One batched LLM call: for each post decide relevance to Madan's interests + a 1-line why.
    Returns a list aligned to `posts` of {relevant: bool, note: str}. Fails open (all relevant)."""
    if not posts:
        return []
    listing = ""
    for i, p in enumerate(posts):
        listing += f"{i}. [{p.get('platform','')}] {p.get('name','')}: {p.get('text','')[:220]}\n"

    system = (
        "You curate a feed for Madan. His interests: " + INTERESTS + ". "
        "Judge each item by its SUBJECT/TOPIC ONLY — ignore clickbait wording, hype, emojis and "
        "promotional tone. A hyped or sensational title about AI, LLMs, data, tech or career is "
        "STILL relevant and should be kept. Drop an item ONLY if its subject is clearly unrelated "
        "to his interests (e.g. cooking, sports, pure unrelated giveaways). When unsure, KEEP it. "
        "Reply with ONLY a JSON array, one object per item IN THE SAME ORDER, shaped "
        "{\"i\": <index>, \"keep\": true|false, \"why\": \"<max 10 words naming the topic, or empty>\"}."
    )
    try:
        raw = await call_llm_fn(system, listing)
        arr = _extract_json_array(raw)
        if not arr:
            raise ValueError("no json")
        out = [{"relevant": True, "note": ""} for _ in posts]
        for obj in arr:
            idx = obj.get("i")
            if isinstance(idx, int) and 0 <= idx < len(posts):
                out[idx] = {"relevant": bool(obj.get("keep", True)), "note": (obj.get("why") or "").strip()}
        return out
    except Exception as e:
        print(f"⚠️ Relevance ranking failed, keeping all: {e}")
        return [{"relevant": True, "note": ""} for _ in posts]


async def _apply_relevance(db, new_posts: list, call_llm_fn) -> list:
    """Rank new posts and write relevant/relevance_note back to their rows. Returns kept posts."""
    verdicts = await rank_relevance(call_llm_fn, new_posts)
    kept = []
    for post, v in zip(new_posts, verdicts):
        rel = 1 if v.get("relevant", True) else 0
        note = v.get("note", "")
        await db.execute(
            "UPDATE influencer_posts SET relevant = ?, relevance_note = ? WHERE post_id = ?",
            (rel, note, post["post_id"]),
        )
        if rel:
            kept.append({**post, "note": note})
    return kept


async def get_watched_influencers() -> list:
    """Retrieve the list of watched influencers from the database."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT id, handle, platform, name, COALESCE(yt_content, 'all') AS yt_content, "
            "COALESCE(domain, '') AS domain, added_at FROM watched_influencers"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def run_influencer_watcher_digest(call_llm_fn) -> str:
    """Daily: scrape every watched profile, dedup, rank for relevance, compile a witty digest."""
    influencers = await get_watched_influencers()
    if not influencers:
        print("ℹ️ No watched influencers registered.")
        return "No watched influencers registered."

    print(f"🔄 Starting influencer digest run for {len(influencers)} monitored profiles...")
    collected = []

    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_tables(db)
        for influencer in influencers:
            handle = influencer["handle"]
            platform = influencer["platform"].lower()
            name = influencer["name"] or handle

            print(f"🔍 Scraping {name} on {platform}...")
            raw_posts = await _scrape(platform, handle, influencer.get("yt_content", "all"))
            new_posts = await store_new_posts(db, platform, handle, name, raw_posts, influencer.get("domain", ""))
            if new_posts:
                print(f"✨ Found {len(new_posts)} new posts for {name}.")
                collected.extend(new_posts)
            else:
                print(f"✓ No new updates found for {name}.")

        if not collected:
            await db.commit()
            print("ℹ️ No new updates from any monitored profiles.")
            return "No new updates from monitored profiles."

        kept = await _apply_relevance(db, collected, call_llm_fn)
        await db.commit()

    if not kept:
        print("ℹ️ New posts found, but none passed the relevance filter.")
        return "New posts found, but none were relevant to your interests."

    prompt_content = ""
    for idx, upd in enumerate(kept, 1):
        prompt_content += (
            f"{idx}. {upd['name']} ({upd['platform']}): {upd['text']}\n   Link: {upd['url']}\n\n"
        )

    system_prompt = (
        "You are JARVIS, Madan's movie-grade AI assistant. Review the day's relevant updates from his "
        "monitored feeds. Write a concise, dryly witty digest — one sharp sentence per item, grouped "
        "sensibly. No hashtags, no link dumps, no boilerplate."
    )
    print("🤖 Generating summary digest with LLM...")
    digest = await call_llm_fn(system_prompt, f"UPDATES:\n{prompt_content}")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO notifications (body, category) VALUES (?, 'influencer')",
            (digest.strip(),),
        )
        await db.commit()

    print("✅ Influencer digest compiled and saved to inbox.")
    return digest


async def resolve_youtube_channel_id(handle: str) -> str:
    """Resolve a YouTube handle (e.g. @mkbhd) to its channel ID starting with UC."""
    handle = handle.strip()
    if handle.startswith("UC") and len(handle) >= 20:
        return handle

    url_handle = handle if handle.startswith("@") else f"@{handle}"
    url = f"https://www.youtube.com/{url_handle}"

    try:
        async with httpx.AsyncClient(timeout=10.0, follow_redirects=True) as client:
            headers = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
            response = await client.get(url, headers=headers)
            if response.status_code != 200:
                print(f"⚠️ YouTube handle resolution HTTP error: {response.status_code}")
                return handle

            html = response.text
            for pat in (
                r'<meta itemprop="channelId" content="(UC[a-zA-Z0-9_-]+)"',
                r'"externalId"\s*:\s*"(UC[a-zA-Z0-9_-]+)"',
                r'data-channel-external-id="(UC[a-zA-Z0-9_-]+)"',
            ):
                match = re.search(pat, html)
                if match:
                    resolved_id = match.group(1)
                    print(f"💡 Resolved YouTube handle {handle} -> Channel ID: {resolved_id}")
                    return resolved_id

            print(f"⚠️ Could not find channelId meta tag for handle {handle}")
            return handle
    except Exception as e:
        print(f"⚠️ Error resolving YouTube handle {handle}: {e}")
        return handle


async def run_single_influencer_sync(inf_id: int, call_llm_fn) -> str:
    """Scrape + dedup + rank + summarize a single influencer profile on demand."""
    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_tables(db)
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT handle, platform, name, COALESCE(yt_content, 'all') AS yt_content, "
            "COALESCE(domain, '') AS domain FROM watched_influencers WHERE id = ?", (inf_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return "Influencer not found."

        influencer = dict(row)
        handle = influencer["handle"]
        platform = influencer["platform"].lower()
        name = influencer["name"] or handle

        print(f"🔍 Scraping single profile: {name} on {platform}...")
        raw_posts = await _scrape(platform, handle, influencer.get("yt_content", "all"))
        new_posts = await store_new_posts(db, platform, handle, name, raw_posts, influencer.get("domain", ""))
        kept = await _apply_relevance(db, new_posts, call_llm_fn) if new_posts else []
        await db.commit()

    if not new_posts:
        # Nothing new — but re-rank recent stored posts so a re-sync heals stale/over-aggressive
        # verdicts (e.g. after a filter recalibration). Bounded, on-demand, user-triggered.
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(
                "SELECT post_id, platform, name, title FROM influencer_posts WHERE handle = ? "
                "ORDER BY seen_at DESC, rowid DESC LIMIT 15",
                (handle,),
            )
            rows = [dict(r) for r in await cur.fetchall()]
            if not rows:
                return f"No new updates found for {name} ({platform})."
            reposts = [{"post_id": r["post_id"], "platform": r["platform"], "name": r["name"], "text": r["title"]} for r in rows]
            verdicts = await rank_relevance(call_llm_fn, reposts)
            relevant_now = 0
            for r, v in zip(reposts, verdicts):
                rel = 1 if v.get("relevant", True) else 0
                await db.execute(
                    "UPDATE influencer_posts SET relevant = ?, relevance_note = ? WHERE post_id = ?",
                    (rel, v.get("note", ""), r["post_id"]),
                )
                relevant_now += rel
            await db.commit()
        return f"No new posts for {name} — re-checked {len(rows)} recent, {relevant_now} relevant to your interests."
    if not kept:
        return f"Found {len(new_posts)} new post(s) for {name}, but none were relevant to your interests."

    prompt_content = ""
    for idx, post in enumerate(kept, 1):
        prompt_content += f"{idx}. {post['text']}\n   Link: {post['url']}\n\n"

    system_prompt = (
        f"You are JARVIS, Madan's AI assistant. Review the latest relevant updates from {name} on {platform}. "
        "Create a concise, witty summary in 1-2 sharp sentences. No hashtags or link dumps."
    )
    digest = await call_llm_fn(system_prompt, f"UPDATES:\n{prompt_content}")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO notifications (body, category) VALUES (?, 'influencer')",
            (f"**Sync for {name} ({platform.upper()})**:\n{digest.strip()}",),
        )
        await db.commit()

    return digest


# ─────────────────────────── feed read model (console) ───────────────────────────

async def get_feed(limit: int = 60, only_relevant: bool = True, domain: str = "") -> list:
    """Persistent post history for the console feed view, newest first. Optional domain filter."""
    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_tables(db)
        db.row_factory = aiosqlite.Row
        clauses, params = [], []
        if only_relevant:
            clauses.append("relevant = 1")
        if domain:
            clauses.append("domain = ?")
            params.append(domain)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        params.append(limit)
        cursor = await db.execute(
            f"SELECT post_id, platform, handle, name, title, url, relevant, relevance_note, "
            f"is_read, published_at, COALESCE(domain,'') AS domain, seen_at FROM influencer_posts {where} "
            f"ORDER BY seen_at DESC, rowid DESC LIMIT ?",
            tuple(params),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def get_unread_count() -> int:
    """Relevant, unread posts — drives the nav badge."""
    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_tables(db)
        cursor = await db.execute("SELECT COUNT(*) FROM influencer_posts WHERE is_read = 0 AND relevant = 1")
        row = await cursor.fetchone()
        return int(row[0]) if row else 0


async def mark_feed_read(post_ids=None) -> int:
    """Mark specific post_ids read, or all relevant posts if None. Returns rows affected best-effort."""
    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_tables(db)
        if post_ids:
            n = 0
            for pid in post_ids:
                await db.execute("UPDATE influencer_posts SET is_read = 1 WHERE post_id = ?", (pid,))
                n += 1
            await db.commit()
            return n
        await db.execute("UPDATE influencer_posts SET is_read = 1 WHERE relevant = 1")
        await db.commit()
        return -1


async def get_recent_for_daily(limit: int = 5) -> list:
    """Top relevant, recent, unread posts for the Home newspaper / daily digest fold-in."""
    async with aiosqlite.connect(DB_PATH) as db:
        await _ensure_tables(db)
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT name, platform, title, url, relevance_note FROM influencer_posts "
            "WHERE relevant = 1 AND is_read = 0 ORDER BY seen_at DESC, rowid DESC LIMIT ?",
            (limit,),
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


# ─────────────────────────── domains + creator discovery ───────────────────────────

async def get_domains() -> list:
    """Distinct domains currently in use, each with its watched-creator count."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cursor = await db.execute(
            "SELECT COALESCE(domain,'') AS domain, COUNT(*) AS n FROM watched_influencers "
            "WHERE COALESCE(domain,'') != '' GROUP BY domain ORDER BY domain"
        )
        rows = await cursor.fetchall()
        return [dict(r) for r in rows]


async def _existing_handles() -> set:
    """Channel IDs / handles already watched, so discovery doesn't re-suggest them."""
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("SELECT handle FROM watched_influencers")
        rows = await cursor.fetchall()
        return {(r[0] or "").strip().lower() for r in rows}


async def _validate_candidate(cand: dict) -> dict | None:
    """Resolve a suggested @handle to a real channel ID and confirm its RSS returns videos.
    Drops hallucinated / dead / non-YouTube suggestions. Returns an enriched candidate or None."""
    handle = (cand.get("handle") or "").strip()
    name = (cand.get("name") or handle).strip()
    why = (cand.get("why") or "").strip()
    if not handle:
        return None
    channel_id = await resolve_youtube_channel_id(handle)
    if not (channel_id.startswith("UC") and len(channel_id) >= 20):
        return None  # couldn't resolve to a real channel
    posts = await fetch_youtube_videos(channel_id, "all")
    if not posts:
        return None  # channel exists but feed is empty/unreachable
    return {"name": name, "handle": channel_id, "display_handle": handle, "why": why, "recent": posts[0]["text"][:80]}


DISCOVERY_MODE = os.environ.get("INFLUENCER_DISCOVERY_MODE", "llm")  # 'llm' now; 'youtube_api' hook later


async def _discover_via_llm(domain: str, call_llm_fn, limit: int) -> list:
    system = (
        "You are a YouTube expert curating creators by niche. For the domain given, list the best, "
        "most active, currently-popular YouTube channels a serious learner should follow. "
        "Reply with ONLY a JSON array of objects shaped "
        "{\"name\": \"<channel name>\", \"handle\": \"<exact @handle from youtube.com/@handle>\", "
        "\"why\": \"<max 12 words>\"}. The handle MUST be the real @handle used in the channel URL. "
        "If you are not confident of the exact handle, omit that creator rather than guessing."
    )
    raw = await call_llm_fn(system, f"Domain: {domain}\nList up to {limit} channels.")
    arr = _extract_json_array(raw) or []
    return arr[: limit + 5]  # a few extra to survive validation drops


async def discover_creators_for_domain(domain: str, call_llm_fn, limit: int = 15) -> dict:
    """Suggest ~`limit` real, working YouTube channels for a domain (LLM-curated + validated).
    Returns {"domain", "candidates": [...]} — candidates are review-ready, none are added yet."""
    import asyncio
    domain = (domain or "").strip()
    if not domain:
        return {"domain": "", "candidates": []}

    if DISCOVERY_MODE == "youtube_api":
        # Hook for later: subscriber-ranked results via the YouTube Data API (needs a key).
        suggestions = await _discover_via_youtube_api(domain, limit)  # noqa: F821 (defined when enabled)
    else:
        suggestions = await _discover_via_llm(domain, call_llm_fn, limit)

    existing = await _existing_handles()
    # Validate concurrently; drop hallucinations, dead channels, and dupes.
    results = await asyncio.gather(*[_validate_candidate(c) for c in suggestions], return_exceptions=True)
    seen, candidates = set(), []
    for r in results:
        if not isinstance(r, dict):
            continue
        h = r["handle"].lower()
        if h in existing or h in seen or (r.get("display_handle", "").strip().lower() in existing):
            continue
        seen.add(h)
        candidates.append(r)
        if len(candidates) >= limit:
            break
    return {"domain": domain, "candidates": candidates}


async def bulk_add_creators(domain: str, creators: list, yt_content: str = "videos") -> dict:
    """Add reviewed creators to a domain as YouTube feeds. Skips dupes. Returns counts."""
    domain = (domain or "").strip()
    added, skipped = 0, 0
    async with aiosqlite.connect(DB_PATH) as db:
        for c in creators:
            handle = (c.get("handle") or "").strip()
            name = (c.get("name") or handle).strip()
            if not handle:
                skipped += 1
                continue
            try:
                await db.execute(
                    "INSERT INTO watched_influencers (handle, platform, name, yt_content, domain) "
                    "VALUES (?, 'youtube', ?, ?, ?)",
                    (handle, name, yt_content, domain),
                )
                added += 1
            except aiosqlite.IntegrityError:
                skipped += 1
        await db.commit()
    return {"added": added, "skipped": skipped, "domain": domain}
