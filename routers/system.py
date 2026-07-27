"""
FastAPI Router for External Cron Endpoints & Background Triggers
"""
import os
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from deploy_watcher_agent import check_deploys_and_notify

router = APIRouter(tags=["Crons & Background Jobs"])

# External trigger secret check
CRON_SECRET = os.environ.get("CLAUDE_CODE_TRIGGER_SECRET", "").strip()

def _verify_cron_token(request: Request) -> bool:
    if not CRON_SECRET:
        return True # Default open if secret unconfigured in dev
    token = request.query_params.get("token") or request.headers.get("X-Cron-Token") or ""
    return token.strip() == CRON_SECRET


@router.post("/cron/deploy-watcher")
async def cron_deploy_watcher_api(request: Request):
    """External cron trigger for deploy and health watcher."""
    if not _verify_cron_token(request):
        return JSONResponse({"ok": False, "error": "Unauthorized cron token"}, status_code=401)

    res = await check_deploys_and_notify()
    return JSONResponse({"ok": True, "result": res})
