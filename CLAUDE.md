# CLAUDE.md — project guidance for Claude Code

## Shared memory (Claude Code ⇄ Antigravity)

Durable, cross-tool memory lives in **[AGENTS.md](AGENTS.md)** — a single store that **both**
Claude Code and Antigravity read, so a fact entered in one tool shows up in the other. It is
auto-generated from a `shared_memory` table in the local `agent_memory.db` and imported below.

**Do not hand-edit AGENTS.md.** To remember something for both assistants:

```bash
python3 shared_memory.py add --key <slug> \
  --category <user|feedback|project|reference|decision> \
  --source <claude-code|antigravity|user> "the fact"
```

`python3 shared_memory.py list` to review, `rm <key>` to forget. Every write regenerates
AGENTS.md; a SessionStart hook also refreshes it each session.

@AGENTS.md
