"""
Trend Lab Agent — weekly app-idea discovery from Reddit + YouTube (free-tier only).

Mines the two sources where people actually *ask* for products — Reddit ("someone
should build…", "I wish there was an app for…") and YouTube (complaint/idea searches)
— then uses the shared free LLM to cluster the raw signals into distinct app ideas and
score each by frequency, competition and monetisation potential.

Design choices (budget-first):
- Reddit uses the public .json endpoints with a descriptive User-Agent — NO credentials
  required to start. If REDDIT_CLIENT_ID/SECRET are set later, we use OAuth for headroom.
- YouTube uses the Data API v3 (free 10k units/day); skipped gracefully if no key.
- The FREQUENCY score is deterministic (count of supporting signals); competition and
  monetisation are LLM judgment (inherently subjective). All bounded to protect the
  512MB instance — texts truncated, counts capped.

On-demand (a Scan-now button) or weekly via cron — never on the hot path.
"""

import os
import re
import json
import time
import asyncio
from datetime import datetime, timezone, timedelta

import db_compat as aiosqlite

try:
    import requests
except Exception:  # pragma: no cover - requests is a project dep
    requests = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

USER_AGENT = os.environ.get("TREND_LAB_UA", "TrendLab/0.1 (personal idea-research bot)")
YOUTUBE_API_KEY = os.environ.get("YOUTUBE_API_KEY", "").strip()
# Reddit tightened public .json (datacenter IPs get 403), so app-only OAuth is the reliable free
# path. Create a free "script" app at reddit.com/prefs/apps → set these two. Falls back to the
# public .json (works from some residential IPs) when unset.
REDDIT_CLIENT_ID = os.environ.get("REDDIT_CLIENT_ID", "").strip()
REDDIT_CLIENT_SECRET = os.environ.get("REDDIT_CLIENT_SECRET", "").strip()
_reddit_token = {"value": "", "exp": 0.0}

# RapidAPI Reddit path — avoids Reddit's own OAuth/app entirely (their app form is flaky). Reuses
# the account-wide RAPIDAPI_KEY; the user just subscribes (free tier) to a Reddit scraper API.
# Defaults to 'reddit-scraper2'; override the host/path/param for any other provider. The response
# parser is schema-agnostic (finds post-like objects anywhere in the JSON), so it survives the
# shape differences between providers.
RAPIDAPI_KEY1 = os.environ.get("RAPIDAPI_KEY1", "").strip()
REDDIT_RAPIDAPI_HOST = os.environ.get("REDDIT_RAPIDAPI_HOST", "reddit-scraper2.p.rapidapi.com").strip()
REDDIT_RAPIDAPI_PATH = os.environ.get("REDDIT_RAPIDAPI_PATH", "/search_posts").strip()
REDDIT_RAPIDAPI_QPARAM = os.environ.get("REDDIT_RAPIDAPI_QUERY_PARAM", "query").strip()
# "search" = iterate WISH_PHRASES against a keyword-search endpoint.
# "subreddit" = iterate REDDIT_SUBS against a per-subreddit endpoint (e.g. reddit34
#   /getPostsBySubreddit?subreddit=…). The idea subs are already request-dense, so this works well.
REDDIT_RAPIDAPI_MODE = os.environ.get("REDDIT_RAPIDAPI_MODE", "search").strip().lower()
REDDIT_RAPIDAPI_SORT = os.environ.get("REDDIT_RAPIDAPI_SORT", "new").strip()
REDDIT_VIA_RAPIDAPI = bool(RAPIDAPI_KEY1 and REDDIT_RAPIDAPI_HOST)

# Subreddits where product-request language is dense.
REDDIT_SUBS = ["SomebodyMakeThis", "AppIdeas", "Lightbulb", "SideProject",
               "smallbusiness", "Entrepreneur"]
# High-signal phrases people use when they want a product that doesn't exist yet.
WISH_PHRASES = [
    "i wish there was an app", "someone should make", "someone should build",
    "is there an app that", "why isn't there an app", "need an app that",
]
YT_QUERIES = [
    "i wish there was an app", "why isn't there an app for", "someone should make an app",
    "app idea", "is there an app that", "apps that should exist",
    "problems that need an app", "i wish there was an app that",
]
YT_VIDEOS_PER_QUERY = 8          # search results per query
YT_COMMENT_VIDEOS = 4            # of those, fetch comments for the top N
YT_COMMENTS_PER_VIDEO = 20       # top comments per video (cheap: 1 quota unit each)

