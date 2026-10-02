"""
FastAPI Router for JARVIS Learning Engine.
Exposes endpoints for:
 - Multi-LLM Perspective Synthesis & RAG Topic Exploration
 - Daily Socratic Flight Drills
 - Socratic Answer Diagnostic Grading
 - Dynamic SM-2 Mastery Radar & Scheduling
"""

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from typing import Optional, Dict, Any

import learning_engine

router = APIRouter(prefix="/api/learning", tags=["learning"])

class ExploreRequest(BaseModel):
    topic: str
    enable_rag: Optional[bool] = True

class SubmitDrillRequest(BaseModel):
    drill_id: int
    user_response: str

@router.post("/explore")
async def explore_topic(req: ExploreRequest):
    """Generates a 3-tier Multi-LLM Synthesis + Signal Filter + Vault RAG breakdown for any topic."""
    if not req.topic.strip():
        raise HTTPException(status_code=400, detail="Topic cannot be empty")
    return await learning_engine.explore_topic_synthesis(req.topic.strip(), enable_rag=req.enable_rag)

@router.get("/daily-drill")
async def get_daily_drill(topic: Optional[str] = Query(None)):
    """Retrieves or generates today's 10-minute Socratic Flight Drill."""
    return await learning_engine.generate_daily_drill(topic_override=topic)

@router.post("/submit-answer")
async def submit_drill_answer(req: SubmitDrillRequest):
    """Evaluates a Socratic drill solution and updates the SM-2 Mastery Radar."""
    if not req.user_response.strip():
        raise HTTPException(status_code=400, detail="Response cannot be empty")
    return await learning_engine.evaluate_user_drill(req.drill_id, req.user_response.strip())

@router.get("/mastery-radar")
async def get_mastery_radar():
    """Fetches verified mastery scores, shaky topics, and SM-2 upcoming schedules."""
    return await learning_engine.get_mastery_radar()
