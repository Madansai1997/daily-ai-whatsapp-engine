"""PDF RAG — chat with an uploaded document, with citation-verified answers.

Upload a PDF → its text is split into passages tagged with the page they came from →
a question runs BM25 over just that document's passages → the answer is generated FROM
those passages, each claim citing the passage it used (e.g. [2]) → a self-check pass
verifies every sentence is actually supported by its cited passage and drops anything
that isn't. Two modes on the same index:
  • ask()    — free-form Q&A, cited to the page.
  • assess() — grade the document against a list of criteria, each with cited evidence.

Free-tier by design: reuses rag_engine's pure-Python BM25 (no embeddings, no vector DB)
and the shared Groq→Gemini LLM chain (passed in as call_llm to avoid a circular import).
Fails safe: retrieval never raises into the request; the self-check falls back to the
un-verified answer rather than erroring.
"""
import os
import re
import json

import db_compat as aiosqlite  # Turso in prod, local in dev — MUST match V3_updates
from rag_engine import tokenize, compute_bm25

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")

CHUNK_CHARS = 900        # target passage size — big enough to hold a claim, small enough to cite
CHUNK_OVERLAP = 150      # carry-over so a sentence split across chunks isn't lost
TOP_K = 5                # passages fed to the model per question


def init_pdf_rag_tables():
    """pdf_documents = one row per uploaded PDF; pdf_chunks = its page-tagged passages."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS pdf_documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        filename TEXT NOT NULL,
        pages INTEGER DEFAULT 0,
        chunks INTEGER DEFAULT 0,
        char_count INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')
    cur.execute('''CREATE TABLE IF NOT EXISTS pdf_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_id INTEGER NOT NULL,
        page INTEGER DEFAULT 1,
        chunk_index INTEGER DEFAULT 0,
        content TEXT NOT NULL)''')
    try:
        cur.execute("CREATE INDEX IF NOT EXISTS idx_pdf_chunks_doc ON pdf_chunks(doc_id)")
    except Exception:
        pass
    conn.commit()
    conn.close()
    print("✅ PDF RAG tables ready.")


# ── chunking ─────────────────────────────────────────────────────────────────
def _chunk_page(text: str) -> list[str]:
    """Split one page's text into ~CHUNK_CHARS passages on sentence-ish boundaries,
    with a small overlap so claims spanning a boundary survive."""
    text = re.sub(r"[ \t]+", " ", (text or "").strip())
    if not text:
        return []
    if len(text) <= CHUNK_CHARS:
        return [text]
    # Split into sentences, then greedily pack them into windows.
    sentences = re.split(r"(?<=[.!?])\s+", text)
    chunks: list[str] = []
    cur = ""
    for s in sentences:
        if len(cur) + len(s) + 1 <= CHUNK_CHARS:
            cur = f"{cur} {s}".strip()
        else:
            if cur:
                chunks.append(cur)
            # start next window with a tail of the previous one for overlap
            tail = cur[-CHUNK_OVERLAP:] if cur else ""
            cur = f"{tail} {s}".strip()
            # a single very long "sentence" still needs hard splitting
            while len(cur) > CHUNK_CHARS:
                chunks.append(cur[:CHUNK_CHARS])
                cur = cur[CHUNK_CHARS - CHUNK_OVERLAP:]
    if cur:
        chunks.append(cur)
    return chunks


async def ingest_pdf(filename: str, pages: list[str]) -> dict:
    """Store a document + its page-tagged chunks. `pages` = one text string per page
    (from pdf_import.extract_pdf_pages). Returns the new doc's metadata."""
    char_count = sum(len(p or "") for p in pages)
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "INSERT INTO pdf_documents (filename, pages, char_count) VALUES (?,?,?)",
            (filename, len(pages), char_count))
        doc_id = cur.lastrowid
        await db.commit()
        n = 0
        for pi, page_text in enumerate(pages, start=1):
            for chunk in _chunk_page(page_text):
                await db.execute(
                    "INSERT INTO pdf_chunks (doc_id, page, chunk_index, content) VALUES (?,?,?,?)",
                    (doc_id, pi, n, chunk))
                n += 1
        await db.execute("UPDATE pdf_documents SET chunks = ? WHERE id = ?", (n, doc_id))
        await db.commit()
    return {"id": doc_id, "filename": filename, "pages": len(pages), "chunks": n, "char_count": char_count}


async def list_docs() -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, filename, pages, chunks, char_count, created_at "
            "FROM pdf_documents ORDER BY created_at DESC, id DESC")
        return [dict(r) for r in await cur.fetchall()]


async def delete_doc(doc_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM pdf_chunks WHERE doc_id = ?", (doc_id,))
        await db.execute("DELETE FROM pdf_documents WHERE id = ?", (doc_id,))
        await db.commit()
    return True


async def _doc_chunks(doc_id: int) -> list[dict]:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, page, chunk_index, content FROM pdf_chunks WHERE doc_id = ? ORDER BY chunk_index",
            (doc_id,))
        return [dict(r) for r in await cur.fetchall()]


# ── retrieval ────────────────────────────────────────────────────────────────
async def _retrieve(doc_id: int, query: str, k: int = TOP_K) -> list[dict]:
    """Top-k passages for the query via BM25 over just this document's chunks."""
    chunks = await _doc_chunks(doc_id)
    if not chunks:
        return []
    q_tokens = tokenize(query)
    ranked = compute_bm25(q_tokens, chunks)
    hits = [doc for doc, score in ranked if score > 0][:k]
    if not hits:  # query shared no terms — fall back to the first few passages
        hits = chunks[:k]
    return hits


