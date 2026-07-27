"""
Deploy Watcher Agent (Phase 5) — Monitors local system RSS memory, GitHub repo commits,
and cloud deployment health endpoints (Render/Koyeb). Generates JARVIS-persona diagnostic alerts.

Follows project conventions: top-level single file, async-first, movie-JARVIS voice via LLM,
store-notification inbox delivery, and SAFE_MODE compatibility.
"""

import os
import sys
import time
import resource
import asyncio
import httpx
from datetime import datetime, timezone
import db_compat

# Configuration
GITHUB_REPO = os.getenv("GITHUB_REPO", "Madansai1997/daily-ai-whatsapp-engine")
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
RENDER_SERVICE_ID = os.getenv("RENDER_SERVICE_ID", "")
RENDER_API_KEY = os.getenv("RENDER_API_KEY", "")
MEMORY_WARNING_THRESHOLD_MB = float(os.getenv("MEMORY_WARNING_THRESHOLD_MB", "420.0"))

def get_process_rss_mb() -> float:
    """Return the current process resident set size (RSS) in megabytes."""
    try:
        usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        if sys.platform == "darwin":
            # macOS returns bytes
            return round(usage / (1024 * 1024), 2)
        else:
            # Linux returns KB
            return round(usage / 1024, 2)
    except Exception:
        return 0.0


async def check_endpoint_health(url: str, timeout_sec: float = 5.0) -> dict:
    """Probe an HTTP health endpoint and return status, latency, and response snippet."""
    if not url:
        return {"url": url, "ok": False, "status_code": 0, "latency_ms": 0, "error": "No URL provided"}

    start_t = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=timeout_sec, follow_redirects=True) as client:
            resp = await client.get(url)
            latency_ms = round((time.perf_counter() - start_t) * 1000, 2)
            is_ok = 200 <= resp.status_code < 300
            return {
                "url": url,
                "ok": is_ok,
                "status_code": resp.status_code,
                "latency_ms": latency_ms,
                "error": None if is_ok else f"HTTP {resp.status_code}",
            }
    except Exception as e:
        latency_ms = round((time.perf_counter() - start_t) * 1000, 2)
        return {
            "url": url,
            "ok": False,
            "status_code": 0,
            "latency_ms": latency_ms,
            "error": str(e),
        }


async def get_latest_github_commit() -> dict:
    """Fetch the latest commit metadata from GitHub API if GITHUB_REPO is configured."""
    if not GITHUB_REPO:
        return {"ok": False, "error": "GITHUB_REPO not configured"}

    url = f"https://api.github.com/repos/{GITHUB_REPO}/commits?per_page=1"
    headers = {"User-Agent": "JARVIS-Deploy-Watcher"}
    if GITHUB_TOKEN:
        headers["Authorization"] = f"Bearer {GITHUB_TOKEN}"

    try:
        async with httpx.AsyncClient(timeout=6.0) as client:
            resp = await client.get(url, headers=headers)
            if resp.status_code == 200:
                data = resp.json()
                if data and isinstance(data, list):
                    latest = data[0]
                    return {
                        "ok": True,
                        "sha": latest.get("sha", "")[:7],
                        "author": latest.get("commit", {}).get("author", {}).get("name", "Unknown"),
                        "message": latest.get("commit", {}).get("message", "").split("\n")[0],
                        "date": latest.get("commit", {}).get("author", {}).get("date", ""),
                        "url": latest.get("html_url", ""),
                    }
            return {"ok": False, "error": f"GitHub API status {resp.status_code}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}


async def get_system_health_report(health_urls: list[str] = None) -> dict:
    """Compile a full diagnostic status report of RSS memory, GitHub status, and health endpoints."""
    rss_mb = get_process_rss_mb()
    mem_warning = rss_mb >= MEMORY_WARNING_THRESHOLD_MB

    # Default URLs to probe if none supplied
    if not health_urls:
        health_urls = []
        host_url = os.getenv("RENDER_EXTERNAL_URL") or os.getenv("KOYEB_APP_URL")
        if host_url:
            health_urls.append(f"{host_url.rstrip('/')}/ping")
            health_urls.append(f"{host_url.rstrip('/')}/health/mem")

    probes = []
    for u in health_urls:
        res = await check_endpoint_health(u)
        probes.append(res)

    commit_info = await get_latest_github_commit()

    all_ok = (not mem_warning) and all(p["ok"] for p in probes)

    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "all_ok": all_ok,
        "memory": {
            "rss_mb": rss_mb,
            "threshold_mb": MEMORY_WARNING_THRESHOLD_MB,
            "warning": mem_warning,
        },
        "git_commit": commit_info,
        "probes": probes,
    }


_JARVIS_DEPLOY_ALERT_PROMPT = (
    "You are JARVIS, Iron Man's AI assistant monitoring your core system health and cloud deployments. "
    "Compose a brief, 2-sentence alert notification in JARVIS's distinct composed, dry-witted persona. "
    "Highlight the warning or failure metrics clearly. Do not use generic bot placeholders."
)


async def check_deploys_and_notify(
    call_llm_fn=None,
    store_notification_fn=None,
    health_urls: list[str] = None
) -> dict:
    """
    Run diagnostic checks. If any memory warning or endpoint probe failure is detected,
    generate a JARVIS movie-quality notification alert and save it to the web inbox.
    """
    report = await get_system_health_report(health_urls)

    if report["all_ok"]:
        return {"status": "healthy", "alert_sent": False, "report": report}

    # Synthesize alert message
    issues = []
    if report["memory"]["warning"]:
        issues.append(f"Memory RSS is high ({report['memory']['rss_mb']} MB / threshold {MEMORY_WARNING_THRESHOLD_MB} MB)")

    for p in report["probes"]:
        if not p["ok"]:
            issues.append(f"Endpoint {p['url']} failing ({p['error']}, latency {p['latency_ms']}ms)")

    issue_str = "; ".join(issues)

    alert_text = f"⚠️ System Alert: {issue_str}."
    if call_llm_fn:
        try:
            llm_text = await call_llm_fn(
                _JARVIS_DEPLOY_ALERT_PROMPT,
                f"System Diagnostic Summary:\n{issue_str}\nLatest commit: {report['git_commit'].get('sha', 'N/A')} by {report['git_commit'].get('author', 'N/A')}",
                max_tokens=200,
            )
            if llm_text and len(llm_text.strip()) > 10:
                alert_text = llm_text.strip()
        except Exception as e:
            # Fall back to structured alert text if LLM call fails
            pass

    # Store notification in web console inbox if function provided
    if store_notification_fn:
        try:
            await store_notification_fn(
                title="System & Deployment Alert",
                message=alert_text,
                category="system",
                link="/system-status",
            )
        except Exception as e:
            print(f"⚠️ Deploy Watcher: Failed to store notification: {e}")

    return {"status": "degraded", "alert_sent": True, "alert_text": alert_text, "report": report}
