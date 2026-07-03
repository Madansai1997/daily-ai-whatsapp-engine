"""
Deadline / Bill Watcher — Phase 5 agent, self-contained module.

Tracks recurring bills and one-off deadlines (rent, EMIs, subscriptions, renewals) with an
amount and a due date, and warns ahead of time. Sibling to reminders.py/automations.py but
domain-specific: it knows about money owed and recurring monthly due-days, and answers
"what's due soon / how much do I owe this month".

Own table, own logic. Notifications go through the engine's notify_fn (JARVIS web inbox +
push) — no third-party send, so no approval-hold needed. Natural-language add/list/pay/delete
is routed by the shared AI intent classifier in V3_updates.py (BILL_ACTION), never hardcoded.
"""

import os
import calendar
from datetime import datetime, date, timedelta, timezone

import db_compat as aiosqlite

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

DEFAULT_CURRENCY = "₹"
VALID_RECURRENCE = ("monthly", "once", "yearly")


def init_bill_watcher_tables():
    """Sync, mirrors the other init_*_tables() — called once at startup."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS bills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        amount REAL DEFAULT 0,
        currency TEXT DEFAULT '₹',
        recurrence TEXT DEFAULT 'monthly',   -- monthly | once | yearly
        due_day INTEGER,                      -- 1-31, for monthly
        due_date TEXT,                        -- ISO date, for once / yearly reference
        category TEXT,
        notify_days_before INTEGER DEFAULT 3,
        active INTEGER DEFAULT 1,
        last_notified_cycle TEXT,             -- ISO date of the occurrence last notified
        paid_cycle TEXT,                      -- ISO date of the occurrence marked paid
        created_at TEXT)''')
    # Migration: add paid_cycle to a pre-existing bills table if missing.
    try:
        cols = [r[1] for r in cur.execute("PRAGMA table_info(bills)").fetchall()]
        if "paid_cycle" not in cols:
            cur.execute("ALTER TABLE bills ADD COLUMN paid_cycle TEXT")
    except Exception:
        pass
    conn.commit()
    conn.close()
    print("✅ Bill Watcher tables ready.")


# ── date math ─────────────────────────────────────────────────────────────────

def _clamp_day(year: int, month: int, day: int) -> date:
    last = calendar.monthrange(year, month)[1]
    return date(year, month, min(day, last))


def _base_occurrence(bill: dict, today: date) -> date | None:
    """The next raw occurrence on/after today, ignoring paid status."""
    rec = (bill.get("recurrence") or "monthly").lower()
    if rec == "once":
        try:
            return date.fromisoformat((bill.get("due_date") or "")[:10])
        except Exception:
            return None
    if rec == "yearly":
        try:
            ref = date.fromisoformat((bill.get("due_date") or "")[:10])
        except Exception:
            return None
        cand = _clamp_day(today.year, ref.month, ref.day)
        if cand < today:
            cand = _clamp_day(today.year + 1, ref.month, ref.day)
        return cand
    # monthly
    dd = int(bill.get("due_day") or 1)
    cand = _clamp_day(today.year, today.month, dd)
    if cand < today:
        ny, nm = (today.year + (1 if today.month == 12 else 0), 1 if today.month == 12 else today.month + 1)
        cand = _clamp_day(ny, nm, dd)
    return cand


def _roll(occurrence: date, bill: dict) -> date:
    """Advance one period past `occurrence` (for recurring bills)."""
    rec = (bill.get("recurrence") or "monthly").lower()
    if rec == "yearly":
        return _clamp_day(occurrence.year + 1, occurrence.month, occurrence.day)
    ny, nm = (occurrence.year + (1 if occurrence.month == 12 else 0),
              1 if occurrence.month == 12 else occurrence.month + 1)
    return _clamp_day(ny, nm, int(bill.get("due_day") or occurrence.day))


def next_due(bill: dict, today: date = None) -> date | None:
    """The next UNPAID occurrence on/after today. If the base occurrence was marked paid,
    a recurring bill rolls to the following period."""
    today = today or datetime.now(timezone.utc).date()
    base = _base_occurrence(bill, today)
    if not base:
        return None
    if bill.get("paid_cycle") == base.isoformat() and (bill.get("recurrence") or "monthly").lower() != "once":
        return _roll(base, bill)
    return base


# ── CRUD ──────────────────────────────────────────────────────────────────────

async def add_bill(name: str, amount: float = 0, recurrence: str = "monthly",
                    due_day: int = None, due_date: str = None, currency: str = None,
                    category: str = None, notify_days_before: int = 3) -> tuple:
    name = (name or "").strip()
    if not name:
        return False, "What's the bill called? e.g. \"add electricity ₹1200 due on the 5th monthly\"."
    recurrence = (recurrence or "monthly").lower()
    if recurrence not in VALID_RECURRENCE:
        recurrence = "monthly"
    if recurrence == "monthly" and not due_day:
        return False, f"Which day of the month is *{name}* due? e.g. \"due on the 5th\"."
    if recurrence in ("once", "yearly") and not due_date:
        return False, f"What date is *{name}* due? e.g. \"due on 2026-08-15\"."
    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO bills (name, amount, currency, recurrence, due_day, due_date,
                                  category, notify_days_before, active, created_at)
               VALUES (?,?,?,?,?,?,?,?,1,?)""",
            (name, float(amount or 0), currency or DEFAULT_CURRENCY, recurrence,
             int(due_day) if due_day else None, due_date, category,
             int(notify_days_before or 3), now))
        await db.commit()
    bill = {"recurrence": recurrence, "due_day": due_day, "due_date": due_date}
    nd = next_due(bill)
    when = nd.strftime("%d %b") if nd else "—"
    amt = f"{currency or DEFAULT_CURRENCY}{_fmt_amt(amount)}" if amount else ""
    return True, f"💸 Tracking *{name}* {amt} — next due *{when}* ({recurrence})."


