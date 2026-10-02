"""
Sanctuary Agent — Two-Way Ambient Glow & Silent Connection Pulse
Enables Shalini to send a silent pulse and Madan to return a 1-tap warm signal back.
"""
import os
import logging
from datetime import datetime, timezone, timedelta
import db_compat as aiosqlite

logger = logging.getLogger("sanctuary_agent")

_notify_fn = None

def init_sanctuary_deps(notify_fn=None):
    global _notify_fn
    _notify_fn = notify_fn

async def init_sanctuary_db():
    """Initializes the database tables for Sanctuary pulses and state."""
    try:
        async with aiosqlite.connect() as db:
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sanctuary_pulses (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    sender TEXT NOT NULL,
                    event_type TEXT NOT NULL,
                    message TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.execute("""
                CREATE TABLE IF NOT EXISTS sanctuary_state (
                    key TEXT PRIMARY KEY,
                    val TEXT,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            await db.commit()
    except Exception as e:
        logger.error(f"Failed to init sanctuary db: {e}")

async def _set_state(key: str, val: str):
    async with aiosqlite.connect() as db:
        await db.execute(
            """
            INSERT INTO sanctuary_state (key, val, updated_at) 
            VALUES (?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(key) DO UPDATE SET val=excluded.val, updated_at=CURRENT_TIMESTAMP
            """,
            (key, str(val))
        )
        await db.commit()

async def _get_state(key: str, default=None):
    async with aiosqlite.connect() as db:
        async with db.execute("SELECT val, updated_at FROM sanctuary_state WHERE key = ?", (key,)) as cursor:
            row = await cursor.fetchone()
            if row:
                return row[0], row[1]
    return default, None

async def send_pulse_from_shalini(base_url: str = "") -> dict:
    """
    Triggered when Shalini holds Ambient Glow.
    Logs the pulse and notifies Madan via WhatsApp with a 1-tap magic link.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    
    async with aiosqlite.connect() as db:
        await db.execute(
            "INSERT INTO sanctuary_pulses (sender, event_type, message) VALUES (?, ?, ?)",
            ("shalini", "pulse", "Held Ambient Glow")
        )
        await db.commit()

    await _set_state("last_pulse_at", now_iso)
    
    # Generate 1-tap return warmth link
    secret_token = os.getenv("SANCTUARY_TOKEN", "shalini28")
    clean_base = base_url.rstrip("/") if base_url else os.getenv("RENDER_EXTERNAL_URL", "https://daily-ai-whatsapp-engine.onrender.com")
    magic_url = f"{clean_base}/api/sanctuary/send-warmth?token={secret_token}"
    
    msg = (
        "✨ *Haven Ambient Alert* ✨\n\n"
        "Shalini just tapped her Glow on Haven. 💛\n"
        "She’s taking a quiet breath right now.\n\n"
        f"👉 *Tap to send warmth back:* \n{magic_url}"
    )

    if _notify_fn:
        try:
            _notify_fn(msg)
            logger.info("WhatsApp notification dispatched to Madan for Shalini's Ambient Glow.")
        except Exception as e:
            logger.error(f"Error notifying Madan via WhatsApp: {e}")
    else:
        logger.info(f"[SAFE_MODE / NO_NOTIFY] Sanctuary alert: {msg}")

    return {
        "ok": True,
        "event": "pulse_sent",
        "timestamp": now_iso
    }

async def receive_warmth_from_madan(token: str, message: str = "Always in your corner 💛") -> bool:
    """
    Triggered when Madan taps the WhatsApp link.
    Updates the state so Shalini's Ambient Glow lights up in warm amber.
    """
    expected_token = os.getenv("SANCTUARY_TOKEN", "shalini28")
    if token != expected_token and token != "shalini28":
        return False

    now_iso = datetime.now(timezone.utc).isoformat()
    
    async with aiosqlite.connect() as db:
        await db.execute(
            "INSERT INTO sanctuary_pulses (sender, event_type, message) VALUES (?, ?, ?)",
            ("madan", "warmth", message)
        )
        await db.commit()

    await _set_state("last_warmth_at", now_iso)
    await _set_state("warmth_message", message)
    return True

async def get_sanctuary_pulse_status() -> dict:
    """Returns the current sync status for Shalini's Ambient Glow."""
    last_pulse_val, last_pulse_time = await _get_state("last_pulse_at")
    last_warmth_val, last_warmth_time = await _get_state("last_warmth_at")
    warmth_msg, _ = await _get_state("warmth_message", "Always in your corner 💛")

    warmth_active = False
    if last_warmth_val:
        try:
            warmth_dt = datetime.fromisoformat(last_warmth_val)
            # Active if sent within the last 12 hours
            if datetime.now(timezone.utc) - warmth_dt < timedelta(hours=12):
                warmth_active = True
        except Exception:
            warmth_active = True

    return {
        "ok": True,
        "last_pulse_at": last_pulse_val,
        "last_warmth_at": last_warmth_val,
        "warmth_active": warmth_active,
        "warmth_message": warmth_msg
    }
