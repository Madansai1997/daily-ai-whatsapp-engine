"""
Voice Agent — local neural text-to-speech via Piper (JARVIS voice output).

Runs fully offline, no API key, no usage cap — unlike a hosted TTS service.
The voice model (~60MB .onnx) is committed to the repo under voices/ so it
ships with every deploy — Render's free-tier disk is ephemeral and wipes
anything not baked into the deploy image, and re-downloading it on every
cold start added 30+ seconds to whichever request happened to be first.
The auto-download below only exists as a fallback if the file is ever
missing (e.g. a different PIPER_VOICE is configured without committing it).
"""

import os
import re
import sys
import io
import time
import wave
import subprocess

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
VOICES_DIR = os.path.join(BASE_DIR, "voices")
VOICE_NAME = os.environ.get("PIPER_VOICE", "en_GB-northern_english_male-medium")

_voice = None  # lazy-loaded singleton, one process-wide model load


def _ensure_voice_downloaded() -> str:
    model_path = os.path.join(VOICES_DIR, f"{VOICE_NAME}.onnx")
    if os.path.exists(model_path):
        return model_path
    os.makedirs(VOICES_DIR, exist_ok=True)
    t0 = time.time()
    print(f"🔊 [voice_agent] '{VOICE_NAME}' not found on disk, downloading (this should not happen if it's committed to the repo)...")
    subprocess.run(
        [sys.executable, "-m", "piper.download_voices", VOICE_NAME, "--data-dir", VOICES_DIR],
        check=True,
    )
    print(f"⏱️ [voice_agent] download took {time.time() - t0:.2f}s")
    return model_path


def _get_voice():
    global _voice
    if _voice is None:
        from piper import PiperVoice
        model_path = _ensure_voice_downloaded()
        _voice = PiperVoice.load(model_path)
        print(f"✅ Voice model '{VOICE_NAME}' loaded.")
    return _voice


def _clean_for_speech(text: str) -> str:
    """Strip markdown so JARVIS doesn't read out backticks/asterisks/hashes aloud."""
    text = re.sub(r'```.*?```', ' Code example shown in the chat. ', text, flags=re.DOTALL)
    text = re.sub(r'`([^`]+)`', r'\1', text)
    text = re.sub(r'\*\*([^*]+)\*\*', r'\1', text)
    text = re.sub(r'\*([^*]+)\*', r'\1', text)
    text = re.sub(r'^#{1,3}\s*', '', text, flags=re.MULTILINE)
    text = re.sub(r'^[-*]\s+', '', text, flags=re.MULTILINE)
    return text.strip()


def synthesize_speech(text: str) -> bytes:
    """Returns WAV audio bytes for the given text, or None on failure/empty input."""
    cleaned = _clean_for_speech(text or "")
    if not cleaned:
        return None
    try:
        voice = _get_voice()
        buf = io.BytesIO()
        with wave.open(buf, "wb") as wav_file:
            voice.synthesize_wav(cleaned, wav_file)
        return buf.getvalue()
    except Exception as e:
        print(f"⚠️ [voice_agent] synthesize_speech failed: {e}")
        return None
