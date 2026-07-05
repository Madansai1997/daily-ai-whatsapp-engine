#!/usr/bin/env python3
"""
Shared memory bridge for Claude Code ⇄ Antigravity.

One source of truth that BOTH AI assistants read and write, so a fact entered in one shows up
in the other — no re-typing across tools.

How it works
------------
- Canonical store: a `shared_memory` table in the LOCAL agent_memory.db. Both IDEs already run a
  SQLite MCP server pointed at this exact file, so once a row is here, both can query it.
- Auto-load: `render` writes AGENTS.md at the repo root. Antigravity reads AGENTS.md natively;
  Claude Code reads it via CLAUDE.md's `@AGENTS.md` import. So every new session on either side
  starts with the full shared memory in context — nobody has to ask.
- Writing: either assistant (or you) adds a memory with a one-line shell command:
      python3 shared_memory.py add --key <slug> --category <cat> --source <who> "the fact"
  which upserts the row AND regenerates AGENTS.md, so the other tool sees it next session.

This module deliberately uses plain sqlite3 against the LOCAL file (never Turso) — it's a
dev-workstation bridge for the two local IDEs, and must not depend on a running engine or touch
the production database. See the SAFE_MODE memory for why local == agent_memory.db here.
"""

import os
import re
import sys
import json
import sqlite3
import argparse
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("SHARED_MEMORY_DB", os.path.join(BASE_DIR, "agent_memory.db"))
AGENTS_MD = os.path.join(BASE_DIR, "AGENTS.md")

# Render order + display labels. Anything else falls under "Other".
CATEGORIES = [
    ("user", "User — who they are & preferences"),
    ("feedback", "Feedback — how to work"),
    ("project", "Project — ongoing work & constraints"),
    ("reference", "Reference — pointers & resources"),
    ("decision", "Decisions — settled choices"),
    ("other", "Other"),
]
_VALID_CATS = {c for c, _ in CATEGORIES}


def _conn():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_shared_memory_tables():
    """Create the table if absent. Safe to call repeatedly; used by CLI and (optionally) engine."""
    conn = _conn()
    conn.execute("""CREATE TABLE IF NOT EXISTS shared_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE,
        category TEXT DEFAULT 'project',
        content TEXT,
        source TEXT DEFAULT 'user',
        created_at TEXT,
        updated_at TEXT
    )""")
    conn.commit()
    conn.close()


def _slugify(text: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (text or "").lower()).strip("-")
    return s[:60] or f"note-{int(datetime.now().timestamp())}"


def upsert_memory(content: str, key: str = None, category: str = "project",
                  source: str = "user") -> str:
    """Insert or update a memory (keyed by `key`). Returns the key used."""
    content = (content or "").strip()
    if not content:
        raise ValueError("content is required")
    category = category if category in _VALID_CATS else "other"
    key = key or _slugify(content.split("\n", 1)[0])
    now = datetime.now(timezone.utc).isoformat()
    conn = _conn()
    row = conn.execute("SELECT id, created_at FROM shared_memory WHERE key = ?", (key,)).fetchone()
    if row:
        conn.execute(
            "UPDATE shared_memory SET content=?, category=?, source=?, updated_at=? WHERE key=?",
            (content, category, source, now, key))
    else:
        conn.execute(
            "INSERT INTO shared_memory (key, category, content, source, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?)", (key, category, content, source, now, now))
    conn.commit()
    conn.close()
    return key


def delete_memory(key: str) -> bool:
    conn = _conn()
    cur = conn.execute("DELETE FROM shared_memory WHERE key = ?", (key,))
    conn.commit()
    n = cur.rowcount
    conn.close()
    return n > 0


def list_memories() -> list:
    conn = _conn()
    rows = [dict(r) for r in conn.execute(
        "SELECT * FROM shared_memory ORDER BY category, updated_at DESC").fetchall()]
    conn.close()
    return rows


def render_agents_md() -> str:
    """Regenerate AGENTS.md from the store. Returns the path written."""
    mems = list_memories()
    by_cat = {}
    for m in mems:
        by_cat.setdefault(m["category"] if m["category"] in _VALID_CATS else "other", []).append(m)

    lines = [
        "# AGENTS.md — shared memory for AI assistants",
        "",
        "> **Auto-generated — do not edit by hand.** This file is the shared brain for "
        "**Claude Code** and **Antigravity** working in this repo. Antigravity reads it natively; "
        "Claude Code reads it via `CLAUDE.md`'s `@AGENTS.md` import.",
        ">",
        "> To remember something for *both* assistants, add it to the store (it regenerates this "
        "file):",
        "> ```bash",
        "> python3 shared_memory.py add --key <slug> --category "
        "<user|feedback|project|reference|decision> --source <claude-code|antigravity|user> \"the fact\"",
        "> ```",
        "> List / remove: `python3 shared_memory.py list` · `python3 shared_memory.py rm <key>`",
        "",
        f"_{len(mems)} shared {'memory' if len(mems) == 1 else 'memories'} · "
        f"last rendered {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}_",
        "",
    ]
    if not mems:
        lines.append("_(empty — nothing shared yet)_")
    for cat, label in CATEGORIES:
        group = by_cat.get(cat)
        if not group:
            continue
        lines.append(f"## {label}")
        lines.append("")
        for m in group:
            src = f" _(via {m['source']})_" if m.get("source") else ""
            lines.append(f"### {m['key']}{src}")
            lines.append(m["content"].strip())
            lines.append("")
    text = "\n".join(lines).rstrip() + "\n"
    with open(AGENTS_MD, "w") as f:
        f.write(text)
    return AGENTS_MD


