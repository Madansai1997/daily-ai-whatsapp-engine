---
name: refresh-gmail-token
description: Use when Gmail or Google Calendar features in the Daily_AI_updates engine fail with "invalid_grant / Token has been expired or revoked", or when the GMAIL_REFRESH_TOKEN needs re-minting with combined gmail.modify + calendar scopes. Covers verifying the current token's scopes, re-running the OAuth consent, and updating both local .env and Render.
---

# Refresh the Gmail/Calendar OAuth Token

The engine reuses ONE Google refresh token (`GMAIL_REFRESH_TOKEN`) for both Gmail and
Calendar. It must carry BOTH scopes: `gmail.modify` + `calendar`. A Gmail-only token 403s on
Calendar; an expired/revoked token throws `invalid_grant` on everything.

## Symptoms that mean "run this"
- `create_event failed: ('invalid_grant: Token has been expired or revoked.', ...)`
- Gmail triage silently stops; calendar actions error.

## 1. Diagnose (read-only — confirms whether the token is dead and which scopes it has)
```bash
cd /Users/madansaidaram/Desktop/Daily_AI_updates
python3 - <<'PY'
import urllib.request, urllib.parse, json
from dotenv import dotenv_values
v=dotenv_values(".env")
data=urllib.parse.urlencode({"client_id":v["GMAIL_CLIENT_ID"].strip(),
  "client_secret":v["GMAIL_CLIENT_SECRET"].strip(),
  "refresh_token":v["GMAIL_REFRESH_TOKEN"].strip(),"grant_type":"refresh_token"}).encode()
try:
    r=json.load(urllib.request.urlopen("https://oauth2.googleapis.com/token",data=data,timeout=25))
    s=r.get("scope",""); print("OK. gmail.modify:", "gmail.modify" in s, "| calendar:", "calendar" in s)
except urllib.error.HTTPError as e: print("DEAD:", e.read().decode())
PY
```
If it prints `DEAD` (invalid_grant) or is missing the `calendar` scope → re-mint below.

## 2. Re-mint (interactive browser consent — must run on the user's Mac)
`get_gmail_token.py` requests both scopes. It PRINTS the values; it does not write `.env`.
```bash
pip install google-auth-oauthlib   # not in requirements.txt; temporary, for this run only
python3 get_gmail_token.py
```
It asks for the Client ID / Client Secret (already on the `GMAIL_CLIENT_ID=` / `GMAIL_CLIENT_SECRET=`
lines in `.env`) → opens a browser → sign in as **madansai97@gmail.com** → **Allow** for both
Gmail and Calendar → prints `GMAIL_REFRESH_TOKEN=1//0g...`.

The OAuth flow needs interactive stdin + a browser, so the user runs it themselves — don't try
to drive it headless from a tool call (it will hang/reject).

## 3. Update BOTH places (the token lives in two spots)
- **Local `.env`:** replace the whole `GMAIL_REFRESH_TOKEN=` line with the new value. Paste ONLY the token (no `KEY=` prefix, no quotes, no trailing space/newline). Fully clear the old value first.
- **Render:** dashboard → engine service → Environment → edit `GMAIL_REFRESH_TOKEN` → paste same value → Save (redeploys). The deployed engine reads its OWN copy — updating only local `.env` will still throw `invalid_grant` over WhatsApp.

## 4. Verify
- Re-run step 1 → expect `OK. gmail.modify: True | calendar: True`.
- Optional live read-only check that the Calendar API is enabled (not just scoped):
  a `events().list(calendarId="primary", timeMin=now, maxResults=3)` call should succeed.
- Over WhatsApp: "what's on my calendar tomorrow" (read-only) before trusting create/send.

## Gotchas
- Common failure: Render's field wasn't fully cleared → old token truncated/appended → still `invalid_grant` live. Re-paste cleanly.
- A revoked token breaks Gmail (Phase 1) AND Calendar (Phase 3) at once — check both after refreshing.
- Env var names stay the same on purpose so `calendar_agent.py` reuses the same creds.
