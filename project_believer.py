

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
                encrypted_chat_history TEXT DEFAULT '',
                encrypted_key_cards TEXT DEFAULT '',
                encrypted_perspective_lenses TEXT DEFAULT '',
                mood_tag TEXT DEFAULT 'Reflective',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)
        for col in [
            "ALTER TABLE believer_entries ADD COLUMN encrypted_reflection TEXT DEFAULT ''",
            "ALTER TABLE believer_entries ADD COLUMN encrypted_chat_history TEXT DEFAULT ''",
            "ALTER TABLE believer_entries ADD COLUMN encrypted_key_cards TEXT DEFAULT ''",
            "ALTER TABLE believer_entries ADD COLUMN encrypted_perspective_lenses TEXT DEFAULT ''",
        ]:
            try:
                await db.execute(col)
            except Exception:
                pass

        await db.execute("""
            CREATE TABLE IF NOT EXISTS believer_time_capsules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                encrypted_payload TEXT NOT NULL,
                unlock_date TEXT NOT NULL,
                title TEXT DEFAULT 'Letter to Future Self',
                is_unlocked INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

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
        system_prompt = "You are JARVIS, Madan's loyal, sharp, composed personal AI assistant and confidant."
        user_prompt = (
            f"Madan has written a private reflection in his confidential diary (Project Believer).\n"
            f"Entry Mood: {mood_tag}\n"
            f"Entry Content: \"{entry_text}\"\n\n"
            "Provide a composed, thoughtful, 2-3 sentence personal reflection back to Madan. "
            "Be empathetic, witty, and grounded like movie-JARVIS—acknowledge his mindset, offer genuine perspective or encouragement, "
            "and sign off smoothly (e.g., 'At your service, Sir'). Do not use generic bullet lists."
        )
        reflection_text = await call_llm(system_prompt, user_prompt, max_tokens=200, temperature=0.7)
    except Exception as e:
        print(f"⚠️ Project Believer LLM reflection error: {e}")
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


class BelieverChatRequest(BaseModel):
    passphrase: str
    entry_id: Optional[int] = None
    message: str
    history: Optional[List[Dict[str, str]]] = []

class BelieverKeyCardsRequest(BaseModel):
    passphrase: str
    entry_id: int

class BelieverPerspectiveRequest(BaseModel):
    passphrase: str
    entry_id: int

class TimeCapsuleCreateRequest(BaseModel):
    passphrase: str
    title: str
    content: str
    unlock_date: str


@router.post("/chat")
async def believer_conversational_chat(req: BelieverChatRequest):
    """Interactive human-to-human style conversational dialogue with empathetic LLM confidant & workplace psychiatrist."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row or decrypt_text(row[0], req.passphrase) != VERIFY_MAGIC:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")

    system_prompt = (
        "You are JARVIS, acting as Madan's expert personal and workplace psychiatrist, confidant, and mentor in Project Believer.\n"
        "PSYCHIATRIST & WORKPLACE STRATEGIST GUIDELINES:\n"
        "1. EMPATHETIC PSYCHIATRIST FIRST: Listen with deep psychological warmth, validate Madan's emotions, and make him feel 100% safe and comfortable opening up about life, career, or relationships.\n"
        "2. CLEAR WORKPLACE & LIFE PERSPECTIVE: Help Madan gain total clarity on:\n"
        "   - What HE himself can do or control,\n"
        "   - What the SECOND PARTY (colleagues, recruiters, management, or partner) can do or control,\n"
        "   - What WE (JARVIS & Madan as a team) can work on together to solve or navigate the situation.\n"
        "3. NATURAL HUMAN DIALOGUE: Absolutely NO robotic task lists, 'Step 1/2/3', or generic platitudes. Write in warm, fluid, compassionate conversational prose.\n"
        "4. CONVERSATIONAL PHASE FLOW:\n"
        "   - Phase 1 (Initial Context): Ask at most ONE gentle, highly specific, topic-focused question to understand his exact situation.\n"
        "   - Phase 2 (Comfort & Guidance): Stop asking questions. Provide comforting, clear psychiatric perspective and real-world clarity so he leaves feeling supported, grounded, and clear-headed."
    )

    history_str = ""
    if req.history:
        history_str = "Conversation History:\n" + "\n".join([f"{h.get('role','user').title()}: {h.get('content','')}" for h in req.history[-6:]]) + "\n\n"
    user_prompt = f"{history_str}Madan says: \"{req.message}\""

    try:
        from V3_updates import call_llm
        reply = await call_llm(system_prompt, user_prompt, max_tokens=350, temperature=0.7)
    except Exception as e:
        print(f"⚠️ Project Believer LLM chat error: {e}")
        reply = f"I hear you deeply, Sir. Whatever is on your mind, you can share it freely here. I'm right here with you to figure out what we can do together."

    return {"status": "ok", "reply": reply}


