"""
Interactive AI Mock Interviewer & Voice Coach (interview_simulator.py)

Simulates technical and behavioral hiring manager interviews tailored to specific tracked jobs.
Evaluates candidate answers against the STAR method (Situation, Task, Action, Result) and
XYZ metric structure ("Accomplished X as measured by Y, by doing Z").

Provides real-time JARVIS-persona coaching, score breakdowns, missing metric callouts,
and optimized answer suggestions.
"""

import os
import json
import uuid
import re
import db_compat as aiosqlite
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))


def _parse_json_object(raw: str):
    raw = (raw or "").strip()
    start_obj = raw.find("{")
    start_arr = raw.find("[")
    if start_obj == -1 and start_arr == -1:
        raise ValueError("no JSON object or array found")
    if start_obj == -1:
        start = start_arr
    elif start_arr == -1:
        start = start_obj
    else:
        start = min(start_obj, start_arr)
    obj, _ = json.JSONDecoder().raw_decode(raw[start:])
    return obj


async def init_interview_tables(db_path: str = None):
    p = db_path or os.environ.get("DB_PATH", DB_PATH)
    async with aiosqlite.connect(p) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS interview_sessions (
                session_id TEXT PRIMARY KEY,
                app_id INTEGER,
                company TEXT NOT NULL,
                role TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'active',
                current_question_index INTEGER NOT NULL DEFAULT 0,
                questions TEXT NOT NULL DEFAULT '[]',
                turns TEXT NOT NULL DEFAULT '[]',
                overall_scorecard TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
        """)
        await db.commit()
    print("✅ Interview Simulator table initialized.")


SYSTEM_QUESTION_GEN_PROMPT = """You are an expert hiring manager and principal technical interviewer at {company} interviewing a candidate for the {role} position.

Target Job Description Context:
{job_description}

Generate EXACTLY {num_questions} realistic, challenging, high-signal interview questions tailored to this role.
Mix behavioral STAR questions, core technical/domain scenarios, and role-specific problem solving.

Return a STRICT JSON object only:
{{
  "questions": [
    {{
      "id": 1,
      "category": "Behavioral / Technical / Domain / Leadership",
      "question": "<the exact interview question phrasing>",
      "target_skills": ["<skill1>", "<skill2>"],
      "star_focus": "<what specific STAR element is crucial for this question>"
    }}
  ]
}}
"""

SYSTEM_EVALUATOR_PROMPT = """You are JARVIS, an elite AI interview coach. You are evaluating a candidate's response to an interview question for {company} ({role}).

Question:
"{question}"

Candidate Answer:
"{answer}"

Target Job Description Context:
{job_description}

Evaluate the candidate's answer strictly against:
1. STAR Framework (Situation, Task, Action, Result) — Check if all 4 are clearly articulated.
2. XYZ Formula ("Accomplished [X] as measured by [Y], by doing [Z]") — Check for concrete, quantified impact/metrics.
3. Technical Accuracy & Relevance to the {role} position.

Return a STRICT JSON object only:
{{
  "score": <integer between 0 and 100>,
  "star_evaluation": {{
    "situation_present": <boolean>,
    "task_present": <boolean>,
    "action_present": <boolean>,
    "result_present": <boolean>,
    "feedback": "<1-2 sentence feedback on STAR structure>"
  }},
  "xyz_evaluation": {{
    "quantified_metrics_present": <boolean>,
    "metrics_found": ["<extracted metrics or empty>"],
    "feedback": "<1-2 sentence feedback on quantified impact>"
  }},
  "jarvis_coaching": "<2-3 sentence JARVIS voice evaluation — encouraging, sharp, witty, professional>",
  "missing_elements": ["<element 1>", "<element 2>"],
  "suggested_optimized_answer": "<A model response formatted cleanly using STAR and XYZ metrics tailored to the candidate's answer>"
}}
"""

SYSTEM_SCORECARD_PROMPT = """You are JARVIS, compiling the final executive interview scorecard for {company} ({role}).

Interview History:
{turns_summary}

Return a STRICT JSON object only:
{{
  "overall_score": <integer 0-100 average/weighted>,
  "hiring_verdict": "Strong Hire | Hire | Weak Hire | No Hire",
  "key_strengths": ["<strength 1>", "<strength 2>"],
  "critical_gaps": ["<gap 1>", "<gap 2>"],
  "executive_summary": "<3 sentence JARVIS movie-style overall interview assessment>"
}}
"""


async def start_interview_session(
    app_id: int,
    company: str = None,
    role: str = None,
    job_description: str = None,
    num_questions: int = 5,
    call_llm=None,
    db_path: str = None
) -> dict:
    """Initializes a new interview session for a given job application ID."""
    p = db_path or os.environ.get("DB_PATH", DB_PATH)
    await init_interview_tables(p)

    target_company = company or "Target Company"
    target_role = role or "Data Analyst"
    target_jd = job_description or ""

    # If app_id provided, fetch application record from DB if company/role missing
    if app_id:
        try:
            async with aiosqlite.connect(p) as db:
                db.row_factory = aiosqlite.Row
                async with db.execute(
                    "SELECT company, title, description FROM applications WHERE id = ?", (app_id,)
                ) as cursor:
                    row = await cursor.fetchone()
                    if row:
                        if not company:
                            target_company = row["company"] or target_company
                        if not role:
                            target_role = row["title"] or target_role
                        if not target_jd:
                            target_jd = row["description"] or ""
        except Exception as e:
            print(f"ℹ️ Note: Could not query applications table for app_id {app_id}: {e}")

    if not target_jd:
        target_jd = f"{target_role} position at {target_company} focusing on data analysis, SQL, Python, and business insights."

    # Generate questions via LLM
    questions = []
    if call_llm:
        prompt = SYSTEM_QUESTION_GEN_PROMPT.format(
            company=target_company,
            role=target_role,
            job_description=target_jd[:2000],
            num_questions=num_questions
        )
        try:
            raw_res = await call_llm(prompt, system_prompt="You are a senior technical interviewer. Output valid JSON only.")
            parsed = _parse_json_object(raw_res)
            questions = parsed.get("questions", [])
        except Exception as e:
            print(f"⚠️ Warning: LLM question generation failed: {e}")

    # Fallback default questions if LLM generation is unavailable or fails
    if not questions:
        questions = [
            {
                "id": 1,
                "category": "Behavioral (STAR)",
                "question": f"Tell me about a time at your previous role where you had to solve a complex data quality issue under a tight deadline for the {target_role} team.",
                "target_skills": ["Problem Solving", "Data Validation", "Communication"],
                "star_focus": "Action taken to validate root cause and quantified Result."
            },
            {
                "id": 2,
                "category": "Technical Scenario",
                "question": f"How do you approach optimizing a slow-running SQL query or dataset pipeline when working with large volumes of data at {target_company}?",
                "target_skills": ["SQL Optimization", "Indexing", "Performance Tuning"],
                "star_focus": "Specific optimization techniques used and performance gain % result."
            },
            {
                "id": 3,
                "category": "Domain & Metrics",
                "question": f"Describe a project where you turned raw analytics into actionable business recommendations for stakeholders. What XYZ metrics proved success?",
                "target_skills": ["Business Intelligence", "Stakeholder Communication", "Metrics"],
                "star_focus": "Quantified business impact (XYZ metric formula)."
            }
        ]

    session_id = f"intv_{uuid.uuid4().hex[:10]}"
    now = datetime.now(timezone.utc).isoformat()

    async with aiosqlite.connect(p) as db:
        await db.execute(
            """
            INSERT INTO interview_sessions (
                session_id, app_id, company, role, status, current_question_index,
                questions, turns, overall_scorecard, created_at, updated_at
            ) VALUES (?, ?, ?, ?, 'active', 0, ?, '[]', '{}', ?, ?)
            """,
            (
                session_id, app_id, target_company, target_role,
                json.dumps(questions), now, now
            )
        )
        await db.commit()

    return {
        "session_id": session_id,
        "app_id": app_id,
        "company": target_company,
        "role": target_role,
        "status": "active",
        "current_question_index": 0,
        "total_questions": len(questions),
        "current_question": questions[0] if questions else None,
        "questions": questions
    }


async def submit_interview_answer(
    session_id: str,
    user_answer: str,
    call_llm=None,
    db_path: str = None
) -> dict:
    """Evaluates the user's candidate answer for the active question in the interview session."""
    p = db_path or os.environ.get("DB_PATH", DB_PATH)
    async with aiosqlite.connect(p) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM interview_sessions WHERE session_id = ?", (session_id,)
        ) as cursor:
            session = await cursor.fetchone()

    if not session:
        raise ValueError(f"Interview session {session_id} not found.")

    if session["status"] == "completed":
        return {
            "session_id": session_id,
            "status": "completed",
            "message": "Session is already completed.",
            "overall_scorecard": json.loads(session["overall_scorecard"])
        }

    company = session["company"]
    role = session["role"]
    questions = json.loads(session["questions"])
    turns = json.loads(session["turns"])
    current_idx = session["current_question_index"]

    if current_idx >= len(questions):
        return {"session_id": session_id, "status": "completed", "turns": turns}

    current_q = questions[current_idx]

    # Evaluate answer via LLM
    eval_res = None
    if call_llm:
        prompt = SYSTEM_EVALUATOR_PROMPT.format(
            company=company,
            role=role,
            question=current_q["question"],
            answer=user_answer,
            job_description=f"{role} at {company}"
        )
        try:
            raw_eval = await call_llm(prompt, system_prompt="You are an elite interview evaluator. Return valid JSON only.")
            eval_res = _parse_json_object(raw_eval)
        except Exception as e:
            print(f"⚠️ Warning: LLM answer evaluation failed: {e}")

    if not eval_res:
        # Heuristic fallback evaluation
        has_metrics = bool(re.search(r"\d+%|\$\d+|\d+x|\d+ hours|\d+ (users|rows|records)", user_answer, re.I))
        score = 80 if len(user_answer.split()) > 30 and has_metrics else 65
        eval_res = {
            "score": score,
            "star_evaluation": {
                "situation_present": True,
                "task_present": True,
                "action_present": len(user_answer.split()) > 20,
                "result_present": has_metrics,
                "feedback": "Good response. Ensure you clearly state the final outcome and measurable result."
            },
            "xyz_evaluation": {
                "quantified_metrics_present": has_metrics,
                "metrics_found": re.findall(r"\d+(?:%|\s*percent|\s*k|\s*m)?", user_answer),
                "feedback": "Metrics detected." if has_metrics else "Include specific numbers (% improvement, time saved, data scale)."
            },
            "jarvis_coaching": f"Solid effort on '{current_q['category']}'. " + ("Strong metrics included!" if has_metrics else "Aim to quantify your impact in the next response."),
            "missing_elements": [] if has_metrics else ["Quantified impact (% improvement or dataset scale)"],
            "suggested_optimized_answer": user_answer + " This resulted in a 35% reduction in query runtime."
        }

    turn_record = {
        "question_index": current_idx,
        "question_id": current_q.get("id", current_idx + 1),
        "category": current_q.get("category", "General"),
        "question": current_q["question"],
        "user_answer": user_answer,
        "evaluation": eval_res,
        "timestamp": datetime.now(timezone.utc).isoformat()
    }
    turns.append(turn_record)

    next_idx = current_idx + 1
    is_last = next_idx >= len(questions)
    new_status = "completed" if is_last else "active"
    scorecard = {}

    if is_last:
        # Generate final overall scorecard
        turns_summary_text = "\n".join(
            f"Q{t['question_index']+1} ({t['category']}): {t['question']}\nScore: {t['evaluation']['score']}/100\nFeedback: {t['evaluation']['jarvis_coaching']}\n"
            for t in turns
        )
        if call_llm:
            sc_prompt = SYSTEM_SCORECARD_PROMPT.format(
                company=company,
                role=role,
                turns_summary=turns_summary_text
            )
            try:
                raw_sc = await call_llm(sc_prompt, system_prompt="You are an executive interviewer. Return valid JSON only.")
                scorecard = _parse_json_object(raw_sc)
            except Exception:
                pass

        if not scorecard:
            avg_score = round(sum(t["evaluation"]["score"] for t in turns) / max(len(turns), 1))
            scorecard = {
                "overall_score": avg_score,
                "hiring_verdict": "Strong Hire" if avg_score >= 85 else ("Hire" if avg_score >= 70 else "Weak Hire"),
                "key_strengths": ["Structured responses", "Technical understanding"],
                "critical_gaps": ["Increase STAR metric quantification across all answers"],
                "executive_summary": f"Completed mock interview for {role} at {company} with an overall score of {avg_score}/100. Demonstrates solid domain knowledge with room to sharpen XYZ metric metrics."
            }

    now = datetime.now(timezone.utc).isoformat()
    async with aiosqlite.connect(p) as db:
        await db.execute(
            """
            UPDATE interview_sessions
            SET current_question_index = ?,
                turns = ?,
                status = ?,
                overall_scorecard = ?,
                updated_at = ?
            WHERE session_id = ?
            """,
            (
                next_idx,
                json.dumps(turns),
                new_status,
                json.dumps(scorecard),
                now,
                session_id
            )
        )
        await db.commit()

    return {
        "session_id": session_id,
        "status": new_status,
        "evaluated_turn": turn_record,
        "next_question_index": next_idx if not is_last else None,
        "next_question": questions[next_idx] if not is_last else None,
        "is_completed": is_last,
        "overall_scorecard": scorecard if is_last else None
    }


