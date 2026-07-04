#!/usr/bin/env python3
"""
Push Antigravity (Gemini IDE) *activity* into the JARVIS Insights tab (dev_usage).

Unlike Claude Code, Antigravity does NOT record token counts anywhere on disk — it's a
cloud-quota product, and none of its local stores (checked: ~/.gemini/antigravity*,
~/Library/Application Support/Antigravity) contain promptTokenCount / usageMetadata /
input_tokens fields. So exact tokens are not recoverable. What IS reliably available are
the conversation transcripts under ~/.gemini/antigravity-ide/conversations/*.db (SQLite),
one DB per conversation, each with a `gen_metadata` table of LLM generations carrying
embedded unix-second timestamps.

This scans those DBs, extracts each generation's timestamp, groups BY DAY, and POSTs one
idempotent summary per day to JARVIS /api/dev-usage (tool="antigravity", replace=true):
  - tokens = 0            (not available — never fabricated)
  - duration_min         = active minutes that day (sum of gaps between consecutive
                           generations, ignoring idle gaps > IDLE_GAP_MIN so a chat left
                           open overnight doesn't inflate the number)
  - note                 = "auto-push · N sessions · G generations"
Tokens stay 0 on purpose; the Insights legend shows the minutes ("· 47m"), which is the
honest activity signal for Antigravity.

Usage:
  JARVIS_URL=http://localhost:8000 JARVIS_PIN=123456 DAYS=14 python scripts/push_antigravity_usage.py
  # JARVIS_URL defaults to http://localhost:8000; on Render use your app URL.
  # JARVIS_PIN falls back to reading it from ./.env if python-dotenv is available.
  # DAYS defaults to 14. Add DRY_RUN=1 to print the per-day summary without posting.
"""

import os
import sys
import glob
import json
import sqlite3
import datetime as dt
import urllib.request

# Antigravity generations land within this epoch-second window; anything outside is a
# stray varint (e.g. a config value or the uint64 sentinel), not a real timestamp.
_TS_LO = 1_735_689_600  # 2025-01-01 UTC
_TS_HI = 1_861_920_000  # 2029-01-01 UTC
IDLE_GAP_MIN = 15.0     # gaps longer than this (min) count as idle, not active work.

CONV_GLOB = os.path.expanduser("~/.gemini/antigravity-ide/conversations/*.db")


def _read_varint(b, i):
    """Decode a base-128 varint at offset i. Returns (value, next_i) or (None, i)."""
    shift = 0
    val = 0
    n = len(b)
    while i < n:
        byte = b[i]
        i += 1
        val |= (byte & 0x7F) << shift
        if not (byte & 0x80):
            return val, i
        shift += 7
        if shift > 63:
            return None, i
    return None, i


def _walk_timestamps(b, out, depth=0):
    """Recursively walk protobuf wire bytes, collecting varint fields that look like
    unix-second timestamps. Structure-aware (descends length-delimited submessages), so
    it's far less noisy than a flat byte scan. Best-effort: malformed submessages just
    stop that branch."""
    if depth > 6:
        return
    i = 0
    n = len(b)
    while i < n:
        tag, i = _read_varint(b, i)
        if tag is None:
            return
        field = tag >> 3
        wire = tag & 7
        if field == 0:
            return
        if wire == 0:  # varint
            v, i = _read_varint(b, i)
            if v is None:
                return
            if _TS_LO <= v <= _TS_HI:
                out.append(v)
        elif wire == 2:  # length-delimited
            ln, i = _read_varint(b, i)
            if ln is None or ln < 0 or i + ln > n:
                return
            sub = b[i:i + ln]
            i += ln
            if sub:
                _walk_timestamps(sub, out, depth + 1)
        elif wire == 5:  # 32-bit
            i += 4
        elif wire == 1:  # 64-bit
            i += 8
        else:  # 3/4 (deprecated groups) — bail
            return


