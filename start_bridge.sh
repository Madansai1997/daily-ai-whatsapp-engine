#!/bin/bash
# Run the JARVIS Local Bridge on-demand (it polls Render every 10s, which keeps the
# free instance awake — so run it only while you need WhatsApp filesystem / "claude code:"
# features, then Ctrl-C to let the engine sleep again).
#
# The 24/7 auto-start LaunchAgent was disabled to save Render instance-hours; this is
# the manual replacement. Usage:  ./start_bridge.sh   (or the `start-bridge` alias)

set -euo pipefail
cd "$(dirname "$0")"

PYTHON=/Users/madansaidaram/anaconda3/bin/python3
[ -x "$PYTHON" ] || PYTHON=$(command -v python3)

echo "🤖 Starting JARVIS Local Bridge (Ctrl-C to stop and let the engine sleep)…"
echo "☕ Keeping the Mac awake while the bridge runs (caffeinate -i). Sleep resumes when you stop it."
# caffeinate -i prevents idle system sleep for as long as the bridge runs, so stepping
# away mid-task won't freeze it. It's released automatically on Ctrl-C / bridge exit.
# (Note: closing a laptop lid still clamshell-sleeps unless on power + external display.)
exec caffeinate -i "$PYTHON" -u local_bridge.py
