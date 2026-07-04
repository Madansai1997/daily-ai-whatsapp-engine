#!/usr/bin/env bash
# Push BOTH Claude Code and Antigravity usage into the JARVIS Insights tab in one shot.
#
# Env (all optional):
#   JARVIS_URL   target engine (default http://localhost:8000)
#   JARVIS_PIN   PIN for /auth/login; falls back to reading ./.env
#   DAYS         how far back to backfill (default 14)
#   PYTHON       python interpreter (default python3)
#
# Usage:
#   JARVIS_URL=https://daily-ai-whatsapp-engine.onrender.com ./scripts/push_dev_usage.sh
#   DRY_RUN=1 ./scripts/push_dev_usage.sh      # preview both, no posting
set -uo pipefail

# Run from the repo root regardless of where we're invoked from.
cd "$(dirname "$0")/.." || exit 1

: "${JARVIS_URL:=http://localhost:8000}"
: "${DAYS:=14}"
if [ -z "${JARVIS_PIN:-}" ] && [ -f .env ]; then
  JARVIS_PIN=$(grep '^JARVIS_PIN=' .env | cut -d= -f2-)
fi
export JARVIS_URL JARVIS_PIN DAYS

PY=${PYTHON:-python3}
rc=0

# Render's free instance sleeps after ~15 min idle; a cold start can exceed the push
# scripts' 15s timeout. Warm a remote target first (skipped for localhost) so both
# scripts authenticate against an awake instance.
case "$JARVIS_URL" in
  *localhost*|*127.0.0.1*) ;;
  *)
    echo "… warming $JARVIS_URL"
    curl -s --max-time 120 -o /dev/null "$JARVIS_URL/auth/status" || \
      echo "  (warmup ping failed — continuing anyway)"
    ;;
esac

echo "→ Claude Code  ($JARVIS_URL)"
"$PY" scripts/push_claude_usage.py || rc=$?

echo "→ Antigravity  ($JARVIS_URL)"
"$PY" scripts/push_antigravity_usage.py || rc=$?

exit "$rc"
