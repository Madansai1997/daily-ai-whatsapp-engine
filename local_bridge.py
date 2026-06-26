#!/usr/bin/env python3
# RUN THIS ON YOUR MAC — not on Render
"""
JARVIS Local Bridge
Run this on your Mac to give JARVIS access
to your local filesystem.
Command: python local_bridge.py
"""

import os
import time
import json
import subprocess
from datetime import datetime
from pathlib import Path

import requests

# ── CONFIG ──────────────────────────────
RENDER_URL = "https://daily-ai-whatsapp-engine.onrender.com"
POLL_INTERVAL = 10  # seconds between polls
PROJECT_FOLDER = "/Users/madansaidaram/Desktop/Daily_AI_updates"

# Whitelist of folders the bridge can read
ALLOWED_FOLDERS = [
    "/Users/madansaidaram/Desktop/Daily_AI_updates",
    "/Users/madansaidaram/Desktop",
    "/Users/madansaidaram/Documents",
]

# Whitelist of file extensions bridge can read
ALLOWED_EXTENSIONS = [
    ".py", ".txt", ".md", ".json",
    ".csv", ".yaml", ".yml", ".env.example",
    ".html", ".js", ".css"
]
# ─────────────────────────────────────────


def is_path_allowed(path: str) -> bool:
    """Safety check — only read from allowed folders"""
    abs_path = os.path.abspath(path)
    return any(
        abs_path.startswith(folder)
        for folder in ALLOWED_FOLDERS
    )


