"""
Local test suite for interview_simulator.py (SAFE_MODE=1)
"""
import os
import asyncio

# Enforce throwaway DB and SAFE_MODE
os.environ["SAFE_MODE"] = "1"
os.environ.pop("TURSO_DATABASE_URL", None)
os.environ.pop("TURSO_AUTH_TOKEN", None)
os.environ["DB_PATH"] = "/tmp/jarvis_safe_interview_test.db"

import db_compat as aiosqlite
from interview_simulator import (
    init_interview_tables,
    start_interview_session,
    submit_interview_answer,
    get_interview_session,
    list_interview_sessions
)

async def test_mock_llm(prompt, system_prompt=None):
    if "Generate EXACTLY" in prompt:
        return '{"questions": [{"id": 1, "category": "Behavioral", "question": "Tell me about a time you resolved a complex SQL query issue under pressure.", "target_skills": ["SQL"], "star_focus": "Action & Result"}]}'
    elif "Candidate Answer:" in prompt:
        return '{"score": 90, "star_evaluation": {"situation_present": true, "task_present": true, "action_present": true, "result_present": true, "feedback": "Excellent STAR articulation."}, "xyz_evaluation": {"quantified_metrics_present": true, "metrics_found": ["40%"], "feedback": "Great quantification."}, "jarvis_coaching": "Impressive answer, Madan. Clean STAR delivery.", "missing_elements": [], "suggested_optimized_answer": "Optimized text."}'
    elif "turns_summary" in prompt:
        return '{"overall_score": 90, "hiring_verdict": "Strong Hire", "key_strengths": ["STAR method", "SQL"], "critical_gaps": [], "executive_summary": "Strong technical and behavioral interview."}'
    return "{}"

async def main():
    print("🧪 Testing interview_simulator.py locally...")
    assert aiosqlite.USE_TURSO is False, "ERROR: Turso should not be enabled during SAFE_MODE test!"

    # 1. Start Session
    session = await start_interview_session(
        app_id=1,
        company="Acme Analytics",
        role="Senior Data Analyst",
        job_description="Lead data analyst role working with SQL, Python, and Tableau.",
        num_questions=1,
        call_llm=test_mock_llm,
        db_path="/tmp/jarvis_safe_interview_test.db"
    )
    print("✅ Session started:", session["session_id"], "| Company:", session["company"])
    assert session["company"] == "Acme Analytics"
    assert len(session["questions"]) == 1

    # 2. Submit Answer
    ans_res = await submit_interview_answer(
        session_id=session["session_id"],
        user_answer="At my previous job, I identified a bottleneck in an ETL pipeline (Situation & Task). I rewrote the SQL query using window functions and optimized index usage (Action), which reduced execution time by 40% (Result & Metric).",
        call_llm=test_mock_llm,
        db_path="/tmp/jarvis_safe_interview_test.db"
    )
    print("✅ Answer submitted and evaluated! Score:", ans_res["evaluated_turn"]["evaluation"]["score"])
    assert ans_res["is_completed"] is True
    assert ans_res["overall_scorecard"]["hiring_verdict"] == "Strong Hire"

    # 3. Retrieve Session
    retrieved = await get_interview_session(session["session_id"], db_path="/tmp/jarvis_safe_interview_test.db")
    assert retrieved["status"] == "completed"
    assert len(retrieved["turns"]) == 1
    print("✅ Session retrieved cleanly from SQLite DB.")

    # 4. List Sessions
    sessions_list = await list_interview_sessions(db_path="/tmp/jarvis_safe_interview_test.db")
    assert len(sessions_list) >= 1
    print(f"✅ List sessions count: {len(sessions_list)}")

    print("🎉 All interview_simulator.py local tests passed cleanly!")

if __name__ == "__main__":
    asyncio.run(main())
