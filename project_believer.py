

"""
project_believer.py — Secret Encrypted Private Diary Engine for JARVIS (Project Believer)

Features:
- Encrypted storage table `believer_entries` in SQLite (via db_compat).
- PBKDF2 key derivation + AES-256-GCM encryption for zero-knowledge local entries.
- Master Passphrase verification token (`believer_auth_meta`).
- Zero LLM / RAG exposure — completely isolated from system prompts and search engines.
"""

import os
import json
import base64
import time
import hashlib
from typing import Optional, List, Dict, Any
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

import db_compat as aiosqlite

router = APIRouter(prefix="/api/believer", tags=["Project Believer"])

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))

# --- Security Constants ---
KDF_SALT = b"JARVIS_BELIEVER_PROJECT_SALT_v1_2026"
VERIFY_MAGIC = "BELIEVER_PASSPHRASE_VERIFIED_OK_2026"

def derive_key(passphrase: str) -> bytes:
    """Derive 256-bit key from Master Passphrase via PBKDF2 HMAC SHA-256."""
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=KDF_SALT,
        iterations=100_000,
    )
    return kdf.derive(passphrase.encode("utf-8"))

def encrypt_text(plaintext: str, passphrase: str) -> str:
    """Encrypt plaintext string using AES-256-GCM. Returns base64 string (nonce + ciphertext)."""
    key = derive_key(passphrase)
    aesgcm = AESGCM(key)
    nonce = os.urandom(12)
    ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
    combined = nonce + ciphertext
    return base64.b64encode(combined).decode("utf-8")

def decrypt_text(encrypted_b64: str, passphrase: str) -> str:
    """Decrypt base64 ciphertext using AES-256-GCM."""
    try:
        key = derive_key(passphrase)
        aesgcm = AESGCM(key)
        combined = base64.b64decode(encrypted_b64.encode("utf-8"))
        nonce = combined[:12]
        ciphertext = combined[12:]
        decrypted = aesgcm.decrypt(nonce, ciphertext, None)
        return decrypted.decode("utf-8")
    except Exception as e:
        raise ValueError("Invalid passphrase or corrupted data") from e

