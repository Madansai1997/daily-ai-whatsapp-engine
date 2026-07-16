"""Golden-eval harness for JARVIS — 100% free-tier, CI-safe.

Two layers:
  1. DETERMINISTIC checks (no LLM, no network) — the reliability/parsing primitives that must
     never regress. These are the hard CI gate: fast, free, flake-free, no API key needed.
  2. LLM-JUDGED behavioral checks — real prompts run through the free Groq->Gemini chain and
     scored. These run only when a provider key (GROQ_API_KEY / GEMINI_API_KEY / OMNIROUTE_URL)
     is present, so CI without secrets still passes on the deterministic gate.

Exit code is non-zero if any RUN check fails (skipped LLM checks don't fail the gate), so this
doubles as the CI regression gate. Run: `python run_evals.py`  (add a key for the full suite).
"""
import asyncio
import os
import sys

_PASS: list[str] = []
_FAIL: list[tuple[str, str]] = []
_SKIP: list[str] = []


def check(name: str, cond: bool, detail: str = "") -> None:
    if cond:
        _PASS.append(name)
        print(f"  ✅ {name}")
    else:
        _FAIL.append((name, detail))
        print(f"  ❌ {name}" + (f"  [{detail}]" if detail else ""))


# ── Layer 1: deterministic (no LLM, no network) ──────────────────────────────
def deterministic_gate() -> None:
    print("\n── Deterministic gate (no LLM) ──")

    # llm_gateway: circuit breaker + rate limiter
    from llm_gateway import LLMGateway
    g = LLMGateway(fail_threshold=3, cooldown_secs=0.2, rpm_limit=1000)
    for _ in range(3):
        g.record_attempt("p"); g.record_failure("p")
    check("gateway: breaker opens after N consecutive fails", g.should_skip("p") == (True, "circuit_open"))
    g2 = LLMGateway(rpm_limit=2, window_secs=60)
    for _ in range(2):
        g2.record_attempt("q")
    check("gateway: rate limiter caps the window", g2.should_skip("q") == (True, "rate_limited"))
    check("gateway: snapshot fails open (never raises)", isinstance(g.snapshot().get("providers"), dict))

    # pdf_rag_agent: citation normalization + chunking + json
    from pdf_rag_agent import _normalize_cites, _chunk_page, _extract_json, CHUNK_CHARS
    check("rag: fullwidth 【1】 normalized to [1]", "[1]" in _normalize_cites("the answer 【1】"))
    check("rag: short page => single chunk", len(_chunk_page("a short line.")) == 1)
    long = ("This is a sentence. " * 200).strip()
    chunks = _chunk_page(long)
    check("rag: long page splits into multiple chunks", len(chunks) > 1)
    check("rag: chunks respect the size budget", all(len(c) <= CHUNK_CHARS + 200 for c in chunks))
    check("rag: _extract_json tolerates prose+braces", _extract_json('sure: {"a": 1} done') == {"a": 1})

    # influencer_agent: SSRF guard + video-id + json
    from influencer_agent import _is_safe_public_url, _youtube_video_id, extract_json_object
    check("ssrf: blocks cloud-metadata IP", _is_safe_public_url("https://169.254.169.254/latest") is False)
    check("ssrf: blocks loopback", _is_safe_public_url("https://127.0.0.1/x") is False)
    check("ssrf: blocks non-https", _is_safe_public_url("http://example.com") is False)
    check("yt: video id from atom id", _youtube_video_id("yt:video:dQw4w9WgXcQ") == "dQw4w9WgXcQ")
    check("yt: video id from watch url", _youtube_video_id("", "https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ")
    check("json: extract_json_object parses fenced block", extract_json_object('```json\n{"ok": true}\n```') == {"ok": True})

    # rag_engine: BM25 ranks the relevant doc first
    from rag_engine import tokenize, compute_bm25
    docs = [{"content": "python pandas dataframe groupby"}, {"content": "cooking pasta recipe tomato"}]
    ranked = compute_bm25(tokenize("how to groupby a pandas dataframe"), docs)
    check("bm25: ranks the on-topic doc first", ranked[0][0]["content"].startswith("python pandas"))

    # prompts: the few-shot / library invariants that features depend on
    from prompts import INTENT_FEWSHOT, PDF_RAG_ANSWER_SYSTEM, insight_system
    check("prompts: intent few-shot pins the 'job portal' routing", "job portal" in INTENT_FEWSHOT.lower())
    check("prompts: answer template exposes {passages}/{question}", "{passages}" in PDF_RAG_ANSWER_SYSTEM and "{question}" in PDF_RAG_ANSWER_SYSTEM)
    check("prompts: insight_system embeds the project context", "JARVIS" in insight_system("video"))


# ── Layer 2: LLM-judged behavioral checks (needs a provider key) ─────────────
INTENT_CASES = [
    ("how many applications do I have in my job portal?", "APPLICATION_ACTION"),
    ("how's my board looking", "APPLICATION_ACTION"),
    ("what is retrieval augmented generation", "OTHER"),
    ("remind me to call the recruiter tomorrow at 4pm", "SET_REMINDER"),
    ("add electricity 1200 due on the 5th every month", "BILL_ACTION"),
]


async def llm_gate() -> None:
    print("\n── LLM-judged behavioral checks (free Groq→Gemini) ──")
    # Imported lazily so CI without a key never boots the full app.
    import V3_updates as v3
    import json as _json

    for msg, expected in INTENT_CASES:
        try:
            raw = await v3.call_llm(v3.MEMORY_INTENT_PROMPT, msg, max_tokens=250, temperature=0.0)
            data = v3.extract_json_from_response(raw) if hasattr(v3, "extract_json_from_response") else _json.loads(raw)
            got = (data or {}).get("intent")
            check(f"intent: {msg[:42]!r} → {expected}", got == expected, f"got {got}")
        except Exception as e:
            check(f"intent: {msg[:42]!r} → {expected}", False, f"error {e}")

    # PDF-RAG: cites a supported claim AND refuses an unsupported one, from the same passages.
    try:
        from pdf_rag_agent import ingest_pdf, answer_question, delete_doc
        meta = await ingest_pdf("_eval.pdf", [
            "The model was trained on 300 billion tokens of filtered web text.",
            "It was evaluated on the GLUE benchmark.",
        ])
        r = await answer_question(meta["id"], "How much data was it trained on, and what optimizer?", v3.call_llm)
        ans = " ".join(r["answer"].lower().split())  # normalize unicode whitespace (models emit U+202F etc.)
        check("rag: cites the supported fact", "300 billion" in ans and len(r["citations"]) >= 1)
        # The passages never name an optimizer, so a grounded answer must not fabricate one.
        check("rag: does NOT invent an optimizer",
              not any(opt in ans for opt in ("adam", "adamw", "sgd", "adafactor", "rmsprop")))
        await delete_doc(meta["id"])
    except Exception as e:
        check("rag: cited-answer behavioral", False, f"error {e}")


def main() -> int:
    print("JARVIS golden evals")
    deterministic_gate()

    has_llm = bool(os.environ.get("GROQ_API_KEY") or os.environ.get("GEMINI_API_KEY") or os.environ.get("OMNIROUTE_URL"))
    if has_llm:
        os.environ.setdefault("SAFE_MODE", "1")  # never touch prod / send anything during evals
        asyncio.run(llm_gate())
    else:
        _SKIP.append("LLM-judged checks (no GROQ_API_KEY/GEMINI_API_KEY/OMNIROUTE_URL)")
        print("\n── LLM-judged checks SKIPPED (no provider key) ──")

    total = len(_PASS) + len(_FAIL)
    print(f"\n{'='*48}\nRESULT: {len(_PASS)}/{total} passed"
          + (f", {len(_FAIL)} FAILED" if _FAIL else "")
          + (f"  ({len(_SKIP)} suite(s) skipped)" if _SKIP else ""))
    if _FAIL:
        print("Failures:")
        for name, detail in _FAIL:
            print(f"  - {name}" + (f"  [{detail}]" if detail else ""))
    return 1 if _FAIL else 0


if __name__ == "__main__":
    sys.exit(main())