def execute_command(command_type: str, payload: str) -> str:
    try:
        if command_type == "list_folder":
            folder = payload or PROJECT_FOLDER
            if not is_path_allowed(folder):
                return f"❌ Folder not in allowed list: {folder}"

            items = []
            for item in sorted(Path(folder).iterdir()):
                icon = "📁" if item.is_dir() else "📄"
                size = ""
                if item.is_file():
                    s = item.stat().st_size
                    size = f" ({s:,} bytes)" if s < 1024 else f" ({s//1024}KB)"
                items.append(f"{icon} {item.name}{size}")

            return (
                f"📂 *{folder}*\n\n" +
                "\n".join(items[:30]) +
                (f"\n... and {len(items)-30} more"
                 if len(items) > 30 else "")
            )

        elif command_type == "read_file":
            filepath = payload
            if not is_path_allowed(filepath):
                return f"❌ File not in allowed folder"

            ext = Path(filepath).suffix.lower()
            if ext not in ALLOWED_EXTENSIONS:
                return f"❌ File type {ext} not in allowed list"

            with open(filepath, "r", encoding="utf-8") as f:
                content = f.read()

            if len(content) > 3000:
                content = content[:3000] + "\n... (truncated)"

            return f"📄 *{Path(filepath).name}*\n\n```\n{content}\n```"

        elif command_type == "search_files":
            query = payload.lower()
            results = []
            for root, dirs, files in os.walk(PROJECT_FOLDER):
                # Skip hidden and cache folders
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith(".")
                    and d not in ["__pycache__", "node_modules", ".git"]
                ]
                for file in files:
                    if query in file.lower():
                        full_path = os.path.join(root, file)
                        rel_path = os.path.relpath(
                            full_path, PROJECT_FOLDER
                        )
                        results.append(rel_path)

            if not results:
                return f"No files found matching '{payload}'"
            return (
                f"🔍 *Files matching '{payload}':*\n\n" +
                "\n".join(f"📄 {r}" for r in results[:20])
            )

        elif command_type == "list_recent_files":
            files_with_time = []
            for root, dirs, files in os.walk(PROJECT_FOLDER):
                dirs[:] = [
                    d for d in dirs
                    if not d.startswith(".")
                    and d not in ["__pycache__", ".git"]
                ]
                for file in files:
                    full_path = os.path.join(root, file)
                    mtime = os.path.getmtime(full_path)
                    files_with_time.append((mtime, full_path))

            files_with_time.sort(reverse=True)
            recent = files_with_time[:10]

            lines = []
            for mtime, path in recent:
                rel = os.path.relpath(path, PROJECT_FOLDER)
                dt_str = datetime.fromtimestamp(mtime).strftime(
                    "%d %b %H:%M"
                )
                lines.append(f"📄 {rel} — {dt_str}")

            return "*Recently modified files:*\n\n" + "\n".join(lines)

        elif command_type == "system_info":
            result = subprocess.run(
                ["sw_vers"], capture_output=True, text=True
            )
            disk = subprocess.run(
                ["df", "-h", "/"], capture_output=True, text=True
            )
            return (
                f"💻 *Mac System Info*\n\n"
                f"{result.stdout}\n"
                f"*Disk:*\n{disk.stdout}"
            )

        elif command_type == "claude_code_propose":
            # Read-only investigation only — plan mode never edits files, runs
            # write bash commands, or touches git. Real execution only ever
            # happens via claude_code_execute below, after a human approves.
            # The trailing instruction guards against `-p` only capturing the
            # final turn's text: without it, Claude sometimes wraps up with
            # "as shown above" instead of restating findings, leaving stdout vague.
            prompt = (
                f"{payload}\n\n"
                "Your final message must be fully self-contained — restate your "
                "complete findings/plan in it. Do not refer back to earlier output "
                "(e.g. 'as shown above') since only this final message is captured."
            )
            try:
                result = subprocess.run(
                    ["claude", "-p", prompt, "--permission-mode", "plan", "--max-turns", "20"],
                    cwd=PROJECT_FOLDER, capture_output=True, text=True, timeout=600,
                )
            except subprocess.TimeoutExpired:
                return "⏱️ Claude Code timed out after 10 minutes while investigating."
            except FileNotFoundError:
                return "❌ `claude` CLI not found on PATH. Install it (curl -fsSL https://claude.ai/install.sh | bash) and log in first."
            return result.stdout.strip() or f"(no output)\n{result.stderr.strip()}"

        elif command_type == "claude_code_execute":
            # Full permissions, unattended — only reached after explicit human
            # approval of the proposal above. max-turns/max-budget-usd bound
            # runaway loops/cost on this unsupervised run.
            prompt = (
                f"{payload}\n\n"
                "Your final message must be fully self-contained — summarize what "
                "you actually did/changed in it. Do not refer back to earlier output "
                "(e.g. 'as shown above') since only this final message is captured."
            )
            try:
                result = subprocess.run(
                    ["claude", "-p", prompt, "--permission-mode", "bypassPermissions",
                     "--max-turns", "40", "--max-budget-usd", "5.00"],
                    cwd=PROJECT_FOLDER, capture_output=True, text=True, timeout=1800,
                )
            except subprocess.TimeoutExpired:
                return "⏱️ Claude Code timed out after 30 minutes while executing."
            except FileNotFoundError:
                return "❌ `claude` CLI not found on PATH. Install it (curl -fsSL https://claude.ai/install.sh | bash) and log in first."
            return result.stdout.strip() or f"(no output)\n{result.stderr.strip()}"

        elif command_type == "claude_code_chat":
            # One turn of a live interactive session — full permissions, no
            # plan/approve gate, same as the propose/execute pair above but
            # resumable: --resume continues the same `claude` conversation
            # across separate subprocess calls (one per chat message), since
            # there's no long-lived process to keep open across HTTP polling.
            # The session id needed for the next --resume isn't returned any
            # other way, so it's smuggled back in the result via a prefix the
            # server strips before display.
            try:
                data = json.loads(payload)
            except (json.JSONDecodeError, TypeError):
                return "❌ Bad claude_code_chat payload"
            message = data.get("message", "")
            resume_id = data.get("resume_id")

            args = [
                "claude", "-p", message,
                "--permission-mode", "bypassPermissions",
                "--output-format", "json",
                "--max-turns", "40", "--max-budget-usd", "5.00",
            ]
            if resume_id:
                args += ["--resume", resume_id]

            try:
                result = subprocess.run(
                    args, cwd=PROJECT_FOLDER, capture_output=True, text=True, timeout=600,
                )
            except subprocess.TimeoutExpired:
                return "⏱️ Claude Code timed out after 10 minutes on this turn."
            except FileNotFoundError:
                return "❌ `claude` CLI not found on PATH. Install it (curl -fsSL https://claude.ai/install.sh | bash) and log in first."

            try:
                parsed = json.loads(result.stdout)
            except (json.JSONDecodeError, ValueError):
                raw = (result.stdout or result.stderr).strip()
                return f"❌ Claude Code returned malformed output:\n{raw[:1500]}"

            if parsed.get("is_error"):
                return f"❌ Claude Code error: {parsed.get('result') or parsed.get('subtype') or 'unknown error'}"

            text = parsed.get("result") or "(no output)"
            new_session_id = parsed.get("session_id", "")
            return f"__SESSION_ID__{new_session_id}__\n{text}"

        else:
            return f"Unknown command: {command_type}"

    except Exception as e:
        return f"❌ Error executing {command_type}: {str(e)}"


def poll_and_execute():
    print(f"🤖 JARVIS Local Bridge started")
    print(f"📡 Polling: {RENDER_URL}")
    print(f"📁 Project: {PROJECT_FOLDER}")
    print(f"⏱️  Interval: {POLL_INTERVAL}s")
    print("─" * 40)

    while True:
        try:
            # Poll for pending commands
            r = requests.get(
                f"{RENDER_URL}/local-queue/pending",
                timeout=10
            )

            if r.status_code == 200:
                commands = r.json().get("commands", [])

                for cmd in commands:
                    command_id = cmd["id"]
                    command_type = cmd["command_type"]
                    payload = cmd["payload"]

                    print(f"▶️  Executing: {command_type} | {payload}")
                    result = execute_command(command_type, payload)

                    # Post result back
                    requests.post(
                        f"{RENDER_URL}/local-queue/result",
                        json={
                            "command_id": command_id,
                            "result": result,
                            "status": "completed"
                        },
                        timeout=10
                    )
                    print(f"✅ Done: {command_type}")

        except requests.exceptions.ConnectionError:
            print(f"⚠️  Cannot reach Render — retrying in {POLL_INTERVAL}s")
        except Exception as e:
            print(f"❌ Bridge error: {e}")

        time.sleep(POLL_INTERVAL)


if __name__ == "__main__":
    poll_and_execute()
