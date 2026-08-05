"""
get_gmail_token.py — Zero-dependency Google OAuth Refresh Token Generator for JARVIS.

Runs out of the box using Python 3 standard library (no pip dependencies required).
Mints a combined Gmail + Calendar + Docs OAuth refresh token.
"""

import os
import sys
import json
import urllib.parse
import urllib.request
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler

def read_env(filepath=".env"):
    vals = {}
    if os.path.exists(filepath):
        with open(filepath, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    vals[k.strip()] = v.strip().strip("'").strip('"')
    return vals

env_vars = read_env()

CLIENT_ID = env_vars.get("GMAIL_CLIENT_ID", "").strip()
CLIENT_SECRET = env_vars.get("GMAIL_CLIENT_SECRET", "").strip()

if not CLIENT_ID:
    CLIENT_ID = input("Paste your OAuth Client ID: ").strip()
if not CLIENT_SECRET:
    CLIENT_SECRET = input("Paste your OAuth Client Secret: ").strip()

SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/documents",
]

# Try using google_auth_oauthlib if available, else pure stdlib OAuth server
try:
    from google_auth_oauthlib.flow import InstalledAppFlow
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
    refresh_token = creds.refresh_token

except Exception:
    # Pure Standard Library OAuth Server Fallback (Zero external dependencies required!)
    auth_code = None

    class OAuthHandler(BaseHTTPRequestHandler):
        def do_GET(self):
            global auth_code
            query = urllib.parse.urlparse(self.path).query
            params = urllib.parse.parse_qs(query)
            if "code" in params:
                auth_code = params["code"][0]
                self.send_response(200)
                self.send_header("Content-Type", "text/html")
                self.end_headers()
                self.wfile.write(b"<h1>Authorization Successful!</h1><p>You can close this tab now and return to your terminal.</p>")
            else:
                self.send_response(400)
                self.end_headers()

        def log_message(self, format, *args):
            return

    server = HTTPServer(("localhost", 8090), OAuthHandler)
    redirect_uri = "http://localhost:8090"

    auth_url = "https://accounts.google.com/o/oauth2/auth?" + urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": " ".join(SCOPES),
        "access_type": "offline",
        "prompt": "consent",
    })

    print(f"\nOpening browser for authorization...\n")
    webbrowser.open(auth_url)
    
    server.handle_request()
    server.server_close()

    if not auth_code:
        print("❌ Authorization failed or cancelled.")
        sys.exit(1)

    # Exchange code for tokens
    token_url = "https://oauth2.googleapis.com/token"
    data = urllib.parse.urlencode({
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": auth_code,
        "grant_type": "authorization_code",
        "redirect_uri": redirect_uri,
    }).encode()

    req = urllib.request.Request(token_url, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    res = json.loads(urllib.request.urlopen(req).read().decode())
    refresh_token = res.get("refresh_token")

print("\n==========================================")
print("✅ OAuth Refresh Token Successfully Generated!")
print("==========================================")
print(f"GMAIL_REFRESH_TOKEN={refresh_token}")
print("==========================================\n")
