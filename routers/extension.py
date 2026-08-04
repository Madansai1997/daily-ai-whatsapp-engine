"""
Extension Router — Backend endpoints for the JARVIS Chrome Extension Copilot.
Handles candidate profile delivery, AI question answering for custom portal fields,
active job saving, and auto-syncing application submission states.
"""

from fastapi import APIRouter, Request, Body
from fastapi.responses import JSONResponse
import db_compat as aiosqlite
import json
import os
import re
from datetime import datetime, timezone
from application_tracker import add_application, update_status_by_id

DB_PATH = os.environ.get("DB_PATH", "agent_memory.db")

router = APIRouter()

# Global dependency references set at server startup
call_llm_fn = None

def set_extension_deps(llm_fn):
    global call_llm_fn
    call_llm_fn = llm_fn


DEFAULT_CANDIDATE_PROFILE = {
    "full_name": "Madansai Daram",
    "first_name": "Madansai",
    "last_name": "Daram",
    "email": "madansai1997@gmail.com",
    "phone": "+91 9963214141",
    "age": "29",
    "city": "Hyderabad",
    "location": "Hyderabad, India",
    "current_company": "Analytics Consultancy",
    "linkedin": "https://linkedin.com/in/madansaidaram",
    "github": "https://github.com/Madansai1997",
    "portfolio": "https://github.com/Madansai1997",
    "work_authorization": "Authorized to work in India / Remote",
    "requires_sponsorship": "No",
    "notice_period": "Immediate / 15 Days",
    "notice_period_option": "Immediately",
    "work_mode": "Work from Home (Full-Time)",
    "expected_salary": "Negotiable as per market standards",
    "target_role": "Data Analyst / Analytics Engineer",
    "skills": "SQL, Python, Power BI, Tableau, Excel, Data Modeling, ETL, PostgreSQL, BigQuery, Pandas, NumPy, Machine Learning",
    "experience_years": "3+ years",
    "experience_range_option": "2 to 4 years",
    "custom_qa_prompt_notes": "Experienced in building automated data pipelines, interactive Power BI dashboards, complex SQL analytics, and financial/operations modeling.",
}

async def init_extension_tables():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("""
            CREATE TABLE IF NOT EXISTS candidate_profile (
                profile_key TEXT PRIMARY KEY,
                data_json TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )
        """)
        await db.commit()

@router.get("/api/extension/profile")
async def get_extension_profile_api():
    """Returns stored candidate profile data for Chrome extension autofill."""
    await init_extension_tables()
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT data_json FROM candidate_profile WHERE profile_key = 'master'")
        row = await cur.fetchone()
        if row and row["data_json"]:
            try:
                profile = json.loads(row["data_json"])
            except Exception:
                profile = dict(DEFAULT_CANDIDATE_PROFILE)
        else:
            profile = dict(DEFAULT_CANDIDATE_PROFILE)
            
    from resume_ats_agent import has_master_docx
    profile["has_master_docx"] = await has_master_docx()
    return JSONResponse({"ok": True, "profile": profile})

@router.post("/api/extension/profile")
async def save_extension_profile_api(payload: dict = Body(...)):
    """Saves updated candidate profile details to database."""
    try:
        await init_extension_tables()
        profile = dict(DEFAULT_CANDIDATE_PROFILE)
        profile.update(payload)
        now_iso = datetime.now(timezone.utc).isoformat()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM candidate_profile WHERE profile_key = 'master'")
            await db.execute(
                "INSERT INTO candidate_profile (profile_key, data_json, updated_at) VALUES ('master', ?, ?)",
                (json.dumps(profile), now_iso)
            )
            await db.commit()
        return JSONResponse({"ok": True, "message": "Candidate profile updated successfully!", "profile": profile})
    except Exception as e:
        print(f"❌ Error saving candidate profile: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/api/extension/answer-question")
async def answer_extension_question_api(payload: dict = Body(...)):
    """AI Question Answering for custom application fields (e.g. 'Why do you want to work here?',
    'Describe a complex SQL problem you solved'). Grounded in Madan's real experience."""
    question = payload.get("question", "")
    company = payload.get("company", "the company")
    role = payload.get("role", "Data Analyst")
    
    if not question:
        return JSONResponse({"ok": False, "error": "No question provided"}, status_code=400)
        
    if not call_llm_fn:
        return JSONResponse({"ok": False, "error": "LLM service unavailable"}, status_code=500)
        
    sys_prompt = (
        "You are JARVIS, an expert executive career advisor answering a job application question for Madan. "
        "Madan is an experienced Data Analyst skilled in SQL, Python, Power BI, Data Modeling, and ETL. "
        "Write a concise, confident, authentic 2-3 sentence response directly answering the question. "
        "Do NOT use bullet points, buzzwords, or quotes. Write in first person ('I')."
    )
    user_prompt = f"Role: {role} @ {company}\nQuestion: {question}\n\nProvide the direct response text to enter into the job application form:"
    
    try:
        answer = await call_llm_fn(sys_prompt, user_prompt)
        answer = answer.strip().strip('"')
        return JSONResponse({"ok": True, "question": question, "answer": answer})
    except Exception as e:
        print(f"❌ Extension AI question error: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/api/extension/save-active-job")
async def save_active_job_api(payload: dict = Body(...)):
    """Save active browser tab job posting to the Kanban board under 'interested'."""
    url = payload.get("url", "")
    title = payload.get("title", "Data Analyst")
    company = payload.get("company", "Company")
    location = payload.get("location", "Remote")
    description = payload.get("description", "")
    
    job_dict = {
        "key": f"ext:{hash(url) & 0xffffffff}",
        "title": title,
        "company": company,
        "location": location,
        "url": url,
        "source": "Chrome Extension",
        "description": description[:2500],
    }
    
    try:
        ok, job_id = await add_application(job_dict, status="interested")
        return JSONResponse({
            "ok": True,
            "added": ok,
            "job_id": job_id,
            "message": f"Saved '{title}' @ {company} to your Interested board!"
        })
    except Exception as e:
        print(f"❌ Extension save job error: {e}")
        return JSONResponse({"ok": False, "error": str(e)}, status_code=500)


@router.post("/api/extension/mark-applied")
async def mark_extension_applied_api(payload: dict = Body(...)):
    """Auto-sync application submission when extension detects application confirmation page."""
    url = payload.get("url", "")
    company = payload.get("company", "")
    title = payload.get("title", "")
    
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT id, title, company FROM applications WHERE url = ? OR (LOWER(company) LIKE LOWER(?) AND LOWER(title) LIKE LOWER(?)) ORDER BY id DESC LIMIT 1", (url, f"%{company}%", f"%{title}%"))
        row = await cur.fetchone()
        
        if row:
            app_id = row["id"]
            now_iso = datetime.now(timezone.utc).isoformat()
            await update_status_by_id(app_id, "applied")
            await db.execute("UPDATE applications SET applied_at = ? WHERE id = ?", (now_iso, app_id))
            await db.commit()
            return JSONResponse({"ok": True, "synced": True, "app_id": app_id, "message": f"Auto-synced status to APPLIED for {row['title']} @ {row['company']}!"})
            
    return JSONResponse({"ok": True, "synced": False, "message": "No matching unapplied record found to update."})
