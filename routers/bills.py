"""
FastAPI Router for Bills & Subscriptions Watcher
"""
import os
import db_compat as aiosqlite
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from bill_watcher import list_view, mark_paid_by_id, delete_by_id, add_bill

router = APIRouter(tags=["Bills Watcher"])


@router.get("/api/bills")
async def get_bills_api():
    view = await list_view()
    return JSONResponse({"ok": True, **view})


@router.post("/api/bills")
async def add_bill_api(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        return JSONResponse({"ok": False, "error": "Bill name required"}, status_code=400)
    bill_id = await add_bill(
        name=name,
        amount=float(body.get("amount", 0)),
        due_day=body.get("due_day"),
        due_date=body.get("due_date"),
        recurrence=body.get("recurrence", "monthly"),
        currency=body.get("currency", "₹"),
        notify_days_before=int(body.get("notify_days_before", 3))
    )
    return JSONResponse({"ok": True, "bill_id": bill_id})


@router.post("/api/bills/{bill_id}/paid")
async def mark_bill_paid_api(bill_id: int):
    ok, msg = await mark_paid_by_id(bill_id)
    return JSONResponse({"ok": ok, "message": msg})


@router.post("/api/bills/{bill_id}/delete")
async def delete_bill_api(bill_id: int):
    ok = await delete_by_id(bill_id)
    return JSONResponse({"ok": ok})