# Language that signals a genuine product REQUEST/complaint (used to filter noisy comments).
REQUEST_RE = re.compile(
    r"(i wish (there|they|someone|it)|wish there (was|were)|someone should (make|build|create)|"
    r"is there (an?|any) (app|tool|website|way)|why (isn'?t|is there no|isn'?t there)|"
    r"need (an?|a) (app|tool|way)|there should be|does anyone know (of )?(an?|any) (app|tool)|"
    r"an app (that|to|for)|app idea|app for|hate (that|when|how)|so annoying|"
    r"if only there was|can'?t find (an?|any) (app|tool))", re.I)

MAX_SIGNALS_PER_RUN = 180        # bound memory + LLM cost
MAX_TEXT_CHARS = 500             # per-signal truncation
CLUSTER_INPUT_CAP = 120          # how many recent signals we hand the LLM


# ── Tables ──────────────────────────────────────────────────────────────────
def init_trend_lab_tables():
    """Raw signals (dedup by source_id) + clustered/scored ideas."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS trend_signals (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT,                 -- reddit | youtube
        source_id TEXT UNIQUE,       -- fullname / video id (dedup key)
        origin TEXT,                 -- subreddit / query
        text TEXT,
        url TEXT,
        popularity INTEGER,          -- upvotes / view proxy
        created_utc TEXT,
        clustered INTEGER DEFAULT 0, -- 1 once folded into an idea
        fetched_at TEXT
    )''')
    cur.execute('''CREATE TABLE IF NOT EXISTS trend_ideas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT,
        pain TEXT,
        summary TEXT,
        frequency INTEGER,           -- supporting signal count
        competition INTEGER,         -- 0-100 (higher = LESS competition = better)
        monetization INTEGER,        -- 0-100
        total_score INTEGER,         -- weighted blend
        sources_json TEXT,           -- ["reddit", "youtube"]
        quotes_json TEXT,            -- [{"text","url"}]
        status TEXT DEFAULT 'new',   -- new | shortlisted | building | dismissed
        created_at TEXT,
        updated_at TEXT
    )''')
    conn.commit()
    conn.close()
    print("✅ Trend Lab tables ready.")


# ── Reddit (public .json, no creds needed) ──────────────────────────────────
def _http_get_json(url, params=None):
    if requests is None:
        return None
    try:
        r = requests.get(url, params=params, headers={"User-Agent": USER_AGENT}, timeout=15)
        if r.status_code != 200:
            return None
        return r.json()
    except Exception as e:
        print(f"⚠️ [trend_lab] GET failed ({url[:60]}): {e}")
        return None


def _get_reddit_token() -> str:
    """App-only OAuth (client_credentials) token, cached until ~expiry. '' if no creds/fails."""
    if not (REDDIT_CLIENT_ID and REDDIT_CLIENT_SECRET) or requests is None:
        return ""
    if _reddit_token["value"] and time.time() < _reddit_token["exp"]:
        return _reddit_token["value"]
    try:
        r = requests.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=(REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET),
            data={"grant_type": "client_credentials"},
            headers={"User-Agent": USER_AGENT}, timeout=15)
        if r.status_code != 200:
            print(f"⚠️ [trend_lab] reddit token HTTP {r.status_code}")
            return ""
        j = r.json()
        _reddit_token["value"] = j.get("access_token", "")
        _reddit_token["exp"] = time.time() + int(j.get("expires_in", 3600)) - 60
        return _reddit_token["value"]
    except Exception as e:
        print(f"⚠️ [trend_lab] reddit token failed: {e}")
        return ""


def _reddit_get(path_public, path_oauth, params):
    """Prefer OAuth (oauth.reddit.com) when creds exist; else public .json."""
    tok = _get_reddit_token()
    if tok:
        try:
            r = requests.get("https://oauth.reddit.com" + path_oauth, params=params,
                             headers={"User-Agent": USER_AGENT, "Authorization": f"bearer {tok}"},
                             timeout=15)
            if r.status_code == 200:
                return r.json()
            print(f"⚠️ [trend_lab] reddit oauth HTTP {r.status_code} ({path_oauth})")
        except Exception as e:
            print(f"⚠️ [trend_lab] reddit oauth failed: {e}")
    return _http_get_json("https://www.reddit.com" + path_public, params)


def _collect_reddit(data, out, seen, origin):
    if not isinstance(data, dict):
        return
    for child in (data.get("data", {}) or {}).get("children", []) or []:
        d = child.get("data", {}) or {}
        sid = d.get("name") or d.get("id")
        if not sid or sid in seen:
            continue
        title = (d.get("title") or "").strip()
        body = (d.get("selftext") or "").strip()
        text = (title + " — " + body).strip(" —")[:MAX_TEXT_CHARS]
        if len(text) < 12:
            continue
        seen.add(sid)
        out.append({
            "source": "reddit", "source_id": sid, "origin": origin,
            "text": text,
            "url": "https://www.reddit.com" + (d.get("permalink") or ""),
            "popularity": int(d.get("ups") or 0),
            "created_utc": datetime.fromtimestamp(
                float(d.get("created_utc") or 0), tz=timezone.utc).isoformat(),
        })


# ── RapidAPI Reddit path (no Reddit app/OAuth needed) ───────────────────────
_FIRST = lambda d, keys: next((d[k] for k in keys if isinstance(d.get(k), (str, int, float)) and d.get(k) not in (None, "")), None)


def _extract_posts(obj, out, seen, origin):
    """Schema-agnostic walk: any dict with a non-empty 'title' is treated as a post. Survives the
    differing response shapes across RapidAPI Reddit providers."""
    if isinstance(obj, list):
        for x in obj:
            _extract_posts(x, out, seen, origin)
        return
    if not isinstance(obj, dict):
        return
    title = obj.get("title")
    if isinstance(title, str) and title.strip():
        body = _FIRST(obj, ["selftext", "text", "body", "content", "description", "selftext_html"]) or ""
        url = _FIRST(obj, ["permalink", "url", "link", "post_url"]) or ""
        if isinstance(url, str) and url.startswith("/"):
            url = "https://www.reddit.com" + url
        ups = _FIRST(obj, ["score", "ups", "upvotes", "num_upvotes", "upvote_count"]) or 0
        sid = _FIRST(obj, ["id", "post_id", "name", "fullname", "uuid"]) or (title[:60] + str(url)[:40])
        sid = f"rapi:{sid}"
        text = (title.strip() + " — " + str(body).strip()).strip(" —")[:MAX_TEXT_CHARS]
        if sid not in seen and len(text) >= 12:
            seen.add(sid)
            out.append({"source": "reddit", "source_id": sid, "origin": origin,
                        "text": text, "url": str(url),
                        "popularity": int(float(ups)) if str(ups).replace(".", "", 1).isdigit() else 0,
                        "created_utc": ""})
    # Recurse into nested containers (data/posts/results/children/etc.)
    for v in obj.values():
        if isinstance(v, (list, dict)):
            _extract_posts(v, out, seen, origin)


def _rapidapi_reddit_get(query):
    if not (REDDIT_VIA_RAPIDAPI and requests is not None):
        return None
    try:
        r = requests.get(
            f"https://{REDDIT_RAPIDAPI_HOST}{REDDIT_RAPIDAPI_PATH}",
            params={REDDIT_RAPIDAPI_QPARAM: query, "sort": REDDIT_RAPIDAPI_SORT},
            headers={"X-RapidAPI-Key": RAPIDAPI_KEY1, "X-RapidAPI-Host": REDDIT_RAPIDAPI_HOST,
                     "User-Agent": USER_AGENT}, timeout=20)
        if r.status_code != 200:
            print(f"⚠️ [trend_lab] rapidapi reddit HTTP {r.status_code} — "
                  f"subscribe to '{REDDIT_RAPIDAPI_HOST}' on RapidAPI (free), or set REDDIT_RAPIDAPI_HOST/PATH.")
            return None
        return r.json()
    except Exception as e:
        print(f"⚠️ [trend_lab] rapidapi reddit failed: {e}")
        return None


async def fetch_reddit_signals(per_query=20):
    out, seen = [], set()
    # Preferred: RapidAPI (no Reddit app). Falls back to OAuth / public .json if not configured.
    if REDDIT_VIA_RAPIDAPI:
        # search mode → keyword phrases; subreddit mode → the idea subreddits themselves.
        terms = REDDIT_SUBS if REDDIT_RAPIDAPI_MODE == "subreddit" else WISH_PHRASES
        for term in terms:
            data = await asyncio.to_thread(_rapidapi_reddit_get, term)
            _extract_posts(data, out, seen, f"rapidapi:{term}")
            if len(out) >= MAX_SIGNALS_PER_RUN:
                break
        return out[:MAX_SIGNALS_PER_RUN]
    for phrase in WISH_PHRASES:
        data = await asyncio.to_thread(
            _reddit_get, "/search.json", "/search",
            {"q": f'"{phrase}"', "sort": "new", "t": "month", "limit": per_query, "type": "link"})
        _collect_reddit(data, out, seen, f"search:{phrase}")
        if len(out) >= MAX_SIGNALS_PER_RUN:
            return out[:MAX_SIGNALS_PER_RUN]
    for sub in REDDIT_SUBS:
        data = await asyncio.to_thread(
            _reddit_get, f"/r/{sub}/new.json", f"/r/{sub}/new", {"limit": per_query})
        _collect_reddit(data, out, seen, f"r/{sub}")
        if len(out) >= MAX_SIGNALS_PER_RUN:
            break
    return out[:MAX_SIGNALS_PER_RUN]


# ── YouTube (Data API v3, free quota; skipped without a key) ─────────────────
def _yt_comments(video_id):
    """Top-level comments for a video: [(comment_id, text, likes)]. [] if disabled/blocked."""
    data = _http_get_json(
        "https://www.googleapis.com/youtube/v3/commentThreads",
        {"key": YOUTUBE_API_KEY, "part": "snippet", "videoId": video_id,
         "order": "relevance", "maxResults": YT_COMMENTS_PER_VIDEO, "textFormat": "plainText"})
    out = []
    for item in (data or {}).get("items", []) or []:
        try:
            top = item["snippet"]["topLevelComment"]["snippet"]
            out.append((item["id"], top.get("textDisplay", "") or "",
                        int(top.get("likeCount") or 0)))
        except Exception:
            continue
    return out


async def fetch_youtube_signals():
    """Search topical videos, then mine their COMMENTS for real product requests (the high-signal
    part). Video titles/descriptions are kept too (already topical from the query). Comments are
    filtered by REQUEST_RE so we only store genuine 'I wish there was…' style asks, not chatter."""
    if not YOUTUBE_API_KEY:
        return []
    out, seen = [], set()
    after = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%dT%H:%M:%SZ")
    for q in YT_QUERIES:
        data = await asyncio.to_thread(
            _http_get_json, "https://www.googleapis.com/youtube/v3/search",
            {"key": YOUTUBE_API_KEY, "q": q, "part": "snippet", "type": "video",
             "maxResults": YT_VIDEOS_PER_QUERY, "order": "relevance", "publishedAfter": after})
        vids = []
        for item in (data or {}).get("items", []) or []:
            vid = (item.get("id") or {}).get("videoId")
            sn = item.get("snippet", {}) or {}
            if not vid or vid in seen:
                continue
            seen.add(vid)
            vids.append(vid)
            text = ((sn.get("title") or "") + " — " + (sn.get("description") or "")).strip(" —")[:MAX_TEXT_CHARS]
            if len(text) >= 12:
                out.append({
                    "source": "youtube", "source_id": f"yt:{vid}", "origin": f"q:{q}",
                    "text": text, "url": f"https://www.youtube.com/watch?v={vid}",
                    "popularity": 0, "created_utc": sn.get("publishedAt") or "",
                })
        # Mine comments of the top few videos — where the real requests live.
        for vid in vids[:YT_COMMENT_VIDEOS]:
            for cid, ctext, likes in await asyncio.to_thread(_yt_comments, vid):
                key = f"ytc:{cid}"
                if key in seen or len(ctext) < 15 or not REQUEST_RE.search(ctext):
                    continue
                seen.add(key)
                out.append({
                    "source": "youtube", "source_id": key, "origin": f"comment:{q}",
                    "text": ctext[:MAX_TEXT_CHARS],
                    "url": f"https://www.youtube.com/watch?v={vid}",
                    "popularity": int(likes), "created_utc": "",
                })
            if len(out) >= MAX_SIGNALS_PER_RUN:
                break
        if len(out) >= MAX_SIGNALS_PER_RUN:
            break
    return out[:MAX_SIGNALS_PER_RUN]


async def store_signals(signals) -> int:
    """Insert new signals, dedup by source_id. Returns how many were newly stored."""
    now = datetime.now(timezone.utc).isoformat()
    stored = 0
    async with aiosqlite.connect(DB_PATH) as db:
        for s in signals:
            try:
                cur = await db.execute(
                    """INSERT OR IGNORE INTO trend_signals
                       (source, source_id, origin, text, url, popularity, created_utc, clustered, fetched_at)
                       VALUES (?,?,?,?,?,?,?,0,?)""",
                    (s["source"], s["source_id"], s["origin"], s["text"], s["url"],
                     s["popularity"], s["created_utc"], now))
                stored += int(getattr(cur, "rowcount", 0) or 0)
            except Exception as e:
                print(f"⚠️ [trend_lab] store failed: {e}")
        await db.commit()
    return stored


# ── NLP: cluster raw signals into scored ideas ──────────────────────────────
CLUSTER_PROMPT = (
    "You are a product-strategy analyst mining raw social posts for APP/SOFTWARE ideas people "
    "are implicitly or explicitly asking for. You get a NUMBERED list of posts. Group them into "
    "DISTINCT product ideas (merge posts describing the same underlying need). Return STRICT JSON "
    "only — no markdown — as a list:\n"
    "[\n"
    '  {"title": "<short product name/idea>",\n'
    '   "pain": "<the specific problem people want solved, one sentence>",\n'
    '   "summary": "<2-sentence description of the app that would solve it>",\n'
    '   "signal_ids": [<the post numbers supporting this idea>],\n'
    '   "competition": "low|medium|high",   // how crowded the market already is\n'
    '   "monetization": "low|medium|high",  // willingness/ability to pay for it\n'
    '   "example_quote": "<the most telling short phrase from a supporting post>"}\n'
    "]\n\n"
    "RULES: only surface ideas with a REAL, recurring or clearly-stated need — ignore vents with no "
    "product angle. Prefer ideas an indie dev could build as an MVP. Do NOT invent posts or needs "
    "not present. Max 12 ideas, best first. Output JSON only."
)

_COMP = {"low": 90, "medium": 55, "high": 20}     # less competition = higher/better
_MONEY = {"low": 30, "medium": 60, "high": 90}


def _parse_json_list(raw: str):
    raw = (raw or "").strip()
    start = raw.find("[")
    if start == -1:
        # tolerate a single object or a {"ideas": [...]} wrapper
        s2 = raw.find("{")
        if s2 == -1:
            return []
        try:
            obj, _ = json.JSONDecoder().raw_decode(raw[s2:])
            if isinstance(obj, dict) and isinstance(obj.get("ideas"), list):
                return obj["ideas"]
            return [obj] if isinstance(obj, dict) else []
        except Exception:
            return []
    try:
        arr, _ = json.JSONDecoder().raw_decode(raw[start:])
        return arr if isinstance(arr, list) else []
    except Exception:
        return []


def _score_idea(freq: int, competition: str, monetization: str) -> tuple:
    comp = _COMP.get(str(competition).lower(), 55)
    money = _MONEY.get(str(monetization).lower(), 60)
    freq_norm = min(100, freq * 18)   # ~6 mentions saturates the frequency axis
    total = round(0.4 * freq_norm + 0.3 * comp + 0.3 * money)
    return max(0, min(100, total)), comp, money


async def cluster_and_score(call_llm_fn) -> dict:
    """Pull recent un-clustered signals, LLM-cluster into ideas, score, store. Returns
    {ideas_created, signals_used}."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, source, text, url FROM trend_signals WHERE clustered = 0 "
            "ORDER BY id DESC LIMIT ?", (CLUSTER_INPUT_CAP,))
        rows = [dict(r) for r in await cur.fetchall()]
    if not rows:
        return {"ideas_created": 0, "signals_used": 0}

    numbered = "\n".join(f"{i+1}. [{r['source']}] {r['text']}" for i, r in enumerate(rows))
    try:
        raw = await call_llm_fn(CLUSTER_PROMPT, numbered, max_tokens=2200, temperature=0.2)
        ideas = _parse_json_list(raw)
    except Exception as e:
        print(f"⚠️ [trend_lab] cluster failed: {e}")
        return {"ideas_created": 0, "signals_used": len(rows), "error": str(e)}

    now = datetime.now(timezone.utc).isoformat()
    created = 0
    async with aiosqlite.connect(DB_PATH) as db:
        for idea in ideas:
            if not isinstance(idea, dict) or not (idea.get("title") or "").strip():
                continue
            ids = [int(n) for n in (idea.get("signal_ids") or []) if str(n).isdigit()]
            members = [rows[n - 1] for n in ids if 1 <= n <= len(rows)]
            freq = max(1, len(members))
            total, comp, money = _score_idea(freq, idea.get("competition"), idea.get("monetization"))
            sources = sorted({m["source"] for m in members}) or ["reddit"]
            quotes = [{"text": m["text"][:200], "url": m["url"]} for m in members[:4]]
            if not quotes and idea.get("example_quote"):
                quotes = [{"text": str(idea["example_quote"])[:200], "url": ""}]
            await db.execute(
                """INSERT INTO trend_ideas
                   (title, pain, summary, frequency, competition, monetization, total_score,
                    sources_json, quotes_json, status, created_at, updated_at)
                   VALUES (?,?,?,?,?,?,?,?,?, 'new', ?, ?)""",
                ((idea.get("title") or "").strip()[:140],
                 (idea.get("pain") or "").strip()[:400],
                 (idea.get("summary") or "").strip()[:600],
                 freq, comp, money, total,
                 json.dumps(sources), json.dumps(quotes), now, now))
            created += 1
            for m in members:
                await db.execute("UPDATE trend_signals SET clustered = 1 WHERE id = ?", (m["id"],))
        await db.commit()
    return {"ideas_created": created, "signals_used": len(rows)}


