"""
FastAPI Router for Daily Interactive Study Guide (JARVIS Academy)
Features ELI15 explanations, visual Mermaid diagrams, interactive quizzes, and practical settings.
"""
import os
import json
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse
from study_tracks import list_tracks, TRACKS, track_progress

router = APIRouter(tags=["Study & Daily Digest"])

DB_PATH = os.getenv("DB_PATH", "agent_memory.db")


async def init_study_tables():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS user_study_settings (
                id INTEGER PRIMARY KEY DEFAULT 1,
                topics_per_day INTEGER DEFAULT 1,
                active_track TEXT DEFAULT 'ai_engineering',
                theme TEXT DEFAULT 'chalkboard',
                difficulty TEXT DEFAULT 'eli15',
                audio_enabled INTEGER DEFAULT 1
            )
        """)
        await db.execute("INSERT OR IGNORE INTO user_study_settings (id) VALUES (1)")
        await db.execute("""
            CREATE TABLE IF NOT EXISTS study_quiz_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                topic TEXT,
                selected_option TEXT,
                is_correct INTEGER,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        await db.commit()


@router.get("/api/study/tracks")
async def get_study_tracks_api():
    """Return all available study tracks."""
    return JSONResponse({
        "ok": True,
        "tracks": list_tracks()
    })


@router.get("/api/study/settings")
async def get_study_settings():
    """Get practical user study settings."""
    await init_study_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT topics_per_day, active_track, theme, difficulty, audio_enabled FROM user_study_settings WHERE id=1") as cursor:
            row = await cursor.fetchone()
            if row:
                return JSONResponse({
                    "ok": True,
                    "settings": {
                        "topics_per_day": row[0],
                        "active_track": row[1],
                        "theme": row[2],
                        "difficulty": row[3],
                        "audio_enabled": bool(row[4])
                    }
                })
    return JSONResponse({"ok": True, "settings": {"topics_per_day": 1, "active_track": "ai_engineering", "theme": "chalkboard", "difficulty": "eli15", "audio_enabled": True}})


@router.post("/api/study/settings")
async def update_study_settings(request: Request):
    """Update practical user study settings."""
    await init_study_tables()
    data = await request.json()
    topics = data.get("topics_per_day", 1)
    track = data.get("active_track", "ai_engineering")
    theme = data.get("theme", "chalkboard")
    difficulty = data.get("difficulty", "eli15")
    audio = 1 if data.get("audio_enabled", True) else 0

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            UPDATE user_study_settings
            SET topics_per_day=?, active_track=?, theme=?, difficulty=?, audio_enabled=?
            WHERE id=1
        """, (topics, track, theme, difficulty, audio))
        await db.commit()

    return JSONResponse({"ok": True, "message": "Study settings updated successfully!"})


@router.get("/api/study/interactive-lesson")
async def get_interactive_lesson(track_key: str = None):
    """
    Generate or return today's ELI15 structured interactive lesson card:
    - Slide 1: ELI15 Story & Real-world Analogy
    - Slide 2: Visual Diagram (Mermaid.js) & Handwritten Code
    - Slide 3: Interactive Micro-Quiz
    """
    await init_study_tables()
    if not track_key:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT active_track FROM user_study_settings WHERE id=1") as cursor:
                row = await cursor.fetchone()
                track_key = row[0] if row else "ai_engineering"

    # Default ELI15 structured lesson template
    lesson_data = {
        "ok": True,
        "track_key": track_key,
        "topic": "Vector Embeddings & Semantic Search",
        "streak": 5,
        "slide1_story": {
            "title": "Imagine Spotify for Meaning! 🎵",
            "analogy": "Instead of searching for an exact song title like 'Happy Birthday', Spotify understands vibes like 'upbeat party music'. Vector Embeddings do the exact same thing for words! They convert sentences into numerical coordinates so your computer understands meaning, not just letters."
        },
        "slide2_visual": {
            "title": "How Vector Coordinates Work 🗺️",
            "mermaid_diagram": "graph TD\n    A[Word: 'King'] -->|Vector Math| B( [0.9, 0.2, 0.8] )\n    C[Word: 'Queen'] -->|Vector Math| D( [0.89, 0.22, 0.81] )\n    B ---|High Similarity| D",
            "handwritten_code_title": "Handwritten Python Example ✍️",
            "code_snippet": "# Calculate similarity between two vector coordinates\nimport numpy as np\n\ndef similarity(v1, v2):\n    return np.dot(v1, v2) / (np.linalg.norm(v1) * np.linalg.norm(v2))\n\nprint('Similarity:', similarity([0.9, 0.2], [0.89, 0.22]))  # Output: 0.99 (99% Match!)"
        },
        "slide3_quiz": {
            "question": "If you want your AI to find articles about 'Car Maintenance' when someone types 'How to fix an engine leak', what should you use?",
            "options": [
                "A) Exact Keyword Match",
                "B) Vector Embeddings (Semantic Search)",
                "C) Standard SQL Like Query",
                "D) Hardcoded If-Else statements"
            ],
            "correct_index": 1,
            "explanation": "Vector Embeddings convert 'engine leak' and 'Car Maintenance' into close points in 3D space, capturing the concept even with zero matching words!"
        }
    }

    return JSONResponse(lesson_data)


@router.post("/api/study/quiz/submit")
async def submit_quiz_answer(request: Request):
    """Verify quiz answer and record user progress."""
    await init_study_tables()
    data = await request.json()
    topic = data.get("topic", "General")
    selected_option = data.get("selected_option", "")
    correct_index = data.get("correct_index", 1)
    chosen_index = data.get("chosen_index", 0)

    is_correct = (chosen_index == correct_index)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            INSERT INTO study_quiz_logs (topic, selected_option, is_correct)
            VALUES (?, ?, ?)
        """, (topic, selected_option, 1 if is_correct else 0))
        await db.commit()

    return JSONResponse({
        "ok": True,
        "is_correct": is_correct,
        "message": "🎉 Awesome job! You nailed it!" if is_correct else "💡 Close call! Review the explanation and try again!"
    })
