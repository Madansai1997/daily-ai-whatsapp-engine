"""
FastAPI Router for Jobs, Applications, Resume ATS, Networking CRM & Mock Interviews
"""
import os
import json
import httpx
import db_compat as aiosqlite
from fastapi import APIRouter, Request, Response, UploadFile, File
from fastapi.responses import JSONResponse, FileResponse
from datetime import datetime, timezone

from application_tracker import (
    add_application,
    list_applications,
    get_application,
    update_status_by_id as update_application_status_by_id,
    delete_application,
    update_description as update_application_description,
    list_review_queue,
    count_review_queue,
    mark_reviewed,
    list_application_events,
    response_analytics,
    format_applications,
    VALID_STATUSES as APPLICATION_STATUSES,
)
from job_scout_agent import (
    run_on_demand_search,
    search_now_to_board,
    get_profile as get_job_profile,
    save_profile as save_job_profile,
)
from job_apply_agent import (
    run_apply_prep,
    apply_now,
    confirm_apply,
    list_pending_confirm,
    apply_method,
)
from resume_ats_agent import (
    analyze as run_ats_alignment,
    get_analysis as get_cached_ats_analysis,
    delete_analysis as delete_ats_analysis,
    count_unviewed as count_pending_ats,
    get_resume_template as get_master_resume,
    save_resume_template as save_master_resume,
    delete_resume_template as delete_master_resume,
    compile_txt as format_plain_text_download,
    get_saved_audit,
    has_master_docx,
    get_scores_map as get_ats_scores_map,
    get_recruiter_scores_map,
)
from interview_simulator import (
    start_interview_session,
    submit_interview_answer,
    get_interview_session,
    list_interview_sessions,
)

router = APIRouter(tags=["Jobs & Career"])

# Injected LLM & helper dependencies from V3_updates engine
call_llm_fn = None
send_whatsapp_fn = None

def init_jobs_router_deps(call_llm, send_whatsapp):
    global call_llm_fn, send_whatsapp_fn
    call_llm_fn = call_llm
    send_whatsapp_fn = send_whatsapp


# --- Mock Interviewer Endpoints (P1) ---------------------------------------

@router.post("/api/interviews/simulate")
async def api_interviews_simulate(request: Request):
    """Starts an interactive AI mock interview session for a given job card or role."""
    body = await request.json()
    app_id = body.get("app_id")
    company = body.get("company")
    role = body.get("role")
    job_description = body.get("job_description")
    num_questions = int(body.get("num_questions", 3))

    session = await start_interview_session(
        app_id=app_id,
        company=company,
        role=role,
        job_description=job_description,
        num_questions=num_questions,
        call_llm=call_llm_fn
    )
    return JSONResponse({"ok": True, "session": session})


@router.post("/api/interviews/session/{session_id}/answer")
async def api_interviews_submit_answer(session_id: str, request: Request):
    """Submits candidate answer for STAR & XYZ feedback and scoring."""
    body = await request.json()
    user_answer = (body.get("answer") or "").strip()
    if not user_answer:
        return JSONResponse({"ok": False, "error": "Answer text is required."}, status_code=400)

    res = await submit_interview_answer(
        session_id=session_id,
        user_answer=user_answer,
        call_llm=call_llm_fn
    )
    return JSONResponse({"ok": True, "result": res})


@router.get("/api/interviews/session/{session_id}")
async def api_interviews_get_session(session_id: str):
    """Gets details and turns of an interview session."""
    session = await get_interview_session(session_id)
    if not session:
        return JSONResponse({"ok": False, "error": "Session not found"}, status_code=404)
    return JSONResponse({"ok": True, "session": session})


@router.get("/api/interviews/sessions")
async def api_interviews_list_sessions(app_id: int = None):
    """Lists interview sessions."""
    sessions = await list_interview_sessions(app_id=app_id)
    return JSONResponse({"ok": True, "sessions": sessions})


# --- Applications & Job Board Endpoints ------------------------------------