async def list_bills(active_only: bool = True) -> list:
    q = "SELECT * FROM bills"
    if active_only:
        q += " WHERE active = 1"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(q)
        rows = [dict(r) for r in await cur.fetchall()]
    rows.sort(key=lambda b: (next_due(b) or date.max))
    return rows


async def upcoming(days: int = 7) -> list:
    """Active bills whose next occurrence is within `days` — each annotated with due date."""
    today = datetime.now(timezone.utc).date()
    out = []
    for b in await list_bills(active_only=True):
        nd = next_due(b, today)
        if nd and 0 <= (nd - today).days <= days:
            out.append({**b, "next_due": nd.isoformat(), "days_until": (nd - today).days})
    out.sort(key=lambda b: b["days_until"])
    return out


async def _find_one(query: str) -> dict | None:
    like = f"%{(query or '').strip().lower()}%"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM bills WHERE active = 1 AND lower(name) LIKE ?", (like,))
        rows = [dict(r) for r in await cur.fetchall()]
    return rows[0] if len(rows) == 1 else (None if not rows else rows[0])


async def _pay(b: dict):
    """Mark bill `b`'s current occurrence paid: one-offs deactivate; recurring bills record the
    paid occurrence so next_due rolls to the following period."""
    today = datetime.now(timezone.utc).date()
    base = _base_occurrence(b, today)
    async with aiosqlite.connect(DB_PATH) as db:
        if (b.get("recurrence") or "monthly").lower() == "once":
            await db.execute("UPDATE bills SET active = 0 WHERE id = ?", (b["id"],))
        else:
            await db.execute("UPDATE bills SET paid_cycle = ? WHERE id = ?",
                             (base.isoformat() if base else None, b["id"]))
        await db.commit()


async def mark_paid(query: str) -> tuple:
    b = await _find_one(query)
    if not b:
        return False, f"I couldn't find a bill matching \"{query}\"."
    await _pay(b)
    return True, f"✅ Marked *{b['name']}* paid for this cycle."


async def _get_by_id(bill_id: int) -> dict | None:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM bills WHERE id = ?", (bill_id,))
        row = await cur.fetchone()
    return dict(row) if row else None


