"""
Gemini text-to-speech — an optional natural voice for JARVIS.

Wraps Gemini's native TTS model (gemini-2.5-flash-preview-tts) so the console can speak the daily
standup in a composed, natural voice instead of the browser's robotic one. Uses the SAME
GEMINI_API_KEY already configured for the LLM fallback — no new credentials.

Free-tier aware by design: this is called only when the user opts into the natural voice, and any
failure (missing key, quota, network) returns None so the caller falls back to the free browser
voice. Nothing here ever blocks or costs unless explicitly invoked.

Native REST is used (not the OpenAI-compat shim, which doesn't expose audio). Returns WAV bytes.
"""

import os
import io
import re
import wave
import base64
import httpx

GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_TTS_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-2.5-flash-preview-tts").strip()
# Prebuilt Gemini voices; "Charon" reads as informative/composed. Override via env.
GEMINI_TTS_VOICE = os.environ.get("GEMINI_TTS_VOICE", "Charon").strip()

# The 30 prebuilt Gemini TTS voices with Google's one-word character descriptors.
VOICES = [
    ("Zephyr", "Bright"), ("Puck", "Upbeat"), ("Charon", "Informative"), ("Kore", "Firm"),
    ("Fenrir", "Excitable"), ("Leda", "Youthful"), ("Orus", "Firm"), ("Aoede", "Breezy"),
    ("Callirrhoe", "Easy-going"), ("Autonoe", "Bright"), ("Enceladus", "Breathy"),
    ("Iapetus", "Clear"), ("Umbriel", "Easy-going"), ("Algieba", "Smooth"),
    ("Despina", "Smooth"), ("Erinome", "Clear"), ("Algenib", "Gravelly"),
    ("Rasalgethi", "Informative"), ("Laomedeia", "Upbeat"), ("Achernar", "Soft"),
    ("Alnilam", "Firm"), ("Schedar", "Even"), ("Gacrux", "Mature"),
    ("Pulcherrima", "Forward"), ("Achird", "Friendly"), ("Zubenelgenubi", "Casual"),
    ("Vindemiatrix", "Gentle"), ("Sadachbia", "Lively"), ("Sadaltager", "Knowledgeable"),
    ("Sulafat", "Warm"),
]

_ENDPOINT = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_TTS_MODEL}:generateContent"
# A light style directive — Gemini TTS honors natural-language delivery cues in the prompt.
_STYLE = ("Read this morning briefing aloud as JARVIS — composed, warm and unhurried, with a "
          "touch of dry British poise. Do not read this instruction:\n\n")


def tts_available() -> bool:
    return bool(GEMINI_API_KEY)


def _rate_from_mime(mime: str, default: int = 24000) -> int:
    m = re.search(r"rate=(\d+)", mime or "")
    return int(m.group(1)) if m else default


def _pcm_to_wav(pcm: bytes, rate: int) -> bytes:
    """Gemini returns raw little-endian 16-bit mono PCM; wrap it in a WAV container to play."""
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


async def synthesize(text: str, voice: str = None) -> bytes | None:
    """Return WAV bytes for `text`, or None on any failure (caller falls back to browser TTS)."""
    text = (text or "").strip()
    if not GEMINI_API_KEY or not text:
        return None
    body = {
        "contents": [{"parts": [{"text": _STYLE + text}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice or GEMINI_TTS_VOICE}}
            },
        },
    }
    try:
        async with httpx.AsyncClient(timeout=45) as client:
            r = await client.post(_ENDPOINT, params={"key": GEMINI_API_KEY}, json=body)
        if r.status_code != 200:
            print(f"⚠️ [gemini_tts] HTTP {r.status_code}: {r.text[:180]}")
            return None
        part = r.json()["candidates"][0]["content"]["parts"][0]
        inline = part.get("inlineData") or part.get("inline_data") or {}
        b64 = inline.get("data")
        if not b64:
            return None
        pcm = base64.b64decode(b64)
        rate = _rate_from_mime(inline.get("mimeType") or inline.get("mime_type", ""))
        return _pcm_to_wav(pcm, rate)
    except Exception as e:
        print(f"⚠️ [gemini_tts] {e}")
        return None
