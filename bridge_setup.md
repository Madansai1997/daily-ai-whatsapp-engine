# JARVIS Local Bridge Setup

## What this does
Runs on your Mac and gives JARVIS access to your
local filesystem. Polls Render every 10 seconds
for commands and executes them locally.

## One-time setup
1. Open Terminal on your Mac
2. cd /Users/madansaidaram/Desktop/Daily_AI_updates
3. pip install requests (if not already installed)
4. Open local_bridge.py and set RENDER_URL to your
   actual Render app URL

## Run it
python local_bridge.py

## Keep it running (optional — runs in background)
nohup python local_bridge.py > bridge.log 2>&1 &

## Stop it
pkill -f local_bridge.py

## What JARVIS can do when bridge is running
- "show my project folder" — lists your files
- "show recent files" — last 10 modified files
- "search files for X" — finds files by name
- "read file X" — reads file contents

## Security
- Only reads from ALLOWED_FOLDERS list
- Only reads ALLOWED_EXTENSIONS file types
- Never writes, deletes, or executes code
- All commands must be in the whitelist