def _passage_block(passages: list[dict]) -> str:
    """Number the passages for the prompt: [1] (p.3) <text>."""
    lines = []
    for i, p in enumerate(passages, start=1):
        lines.append(f"[{i}] (p.{p['page']}) {p['content']}")
    return "\n\n".join(lines)


def _normalize_cites(text: str) -> str:
    """LLMs sometimes localize citation brackets to full-width forms (【1】, ［1］) — map them
    back to ASCII [1] so the citation regex and the UI links stay consistent."""
    if not text:
        return text
    return (text.replace("【", "[").replace("】", "]")
                .replace("［", "[").replace("］", "]")
                .replace("〔", "[").replace("〕", "]"))


def _extract_json(text: str):
    """Best-effort JSON parse from an LLM reply (handles ```json fences / stray prose)."""
    if not text:
        return None
    m = re.search(r"\{.*\}|\[.*\]", text, re.DOTALL)
    raw = m.group(0) if m else text
    try:
        return json.loads(raw)
    except Exception:
        return None


# ── mode 1: cited Q&A with self-check ────────────────────────────────────────
async def answer_question(doc_id: int, question: str, call_llm) -> dict:
    """Answer a question grounded in the document, citing passages, then self-check the
    answer and drop any sentence not supported by its citation. Returns
    {answer, citations:[{n,page,snippet}], verified, grounded}."""
    passages = await _retrieve(doc_id, question)
    if not passages:
        return {"answer": "This document has no readable text to search.", "citations": [],
                "verified": False, "grounded": False}

    block = _passage_block(passages)
    draft = await call_llm(
        "You answer questions using ONLY the numbered passages from a document. Cite the passage "
        "number(s) in square brackets after each claim, e.g. [1] or [2][3]. If the passages do not "
        "contain the answer, say exactly: 'The document doesn't cover that.' Never use outside "
        "knowledge. Be concise (1-4 sentences).",
        f"PASSAGES:\n{block}\n\nQUESTION: {question}\n\nCited answer:",
        max_tokens=500, temperature=0.2,
    )
    draft = _normalize_cites((draft or "").strip())

    # Self-check pass — verify each sentence is supported by a cited passage; drop the rest.
    verified_answer = draft
    verified = False
    try:
        check = await call_llm(
            "You are a strict citation verifier. Given numbered PASSAGES and a DRAFT answer with "
            "[n] citations, return STRICT JSON {\"answer\": string, \"removed\": [string]}. Keep only "
            "sentences whose cited passage actually supports them; rewrite the answer with just those, "
            "preserving the [n] citations. Put any dropped/unsupported sentences in 'removed'. If every "
            "sentence checks out, return the answer unchanged and removed=[]. JSON only.",
            f"PASSAGES:\n{block}\n\nDRAFT:\n{draft}\n\nJSON:",
            max_tokens=600, temperature=0.0,
        )
        parsed = _extract_json(check)
        if isinstance(parsed, dict) and isinstance(parsed.get("answer"), str) and parsed["answer"].strip():
            verified_answer = _normalize_cites(parsed["answer"].strip())
            verified = True
    except Exception:
        pass  # fall back to the un-verified draft rather than failing the request

    # Which passages the final answer actually cites.
    cited_nums = sorted({int(n) for n in re.findall(r"\[(\d+)\]", verified_answer)})
    citations = []
    for n in cited_nums:
        if 1 <= n <= len(passages):
            p = passages[n - 1]
            snippet = p["content"][:220] + ("…" if len(p["content"]) > 220 else "")
            citations.append({"n": n, "page": p["page"], "snippet": snippet})

    grounded = "doesn't cover that" not in verified_answer.lower()
    return {"answer": verified_answer, "citations": citations, "verified": verified, "grounded": grounded}


# ── mode 2: assess against criteria ──────────────────────────────────────────
async def assess_document(doc_id: int, criteria: list[str], call_llm) -> dict:
    """Grade the document against each criterion, with cited evidence. Returns
    {results:[{criterion, met, evidence, page}], score, met, total}."""
    crits = [c.strip() for c in (criteria or []) if c and c.strip()]
    if not crits:
        return {"results": [], "score": 0, "met": 0, "total": 0}

    results = []
    for crit in crits:
        passages = await _retrieve(doc_id, crit, k=4)
        block = _passage_block(passages) if passages else "(no passages)"
        raw = await call_llm(
            "You assess whether a document satisfies ONE criterion, using ONLY the numbered passages. "
            "Return STRICT JSON {\"met\": true|false, \"evidence\": string, \"cite\": number|null}. "
            "'evidence' quotes/paraphrases the supporting passage (or says what's missing); 'cite' is the "
            "passage number you used, or null if none supports it. Never use outside knowledge. JSON only.",
            f"PASSAGES:\n{block}\n\nCRITERION: {crit}\n\nJSON:",
            max_tokens=300, temperature=0.0,
        )
        parsed = _extract_json(raw) or {}
        met = bool(parsed.get("met"))
        cite = parsed.get("cite")
        page = None
        if isinstance(cite, int) and 1 <= cite <= len(passages):
            page = passages[cite - 1]["page"]
        results.append({
            "criterion": crit,
            "met": met,
            "evidence": (parsed.get("evidence") or "").strip()[:400],
            "page": page,
        })

    met = sum(1 for r in results if r["met"])
    total = len(results)
    score = round(100 * met / total) if total else 0
    return {"results": results, "score": score, "met": met, "total": total}