async def mark_paid_by_id(bill_id: int) -> tuple:
    b = await _get_by_id(bill_id)
    if not b:
        return False, "That bill no longer exists."
    await _pay(b)
    return True, f"Marked {b['name']} paid."


async def delete_by_id(bill_id: int) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM bills WHERE id = ?", (bill_id,))
        await db.commit()
    return True


async def list_view() -> dict:
    """Enriched list for the UI: each bill with next_due/days_until, plus totals & due-soon count."""
    today = datetime.now(timezone.utc).date()
    bills = await list_bills(active_only=True)
    out, total, due_soon = [], 0.0, 0
    for b in bills:
        nd = next_due(b, today)
        days = (nd - today).days if nd else None
        window = int(b.get("notify_days_before") or 3)
        if days is not None and 0 <= days <= window:
            due_soon += 1
        total += float(b.get("amount") or 0)
        out.append({
            "id": b["id"], "name": b["name"], "amount": b.get("amount") or 0,
            "currency": b.get("currency") or DEFAULT_CURRENCY,
            "recurrence": b.get("recurrence") or "monthly",
            "due_day": b.get("due_day"), "due_date": b.get("due_date"),
            "category": b.get("category"), "notify_days_before": window,
            "next_due": nd.isoformat() if nd else None, "days_until": days,
        })
    return {"bills": out, "total": round(total, 2), "currency": DEFAULT_CURRENCY, "due_soon": due_soon}


async def delete_bill(query: str) -> tuple:
    b = await _find_one(query)
    if not b:
        return False, f"I couldn't find a bill matching \"{query}\"."
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM bills WHERE id = ?", (b["id"],))
        await db.commit()
    return True, f"🗑️ Removed *{b['name']}* from your bills."


# ── notify + format ─────────────────────────────────────────────────────────────

def _fmt_amt(a) -> str:
    try:
        a = float(a)
        return f"{a:,.0f}" if a == int(a) else f"{a:,.2f}"
    except Exception:
        return str(a or "")


def format_bills(bills: list) -> str:
    if not bills:
        return "📭 No bills tracked yet. Try: \"add rent ₹15000 due on the 1st monthly\"."
    today = datetime.now(timezone.utc).date()
    total = 0.0
    lines = ["💸 *Your bills:*"]
    for b in bills:
        nd = next_due(b, today)
        when = nd.strftime("%d %b") if nd else "—"
        amt = f"{b.get('currency') or DEFAULT_CURRENCY}{_fmt_amt(b.get('amount'))}" if b.get("amount") else ""
        total += float(b.get("amount") or 0)
        lines.append(f"• *{b['name']}* {amt} — due {when} ({b.get('recurrence')})")
    if total:
        lines.append(f"\n_Total tracked: {DEFAULT_CURRENCY}{_fmt_amt(total)}_")
    return "\n".join(lines)


async def check_bills_and_notify(notify_fn=None) -> int:
    """Daily: warn about active bills due within their notify window, once per occurrence.
    Returns how many alerts were sent."""
    if not notify_fn:
        return 0
    today = datetime.now(timezone.utc).date()
    sent = 0
    for b in await list_bills(active_only=True):
        nd = next_due(b, today)
        if not nd:
            continue
        days_until = (nd - today).days
        window = int(b.get("notify_days_before") or 3)
        if 0 <= days_until <= window and b.get("last_notified_cycle") != nd.isoformat():
            amt = f"{b.get('currency') or DEFAULT_CURRENCY}{_fmt_amt(b.get('amount'))}" if b.get("amount") else ""
            when = "today" if days_until == 0 else ("tomorrow" if days_until == 1 else f"in {days_until} days")
            try:
                notify_fn(f"💸 *{b['name']}* {amt} is due *{when}* ({nd.strftime('%d %b')}). "
                          f"Reply \"mark {b['name']} paid\" once done.", "bills")
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute("UPDATE bills SET last_notified_cycle = ? WHERE id = ?",
                                     (nd.isoformat(), b["id"]))
                    await db.commit()
                sent += 1
            except Exception as e:
                print(f"⚠️ [bill_watcher] notify failed for {b.get('name')}: {e}")
    return sent