async def get_interview_session(session_id: str, db_path: str = None) -> dict:
    """Fetches full interview session state and turns."""
    p = db_path or os.environ.get("DB_PATH", DB_PATH)
    await init_interview_tables(p)
    async with aiosqlite.connect(p) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT * FROM interview_sessions WHERE session_id = ?", (session_id,)
        ) as cursor:
            row = await cursor.fetchone()

    if not row:
        return None

    d = dict(row)
    d["questions"] = json.loads(d["questions"] or "[]")
    d["turns"] = json.loads(d["turns"] or "[]")
    d["overall_scorecard"] = json.loads(d["overall_scorecard"] or "{}")
    return d


async def list_interview_sessions(app_id: int = None, limit: int = 20, db_path: str = None) -> list:
    """Lists recent interview sessions."""
    p = db_path or os.environ.get("DB_PATH", DB_PATH)
    await init_interview_tables(p)
    async with aiosqlite.connect(p) as db:
        db.row_factory = aiosqlite.Row
        if app_id:
            query = "SELECT * FROM interview_sessions WHERE app_id = ? ORDER BY created_at DESC LIMIT ?"
            params = (app_id, limit)
        else:
            query = "SELECT * FROM interview_sessions ORDER BY created_at DESC LIMIT ?"
            params = (limit,)
        async with db.execute(query, params) as cursor:
            rows = await cursor.fetchall()

    results = []
    for r in rows:
        d = dict(r)
        d["questions"] = json.loads(d["questions"] or "[]")
        d["turns"] = json.loads(d["turns"] or "[]")
        d["overall_scorecard"] = json.loads(d["overall_scorecard"] or "{}")
        results.append(d)
    return results
