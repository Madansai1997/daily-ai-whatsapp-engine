"""
One-time local script to mint a combined Gmail + Calendar OAuth refresh token.

Run once on your own machine after creating a Desktop-app OAuth client in
Google Cloud Console (enable both the Gmail API and the Calendar API on that
project first). Prints GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN
to paste into .env (local) and Render's environment variables (deployed).

Re-run this if you previously minted a Gmail-only token — re-running replaces
GMAIL_REFRESH_TOKEN with one that also carries calendar access; the env var
names stay the same on purpose so calendar_agent.py can reuse the same creds.

Requires: pip install google-auth-oauthlib  (not needed in production, so it's
intentionally NOT in requirements.txt — install it temporarily just for this run.)
"""

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
]

CLIENT_ID = input("Paste your OAuth Client ID: ").strip()
CLIENT_SECRET = input("Paste your OAuth Client Secret: ").strip()

client_config = {
    "installed": {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "auth_uri": "https://accounts.google.com/o/oauth2/auth",
        "token_uri": "https://oauth2.googleapis.com/token",
        "redirect_uris": ["http://localhost"],
    }
}

flow = InstalledAppFlow.from_client_config(client_config, SCOPES)
creds = flow.run_local_server(port=0)

print("\n--- Add these to .env and Render env vars ---")
print(f"GMAIL_CLIENT_ID={CLIENT_ID}")
print(f"GMAIL_CLIENT_SECRET={CLIENT_SECRET}")
print(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}")