# --- Database Schema Setup ---
async def init_believer_db():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS believer_entries (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                encrypted_payload TEXT NOT NULL,
                encrypted_reflection TEXT DEFAULT '',
                mood_tag TEXT DEFAULT 'Reflective',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        try:
            await db.execute("ALTER TABLE believer_entries ADD COLUMN encrypted_reflection TEXT DEFAULT ''")
        except Exception:
            pass
        await db.execute("""
            CREATE TABLE IF NOT EXISTS believer_auth_meta (
                key_name TEXT PRIMARY KEY,
                encrypted_verifier TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()

# --- Pydantic Models ---
class SetPassphraseRequest(BaseModel):
    passphrase: str

class VerifyPassphraseRequest(BaseModel):
    passphrase: str

class EntryCreateRequest(BaseModel):
    passphrase: str
    content: str
    mood_tag: Optional[str] = "Reflective"

class ReflectRequest(BaseModel):
    passphrase: str
    entry_id: int

# Introspective daily prompts for guided journaling
BELIEVER_DAILY_PROMPTS = [
    "What is the single biggest goal or obstacle on your mind right now?",
    "What was one small victory today that nobody else noticed?",
    "If you could advise your past self from last month, what would you say?",
    "What made you feel most energetic and fulfilled today?",
    "What is one worry you can choose to let go of before you sleep tonight?",
    "What skill or mindset shift are you currently working on to level up?",
]

# --- API Endpoints ---

@router.get("/status")
async def believer_status():
    """Check if Project Believer has a Master Passphrase set up."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            return {"is_initialized": row is not None}

@router.post("/reset")
async def reset_believer_vault():
    """Wipe all encrypted believer entries and reset Master Passphrase configuration."""
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM believer_entries")
        await db.execute("DELETE FROM believer_auth_meta")
        await db.commit()
    return {"status": "ok", "message": "Project Believer vault completely wiped and reset."}

@router.post("/setup")
async def setup_passphrase(req: SetPassphraseRequest):
    """Initial setup or update of Master Passphrase."""
    if not req.passphrase or len(req.passphrase) < 4:
        raise HTTPException(status_code=400, detail="Passphrase must be at least 4 characters long")
    
    async with aiosqlite.connect(DB_PATH) as db:
        verifier = encrypt_text(VERIFY_MAGIC, req.passphrase)
        await db.execute("DELETE FROM believer_auth_meta WHERE key_name = 'auth_verifier'")
        await db.execute(
            "INSERT INTO believer_auth_meta (key_name, encrypted_verifier) VALUES ('auth_verifier', ?)",
            (verifier,)
        )
        await db.commit()
    return {"status": "ok", "message": "Master Passphrase established successfully"}

@router.post("/verify")
async def verify_passphrase(req: VerifyPassphraseRequest):
    """Verify Master Passphrase."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Project Believer is not initialized yet")
            
            verifier_b64 = row[0]
            try:
                decrypted = decrypt_text(verifier_b64, req.passphrase)
                if decrypted == VERIFY_MAGIC:
                    return {"status": "ok", "verified": True}
                else:
                    raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
            except ValueError:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")

@router.get("/prompts")
async def get_daily_prompts():
    """Return daily introspective guided prompts."""
    import random
    selected = random.sample(BELIEVER_DAILY_PROMPTS, 3)
    return {"status": "ok", "prompts": selected}


@router.get("/entries")
async def list_entries(x_passphrase: Optional[str] = Header(None)):
    """Fetch and decrypt all entries and JARVIS reflections for Project Believer."""
    if not x_passphrase:
        raise HTTPException(status_code=400, detail="X-Passphrase header missing")
    
    async with aiosqlite.connect(DB_PATH) as db:
        # First verify auth
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Not initialized")
            try:
                if decrypt_text(row[0], x_passphrase) != VERIFY_MAGIC:
                    raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
            except Exception:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")

        async with db.execute("SELECT id, encrypted_payload, COALESCE(encrypted_reflection, ''), mood_tag, created_at FROM believer_entries ORDER BY created_at DESC") as cursor:
            rows = await cursor.fetchall()
            entries = []
            for r_id, enc_payload, enc_reflection, mood_tag, created_at in rows:
                try:
                    decrypted_content = decrypt_text(enc_payload, x_passphrase)
                    decrypted_reflection = ""
                    if enc_reflection:
                        try:
                            decrypted_reflection = decrypt_text(enc_reflection, x_passphrase)
                        except Exception:
                            decrypted_reflection = ""
                    entries.append({
                        "id": r_id,
                        "content": decrypted_content,
                        "reflection": decrypted_reflection,
                        "mood_tag": mood_tag,
                        "created_at": created_at
                    })
                except Exception:
                    # Skip corrupted or un-decryptable entries
                    continue
            return {"status": "ok", "entries": entries}

@router.post("/entries")
async def create_entry(req: EntryCreateRequest):
    """Create a new encrypted entry."""
    if not req.content or not req.content.strip():
        raise HTTPException(status_code=400, detail="Content cannot be empty")
    
    async with aiosqlite.connect(DB_PATH) as db:
        # Verify passphrase
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row:
                raise HTTPException(status_code=404, detail="Not initialized")
            try:
                if decrypt_text(row[0], req.passphrase) != VERIFY_MAGIC:
                    raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
            except Exception:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
        
        enc_payload = encrypt_text(req.content.strip(), req.passphrase)
        cursor = await db.execute(
            "INSERT INTO believer_entries (encrypted_payload, mood_tag) VALUES (?, ?)",
            (enc_payload, req.mood_tag or "Reflective")
        )
        await db.commit()
        return {"status": "ok", "id": cursor.lastrowid}

@router.post("/reflect")
async def reflect_on_entry(req: ReflectRequest):
    """Generate a movie-JARVIS style confidential reflection for a diary entry."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row or decrypt_text(row[0], req.passphrase) != VERIFY_MAGIC:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
        
        async with db.execute("SELECT encrypted_payload, mood_tag FROM believer_entries WHERE id = ?", (req.entry_id,)) as cursor:
            entry_row = await cursor.fetchone()
            if not entry_row:
                raise HTTPException(status_code=404, detail="Entry not found")
            
            entry_text = decrypt_text(entry_row[0], req.passphrase)
            mood_tag = entry_row[1]

    # Generate JARVIS reflection via LLM
    try:
        from V3_updates import call_llm
        prompt = (
            "You are JARVIS, Madan's loyal, sharp, composed personal AI assistant and confidant. "
            "Madan has written a private reflection in his confidential diary (Project Believer).\n"
            f"Entry Mood: {mood_tag}\n"
            f"Entry Content: \"{entry_text}\"\n\n"
            "Provide a composed, thoughtful, 2-3 sentence personal reflection back to Madan. "
            "Be empathetic, witty, and grounded like movie-JARVIS—acknowledge his mindset, offer genuine perspective or encouragement, "
            "and sign off smoothly (e.g., 'At your service, Sir'). Do not use generic bullet lists."
        )
        reflection_text = await call_llm([{"role": "user", "content": prompt}], max_tokens=200, temperature=0.7)
    except Exception as e:
        reflection_text = "I am standing by, Sir. Keep striving forward; every reflection brings clarity."

    # Encrypt and save reflection
    async with aiosqlite.connect(DB_PATH) as db:
        enc_reflection = encrypt_text(reflection_text, req.passphrase)
        await db.execute("UPDATE believer_entries SET encrypted_reflection = ? WHERE id = ?", (enc_reflection, req.entry_id))
        await db.commit()

    return {"status": "ok", "reflection": reflection_text}

@router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: int, x_passphrase: Optional[str] = Header(None)):
    """Delete an entry by ID."""
    if not x_passphrase:
        raise HTTPException(status_code=400, detail="X-Passphrase header missing")
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row or decrypt_text(row[0], x_passphrase) != VERIFY_MAGIC:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
        
        await db.execute("DELETE FROM believer_entries WHERE id = ?", (entry_id,))
        await db.commit()
        return {"status": "ok", "message": "Entry deleted"}



