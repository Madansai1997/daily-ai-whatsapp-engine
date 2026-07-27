"""
FastAPI Router for System Health, Settings, Notifications, Web Push, and Metrics
"""
import os
import time
import json
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, HTMLResponse

router = APIRouter(tags=["System & Settings"])


@router.get("/health/status")
async def health_status_api():
    return JSONResponse({"status": "healthy", "service": "JARVIS AI Engine", "timestamp": time.time()})


@router.get("/health/mem")
async def health_mem_api():
    import psutil
    process = psutil.Process(os.getpid())
    rss_mb = process.memory_info().rss / (1024 * 1024)
    return JSONResponse({
        "status": "ok",
        "rss_mb": round(rss_mb, 2),
        "pid": os.getpid(),
        "timestamp": time.time()
    })


@router.get("/ping")
@router.head("/ping")
async def ping_api():
    return JSONResponse({"ping": "pong"})


from deploy_watcher_agent import get_system_health_report

@router.get("/api/deploy-watcher/status")
async def deploy_watcher_status_api():
    report = await get_system_health_report()
    return JSONResponse({"ok": True, "report": report})