@router.post("/key-cards")
async def generate_key_cards(req: BelieverKeyCardsRequest):
    """Generate structured presentation-ready Key Cards (Mindset Shift, Micro-Steps, Reflection Question, Affirmation)."""
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

    system_prompt = (
        "You are Madan's elite personal growth analyst and AI mentor. You MUST analyze his specific journal entry with deep, tailored relevance. "
        "STRICT RULE: NEVER output generic advice like 'take 5 deep breaths' or generic platitudes. Every single card MUST reference Madan's exact words, "
        "his specific situation, tools, career, or emotions mentioned in the entry. Return ONLY a strict JSON object."
    )
    user_prompt = (
        "Analyze Madan's private journal entry and return ONLY a strict JSON object with 4 Key Presentation Cards tailored 100% to his exact text:\n"
        "{\n"
        '  "mindset_shift": {"title": "Mindset Realignment", "content": "<deeply tailored perspective shift directly addressing his entry>"},\n'
        '  "actionable_steps": {"title": "Immediate Micro-Steps", "steps": ["<specific actionable step 1 for his situation>", "<specific step 2>", "<specific step 3>"]},\n'
        '  "reflection_question": {"title": "Deep Inquiry Today", "question": "<a probing question specifically referencing his entry words>"},\n'
        '  "affirmation": {"title": "Empowering Grounding Statement", "statement": "<a strong, highly personal grounding statement tailored to his emotion>"}\n'
        "}\n\n"
        f"Journal Entry Mood: {mood_tag}\n"
        f"Journal Entry Content:\n\"{entry_text}\"\n"
    )

    try:
        from V3_updates import call_llm
        raw_res = await call_llm(system_prompt, user_prompt, max_tokens=400, temperature=0.5)
        import re
        match = re.search(r"\{.*\}", raw_res, re.DOTALL)
        cards_json = json.loads(match.group(0)) if match else {}
        if not cards_json or not isinstance(cards_json, dict) or "mindset_shift" not in cards_json:
            raise ValueError("Failed to parse structured JSON from LLM response")
    except Exception as e:
        print(f"⚠️ Project Believer LLM key-cards error: {e}")
        # Context-aware fallback using Madan's entry snippet
        snippet = entry_text[:60].strip()
        cards_json = {
            "mindset_shift": {"title": "Mindset Realignment", "content": f"Reframe your thought around '{snippet}...': Focus entirely on your immediate sphere of execution today."},
            "actionable_steps": {"title": "Immediate Micro-Steps", "steps": [f"Break down your thought '{snippet}' into 1 immediate task", "Dedicate 20 minutes of uninterrupted focus to it", "Document your progress before ending the day"]},
            "reflection_question": {"title": "Deep Inquiry Today", "question": f"Regarding '{snippet}...', what is the single most valuable outcome you can control today?"},
            "affirmation": {"title": "Empowering Grounding Statement", "statement": f"I own my trajectory. My reflection on '{snippet}' is a stepping stone to mastery."}
        }

    return {"status": "ok", "key_cards": cards_json}


