"""
FastAPI Router for Sanctuary Ambient Glow — Two-Way Pulse & WhatsApp Integration
"""
from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse, HTMLResponse
from sanctuary_agent import (
    send_pulse_from_shalini,
    receive_warmth_from_madan,
    get_sanctuary_pulse_status,
    init_sanctuary_deps,
    init_sanctuary_db
)

router = APIRouter(prefix="/api/sanctuary", tags=["Sanctuary App"])

@router.post("/pulse")
async def trigger_pulse_api(request: Request):
    """Called when Shalini holds Ambient Glow in Sanctuary."""
    base_url = str(request.base_url).rstrip("/")
    result = await send_pulse_from_shalini(base_url=base_url)
    return JSONResponse(result)

@router.get("/status")
async def get_status_api():
    """Polled by Shalini's Ambient Glow to show active warmth from Madan."""
    status = await get_sanctuary_pulse_status()
    return JSONResponse(status)

@router.get("/send-warmth")
async def send_warmth_from_link(
    token: str = Query(default=""),
    msg: str = Query(default="Always in your corner 💛")
):
    """
    1-Tap Magic Link triggered by Madan from his WhatsApp alert.
    Renders a warm confirmation page and lights up Shalini's Ambient Glow.
    """
    success = await receive_warmth_from_madan(token=token, message=msg)
    
    if not success:
        return HTMLResponse(
            """
            <!DOCTYPE html>
            <html lang="en">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1.0">
              <title>Invalid Token</title>
              <style>
                body { font-family: -apple-system, sans-serif; background: #0b0f19; color: #f87171; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; text-align: center; padding: 20px; }
                .card { background: rgba(30, 41, 59, 0.8); border: 1px solid rgba(248, 113, 113, 0.3); border-radius: 24px; padding: 32px; max-width: 380px; }
              </style>
            </head>
            <body>
              <div class="card">
                <h2>⚠️ Invalid or Expired Link</h2>
                <p>Could not authenticate pulse token.</p>
              </div>
            </body>
            </html>
            """,
            status_code=403
        )

    return HTMLResponse(
        f"""
        <!DOCTYPE html>
        <html lang="en">
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Warmth Delivered ✨</title>
          <style>
            body {{
              font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
              background: #090d16;
              color: #f8fafc;
              display: flex;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 24px;
              text-align: center;
              background-image: radial-gradient(circle at 50% 30%, rgba(251, 191, 36, 0.15), transparent 70%);
            }}
            .card {{
              background: rgba(17, 24, 39, 0.85);
              backdrop-filter: blur(16px);
              -webkit-backdrop-filter: blur(16px);
              border: 1px solid rgba(251, 191, 36, 0.4);
              border-radius: 28px;
              padding: 40px 28px;
              max-width: 390px;
              box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.7), 0 0 40px rgba(251, 191, 36, 0.2);
              animation: scaleUp 0.5s ease-out;
            }}
            @keyframes scaleUp {{
              from {{ opacity: 0; transform: scale(0.92); }}
              to {{ opacity: 1; transform: scale(1); }}
            }}
            .glow-icon {{
              width: 72px;
              height: 72px;
              margin: 0 auto 20px;
              border-radius: 50%;
              background: linear-gradient(135deg, #fbbf24, #f59e0b, #d97706);
              display: flex;
              align-items: center;
              justify-content: center;
              font-size: 34px;
              box-shadow: 0 0 30px rgba(251, 191, 36, 0.6);
              animation: pulse 2s infinite ease-in-out;
            }}
            @keyframes pulse {{
              0%, 100% {{ transform: scale(1); box-shadow: 0 0 30px rgba(251, 191, 36, 0.5); }}
              50% {{ transform: scale(1.06); box-shadow: 0 0 45px rgba(251, 191, 36, 0.8); }}
            }}
            h1 {{
              font-size: 24px;
              color: #fef3c7;
              margin: 0 0 12px 0;
              font-family: Georgia, serif;
              letter-spacing: -0.02em;
            }}
            p {{
              font-size: 14px;
              color: #cbd5e1;
              line-height: 1.6;
              margin: 0 0 24px 0;
            }}
            .signal-pill {{
              display: inline-block;
              background: rgba(251, 191, 36, 0.15);
              border: 1px solid rgba(251, 191, 36, 0.35);
              color: #fbbf24;
              padding: 8px 18px;
              border-radius: 9999px;
              font-size: 13px;
              font-weight: 600;
              letter-spacing: 0.02em;
            }}
            .footer {{
              margin-top: 24px;
              font-size: 11px;
              color: #64748b;
              font-family: monospace;
            }}
          </style>
        </head>
        <body>
          <div class="card">
            <div class="glow-icon">💛</div>
            <h1>Warmth Delivered</h1>
            <p>Shalini's Ambient Glow in Sanctuary is now softly pulsing with your signal. She knows you're in her corner.</p>
            <div class="signal-pill">"{msg}"</div>
            <div class="footer">Sanctuary Two-Way Sync • Live</div>
          </div>
        </body>
        </html>
        """
    )