def _generation_times(db_path):
    """Yield one representative unix-second timestamp per generation in a conversation
    DB. Uses the max in-window varint found in each gen_metadata blob (the generation's
    own time; older context timestamps sort below it)."""
    try:
        con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    except sqlite3.Error:
        return
    try:
        cur = con.execute("SELECT data FROM gen_metadata")
    except sqlite3.Error:
        con.close()
        return
    for (blob,) in cur:
        if not blob:
            continue
        found = []
        try:
            _walk_timestamps(blob, found)
        except Exception:
            found = []
        if found:
            yield max(found)
    con.close()


def _active_minutes(sorted_secs):
    """Sum gaps between consecutive generations, ignoring idle stretches."""
    total = 0.0
    for a, b in zip(sorted_secs, sorted_secs[1:]):
        gap = (b - a) / 60.0
        if 0 < gap <= IDLE_GAP_MIN:
            total += gap
    return round(total, 1)


def main():
    days_back = int(os.environ.get("DAYS", "14"))
    since = (dt.datetime.now(dt.timezone.utc).date()
             - dt.timedelta(days=days_back - 1))

    dbs = glob.glob(CONV_GLOB)
    if not dbs:
        print(f"No Antigravity conversations found at {CONV_GLOB} — nothing to push.")
        return

    # day -> {"secs": [unix_secs...], "sessions": set(conv_id)}
    by_day = {}
    for db in dbs:
        conv_id = os.path.basename(db)[:8]
        for sec in _generation_times(db):
            day = dt.datetime.fromtimestamp(sec, dt.timezone.utc).date()
            if day < since:
                continue
            d = by_day.setdefault(day.isoformat(), {"secs": [], "sessions": set()})
            d["secs"].append(sec)
            d["sessions"].add(conv_id)

    if not by_day:
        print(f"No Antigravity generations in the last {days_back} days — nothing to push.")
        return

    dry = os.environ.get("DRY_RUN", "").strip().lower() in ("1", "true", "yes", "on")

    # Auth (same handshake as push_claude_usage.py).
    headers = {"Content-Type": "application/json"}
    if not dry:
        pin = os.environ.get("JARVIS_PIN")
        if not pin:
            try:
                from dotenv import dotenv_values
                pin = dotenv_values(os.path.join(os.getcwd(), ".env")).get("JARVIS_PIN")
            except Exception:
                pin = None
        base = os.environ.get("JARVIS_URL", "http://localhost:8000").rstrip("/")
        if pin:
            try:
                req = urllib.request.Request(
                    f"{base}/auth/login",
                    data=json.dumps({"pin": pin}).encode(), headers=headers)
                tok = json.load(urllib.request.urlopen(req, timeout=15)).get("token")
                if tok:
                    headers["X-Jarvis-Token"] = tok
            except Exception as e:
                print(f"⚠️ login failed ({e}); trying without token")

    pushed = 0
    for day in sorted(by_day):
        d = by_day[day]
        secs = sorted(d["secs"])
        minutes = _active_minutes(secs)
        sessions = len(d["sessions"])
        gens = len(secs)
        note = f"auto-push · {sessions} session{'s' * (sessions != 1)} · {gens} generations"
        if dry:
            print(f"  {day}: {sessions} sess · {gens} gens · {minutes}m  (tokens n/a)")
            pushed += 1
            continue
        payload = {
            "tool": "antigravity", "day": day, "replace": True,
            "tokens": 0, "cost": 0, "duration_min": minutes, "note": note,
        }
        base = os.environ.get("JARVIS_URL", "http://localhost:8000").rstrip("/")
        req = urllib.request.Request(
            f"{base}/api/dev-usage", data=json.dumps(payload).encode(), headers=headers)
        try:
            json.load(urllib.request.urlopen(req, timeout=15))
            print(f"  {day}: {sessions} sess · {gens} gens · {minutes}m active")
            pushed += 1
        except Exception as e:
            print(f"  ❌ {day} push failed: {e}")

    verb = "Would backfill" if dry else "Backfilled"
    print(f"✅ {verb} {pushed} day(s) of Antigravity activity.")
    if pushed == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
