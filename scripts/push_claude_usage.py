#!/usr/bin/env python3
"""
Push Claude Code usage into the JARVIS Insights tab (dev_usage table).

Claude Code stores each session as a JSONL transcript under ~/.claude/projects/**.
This scans the last N days of transcripts, groups the token usage reported on assistant
messages BY DAY, measures wall-clock minutes per day, and POSTs one idempotent summary
per day to JARVIS /api/dev-usage (tool="claude-code", replace=true — safe to re-run).

Tokens are output+cached (a stable activity proxy); cost is left blank (not reliably
derivable from the transcript — use Claude Code's /cost, or enter it in the UI). Antigravity
has no local usage file, so log those sessions from the Insights "Log dev session" button.

Usage:
  JARVIS_URL=http://localhost:8000 JARVIS_PIN=123456 DAYS=14 python scripts/push_claude_usage.py
  # JARVIS_URL defaults to http://localhost:8000; on Render use your app URL.
  # JARVIS_PIN falls back to reading it from ./.env if python-dotenv is available.
  # DAYS defaults to 14 (how far back to backfill).
"""

import os
import sys
import json
import glob
import datetime as dt
import urllib.request

def _today_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).date().isoformat()


def _iter_usage(since_day: str):
    """Yield (usage_dict, ts) for assistant messages on/after since_day (YYYY-MM-DD)."""
    home = os.path.expanduser("~/.claude/projects")
    for path in glob.glob(os.path.join(home, "**", "*.jsonl"), recursive=True):
        try:
            if dt.datetime.utcfromtimestamp(os.path.getmtime(path)).date().isoformat() < since_day:
                continue
        except OSError:
            continue
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or '"usage"' not in line:
                        continue
                    try:
                        ev = json.loads(line)
                    except Exception:
                        continue
                    ts = ev.get("timestamp") or ""
                    if not ts or ts[:10] < since_day:
                        continue
                    msg = ev.get("message") or ev
                    usage = msg.get("usage") if isinstance(msg, dict) else None
                    if isinstance(usage, dict) and ("output_tokens" in usage or "input_tokens" in usage):
                        yield (usage, ts)
        except OSError:
            continue


def main():
    days_back = int(os.environ.get("DAYS", "14"))
    since = (dt.datetime.now(dt.timezone.utc).date() - dt.timedelta(days=days_back - 1)).isoformat()

    # Group tokens + timestamps by day.
    by_day = {}  # day -> {"tokens": int, "times": [ts,...]}
    for usage, ts in _iter_usage(since):
        day = ts[:10]
        o = int(usage.get("output_tokens", 0) or 0)
        cc = int(usage.get("cache_creation_input_tokens", 0) or 0)
        d = by_day.setdefault(day, {"tokens": 0, "times": []})
        d["tokens"] += o + cc  # output + newly-cached: stable activity proxy
        d["times"].append(ts)

    if not by_day:
        print(f"No Claude Code usage found in the last {days_back} days — nothing to push.")
        return

    pin = os.environ.get("JARVIS_PIN")
    if not pin:
        try:
            from dotenv import dotenv_values
            pin = dotenv_values(os.path.join(os.getcwd(), ".env")).get("JARVIS_PIN")
        except Exception:
            pin = None

    base = os.environ.get("JARVIS_URL", "http://localhost:8000").rstrip("/")
    headers = {"Content-Type": "application/json"}
    if pin:
        try:
            req = urllib.request.Request(f"{base}/auth/login", data=json.dumps({"pin": pin}).encode(), headers=headers)
            tok = json.load(urllib.request.urlopen(req, timeout=15)).get("token")
            if tok:
                headers["X-Jarvis-Token"] = tok
        except Exception as e:
            print(f"⚠️ login failed ({e}); trying without token")

    pushed = 0
    for day in sorted(by_day):
        d = by_day[day]
        minutes = 0.0
        if len(d["times"]) >= 2:
            try:
                fmt = lambda s: dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
                minutes = round((fmt(max(d["times"])) - fmt(min(d["times"]))).total_seconds() / 60, 1)
            except Exception:
                minutes = 0.0
        # replace=true → idempotent per day; cost left 0 (see module docstring).
        payload = {
            "tool": "claude-code", "day": day, "replace": True,
            "tokens": d["tokens"], "cost": 0, "duration_min": minutes, "note": "auto-push",
        }
        req = urllib.request.Request(f"{base}/api/dev-usage", data=json.dumps(payload).encode(), headers=headers)
        try:
            json.load(urllib.request.urlopen(req, timeout=15))
            print(f"  {day}: ~{d['tokens']:,} tokens (output+cached), {minutes}m")
            pushed += 1
        except Exception as e:
            print(f"  ❌ {day} push failed: {e}")

    print(f"✅ Backfilled {pushed} day(s) of Claude Code usage.")
    if pushed == 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
