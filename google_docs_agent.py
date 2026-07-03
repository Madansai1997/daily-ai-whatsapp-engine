"""
Google Docs Agent — turns an ATS analysis into a tailored-résumé Google Doc.

Creates a Doc titled "Résumé — <role> @ <company>" containing the master résumé
plus a "Changes to make" section (each weak bullet current → improved, the issue,
and the missing-keyword gap report), colour-coded.

Uses the shared Google OAuth refresh token — it MUST include the documents scope.
After adding it to get_gmail_token.py, re-run that script and update the token.
"""

import os
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request as GoogleAuthRequest
from googleapiclient.discovery import build

GMAIL_CLIENT_ID = os.environ.get("GMAIL_CLIENT_ID")
GMAIL_CLIENT_SECRET = os.environ.get("GMAIL_CLIENT_SECRET")
GMAIL_REFRESH_TOKEN = os.environ.get("GMAIL_REFRESH_TOKEN")

DOCS_SCOPES = [
    "https://www.googleapis.com/auth/gmail.modify",
    "https://www.googleapis.com/auth/calendar",
    "https://www.googleapis.com/auth/documents",
]

# Colours for the change annotations
_RED = {"color": {"rgbColor": {"red": 0.80, "green": 0.15, "blue": 0.15}}}
_GREEN = {"color": {"rgbColor": {"red": 0.05, "green": 0.50, "blue": 0.20}}}
_GRAY = {"color": {"rgbColor": {"red": 0.42, "green": 0.42, "blue": 0.42}}}


def _docs_service():
    if not (GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET and GMAIL_REFRESH_TOKEN):
        raise RuntimeError("Google credentials missing (GMAIL_CLIENT_ID/SECRET/REFRESH_TOKEN)")
    creds = Credentials(
        token=None,
        refresh_token=GMAIL_REFRESH_TOKEN,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=GMAIL_CLIENT_ID,
        client_secret=GMAIL_CLIENT_SECRET,
        scopes=DOCS_SCOPES,
    )
    creds.refresh(GoogleAuthRequest())
    return build("docs", "v1", credentials=creds, cache_discovery=False)


def _clean(s: str) -> str:
    """Drop non-BMP chars (emoji/surrogates) so Python len() == Docs' UTF-16 index units."""
    return "".join(c for c in (s or "") if ord(c) <= 0xFFFF)


def _build_segments(master_resume: str, analysis: dict, job_title: str, company: str):
    """Return [(text, textStyle_dict), ...] — one insert then per-segment styling."""
    score = analysis.get("ats_score", 0)
    km = analysis.get("keyword_matrix", {}) or {}
    missing = km.get("missing", []) or []
    breakdown = analysis.get("star_xyz_breakdown", []) or []

    segs: list[tuple[str, dict]] = []

    def add(text, bold=False, size=None, color=None, italic=False):
        style = {}
        if bold:
            style["bold"] = True
        if italic:
            style["italic"] = True
        if size:
            style["fontSize"] = {"magnitude": size, "unit": "PT"}
        if color:
            style["foregroundColor"] = color
        segs.append((_clean(text), style))

    add(f"Résumé Tailoring — {job_title} @ {company}\n", bold=True, size=16)
    add(f"ATS match: {score}/100   ·   review the changes below, then edit in place\n\n",
        size=10, color=_GRAY)

    add("MASTER RÉSUMÉ\n", bold=True, size=13)
    add((master_resume or "").strip() + "\n\n")

    add("CHANGES TO MAKE\n", bold=True, size=13)
    if breakdown:
        for b in breakdown:
            add((b.get("section_name") or "Bullet") + "\n", bold=True)
            add("   ✗ now:   " + (b.get("current_text") or "") + "\n", color=_RED)
            add("   ✓ make:  " + (b.get("optimized_text") or "") + "\n", color=_GREEN)
            issue = b.get("issue")
            if issue:
                add("   why:    " + issue + "\n", italic=True, color=_GRAY)
            add("\n")
    else:
        add("No bullet-level changes suggested — this résumé already reads well for the role.\n\n")

    add("MISSING KEYWORDS (honest gap report)\n", bold=True, size=13)
    add(", ".join(missing) + "\n" if missing
        else "None — you cover the required keywords the JD asks for.\n")

    return segs


def create_resume_doc(master_resume: str, analysis: dict,
                      job_title: str = "Role", company: str = "Company") -> str:
    """Create the Google Doc and return its editable URL. Blocking — call in an executor."""
    service = _docs_service()
    title = f"Résumé — {job_title} @ {company}"
    doc = service.documents().create(body={"title": title}).execute()
    doc_id = doc["documentId"]

    segs = _build_segments(master_resume, analysis, job_title, company)
    full_text = "".join(t for t, _ in segs)

    requests = [{"insertText": {"location": {"index": 1}, "text": full_text}}]
    cursor = 1
    for text, style in segs:
        length = len(text)
        if style and length > 0:
            requests.append({
                "updateTextStyle": {
                    "range": {"startIndex": cursor, "endIndex": cursor + length},
                    "textStyle": style,
                    "fields": ",".join(style.keys()),
                }
            })
        cursor += length

    service.documents().batchUpdate(documentId=doc_id, body={"requests": requests}).execute()
    return f"https://docs.google.com/document/d/{doc_id}/edit"