@router.get("/applications")
async def get_applications_api():
    apps = await list_applications()
    keys = [(a.get("job_key") or f"app:{a.get('id')}") for a in apps]
    scores = await get_ats_scores_map(keys)
    rec_scores = await get_recruiter_scores_map(keys)
    try:
        from company_watch_agent import news_counts_by_company
        news_counts = await news_counts_by_company()
    except Exception:
        news_counts = {}
    for a in apps:
        k = a.get("job_key") or f"app:{a.get('id')}"
        s = scores.get(k)
        a["ats_score"] = s["ats_score"] if s else None
        a["ats_scored_at"] = s["created_at"] if s else None
        a["ghost_job_risk"] = s["ghost_job_risk"] if s else None
        a["ghost_job_reasons"] = s["ghost_job_reasons"] if s else None
        rs = rec_scores.get(k)
        a["recruiter_score"] = rs["recruiter_score"] if rs else None
        a["recruiter_scored_at"] = rs["created_at"] if rs else None
        a["apply_method"] = apply_method(a)
        a["news_count"] = news_counts.get((a.get("company") or "").strip().lower(), 0)
    return JSONResponse({"applications": apps, "statuses": APPLICATION_STATUSES})


@router.post("/applications/update")
async def applications_update_api(request: Request):
    body = await request.json()
    ok, result = await update_application_status_by_id(int(body.get("id")), body.get("status", ""))
    return JSONResponse({"ok": ok, "result": result}, status_code=200 if ok else 400)


@router.post("/applications/delete")
async def applications_delete_api(request: Request):
    body = await request.json()
    app_id = int(body.get("id"))
    app_row = await get_application(app_id)
    if app_row:
        await delete_ats_analysis(app_row.get("job_key") or f"app:{app_id}")
    await delete_application(app_id)
    return JSONResponse({"ok": True})


@router.post("/applications/add-manual")
async def applications_add_manual_api(request: Request):
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse({"ok": False, "error": "Title required"}, status_code=400)
    company = (body.get("company") or "Manual Entry").strip()
    status = (body.get("status") or "applied").strip().lower()
    url = (body.get("url") or "").strip()
    location = (body.get("location") or "").strip()
    description = (body.get("description") or "").strip()

    job_dict = {
        "title": title, "company": company, "location": location,
        "url": url, "description": description, "source": "manual",
        "posted_text": "Manually added",
        "key": f"manual:{title[:20]}:{company[:20]}:{int(datetime.now(timezone.utc).timestamp())}"
    }
    app_id = await add_application(job_dict, status=status)
    return JSONResponse({"ok": True, "app_id": app_id})


@router.get("/api/job-scout/review-queue")
async def api_job_scout_review_queue():
    cards = await list_review_queue()
    return JSONResponse({"ok": True, "cards": cards, "queue": cards})


@router.get("/api/job-scout/review-queue/count")
async def api_job_scout_review_queue_count():
    cnt = await count_review_queue()
    return JSONResponse({"ok": True, "count": cnt})


def _parse_json_obj(raw: str):
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


