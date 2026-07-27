"""
FastAPI Router for PDF RAG, Built-in NotebookLM Studio & Data Analyst Engine
"""
import os
import json
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response, UploadFile, File
from fastapi.responses import JSONResponse

from pdf_rag_agent import (
    ingest_pdf as pdf_rag_upload,
    list_docs as pdf_rag_list_docs,
    document_summary as pdf_rag_get_summary,
    answer_question as pdf_rag_ask,
    assess_document as pdf_rag_assess,
    delete_doc as pdf_rag_delete,
    get_doc_chunks as pdf_rag_get_chunks,
)
from resume_ats_agent import (
    get_analysis as get_ats_analysis,
    get_resume_template,
)

router = APIRouter(tags=["PDF RAG & NotebookLM Studio"])

call_llm_fn = None
parse_json_fn = None

def init_rag_router_deps(call_llm, parse_json):
    global call_llm_fn, parse_json_fn
    call_llm_fn = call_llm
    parse_json_fn = parse_json


# ── PDF RAG Endpoints --------------------------------------------------------

@router.get("/api/pdf-rag/docs")
async def get_pdf_rag_docs_api():
    docs = await pdf_rag_list_docs()
    return JSONResponse({"ok": True, "documents": docs})


@router.post("/api/pdf-rag/upload")
async def pdf_rag_upload_api(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        return JSONResponse({"error": "Only PDF files are supported"}, status_code=400)
    pdf_bytes = await file.read()
    if len(pdf_bytes) > 25 * 1024 * 1024:
        return JSONResponse({"error": "File size exceeds 25 MB limit"}, status_code=400)
    doc_id, summary = await pdf_rag_upload(pdf_bytes, file.filename, call_llm_fn)
    return JSONResponse({"ok": True, "doc_id": doc_id, "summary": summary})


@router.post("/api/pdf-rag/{doc_id}/summary")
async def pdf_rag_summary_ep(doc_id: int):
    summary = await pdf_rag_get_summary(doc_id)
    if not summary:
        return JSONResponse({"error": "Document not found"}, status_code=404)
    return JSONResponse({"ok": True, "summary": summary})


@router.post("/api/pdf-rag/{doc_id}/ask")
async def pdf_rag_ask_ep(doc_id: int, request: Request):
    body = await request.json()
    q = (body.get("question") or "").strip()
    if not q:
        return JSONResponse({"error": "Question is required"}, status_code=400)
    ans = await pdf_rag_ask(doc_id, q, call_llm_fn)
    return JSONResponse({"ok": True, "answer": ans})


@router.post("/api/pdf-rag/{doc_id}/assess")
async def pdf_rag_assess_ep(doc_id: int, request: Request):
    body = await request.json()
    role = (body.get("target_role") or "Data Analyst").strip()
    assessment = await pdf_rag_assess(doc_id, role, call_llm_fn)
    return JSONResponse({"ok": True, "assessment": assessment})


@router.delete("/api/pdf-rag/{doc_id}")
async def pdf_rag_delete_ep(doc_id: int):
    await pdf_rag_delete(doc_id)
    return JSONResponse({"ok": True})


@router.get("/api/pdf-rag/{doc_id}/notebooklm")
async def pdf_rag_notebooklm_pack(doc_id: int):
    """Download full document chunks formatted as a clean Markdown source pack for Google NotebookLM."""
    chunks = await pdf_rag_get_chunks(doc_id)
    if not chunks:
        return JSONResponse({"detail": "Document not found or has no chunks"}, status_code=404)

    filename = chunks[0].get("filename") or f"Document_{doc_id}"
    lines = [
        f"# NOTEBOOKLM SOURCE PACK: {filename}\n",
        f"*Extracted and indexed by JARVIS Multi-Source Intelligence System*\n",
        "---\n"
    ]
    for c in chunks:
        lines.append(f"## Page {c.get('page_num', '?')} / Chunk #{c.get('chunk_idx', '?')}\n")
        lines.append(c.get("content", "").strip())
        lines.append("\n\n---\n")

    full_md = "\n".join(lines)
    return Response(
        content=full_md,
        media_type="text/markdown",
        headers={"Content-Disposition": f'attachment; filename="NotebookLM_Source_{doc_id}.md"'}
    )


# ── Built-in NotebookLM Multi-Source Context Assembly --------------------------

async def assemble_notebook_context(sources: dict) -> str:
    """Consolidate text excerpts from selected sources (master resume, job descriptions, PDFs)."""
    context_parts = []

    # 1. Master Resume
    if sources.get("resume"):
        resume = await get_resume_template()
        if resume and resume.strip():
            context_parts.append(f"=== SOURCE: MASTER RÉSUMÉ ===\n{resume.strip()}\n")

    # 2. Target Job Descriptions
    job_refs = sources.get("job_refs") or []
    if job_refs and isinstance(job_refs, list):
        for ref in job_refs:
            analysis = await get_ats_analysis(ref)
            if analysis and analysis.get("job_title"):
                jd = analysis.get("description") or ""
                context_parts.append(
                    f"=== SOURCE: JOB DESCRIPTION ({analysis.get('job_title')} @ {analysis.get('company')}) ===\n"
                    f"{jd[:4000]}\n"
                )

    # 3. PDF Documents
    pdf_ids = sources.get("pdf_ids") or []
    if pdf_ids and isinstance(pdf_ids, list):
        for doc_id in pdf_ids:
            try:
                doc_id_int = int(doc_id)
            except (ValueError, TypeError):
                continue
            chunks = await pdf_rag_get_chunks(doc_id_int)
            if chunks:
                excerpt = "\n".join([c["content"] for c in chunks[:12]])[:6000]
                context_parts.append(f"=== SOURCE: UPLOADED PDF (Doc #{doc_id}) ===\n{excerpt}\n")

    if not context_parts:
        return "No active sources selected."
    return "\n\n".join(context_parts)


NOTEBOOK_SYSTEM_PROMPT = (
    "You are JARVIS, a master career copilot and research analyst. You are given a set of "
    "SELECTED SOURCE DOCUMENTS (Master Resume, Job Descriptions, and/or PDF research documents). "
    "Answer the user's question accurately based ONLY on the provided sources. Cite which source "
    "your answer is derived from. If the sources do not contain the answer, state that clearly."
)

NOTEBOOK_STUDY_PROMPT = (
    "You are JARVIS, an elite interview coach and technical mentor. You are given a set of "
    "SELECTED SOURCE DOCUMENTS. Generate a comprehensive, beautifully structured Markdown Study Guide "
    "and Cheat Sheet. Include:\n"
    "1. Executive Summary & Core Alignment\n"
    "2. Technical Mastery Points & Required Tools\n"
    "3. High-Frequency Interview Questions & Strategic Answers\n"
    "4. Actionable 3-Day Preparation Roadmap\n"
    "Output structured Markdown only."
)

NOTEBOOK_QUIZ_PROMPT = (
    "You are an assessment engine. You are given a set of SELECTED SOURCE DOCUMENTS. "
    "Generate a 5-question multiple choice practice quiz based on the key concepts, technical tools, "
    "and requirements in the sources. Return a STRICT JSON array of 5 objects — no markdown, no prose:\n"
    "[\n"
    "  {\n"
    '    "question": "...",\n'
    '    "options": ["Option A", "Option B", "Option C", "Option D"],\n'
    '    "correct_idx": 0,\n'
    '    "explanation": "..."\n'
    "  }\n"
    "]"
)

NOTEBOOK_AUDIO_PROMPT = (
    "You are an AI podcast scriptwriter. You are given a set of SELECTED SOURCE DOCUMENTS. "
    "Generate an engaging, natural 4-turn conversational briefing script between two hosts:\n"
    "- 'JARVIS' (the composed, witty AI lead)\n"
    "- 'Coach' (the sharp career strategist)\n"
    "They discuss the candidate's fit, key strengths, potential risks, and top interview tactics. "
    "Return a STRICT JSON array of objects — no markdown, no prose:\n"
    '[\n  {"speaker": "JARVIS", "text": "..."},\n  {"speaker": "Coach", "text": "..."}\n]'
)


@router.post("/api/notebook/chat")
async def notebook_chat_api(request: Request):
    body = await request.json()
    message = (body.get("message") or "").strip()
    sources = body.get("sources") or {}
    if not message:
        return JSONResponse({"error": "Message is required"}, status_code=400)
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nQUESTION: {message}"
    reply = await call_llm_fn(NOTEBOOK_SYSTEM_PROMPT, user_prompt, max_tokens=1200)
    return JSONResponse({"reply": reply})


@router.post("/api/notebook/study-guide")
async def notebook_study_guide_api(request: Request):
    body = await request.json()
    sources = body.get("sources") or {}
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nGenerate the Study Guide now."
    guide = await call_llm_fn(NOTEBOOK_STUDY_PROMPT, user_prompt, max_tokens=2200)
    return JSONResponse({"study_guide": guide})


@router.post("/api/notebook/quiz")
async def notebook_quiz_api(request: Request):
    body = await request.json()
    sources = body.get("sources") or {}
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nGenerate the JSON 5-question quiz array now."
    raw = await call_llm_fn(NOTEBOOK_QUIZ_PROMPT, user_prompt, max_tokens=1500, temperature=0.2)
    quiz = parse_json_fn(raw) if parse_json_fn else json.loads(raw)
    if not isinstance(quiz, list):
        quiz = quiz.get("quiz") if isinstance(quiz, dict) else []
    return JSONResponse({"quiz": quiz})


@router.post("/api/notebook/audio-overview")
async def notebook_audio_overview_api(request: Request):
    body = await request.json()
    sources = body.get("sources") or {}
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nGenerate the dialogue script JSON array now."
    raw = await call_llm_fn(NOTEBOOK_AUDIO_PROMPT, user_prompt, max_tokens=1600, temperature=0.3)
    script = parse_json_fn(raw) if parse_json_fn else json.loads(raw)
    if not isinstance(script, list):
        script = script.get("script") if isinstance(script, dict) else []
    return JSONResponse({"script": script})