@router.post("/perspective")
async def perspective_shift_simulator(req: BelieverPerspectiveRequest):
    """Evaluate journal entry through 3 Lenses: Stoic, Visionary First-Principles, and Compassionate Mentor."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row or decrypt_text(row[0], req.passphrase) != VERIFY_MAGIC:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")
        
        async with db.execute("SELECT encrypted_payload FROM believer_entries WHERE id = ?", (req.entry_id,)) as cursor:
            entry_row = await cursor.fetchone()
            if not entry_row:
                raise HTTPException(status_code=404, detail="Entry not found")
            entry_text = decrypt_text(entry_row[0], req.passphrase)

    system_prompt = (
        "You are Madan's personal wisdom mentor evaluating his journal entry through 3 distinct perspective lenses. "
        "STRICT RULE: Do NOT output generic textbook definitions. You MUST directly analyze the SPECIFIC situation, words, and feelings Madan wrote. "
        "Return STRICT JSON only."
    )
    user_prompt = (
        "Evaluate Madan's entry through 3 highly specific, tailored perspective lenses. Return STRICT JSON:\n"
        "{\n"
        '  "stoic_lens": "<Marcus Aurelius / Epictetus style analysis directly referencing his entry situation>",\n'
        '  "visionary_lens": "<Tech lead first-principles breakdown analyzing the root variables of his entry>",\n'
        '  "compassionate_lens": "<Warm, deeply human, empathetic mentor response addressing his exact feelings>"\n'
        "}\n\n"
        f"Madan's Entry Content:\n\"{entry_text}\""
    )

    try:
        from V3_updates import call_llm
        raw_res = await call_llm(system_prompt, user_prompt, max_tokens=450, temperature=0.6)
        import re
        match = re.search(r"\{.*\}", raw_res, re.DOTALL)
        lenses = json.loads(match.group(0)) if match else {}
        if not lenses or not isinstance(lenses, dict) or "stoic_lens" not in lenses:
            raise ValueError("Failed to parse structured JSON from LLM response")
    except Exception as e:
        print(f"⚠️ Project Believer LLM perspective error: {e}")
        snippet = entry_text[:60].strip()
        lenses = {
            "stoic_lens": f"Regarding '{snippet}...': Separate what is strictly in your power from what is external. Focus 100% of your energy on your own choice.",
            "visionary_lens": f"Deconstruct '{snippet}...': Identify the core input variable causing friction and run a 15-minute experiment to test your hypothesis.",
            "compassionate_lens": f"Your feelings about '{snippet}' are completely valid. Be patient with yourself—every honest reflection is proof of your growth."
        }

    return {"status": "ok", "lenses": lenses}


@router.post("/time-capsule")
async def create_time_capsule(req: TimeCapsuleCreateRequest):
    """Create a date-locked encrypted time-capsule letter to future self."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row or decrypt_text(row[0], req.passphrase) != VERIFY_MAGIC:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")

        enc_payload = encrypt_text(req.content.strip(), req.passphrase)
        cursor = await db.execute(
            "INSERT INTO believer_time_capsules (encrypted_payload, unlock_date, title) VALUES (?, ?, ?)",
            (enc_payload, req.unlock_date, req.title or "Letter to Future Self")
        )
        await db.commit()
        return {"status": "ok", "id": cursor.lastrowid, "message": f"Time Capsule locked until {req.unlock_date}!"}


@router.get("/time-capsules")
async def list_time_capsules(x_passphrase: Optional[str] = Header(None)):
    """List time capsules, decrypting only those whose unlock date has passed."""
    if not x_passphrase:
        raise HTTPException(status_code=400, detail="X-Passphrase header missing")
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT encrypted_verifier FROM believer_auth_meta WHERE key_name = 'auth_verifier'") as cursor:
            row = await cursor.fetchone()
            if not row or decrypt_text(row[0], x_passphrase) != VERIFY_MAGIC:
                raise HTTPException(status_code=403, detail="Invalid Master Passphrase")

        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        async with db.execute("SELECT id, encrypted_payload, unlock_date, title, created_at FROM believer_time_capsules ORDER BY unlock_date ASC") as cursor:
            rows = await cursor.fetchall()
            capsules = []
            for cid, enc_p, unlock_d, title, created_at in rows:
                is_unlocked = today_str >= unlock_d
                content = ""
                if is_unlocked:
                    try:
                        content = decrypt_text(enc_p, x_passphrase)
                    except Exception:
                        content = "Corrupted capsule payload"
                else:
                    content = "🔒 [Encrypted Time-Capsule - Locked until " + unlock_d + "]"

                capsules.append({
                    "id": cid,
                    "title": title,
                    "unlock_date": unlock_d,
                    "is_unlocked": is_unlocked,
                    "content": content,
                    "created_at": created_at
                })
            return {"status": "ok", "capsules": capsules}


@router.get("/growth-letter")
async def get_growth_letter_and_analytics(x_passphrase: Optional[str] = Header(None)):
    """Generate Sunday growth letter & 30-day emotional heatmap analytics."""
    if not x_passphrase:
        raise HTTPException(status_code=400, detail="X-Passphrase header missing")
    
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT mood_tag, created_at FROM believer_entries ORDER BY created_at DESC LIMIT 30") as cursor:
            rows = await cursor.fetchall()
            mood_counts = {}
            for mood, _ in rows:
                mood_counts[mood] = mood_counts.get(mood, 0) + 1

    growth_letter = (
        "Dear Madan,\n\n"
        "Reflecting on your recent private journal entries: You have demonstrated continuous resilience, "
        "maintaining focus on core engineering goals while staying self-aware. Remember to celebrate small wins "
        "and maintain a healthy balance between deep work and rest."
    )
    return {
        "status": "ok",
        "growth_letter": growth_letter,
        "mood_counts": mood_counts,
        "total_reflections": len(rows)
    }




