"""Shared LLM relevance ranker — the reusable "brain" behind every content watcher
(influencer feed, company watch, people watch, …). Pure: no DB, no I/O beyond the
injected `call_llm_fn`. Two modes, one function:

- min_score=None  → boolean keep/drop (topic-vs-tone judging). What the influencer feed uses.
- min_score=<int> → 0-100 relevance score, kept when score >= min_score. For job-scout-style ranking.

Always fails OPEN (keeps everything) if the LLM errors or returns unparseable output, so a
flaky model never silently empties a feed.
"""
import re
import json


def extract_json_array(text: str):
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


def _listing(items: list) -> str:
    lines = []
    for i, p in enumerate(items):
        tag = (p.get("platform") or p.get("source") or "").strip()
        who = (p.get("name") or "").strip()
        text = (p.get("text") or p.get("title") or "")[:220]
        prefix = f"[{tag}] " if tag else ""
        who = f"{who}: " if who else ""
        lines.append(f"{i}. {prefix}{who}{text}")
    return "\n".join(lines) + "\n"


async def rank_relevance(call_llm_fn, items: list, interests: str, *, min_score=None, extra: str = "") -> list:
    """Batched relevance ranking of `items` against `interests`.

    items: dicts with 'text' (or 'title'), optionally 'platform'/'source' and 'name'.
    Returns a list aligned to `items` of {relevant: bool, note: str, score: int|None}.
    """
    if not items:
        return []
    listing = _listing(items)

    if min_score is None:
        system = (
            f"You curate a feed. The reader's interests: {interests}. "
            "Judge each item by its SUBJECT/TOPIC ONLY — ignore clickbait wording, hype, emojis and "
            "promotional tone. A hyped or sensational title on an on-topic subject is STILL relevant "
            "and should be kept. Drop an item ONLY if its subject is clearly unrelated to those "
            "interests. When unsure, KEEP it. " + (extra + " " if extra else "") +
            "Reply with ONLY a JSON array, one object per item IN THE SAME ORDER, shaped "
            "{\"i\": <index>, \"keep\": true|false, \"why\": \"<max 10 words naming the topic, or empty>\"}."
        )
    else:
        system = (
            f"You score items 0-100 for how well they match the reader's needs: {interests}. "
            "100 = perfect match, 0 = irrelevant. Judge by substance, not hype. "
            + (extra + " " if extra else "") +
            "Reply with ONLY a JSON array, one object per item IN THE SAME ORDER, shaped "
            "{\"i\": <index>, \"score\": <0-100>, \"why\": \"<max 10 words, or empty>\"}."
        )

    default = [{"relevant": True, "note": "", "score": None} for _ in items]
    try:
        raw = await call_llm_fn(system, listing)
        arr = extract_json_array(raw)
        if not arr:
            raise ValueError("no json array in response")
        out = [dict(d) for d in default]
        for obj in arr:
            idx = obj.get("i")
            if not (isinstance(idx, int) and 0 <= idx < len(items)):
                continue
            why = (obj.get("why") or "").strip()
            if min_score is None:
                out[idx] = {"relevant": bool(obj.get("keep", True)), "note": why, "score": None}
            else:
                sc = obj.get("score")
                sc = int(sc) if isinstance(sc, (int, float)) else 0
                out[idx] = {"relevant": sc >= min_score, "note": why, "score": sc}
        return out
    except Exception as e:
        print(f"⚠️ relevance ranking failed, keeping all: {e}")
        return default