@router.post("/api/job-scout/ats-search")
async def api_job_scout_ats_search(request: Request):
    """Perform real-time Google Search Grounding to find direct applicant tracking system (ATS) job postings."""
    body = await request.json()
    role = (body.get("role") or "Data Analyst").strip()
    experience = (body.get("experience") or "2+ years").strip()
    location = (body.get("location") or "India").strip()

    prompt = (
        f"You are JARVIS. Find direct company website job postings for a '{role}' role "
        f"with '{experience}' experience in '{location}'.\n"
        f"Search across major applicant tracking systems (Greenhouse, Lever, Workday, Ashby, SmartRecruiters) "
        f"for direct company career pages. Focus on active roles matching the experience requirement.\n\n"
        f"Return a strict JSON list of 10 job listings with the following schema (no markdown, no formatting prose):\n"
        f"[\n"
        f"  {{\n"
        f'    "title": "Exact Job Title",\n'
        f'    "company": "Exact Company Name",\n'
        f'    "location": "Location Name",\n'
        f'    "url": "Direct Greenhouse/Lever/Workday/Ashby/SmartRecruiters URL",\n'
        f'    "experience": "Brief required experience summary, e.g. 2-5 years",\n'
        f'    "ats": "Greenhouse|Lever|Workday|Ashby|SmartRecruiters|Other"\n'
        f"  }}\n"
        f"]"
    )

    gemini_key = os.environ.get("GEMINI_API_KEY", "").strip()
    if gemini_key:
        endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={gemini_key}"
        body_data = {
            "contents": [{"parts": [{"text": prompt}]}],
            "tools": [{"googleSearch": {}}]
        }
        try:
            async with httpx.AsyncClient(timeout=45) as client:
                res = await client.post(endpoint, json=body_data)
            if res.status_code == 200:
                data = res.json()
                candidates = data.get("candidates") or []
                if candidates:
                    parts = candidates[0].get("content", {}).get("parts", [])
                    text = parts[0].get("text", "") if parts else ""
                    if text:
                        jobs = _parse_json_obj(text)
                        if isinstance(jobs, dict):
                            jobs = jobs.get("jobs", [])
                        if isinstance(jobs, list):
                            return JSONResponse({"ok": True, "jobs": jobs})
        except Exception as ex:
            print(f"⚠️ Note: Gemini Grounding direct API call failed: {ex}")

    # Fallback to general LLM completion if Gemini Grounding direct call fails or key unconfigured
    if call_llm_fn:
        try:
            raw = await call_llm_fn(prompt)
            jobs = _parse_json_obj(raw)
            if isinstance(jobs, dict):
                jobs = jobs.get("jobs", [])
            if isinstance(jobs, list):
                return JSONResponse({"ok": True, "jobs": jobs})
        except Exception as e:
            err_msg = str(e) or type(e).__name__
            return JSONResponse({"ok": False, "error": f"ATS Search failed: {err_msg}"}, status_code=500)

    return JSONResponse({"ok": False, "error": "ATS Search unavailable (LLM service unconfigured)"}, status_code=503)


@router.post("/api/job-scout/search-now")
async def api_job_scout_search_now(request: Request):
    body = await request.json() if request.headers.get("content-type") == "application/json" else {}
    q = body.get("query")
    res = await search_now_to_board(query=q, call_llm=call_llm_fn, notify_fn=send_whatsapp_fn)
    return JSONResponse(res)


# --- Resume ATS Alignment Endpoints ---------------------------------------

@router.get("/resume/status")
async def resume_status_api():
    tmpl = await get_master_resume()
    return JSONResponse({"has_resume": bool((tmpl or "").strip())})


@router.get("/resume")
async def get_resume_api():
    res = await get_master_resume()
    return JSONResponse(res)


@router.post("/resume/upload")
async def upload_resume_api(request: Request):
    body = await request.json()
    text = body.get("text") or ""
    res = await save_master_resume(text)
    return JSONResponse(res)


@router.post("/resume/delete")
async def delete_resume_api():
    res = await delete_master_resume()
    return JSONResponse(res)


@router.post("/applications/{app_id}/ats")
async def run_ats_for_app_api(app_id: int):
    app_row = await get_application(app_id)
    if not app_row:
        return JSONResponse({"ok": False, "error": "Application not found"}, status_code=404)

    job_ref = app_row.get("job_key") or f"app:{app_id}"
    job_desc = app_row.get("description") or ""

    if not job_desc.strip():
        return JSONResponse({
            "ok": False,
            "error": "No Job Description found on this card. Paste the JD into the card description first!"
        }, status_code=400)

    res = await run_ats_alignment(
        job_ref=job_ref,
        job_title=app_row.get("title") or "Position",
        job_company=app_row.get("company") or "Company",
        job_description=job_desc,
        call_llm=call_llm_fn
    )
    return JSONResponse(res)


@router.get("/ats/{job_ref:path}")
async def get_ats_analysis_api(job_ref: str):
    analysis = await get_cached_ats_analysis(job_ref)
    if not analysis:
        return JSONResponse({"ok": False, "error": "No ATS analysis cached for this ref"}, status_code=404)
    return JSONResponse({"ok": True, "analysis": analysis})


@router.get("/ats/pending/count")
async def get_ats_pending_count_api():
    cnt = await count_pending_ats()
    return JSONResponse({"ok": True, "count": cnt})