# ── One-time import of Claude Code's existing per-project memory files ────────────
def _claude_memory_dir() -> str:
    """Claude Code namespaces per-project memory under a slug of the abs path where every
    non-alphanumeric char (/, _, .) becomes '-'. Env override wins; then we try that slug and a
    couple of fallbacks so a convention tweak doesn't silently import nothing."""
    override = os.environ.get("CLAUDE_MEMORY_DIR")
    if override:
        return override
    projects = os.path.expanduser("~/.claude/projects")
    candidates = [
        re.sub(r"[^a-zA-Z0-9]", "-", BASE_DIR),   # /, _, . → -   (the real convention)
        BASE_DIR.replace("/", "-"),               # older: only / → -
    ]
    for slug in candidates:
        d = os.path.join(projects, slug, "memory")
        if os.path.isdir(d):
            return d
    return os.path.join(projects, candidates[0], "memory")


def _parse_frontmatter(text: str) -> tuple:
    """Return (meta: dict, body: str) from a `--- ... ---` frontmatter markdown file."""
    meta, body = {}, text
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n?(.*)$", text, re.DOTALL)
    if m:
        fm, body = m.group(1), m.group(2)
        for line in fm.splitlines():
            mm = re.match(r"\s*(name|description|type)\s*:\s*(.+)\s*$", line)
            if mm:
                meta[mm.group(1)] = mm.group(2).strip()
    return meta, body.strip()


def import_claude_memories() -> int:
    """Seed the store from Claude Code's /memory/*.md (skips the MEMORY.md index). Idempotent
    (keyed by the file's `name`). Returns the count imported/updated."""
    mem_dir = _claude_memory_dir()
    if not os.path.isdir(mem_dir):
        print(f"⚠️  Claude memory dir not found: {mem_dir}")
        return 0
    n = 0
    for fn in sorted(os.listdir(mem_dir)):
        if not fn.endswith(".md") or fn == "MEMORY.md":
            continue
        with open(os.path.join(mem_dir, fn)) as f:
            meta, body = _parse_frontmatter(f.read())
        if not body:
            continue
        key = meta.get("name") or _slugify(fn[:-3])
        category = (meta.get("type") or "project").strip().lower()
        desc = meta.get("description")
        content = f"{desc}\n\n{body}" if desc and desc.lower() not in body.lower() else body
        upsert_memory(content, key=key, category=category, source="claude-code")
        n += 1
    return n


# ── CLI ──────────────────────────────────────────────────────────────────────────
def _cli():
    p = argparse.ArgumentParser(description="Shared memory bridge (Claude Code ⇄ Antigravity)")
    sub = p.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("add", help="add/update a memory, then regenerate AGENTS.md")
    a.add_argument("content", help="the fact to remember")
    a.add_argument("--key", help="stable slug (auto from content if omitted)")
    a.add_argument("--category", default="project",
                   help="user|feedback|project|reference|decision")
    a.add_argument("--source", default="user", help="claude-code|antigravity|user")

    sub.add_parser("list", help="print all shared memories")
    sub.add_parser("render", help="regenerate AGENTS.md from the store")
    sub.add_parser("import-claude", help="import Claude Code's existing /memory files, then render")
    r = sub.add_parser("rm", help="delete a memory by key, then regenerate AGENTS.md")
    r.add_argument("key")
    sub.add_parser("json", help="dump the store as JSON")

    args = p.parse_args()
    init_shared_memory_tables()

    if args.cmd == "add":
        key = upsert_memory(args.content, key=args.key, category=args.category, source=args.source)
        render_agents_md()
        print(f"✅ saved '{key}' [{args.category}] and refreshed AGENTS.md")
    elif args.cmd == "list":
        mems = list_memories()
        if not mems:
            print("(empty)")
        for m in mems:
            head = m["content"].split("\n", 1)[0]
            print(f"• [{m['category']}] {m['key']} (via {m['source']}): {head[:80]}")
        print(f"\n{len(mems)} memories · {DB_PATH}")
    elif args.cmd == "render":
        print(f"✅ wrote {render_agents_md()}")
    elif args.cmd == "import-claude":
        n = import_claude_memories()
        render_agents_md()
        print(f"✅ imported {n} memories from Claude Code and refreshed AGENTS.md")
    elif args.cmd == "rm":
        ok = delete_memory(args.key)
        render_agents_md()
        print("✅ removed and refreshed AGENTS.md" if ok else "⚠️ no memory with that key")
    elif args.cmd == "json":
        print(json.dumps(list_memories(), indent=2))


if __name__ == "__main__":
    _cli()
