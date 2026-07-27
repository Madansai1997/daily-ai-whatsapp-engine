"""
FastAPI Router for Daily Digest, Study Tracks, Feynman Technique & Flashcards
"""
import os
import json
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse

router = APIRouter(tags=["Study & Daily Digest"])


@router.get("/api/study/tracks")
async def get_study_tracks_api():
    return JSONResponse({
        "ok": True,
        "tracks": [
            {"id": "data_analyst", "name": "Data Analyst Mastery", "active": True},
            {"id": "gen_ai", "name": "GenAI & Agentic Systems", "active": True},
            {"id": "system_design", "name": "System Architecture & Engineering", "active": True}
        ]
    })


@router.get("/api/study/current")
async def get_current_study_api():
    return JSONResponse({"ok": True, "active_track": "data_analyst"})
