#!/usr/bin/env python3
"""Regenerate the auto-maintained sections of the root README.md.

Run by the pre-commit hook so the README stays true to the code on every commit. It only
rewrites the content BETWEEN the `<!-- AUTO:x -->` / `<!-- /AUTO:x -->` markers — everything
else in the README is hand-written and left untouched.

Sections filled:
  - modules   : one line per top-level Python module, from its docstring's first sentence
  - changelog : the most recent commits
  - the "Last updated" date stamp
"""

import ast
import os
import re
import glob
import subprocess
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
README = os.path.join(ROOT, "README.md")

# Modules that are plumbing rather than features — kept out of the inventory.
_SKIP = {"gen_readme.py", "conftest.py"}


def module_inventory() -> str:
    rows = []
    for path in sorted(glob.glob(os.path.join(ROOT, "*.py"))):
        name = os.path.basename(path)
        if name in _SKIP:
            continue
        try:
            doc = ast.get_docstring(ast.parse(open(path, encoding="utf-8").read()))
        except Exception:
            doc = None
        if not doc:
            continue
        # First sentence of the docstring, trimmed to a single tidy line.
        first = doc.strip().split("\n")[0].strip()
        first = re.split(r"(?<=[.!?])\s", first)[0].rstrip(".")
        rows.append(f"- **`{name}`** — {first}.")
    return "\n".join(rows) if rows else "_(none)_"


def changelog(n: int = 12) -> str:
    try:
        out = subprocess.check_output(
            ["git", "-C", ROOT, "log", f"-{n}", "--pretty=- `%h` %s _(%ad)_", "--date=short"],
            text=True, stderr=subprocess.DEVNULL)
        return out.strip() or "_(no history yet)_"
    except Exception:
        return "_(no history yet)_"


def _replace(text: str, key: str, content: str) -> str:
    pat = re.compile(rf"(<!-- AUTO:{key} -->).*?(<!-- /AUTO:{key} -->)", re.DOTALL)
    if not pat.search(text):
        return text  # marker absent — leave the file alone
    return pat.sub(lambda m: f"{m.group(1)}\n{content}\n{m.group(2)}", text)


def main():
    if not os.path.exists(README):
        return
    text = open(README, encoding="utf-8").read()
    text = _replace(text, "modules", module_inventory())
    text = _replace(text, "changelog", changelog())
    text = re.sub(r"(_Last updated:\s*)\d{4}-\d{2}-\d{2}", rf"\g<1>{date.today().isoformat()}", text)
    open(README, "w", encoding="utf-8").write(text)


if __name__ == "__main__":
    main()
