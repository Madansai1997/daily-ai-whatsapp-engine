"""
FastAPI Router for PDF RAG, NotebookLM Studio & Data Analyst Pyodide Sandbox
"""
import os
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

router = APIRouter(tags=["PDF RAG & Analyst Studio"])


@router.get("/api/pdf-rag/docs")
async def get_pdf_rag_docs_api():
    return JSONResponse({"ok": True, "documents": []})
