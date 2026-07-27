"""
Comprehensive API Route & Mock Interview Test (SAFE_MODE=1)
"""
import os
import asyncio
from fastapi.testclient import TestClient

# Enforce SAFE_MODE throwaway local DB
os.environ["SAFE_MODE"] = "1"
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)
os.environ["DB_PATH"] = "/tmp/jarvis_safe_route_test.db"

import db_compat as aiosqlite
from V3_updates import app, _make_token, AUTH_REQUIRED

client = TestClient(app)

def test_routes():
    print("🧪 Running API route tests with TestClient...")
    assert aiosqlite.USE_TURSO is False, "ERROR: Turso should not be enabled in SAFE_MODE!"

    token = _make_token() if AUTH_REQUIRED else ""
    headers = {"X-Jarvis-Token": token} if token else {}

    # 1. Health Status
    res = client.get("/health/status")
    assert res.status_code == 200
    assert res.json()["status"] == "healthy"
    print("  ✅ GET /health/status -> 200 OK")

    # 2. Ping
    res = client.get("/ping")
    assert res.status_code == 200
    assert res.json()["ping"] == "pong"
    print("  ✅ GET /ping -> 200 OK")

    # 3. Deploy Watcher Status
    res = client.get("/api/deploy-watcher/status", headers=headers)
    assert res.status_code == 200
    assert res.json()["ok"] is True
    print("  ✅ GET /api/deploy-watcher/status -> 200 OK")

    # 4. Applications List
    res = client.get("/applications", headers=headers)
    assert res.status_code == 200
    print("  ✅ GET /applications -> 200 OK")

    # 5. Resume Status
    res = client.get("/resume/status", headers=headers)
    assert res.status_code == 200
    print("  ✅ GET /resume/status -> 200 OK")

    # 6. Bills List
    res = client.get("/api/bills", headers=headers)
    assert res.status_code == 200
    print("  ✅ GET /api/bills -> 200 OK")

    # 7. Mock Interview Session Endpoints (P1)
    res = client.post("/api/interviews/simulate", json={
        "company": "Google",
        "role": "Data Analyst",
        "job_description": "Data analyst role focusing on SQL and metrics.",
        "num_questions": 2
    }, headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["ok"] is True
    session_id = data["session"]["session_id"]
    print("  ✅ POST /api/interviews/simulate -> 200 OK (session_id:", session_id, ")")

    # 8. Submit Mock Interview Answer
    res = client.post(f"/api/interviews/session/{session_id}/answer", json={
        "answer": "At my previous company I analyzed user drop-off using SQL, optimizing queries to boost retention by 25%."
    }, headers=headers)
    assert res.status_code == 200
    ans_data = res.json()
    assert ans_data["ok"] is True
    print("  ✅ POST /api/interviews/session/{session_id}/answer -> 200 OK")

    # 9. Get Session Details
    res = client.get(f"/api/interviews/session/{session_id}", headers=headers)
    assert res.status_code == 200
    assert res.json()["session"]["session_id"] == session_id
    print("  ✅ GET /api/interviews/session/{session_id} -> 200 OK")

    print("\n🎉 All APIRouter and Mock Interview endpoints tested & verified successfully!")

if __name__ == "__main__":
    test_routes()