# ── Full weekly pipeline ────────────────────────────────────────────────────
async def run_trend_scan(call_llm_fn, notify_fn=None) -> dict:
    """Fetch → store → cluster → score. Notifies the top new idea. Never sends anything
    outward. Returns a summary dict."""
    reddit = await fetch_reddit_signals()
    youtube = await fetch_youtube_signals()
    new_signals = await store_signals(reddit + youtube)
    result = await cluster_and_score(call_llm_fn)
    summary = {
        "reddit": len(reddit), "youtube": len(youtube),
        "new_signals": new_signals, **result,
    }
    if result.get("ideas_created") and notify_fn:
        try:
            top = (await list_trend_ideas(limit=1)) or []
            lead = top[0]["title"] if top else "new ideas"
            notify_fn(
                f"🧪 Trend Lab: {result['ideas_created']} new app idea(s) this scan. "
                f"Top pick: {lead}. Review them in Trend Lab.", "trends")
        except Exception as e:
            print(f"⚠️ [trend_lab] notify failed: {e}")
    print(f"🧪 [trend_lab] scan: {summary}")
    return summary


async def list_trend_ideas(status: str = None, limit: int = 60) -> list:
    q = "SELECT * FROM trend_ideas"
    args = []
    if status:
        q += " WHERE status = ?"
        args.append(status)
    q += " ORDER BY (status='dismissed') ASC, total_score DESC, id DESC LIMIT ?"
    args.append(limit)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(q, tuple(args))
        rows = [dict(r) for r in await cur.fetchall()]
    for r in rows:
        r["sources"] = json.loads(r.get("sources_json") or "[]")
        r["quotes"] = json.loads(r.get("quotes_json") or "[]")
    return rows


async def set_idea_status(idea_id: int, status: str) -> dict:
    if status not in ("new", "shortlisted", "building", "dismissed"):
        return {"ok": False, "error": "invalid status"}
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE trend_ideas SET status = ?, updated_at = ? WHERE id = ?",
                         (status, datetime.now(timezone.utc).isoformat(), idea_id))
        await db.commit()
    return {"ok": True}


async def trend_lab_stats() -> dict:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        s = await (await db.execute("SELECT COUNT(*) AS n FROM trend_signals")).fetchone()
        i = await (await db.execute("SELECT COUNT(*) AS n FROM trend_ideas")).fetchone()
        sl = await (await db.execute("SELECT COUNT(*) AS n FROM trend_ideas WHERE status='shortlisted'")).fetchone()
    return {"signals": s["n"] if s else 0, "ideas": i["n"] if i else 0,
            "shortlisted": sl["n"] if sl else 0,
            "youtube_enabled": bool(YOUTUBE_API_KEY)}
