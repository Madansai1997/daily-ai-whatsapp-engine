"""
FastAPI Router for Bills, Debts & Subscriptions Watcher with FX Conversion
"""
import os
import httpx
from datetime import datetime, timezone
import db_compat as aiosqlite
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from bill_watcher import list_view, mark_paid_by_id, delete_by_id, add_bill

router = APIRouter(tags=["Bills Watcher"])


@router.get("/api/bills")
async def get_bills_api():
    view = await list_view()
    return JSONResponse({"ok": True, **view})


@router.get("/api/bills/fx-rate")
async def get_fx_rate_api():
    """Fetches live USD -> INR exchange rate with resilient fallback."""
    rate = 87.20
    try:
        async with httpx.AsyncClient(timeout=4.0) as client:
            res = await client.get("https://open.er-api.com/v6/latest/USD")
            if res.status_code == 200:
                data = res.json()
                rate = float(data.get("rates", {}).get("INR", 87.20))
    except Exception:
        pass
    return JSONResponse({"ok": True, "usd_to_inr": round(rate, 2), "timestamp": datetime.now(timezone.utc).isoformat()})


@router.post("/api/bills")
async def add_bill_api(request: Request):
    body = await request.json()
    name = (body.get("name") or "").strip()
    if not name:
        return JSONResponse({"ok": False, "error": "Bill or debt name required"}, status_code=400)
    
    currency = body.get("currency", "₹")
    category = body.get("category", "bill") # "bill" | "debt"

    ok, msg = await add_bill(
        name=name,
        amount=float(body.get("amount", 0)),
        due_day=body.get("due_day"),
        due_date=body.get("due_date"),
        recurrence=body.get("recurrence", "monthly"),
        currency=currency,
        category=category,
        notify_days_before=int(body.get("notify_days_before", 3))
    )
    return JSONResponse({"ok": ok, "message": msg})


@router.post("/api/bills/{bill_id}/paid")
async def mark_bill_paid_api(bill_id: int):
    ok, msg = await mark_paid_by_id(bill_id)
    return JSONResponse({"ok": ok, "message": msg})


@router.post("/api/bills/{bill_id}/delete")
async def delete_bill_api(bill_id: int):
    ok = await delete_by_id(bill_id)
    return JSONResponse({"ok": ok})
