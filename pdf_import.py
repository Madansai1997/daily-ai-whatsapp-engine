"""
PDF Import — self-contained skill module.

Web Terminal tab only (no WhatsApp/vision support — that needs a paid vision-capable
model and was deliberately deferred). Extracts text locally with pdfplumber, no LLM
call needed for extraction itself, so this has zero new API cost.
"""

import pdfplumber
import io

MAX_CHARS = 12000


def extract_pdf_text(file_bytes: bytes) -> str:
    """Returns the concatenated text of every page, truncated to MAX_CHARS with a note
    if the PDF is longer. Raises on a corrupt/unreadable file — caller's job to catch."""
    pages = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                pages.append(text)
    full_text = "\n\n".join(pages).strip()
    if not full_text:
        return ""
    if len(full_text) > MAX_CHARS:
        return full_text[:MAX_CHARS] + f"\n\n[...truncated, {len(full_text) - MAX_CHARS} more characters]"
    return full_text
