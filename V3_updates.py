import os
import time
import sqlite3

# --- SAFE_MODE: structural guard for dev/test runs --------------------------------
# Set SAFE_MODE (env var, e.g. `SAFE_MODE=1 uvicorn ...`) to force a throwaway local
# SQLite DB and suppress real WhatsApp sends — so testing can NEVER write to the live
# Turso DB or message Madan. This MUST run before `import db_compat`, which chooses its
# backend (Turso vs sqlite) from the environment at import time. Unset in production.
SAFE_MODE = os.environ.get("SAFE_MODE", "").strip().lower() in ("1", "true", "yes", "on")
if SAFE_MODE:
    os.environ.pop("TURSO_DATABASE_URL", None)
    os.environ.pop("TURSO_AUTH_TOKEN", None)
    os.environ.setdefault("DB_PATH", "/tmp/jarvis_safe_mode.db")
    print("🧪 SAFE_MODE ON — throwaway local DB, WhatsApp sends suppressed.")

import db_compat as aiosqlite
import asyncio
import json

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

import threading
import random
import requests
import subprocess
import re
import base64
import datetime as dt
from datetime import date
from zoneinfo import ZoneInfo
from dotenv import load_dotenv
from bs4 import BeautifulSoup
import httpx
import websockets as ws_lib
from fastapi import FastAPI, Response, Form, Request, WebSocket, WebSocketDisconnect, UploadFile, File
from fastapi.responses import JSONResponse, HTMLResponse, RedirectResponse, FileResponse, Response
from twilio.rest import Client
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from openai import AsyncOpenAI

load_dotenv()

from llm_gateway import GATEWAY
from prompts import INTENT_FEWSHOT, ANALYST_SYSTEM, ANALYST_HYPOTHESES_SYSTEM, ANALYST_SCR_SYSTEM
from rag_engine import retrieve_relevant_context, search_user_facts
from email_triage import (
    init_email_tables,
    check_inbox_and_notify,
    summarize_inbox,
    get_active_draft,
    activate_next_draft,
    delete_draft,
    count_pending_drafts,
    get_medium_count,
    get_low_count,
    approve_draft,
    edit_draft,
    save_composed_draft,
    get_latest_composed_draft,
    cancel_composed_draft,
    send_composed_email,
    create_gmail_draft,
    get_connected_gmail_address,
    search_company_threads,
)
from reminders import (
    init_reminder_tables,
    register_all_active_reminders,
    create_reminder_from_intent,
    get_active_reminders,
    mark_fired as mark_reminder_fired,
)
from calendar_agent import (
    init_calendar_tables,
    list_upcoming_events,
    check_availability,
    create_event,
    delete_event,
    save_pending_event,
    get_latest_pending_event,
    cancel_pending_event,
    confirm_pending_event,
)
from automations import (
    init_automation_tables,
    register_all_active_automations,
    get_active_automations,
    mark_fired as mark_automation_fired,
)
from pattern_learning import (
    init_pattern_tables,
    record_email_edit,
    refresh_email_tone_pattern,
    refresh_reminder_timing_pattern,
    refresh_calendar_prefs_pattern,
    refresh_reply_style_pattern,
    refresh_all_patterns,
    get_pattern_context,
)
from job_scout_agent import (
    init_job_scout_tables,
    run_job_scout_digest,
    run_on_demand_search,
    search_now_to_board,
    get_last_shown as get_scout_last_shown,
    get_profile as get_job_profile,
    save_profile as save_job_profile,
)
from job_apply_agent import (
    init_job_apply_tables,
    run_apply_prep,
    apply_now,
    confirm_apply,
    list_pending_confirm,
    apply_method,
)
from application_tracker import (
    init_application_tracker_tables,
    add_application,
    add_scout_application,
    list_applications,
    get_application,
    update_status as update_application_status,
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
from followup_agent import (
    init_followup_tables,
    list_followup_candidates,
    draft_followup,
    send_followup,
    run_auto_followups,
    list_followup_drafts,
    get_open_draft,
    store_followup_draft,
    mark_draft_status,
)
from workspace_notes import (
    init_workspace_notes_tables,
    list_notes,
    create_note,
    update_note,
    delete_note,
)
from interview_prep import (
    list_interview_events,
    prep_brief,
)
from networking_crm import (
    init_networking_crm_tables,
    list_contacts,
    add_contact,
    update_contact,
    mark_contacted,
    delete_contact,
    RELATIONSHIPS as CONTACT_RELATIONSHIPS,
)
from profile_freshness import (
    init_profile_freshness_tables,
    list_assets as list_profile_assets,
    mark_updated as mark_asset_updated,
    update_asset as update_profile_asset,
    add_asset as add_profile_asset,
    delete_asset as delete_profile_asset,
)
from trend_lab_agent import (
    init_trend_lab_tables,
    run_trend_scan,
    list_trend_ideas,
    set_idea_status as set_trend_idea_status,
    trend_lab_stats,
    generate_build_brief,
    get_build_brief,
)
from calendar_shield import analyze as calendar_shield_analyze
from daily_standup import standup_briefing, cockpit as cockpit_brief
from gemini_tts import (
    synthesize as gemini_synthesize,
    tts_available as gemini_tts_available,
    VOICES as GEMINI_VOICES,
    GEMINI_TTS_VOICE as GEMINI_DEFAULT_VOICE,
)
from application_email_tracker import (
    init_application_email_tracker_tables,
    scan_and_sync as scan_application_emails,
    list_pending as list_application_pending,
    confirm_pending as confirm_application_pending,
    dismiss_pending as dismiss_application_pending,
    count_pending as count_application_pending,
)
from bill_watcher import (
    init_bill_watcher_tables,
    add_bill,
    list_bills,
    list_view as bills_view,
    mark_paid as mark_bill_paid,
    mark_paid_by_id as mark_bill_paid_by_id,
    delete_bill,
    delete_by_id as delete_bill_by_id,
    format_bills,
    check_bills_and_notify,
)
from resume_ats_agent import (
    init_resume_ats_tables,
    analyze as run_ats_analysis,
    get_analysis as get_ats_analysis,
    get_scores_map as get_ats_scores_map,
    get_recruiter_scores_map,
    skill_gap_summary,
    delete_analysis as delete_ats_analysis,
    mark_viewed as mark_ats_viewed,
    count_unviewed as count_ats_unviewed,
    save_resume_template,
    get_resume_template,
    delete_resume_template,
    audit_resume,
    auto_fix_resume,
    get_saved_audit,
    save_master_docx,
    get_master_docx,
    has_master_docx,
    save_tailored_docx,
    get_tailored_docx,
    recruiter_review as run_recruiter_review,
    get_recruiter_review,
    generate_job_prep,
    get_job_prep,
)
try:
    from resume_editor import apply_rewrites, append_bullet
except Exception as e:
    print(f"❌ resume_editor import failed: {e}")
    def apply_rewrites(b, r):
        raise RuntimeError("resume_editor unavailable")
    def append_bullet(b, s, t):
        raise RuntimeError("resume_editor unavailable")
from pdf_import import extract_pdf_text, extract_pdf_pages
try:
    from google_docs_agent import create_resume_doc
except Exception as e:
    print(f"❌ google_docs_agent import failed: {e}")
    def create_resume_doc(*args, **kwargs):
        raise RuntimeError("Google Docs agent unavailable")
try:
    from weather_agent import get_weather, get_weather_brief, get_weather_data
except Exception as e:
    print(f"❌ weather_agent import failed: {e}")
    async def get_weather(call_llm_fn=None):
        return "⚠️ Weather agent not available."
    async def get_weather_brief():
        return "Weather unavailable"
    async def get_weather_data():
        return {}

# Core Credentials
TWILIO_SID = os.getenv("TWILIO_SID")
TWILIO_TOKEN = os.getenv("TWILIO_TOKEN")
FROM_WHATSAPP = "whatsapp:+14155238886"
TO_WHATSAPP = "whatsapp:+919963214141"

# GitHub REST API Credentials
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_REPO = os.getenv("GITHUB_REPO")

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.environ.get("DB_PATH", os.path.join(BASE_DIR, "agent_memory.db"))
STAGED_CODE_FILE = "/tmp/staged_code_update.json"
QUIZ_STATE_FILE = "/tmp/quiz_state.json"

# Scheduler times (24-hour, Asia/Kolkata). Edit here to change all reminders.
SCHEDULE_CONFIG = {
    "digest_hour": 9,
    "reminders": [
        {"hour": 11, "number": 1},
        {"hour": 13, "number": 2},
        {"hour": 15, "number": 3},
        {"hour": 17, "number": 4},
        {"hour": 19, "number": 5},
    ],
    "weekly_report_hour": 9,
}

# Scheduling source.
#   "internal" (default): APScheduler fires the fixed jobs in-process — requires the
#       service to stay awake 24/7, which burns Render's free instance-hours.
#   "external": the fixed jobs are NOT registered in-process. An outside cron
#       (cron-job.org) wakes the sleeping service and triggers each job via the
#       secret-guarded /cron/* endpoints, so the instance can sleep between jobs.
#       User reminders/automations are fired by /cron/reminders-due instead of an
#       in-process DateTrigger. Set SCHEDULER_MODE=external on Render to enable.
SCHEDULER_MODE = os.environ.get("SCHEDULER_MODE", "internal").strip().lower()


# When the OmniRoute gateway is in use it needs a provider-prefixed model id (otherwise
# "openai/gpt-oss-120b" is ambiguous across providers). The digest's direct anthropic_client
# calls use these constants, so prefix them here — _complete_with_fallback maps separately.
OPENROUTER_MODEL = "groq/openai/gpt-oss-120b" if os.environ.get("OMNIROUTE_URL", "").strip() else "openai/gpt-oss-120b"
OPENROUTER_MODEL_FAST = OPENROUTER_MODEL

FREE_MODELS = [
    "openai/gpt-oss-120b",          # GPT OSS — same model as before, now on Groq's LPU hardware
    "llama-3.3-70b-versatile",      # Llama 3.3 70B — reliable backup
    "llama-3.1-8b-instant",         # Llama 3.1 8B — smallest/fastest backup
]

# Gemini (Google AI Studio) as a LAST-RESORT fallback — only when every Groq model above
# fails (e.g. Groq-wide rate limit). AI Studio exposes an OpenAI-compatible endpoint, so the
# same AsyncOpenAI client works. Free to obtain a key at https://aistudio.google.com. This is
# a no-op until GEMINI_API_KEY is set — the chain then simply stays Groq-only.
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash").strip()
GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/openai/"

MEMORY_INTENT_PROMPT = (
    "Classify the user's message into exactly one intent. The message is preceded by the current date/time "
    "(Asia/Kolkata) for resolving relative dates. Respond with STRICT JSON only, no markdown, no commentary, "
    "matching exactly this shape:\n"
    '{"intent": "SAVE_FACT" or "RECALL_FACT" or "LIST_FACTS" or "SET_REMINDER" or "LIST_REMINDERS" or '
    '"COMPOSE_EMAIL" or "READ_INBOX" or "CALENDAR_ACTION" or "JOB_SEARCH" or "APPLICATION_ACTION" or "BILL_ACTION" or "OTHER", '
    '"content": "string" or null, '
    '"reminder": {"text": "string", "kind": "once" or "daily" or "weekly", "run_at": "ISO 8601 datetime" or null, '
    '"hour": 0-23 or null, "minute": 0-59 or null, "day_of_week": "mon"/"tue"/"wed"/"thu"/"fri"/"sat"/"sun" or null} '
    "or null, "
    '"email": {"to": "recipient email address or empty string", "subject": "email subject line", '
    '"body": "full professional email body text", "save_as_draft": true or false} or null, '
    '"calendar": {"action": "list" or "check" or "create" or "delete", "summary": "string" or null, '
    '"start_dt": "ISO 8601 datetime" or null, "end_dt": "ISO 8601 datetime" or null, '
    '"description": "string" or null, "attendees": ["email", ...] or null} or null, '
    '"job": {"role": "string" or null, "location": "string" or null, "remote": true or false or null, '
    '"keywords": ["string", ...] or null, "save_profile": true or false} or null, '
    '"application": {"action": "list" or "update" or "add", "status_filter": "string" or null, '
    '"company": "string" or null, "role": "string" or null, "location": "string" or null, "source": "string" or null, '
    '"new_status": "interested"/"applied"/"interviewing"/"offer"/"accepted"/"rejected" or null} or null, '
    '"bill": {"action": "add" or "list" or "paid" or "delete", "name": "string" or null, '
    '"amount": number or null, "recurrence": "monthly" or "once" or "yearly" or null, '
    '"due_day": 1-31 or null, "due_date": "YYYY-MM-DD" or null} or null}\n'
    "You are given the recent conversation alongside the latest message. If the latest message references "
    'something from it instead of stating it directly (e.g. "send the same email again", "remind me about that '
    'at the same time", "email her the same thing") — resolve the reference using the recent conversation and '
    "fill in the actual recipient/subject/body/time/etc. you find there, rather than leaving fields empty or "
    "falling back to OTHER just because the latest message alone doesn't contain them.\n"
    "Use SAVE_FACT when the user is asking you to remember/note/save a fact about themselves or their plans "
    '(e.g. "remember that my exam is in August", "note that I prefer Python") OR when they plainly state a '
    'personal detail with no explicit save-verb at all, which still needs saving (e.g. "email id would be '
    'madansai97@gmail.com", "my phone number is...", "my email is..."). content = the fact itself, cleaned up '
    'as a standalone statement (e.g. "Madan\'s email address is madansai97@gmail.com"), using whatever literal '
    "value the user gave even if it looks unusual — never correct, guess, or reformat it. reminder = null.\n"
    "Use RECALL_FACT when the user is asking what you remember/know about ONE SPECIFIC topic, including direct "
    'questions about their own stored details (e.g. "do you remember my exam date", "what do you know about '
    'my AWS plans", "what\'s my email id", "what\'s my phone number"). content = the topic/keywords to search '
    "for (e.g. \"email address\"). reminder = null.\n"
    "Use LIST_FACTS when the user wants to see EVERYTHING saved so far, with no specific topic named — e.g. "
    '"what did you remember", "what have you saved so far", "tell me everything you know about me", "how many '
    'things have you remembered", "what did I make you remember", "next one" (asking to continue a list), "tell '
    'me those" (referring back to a list just mentioned). This is the correct choice whenever the message is '
    "about the stored-facts list as a whole rather than asking about one named topic — never invent a topic "
    'string and force it into RECALL_FACT for these (e.g. never use content like "all remembered facts" or '
    '"number of remembered items" — that\'s a sign LIST_FACTS was the right call instead). content = null, '
    "reminder = null.\n"
    "Use SET_REMINDER when the user asks to be reminded/notified about something at a specific time, or on a "
    'recurring schedule (e.g. "remind me to call mom tomorrow at 5pm", "remind me every day at 9am to drink '
    'water"). content = null. Fill reminder: kind="once" with run_at as a full ISO 8601 datetime (resolve relative '
    'phrases like "tomorrow"/"in 2 hours" against the given current date/time) for a single occurrence; '
    'kind="daily" with hour/minute for every-day reminders; kind="weekly" with day_of_week/hour/minute for a '
    "specific weekday. reminder.text = the actual task/subject to be reminded about — e.g. for \"remind me to "
    'call mom tomorrow at 5pm" that\'s "call mom", NOT the whole sentence and NOT meta-words like "reminder" or '
    '"the job". Only use SET_REMINDER if the message actually states what to be reminded about. If it only gives '
    'a time/schedule with no real task (e.g. "set the reminder at 1:28pm", "remind me at 5pm" with nothing else) '
    "— there is nothing to remind about, so classify as OTHER instead so Madan gets asked what the reminder "
    "should be for, instead of creating a reminder with a placeholder/meaningless text.\n"
    "Use LIST_REMINDERS when the user wants to see, view, check, or be shown their current/upcoming reminders "
    '(e.g. "show me my reminders list", "what reminders do I have", "bring up my reminders", "list reminders", '
    '"hey jarvis show off the reminders") — any phrasing asking to see existing reminders, not set a new one. '
    "content = null, reminder = null, email = null.\n"
    "Use COMPOSE_EMAIL when the user wants you to write/draft/compose a brand-new outbound email — any phrasing "
    '(e.g. "draft an email to x@example.com about...", "draft me an email and put it in a draft...", "write an '
    'email to... and send it"). This is NOT for editing/sending/cancelling an email already shown to the user in '
    "this conversation — those are separate explicit commands (SEND, EDIT EMAIL:, CANCEL) and should be OTHER. "
    "Extract the recipient address; write a complete, professional email body based on the key points given (not "
    "just a one-line summary), signed 'Madan'. Set email.save_as_draft = true if the user wants it saved/put in "
    "their Gmail Drafts without sending yet (e.g. \"put it in a draft\", \"just save it\", \"don't send it\"); set "
    "it to false if they want it sent right away (e.g. \"send an email to...\", \"send it now\"). If no recipient "
    'email address is given anywhere in the request, set email.to to an empty string. content = null, reminder = '
    "null.\n"
    "Use READ_INBOX when the user wants to read, check, see, or get a summary of their EXISTING email inbox / "
    'unread mail — any phrasing like "check my email inbox", "check my email", "any new emails", "what\'s in my '
    'inbox", "read my inbox", "do I have any unread mail", "summarize my emails". This is for viewing incoming '
    "mail, NOT for writing one (that's COMPOSE_EMAIL). content = null, email = null, reminder = null.\n"
    "Use CALENDAR_ACTION when the user wants to view, check availability for, create, or cancel a calendar event. "
    "Resolve relative dates/times (e.g. \"tomorrow at 3pm\") against the given current date/time into full ISO "
    "8601 calendar.start_dt/end_dt — default to a 1-hour duration if no end time is stated. calendar.action="
    '"list" for viewing upcoming events (e.g. "what\'s on my calendar", "show my events") — no other calendar '
    'fields needed. calendar.action="check" for availability questions (e.g. "am I free at 3pm tomorrow") — fill '
    'start_dt/end_dt for the window being checked. calendar.action="create" for adding a new event — fill '
    "summary/start_dt/end_dt; fill calendar.attendees as a list of email addresses ONLY if the user explicitly "
    "gives an email address to invite — never invent or guess an email address, omit attendees entirely "
    'otherwise. calendar.action="delete" for cancelling/removing an existing event — fill summary with whatever '
    "title/keyword identifies which event to remove. This is NOT for confirming/cancelling an event already shown "
    "to the user in this conversation — those are separate explicit commands and should be OTHER. content = null, "
    "reminder = null, email = null.\n"
    "Use APPLICATION_ACTION when the user wants to see or update their tracked job APPLICATIONS (not search "
    'for new jobs). IMPORTANT: JARVIS tracks Madan\'s applications on an internal Kanban board / tracker — when '
    'he asks about his "applications", "job portal", "jobs portal", "board", "kanban", "pipeline", "the jobs '
    'thing", or "the app" (as in his job-hunt app), he means THAT internal tracker, which you CAN read — never '
    "treat it as an external site you can't access. application.action=\"list\" to view or COUNT the pipeline "
    '(e.g. "show my applications", "what jobs have I applied to", "my job pipeline", "how many applications do I '
    'have", "how many jobs are in my portal", "how\'s my board looking", "how are my applications doing", '
    '"what\'s in my job portal", "how many did I apply to"); fill application.status_filter only if they ask for a '
    'specific stage (e.g. "which ones am I interviewing for", "how many offers do I have"). '
    'application.action="update" to change a status (e.g. "mark '
    'Cognizant as interviewing", "I got rejected from Infosys", "got an offer from BP") — fill application.company '
    "with the company/role identifier and application.new_status with the target stage. "
    'application.action="add" when the user says they APPLIED to a specific job somewhere and wants it tracked '
    '(e.g. "applied to Data Analyst at Acme on Naukri", "I just applied for a Backend Engineer role at Infosys", '
    '"add Product Manager at Google to my board as applied") — fill application.role with the job title, '
    "application.company with the employer, application.location if stated, application.source with the portal/site "
    '(e.g. "Naukri", "LinkedIn") if stated, and application.new_status with the stage (default "applied" if they just '
    'say they applied). This is NOT the TRACK <n> '
    "command (that is an explicit command handled separately). content = null, reminder = null, email = null, "
    "calendar = null, job = null.\n"
    "Use BILL_ACTION when the user is dealing with BILLS, EMIs, subscriptions, rent, or recurring/one-off "
    'payments & deadlines with money owed. bill.action="add" to track a new bill (e.g. "add electricity ₹1200 '
    'due on the 5th every month", "track my rent 15000 on the 1st", "netflix 649 monthly on the 28th", "domain '
    'renewal 1200 due 2026-08-15") — fill bill.name, bill.amount, bill.recurrence ("monthly" default, "once" for a '
    "one-off deadline, \"yearly\" for annual), bill.due_day (1-31, for monthly) OR bill.due_date (YYYY-MM-DD, for "
    'once/yearly). bill.action="list" to show tracked bills / what\'s due ("show my bills", "what bills are due", '
    '"how much do I owe this month"). bill.action="paid" when they\'ve paid one ("mark rent paid", "paid netflix") '
    "— fill bill.name. bill.action=\"delete\" to stop tracking one — fill bill.name. This is DISTINCT from "
    "SET_REMINDER (a plain time-based nudge with no amount/recurring-bill semantics). content = null, reminder = "
    "null, email = null, calendar = null, job = null, application = null.\n"
    "Use JOB_SEARCH when the user wants to find, search, or be shown job openings/vacancies right now "
    '(e.g. "find me jobs", "any data analyst roles", "search remote jobs in Mumbai", "show me openings today"). '
    "Fill job.role with the role/title if stated (else null → their saved profile is used), job.location with a "
    "city/region, or set job.remote=true if they specifically want remote, job.keywords with any specific skills "
    "mentioned. Set job.save_profile=true ONLY if they explicitly ask to change/update their standing job "
    'preferences (e.g. "update my job search to...", "from now on look for..."), otherwise false. This is NOT for '
    "adding a job to a tracker (that is a separate TRACK command → OTHER). content = null, reminder = null, "
    "email = null, calendar = null.\n"
    "Use OTHER for everything else — general conversation, questions, commands. This explicitly includes general "
    'knowledge/curiosity questions phrased like "tell me about X", "what is X", "explain X", "how does X work" — '
    "these are OTHER even when X sounds like a topic, unless the message is clearly asking to save/recall a "
    "personal fact already established about Madan, or explicitly states a time/schedule to be reminded at. Never "
    "force a general-knowledge question into SAVE_FACT, RECALL_FACT, LIST_FACTS, or SET_REMINDER just because it "
    "contains a noun that could be mistaken for a fact or task. content = null, reminder = null, "
    "email = null, calendar = null."
    # "Show, don't tell" — concrete few-shot examples of the trickiest routing calls, from prompts.py.
    + INTENT_FEWSHOT
)

def get_llm_client() -> AsyncOpenAI:
    omni_url = os.environ.get("OMNIROUTE_URL", "").strip()
    if omni_url:
        print(f"🔌 OmniRoute local gateway enabled for Groq ({omni_url})")
        return AsyncOpenAI(
            base_url=omni_url,
            api_key="omniroute",
        )
    key = os.environ.get("GROQ_API_KEY", "")
    if not key:
        print("⚠️ WARNING: GROQ_API_KEY not set!")
    return AsyncOpenAI(
        base_url="https://api.groq.com/openai/v1",
        api_key=key or "missing",
    )

anthropic_client = get_llm_client()  # kept same name so all call sites work unchanged


def get_gemini_client() -> AsyncOpenAI | None:
    """Google AI Studio's OpenAI-compatible client, or None if no key is configured."""
    omni_url = os.environ.get("OMNIROUTE_URL", "").strip()
    if omni_url:
        print(f"🔌 OmniRoute local gateway enabled for Gemini ({omni_url})")
        return AsyncOpenAI(
            base_url=omni_url,
            api_key="omniroute",
        )
    if not GEMINI_API_KEY:
        return None
    return AsyncOpenAI(base_url=GEMINI_BASE_URL, api_key=GEMINI_API_KEY)


gemini_client = get_gemini_client()
if gemini_client is not None:
    print(f"✅ Gemini fallback enabled ({GEMINI_MODEL}).")


def _model_chain() -> list:
    """(client, model) pairs to try in order: all Groq free models first, then Gemini as a
    last resort (only if a key is set). Keeps Groq as the fast primary and Gemini as the
    rate-limit safety net."""
    chain = [(anthropic_client, m) for m in FREE_MODELS]
    if gemini_client is not None:
        chain.append((gemini_client, GEMINI_MODEL))
    return chain


_llm_log_tasks: set = set()


def _log_llm_call(provider: str, model: str, ok: bool = True):
    """Fire-and-forget: record which provider/model answered, for the Insights dashboard.
    Never blocks or raises into the LLM hot path. Keeps a strong task ref so the write
    isn't garbage-collected before it runs."""
    async def _w():
        try:
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO llm_calls (provider, model, ok) VALUES (?,?,?)",
                    (provider, model, 1 if ok else 0))
                await db.commit()
        except Exception:
            pass
    try:
        task = asyncio.get_running_loop().create_task(_w())
        _llm_log_tasks.add(task)
        task.add_done_callback(_llm_log_tasks.discard)
    except RuntimeError:
        pass


async def _try_one_model(client, model: str, messages: list, max_tokens: int,
                         temperature: float) -> str | None:
    """Send a single completion. Returns the answer string, or None on empty content.
    Raises on transport/API error (so the caller can record a failure and fail over)."""
    # If calling OmniRoute, map model IDs to prefixed names to avoid ambiguity.
    omni_url = os.environ.get("OMNIROUTE_URL", "").strip()
    if omni_url:
        if model == "openai/gpt-oss-120b":
            model = "groq/openai/gpt-oss-120b"
        elif model == "llama-3.3-70b-versatile":
            model = "groq/llama-3.3-70b-versatile"
        elif model == "llama-3.1-8b-instant":
            model = "groq/llama-3.1-8b-instant"
        elif model == "gemini-2.5-flash":
            model = "openrouter/google/gemini-2.5-flash"

    extra_body = {"reasoning_effort": "low"} if "gpt-oss" in model else {}
    kwargs = {
        "model": model,
        "max_tokens": max_tokens,
        "extra_body": extra_body,
        "messages": messages,
    }
    if temperature is not None:
        kwargs["temperature"] = temperature
    response = await client.chat.completions.create(**kwargs)
    content = response.choices[0].message.content
    if content and content.strip():
        return content
    return None


async def _complete_with_fallback(messages: list, max_tokens: int, temperature: float = None) -> str:
    """Run a chat completion across the model chain, returning the first non-empty answer.

    The chain is wrapped by GATEWAY (llm_gateway.py): a per-provider circuit breaker
    skips a backend that's been failing (so we fail over instantly instead of eating its
    latency every call), and a sliding-window rate limiter keeps us under free-tier RPM.
    Both are advisory — if the gateway would skip every provider, we force-try the full
    chain anyway (second pass) so an over-eager breaker can never take the whole app down.

    GPT-OSS models on Groq spend tokens on hidden reasoning before the visible answer —
    with a tight max_tokens budget this can consume the whole budget and return empty
    content (finish_reason="length", zero actual answer). reasoning_effort="low" fixes
    this, but only gpt-oss models accept that parameter — other models (Llama, Gemini)
    hard-error on it, so it's only added when the model name matches (see _try_one_model).
    """
    def _provider_of(model: str) -> str:
        return "gemini" if model == GEMINI_MODEL else "groq"

    last_err = None
    attempted_any = False
    chain = _model_chain()

    # Pass 1 — honour the gateway (skip open circuits / rate-limited providers).
    for client, model in chain:
        provider = _provider_of(model)
        skip, reason = GATEWAY.should_skip(provider)
        if skip:
            print(f"⏭️  Skipping {provider}/{model} — gateway: {reason}")
            continue
        attempted_any = True
        GATEWAY.record_attempt(provider)
        try:
            content = await _try_one_model(client, model, messages, max_tokens, temperature)
            if content is not None:
                GATEWAY.record_success(provider)
                _log_llm_call(provider, model, True)
                return content
            print(f"⚠️ Model {model} returned empty content. Trying next...")
        except Exception as e:
            last_err = e
            GATEWAY.record_failure(provider)
            print(f"⚠️ Model {model} failed: {e}. Trying next...")
            continue

    # Pass 2 — the gateway skipped every provider (all circuits open / rate-limited).
    # Fail OPEN: force-try the whole chain so the app never goes dark on the gateway.
    if not attempted_any:
        print("⚠️ Gateway skipped all providers — force-trying the full chain (fail-open).")
        for client, model in chain:
            provider = _provider_of(model)
            GATEWAY.record_attempt(provider)
            try:
                content = await _try_one_model(client, model, messages, max_tokens, temperature)
                if content is not None:
                    GATEWAY.record_success(provider)
                    _log_llm_call(provider, model, True)
                    return content
            except Exception as e:
                last_err = e
                GATEWAY.record_failure(provider)
                continue

    raise Exception(f"All models failed (last error: {last_err})")


async def call_llm(system_prompt: str, user_prompt: str, max_tokens: int = 1000, temperature: float = None) -> str:
    """Call LLM with automatic fallback through the Groq free models, then Gemini."""
    return await _complete_with_fallback(
        [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
        max_tokens,
        temperature=temperature
    )


def init_db_tables():
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_profile (key TEXT PRIMARY KEY, value TEXT)''')
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('skill_level', 'Foundational')")
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('study_streak', '0')")
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('last_study_date', '')")
    cursor.execute("INSERT OR IGNORE INTO user_profile (key, value) VALUES ('difficulty_preference', 'just_right')")

    cursor.execute('''CREATE TABLE IF NOT EXISTS sent_history (
        concept TEXT PRIMARY KEY, summary TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS chat_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT, content TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS knowledge_store (
        url TEXT PRIMARY KEY, title TEXT, content TEXT,
        saved_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    # Migration: rename old 'timestamp' column to 'saved_at' if it exists
    try:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(knowledge_store)").fetchall()]
        if 'timestamp' in cols and 'saved_at' not in cols:
            cursor.execute("ALTER TABLE knowledge_store RENAME COLUMN timestamp TO saved_at")
    except Exception:
        pass  # SQLite < 3.25 doesn't support RENAME COLUMN — handled below via recreate

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT UNIQUE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS company_intelligence_dossiers (
        job_ref TEXT PRIMARY KEY, dossier_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS voice_interview_scores (
        id INTEGER PRIMARY KEY AUTOINCREMENT, job_ref TEXT, question TEXT, score INT, feedback_json TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    cursor.execute('''CREATE TABLE IF NOT EXISTS career_portfolio_vault (
        id INTEGER PRIMARY KEY AUTOINCREMENT, title TEXT, category TEXT, content TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS quiz_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, concept TEXT, skill_level TEXT,
        total_questions INTEGER DEFAULT 10,
        score INTEGER DEFAULT 0, completed INTEGER DEFAULT 0,
        current_question INTEGER DEFAULT 0,
        assertion_quality_score REAL DEFAULT 0,
        mutation_passed INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS quiz_answers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id INTEGER, question_number INTEGER,
        question_text TEXT, correct_answer TEXT,
        user_answer TEXT, difficulty TEXT,
        is_correct INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    # Weekly project table — project name + 7 subtasks all tied to week's concept
    cursor.execute('''CREATE TABLE IF NOT EXISTS weekly_project (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        week_start TEXT,
        project_title TEXT,
        concept TEXT,
        day_number INTEGER,
        subtask_title TEXT,
        subtask_description TEXT,
        status TEXT DEFAULT 'pending',
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS daily_checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT UNIQUE,
        concept TEXT,
        reminder_count INTEGER DEFAULT 0,
        learning_status TEXT DEFAULT 'in_progress',
        quiz_triggered INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS review_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        concept TEXT,
        difficulty TEXT,
        reason TEXT,
        due_date TEXT,
        completed INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS performance_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, concept TEXT,
        quiz_score INTEGER, max_score INTEGER DEFAULT 10,
        skill_level TEXT, weak_areas TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS assertion_quality_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT, concept TEXT,
        assertion_text TEXT,
        quality_score REAL DEFAULT 0,
        mutation_survived INTEGER DEFAULT 0,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS job_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_name TEXT,
        status TEXT,
        message TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    # Dev-tool usage log for the Insights tab — Claude Code / Antigravity sessions
    # (tokens/cost/duration), fed manually from the UI or pushed by a local script.
    cursor.execute('''CREATE TABLE IF NOT EXISTS dev_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool TEXT,
        day TEXT,
        tokens INTEGER DEFAULT 0,
        cost REAL DEFAULT 0,
        duration_min REAL DEFAULT 0,
        note TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    # LLM call log — which provider/model actually answered (Groq primary vs Gemini fallback),
    # for the Insights engine dashboard. Written fire-and-forget so it never blocks a response.
    cursor.execute('''CREATE TABLE IF NOT EXISTS llm_calls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT,
        model TEXT,
        ok INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS user_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS digest_cache (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        content TEXT,
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        sent INTEGER DEFAULT 0)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS local_command_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        command_type TEXT,
        payload TEXT,
        status TEXT DEFAULT 'pending',
        result TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        completed_at DATETIME)''')
    # Migration: source/cc_task_id let /local-queue/result deliver claude_code_propose
    # and claude_code_execute results itself once the bridge posts them, instead of
    # relying on an in-memory polling task that dies if the server process restarts.
    try:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(local_command_queue)").fetchall()]
        if 'source' not in cols:
            cursor.execute("ALTER TABLE local_command_queue ADD COLUMN source TEXT")
        if 'cc_task_id' not in cols:
            cursor.execute("ALTER TABLE local_command_queue ADD COLUMN cc_task_id INTEGER")
        if 'cc_session_row_id' not in cols:
            cursor.execute("ALTER TABLE local_command_queue ADD COLUMN cc_session_row_id INTEGER")
    except Exception:
        pass

    # Dedup log for the external-cron poll: records that a recurring (daily/weekly)
    # reminder/automation already fired on a given IST date, so an extra wake-up ping
    # in the same window can't double-send. 'once' items dedup via their status column.
    cursor.execute('''CREATE TABLE IF NOT EXISTS cron_fire_log (
        scope TEXT,
        item_id INTEGER,
        fired_on TEXT,
        PRIMARY KEY (scope, item_id, fired_on))''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS pending_claude_code_task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_text TEXT,
        proposed_plan TEXT,
        status TEXT DEFAULT 'proposed',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    cursor.execute('''CREATE TABLE IF NOT EXISTS claude_code_live_session (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        cc_session_id TEXT,
        status TEXT DEFAULT 'active',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    # Every outbound alert JARVIS produces is persisted here (the in-app inbox).
    # This is what used to go only to WhatsApp; now the web UI owns the history.
    cursor.execute('''CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        body TEXT NOT NULL,
        category TEXT DEFAULT 'general',
        read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    # Browser Web Push subscriptions (one row per device/browser that opted in).
    cursor.execute('''CREATE TABLE IF NOT EXISTS push_subscriptions (
        endpoint TEXT PRIMARY KEY,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    # Migration: add severity, traceback, attempt_number columns to job_logs if they don't exist
    try:
        cols = [row[1] for row in cursor.execute("PRAGMA table_info(job_logs)").fetchall()]
        if 'severity' not in cols:
            cursor.execute("ALTER TABLE job_logs ADD COLUMN severity TEXT DEFAULT 'info'")
        if 'traceback' not in cols:
            cursor.execute("ALTER TABLE job_logs ADD COLUMN traceback TEXT DEFAULT ''")
        if 'attempt_number' not in cols:
            cursor.execute("ALTER TABLE job_logs ADD COLUMN attempt_number INTEGER DEFAULT 1")
    except Exception as e:
        print(f"⚠️ job_logs migration error: {e}")

    # Influencer watcher tables
    cursor.execute('''CREATE TABLE IF NOT EXISTS watched_influencers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        handle TEXT NOT NULL,
        platform TEXT NOT NULL,
        name TEXT,
        yt_content TEXT DEFAULT 'all',
        domain TEXT DEFAULT '',
        added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(handle, platform))''')

    # Migrations for pre-existing tables (yt_content = YouTube type filter; domain = topic grouping).
    for _col, _ddl in (
        ("yt_content", "ALTER TABLE watched_influencers ADD COLUMN yt_content TEXT DEFAULT 'all'"),
        ("domain", "ALTER TABLE watched_influencers ADD COLUMN domain TEXT DEFAULT ''"),
    ):
        try:
            cursor.execute(_ddl)
        except Exception:
            pass

    cursor.execute('''CREATE TABLE IF NOT EXISTS seen_influencer_posts (
        post_id TEXT PRIMARY KEY,
        platform TEXT NOT NULL,
        handle TEXT NOT NULL,
        discovered_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')

    # Persistent feed: doubles as the dedup ledger AND the console feed history (relevance-ranked).
    cursor.execute('''CREATE TABLE IF NOT EXISTS influencer_posts (
        post_id TEXT PRIMARY KEY,
        platform TEXT,
        handle TEXT,
        name TEXT,
        title TEXT,
        summary TEXT,
        url TEXT,
        relevant INTEGER DEFAULT 1,
        relevance_note TEXT,
        is_read INTEGER DEFAULT 0,
        published_at TEXT,
        domain TEXT DEFAULT '',
        contact_id INTEGER,
        seen_at DATETIME DEFAULT CURRENT_TIMESTAMP)''')
    for _ddl in ("ALTER TABLE influencer_posts ADD COLUMN domain TEXT DEFAULT ''",
                 "ALTER TABLE influencer_posts ADD COLUMN contact_id INTEGER",
                 "ALTER TABLE influencer_posts ADD COLUMN grounded_context TEXT"):
        try:
            cursor.execute(_ddl)
        except Exception:
            pass

    conn.commit()
    conn.close()
    print("✅ State Engine: All database tables verified and ready.")


def init_daily_web_tables():
    """Web-first Daily AI Update — one structured row per day, read in the console. WhatsApp is
    only ever sent on explicit trigger (sent_whatsapp flag), never automatically."""
    conn = aiosqlite.connect_sync(DB_PATH, check_same_thread=False)
    cur = conn.cursor()
    cur.execute('''CREATE TABLE IF NOT EXISTS daily_web_digest (
        date TEXT PRIMARY KEY,
        news_json TEXT,
        concept TEXT,
        pedagogical_focus TEXT,
        project_json TEXT,
        digest_text TEXT,
        reference_code TEXT,
        difficulty TEXT,
        watch_json TEXT,
        sent_whatsapp INTEGER DEFAULT 0,
        created_at TEXT
    )''')
    # Migration: "Watch these" — creator videos/posts tied to the day's concept (folds the
    # Influencer Watcher into the daily lesson). Turso-safe ALTER in try/except.
    try:
        cur.execute("ALTER TABLE daily_web_digest ADD COLUMN watch_json TEXT")
    except Exception:
        pass
    # Active-recall: quiz + grades + Feynman "explain it back", one row per day.
    cur.execute('''CREATE TABLE IF NOT EXISTS study_recall (
        date TEXT PRIMARY KEY,
        concept TEXT,
        quiz_json TEXT,
        grade_json TEXT,
        feynman_json TEXT,
        created_at TEXT
    )''')
    # Spaced repetition — each learned concept resurfaces at 1d/3d/1wk/1mo.
    cur.execute('''CREATE TABLE IF NOT EXISTS srs_reviews (
        concept TEXT PRIMARY KEY,
        rep INTEGER DEFAULT 0,
        next_due TEXT,
        last_reviewed TEXT,
        created_at TEXT
    )''')
    # Deep-dive explainer — a full, structured explanation of the day's concept (cached per day).
    cur.execute('''CREATE TABLE IF NOT EXISTS study_lessons (
        date TEXT PRIMARY KEY,
        concept TEXT,
        data TEXT,
        created_at TEXT
    )''')
    # Go-deeper follow-up chat — a persistent, multi-turn thread per day's concept.
    cur.execute('''CREATE TABLE IF NOT EXISTS study_followups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        concept TEXT,
        role TEXT,
        content TEXT,
        created_at TEXT
    )''')
    cur.execute('CREATE INDEX IF NOT EXISTS idx_study_followups_date ON study_followups(date)')
    conn.commit()
    conn.close()
    print("✅ Daily web digest table ready.")

from project_believer import router as believer_router, init_believer_db

init_db_tables()
init_email_tables()
init_reminder_tables()
init_calendar_tables()
init_automation_tables()
init_pattern_tables()
init_job_scout_tables()
init_job_apply_tables()
init_application_tracker_tables()
init_application_email_tracker_tables()
init_bill_watcher_tables()
init_resume_ats_tables()
init_workspace_notes_tables()
init_networking_crm_tables()
init_profile_freshness_tables()
init_followup_tables()
init_trend_lab_tables()
init_daily_web_tables()
from company_watch_agent import init_company_watch_tables
init_company_watch_tables()
from people_watch_agent import init_people_watch_tables
init_people_watch_tables()

# Initialize Project Believer (Secret Encrypted Diary)
try:
    asyncio.run(init_believer_db())
    print("✅ Project Believer (Secret Encrypted Diary) tables initialized.")
except Exception as e:
    print(f"⚠️ Project Believer init warning: {e}")

from pdf_rag_agent import (
    init_pdf_rag_tables, ingest_pdf as pdf_rag_ingest, list_docs as pdf_rag_list_docs,
    delete_doc as pdf_rag_delete, answer_question as pdf_rag_ask, assess_document as pdf_rag_assess,
    document_summary as pdf_rag_summary, get_doc_chunks as pdf_rag_get_chunks,
)
init_pdf_rag_tables()


# ==========================================
# USER SETTINGS HELPERS (sync, single-user)
# ==========================================
def _get_db_conn():
    conn = aiosqlite.connect_sync(DB_PATH)
    conn.row_factory = aiosqlite.Row
    return conn

def get_setting(key: str, default=None):
    """Get a value from user_settings table."""
    try:
        conn = _get_db_conn()
        row = conn.execute("SELECT value FROM user_settings WHERE key = ?", (key,)).fetchone()
        conn.close()
        return row["value"] if row else default
    except Exception as e:
        print(f"⚠️ get_setting error: {e}")
        return default

def save_setting(key: str, value: str):
    """Save or update a value in user_settings table."""
    try:
        conn = _get_db_conn()
        conn.execute(
            "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
            (key, value)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ save_setting error: {e}")


# ==========================================
# AUTOMATIONS DISPATCH — automations.py owns persistence/scheduling only;
# this maps each action_type to the actual business logic that runs it.
# ==========================================
async def dispatch_automation(action_type: str, payload: dict):
    if action_type == "send_message":
        send_whatsapp_chunked(payload.get("message", ""))
    elif action_type == "calendar_digest":
        events = await list_upcoming_events(max_results=payload.get("max_results", 5))
        if not events:
            send_whatsapp_chunked("📅 *Today's calendar:* nothing on the books.")
        else:
            lines = [f"- {e['summary']} — {e['start']}" for e in events]
            send_whatsapp_chunked("📅 *Upcoming on your calendar:*\n\n" + "\n".join(lines))
    else:
        print(f"⚠️ [dispatch_automation] Unknown action_type: {action_type}")


async def _auto_followups_job():
    """Scheduler/cron entry: draft follow-ups for stale applications (never sends)."""
    try:
        prof = await get_job_profile()
    except Exception:
        prof = None
    return await run_auto_followups(call_llm, profile=prof, notify_fn=_store_notification)


# ==========================================
# LIFESPAN & SCHEDULER
# ==========================================
CONNECTED_GMAIL_ADDRESS = None  # populated once at startup by lifespan() below

@asynccontextmanager
async def lifespan(app: FastAPI):
    _tune_malloc_arenas()
    missing_env = []
    if not TWILIO_SID: missing_env.append("TWILIO_SID")
    if not TWILIO_TOKEN: missing_env.append("TWILIO_TOKEN")
    if not os.environ.get("GROQ_API_KEY"): missing_env.append("GROQ_API_KEY")

    if missing_env:
        print(f"⚠️ STARTUP WARNING: Missing: {', '.join(missing_env)}")
    else:
        print("✅ Environment Variables Verified.")

    # --- Startup self-check: surface config/DB problems loudly at boot ---
    db_ok = _db_status() == "ok"
    backend = ("local SQLite (SAFE_MODE)" if SAFE_MODE
               else "Turso" if os.environ.get("TURSO_DATABASE_URL") else "local SQLite")
    print(
        f"🩺 Self-check: DB={'ok' if db_ok else 'DOWN'} via {backend} | "
        f"scheduler={SCHEDULER_MODE} | safe_mode={'ON' if SAFE_MODE else 'off'} | "
        f"rss={_rss_mb():.0f}MB"
    )
    if not db_ok:
        print("🚨 STARTUP: database unreachable — reminders, logs and settings will fail.")
    if missing_env and not SAFE_MODE:
        print("🚨 STARTUP: missing prod env vars above — WhatsApp/LLM features may not work.")

    global CONNECTED_GMAIL_ADDRESS
    CONNECTED_GMAIL_ADDRESS = get_connected_gmail_address()
    if CONNECTED_GMAIL_ADDRESS:
        print(f"✅ Gmail integration confirmed: {CONNECTED_GMAIL_ADDRESS}")
    else:
        print("⚠️ Could not confirm which Gmail account is connected.")

    scheduler = AsyncIOScheduler(timezone="Asia/Kolkata")
    app.state.scheduler = scheduler

    if SCHEDULER_MODE == "external":
        # Fixed jobs and reminder/automation DateTriggers are NOT registered — an outside
        # cron drives them via /cron/* so the instance can sleep. The scheduler still runs
        # for any in-process DateTrigger set while awake (e.g. same-day quiz auto-trigger).
        scheduler.start()
        print("⏰ Scheduler: EXTERNAL mode — fixed jobs driven by /cron/* endpoints; "
              "reminders fired via /cron/reminders-due. In-process cron jobs not registered.")
    else:
        # Morning digest is now WEB-FIRST — generates + stores + notifies in the console; it
        # never auto-sends WhatsApp (that's an explicit button in the Daily tab).
        scheduler.add_job(generate_daily_web_digest, "cron", hour=SCHEDULE_CONFIG["digest_hour"], minute=0)
        for r in SCHEDULE_CONFIG["reminders"]:
            scheduler.add_job(send_checkin_reminder, "cron", hour=r["hour"], minute=0, kwargs={"reminder_number": r["number"]})
        scheduler.add_job(send_weekly_report, "cron", day_of_week="sun", hour=SCHEDULE_CONFIG["weekly_report_hour"], minute=0)
        scheduler.add_job(check_inbox_and_notify, "interval", hours=1, args=[call_llm, send_whatsapp_chunked])
        # Application email → board sync, twice daily (morning catch-up + evening sweep).
        scheduler.add_job(scan_application_emails, "cron", hour=8, minute=30, args=[call_llm, _store_notification])
        scheduler.add_job(scan_application_emails, "cron", hour=21, minute=0, args=[call_llm, _store_notification])
        # Daily bill/deadline check (morning) — warns about anything due within its notify window.
        scheduler.add_job(check_bills_and_notify, "cron", hour=8, minute=0, args=[_store_notification])
        # Daily auto-draft of follow-ups for stale applications (never sends — just readies them).
        scheduler.add_job(_auto_followups_job, "cron", hour=9, minute=0)
        scheduler.start()
        restored = await register_all_active_reminders(scheduler, send_whatsapp_chunked)
        automations_restored = await register_all_active_automations(scheduler, dispatch_automation)
        reminder_times = ", ".join([f"{r['hour']}:00" for r in SCHEDULE_CONFIG["reminders"]])
        print(f"⏰ Scheduler: INTERNAL mode — Digest {SCHEDULE_CONFIG['digest_hour']}:00 | Check-ins {reminder_times} | Report Sunday {SCHEDULE_CONFIG['weekly_report_hour']}:00 | Restored {restored} reminder(s), {automations_restored} automation(s)")

    yield
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)
app.include_router(believer_router)


# ── PIN lock for the JARVIS console ──────────────────────────────────────────
# Fail-open: if JARVIS_PIN isn't set, the gate is disabled (current behavior), so
# this deploys without ever locking Madan out. Set JARVIS_PIN + SESSION_SECRET on
# Render to activate. Token is stateless (HMAC), short-lived, and the frontend
# holds it in memory only — so a refresh always re-prompts ("lock every visit").
import hmac as _hmac
import hashlib as _hashlib

JARVIS_PIN = os.environ.get("JARVIS_PIN", "").strip()
# Optional recruiter/guest demo PIN. When set (and a real PIN is configured), logging in
# with it returns an EMPTY, non-privileged token — so the demo session can never read or
# mutate Madan's real data (protected endpoints 401 on it). The frontend recognises the
# demo session and renders the console from bundled sample fixtures instead. This makes the
# console shareable as a live demo without exposing anything personal.
JARVIS_DEMO_PIN = os.environ.get("JARVIS_DEMO_PIN", "").strip()
SESSION_SECRET = os.environ.get("SESSION_SECRET", "").strip() or f"insecure-dev-secret-{JARVIS_PIN}"
AUTH_REQUIRED = bool(JARVIS_PIN)
# Demo is only meaningful when the console is actually locked AND the demo PIN differs from
# the real one (never let the demo PIN double as a backdoor to real data).
DEMO_AVAILABLE = bool(JARVIS_DEMO_PIN) and AUTH_REQUIRED and JARVIS_DEMO_PIN != JARVIS_PIN
_TOKEN_TTL = 12 * 3600  # seconds
# Endpoints carrying personal data/actions — gated when a PIN is configured.
_PROTECTED_PREFIXES = (
    "/api/", "/chat-message", "/chat-history", "/applications",
    "/resume", "/ats", "/export", "/web-terminal",
)
_login_guard = {"fails": 0, "locked_until": 0.0}


def _make_token() -> str:
    exp = str(int(time.time()) + _TOKEN_TTL)
    sig = _hmac.new(SESSION_SECRET.encode(), exp.encode(), _hashlib.sha256).hexdigest()
    return base64.urlsafe_b64encode(f"{exp}.{sig}".encode()).decode()


def _verify_token(token: str) -> bool:
    try:
        raw = base64.urlsafe_b64decode(token.encode()).decode()
        exp, sig = raw.rsplit(".", 1)
        expected = _hmac.new(SESSION_SECRET.encode(), exp.encode(), _hashlib.sha256).hexdigest()
        return _hmac.compare_digest(sig, expected) and int(exp) > time.time()
    except Exception:
        return False


@app.middleware("http")
async def _auth_gate(request: Request, call_next):
    if AUTH_REQUIRED:
        path = request.url.path
        if any(path.startswith(p) for p in _PROTECTED_PREFIXES):
            token = request.headers.get("X-Jarvis-Token") or request.query_params.get("token") or ""
            if not _verify_token(token):
                return JSONResponse({"error": "unauthorized"}, status_code=401)
    return await call_next(request)


@app.get("/auth/status")
async def auth_status():
    return JSONResponse({"required": AUTH_REQUIRED, "demo_available": DEMO_AVAILABLE})


@app.post("/auth/login")
async def auth_login(request: Request):
    if not AUTH_REQUIRED:
        return JSONResponse({"ok": True, "token": ""})
    if time.time() < _login_guard["locked_until"]:
        return JSONResponse(
            {"ok": False, "error": "Too many attempts — wait a minute."}, status_code=429)
    try:
        body = await request.json()
    except Exception:
        body = {}
    pin = str(body.get("pin", ""))
    # "Explore the demo" button → keyless demo login (no PIN needed, and typing the demo
    # PIN works too). Either way the token is EMPTY and authorises nothing: protected
    # endpoints still 401, and the frontend serves sample fixtures for the demo session.
    if DEMO_AVAILABLE and (body.get("demo") is True or (pin and _hmac.compare_digest(pin, JARVIS_DEMO_PIN))):
        _login_guard["fails"] = 0
        return JSONResponse({"ok": True, "token": "", "demo": True})
    await asyncio.sleep(0.4)  # throttle brute force
    if pin and _hmac.compare_digest(pin, JARVIS_PIN):
        _login_guard["fails"] = 0
        return JSONResponse({"ok": True, "token": _make_token()})
    _login_guard["fails"] += 1
    if _login_guard["fails"] >= 5:
        _login_guard["locked_until"] = time.time() + 60
        _login_guard["fails"] = 0
    return JSONResponse({"ok": False, "error": "Incorrect PIN."}, status_code=401)


# New React (Vite) console UI — served as pre-built static files under /console.
# Guarded so a fresh clone without a build doesn't crash startup; run `npm run build`
# in jarvis-system-core/ to (re)generate dist. The old /chat UI stays untouched.
_CONSOLE_DIST = os.path.join(BASE_DIR, "jarvis-system-core", "dist")
if os.path.isdir(_CONSOLE_DIST):
    from fastapi.staticfiles import StaticFiles
    app.mount("/console", StaticFiles(directory=_CONSOLE_DIST, html=True), name="console")
    print("✅ Console UI mounted at /console")
else:
    print("ℹ️ Console UI dist not found — /console disabled until jarvis-system-core is built.")


# ── Pyodide same-origin proxy ────────────────────────────────────────────────
# The Data Analyst runs pandas IN THE BROWSER via Pyodide. Loading it straight from the public
# jsdelivr CDN is unreliable on some networks — notably several Indian ISPs throttle/block
# jsdelivr, so the ~20MB runtime download stalls and the screen hangs on "Loading Python runtime".
# Render's server CAN reach jsdelivr, so we proxy the runtime through the engine: the browser only
# ever talks to OUR OWN origin (which it already reached to load the app). The files are versioned
# and immutable, so we cache them on the instance's disk and tell the browser to cache them
# forever — each visitor downloads the runtime at most once.
import tempfile as _tempfile
PYODIDE_VERSION = "0.26.4"
_PYODIDE_BASE = f"https://cdn.jsdelivr.net/pyodide/v{PYODIDE_VERSION}/full/"
_PYODIDE_CACHE_DIR = os.path.join(_tempfile.gettempdir(), "jarvis_pyodide")
_PYODIDE_CTYPES = {
    ".js": "text/javascript", ".mjs": "text/javascript", ".wasm": "application/wasm",
    ".json": "application/json", ".zip": "application/zip", ".whl": "application/octet-stream",
    ".data": "application/octet-stream", ".ts": "text/plain",
}


@app.get("/pyodide/{path:path}")
async def pyodide_proxy(path: str):
    """Same-origin passthrough to the versioned Pyodide CDN, disk-cached per instance."""
    if not path or ".." in path or path.startswith("/"):
        return JSONResponse({"error": "bad path"}, status_code=400)
    ctype = _PYODIDE_CTYPES.get(os.path.splitext(path)[1].lower(), "application/octet-stream")
    headers = {"Cache-Control": "public, max-age=31536000, immutable"}
    try:
        os.makedirs(_PYODIDE_CACHE_DIR, exist_ok=True)
        local = os.path.join(_PYODIDE_CACHE_DIR, path.replace("/", "__"))
    except Exception:
        local = None
    if local and os.path.exists(local):
        return FileResponse(local, media_type=ctype, headers=headers)
    try:
        async with httpx.AsyncClient(timeout=60.0, follow_redirects=True) as client:
            r = await client.get(_PYODIDE_BASE + path)
    except Exception as e:
        return JSONResponse({"error": f"upstream fetch failed: {e}"}, status_code=502)
    if r.status_code != 200:
        return Response(status_code=r.status_code)
    data = r.content
    if local:
        try:
            with open(local, "wb") as f:
                f.write(data)
        except Exception:
            pass
    return Response(content=data, media_type=ctype, headers=headers)


APP_START_TIME = time.time()


def _rss_mb() -> float:
    """Current resident set size in MB. Stdlib only — reads /proc on Linux (Render),
    falls back to resource.getrusage elsewhere. Returns -1.0 if it can't be read."""
    try:
        # Linux (Render): /proc/self/statm field 2 = resident pages
        with open("/proc/self/statm") as f:
            resident_pages = int(f.read().split()[1])
        return resident_pages * os.sysconf("SC_PAGE_SIZE") / (1024 * 1024)
    except Exception:
        try:
            import resource, sys
            rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            # macOS reports bytes; Linux/BSD report kilobytes
            return rss / (1024 * 1024) if sys.platform == "darwin" else rss / 1024
        except Exception:
            return -1.0


def _mem_probe(label: str):
    """Print current RSS with a label so spikes are greppable in Render logs."""
    print(f"🧠 MEM[{label}] rss={_rss_mb():.1f}MB")


def _tune_malloc_arenas():
    """glibc (Render/Linux) only: cap malloc arenas to 2. Blocking work runs in threads
    (run_in_executor), and glibc spawns one memory arena per thread (up to 8×cores), each
    hoarding freed memory — that ratcheting was OOMing the service. Equivalent to the
    MALLOC_ARENA_MAX=2 env var, but ships with the code. No-op off glibc (e.g. macOS dev)."""
    try:
        import ctypes
        M_ARENA_MAX = -8  # from glibc malloc.h
        if ctypes.CDLL("libc.so.6").mallopt(M_ARENA_MAX, 2) == 1:
            print("✅ malloc arenas capped at 2 (MALLOC_ARENA_MAX equivalent).")
    except Exception:
        pass  # not glibc — nothing to tune


def _malloc_trim():
    """Hand freed heap memory back to the OS after a large transient (PDF parse, digest).
    glibc only; no-op elsewhere. Without this, freed memory inflates RSS until OOM."""
    try:
        import ctypes
        ctypes.CDLL("libc.so.6").malloc_trim(0)
        _mem_probe("after-trim")
    except Exception:
        pass


@app.get("/health/mem")
async def health_mem():
    """Current process RSS — hit this anytime to watch memory live."""
    return {"rss_mb": round(_rss_mb(), 1)}


EMAIL_ADDRESS_RE = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')


def _is_valid_email(addr: str) -> bool:
    """Catches obviously-malformed recipients (a bare name, missing domain, etc.) before they
    ever reach Gmail's API, which hard-rejects them with an opaque 'Invalid To header' error."""
    return bool(EMAIL_ADDRESS_RE.match((addr or "").strip()))


def _split_message(text: str, limit: int = 1500) -> list[str]:
    """Split a long string into ≤limit-char chunks at sentence boundaries."""
    if len(text) <= limit:
        return [text]
    parts = []
    remaining = text
    while len(remaining) > limit:
        cut = remaining.rfind('. ', 0, limit)
        if cut == -1:
            cut = remaining.rfind('\n', 0, limit)
        if cut == -1:
            cut = limit
        else:
            cut += 1  # include the period
        parts.append(remaining[:cut].strip())
        remaining = remaining[cut:].strip()
    if remaining:
        parts.append(remaining)
    return parts


# ── Web Push (VAPID) ─────────────────────────────────────────────────────────
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "").strip()
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "").replace("\\n", "\n").strip()
VAPID_SUB = os.environ.get("VAPID_SUB", "mailto:madansai97@gmail.com").strip()
_PUSH_ENABLED = bool(VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY)

try:
    from pywebpush import webpush, WebPushException
    from py_vapid import Vapid01
    _VAPID_OBJ = Vapid01.from_pem(VAPID_PRIVATE_KEY.encode()) if _PUSH_ENABLED else None
    if _PUSH_ENABLED:
        print("✅ Web Push enabled (VAPID loaded).")
    else:
        print("ℹ️ Web Push disabled — VAPID keys not set.")
except Exception as e:
    print(f"⚠️ Web Push unavailable: {e}")
    _PUSH_ENABLED = False
    _VAPID_OBJ = None


def _push_all_sync(body: str):
    """Send a push to every stored subscription. Runs in a daemon thread so the
    outbound HTTP to the push service never blocks the caller/event loop. Expired
    subscriptions (404/410) are pruned."""
    if not _PUSH_ENABLED:
        return
    try:
        conn = _get_db_conn()
        subs = conn.execute("SELECT endpoint, p256dh, auth FROM push_subscriptions").fetchall()
        conn.close()
    except Exception as e:
        print(f"⚠️ push: failed to read subscriptions: {e}")
        return

    payload = json.dumps({"title": "JARVIS", "body": body[:400]})
    dead = []
    for s in subs:
        sub_info = {"endpoint": s["endpoint"], "keys": {"p256dh": s["p256dh"], "auth": s["auth"]}}
        try:
            webpush(
                subscription_info=sub_info,
                data=payload,
                vapid_private_key=_VAPID_OBJ,
                vapid_claims={"sub": VAPID_SUB},
                timeout=10,
            )
        except WebPushException as e:
            code = getattr(e.response, "status_code", None)
            if code in (404, 410):
                dead.append(s["endpoint"])
            else:
                print(f"⚠️ push send failed ({code}): {e}")
        except Exception as e:
            print(f"⚠️ push send error: {e}")

    if dead:
        try:
            conn = _get_db_conn()
            # Per-row DELETE — TursoConnectionSync has no executemany (see db_compat).
            for _ep in dead:
                conn.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (_ep,))
            conn.commit()
            conn.close()
            print(f"🧹 push: pruned {len(dead)} expired subscription(s).")
        except Exception as e:
            print(f"⚠️ push: prune failed: {e}")


def _send_push(body: str):
    if _PUSH_ENABLED:
        threading.Thread(target=_push_all_sync, args=(body,), daemon=True).start()


def _store_notification(body: str, category: str = "general"):
    """Persist an outbound alert to the in-app JARVIS notification inbox, then push it
    to any subscribed browsers/devices (fire-and-forget, non-blocking)."""
    if not body or not body.strip():
        return  # never store a blank notification
    body = body.strip()
    try:
        conn = _get_db_conn()
        conn.execute("INSERT INTO notifications (body, category) VALUES (?, ?)", (body, category))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"⚠️ _store_notification error: {e}")
    _send_push(body)


def whatsapp_enabled() -> bool:
    """WhatsApp delivery kill-switch. Default ON until Web Push is verified; set the
    'whatsapp_enabled' setting to '0' to route every alert to JARVIS (web) only."""
    return str(get_setting("whatsapp_enabled", "1")).strip() in ("1", "true", "on", "yes")


def send_whatsapp_chunked(body: str, to_number: str = None, from_number: str = None):
    """Deliver an alert. It is ALWAYS stored in the JARVIS notification inbox (the web app
    owns the history now); it is additionally sent to WhatsApp only while whatsapp_enabled
    is on. This single choke point neutralizes every send path in one place."""
    import time
    _store_notification(body)
    if SAFE_MODE:
        print(f"🧪 SAFE_MODE: WhatsApp send suppressed ({len(body)} chars): {body[:80]!r}")
        return
    if not whatsapp_enabled():
        print(f"📵 WhatsApp off — alert stored in JARVIS inbox only ({len(body)} chars).")
        return
    MAX_CHARS = 1500
    to_number = to_number or TO_WHATSAPP
    from_number = from_number or FROM_WHATSAPP
    twilio_client = Client(TWILIO_SID, TWILIO_TOKEN)

    if len(body) <= MAX_CHARS:
        twilio_client.messages.create(body=body, from_=from_number, to=to_number)
        print(f"✅ Sent single message: {len(body)} chars")
        return

    # Split into chunks at sentence boundaries
    chunks = []
    remaining = body
    while len(remaining) > MAX_CHARS:
        split_at = remaining.rfind('. ', 0, MAX_CHARS)
        if split_at == -1:
            split_at = remaining.rfind(' ', 0, MAX_CHARS)
        if split_at == -1:
            split_at = MAX_CHARS
        chunks.append(remaining[:split_at + 1].strip())
        remaining = remaining[split_at + 1:].strip()
    if remaining:
        chunks.append(remaining)

    total = len(chunks)
    for i, chunk in enumerate(chunks, 1):
        part_label = f"\n\n({i}/{total})" if total > 1 else ""
        twilio_client.messages.create(body=chunk + part_label, from_=from_number, to=to_number)
        print(f"✅ Sent chunk {i}/{total}: {len(chunk)} chars")
        time.sleep(1)


@app.get("/")
@app.head("/")
def health_check():
    return {"status": "healthy", "message": "Engine is awake"}


@app.get("/ping")
@app.head("/ping")
def ping():
    return {"status": "alive", "timestamp": dt.datetime.utcnow().isoformat()}


# =========================================================================
# LOCAL COMMAND QUEUE — bridge between Render and the local_bridge.py
# process running on Madan's Mac (see local_bridge.py, bridge_setup.md)
# =========================================================================
LOCAL_QUEUE_ALLOWED_COMMANDS = [
    "list_folder", "read_file",
    "search_files", "system_info",
    "list_recent_files",
    "claude_code_propose", "claude_code_execute", "claude_code_chat",
]

CLAUDE_CODE_TRIGGER_SECRET = os.environ.get("CLAUDE_CODE_TRIGGER_SECRET", "")


async def _queue_local_command(command_type: str, payload: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO local_command_queue (command_type, payload) VALUES (?, ?)",
            (command_type, payload)
        )
        command_id = cursor.lastrowid
        await db.commit()
    return command_id


async def _poll_local_result(cmd_id: int, max_wait_seconds: int) -> str:
    for _ in range(max_wait_seconds):
        await asyncio.sleep(1)
        async with aiosqlite.connect(DB_PATH) as db:
            cur = await db.execute(
                "SELECT status, result FROM local_command_queue WHERE id=?",
                (cmd_id,)
            )
            row = await cur.fetchone()
        if row and row[0] == "completed":
            return row[1] or "No result"
    return "⏳ Local bridge not running. Start local_bridge.py on your Mac."


async def _deliver_local_result(command_id: int, source: str):
    # WhatsApp's webhook has a ~15s ack timeout, so it queues+acks immediately and
    # delivers via a background task; the web chat UI has no such timeout and waits inline.
    if source == "whatsapp":
        async def _deliver_when_ready():
            result = await _poll_local_result(command_id, max_wait_seconds=60)
            await log_chat_message("assistant", result)
            send_whatsapp(result)
        asyncio.create_task(_deliver_when_ready())
        return None
    else:
        result = await _poll_local_result(command_id, max_wait_seconds=15)
        await log_chat_message("assistant", result)
        return result


@app.post("/local-queue")
async def queue_local_command(request: Request):
    body = await request.json()
    command_type = body.get("command_type", "")
    payload = body.get("payload", "")

    if command_type not in LOCAL_QUEUE_ALLOWED_COMMANDS:
        return JSONResponse({
            "error": f"Command {command_type} not allowed"
        }, status_code=400)

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO local_command_queue "
            "(command_type, payload) VALUES (?, ?)",
            (command_type, payload)
        )
        command_id = cursor.lastrowid
        await db.commit()

    return JSONResponse({
        "status": "queued",
        "command_id": command_id
    })


@app.get("/local-queue/pending")
async def get_pending_commands():
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT id, command_type, payload "
            "FROM local_command_queue "
            "WHERE status='pending' "
            "ORDER BY created_at ASC LIMIT 5"
        )
        rows = await cur.fetchall()

    commands = [
        {"id": r[0], "command_type": r[1], "payload": r[2]}
        for r in rows
    ]
    return JSONResponse({"commands": commands})


@app.post("/local-queue/result")
async def post_command_result(request: Request):
    """Bridge posts results here. For claude_code_propose/execute, this is the ONLY
    reliable delivery point — unlike an in-memory polling task started by the
    original chat request, this handler only runs because the bridge is actively
    calling it, so it can't be silently lost to a server restart/redeploy/idle-sleep
    mid-wait."""
    body = await request.json()
    command_id = body.get("command_id")
    result = body.get("result", "")
    status = body.get("status", "completed")

    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT command_type, payload, source, cc_task_id, cc_session_row_id FROM local_command_queue WHERE id=?",
            (command_id,)
        )
        row = await cur.fetchone()

        # claude_code_chat results carry a "__SESSION_ID__<id>__\n" prefix so the
        # live session's --resume id can be captured here, since local_bridge.py
        # has no other side channel back to the server. Strip it before storing
        # so the Terminal tab's raw queue feed shows clean text too.
        new_cc_session_id = None
        if row and row["command_type"] == "claude_code_chat" and result.startswith("__SESSION_ID__"):
            try:
                marker, result = result.split("__\n", 1)
                new_cc_session_id = marker[len("__SESSION_ID__"):]
            except ValueError:
                pass

        await db.execute(
            "UPDATE local_command_queue "
            "SET status=?, result=?, "
            "completed_at=datetime('now') "
            "WHERE id=?",
            (status, result, command_id)
        )
        await db.commit()

    if row and status == "completed":
        command_type = row["command_type"]
        source = row["source"]

        if command_type == "claude_code_propose":
            await save_proposed_claude_code_task(row["payload"], result)
            msg = (
                f"🤖 *Claude Code's proposed plan:*\n\n{result}\n\n"
                f"─────────────────\n"
                f"Reply *approve claude code* to let it actually run this, or *cancel* to discard."
            )
            await log_chat_message("assistant", msg)
            if source == "whatsapp":
                send_whatsapp(msg)

        elif command_type == "claude_code_execute" and row["cc_task_id"]:
            await update_claude_code_task_status(row["cc_task_id"], "done")
            msg = f"✅ *Claude Code finished:*\n\n{result}"
            await log_chat_message("assistant", msg)
            if source == "whatsapp":
                send_whatsapp(msg)

        elif command_type == "claude_code_chat" and row["cc_session_row_id"]:
            if new_cc_session_id:
                await update_cc_session(row["cc_session_row_id"], cc_session_id=new_cc_session_id)
            await log_chat_message("assistant", result)
            if source == "whatsapp":
                send_whatsapp(result)

    return JSONResponse({"status": "saved"})


@app.get("/local-queue/result/{command_id}")
async def get_command_result(command_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        cur = await db.execute(
            "SELECT status, result FROM local_command_queue "
            "WHERE id=?",
            (command_id,)
        )
        row = await cur.fetchone()

    if not row:
        return JSONResponse({"error": "Not found"},
                          status_code=404)
    return JSONResponse({
        "status": row[0],
        "result": row[1]
    })


@app.get("/local-queue/history")
async def get_local_queue_history(after_id: int = 0, limit: int = 30):
    """Recent local_command_queue rows for the Terminal tab's live feed —
    after_id lets the frontend poll for only what's new since its last fetch."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT id, command_type, payload, status, result, created_at, completed_at "
            "FROM local_command_queue WHERE id > ? ORDER BY id ASC LIMIT ?",
            (after_id, limit)
        )
        rows = await cur.fetchall()
    return JSONResponse({"commands": [dict(r) for r in rows]})


# =========================================================================
# CLAUDE CODE BRIDGE — propose/execute helpers for pending_claude_code_task.
# Only one task in flight at a time, same single-active-item discipline as
# get_active_draft()/get_latest_pending_event() elsewhere in this file.
# =========================================================================
async def get_pending_claude_code_task():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM pending_claude_code_task WHERE status IN ('proposed', 'executing') "
            "ORDER BY created_at DESC LIMIT 1"
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def save_proposed_claude_code_task(task_text: str, proposed_plan: str) -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO pending_claude_code_task (task_text, proposed_plan, status) VALUES (?, ?, 'proposed')",
            (task_text, proposed_plan),
        )
        await db.commit()
        return cursor.lastrowid


async def update_claude_code_task_status(task_id: int, status: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE pending_claude_code_task SET status = ? WHERE id = ?", (status, task_id))
        await db.commit()


# =========================================================================
# CLAUDE CODE BRIDGE — live interactive session helpers. Unlike the
# propose/execute flow (one-shot, plan-gated), a live session is modal: once
# active, every chat message routes straight to a real `claude` process with
# full permissions via --resume, the same way you'd interact with Claude Code
# directly in a terminal. Only one session active at a time.
# =========================================================================
async def get_active_cc_session():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT * FROM claude_code_live_session WHERE status='active' ORDER BY created_at DESC LIMIT 1"
        )
        row = await cur.fetchone()
        return dict(row) if row else None


async def start_cc_session() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute("INSERT INTO claude_code_live_session (status) VALUES ('active')")
        await db.commit()
        return cursor.lastrowid


async def update_cc_session(session_row_id: int, cc_session_id: str = None, status: str = None):
    async with aiosqlite.connect(DB_PATH) as db:
        if cc_session_id is not None:
            await db.execute(
                "UPDATE claude_code_live_session SET cc_session_id = ? WHERE id = ?",
                (cc_session_id, session_row_id)
            )
        if status is not None:
            await db.execute(
                "UPDATE claude_code_live_session SET status = ? WHERE id = ?",
                (status, session_row_id)
            )
        await db.commit()


@app.get("/admin", response_class=Response)
async def admin_panel():
    """Hermes control panel — overview of engine state."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='skill_level'") as c:
            row = await c.fetchone(); skill = row[0] if row else "?"
        async with db.execute("SELECT value FROM user_profile WHERE key='study_streak'") as c:
            row = await c.fetchone(); streak = row[0] if row else "0"
        async with db.execute("SELECT COUNT(*) FROM sent_history") as c:
            row = await c.fetchone(); total_concepts = row[0] if row else 0
        async with db.execute("SELECT concept, timestamp FROM sent_history ORDER BY timestamp DESC LIMIT 5") as c:
            recent = await c.fetchall()
        async with db.execute("SELECT date, quiz_score, max_score, concept FROM performance_log ORDER BY date DESC LIMIT 5") as c:
            quiz_rows = await c.fetchall()
        async with db.execute("SELECT COUNT(*) FROM review_queue WHERE completed=0") as c:
            row = await c.fetchone(); pending_reviews = row[0] if row else 0
        async with db.execute("SELECT value FROM user_profile WHERE key='override_topic'") as c:
            row = await c.fetchone(); override = row[0] if row else None
        async with db.execute("SELECT value FROM user_profile WHERE key='difficulty_preference'") as c:
            row = await c.fetchone(); diff_pref = row[0] if row else "not set"

    recent_html = "".join(f"<li>{r[0]} <small style='color:#888'>({r[1][:10]})</small></li>" for r in recent) or "<li>None yet</li>"
    quiz_html = "".join(f"<li>{r[0]}: <b>{r[1]}/{r[2]}</b> — {r[3]}</li>" for r in quiz_rows) or "<li>No quizzes yet</li>"
    override_html = f"<span style='color:#e67e22'>⚠️ Topic override active: <b>{override}</b></span>" if override else "<span style='color:#27ae60'>Auto-selection active</span>"

    html = f"""<!DOCTYPE html><html><head><meta charset='utf-8'>
<title>Hermes Control Center</title>
<meta name='viewport' content='width=device-width,initial-scale=1'>
<style>
  body{{font-family:system-ui,sans-serif;background:#0f1117;color:#e0e0e0;margin:0;padding:20px}}
  h1{{color:#7c3aed;margin-bottom:4px}}
  .subtitle{{color:#888;font-size:13px;margin-bottom:24px}}
  .grid{{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}}
  .card{{background:#1a1d27;border-radius:10px;padding:16px;border:1px solid #2a2d3a}}
  .card h3{{margin:0 0 8px;font-size:13px;color:#888;text-transform:uppercase;letter-spacing:.5px}}
  .card .val{{font-size:28px;font-weight:700;color:#a78bfa}}
  .card .sub{{font-size:12px;color:#666;margin-top:4px}}
  .section{{background:#1a1d27;border-radius:10px;padding:16px;margin-bottom:16px;border:1px solid #2a2d3a}}
  .section h2{{margin:0 0 12px;font-size:15px;color:#c4b5fd}}
  ul{{margin:0;padding-left:18px;line-height:1.8}}
  li small{{font-size:11px}}
  .btn{{display:inline-block;padding:8px 18px;background:#7c3aed;color:#fff;border-radius:6px;
        text-decoration:none;font-size:13px;margin-right:8px;margin-top:8px}}
  .btn:hover{{background:#6d28d9}}
  .pill{{display:inline-block;padding:2px 8px;border-radius:99px;font-size:11px;
         background:#2a2d3a;color:#a78bfa;margin-left:6px}}
</style></head><body>
<h1>⚡ Hermes Control Center</h1>
<div class='subtitle'>Daily AI Learning Engine — live status</div>

<div class='grid'>
  <div class='card'><h3>Skill Level</h3><div class='val'>{skill}</div><div class='sub'>current track</div></div>
  <div class='card'><h3>Study Streak</h3><div class='val'>{streak} 🔥</div><div class='sub'>days in a row</div></div>
  <div class='card'><h3>Concepts Sent</h3><div class='val'>{total_concepts}</div><div class='sub'>total digests</div></div>
  <div class='card'><h3>Pending Reviews</h3><div class='val'>{pending_reviews}</div><div class='sub'>spaced repetition queue</div></div>
</div>

<div class='section'>
  <h2>📡 Topic Control</h2>
  <p style='margin:0 0 8px'>{override_html}</p>
  <p style='margin:0;font-size:13px;color:#888'>Difficulty preference: <span class='pill'>{diff_pref}</span></p>
  <p style='margin:8px 0 0;font-size:12px;color:#555'>To override next topic, send WhatsApp: <code>set topic: &lt;topic name&gt;</code></p>
</div>

<div class='section'>
  <h2>📚 Recent Digests</h2>
  <ul>{recent_html}</ul>
</div>

<div class='section'>
  <h2>🏆 Recent Quiz Scores</h2>
  <ul>{quiz_html}</ul>
</div>

<div class='section'>
  <h2>🚀 Manual Triggers</h2>
  <a class='btn' href='/run-morning-digest' onclick="this.textContent='Running…';fetch('/run-morning-digest',{{method:'POST'}}).then(r=>r.json()).then(d=>this.textContent=d.status||'Done');return false;">▶ Run Morning Digest</a>
  <a class='btn' href='/ping' style='background:#374151'>🏓 Ping</a>
</div>
</body></html>"""
    return Response(content=html, media_type="text/html")


# ==========================================
# 1. DATABASE STATE UTILITIES
# ==========================================
async def get_db_state():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='skill_level'") as cursor:
            row = await cursor.fetchone()
            skill = row[0] if row else "Foundational"
        async with db.execute("SELECT concept, summary FROM sent_history ORDER BY timestamp DESC LIMIT 7") as cursor:
            rows = await cursor.fetchall()
    history_concepts = [row[0] for row in rows]
    full_history_log = "\n---\n".join([f"Concept: {row[0]}\nPayload:\n{row[1]}" for row in rows])
    return skill, history_concepts, full_history_log

async def update_db_skill(new_level):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE user_profile SET value=? WHERE key='skill_level'", (new_level,))
        await db.commit()

async def log_sent_concept(concept, summary):
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute("INSERT INTO sent_history (concept, summary) VALUES (?, ?)", (concept, summary))
            await db.commit()
        except sqlite3.IntegrityError:
            pass

async def log_chat_message(role, content):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("INSERT INTO chat_history (role, content) VALUES (?, ?)", (role, content))
        await db.commit()

async def get_recent_chat_history(limit=5):
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT role, content FROM chat_history ORDER BY id DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
    return [{"role": row[0], "content": row[1]} for row in reversed(rows)]

async def save_user_fact(fact: str):
    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute("INSERT OR IGNORE INTO user_facts (fact) VALUES (?)", (fact.strip(),))
            await db.commit()
        except sqlite3.IntegrityError:
            pass

async def get_user_facts(limit: int = 15) -> list[str]:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT fact FROM user_facts ORDER BY created_at DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
    return [row[0] for row in rows]

async def save_articles_to_knowledge_store(articles: list[dict]):
    async with aiosqlite.connect(DB_PATH) as db:
        for article in articles:
            try:
                await db.execute(
                    "INSERT OR IGNORE INTO knowledge_store (url, title, content, saved_at) VALUES (?, ?, ?, datetime('now'))",
                    (article['url'], article['title'], article['content'])
                )
            except Exception as e:
                print(f"⚠️ Error saving article: {e}")
        await db.commit()

async def update_study_streak():
    """Increments study streak if not already updated today; resets if a day was skipped."""
    today = date.today().isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='last_study_date'") as cursor:
            row = await cursor.fetchone()
        last_date_str = row[0] if row and row[0] else ""
        async with db.execute("SELECT value FROM user_profile WHERE key='study_streak'") as cursor:
            streak_row = await cursor.fetchone()
        streak = int(streak_row[0]) if streak_row and streak_row[0].isdigit() else 0

        if last_date_str == today:
            return streak  # already counted today

        yesterday = (date.today() - dt.timedelta(days=1)).isoformat()
        new_streak = streak + 1 if last_date_str == yesterday else 1
        await db.execute("UPDATE user_profile SET value=? WHERE key='study_streak'", (str(new_streak),))
        await db.execute("UPDATE user_profile SET value=? WHERE key='last_study_date'", (today,))
        await db.commit()
    return new_streak

async def get_study_streak() -> int:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='study_streak'") as cursor:
            row = await cursor.fetchone()
    return int(row[0]) if row and row[0].isdigit() else 0

async def add_to_review_queue(concept: str, difficulties: list[str]):
    """Queue weak concept+difficulties for spaced repetition in 2 days."""
    due = (date.today() + dt.timedelta(days=2)).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        for diff in difficulties:
            await db.execute(
                "INSERT INTO review_queue (concept, difficulty, reason, due_date) VALUES (?, ?, ?, ?)",
                (concept, diff, "low quiz score", due)
            )
        await db.commit()

async def get_due_review(today_str: str) -> dict | None:
    """Returns the oldest incomplete review item due today or earlier."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT id, concept, difficulty FROM review_queue WHERE completed=0 AND due_date<=? ORDER BY due_date ASC LIMIT 1",
            (today_str,)
        ) as cursor:
            row = await cursor.fetchone()
    if row:
        return {"id": row[0], "concept": row[1], "difficulty": row[2]}
    return None

async def mark_review_done(review_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE review_queue SET completed=1 WHERE id=?", (review_id,))
        await db.commit()


# ── Spaced repetition (SRS): 1d → 3d → 1wk → 1mo ──
_SRS_INTERVALS = [1, 3, 7, 30]


async def srs_schedule(concept: str):
    """Schedule a newly-learned concept for its first review (+1 day). No-op if already scheduled."""
    if not (concept or "").strip():
        return
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    due = (date.today() + dt.timedelta(days=_SRS_INTERVALS[0])).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO srs_reviews (concept, rep, next_due, created_at) VALUES (?,0,?,?)",
            (concept.strip(), due, now))
        await db.commit()


async def srs_advance(concept: str):
    """Move a concept to its next interval after it's been reviewed."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT rep FROM srs_reviews WHERE concept=?", (concept,))
        row = await cur.fetchone()
        rep = (row["rep"] if row else 0) + 1
        interval = _SRS_INTERVALS[min(rep, len(_SRS_INTERVALS) - 1)]
        nxt = (date.today() + dt.timedelta(days=interval)).isoformat()
        await db.execute(
            "UPDATE srs_reviews SET rep=?, next_due=?, last_reviewed=? WHERE concept=?",
            (rep, nxt, date.today().isoformat(), concept))
        await db.commit()


async def srs_due(today_str: str) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT concept, rep, next_due FROM srs_reviews WHERE next_due<=? ORDER BY next_due ASC", (today_str,))
        return [dict(r) for r in await cur.fetchall()]


async def srs_all() -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT concept, rep, next_due, last_reviewed FROM srs_reviews ORDER BY next_due ASC")
        return [dict(r) for r in await cur.fetchall()]

async def extract_and_save_facts(user_message: str, assistant_response: str):
    prompt = f"""
Analyze this exchange and extract permanent facts about the user worth remembering.
User: {user_message}
Assistant: {assistant_response}
Extract: technical preferences, skill state, work environment, learning milestones.
Ignore greetings, acknowledgments, temporary state.
Output raw JSON array of strings only. If no facts, output [].
"""
    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=300, temperature=0.0,
            extra_body={"reasoning_effort": "low"},
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
        try:
            raw = text.strip() if text else ""
            if not raw:
                raise ValueError("Empty response from LLM")
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            facts = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
            facts = []  # safe fallback — list expected here
        if isinstance(facts, list) and facts:
            for fact in facts:
                await save_user_fact(str(fact))
    except Exception as e:
        print(f"⚠️ Memory Agent error: {e}")


# ==========================================
# 2. WEB SOURCE INGESTION ENGINE
# ==========================================
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

def fetch_live_internet_updates() -> list[dict]:
    articles = []
    unified_query = "latest artificial intelligence breakthroughs enterprise multi agent frameworks production architectures LLM evaluation guardrails testing evals"

    if TAVILY_API_KEY:
        print("🔍 Ingestion: Fetching via Tavily API...")
        try:
            res = requests.post("https://api.tavily.com/search", json={
                "api_key": TAVILY_API_KEY, "query": unified_query,
                "search_depth": "advanced", "include_raw_content": False, "max_results": 8
            }, timeout=15)
            if res.status_code == 200:
                for item in res.json().get("results", []):
                    articles.append({"url": item.get("url",""), "title": item.get("title",""), "content": item.get("content","")})
                if articles:
                    return articles
        except Exception as e:
            print(f"⚠️ Tavily failed ({e}). Falling back...")

    print("🕷️ Ingestion: Scraping from DuckDuckGo...")
    try:
        import socket
        socket.setdefaulttimeout(3)
        res = requests.get(
            f"https://html.duckduckgo.com/html/?q={unified_query.replace(' ', '+')}",
            headers={"User-Agent": "Mozilla/5.0 (compatible; DailyAIBot/1.0)"}, timeout=3
        )
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            for result in soup.find_all('div', class_='result')[:8]:
                a = result.find('a', class_='result__a')
                snippet = result.find('a', class_='result__snippet')
                if a:
                    url = a.get('href', '')
                    if url and not url.startswith('http'):
                        url = "https://" + url
                    articles.append({"url": url, "title": a.text.strip(), "content": snippet.text.strip() if snippet else ""})
    except Exception as e:
        print(f"DuckDuckGo search failed, continuing without web results")

    if not articles:
        articles = [
            {"url": "https://openai.com/news", "title": "Scaling multi-agent frameworks", "content": "Enterprise agentic frameworks with robust assertion loops."},
            {"url": "https://github.com/blog", "title": "Agentic Infrastructure Testing", "content": "Sandboxed runtimes for continuous code quality assertion."}
        ]
    return articles


# ==========================================
# 3. CURRICULUM PLANNER AGENT
# ==========================================
FALLBACK_TOPICS = [
    {"concept": "The Feynman Technique", "pedagogical_focus": "How to learn anything deeply by teaching it simply", "assert_template": "Explain quantum entanglement as if to a 10-year-old"},
    {"concept": "Bayes Theorem", "pedagogical_focus": "How to update beliefs with new evidence", "assert_template": "If a test is 99% accurate and disease affects 1% of people, what is P(disease|positive test)?"},
    {"concept": "Asymptotic Complexity", "pedagogical_focus": "How to measure algorithm efficiency with Big O notation", "assert_template": "What is the time complexity of binary search and why?"},
    {"concept": "Supply and Demand", "pedagogical_focus": "How prices emerge from buyer and seller behaviour", "assert_template": "What happens to price when supply drops but demand stays constant?"},
    {"concept": "Cognitive Biases", "pedagogical_focus": "How confirmation bias affects decision making", "assert_template": "Give a real-world example where confirmation bias led to a bad decision"},
    {"concept": "Neural Networks", "pedagogical_focus": "How layers of weights transform inputs to outputs", "assert_template": "Draw and label a simple 3-layer neural network"},
    {"concept": "The Socratic Method", "pedagogical_focus": "How to find truth through disciplined questioning", "assert_template": "List 3 Socratic questions you would ask to challenge the claim: AI will replace all jobs"},
    {"concept": "Compounding Interest", "pedagogical_focus": "How exponential growth works with money over time", "assert_template": "Calculate the value of 10000 rupees after 10 years at 8% annual compound interest"},
    {"concept": "First Principles Thinking", "pedagogical_focus": "How to break problems down to fundamental truths", "assert_template": "Use first principles to rethink how you would design a better chair"},
    {"concept": "The Unix Philosophy", "pedagogical_focus": "Do one thing well, chain simple tools together", "assert_template": "Write a one-line bash command that counts unique words in a text file"},
]

_FALLBACK_CONCEPTS = [
    ("Transformer Architecture", "Understand self-attention, positional encoding, and the encoder-decoder structure."),
    ("RAG Pipelines", "Build retrieval-augmented generation systems with vector stores and re-rankers."),
    ("Fine-tuning LLMs", "Apply LoRA and QLoRA to adapt large language models to specific tasks."),
    ("Vector Databases", "Index and query high-dimensional embeddings with FAISS, Pinecone, or Chroma."),
    ("Multi-Agent Systems", "Design systems where multiple AI agents collaborate, hand off tasks, and share state."),
    ("LLM Evaluation & Evals", "Measure LLM output quality with automated metrics, human eval, and benchmark suites."),
    ("MLOps Fundamentals", "Automate model training, versioning, deployment, and monitoring pipelines."),
    ("Prompt Engineering", "Master few-shot prompting, chain-of-thought, and structured output techniques."),
    ("Reinforcement Learning from Human Feedback", "Understand RLHF, reward modelling, and PPO as used in LLM alignment."),
    ("Neural Network Fundamentals", "Backpropagation, gradient descent, activation functions, and regularisation."),
    ("Data Pipelines & Feature Stores", "Build reliable data ingestion and feature engineering pipelines for ML."),
    ("Diffusion Models", "Learn the math and implementation of DDPM and score-based generative models."),
    ("Attention Mechanisms", "Deep-dive into multi-head attention, cross-attention, and Flash Attention."),
    ("Model Quantisation & Compression", "Reduce model size with INT8/INT4 quantisation, pruning, and distillation."),
    ("Computer Vision with CNNs", "Build and train convolutional networks for image classification and detection."),
]

def extract_json_from_response(response: str):
    """Extract JSON from model response even if surrounded by reasoning text."""
    if not response or not response.strip():
        return {}

    raw = response.strip()

    # Try 1: direct parse
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        pass

    # Try 2: strip markdown fences
    if "```" in raw:
        parts = raw.split("```")
        for part in parts:
            part = part.strip()
            if part.startswith("json"):
                part = part[4:].strip()
            try:
                return json.loads(part)
            except json.JSONDecodeError:
                continue

    # Try 3: find first { and last } and extract just that
    start = raw.find('{')
    end = raw.rfind('}')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end+1])
        except json.JSONDecodeError:
            pass

    # Try 4: find first [ and last ] for list responses
    start = raw.find('[')
    end = raw.rfind(']')
    if start != -1 and end != -1 and end > start:
        try:
            return json.loads(raw[start:end+1])
        except json.JSONDecodeError:
            pass

    # Try 5: response was truncated mid-JSON — attempt to repair it
    if start != -1:
        fragment = raw[start:]
        # Count open vs close braces to detect truncation
        open_count = fragment.count('{')
        close_count = fragment.count('}')
        if open_count > close_count:
            # Add missing closing braces
            fragment = fragment + ('}' * (open_count - close_count))
            try:
                return json.loads(fragment)
            except json.JSONDecodeError:
                # Try trimming to last complete key-value pair
                last_comma = fragment.rfind(',')
                last_quote = fragment.rfind('"')
                trim_at = max(last_comma, last_quote)
                if trim_at > start:
                    try:
                        repaired = fragment[:trim_at] + "}"
                        return json.loads(repaired)
                    except json.JSONDecodeError:
                        pass

    print(f"⚠️ JSON extract failed. Raw: {repr(raw[:300])}")
    return {}


async def run_curriculum_planner(skill_level, history_concepts):
    print("📋 [Curriculum Planner]: Selecting today's concept...")

    # Check for manual topic override set via WhatsApp "set topic: ..."
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='override_topic'") as cursor:
            row = await cursor.fetchone()
    if row:
        override = row[0].strip()
        # Consume the override — one-shot, cleared after use
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM user_profile WHERE key='override_topic'")
            await db.commit()
        print(f"🎯 Using manual topic override: '{override}'")
        return {
            "concept": override,
            "pedagogical_focus": f"Deep dive into {override} with practical implementation.",
            "assert_template": "Write assertions that verify the core behaviour of the implementation."
        }

    # Check review queue first — re-test weak areas before new content
    today_str = date.today().isoformat()
    due_review = await get_due_review(today_str)
    if due_review:
        print(f"🔁 Review queue: revisiting '{due_review['concept']}' ({due_review['difficulty']} level)")
        await mark_review_done(due_review["id"])
        return {
            "concept": due_review["concept"],
            "pedagogical_focus": f"Revisit and solidify understanding at {due_review['difficulty']} level.",
            "assert_template": "Write assertions that specifically test the areas you previously struggled with."
        }

    # Spaced repetition — a concept due for review takes priority over new material.
    srs_list = await srs_due(today_str)
    if srs_list:
        c = srs_list[0]["concept"]
        await srs_advance(c)
        print(f"🔁 [SRS]: reviewing '{c}' (rep {srs_list[0]['rep']})")
        return {
            "concept": c,
            "pedagogical_focus": f"Spaced review of {c} — recall and re-derive the key ideas from memory, then check yourself.",
            "assert_template": "Write assertions that re-verify the core behaviour of this concept.",
        }

    # Study track — walk an ordered role-targeted syllabus (AI Engineering, ML Foundations, …)
    # in order, skipping concepts already covered. Falls through to free-choice once complete.
    track_key = get_setting("study_track", "")
    if track_key:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT DISTINCT concept FROM sent_history") as cur:
                completed = {r[0].strip().lower() for r in await cur.fetchall() if r and r[0]}
        try:
            from study_tracks import next_concept as _next_track_concept
            concept, track = _next_track_concept(track_key, completed)
        except Exception as _e:
            print(f"⚠️ study track lookup failed: {_e}")
            concept, track = None, None
        if concept and track:
            print(f"🎓 [Study track {track['name']}]: next concept '{concept}'")
            return {
                "concept": concept,
                "pedagogical_focus": f"Build a solid, practical understanding of {concept} within {track['domain']}.",
                "assert_template": "Write assertions that verify the core behaviour of what you implement for this concept.",
            }

    exclusions = history_concepts

    current_topic = get_setting("topic", "")
    domain_display = get_setting("domain_display", "general knowledge")

    system_prompt = """You are a curriculum planner for a curious learner.
You can suggest concepts from ANY field of knowledge — not just technology.
Return only valid JSON. No thinking. No explanation. No markdown. No preamble.
Your entire response must be valid JSON starting with { and ending with }."""

    user_prompt = f"""Output JSON for a {skill_level} student.
Domain: {domain_display}.
Topic focus: {current_topic if current_topic else 'pick an interesting concept from ' + domain_display}.
Previously covered: {exclusions if exclusions else 'none'}.
Do not repeat previous topics.
OUTPUT ONLY THIS JSON, NOTHING ELSE:
{{"concept": "FILL IN", "pedagogical_focus": "FILL IN one sentence", "assert_template": "FILL IN a simple exercise"}}"""

    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=500, temperature=0.4,
            extra_body={"reasoning_effort": "low"},
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ]
        )
        text = response.choices[0].message.content.strip()
        data = extract_json_from_response(text)
        if not data:
            data = random.choice(FALLBACK_TOPICS)
            print("📋 [Planner fallback]: Using random fallback topic")
        print(f"🎯 Concept selected: '{data.get('concept')}'")
        return data
    except Exception as e:
        print(f"⚠️ Planner fallback: {e}")
        # Pick the fallback concept least recently covered
        covered = set(history_concepts)
        for concept, focus in _FALLBACK_CONCEPTS:
            if concept not in covered:
                return {
                    "concept": concept,
                    "pedagogical_focus": focus,
                    "assert_template": "Write specific assertions that verify the core logic of this concept."
                }
        # All covered — cycle back to first
        concept, focus = _FALLBACK_CONCEPTS[0]
        return {
            "concept": concept,
            "pedagogical_focus": focus,
            "assert_template": "Write specific assertions that verify the core logic of this concept."
        }


# ==========================================
# 4. WEEKLY PROJECT ENGINE
# — Project title + 7 subtasks all match today's concept
# — Every morning shows full project name + today's subtask only
# ==========================================
async def get_or_create_weekly_project(concept: str, skill_level: str) -> dict:
    today = date.today()
    week_start = (today - dt.timedelta(days=today.weekday())).strftime("%Y-%m-%d")
    day_of_week = today.weekday() + 1  # 1=Monday, 7=Sunday

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT project_title, day_number, subtask_title, subtask_description FROM weekly_project WHERE week_start=? AND day_number=?",
            (week_start, day_of_week)
        ) as cursor:
            row = await cursor.fetchone()

    if row:
        return {
            "project_title": row[0],
            "day_number": row[1],
            "subtask_title": row[2],
            "subtask_description": row[3],
            "week_start": week_start
        }

    # Check if project already generated this week
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT COUNT(*) FROM weekly_project WHERE week_start=?", (week_start,)
        ) as cursor:
            count_row = await cursor.fetchone()

    if count_row and count_row[0] > 0:
        # Project exists, just missing today's entry — return day 1
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT project_title, day_number, subtask_title, subtask_description FROM weekly_project WHERE week_start=? ORDER BY day_number ASC LIMIT 1",
                (week_start,)
            ) as cursor:
                first_row = await cursor.fetchone()
        if first_row:
            return {"project_title": first_row[0], "day_number": first_row[1], "subtask_title": first_row[2], "subtask_description": first_row[3], "week_start": week_start}

    # Generate new 7-day project matching this week's concept
    prompt = f"""
You are a project architect for an AI engineering student.
Skill level: {skill_level}
This week's concept: {concept}

Design a 7-day hands-on project where:
- The overall project is directly about: {concept}
- Each day builds on the previous day
- Day 7 is final integration and testing
- Every subtask is practical and buildable in 1-2 hours

You MUST respond with ONLY valid JSON. No explanation, no markdown, no code fences, no preamble.
Start your response with {{ and end with }}. If you cannot generate the content, return this exact JSON:
{{"topic": "LLM Architecture", "subtopic": "Transformers", "difficulty": "intermediate"}}

Return a JSON object with keys "project_title" and "subtasks" (array of 7 objects each with "day", "title", "description").
"""
    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=1500, temperature=0.3,
            extra_body={"reasoning_effort": "low"},
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.choices[0].message.content.strip()
        project_data = extract_json_from_response(text)
        if not project_data:
            project_data = {
                "project_title": "Build a simple token counter that tracks API usage",
                "subtasks": [
                    {"day": i, "title": step, "description": step}
                    for i, step in enumerate([
                        "Set up a counter variable",
                        "Log each API call",
                        "Display total at end of day",
                        "Add persistence to SQLite",
                        "Build a summary report",
                        "Add alerting on high usage",
                        "Write tests for the counter",
                    ], start=1)
                ]
            }
            print("⚠️ [Project fallback]: Using default project")

        async with aiosqlite.connect(DB_PATH) as db:
            for subtask in project_data["subtasks"]:
                await db.execute(
                    "INSERT INTO weekly_project (week_start, project_title, concept, day_number, subtask_title, subtask_description) VALUES (?, ?, ?, ?, ?, ?)",
                    (week_start, project_data["project_title"], concept, subtask["day"], subtask["title"], subtask["description"])
                )
            await db.commit()

        today_subtask = project_data["subtasks"][day_of_week - 1] if day_of_week <= 7 else project_data["subtasks"][0]
        return {
            "project_title": project_data["project_title"],
            "day_number": today_subtask["day"],
            "subtask_title": today_subtask["title"],
            "subtask_description": today_subtask["description"],
            "week_start": week_start
        }
    except Exception as e:
        print(f"⚠️ Project engine error: {e}")
        return {
            "project_title": f"Build a {concept} System",
            "day_number": day_of_week,
            "subtask_title": "Set up project structure",
            "subtask_description": f"Create the base folder structure and initialize your Python environment for building the {concept} system.",
            "week_start": week_start
        }


# ==========================================
# 5. ASSERTION QUALITY SCORER
# ==========================================
async def score_assertion_quality(assertions: list[str], concept: str, reference_code: str) -> dict:
    print("🔍 [Assertion Quality Scorer]: Evaluating assertion strength...")
    prompt = f"""
You are an expert Python QA engineer evaluating assertion quality.
Concept being tested: {concept}

Reference implementation:
{reference_code}

Assertions to evaluate:
{chr(10).join([f"{i+1}. {a}" for i, a in enumerate(assertions)])}

Score each assertion 1-10:
- 1-3: USELESS. Always passes regardless of implementation.
- 4-6: SHALLOW. Checks type or basic existence but not logic.
- 7-10: STRONG. Checks specific business logic and concept behavior.

Output raw JSON only:
{{
  "scores": [
    {{"assertion": "assert ...", "score": 8, "reason": "Tests specific logic"}},
    {{"assertion": "assert ...", "score": 3, "reason": "Always passes"}}
  ],
  "average_score": 6.0,
  "verdict": "PASS",
  "feedback": "Brief feedback here"
}}
Verdict is PASS if average_score >= 6.0, otherwise FAIL.
"""
    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL, max_tokens=600, temperature=0.0,
            extra_body={"reasoning_effort": "low"},
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
        try:
            raw = text.strip() if text else ""
            if not raw:
                raise ValueError("Empty response from LLM")
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            result = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
            result = {}
        if not result:
            result = {"scores": [], "average_score": 5.0, "verdict": "PASS", "feedback": "Scorer unavailable."}
        print(f"📊 Assertion Quality: {result.get('average_score', 0):.1f}/10 — {result.get('verdict')}")
        return result
    except Exception as e:
        print(f"⚠️ Quality scorer error: {e}")
        return {"scores": [], "average_score": 5.0, "verdict": "PASS", "feedback": "Scorer unavailable."}


# ==========================================
# 6. MUTATION TESTING ENGINE
# ==========================================
def apply_mutations(code: str) -> list[str]:
    mutations = []
    lines = code.split('\n')
    for i, line in enumerate(lines):
        mutated_lines = lines.copy()
        if '==' in line and 'assert' not in line:
            mutated_lines[i] = line.replace('==', '!=', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if ' + ' in line and 'assert' not in line:
            mutated_lines[i] = line.replace(' + ', ' - ', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if 'True' in line and 'assert' not in line:
            mutated_lines[i] = line.replace('True', 'False', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if ' > ' in line and 'assert' not in line:
            mutated_lines[i] = line.replace(' > ', ' < ', 1)
            mutations.append('\n'.join(mutated_lines))
            mutated_lines = lines.copy()
        if line.strip().startswith('return ') and 'None' not in line and 'assert' not in line:
            mutated_lines[i] = line.replace(line.strip(), 'return None', 1)
            mutations.append('\n'.join(mutated_lines))
    seen = set()
    unique = []
    for m in mutations:
        if m != code and m not in seen:
            seen.add(m)
            unique.append(m)
        if len(unique) >= 5:
            break
    return unique

def run_sandbox_silent(code: str, assert_lines: list) -> bool:
    import math, json as jmod, re as rmod, collections, itertools, functools
    clean = _sanitize_reference_code(code)
    full_code = clean + "\n\n" + "\n".join(assert_lines)
    sandbox_globals = {
        "math": math, "json": jmod, "re": rmod,
        "collections": collections, "itertools": itertools, "functools": functools,
        "__name__": "__main__",
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bool": bool, "dict": dict,
            "enumerate": enumerate, "float": float, "int": int,
            "isinstance": isinstance, "len": len, "list": list,
            "map": map, "max": max, "min": min, "print": print,
            "range": range, "round": round, "set": set, "sorted": sorted,
            "str": str, "sum": sum, "tuple": tuple, "type": type, "zip": zip,
            "AssertionError": AssertionError, "ValueError": ValueError,
            "TypeError": TypeError, "Exception": Exception
        }
    }
    try:
        exec(compile(full_code, "<sandbox>", "exec"), sandbox_globals)
        return True
    except Exception:
        return False

def run_mutation_testing(reference_code: str, assert_lines: list) -> dict:
    print("🧬 [Mutation Tester]: Running mutation tests...")
    mutations = apply_mutations(reference_code)
    if not mutations:
        return {"verdict": "PASS", "mutations_tested": 0, "mutations_caught": 0, "kill_rate": 100.0, "feedback": "No mutations applicable."}
    caught = 0
    survived_examples = []
    for mutated_code in mutations:
        passed = run_sandbox_silent(mutated_code, assert_lines)
        if passed:
            orig_lines = reference_code.split('\n')
            mut_lines = mutated_code.split('\n')
            for ol, ml in zip(orig_lines, mut_lines):
                if ol != ml:
                    if len(survived_examples) < 2:
                        survived_examples.append(f"'{ol.strip()}' → '{ml.strip()}'")
                    break
        else:
            caught += 1
    total = len(mutations)
    kill_rate = (caught / total * 100) if total > 0 else 100.0
    verdict = "PASS" if kill_rate >= 60.0 else "FAIL"
    feedback = ""
    if verdict == "FAIL":
        feedback = f"Assertions only caught {caught}/{total} mutations ({kill_rate:.0f}%). "
        if survived_examples:
            feedback += f"Missed: {'; '.join(survived_examples)}. Write specific value checks."
    print(f"🧬 Mutation: {caught}/{total} caught. Kill rate: {kill_rate:.0f}% — {verdict}")
    return {"verdict": verdict, "mutations_tested": total, "mutations_caught": caught, "kill_rate": kill_rate, "feedback": feedback}


# ==========================================
# 7. EXECUTION SANDBOX
# ==========================================
def _sanitize_reference_code(code: str) -> str:
    """Strip constructs that break sandbox exec: __name__ guards, markdown fences,
    shebang lines, and bare ellipsis stubs that cause SyntaxError under exec."""
    import re as _re
    # Remove markdown code fences if Claude leaked them
    code = _re.sub(r'^```[a-zA-Z]*\s*', '', code, flags=_re.MULTILINE)
    code = _re.sub(r'^```\s*$', '', code, flags=_re.MULTILINE)
    # Remove `if __name__ == "__main__":` blocks entirely — they break exec()
    # because __name__ is undefined in a plain sandbox globals dict
    code = _re.sub(r'if\s+__name__\s*==\s*["\']__main__["\']\s*:.*', '', code, flags=_re.DOTALL)
    # Replace bare `...` stub bodies with `pass` so syntax is valid
    code = _re.sub(r'(def\s+\w+[^:]+:)\s*\n(\s+)\.\.\.\s*\n', r'\1\n\2pass\n', code)
    return code.strip()


def run_code_sandbox(reference_code: str, assert_lines: list) -> tuple[bool, str]:
    print("🧪 [Sandbox]: Verifying assertions...")
    import math, json as jmod, re as rmod, collections, itertools, functools
    # Sanitize before compiling — removes __name__ guards and markdown leaks
    clean_code = _sanitize_reference_code(reference_code)
    # Validate syntax before attempting exec so we get a clear error message
    try:
        compile(clean_code, "<reference>", "exec")
    except SyntaxError as e:
        return False, f"SyntaxError in reference_code line {e.lineno}: {e.msg}"

    full_code = clean_code + "\n\n" + "\n".join(assert_lines)
    sandbox_globals = {
        # Standard modules Claude commonly uses in implementations
        "math": math, "json": jmod, "re": rmod,
        "collections": collections, "itertools": itertools, "functools": functools,
        # __name__ so `if __name__ == "__main__":` guards don't NameError if any survive
        "__name__": "__main__",
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool,
            "chr": chr, "dict": dict, "divmod": divmod, "enumerate": enumerate,
            "filter": filter, "float": float, "format": format,
            "int": int, "isinstance": isinstance, "issubclass": issubclass,
            "iter": iter, "len": len, "list": list, "map": map, "max": max, "min": min,
            "next": next, "object": object, "ord": ord, "pow": pow, "print": print,
            "range": range, "repr": repr, "reversed": reversed, "round": round,
            "set": set, "slice": slice, "sorted": sorted, "str": str, "sum": sum,
            "tuple": tuple, "type": type, "zip": zip, "hash": hash, "hex": hex,
            "oct": oct, "open": open, "vars": vars, "hasattr": hasattr,
            "getattr": getattr, "setattr": setattr, "callable": callable,
            "AssertionError": AssertionError, "ValueError": ValueError,
            "TypeError": TypeError, "KeyError": KeyError, "IndexError": IndexError,
            "Exception": Exception, "StopIteration": StopIteration,
            "RuntimeError": RuntimeError, "NotImplementedError": NotImplementedError,
            "OverflowError": OverflowError, "ZeroDivisionError": ZeroDivisionError,
        }
    }
    # Run assertions one-by-one to pinpoint which one fails and show context
    try:
        exec(compile(clean_code, "<sandbox>", "exec"), sandbox_globals)
    except Exception as e:
        return False, f"{type(e).__name__} in reference_code: {str(e)}"

    for i, assertion in enumerate(assert_lines):
        try:
            exec(compile(assertion, "<assertion>", "exec"), sandbox_globals)
        except AssertionError:
            return False, (
                f"AssertionError on assertion {i+1}/{len(assert_lines)}: `{assertion}` — "
                f"the function returned a different value than expected. "
                f"Fix the assertion so it matches the actual output of your reference implementation."
            )
        except Exception as e:
            return False, f"{type(e).__name__} on assertion {i+1}: `{assertion}` — {str(e)}"

    return True, "All assertions passed."


# ==========================================
# 8. QA CRITIC AGENT
# ==========================================
async def run_qa_critic(content: str, reference_code: str) -> tuple[bool, str]:
    print("🕵️‍♂️ [QA Critic]: Verifying pipeline parameters...")

    has_updates = "*🔴 REGULAR DAILY AI UPDATES*" in content
    has_learnings = "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*" in content

    # Extract assert lines from BOTH the payload and the reference_code.
    # Claude reliably puts runnable assertions in <reference_implementation>, not
    # inside <whatsapp_payload> (where they appear as illustrative examples only).
    assert_lines = []
    for line in (content + "\n" + reference_code).split('\n'):
        clean_line = line.replace('*', '').replace('-', '').strip()
        if clean_line.startswith('assert '):
            assert_lines.append(clean_line)
    # Deduplicate while preserving order
    seen = set()
    assert_lines = [x for x in assert_lines if not (x in seen or seen.add(x))]

    has_assert_syntax = len(assert_lines) >= 3
    char_length = len(content)
    within_twilio_limit = char_length <= 10000  # chunker handles splitting; check pre-split total

    lines = content.split('\n')
    is_in_update_block = False
    update_count = 0
    for line in lines:
        if "*🔴 REGULAR DAILY AI UPDATES*" in line:
            is_in_update_block = True
            continue
        if "*📘 WHAT I NEED TO LEARN*" in line:
            is_in_update_block = False
        if is_in_update_block and (line.strip().startswith('-') or line.strip().startswith('*') or (line.strip() and line.strip()[0].isdigit())):
            update_count += 1

    errors = []
    if not has_updates: errors.append("Missing '*🔴 REGULAR DAILY AI UPDATES*' header.")
    if not has_learnings: errors.append("Missing '*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*' header.")
    if not has_assert_syntax: errors.append(f"Found {len(assert_lines)} assertions, expected at least 3.")
    if not within_twilio_limit: errors.append(f"Payload out of size bounds ({char_length}/10000 chars).")
    if not (5 <= update_count <= 25): errors.append(f"Density check: Found {update_count} updates, expected 5-25.")

    sandbox_passed = False
    quality_result = {"verdict": "SKIP", "average_score": 0, "feedback": ""}
    mutation_result = {"verdict": "SKIP", "kill_rate": 0, "feedback": ""}

    if has_assert_syntax and reference_code:
        sandbox_passed, sandbox_msg = run_code_sandbox(reference_code, assert_lines)
        if not sandbox_passed:
            errors.append(f"Sandbox Failed: {sandbox_msg}")
        else:
            quality_result = await score_assertion_quality(assert_lines, "today's concept", reference_code)
            if quality_result.get("verdict") == "FAIL":
                errors.append(f"Assertion Quality Failed (avg {quality_result.get('average_score',0):.1f}/10): {quality_result.get('feedback','')}")
            if quality_result.get("verdict") != "FAIL":
                mutation_result = run_mutation_testing(reference_code, assert_lines)
                if mutation_result.get("verdict") == "FAIL":
                    errors.append(f"Mutation Testing Failed (kill rate {mutation_result.get('kill_rate',0):.0f}%): {mutation_result.get('feedback','')}")

    print("\n" + "="*50)
    print("📊 QA CRITIC STATUS AND INTEGRITY METRICS")
    print("-"*50)
    print(f"  - Daily Updates Section:         {'PASS' if has_updates else 'FAIL'}")
    print(f"  - Learning & Projects Section:  {'PASS' if has_learnings else 'FAIL'}")
    print(f"  - Sandbox Assert Execution:      {'PASS' if sandbox_passed else 'FAIL'}")
    print(f"  - Assertion Quality Score:       {quality_result.get('average_score',0):.1f}/10 ({quality_result.get('verdict','SKIP')})")
    print(f"  - Mutation Test Kill Rate:       {mutation_result.get('kill_rate',0):.0f}% ({mutation_result.get('verdict','SKIP')})")
    print(f"  - Twilio Message Size Safety:    {char_length}/10000 chars ({'PASS' if within_twilio_limit else 'FAIL'})")
    print(f"  - Density Metric:                {update_count} updates processed")

    if not errors:
        print("\nSTATUS: ALL PARAMETERS WORKING FINE. RELEASING PAYLOAD.")
        print("="*50 + "\n")
        return True, ""
    else:
        feedback_report = " | ".join(errors)
        print(f"\nSTATUS: REJECTED. Violations: {feedback_report}")
        print("="*50 + "\n")
        return False, feedback_report


# ==========================================
# 9. CREATOR AGENT
# ==========================================
async def generate_daily_payload(raw_data, skill_level, exclusions, planner_context, project_context, feedback_loop_msg="", include_project=True):
    print("🤖 [Creator Agent]: Requesting compact update from Claude...")

    concept = planner_context.get("concept")
    pedagogical_focus = planner_context.get("pedagogical_focus")
    assert_template = planner_context.get("assert_template")

    # Project section — always shows full project name + today's subtask only.
    # Web daily update sets include_project=False (news + concept + a runnable demo, no project).
    project_section = ""
    if project_context and include_project:
        project_section = (
            f"\n*🏗️ THIS WEEK'S PROJECT:*\n"
            f"_{project_context.get('project_title', '')}_\n\n"
            f"*Today — Day {project_context.get('day_number', 1)}: {project_context.get('subtask_title', '')}*\n"
            f"{project_context.get('subtask_description', '')}"
        )

    if include_project:
        project_line = (f"IMPORTANT: Today's mini project is directly about {concept}. \n"
                        f"The project, subtask, and learning content must all be on the same topic.\n")
        learn_block = (
            "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*\n"
            f"- *Core Concept to Master Today*: {concept} — {pedagogical_focus}\n"
            "- *Practical Mini-Project Blueprint*: A quick technical project loop.\n"
            "- *QA Validation Lines*:\n"
            "assert your_function_here() == expected_value\n"
            "assert your_second_function(input) == specific_result\n"
            "assert your_third_function() == True\n\n"
            "CRITICAL ASSERTION RULES:\n"
            "1. Every assertion MUST start with \"assert \" (lowercase)\n"
            "2. Every assertion MUST check a SPECIFIC value not just is not None\n"
            "3. Functions must match exactly what is defined in reference implementation\n"
            "4. Assertions must test actual concept logic\n\n"
            "Structure the <reference_implementation> as valid Python code with function definitions.")
    else:
        project_line = ""
        learn_block = (
            "*📘 WHAT I NEED TO LEARN*\n"
            f"- *Core Concept to Master Today*: {concept} — {pedagogical_focus}\n"
            "- *Why it matters*: one sentence on where this shows up in real AI systems.\n"
            "- *Key ideas*: 2-3 tight bullets a learner should walk away knowing.\n\n"
            f"Structure the <reference_implementation> as a SHORT, self-contained, runnable Python snippet "
            f"(10-25 lines) that demonstrates {concept} concretely — a learning example, not a project. "
            "Include a couple of print() calls so running it shows the idea in action. CRITICAL: use ONLY "
            "the Python STANDARD LIBRARY — NO third-party/pip packages (no tiktoken, numpy, pandas, openai, "
            "requests, torch, transformers) and NO network access. It must run offline in a browser sandbox. "
            "Simulate/mock any external service with a plain function.")

    prompt = f"""HARD LIMIT: Return EXACTLY 5 news items. Not 4. Not 6. Not 20.
Exactly 5 items in the updates section.
If you return more than 5 items the output will be rejected and thrown away.

You are the Lead Curriculum Director for an Engineer tracking towards Agentic AI Test Architecture.
Current Student Skill Level: {skill_level}
Strict Exclusion List (DO NOT REPEAT): {exclusions}

Today's Curriculum Focus:
- Concept to Master: {concept}
- Pedagogical Focus: {pedagogical_focus}
- Assert Template Guide: {assert_template}

{project_line}
Using these fresh live internet updates:
{raw_data}

Provide two outputs:
1. A WhatsApp-friendly learning digest wrapped in <whatsapp_payload> tags.
2. A valid Python reference implementation wrapped in <reference_implementation> tags.

CRITICAL SIZE CONSTRAINT: Content inside <whatsapp_payload> must be strictly under 1200 characters.

Structure the <whatsapp_payload> EXACTLY as:

*🔴 REGULAR DAILY AI UPDATES*
(Return EXACTLY 5 news items maximum. Not 6, not 7, not 20. Exactly 5. Each item must be under 100 characters.)
Stop after item 5. Do not add item 6 or beyond under any circumstances.

{learn_block}

CRITICAL OUTPUT FORMAT: Wrap your entire final answer in
<whatsapp_payload> and </whatsapp_payload> tags.
Put NOTHING outside these tags — no reasoning, no explanation,
no preamble. Everything outside the tags will be discarded.

Example:
<whatsapp_payload>
🔴 REGULAR DAILY AI UPDATES
[content here]

📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON
[content here]
</whatsapp_payload>
"""

    if feedback_loop_msg:
        prompt += f"\n\n⚠️ CRITICAL CORRECTION REQUIRED:\n{feedback_loop_msg}"

    response = await anthropic_client.chat.completions.create(
        model=OPENROUTER_MODEL, max_tokens=2000, temperature=0.2,
        extra_body={"reasoning_effort": "low"},
        messages=[{"role": "user", "content": prompt}]
    )

    text = response.choices[0].message.content
    whatsapp_payload = ""
    reference_code = ""

    if "<whatsapp_payload>" in text and "</whatsapp_payload>" in text:
        whatsapp_payload = text.split("<whatsapp_payload>")[1].split("</whatsapp_payload>")[0].strip()
    else:
        whatsapp_payload = text

    # The model sometimes leaks the reference implementation INSIDE the payload — strip it so the
    # lesson prose never carries a code dump (the code is shown/run separately from reference_code).
    whatsapp_payload = re.sub(r'<reference_implementation>.*?</reference_implementation>', '',
                              whatsapp_payload, flags=re.DOTALL | re.IGNORECASE)
    whatsapp_payload = re.sub(r'</?(reference_implementation|whatsapp_payload)>', '',
                              whatsapp_payload, flags=re.IGNORECASE).strip()

    if project_section:
        whatsapp_payload += f"\n\n{project_section}"

    if "<reference_implementation>" in text and "</reference_implementation>" in text:
        reference_code = text.split("<reference_implementation>")[1].split("</reference_implementation>")[0].strip()
        reference_code = re.sub(r'^```(?:python)?\s*|\s*```$', '', reference_code, flags=re.MULTILINE).strip()

    return whatsapp_payload, reference_code


# ==========================================
# 10. QUIZ ENGINE
# ==========================================
async def generate_quiz_questions(concept: str, skill_level: str) -> list[dict]:
    prompt = f"""
You are a strict quiz generator for an AI engineering student.
Concept: {concept}
Skill level: {skill_level}

Generate exactly 10 multiple choice questions. Every single question MUST have exactly 4 options labeled A, B, C, and D. No exceptions.

Distribution:
- Questions 1-2: Easy
- Questions 3-4: Medium
- Questions 5-6: Hard
- Questions 7-8: Difficult
- Questions 9-10: Advanced

CRITICAL RULES:
1. Every question MUST be a question ending with a question mark
2. Every question MUST have exactly 4 options: A, B, C, and D
3. Only ONE option is correct
4. Never write statements — always write questions
5. The "correct" field must be exactly one of: "A", "B", "C", or "D"

Follow this exact format. Do not deviate:

Output raw JSON array only — no markdown, no backticks, no extra text:
[
  {{
    "number": 1,
    "difficulty": "Easy",
    "question": "What does RAG stand for in AI systems?",
    "options": {{
      "A": "Random Access Generation",
      "B": "Retrieval Augmented Generation",
      "C": "Rapid Agent Grounding",
      "D": "Resource Allocation Graph"
    }},
    "correct": "B",
    "explanation": "RAG stands for Retrieval Augmented Generation which combines retrieval systems with LLMs."
  }},
  {{
    "number": 2,
    "difficulty": "Easy",
    "question": "Which component in a RAG system is responsible for finding relevant documents?",
    "options": {{
      "A": "The generator",
      "B": "The tokenizer",
      "C": "The retriever",
      "D": "The embedder"
    }},
    "correct": "C",
    "explanation": "The retriever searches the knowledge base to find documents relevant to the query."
  }}
]

Generate all 10 questions following this exact structure.
"""
    try:
        response = await anthropic_client.chat.completions.create(
            model=OPENROUTER_MODEL_FAST, max_tokens=2000, temperature=0.3,
            extra_body={"reasoning_effort": "low"},
            messages=[{"role": "user", "content": prompt}]
        )
        text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
        try:
            raw = text.strip() if text else ""
            if not raw:
                raise ValueError("Empty response from LLM")
            if raw.startswith("```"):
                raw = raw.split("```")[1]
                if raw.startswith("json"):
                    raw = raw[4:]
            questions = json.loads(raw.strip())
        except (json.JSONDecodeError, ValueError) as e:
            print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
            questions = []  # safe fallback — list expected here

        # Validate structure — discard malformed questions
        valid = []
        required_keys = {"question", "options", "correct", "explanation", "difficulty"}
        for q in questions:
            if not isinstance(q, dict):
                continue
            if not required_keys.issubset(q.keys()):
                continue
            opts = q.get("options", {})
            if not isinstance(opts, dict) or not {"A", "B", "C", "D"}.issubset(opts.keys()):
                continue
            if q.get("correct", "").upper() not in {"A", "B", "C", "D"}:
                continue
            valid.append(q)

        if len(valid) < 5:
            print(f"⚠️ Quiz validation: only {len(valid)} valid questions — treating as generation failure")
            return []

        print(f"✅ Generated {len(valid)} valid quiz questions for '{concept}'")
        return valid
    except Exception as e:
        print(f"⚠️ Quiz generation error: {e}")
        return []

def load_quiz_state() -> dict:
    if os.path.exists(QUIZ_STATE_FILE):
        with open(QUIZ_STATE_FILE, "r") as f:
            return json.load(f)
    return {}

def save_quiz_state(state: dict):
    with open(QUIZ_STATE_FILE, "w") as f:
        json.dump(state, f)

def clear_quiz_state():
    if os.path.exists(QUIZ_STATE_FILE):
        os.remove(QUIZ_STATE_FILE)

async def start_quiz_session(concept: str, skill_level: str) -> str:
    questions = await generate_quiz_questions(concept, skill_level)
    if not questions:
        return "⚠️ Could not generate quiz questions. Please try again later."

    async with aiosqlite.connect(DB_PATH) as db:
        cursor = await db.execute(
            "INSERT INTO quiz_sessions (date, concept, skill_level, total_questions) VALUES (?, ?, ?, ?)",
            (date.today().isoformat(), concept, skill_level, len(questions))
        )
        session_id = cursor.lastrowid
        await db.commit()

    save_quiz_state({
        "session_id": session_id, "concept": concept,
        "skill_level": skill_level, "questions": questions,
        "current_index": 0, "score": 0, "answers": []
    })
    return format_question(questions[0], 1, len(questions))

def format_question(q: dict, current: int, total: int) -> str:
    emoji = {"Easy": "🟢", "Medium": "🟡", "Hard": "🟠", "Difficult": "🔴", "Advanced": "⚫"}.get(q["difficulty"], "⚪")
    progress_bar = "▓" * current + "░" * (total - current)
    return (
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🧠 *Question {current} of {total}*\n"
        f"{progress_bar}\n"
        f"{emoji} *{q['difficulty']}*\n"
        f"━━━━━━━━━━━━━━━━━━━━\n\n"
        f"{q['question']}\n\n"
        f"*A)* {q['options']['A']}\n"
        f"*B)* {q['options']['B']}\n"
        f"*C)* {q['options']['C']}\n"
        f"*D)* {q['options']['D']}\n\n"
        f"↩️ Reply *A*, *B*, *C*, or *D*"
    )

async def process_quiz_answer(user_answer: str) -> str:
    state = load_quiz_state()
    if not state:
        return ""

    questions = state["questions"]
    current_index = state["current_index"]
    current_q = questions[current_index]
    is_correct = user_answer.upper().strip() == current_q["correct"].upper()

    if is_correct:
        state["score"] += 1

    state["answers"].append({
        "question_number": current_index + 1,
        "question_text": current_q["question"],
        "correct_answer": current_q["correct"],
        "user_answer": user_answer.upper(),
        "difficulty": current_q["difficulty"],
        "is_correct": is_correct
    })

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO quiz_answers (session_id, question_number, question_text, correct_answer, user_answer, difficulty, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (state["session_id"], current_index+1, current_q["question"], current_q["correct"], user_answer.upper(), current_q["difficulty"], int(is_correct))
        )
        await db.commit()

    feedback = "✅ Correct!" if is_correct else f"❌ Wrong. Answer: *{current_q['correct']}* — {current_q.get('explanation','')}"
    state["current_index"] += 1
    save_quiz_state(state)

    if state["current_index"] >= len(questions):
        result_msg = await finalize_quiz(state)
        clear_quiz_state()
        return f"{feedback}\n\n{result_msg}"
    else:
        next_q = questions[state["current_index"]]
        next_question_text = format_question(next_q, state["current_index"]+1, len(questions))
        options_footer = (
            f"\n─────────────────────\n"
            f"*What do you want to do?*\n"
            f"▶️ Reply *A/B/C/D* — Answer next question\n"
            f"⏭️ Reply *skip* — Skip this question\n"
            f"🛑 Reply *end quiz* — End quiz and see results"
        )
        return f"{feedback}\n\n{next_question_text}{options_footer}"

async def finalize_quiz(state: dict) -> str:
    score = state["score"]
    total = len(state["questions"])
    concept = state["concept"]
    skill_level = state["skill_level"]
    answers = state["answers"]
    wrong_answers = [a for a in answers if not a["is_correct"]]
    correct_answers = [a for a in answers if a["is_correct"]]
    weak_areas = ", ".join(set([a["difficulty"] for a in wrong_answers])) if wrong_answers else "None"
    percentage = (score / total) * 100

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE quiz_sessions SET score=?, completed=1 WHERE id=?", (score, state["session_id"]))
        await db.execute(
            "INSERT INTO performance_log (date, concept, quiz_score, max_score, skill_level, weak_areas) VALUES (?, ?, ?, ?, ?, ?)",
            (date.today().isoformat(), concept, score, total, skill_level, weak_areas)
        )
        await db.commit()

    # Build missed topics list
    missed_questions = [a["question_text"][:70] for a in wrong_answers]
    missed_section = ""
    if missed_questions:
        missed_section = "\n*❌ Questions You Missed:*\n" + "\n".join([f"- {q}..." for q in missed_questions[:5]])

    # Build key concepts to practice
    missed_difficulties = list(set([a["difficulty"] for a in wrong_answers]))
    concepts_section = ""
    if missed_difficulties:
        concepts_section = f"\n*📌 Key Concepts to Practice:*\n- Focus on *{concept}* at {' and '.join(missed_difficulties)} level\n- Revisit the fundamentals before moving to harder questions"

    # Resources based on concept and score
    resources_section = ""
    if score < 8:
        prompt = f"""
The student just scored {score}/{total} on a quiz about {concept} at {skill_level} level.
They struggled with: {', '.join(missed_questions[:3]) if missed_questions else 'advanced questions'}

Suggest exactly 3 specific free learning resources for {concept}.
Output raw JSON only:
[
  {{"title": "Resource name", "url": "https://...", "why": "One sentence why this helps"}},
  {{"title": "...", "url": "https://...", "why": "..."}},
  {{"title": "...", "url": "https://...", "why": "..."}}
]
"""
        try:
            response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=400, temperature=0.2,
                extra_body={"reasoning_effort": "low"},
                messages=[{"role": "user", "content": prompt}]
            )
            text = re.sub(r'^```(?:json)?\s*|\s*```$', '', response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
            try:
                raw = text.strip() if text else ""
                if not raw:
                    raise ValueError("Empty response from LLM")
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                resources = json.loads(raw.strip())
            except (json.JSONDecodeError, ValueError) as e:
                print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(text[:200] if text else 'EMPTY')}")
                resources = []
            resources_section = "\n*📚 Resources to Study:*\n" + "\n".join([f"- *{r['title']}*\n  {r['url']}\n  _{r['why']}_" for r in resources])
        except Exception as e:
            print(f"⚠️ Resource generation error: {e}")
            resources_section = f"\n*📚 Resources to Study:*\n- Search '{concept} tutorial' on YouTube\n- Check official documentation\n- Practice on GitHub"

    # Build final message based on score
    # Streak tracking
    new_streak = await update_study_streak()
    streak_msg = ""
    if new_streak in [3, 7, 14, 30]:
        streak_msg = f"\n\n🔥 *{new_streak}-day streak! Keep it up!*"
    elif new_streak > 1:
        streak_msg = f"\n\n📅 *Study streak: {new_streak} days*"

    if score < 5:
        header = f"📊 *Quiz Complete!*\n\nScore: *{score}/{total}* ({percentage:.0f}%) — Needs Work 📉"
        footer = "\n\n💪 Don't give up — review the resources above and try again tomorrow. Every expert started as a beginner!"
        await update_db_skill("Foundational")
        if missed_difficulties:
            await add_to_review_queue(concept, missed_difficulties)
    elif score < 8:
        header = f"📊 *Quiz Complete!*\n\nScore: *{score}/{total}* ({percentage:.0f}%) — Good Effort 👍"
        footer = "\n\n🚀 Solid progress! Study the missed topics and tomorrow you will score higher."
        if missed_difficulties:
            await add_to_review_queue(concept, missed_difficulties)
    else:
        header = f"📊 *Quiz Complete!*\n\nScore: *{score}/{total}* ({percentage:.0f}%) — Excellent! 🌟"
        missed_section = ""
        concepts_section = "\n*✅ Concepts Mastered:*\n- " + "\n- ".join([a["question_text"][:50] + "..." for a in correct_answers[:3]])
        resources_section = ""
        footer = "\n\n🔥 Outstanding work! Tomorrow we level up to something harder."
        await update_db_skill("Intermediate" if skill_level == "Foundational" else "Advanced")

    return header + missed_section + concepts_section + resources_section + footer + streak_msg


async def _log_job(job_name: str, status: str, message: str = "", severity: str = "info", traceback: str = "", attempt_number: int = 1):
    """Write a single row to job_logs. Fire-and-forget — never raises."""
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO job_logs (job_name, status, message, severity, traceback, attempt_number) VALUES (?, ?, ?, ?, ?, ?)",
                (job_name, status, message, severity, traceback, attempt_number)
            )
            await db.commit()
    except Exception:
        pass


# ==========================================
# 11. CHECK-IN REMINDER ENGINE
# — Asks about today's learning topic AND today's project subtask
# ==========================================
async def send_checkin_reminder(reminder_number: int):
    await _log_job("send_checkin_reminder", "started", f"reminder #{reminder_number}")
    today = date.today().isoformat()
    loop = asyncio.get_event_loop()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT reminder_count, learning_status, quiz_triggered, concept FROM daily_checkins WHERE date=?",
            (today,)
        ) as cursor:
            row = await cursor.fetchone()

    if not row:
        # Fetch today's concept from sent_history so reminders show the actual topic
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT concept FROM sent_history WHERE date(timestamp)=? ORDER BY timestamp DESC LIMIT 1",
                (today,)
            ) as cursor:
                concept_row = await cursor.fetchone()
        concept = concept_row[0] if concept_row else ""
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("INSERT OR IGNORE INTO daily_checkins (date, reminder_count, concept) VALUES (?, 0, ?)", (today, concept))
            await db.commit()
        reminder_count, learning_status, quiz_triggered = 0, "in_progress", 0
    else:
        reminder_count, learning_status, quiz_triggered, concept = row[0], row[1], row[2], row[3] or ""
        # Backfill missing concept from sent_history
        if not concept:
            async with aiosqlite.connect(DB_PATH) as db:
                async with db.execute(
                    "SELECT concept FROM sent_history WHERE date(timestamp)=? ORDER BY timestamp DESC LIMIT 1",
                    (today,)
                ) as cursor:
                    concept_row = await cursor.fetchone()
            if concept_row:
                concept = concept_row[0]
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute("UPDATE daily_checkins SET concept=? WHERE date=?", (concept, today))
                    await db.commit()

    if quiz_triggered:
        return
    
    if learning_status == "done":
        return

    # Get today's project subtask
    week_start = (date.today() - dt.timedelta(days=date.today().weekday())).strftime("%Y-%m-%d")
    day_of_week = date.today().weekday() + 1
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT project_title, subtask_title FROM weekly_project WHERE week_start=? AND day_number=?",
            (week_start, day_of_week)
        ) as cursor:
            project_row = await cursor.fetchone()

    project_line = ""
    if project_row:
        project_line = f"\n\n📌 *Project:* _{project_row[0]}_\n*Today's task:* {project_row[1]}"

    concept_line = f" on *{concept}*" if concept else ""

    messages = {
        1: f"📚 Hey! How is your learning going{concept_line}? Reply *'done'* when you finish today's concept.{project_line}",
        2: f"⏰ Quick check-in — still working through today's topic{concept_line}? Reply *'done'* when you are ready for your quiz!{project_line}",
        3: f"🎯 How is the progress{concept_line}? Reply *'done'* to unlock your quiz whenever you are ready.{project_line}",
        4: f"🔔 Checking in again — how is it going{concept_line}? Reply *'done'* or let me know if you are stuck.{project_line}",
        5: f"⚡ Final reminder! Reply *'done'* to start your quiz now, or I will kick it off automatically in 30 minutes.{concept_line}{project_line}"
    }

    msg = messages.get(reminder_number, f"How is your learning going{concept_line}?")

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "UPDATE daily_checkins SET reminder_count=? WHERE date=?",
            (reminder_count + 1, today)
        )
        await db.commit()

    await loop.run_in_executor(None, lambda: send_whatsapp_chunked(msg))
    await _log_job("send_checkin_reminder", "completed", f"reminder #{reminder_number} sent")
    print(f"⏰ Check-in reminder {reminder_number} sent.")

    if reminder_number == 5:
        # Schedule auto-quiz 30 min from now via APScheduler so it survives server restarts
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.date import DateTrigger
        fire_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(minutes=30)
        try:
            from apscheduler.schedulers.base import STATE_RUNNING
            running_schedulers = [s for s in AsyncIOScheduler.__subclasses__() if getattr(s, 'state', None) == STATE_RUNNING]
        except Exception:
            running_schedulers = []
        # Use the app's global scheduler via the app's state if available, else fire inline
        app_scheduler = getattr(app.state, "scheduler", None)
        if app_scheduler:
            app_scheduler.add_job(auto_trigger_quiz, DateTrigger(run_date=fire_at), id="auto_quiz_today", replace_existing=True)
            print("⏰ Auto-quiz scheduled for 30 minutes from now.")
        else:
            asyncio.create_task(_delayed_auto_quiz())

async def _delayed_auto_quiz():
    await asyncio.sleep(1800)
    await auto_trigger_quiz()

async def auto_trigger_quiz():
    today = date.today().isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT quiz_triggered FROM daily_checkins WHERE date=?", (today,)) as cursor:
            row = await cursor.fetchone()

    if row and row[0]:
        return

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT concept FROM sent_history ORDER BY timestamp DESC LIMIT 1") as cursor:
            concept_row = await cursor.fetchone()

    concept = concept_row[0] if concept_row else _FALLBACK_CONCEPTS[0][0]
    skill_level, _, _ = await get_db_state()

    intro = f"⏰ Time is up! Let us test what you have learned on *{concept}*. Starting your quiz now...\n\n"
    first_question = await start_quiz_session(concept, skill_level)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE daily_checkins SET quiz_triggered=1 WHERE date=?", (today,))
        await db.commit()

    loop = asyncio.get_event_loop()
    await loop.run_in_executor(None, lambda: send_whatsapp_chunked(intro + first_question))
    print("🧠 Auto-triggered quiz after final reminder.")


# ==========================================
# 12. WEEKLY PERFORMANCE REPORT
# ==========================================
async def send_weekly_report():
    await _log_job("send_weekly_report", "started")
    loop = asyncio.get_event_loop()
    today = date.today()
    week_ago = (today - dt.timedelta(days=7)).isoformat()

    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT date, concept, quiz_score, max_score, skill_level, weak_areas FROM performance_log WHERE date >= ? ORDER BY date ASC",
            (week_ago,)
        ) as cursor:
            rows = await cursor.fetchall()

    if not rows:
        msg = "📊 *Weekly Report*\n\nNo quiz data this week yet. Keep learning and completing your daily quizzes! 💪"
        await loop.run_in_executor(None, lambda: send_whatsapp_chunked(msg))
        return

    total_score = sum(r[2] for r in rows)
    total_max = sum(r[3] for r in rows)
    avg_pct = (total_score / total_max * 100) if total_max > 0 else 0
    all_weak = [r[5] for r in rows if r[5] and r[5] != "None"]
    weak_summary = ", ".join(set(", ".join(all_weak).split(", "))) if all_weak else "None"
    trend = "📈 Improving!" if len(rows) >= 2 and rows[-1][2] >= rows[0][2] else "📉 Needs more focus"
    daily = "\n".join([f"- {r[0]}: *{r[1][:25]}* — {r[2]}/{r[3]} ({r[2]/r[3]*100:.0f}%)" for r in rows])

    report = (
        f"📊 *Weekly Performance Report*\n"
        f"{'='*28}\n\n"
        f"*Overall:* {total_score}/{total_max} ({avg_pct:.0f}%)\n"
        f"*Trend:* {trend}\n"
        f"*Days Active:* {len(rows)}/7\n\n"
        f"*Daily Breakdown:*\n{daily}\n\n"
        f"*Weak Areas:* {weak_summary}\n\n"
        f"*Next Week:* Strengthen {weak_summary if weak_summary != 'None' else 'Advanced concepts'}\n\n"
        f"Keep pushing — you are building something great! 🚀"
    )

    await loop.run_in_executor(None, lambda: send_whatsapp_chunked(report))
    await _log_job("send_weekly_report", "completed")
    print("📊 Weekly report sent.")


# ==========================================
# 13. MORNING DIGEST ENDPOINT
# ==========================================
def extract_final_payload(raw_response: str) -> str:
    """
    Strips reasoning/thinking text from model output.
    Only keeps content between <whatsapp_payload> tags if present,
    otherwise strips common reasoning patterns.
    """
    if not raw_response:
        return ""

    text = raw_response.strip()

    # Method 1: If wrapped in <whatsapp_payload> tags, extract only that
    if "<whatsapp_payload>" in text and "</whatsapp_payload>" in text:
        start = text.find("<whatsapp_payload>") + len("<whatsapp_payload>")
        end = text.find("</whatsapp_payload>")
        return text[start:end].strip()

    # Method 2: If reasoning leaked without tags, detect and strip it
    reasoning_markers = [
        "We need to", "We must", "Let's", "I'll produce",
        "Thus we need", "Probably each", "We'll design",
        "Let's estimate", "We need assertions"
    ]

    lines = text.split('\n')
    content_start_idx = 0

    for i, line in enumerate(lines):
        stripped = line.strip()
        # Find where actual content starts (emoji headers are reliable markers)
        if stripped.startswith('🔴') or stripped.startswith('📘') or stripped.startswith('📊'):
            content_start_idx = i
            break
        # If we hit a reasoning marker, keep scanning past it
        if any(stripped.startswith(marker) for marker in reasoning_markers):
            continue

    cleaned = '\n'.join(lines[content_start_idx:])

    # Safety check: if cleaned result is still suspiciously long with
    # reasoning phrases, it's a hard failure — return empty so fallback kicks in
    if any(marker in cleaned[:200] for marker in reasoning_markers):
        print("⚠️ Reasoning leak detected even after cleaning — rejecting payload")
        return ""

    return cleaned.strip()


def enforce_content_limits(text: str, max_items: int = 5, max_chars: int = 7000) -> str:
    """
    Hard-cap the number of news/update items and total length.
    Runs after LLM generation, before QA check.
    """
    lines = text.split('\n')

    item_count = 0
    output_lines = []
    in_updates_section = False

    for line in lines:
        stripped = line.strip()

        # Detect updates section header
        if 'DAILY UPDATES' in stripped.upper() or 'NEWS' in stripped.upper():
            in_updates_section = True

        # Detect learning section — stop counting items
        if 'LEARN' in stripped.upper() or 'PROJECT' in stripped.upper():
            in_updates_section = False

        # Count items in updates section only
        is_item = (
            stripped.startswith('•') or
            stripped.startswith('-') or
            stripped.startswith('*') or
            (len(stripped) > 2 and stripped[0].isdigit() and stripped[1] in '.)')
        )

        if in_updates_section and is_item:
            item_count += 1
            if item_count > max_items:
                continue  # skip items beyond the limit

        output_lines.append(line)

    result = '\n'.join(output_lines)

    # Hard cap total length
    if len(result) > max_chars:
        result = result[:max_chars]
        # Find last complete sentence
        last_period = result.rfind('.')
        if last_period > max_chars * 0.8:
            result = result[:last_period + 1]
        result += "\n\n_(Content trimmed for delivery)_"

    print(f"✅ Content enforcer: {item_count} items found, capped at {max_items}. Final size: {len(result)} chars")
    return result


async def run_morning_digest():
    await _log_job("run_morning_digest", "started")
    _mem_probe("digest:start")
    try:
        _, recent_topics, _ = await get_db_state()
        skill_level = get_setting("skill_level", "intermediate")

        # Planner must run first — RAG needs the concept it returns
        planner_context = await run_curriculum_planner(skill_level, recent_topics)
        concept = planner_context.get("concept", "Agentic Scaffolding Testing")

        loop = asyncio.get_running_loop()

        async def _fetch_and_save_news():
            articles = await loop.run_in_executor(None, fetch_live_internet_updates)
            await save_articles_to_knowledge_store(articles)
            return articles

        # News fetch + RAG retrieval run in parallel
        raw_news, relevant_articles = await asyncio.gather(
            _fetch_and_save_news(),
            retrieve_relevant_context(concept, limit=3),
            return_exceptions=True,
        )
        if isinstance(raw_news, Exception):
            print(f"⚠️ News fetch failed: {raw_news}")
            raw_news = []
        if isinstance(relevant_articles, Exception):
            print(f"⚠️ RAG retrieval failed: {relevant_articles}")
            relevant_articles = []

        _mem_probe("digest:after-news-fetch")

        if relevant_articles:
            context_blocks = [f"[{i+1}] Title: {a['title']}\nURL: {a['url']}\nSnippet: {a['content']}" for i, a in enumerate(relevant_articles)]
        else:
            context_blocks = [f"[{i+1}] Title: {a['title']}\nURL: {a['url']}\nSnippet: {a['content']}" for i, a in enumerate(raw_news[:3])]

        news_context = "\n\n".join(context_blocks)
        exclusions = ", ".join(recent_topics) if recent_topics else "None"

        # Get weekly project — concept-matched
        project_context = await get_or_create_weekly_project(concept, skill_level)

        today = date.today().isoformat()
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT OR IGNORE INTO daily_checkins (date, reminder_count, concept) VALUES (?, 0, ?)",
                (today, concept)
            )
            await db.commit()

        max_retries = 1
        current_attempt = 1
        feedback = ""
        final_text = ""
        reference_code = ""
        is_valid_run = False

        while current_attempt <= max_retries:
            print(f"🔄 Evaluation Run Sequence: Loop {current_attempt}/{max_retries}")
            try:
                final_text, reference_code = await generate_daily_payload(
                    news_context, skill_level, exclusions, planner_context, project_context, feedback_loop_msg=feedback
                )
                final_text = enforce_content_limits(final_text)
                final_text = extract_final_payload(final_text)
                if not final_text or len(final_text) < 50:
                    print("⚠️ Creator Agent payload extraction failed — using safe fallback")
                    final_text = (
                        "🔴 *REGULAR DAILY AI UPDATES*\n"
                        "Content generation had an issue today. Check back tomorrow!\n\n"
                        "📘 *WHAT I NEED TO LEARN*\n"
                        "Today's concept: " + concept + "\n"
                        "Take a moment to research this topic on your own today."
                    )
                is_valid_run, feedback = await run_qa_critic(final_text, reference_code)
                if is_valid_run:
                    break
                current_attempt += 1
            except Exception as e:
                import traceback
                print(f"❌ Generation failure: {e}")
                traceback.print_exc()
                feedback = f"Internal error: {str(e)}"
                current_attempt += 1

        if is_valid_run:
            weather_brief = await get_weather_brief()
            final_text = f"🌤️ {weather_brief}\n\n{final_text}"
            await log_sent_concept(concept, final_text)
            today_str = date.today().isoformat()
            # Save to cache before sending
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO digest_cache (date, content, sent) VALUES (?, ?, 0)",
                    (today_str, final_text)
                )
                await db.commit()
            print(f"💾 [Digest Cache]: Saved digest for {today_str}")
            try:
                await loop.run_in_executor(None, lambda: send_whatsapp_chunked(final_text))
                # Mark as sent in cache
                async with aiosqlite.connect(DB_PATH) as db:
                    await db.execute(
                        "UPDATE digest_cache SET sent=1 WHERE date=? AND sent=0",
                        (today_str,)
                    )
                    await db.commit()
                # Difficulty feedback prompt — separate message so digest stays clean
                feedback_prompt = (
                    f"📐 *Quick feedback:* Was today's concept (*{concept}*) the right difficulty?\n"
                    f"Reply *E* (too easy) · *J* (just right) · *H* (too hard)"
                )
                await loop.run_in_executor(None, lambda: send_whatsapp_chunked(feedback_prompt))
                await _log_job("run_morning_digest", "completed", f"concept: {concept}")
                _mem_probe("digest:end")
                _malloc_trim()
                return {"status": "Digest approved and dispatched.", "concept": concept}
            except Exception as e:
                await _log_job("run_morning_digest", "failed", f"Twilio error: {str(e)}")
                return {"status": "QA Passed but Twilio failed", "error": str(e)}
        else:
            await _log_job("run_morning_digest", "failed", f"QA rejected: {feedback}")
            return {"status": "Aborted. Failed structural validation.", "errors": feedback}

    except Exception as e:
        import traceback
        traceback.print_exc()
        await _log_job("run_morning_digest", "failed", str(e))
        return {"status": "Error running digest pipeline", "error": str(e)}


@app.post("/run-morning-digest")
async def morning_digest_endpoint():
    return await run_morning_digest()


# ==========================================
# DAILY AI UPDATE — WEB-FIRST (WhatsApp only on explicit trigger)
# ==========================================
_SKILL_LADDER = ["Foundational", "Intermediate", "Advanced", "Expert"]


async def _watch_these_for_concept(concept: str, limit: int = 4) -> list:
    """Tier-1 (free, no LLM): pick relevant creator posts tied to the day's concept. Keyword-overlaps
    the concept against recent relevant influencer_posts titles; falls back to the newest relevant."""
    try:
        from influencer_agent import get_feed
        posts = await get_feed(limit=30, only_relevant=True)
    except Exception:
        return []
    if not posts:
        return []
    tokens = {w.lower() for w in re.findall(r"[A-Za-z]{4,}", concept or "")}

    def overlap(p):
        title = (p.get("title") or "").lower()
        return sum(1 for t in tokens if t in title)

    on_topic = sorted((p for p in posts if overlap(p) > 0), key=overlap, reverse=True)[:limit]
    top = on_topic or posts[:limit]  # posts are already newest-first
    return [{"name": p.get("name"), "platform": p.get("platform"), "title": p.get("title"),
             "url": p.get("url"), "note": p.get("relevance_note", "")} for p in top]


async def generate_daily_web_digest():
    """Run the SAME pipeline as the morning digest (Planner → live news + RAG → weekly project →
    Creator → QA Critic) but STORE a structured record for the console instead of sending WhatsApp.
    Idempotent per day (upserts today's row). Posts a web notification, never a WhatsApp."""
    await _log_job("generate_daily_web_digest", "started")
    try:
        skill, recent_topics, _ = await get_db_state()
        planner_context = await run_curriculum_planner(skill, recent_topics)
        concept = planner_context.get("concept", "Agentic Scaffolding Testing")
        loop = asyncio.get_running_loop()

        async def _fetch_and_save_news():
            articles = await loop.run_in_executor(None, fetch_live_internet_updates)
            await save_articles_to_knowledge_store(articles)
            return articles

        raw_news, relevant_articles = await asyncio.gather(
            _fetch_and_save_news(), retrieve_relevant_context(concept, limit=3),
            return_exceptions=True)
        if isinstance(raw_news, Exception):
            raw_news = []
        if isinstance(relevant_articles, Exception):
            relevant_articles = []

        news_items = (relevant_articles or raw_news)[:5]
        news_display = [{"title": a.get("title", ""), "url": a.get("url", ""),
                         "snippet": (a.get("content", "") or "")[:300]} for a in news_items]
        context_blocks = [f"[{i+1}] Title: {a['title']}\nURL: {a['url']}\nSnippet: {a['content']}"
                          for i, a in enumerate(news_items[:3])]
        news_context = "\n\n".join(context_blocks)
        exclusions = ", ".join(recent_topics) if recent_topics else "None"

        # Web daily update: no weekly project, no mini-project/QA-asserts — just news + concept
        # + a short runnable demo. (The WhatsApp morning digest still includes the project.)
        final_text, reference_code = await generate_daily_payload(
            news_context, skill, exclusions, planner_context, {}, include_project=False)
        final_text = extract_final_payload(enforce_content_limits(final_text))
        if not final_text or len(final_text) < 50:
            final_text = f"🔴 REGULAR DAILY AI UPDATES\nContent generation hiccuped — regenerate.\n\n📘 WHAT I NEED TO LEARN\nToday's concept: {concept}"
        # Lightweight validation — the heavy assert/sandbox/mutation QA only applies to the project.
        is_valid = ("📘 WHAT I NEED TO LEARN" in final_text) and len(final_text) >= 120
        project_context = {}

        today = date.today().isoformat()
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        watch_these = await _watch_these_for_concept(concept)
        await log_sent_concept(concept, final_text)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO daily_web_digest
                   (date, news_json, concept, pedagogical_focus, project_json, digest_text,
                    reference_code, difficulty, watch_json, sent_whatsapp, created_at)
                   VALUES (?,?,?,?,?,?,?,NULL,?,0,?)
                   ON CONFLICT(date) DO UPDATE SET news_json=excluded.news_json, concept=excluded.concept,
                     pedagogical_focus=excluded.pedagogical_focus, project_json=excluded.project_json,
                     digest_text=excluded.digest_text, reference_code=excluded.reference_code,
                     watch_json=excluded.watch_json, created_at=excluded.created_at""",
                (today, json.dumps(news_display), concept, planner_context.get("pedagogical_focus", ""),
                 json.dumps(project_context), final_text, reference_code, json.dumps(watch_these), now))
            await db.commit()
        await srs_schedule(concept)  # queue this concept for spaced review (+1d, then 3/7/30)
        _store_notification(f"📰 Today's AI update is ready — {concept}. Open the Daily tab.", "daily")
        await _log_job("generate_daily_web_digest", "completed", f"concept: {concept}")
        _malloc_trim()
        return {"ok": True, "date": today, "concept": concept, "qa_passed": bool(is_valid)}
    except Exception as e:
        import traceback
        traceback.print_exc()
        await _log_job("generate_daily_web_digest", "failed", str(e))
        return {"ok": False, "error": str(e)}


def _row_to_digest(row) -> dict:
    d = dict(row)
    d["news"] = json.loads(d.get("news_json") or "[]")
    d["project"] = json.loads(d.get("project_json") or "{}")
    d["watch"] = json.loads(d.get("watch_json") or "[]")
    d["sent_whatsapp"] = bool(d.get("sent_whatsapp"))
    for k in ("news_json", "project_json", "watch_json"):
        d.pop(k, None)
    return d


@app.get("/api/daily/today")
async def daily_today_api():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM daily_web_digest ORDER BY date DESC LIMIT 1")
        row = await cur.fetchone()
    return JSONResponse(_row_to_digest(row) if row else {"empty": True})


@app.get("/api/daily/history")
async def daily_history_api():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT date, concept, difficulty, sent_whatsapp FROM daily_web_digest ORDER BY date DESC LIMIT 30")
        rows = [dict(r) for r in await cur.fetchall()]
    for r in rows:
        r["sent_whatsapp"] = bool(r.get("sent_whatsapp"))
    return JSONResponse({"history": rows})


@app.get("/api/daily/{d}")
async def daily_get_api(d: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT * FROM daily_web_digest WHERE date = ?", (d,))
        row = await cur.fetchone()
    return JSONResponse(_row_to_digest(row) if row else {"empty": True})


@app.post("/api/daily/generate")
async def daily_generate_api():
    return JSONResponse(await generate_daily_web_digest())


@app.post("/api/daily/{d}/whatsapp")
async def daily_whatsapp_api(d: str):
    """The ONLY path that sends the digest to WhatsApp — explicit user action."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT digest_text FROM daily_web_digest WHERE date = ?", (d,))
        row = await cur.fetchone()
    if not row or not row["digest_text"]:
        return JSONResponse({"ok": False, "error": "No digest for that date."}, status_code=404)
    try:
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, lambda: send_whatsapp_chunked(row["digest_text"]))
    except Exception as e:
        return JSONResponse({"ok": False, "error": f"WhatsApp send failed: {e}"}, status_code=502)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE daily_web_digest SET sent_whatsapp = 1 WHERE date = ?", (d,))
        await db.commit()
    return JSONResponse({"ok": True, "message": "Sent to WhatsApp."})


@app.post("/api/daily/{d}/difficulty")
async def daily_difficulty_api(d: str, request: Request):
    """Record E/J/H feedback and nudge the skill level (E=too easy → up, H=too hard → down)."""
    try:
        rating = str((await request.json()).get("rating", "")).upper()[:1]
    except Exception:
        rating = ""
    if rating not in ("E", "J", "H"):
        return JSONResponse({"ok": False, "error": "rating must be E, J or H"}, status_code=400)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE daily_web_digest SET difficulty = ? WHERE date = ?", (rating, d))
        await db.commit()
    if rating in ("E", "H"):
        skill, _, _ = await get_db_state()
        try:
            idx = _SKILL_LADDER.index(skill)
        except ValueError:
            idx = 0
        idx = min(len(_SKILL_LADDER) - 1, idx + 1) if rating == "E" else max(0, idx - 1)
        await update_db_skill(_SKILL_LADDER[idx])
        return JSONResponse({"ok": True, "skill_level": _SKILL_LADDER[idx]})
    return JSONResponse({"ok": True})


# ── Study track — pick a role-targeted syllabus for the Daily AI Update ──
async def _completed_concepts_lower() -> set:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT DISTINCT concept FROM sent_history") as cur:
            return {r[0].strip().lower() for r in await cur.fetchall() if r and r[0]}


@app.get("/api/study/tracks")
async def study_tracks_api():
    import study_tracks
    return JSONResponse({"tracks": study_tracks.list_tracks()})


@app.get("/api/study/current")
async def study_current_api():
    import study_tracks
    key = get_setting("study_track", "")
    progress = study_tracks.track_progress(key, await _completed_concepts_lower()) if key else None
    return JSONResponse({"active": key, "progress": progress})


@app.post("/api/study/select")
async def study_select_api(request: Request):
    """Set the active study track (or '' / 'none' for free-choice). Also steers the domain so the
    planner stays on-topic after the syllabus is finished."""
    import study_tracks
    try:
        key = str((await request.json()).get("track_key", "")).strip()
    except Exception:
        key = ""
    if key in ("", "none", "free"):
        save_setting("study_track", "")
        save_setting("domain_display", "general knowledge")
        return JSONResponse({"ok": True, "active": ""})
    t = study_tracks.TRACKS.get(key)
    if not t:
        return JSONResponse({"ok": False, "error": "unknown track"}, status_code=400)
    save_setting("study_track", key)
    save_setting("domain_display", t["domain"])
    progress = study_tracks.track_progress(key, await _completed_concepts_lower())
    return JSONResponse({"ok": True, "active": key, "progress": progress})


# ── Active recall — daily quiz + "explain it back" (Feynman) ──
def _json_obj(raw: str) -> dict:
    raw = (raw or "").strip()
    s = raw.find("{")
    if s == -1:
        raise ValueError("no JSON object")
    obj, _ = json.JSONDecoder().raw_decode(raw[s:])
    return obj


_QUIZ_GEN_PROMPT = (
    "You are a study coach. Given a CONCEPT and its lesson, write 2-3 short active-recall questions "
    "that test genuine understanding (not trivia), each with a concise ideal answer. STRICT JSON only: "
    '{"questions":[{"q":"...","ideal":"..."}]} — 2-3 items. Output JSON only.')
_QUIZ_GRADE_PROMPT = (
    "You are grading a learner's recall answers. For each item you get the question, the ideal answer "
    "and the learner's answer. Judge each as correct / partial / incorrect and give a 1-2 sentence "
    "explanation that teaches. Give an overall 0-100 score. STRICT JSON only: "
    '{"overall":<int>,"items":[{"verdict":"correct|partial|incorrect","explanation":"..."}]} '
    "(items in the same order). Output JSON only.")
_FEYNMAN_PROMPT = (
    "You are a study coach using the Feynman technique. Given a CONCEPT and the learner's plain-language "
    "explanation, assess whether they truly understand it. Say what's correct, and specifically what's "
    "missing or wrong. Encouraging but honest. STRICT JSON only: "
    '{"rating":"solid|partial|shaky","correct":"...","missing":["..."],"feedback":"..."} Output JSON only.')


async def _get_digest_row(d: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT concept, digest_text FROM daily_web_digest WHERE date = ?", (d,))
        return await cur.fetchone()


@app.post("/api/daily/{d}/quiz")
async def daily_quiz_api(d: str):
    """Return the recall quiz for a day's concept (cached, or generated on first call).
    Ideal answers are withheld from the client — they're used server-side for grading."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT quiz_json, grade_json FROM study_recall WHERE date = ?", (d,))
        row = await cur.fetchone()
    if row and row["quiz_json"]:
        qs = json.loads(row["quiz_json"])
        return JSONResponse({"questions": [{"q": q.get("q", "")} for q in qs],
                             "graded": json.loads(row["grade_json"]) if row["grade_json"] else None})
    dig = await _get_digest_row(d)
    if not dig:
        return JSONResponse({"error": "No lesson for that date."}, status_code=404)
    user = f"CONCEPT: {dig['concept']}\n\nLESSON:\n{(dig['digest_text'] or '')[:2000]}\n\nWrite the quiz."
    try:
        qs = (_json_obj(await call_llm(_QUIZ_GEN_PROMPT, user, max_tokens=700, temperature=0.3)) or {}).get("questions", [])
    except Exception as e:
        return JSONResponse({"error": f"Quiz generation failed: {e}"}, status_code=400)
    qs = [q for q in qs if isinstance(q, dict) and q.get("q")][:3]
    if not qs:
        return JSONResponse({"error": "Couldn't generate a quiz — try regenerating the lesson."}, status_code=400)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO study_recall (date, concept, quiz_json, created_at) VALUES (?,?,?,?)
               ON CONFLICT(date) DO UPDATE SET concept=excluded.concept, quiz_json=excluded.quiz_json""",
            (d, dig["concept"], json.dumps(qs), now))
        await db.commit()
    return JSONResponse({"questions": [{"q": q["q"]} for q in qs], "graded": None})


@app.post("/api/daily/{d}/quiz/grade")
async def daily_quiz_grade_api(d: str, request: Request):
    try:
        answers = (await request.json()).get("answers", [])
    except Exception:
        answers = []
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT concept, quiz_json FROM study_recall WHERE date = ?", (d,))
        row = await cur.fetchone()
    if not row or not row["quiz_json"]:
        return JSONResponse({"error": "Generate the quiz first."}, status_code=400)
    qs = json.loads(row["quiz_json"])
    lines = [f"{i+1}. Q: {q.get('q','')}\n   Ideal: {q.get('ideal','')}\n   Learner: {answers[i] if i < len(answers) else '(blank)'}"
             for i, q in enumerate(qs)]
    try:
        graded = _json_obj(await call_llm(_QUIZ_GRADE_PROMPT, f"CONCEPT: {row['concept']}\n\n" + "\n".join(lines), max_tokens=900, temperature=0.0))
    except Exception as e:
        return JSONResponse({"error": f"Grading failed: {e}"}, status_code=400)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("UPDATE study_recall SET grade_json = ? WHERE date = ?", (json.dumps(graded), d))
        await db.commit()
    return JSONResponse(graded)


@app.post("/api/daily/{d}/feynman")
async def daily_feynman_api(d: str, request: Request):
    try:
        explanation = str((await request.json()).get("explanation", "")).strip()
    except Exception:
        explanation = ""
    if len(explanation) < 10:
        return JSONResponse({"error": "Write a couple of sentences explaining it in your own words."}, status_code=400)
    dig = await _get_digest_row(d)
    if not dig:
        return JSONResponse({"error": "No lesson for that date."}, status_code=404)
    try:
        res = _json_obj(await call_llm(_FEYNMAN_PROMPT, f"CONCEPT: {dig['concept']}\n\nLEARNER'S EXPLANATION:\n{explanation[:1500]}", max_tokens=700, temperature=0.2))
    except Exception as e:
        return JSONResponse({"error": f"Assessment failed: {e}"}, status_code=400)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO study_recall (date, concept, feynman_json, created_at) VALUES (?,?,?,?)
               ON CONFLICT(date) DO UPDATE SET feynman_json=excluded.feynman_json""",
            (d, dig["concept"], json.dumps(res), now))
        await db.commit()
    return JSONResponse(res)


# ── Spaced-repetition reviews + study tracking (streak, mastery) ──
@app.get("/api/study/reviews")
async def study_reviews_api():
    today = date.today().isoformat()
    allr = await srs_all()
    due = [r for r in allr if (r.get("next_due") or "9999") <= today]
    upcoming = [r for r in allr if (r.get("next_due") or "9999") > today]
    return JSONResponse({"due": due, "upcoming": upcoming[:10], "due_count": len(due)})


@app.get("/api/study/stats")
async def study_stats_api():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        dates = [r["date"] for r in await (await db.execute("SELECT date FROM daily_web_digest ORDER BY date DESC")).fetchall()]
        recalls = [dict(r) for r in await (await db.execute("SELECT concept, grade_json FROM study_recall WHERE grade_json IS NOT NULL")).fetchall()]
    # Streak: consecutive days up to today (or yesterday) with a lesson.
    dset = set(dates)
    streak = 0
    cur_day = date.today()
    if cur_day.isoformat() not in dset:
        cur_day = cur_day - dt.timedelta(days=1)  # allow "today not done yet"
    while cur_day.isoformat() in dset:
        streak += 1
        cur_day = cur_day - dt.timedelta(days=1)
    # Mastery from latest quiz score per concept.
    mastery = []
    scores = []
    for r in recalls:
        try:
            ov = json.loads(r["grade_json"]).get("overall")
        except Exception:
            ov = None
        if isinstance(ov, (int, float)):
            mastery.append({"concept": r["concept"], "score": int(ov)})
            scores.append(int(ov))
    mastery.sort(key=lambda m: m["score"])  # weakest first (what to review)
    reviews_due = len(await srs_due(date.today().isoformat()))
    return JSONResponse({
        "streak": streak,
        "concepts_learned": len(dset),
        "quizzed": len(scores),
        "avg_recall": round(sum(scores) / len(scores)) if scores else None,
        "mastery": mastery[:20],
        "reviews_due": reviews_due,
    })


@app.get("/api/study/flashcards/export")
async def study_flashcards_export_api():
    """Anki-ready flashcards (tab-separated: front<TAB>back) built from every recall quiz taken."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute("SELECT concept, quiz_json FROM study_recall WHERE quiz_json IS NOT NULL")).fetchall()
    lines = []
    for r in rows:
        try:
            for q in json.loads(r["quiz_json"]):
                front = (q.get("q") or "").replace("\t", " ").replace("\n", " ").strip()
                back = (q.get("ideal") or "").replace("\t", " ").replace("\n", " ").strip()
                if front and back:
                    lines.append(f"{front}\t{back}")
        except Exception:
            continue
    body = "\n".join(lines) or "No flashcards yet — take a recall quiz first."
    return Response(content=body, media_type="text/tab-separated-values",
                    headers={"Content-Disposition": 'attachment; filename="jarvis_flashcards.tsv"'})


@app.post("/api/study/weekly-recap")
async def study_weekly_recap_api():
    """Synthesize the week's concepts into a recap + a short combined quiz."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        rows = await (await db.execute("SELECT DISTINCT concept FROM daily_web_digest ORDER BY date DESC LIMIT 7")).fetchall()
    concepts = [r["concept"] for r in rows if r["concept"]]
    if not concepts:
        return JSONResponse({"error": "No lessons yet this week."}, status_code=400)
    sys = ("You are a study coach writing a weekly recap. Given the concepts a learner studied this "
           "week, write a tight synthesis connecting them, then 3 mixed recall questions. STRICT JSON only: "
           '{"recap":"<2-4 sentences tying the week together>","quiz":["q1","q2","q3"]} Output JSON only.')
    try:
        res = _json_obj(await call_llm(sys, "This week's concepts:\n- " + "\n- ".join(concepts), max_tokens=900, temperature=0.3))
    except Exception as e:
        return JSONResponse({"error": f"Recap failed: {e}"}, status_code=400)
    res["concepts"] = concepts
    return JSONResponse(res)


_EXPLAIN_PROMPT = (
    "You are a tutor who teaches VISUALLY, for someone who does NOT want to read paragraphs. Teach ONE "
    "concept so it can be UNDERSTOOD AT A GLANCE — short phrases, bullets, and a step-by-step flow, NEVER "
    "long prose. Think diagrams, not essays. Use 'you' language and real values. STRICT JSON only, no "
    "markdown fences:\n"
    '{"tldr":"ONE punchy sentence — what it is",'
    '"analogy":"one short vivid analogy",'
    '"flow":{"title":"short title","steps":[{"label":"stage name (1-3 words)","detail":"note, max 8 words"}]},'
    '"sections":[{"heading":"short heading","points":["a short scannable bullet, max 12 words"]}],'
    '"comparison":{"title":"short title","col_a":"label","col_b":"label","rows":[{"a":"short cell","b":"short cell"}]},'
    '"example":{"caption":"one line: what it shows","code":"a short runnable snippet (Python standard library ONLY, no pip/third-party, no network) OR empty string"},'
    '"key_points":["takeaway, max 10 words"],'
    '"pitfalls":["gotcha, max 10 words"],'
    '"quick_check":{"q":"an applied question (not a definition)","a":"answer in 1-2 sentences"}}'
    " RULES: flow = 3-7 stages showing how it works (e.g. Text -> Tokenizer -> Tokens -> Model -> Next token). "
    "Each section = heading + 2-4 SHORT bullets (never a paragraph). Use 'comparison' ONLY when a natural "
    "A-vs-B exists (else set it to null). Keep EVERYTHING short, concrete and scannable. Output JSON only.")


async def _get_cached_lesson(d: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT data FROM study_lessons WHERE date = ?", (d,))
        row = await cur.fetchone()
    if row and row["data"]:
        try:
            return json.loads(row["data"])
        except Exception:
            return None
    return None


@app.get("/api/daily/{d}/explain")
async def daily_explain_get_api(d: str):
    """Return the cached deep-dive explainer for a day (or null if it hasn't been generated yet)."""
    return JSONResponse({"explanation": await _get_cached_lesson(d)})


@app.post("/api/daily/{d}/explain")
async def daily_explain_gen_api(d: str, force: int = 0):
    """Generate (once) and cache a full structured explainer of the day's concept.
    Pass ?force=1 to rebuild it (e.g. to pick up a new explainer format)."""
    if not force:
        cached = await _get_cached_lesson(d)
        if cached:
            return JSONResponse({"explanation": cached})
    dig = await _get_digest_row(d)
    if not dig:
        return JSONResponse({"error": "No lesson for that date."}, status_code=404)
    user = (f"CONCEPT: {dig['concept']}\n\n"
            f"CONTEXT FROM TODAY'S BRIEFING:\n{(dig['digest_text'] or '')[:1200]}\n\n"
            "Write the explainer for this concept.")
    try:
        res = _json_obj(await call_llm(_EXPLAIN_PROMPT, user, max_tokens=1800, temperature=0.3))
    except Exception as e:
        return JSONResponse({"error": f"Explainer failed: {e}"}, status_code=400)
    if not res or not res.get("tldr"):
        return JSONResponse({"error": "Couldn't build the explainer — try again."}, status_code=400)
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            """INSERT INTO study_lessons (date, concept, data, created_at) VALUES (?,?,?,?)
               ON CONFLICT(date) DO UPDATE SET concept=excluded.concept, data=excluded.data""",
            (d, dig["concept"], json.dumps(res), now))
        await db.commit()
    return JSONResponse({"explanation": res})


@app.get("/api/daily/{d}/followups")
async def daily_followups_thread_api(d: str):
    """The persistent follow-up chat thread for a day's concept (chronological)."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT role, content, created_at FROM study_followups WHERE date = ? ORDER BY id ASC", (d,))
        turns = [dict(r) for r in await cur.fetchall()]
    return JSONResponse({"turns": turns})


@app.post("/api/daily/{d}/followup")
async def daily_followup_api(d: str, request: Request):
    """Ask a follow-up about the day's concept — a persistent, multi-turn chat thread. Each turn
    is grounded in the lesson AND the prior conversation, so questions can build on each other."""
    try:
        question = str((await request.json()).get("question", "")).strip()
    except Exception:
        question = ""
    if len(question) < 3:
        return JSONResponse({"error": "Ask a question."}, status_code=400)
    dig = await _get_digest_row(d)
    if not dig:
        return JSONResponse({"error": "No lesson for that date."}, status_code=404)
    # Pull the running thread so the tutor has conversational memory.
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT role, content FROM study_followups WHERE date = ? ORDER BY id ASC", (d,))
        prior = [dict(r) for r in await cur.fetchall()]

    def _flatten(role, content):
        # Assistant turns are stored as structured JSON — flatten to text for the history prompt.
        if role == "assistant":
            try:
                o = json.loads(content)
                return " ".join([o.get("answer", "")] + (o.get("points") or [])).strip() or content
            except Exception:
                return content
        return content

    sys = ("You are a tutor continuing a chat about ONE concept, for someone who prefers to SEE answers, "
           "NOT read paragraphs. Answer the latest question VISUALLY and short. STRICT JSON only, no fences:\n"
           '{"answer":"one short direct sentence",'
           '"points":["a short scannable bullet, max 14 words"],'
           '"flow":["stage","stage"],'
           '"code":"a short runnable python snippet OR empty string",'
           '"suggestions":["a natural next question, max 8 words"]}'
           " RULES: 'points' = 2-5 short bullets that carry the real answer (never a paragraph). 'flow' = "
           "3-6 stages ONLY when the answer is a process/pipeline, else []. 'code' = include ONLY if they "
           "ask to see/show code or how to implement it, else empty string; when present it MUST use only "
           "the Python standard library (no pip/third-party imports, no network) so it runs in a browser. "
           "'suggestions' = 2-3 natural "
           "next questions that build on THIS answer. Ground it in the lesson and conversation; resolve "
           "'that'/'it' from context; if they say 'explain more', go deeper with a fresh angle. Output JSON only.")
    history = "\n".join(f"{'Learner' if t['role'] == 'user' else 'Tutor'}: {_flatten(t['role'], t['content'])}" for t in prior[-8:])
    user = (f"CONCEPT: {dig['concept']}\n\nLESSON:\n{(dig['digest_text'] or '')[:1400]}\n\n"
            f"{('CONVERSATION SO FAR:' + chr(10) + history + chr(10) + chr(10)) if history else ''}"
            f"LATEST QUESTION: {question}")
    try:
        raw = await call_llm(sys, user, max_tokens=800, temperature=0.4)
        data = _json_obj(raw) or {}
    except Exception as e:
        return JSONResponse({"error": f"Answer failed: {e}"}, status_code=400)
    if not data.get("answer") and not data.get("points"):
        data = {"answer": (raw or "").strip(), "points": [], "flow": [], "code": "", "suggestions": []}
    reply = {
        "answer": str(data.get("answer", "")).strip(),
        "points": [str(p).strip() for p in (data.get("points") or []) if str(p).strip()][:5],
        "flow": [str(s).strip() for s in (data.get("flow") or []) if str(s).strip()][:6],
        "code": str(data.get("code", "") or "").strip(),
        "suggestions": [str(s).strip() for s in (data.get("suggestions") or []) if str(s).strip()][:3],
    }
    now = dt.datetime.now(dt.timezone.utc).isoformat()
    # Two separate execute() calls — the Turso (prod) connection wrapper has no executemany().
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO study_followups (date, concept, role, content, created_at) VALUES (?,?,?,?,?)",
            (d, dig["concept"], "user", question, now))
        await db.execute(
            "INSERT INTO study_followups (date, concept, role, content, created_at) VALUES (?,?,?,?,?)",
            (d, dig["concept"], "assistant", json.dumps(reply), now))
        await db.commit()
    return JSONResponse(reply)


@app.post("/api/daily/{d}/rewrite-code")
async def daily_rewrite_code_api(d: str, request: Request):
    """Rewrite a snippet so it RUNS in the browser sandbox — standard library only, no pip/network —
    while still teaching the same concept. Used by the 'Rewrite to run offline' button."""
    try:
        code = str((await request.json()).get("code", "")).strip()
    except Exception:
        code = ""
    if len(code) < 5:
        return JSONResponse({"error": "No code to rewrite."}, status_code=400)
    dig = await _get_digest_row(d)
    concept = dig["concept"] if dig else ""
    sys = ("Rewrite the given Python so it RUNS in a browser sandbox: Python STANDARD LIBRARY ONLY — no "
           "pip/third-party imports (no tiktoken, numpy, pandas, openai, requests, torch, transformers), no "
           "network, no file I/O. Keep it teaching the SAME concept; MOCK any external library/service with "
           "a small plain function (e.g. a fake tokenizer that splits on spaces). Keep it short with a few "
           "print() calls that show the idea. Return ONLY the raw Python code — no markdown fences, no prose.")
    user = f"CONCEPT: {concept}\n\nCODE TO REWRITE:\n{code[:2000]}"
    try:
        out = await call_llm(sys, user, max_tokens=800, temperature=0.2)
    except Exception as e:
        return JSONResponse({"error": f"Rewrite failed: {e}"}, status_code=400)
    out = re.sub(r'^```(?:python)?\s*|\s*```$', '', (out or "").strip(), flags=re.MULTILINE).strip()
    if not out:
        return JSONResponse({"error": "Couldn't rewrite it — try again."}, status_code=400)
    return JSONResponse({"code": out})


@app.post("/api/daily/{d}/check-code")
async def daily_check_code_api(d: str, request: Request):
    """Check the learner's code attempt against the concept + reference implementation (LLM review —
    no code is executed)."""
    try:
        code = str((await request.json()).get("code", "")).strip()
    except Exception:
        code = ""
    if len(code) < 5:
        return JSONResponse({"error": "Paste your code attempt."}, status_code=400)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT concept, reference_code FROM daily_web_digest WHERE date = ?", (d,))
        row = await cur.fetchone()
    if not row:
        return JSONResponse({"error": "No lesson for that date."}, status_code=404)
    sys = ("You are a code reviewer for a learner practising a concept. Given the CONCEPT, a REFERENCE "
           "implementation, and the learner's ATTEMPT, judge whether the attempt correctly implements the "
           "concept. Do NOT execute code — reason about it. STRICT JSON only: "
           '{"passed":<bool>,"feedback":"<what works, what to fix, 2-4 sentences>"} Output JSON only.')
    user = f"CONCEPT: {row['concept']}\n\nREFERENCE:\n{(row['reference_code'] or '')[:1200]}\n\nATTEMPT:\n{code[:1500]}"
    try:
        res = _json_obj(await call_llm(sys, user, max_tokens=500, temperature=0.0))
    except Exception as e:
        return JSONResponse({"error": f"Check failed: {e}"}, status_code=400)
    return JSONResponse({"passed": bool(res.get("passed")), "feedback": res.get("feedback", "")})


@app.post("/api/daily/{d}/save-note")
async def daily_save_note_api(d: str, request: Request):
    """Save into the Workspace notes / knowledge base. If a `text` highlight is sent, save just that
    (tagged to the concept); otherwise save the full lesson."""
    try:
        highlight = str((await request.json()).get("text", "")).strip()
    except Exception:
        highlight = ""
    dig = await _get_digest_row(d)
    if not dig:
        return JSONResponse({"error": "No lesson for that date."}, status_code=404)
    if highlight:
        title = f"✨ {dig['concept']} — highlight ({d})"
        body = f"{highlight}\n\n— from your {d} lesson on *{dig['concept']}*"
    else:
        title = f"📘 {dig['concept']} ({d})"
        body = dig["digest_text"] or ""
    note = await create_note(title=title, body=body)
    return JSONResponse({"ok": True, "note_id": note.get("id"), "kind": "highlight" if highlight else "lesson"})


@app.get("/api/study/notes/search")
async def study_notes_search_api(q: str = ""):
    """Search-back over saved lessons + highlights (and any workspace note). Simple ranked LIKE match
    across title + body — free, no embeddings."""
    q = (q or "").strip()
    if len(q) < 2:
        return JSONResponse({"results": []})
    like = f"%{q}%"
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            """SELECT id, title, body, updated_at FROM workspace_notes
               WHERE title LIKE ? OR body LIKE ?
               ORDER BY (CASE WHEN title LIKE ? THEN 0 ELSE 1 END), updated_at DESC LIMIT 15""",
            (like, like, like))
        rows = [dict(r) for r in await cur.fetchall()]
    # Build a short snippet around the first match for each hit.
    results = []
    ql = q.lower()
    for r in rows:
        body = r.get("body") or ""
        idx = body.lower().find(ql)
        if idx >= 0:
            start = max(0, idx - 60)
            snippet = ("…" if start > 0 else "") + body[start:idx + len(q) + 90].strip() + "…"
        else:
            snippet = body[:150].strip() + ("…" if len(body) > 150 else "")
        results.append({"id": r["id"], "title": r["title"], "snippet": snippet, "updated_at": r["updated_at"]})
    return JSONResponse({"results": results})


# ==========================================
# EXTERNAL CRON TRIGGERS (SCHEDULER_MODE=external)
# An outside scheduler (cron-job.org) wakes the sleeping free instance and hits these
# to drive the fixed jobs, so the service doesn't need to stay awake 24/7. Each is
# guarded by CLAUDE_CODE_TRIGGER_SECRET and kicks the job off in the background,
# returning 202 immediately so a cold-start + long job can't time out the cron request.
# ==========================================

_CRON_BG_TASKS: set = set()


def _cron_authorized(token: str) -> bool:
    # constant-time compare — these tokens are the only guard on the /cron/* job triggers
    return bool(CLAUDE_CODE_TRIGGER_SECRET) and _hmac.compare_digest(token, CLAUDE_CODE_TRIGGER_SECRET)


def _run_bg(coro):
    """Fire-and-forget an async job, keeping a strong ref so it isn't GC'd mid-flight."""
    task = asyncio.create_task(coro)
    _CRON_BG_TASKS.add(task)
    task.add_done_callback(_CRON_BG_TASKS.discard)


async def _run_managed_job(job_name: str, coro_factory, max_retries: int = 3):
    """
    Executes an async task factory with automatic retries, exponential backoff,
    detailed exception traceback logging, and push notification alerts on final failure.
    """
    import traceback
    attempt = 1
    delay = 5.0
    await _log_job(job_name, "started", f"Starting job execution (Attempt 1/{max_retries})", "info", "", attempt)
    
    while attempt <= max_retries:
        try:
            coro = coro_factory()
            await coro
            await _log_job(job_name, "success", f"Job completed successfully on attempt {attempt}", "info", "", attempt)
            return
        except Exception as e:
            tb_str = traceback.format_exc()
            is_final = (attempt == max_retries)
            severity = "error" if is_final else "warning"
            status = "failed" if is_final else "retrying"
            msg = f"Attempt {attempt}/{max_retries} failed: {str(e)}"
            
            await _log_job(job_name, status, msg, severity, tb_str, attempt)
            
            if is_final:
                try:
                    _store_notification(
                        f"🚨 CRITICAL ERROR: Background agent '{job_name}' failed after {max_retries} attempts.\n"
                        f"Error: {str(e)}",
                        category="system"
                    )
                except Exception as ne:
                    print(f"⚠️ Failed to dispatch failure notification: {ne}")
                return
            
            print(f"⚠️ Job '{job_name}' attempt {attempt} failed. Retrying in {delay}s...")
            await asyncio.sleep(delay)
            attempt += 1
            delay *= 3.0  # exponential backoff


def _run_bg_job(job_name: str, coro_factory, max_retries: int = 3):
    """Fires and forgets a background task with managed logging and retry policies."""
    _run_bg(_run_managed_job(job_name, coro_factory, max_retries))


def _cron_guard(token: str):
    """Returns a JSONResponse to short-circuit with, or None if authorized."""
    if not CLAUDE_CODE_TRIGGER_SECRET:
        return JSONResponse({"error": "CLAUDE_CODE_TRIGGER_SECRET not set"}, status_code=503)
    if not _cron_authorized(token):
        return JSONResponse({"error": "unauthorized"}, status_code=401)
    return None


@app.post("/cron/digest")
async def cron_digest(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("morning-digest", lambda: run_morning_digest())
    return JSONResponse({"status": "digest triggered"}, status_code=202)


@app.post("/cron/web-digest")
async def cron_web_digest(token: str = ""):
    """Web-first morning digest (no WhatsApp). Point your daily cron-job.org entry here instead
    of /cron/digest — it generates + stores + notifies in the console only."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("web-digest", lambda: generate_daily_web_digest())
    return JSONResponse({"status": "web digest triggered"}, status_code=202)


@app.post("/cron/inbox")
async def cron_inbox(token: str = ""):
    """Hourly tick: inbox check + fire any reminders/automations now due (one ping covers both)."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("inbox-check", lambda: check_inbox_and_notify(call_llm, send_whatsapp_chunked))
    fired = await _fire_due_reminders_and_automations()
    alert = await _check_mem_alert()
    selfheal = await _run_self_heal_check()
    return JSONResponse(
        {"status": "inbox triggered", "reminders_fired": fired,
         "mem_alert": alert, "self_heal": selfheal},
        status_code=202,
    )


@app.post("/cron/checkin")
async def cron_checkin(token: str = "", n: int = 1):
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("send_checkin_reminder", lambda: send_checkin_reminder(n))
    return JSONResponse({"status": f"checkin {n} triggered"}, status_code=202)


@app.post("/cron/weekly")
async def cron_weekly(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("weekly-report", lambda: send_weekly_report())
    # Fold pattern-learning upkeep into the weekly tick — keeps reply_style (which has no
    # per-message trigger) and every other category current without a separate cron job.
    _run_bg_job("learn-patterns", lambda: refresh_all_patterns(call_llm))
    return JSONResponse({"status": "weekly report triggered"}, status_code=202)


@app.post("/cron/job-scout")
async def _job_apply_hook(shown_matches):
    """Post-digest apply desk: tailor resume + draft cover note for strong matches, then notify
    (and, for high-scoring email-apply roles, queue/send per the user's approval setting). All
    thresholds, the daily cap, and the approval mode live in job_apply_agent."""
    try:
        prof = await get_job_profile()
    except Exception:
        prof = None
    await run_apply_prep(shown_matches, call_llm, notify_fn=send_whatsapp_chunked,
                         profile=prof, track_fn=add_application)


async def cron_job_scout(token: str = ""):
    """Daily job digest: Adzuna (+ Remotive) → dedup → rank → WhatsApp top matches.
    Fire once/day from cron-job.org (respects source rate limits + instance-hours)."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("job-scout", lambda: run_job_scout_digest(
        call_llm, send_whatsapp_chunked, track_fn=add_scout_application, apply_hook=_job_apply_hook))
    return JSONResponse({"status": "job scout digest triggered"}, status_code=202)


@app.post("/cron/scan-applications")
async def cron_scan_applications(token: str = ""):
    """Twice-daily (morning + evening): read Gmail and advance the Kanban board — application
    confirmations, interview invites, offers, rejections. Confident matches move automatically
    (with an undoable notification); ambiguous ones are parked for confirmation in Jobs."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("scan-applications", lambda: scan_application_emails(call_llm, _store_notification))
    return JSONResponse({"status": "application email scan triggered"}, status_code=202)


@app.post("/cron/company-watch")
async def cron_company_watch(token: str = ""):
    """Daily: scan Google News for hiring/funding/layoff signals about the companies on the
    active Kanban board AND prep interview briefs for upcoming calendar events. Fire once/day."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    from company_watch_agent import run_company_watch_and_prep
    _run_bg_job("company-watch", lambda: run_company_watch_and_prep(call_llm))
    return JSONResponse({"status": "company watch + interview prep triggered"}, status_code=202)


@app.post("/api/company-watch/run")
async def api_company_watch_run():
    """Manual on-demand run from the console (news scan + interview prep; returns the text)."""
    from company_watch_agent import run_company_watch_and_prep
    digest = await run_company_watch_and_prep(call_llm)
    return JSONResponse({"ok": True, "result": digest})


@app.post("/api/company-watch/interview-prep")
async def api_company_watch_prep():
    """Manual: generate interview-prep briefs for upcoming calendar events matching tracked companies."""
    from company_watch_agent import run_interview_prep
    result = await run_interview_prep(call_llm)
    return JSONResponse({"ok": True, "result": result})


@app.get("/api/company-watch/news")
async def api_company_watch_news(company: str = "", limit: int = 50):
    """Relevant stored signals, newest first — optionally scoped to one company."""
    from company_watch_agent import list_company_news
    return JSONResponse(await list_company_news(company.strip() or None, limit))


@app.post("/cron/bills")
async def cron_bills(token: str = ""):
    """Daily: warn about bills/deadlines due within their notify window (once per occurrence)."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    sent = await check_bills_and_notify(_store_notification)
    await _log_job("bills-check", "completed", f"sent {sent} bill alert(s)")
    return JSONResponse({"status": "bills checked", "alerts": sent}, status_code=202)


@app.post("/cron/followups")
async def cron_followups(token: str = ""):
    """Daily: auto-draft follow-ups for stale applications (never sends — readies for review)."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    res = await _auto_followups_job()
    await _log_job("auto-followups", "completed", f"drafted {res.get('drafted', 0)}")
    return JSONResponse({"status": "followups drafted", **res}, status_code=202)


@app.post("/cron/influencer-digest")
async def cron_influencer_digest(token: str = ""):
    """Daily: scrape watched influencer pages and compile summarized updates."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    from influencer_agent import run_influencer_watcher_digest
    _run_bg_job("influencer-digest", lambda: run_influencer_watcher_digest(call_llm))
    return JSONResponse({"status": "influencer digest triggered"}, status_code=202)



@app.post("/cron/learn-patterns")
async def cron_learn_patterns(token: str = ""):
    """Recompute all learned-pattern categories from current history. Independently callable
    (e.g. an on-demand refresh); also runs inside /cron/weekly. Each category self-guards on
    its minimum sample count, so this is safe to call anytime."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("learn-patterns", lambda: refresh_all_patterns(call_llm))
    return JSONResponse({"status": "pattern learning refresh triggered"}, status_code=202)


@app.post("/cron/reminders-due")
async def cron_reminders_due(token: str = ""):
    """Fire user reminders/automations whose time has arrived. Idempotent: 'once' items
    dedup via their status, recurring via cron_fire_log. Safe to call as often as you like."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    fired = await _fire_due_reminders_and_automations()
    return JSONResponse({"status": "ok", "fired": fired})


async def _already_fired_today(scope: str, item_id: int, day: str) -> bool:
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT 1 FROM cron_fire_log WHERE scope=? AND item_id=? AND fired_on=?",
            (scope, item_id, day),
        ) as cur:
            return (await cur.fetchone()) is not None


async def _mark_fired_today(scope: str, item_id: int, day: str):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR IGNORE INTO cron_fire_log (scope, item_id, fired_on) VALUES (?, ?, ?)",
            (scope, item_id, day),
        )
        await db.commit()


def _recurring_due_now(row: dict, now_ist) -> bool:
    """True if a daily/weekly item's slot matches the current IST hour (within-the-hour
    granularity — we poll hourly). Weekly also matches the weekday."""
    if row.get("hour") is None or int(row["hour"]) != now_ist.hour:
        return False
    if row["kind"] == "weekly":
        dow = (row.get("day_of_week") or "").strip().lower()[:3]
        if dow and dow != now_ist.strftime("%a").lower():
            return False
    return True


async def _fire_due_reminders_and_automations() -> int:
    """Send any reminders / dispatch any automations whose time has arrived. Returns count fired."""
    now_ist = dt.datetime.now(ZoneInfo("Asia/Kolkata"))
    now_naive = now_ist.replace(tzinfo=None)
    today = now_ist.date().isoformat()
    fired = 0

    # ---- Reminders ----
    try:
        for row in await get_active_reminders():
            kind = row.get("kind")
            try:
                if kind == "once":
                    run_at = dt.datetime.fromisoformat(row["run_at"]).replace(tzinfo=None)
                    if run_at <= now_naive:
                        send_whatsapp_chunked(f"⏰ *Reminder:* {row['text']}")
                        await mark_reminder_fired(row["id"])
                        fired += 1
                elif kind in ("daily", "weekly") and _recurring_due_now(row, now_ist):
                    if not await _already_fired_today("reminder", row["id"], today):
                        send_whatsapp_chunked(f"⏰ *Reminder:* {row['text']}")
                        await _mark_fired_today("reminder", row["id"], today)
                        fired += 1
            except Exception as e:
                print(f"⚠️ [cron] reminder {row.get('id')} failed: {e}")
    except Exception as e:
        print(f"⚠️ [cron] reminder poll failed: {e}")

    # ---- Automations ----
    try:
        for row in await get_active_automations():
            kind = row.get("kind")
            try:
                due = False
                if kind == "once":
                    run_at = dt.datetime.fromisoformat(row["run_at"]).replace(tzinfo=None)
                    due = run_at <= now_naive
                elif kind in ("daily", "weekly"):
                    due = _recurring_due_now(row, now_ist) and not await _already_fired_today("automation", row["id"], today)
                if due:
                    await dispatch_automation(row["action_type"], row["payload"])
                    if kind == "once":
                        await mark_automation_fired(row["id"])
                    else:
                        await _mark_fired_today("automation", row["id"], today)
                    fired += 1
            except Exception as e:
                print(f"⚠️ [cron] automation {row.get('id')} failed: {e}")
    except Exception as e:
        print(f"⚠️ [cron] automation poll failed: {e}")

    return fired


# ==========================================
# OPS FEATURES — health dashboard, WhatsApp alert thresholds, daily status
# briefing, CSV log export. All admin endpoints reuse _cron_guard (token =
# CLAUDE_CODE_TRIGGER_SECRET) since this is a single-user app — no real RBAC needed.
# ==========================================

DEFAULT_MEM_ALERT_MB = 450  # Render free tier kills around 512MB; warn before that.


def _db_status() -> str:
    try:
        conn = _get_db_conn()
        conn.execute("SELECT 1")
        conn.close()
        return "ok"
    except Exception:
        return "down"


def _uptime_str() -> str:
    secs = int(time.time() - APP_START_TIME)
    d, rem = divmod(secs, 86400)
    h, rem = divmod(rem, 3600)
    m, _ = divmod(rem, 60)
    parts = []
    if d:
        parts.append(f"{d}d")
    if h:
        parts.append(f"{h}h")
    parts.append(f"{m}m")
    return " ".join(parts)


async def _recent_job_logs(limit: int = 10) -> list:
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT job_name, status, message, created_at FROM job_logs ORDER BY id DESC LIMIT ?",
            (limit,),
        ) as cur:
            return [dict(r) for r in await cur.fetchall()]


async def _health_snapshot() -> dict:
    rss = _rss_mb()
    threshold = float(get_setting("mem_alert_threshold_mb", str(DEFAULT_MEM_ALERT_MB)))
    return {
        "uptime": _uptime_str(),
        "rss_mb": round(rss, 1),
        "mem_alert_threshold_mb": threshold,
        "mem_status": "ok" if rss < threshold else "HIGH",
        "scheduler_mode": SCHEDULER_MODE,
        "db": _db_status(),
        "recent_jobs": await _recent_job_logs(10),
    }


# ---- 1. Health dashboard (JSON + a no-auto-poll HTML snapshot) ----
@app.get("/health/status")
async def health_status(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    return await _health_snapshot()


@app.get("/health/dashboard", response_class=HTMLResponse)
async def health_dashboard(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    s = await _health_snapshot()
    mem_color = "#16a34a" if s["mem_status"] == "ok" else "#dc2626"
    db_color = "#16a34a" if s["db"] == "ok" else "#dc2626"
    rows = "".join(
        f"<tr><td>{j['created_at']}</td><td>{j['job_name']}</td>"
        f"<td>{j['status']}</td><td>{(j.get('message') or '')[:80]}</td></tr>"
        for j in s["recent_jobs"]
    ) or "<tr><td colspan=4>No job activity logged.</td></tr>"
    # Snapshot only — a manual Refresh link, NOT auto-polling, so viewing the
    # dashboard doesn't keep the free instance awake.
    html = f"""<!DOCTYPE html><html><head><meta charset=utf-8>
<title>Engine Health</title><style>
body{{font-family:-apple-system,sans-serif;background:#0b1120;color:#e5e7eb;padding:24px;max-width:760px;margin:auto}}
.card{{background:#111827;border:1px solid #1f2937;border-radius:12px;padding:16px;margin-bottom:14px}}
.val{{font-size:26px;font-weight:700}} .sub{{color:#9ca3af;font-size:13px}}
table{{width:100%;border-collapse:collapse;font-size:13px}} td,th{{text-align:left;padding:6px 8px;border-bottom:1px solid #1f2937}}
a.btn{{display:inline-block;background:#2563eb;color:#fff;padding:8px 14px;border-radius:8px;text-decoration:none}}
</style></head><body>
<h2>🖥️ Engine Health</h2>
<div class=card><div class=sub>Memory (RSS)</div><div class=val style='color:{mem_color}'>{s['rss_mb']} MB</div>
<div class=sub>alert at {s['mem_alert_threshold_mb']:.0f} MB · status {s['mem_status']}</div></div>
<div class=card><div class=sub>Database</div><div class=val style='color:{db_color}'>{s['db']}</div></div>
<div class=card><div class=sub>Uptime</div><div class=val>{s['uptime']}</div>
<div class=sub>scheduler: {s['scheduler_mode']}</div></div>
<div class=card><div class=sub>Recent jobs</div>
<table><tr><th>When</th><th>Job</th><th>Status</th><th>Message</th></tr>{rows}</table></div>
<a class=btn href="/health/dashboard?token={token}">🔄 Refresh</a>
&nbsp;<a class=btn href="/export/job-logs?token={token}" style='background:#374151'>⬇ job_logs.csv</a>
&nbsp;<a class=btn href="/export/chat-history?token={token}" style='background:#374151'>⬇ chat_history.csv</a>
</body></html>"""
    return HTMLResponse(html)


# ---- 2. WhatsApp alert thresholds ----
async def _check_mem_alert() -> dict:
    """Alert on WhatsApp when RSS crosses the configured threshold. Fires at most once
    per day; auto-rearms once memory recovers below the threshold."""
    rss = _rss_mb()
    threshold = float(get_setting("mem_alert_threshold_mb", str(DEFAULT_MEM_ALERT_MB)))
    today = dt.date.today().isoformat()
    last_fired = get_setting("mem_alert_fired_date", "")
    if rss >= threshold:
        if last_fired != today:
            send_whatsapp_chunked(
                f"🚨 *Memory alert:* engine RSS is {rss:.0f}MB, at/over your "
                f"{threshold:.0f}MB threshold (Render kills ~512MB). Keep an eye out."
            )
            save_setting("mem_alert_fired_date", today)
            return {"alerted": True, "rss_mb": round(rss, 1)}
    elif last_fired:
        save_setting("mem_alert_fired_date", "")  # recovered — re-arm
    return {"alerted": False, "rss_mb": round(rss, 1)}


@app.post("/cron/health-check")
async def cron_health_check(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    return JSONResponse(await _check_mem_alert())


# ---- 2b. Self-heal: detect issues, surface them, hand over a ready-to-run fix command ----
# This NEVER edits code on its own. It detects problems (DB down, recently failed jobs),
# WhatsApps Madan a diagnosis, and gives him a copy-paste 'claude code:' command that drops
# straight into the existing propose -> approve -> execute flow (human-gated). Memory has its
# own dedicated alert (_check_mem_alert), so it's excluded here to avoid double-pinging.
async def _detect_health_issues() -> list:
    issues = []
    if _db_status() != "ok":
        issues.append("Database is unreachable.")
    try:
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            async with db.execute(
                "SELECT job_name, message, created_at FROM job_logs "
                "WHERE LOWER(status) IN ('failed','error') "
                "AND created_at >= datetime('now','-6 hours') "
                "ORDER BY id DESC LIMIT 5"
            ) as cur:
                for r in await cur.fetchall():
                    issues.append(f"Job '{r['job_name']}' failed: {(r['message'] or '')[:80]}")
    except Exception as e:
        issues.append(f"Couldn't read job logs: {e}")
    return issues


async def _run_self_heal_check() -> dict:
    """Detect → surface → propose. Dedups so the same issue set isn't re-sent the same day."""
    issues = await _detect_health_issues()
    if not issues:
        if get_setting("selfheal_last_sig", ""):
            save_setting("selfheal_last_sig", "")  # cleared → next occurrence re-notifies
        return {"issues": 0, "notified": False}

    sig = dt.date.today().isoformat() + "||" + " | ".join(issues)
    if get_setting("selfheal_last_sig", "") == sig:
        return {"issues": len(issues), "notified": False}  # already reported this exact set today
    save_setting("selfheal_last_sig", sig)

    if not SAFE_MODE and not CLAUDE_CODE_TRIGGER_SECRET:
        # Can't hand over a working command without the secret; still surface the diagnosis.
        cc_line = "(set CLAUDE_CODE_TRIGGER_SECRET to enable one-tap investigation)"
    else:
        task = "investigate and propose a fix for these engine issues: " + " | ".join(issues)
        cc_line = (
            f"To investigate + get a proposed fix you approve, reply (start the bridge first "
            f"with start-bridge):\n`claude code: {CLAUDE_CODE_TRIGGER_SECRET} {task[:300]}`"
        )
    body = (
        "🩺 *Engine self-check found issues:*\n"
        + "\n".join(f"• {i}" for i in issues)
        + "\n\n" + cc_line
    )
    send_whatsapp_chunked(body)
    return {"issues": len(issues), "notified": True}


@app.post("/cron/self-check")
async def cron_self_check(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    return JSONResponse(await _run_self_heal_check())


# ---- 3. AI-generated daily status briefing ----
async def generate_status_briefing() -> str:
    jobs = await _recent_job_logs(30)
    rss = _rss_mb()
    log_text = "\n".join(
        f"{j['created_at']} · {j['job_name']} · {j['status']} · {(j.get('message') or '')[:120]}"
        for j in jobs
    ) or "No job activity logged in the recent window."
    return await call_llm(
        "You are JARVIS giving Madan a short daily server-status briefing. 3-5 plain-text "
        "lines, composed and lightly witty — never a templated bot. Cover overall health, "
        "memory vs the ~512MB Render ceiling, any failed jobs, and anything noteworthy. "
        "End with exactly one of: ✅ All good | ⚠️ Watch this.",
        f"Engine RSS: {rss:.0f}MB. Scheduler mode: {SCHEDULER_MODE}. Recent job logs:\n{log_text}",
        max_tokens=320,
    )


async def _send_status_briefing():
    text = await generate_status_briefing()
    send_whatsapp_chunked(f"🖥️ *Daily Status Briefing*\n\n{text}")


@app.post("/cron/status-briefing")
async def cron_status_briefing(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg(_send_status_briefing())
    return JSONResponse({"status": "status briefing triggered"}, status_code=202)


# ---- 4. CSV log export (job_logs + chat_history, separate files) ----
def _csv_response(columns: list, rows: list, filename: str) -> Response:
    import csv
    import io
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(columns)
    writer.writerows(rows)
    return Response(
        content=buf.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@app.get("/export/job-logs")
async def export_job_logs(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    cols = ["id", "job_name", "status", "message", "created_at"]
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(f"SELECT {', '.join(cols)} FROM job_logs ORDER BY id DESC") as cur:
            rows = await cur.fetchall()
    return _csv_response(cols, rows, "job_logs.csv")


@app.get("/export/chat-history")
async def export_chat_history(token: str = ""):
    if (deny := _cron_guard(token)) is not None:
        return deny
    cols = ["id", "role", "content", "timestamp"]
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(f"SELECT {', '.join(cols)} FROM chat_history ORDER BY id DESC") as cur:
            rows = await cur.fetchall()
    return _csv_response(cols, rows, "chat_history.csv")


# ==========================================
# ONBOARDING HANDLER
# ==========================================
async def handle_onboarding(incoming_message: str) -> str:
    """
    Manages a 3-step onboarding conversation.
    Returns the reply message to send back to the user.
    """
    msg = incoming_message.strip().upper()
    step = int(get_setting("onboarding_step", "0"))

    # ── STEP 0: Brand new — send welcome + domain question ──
    if step == 0:
        save_setting("onboarding_step", "1")
        return (
            "👋 *Welcome to your personal learning engine!*\n\n"
            "I'll send you one concept to learn every day, a quiz, and a mini project — "
            "all tailored to you.\n\n"
            "First, pick your learning domain:\n\n"
            "A) 💻 Technology & Programming\n"
            "B) 🤖 Data Science & AI\n"
            "C) 🔐 Cybersecurity\n"
            "D) 💼 Business & Finance\n"
            "E) 🔬 Science & Mathematics\n"
            "F) 📜 History & Philosophy\n"
            "G) 📣 Marketing & Product\n"
            "H) ✏️ Other — type your own"
        )

    # ── STEP 1: Waiting for domain answer ──
    if step == 1:
        domain_map = {
            "A": ("technology", "Technology & Programming"),
            "B": ("data_science", "Data Science & AI"),
            "C": ("cybersecurity", "Cybersecurity"),
            "D": ("business", "Business & Finance"),
            "E": ("science", "Science & Mathematics"),
            "F": ("philosophy", "History & Philosophy"),
            "G": ("marketing", "Marketing & Product"),
        }
        if msg in domain_map:
            domain, domain_display = domain_map[msg]
        else:
            domain = incoming_message.strip().lower().replace(" ", "_")
            domain_display = incoming_message.strip().title()

        save_setting("domain", domain)
        save_setting("domain_display", domain_display)
        save_setting("onboarding_step", "2")
        return (
            f"Got it — *{domain_display}* 👍\n\n"
            "Now pick your skill level:\n\n"
            "A) 🌱 Beginner — just starting out\n"
            "B) 📈 Intermediate — know the basics\n"
            "C) 🔥 Advanced — want deep content\n"
            "D) ⚡ Pro — challenge me hard"
        )

    # ── STEP 2: Waiting for skill level answer ──
    if step == 2:
        skill_map = {
            "A": "beginner",
            "B": "intermediate",
            "C": "advanced",
            "D": "pro"
        }
        skill_level = skill_map.get(msg, "intermediate")
        save_setting("skill_level", skill_level)
        save_setting("onboarding_step", "3")
        domain_display = get_setting("domain_display", "your chosen domain")
        return (
            f"Perfect! Last question 🎯\n\n"
            f"What specific topic within *{domain_display}* do you want to focus on?\n\n"
            f"Be specific: 'neural networks', 'stoic philosophy', 'options trading'\n"
            f"Or reply *surprise me* and I'll pick something great every day 🎲"
        )

    # ── STEP 3: Waiting for topic answer ──
    if step == 3:
        if incoming_message.strip().lower() == "surprise me":
            topic = ""
            topic_display = "Surprise me daily 🎲"
        else:
            topic = incoming_message.strip()
            topic_display = topic

        save_setting("topic", topic)
        save_setting("onboarded", "1")
        save_setting("onboarding_step", "4")
        domain_display = get_setting("domain_display", "your domain")
        skill_level = get_setting("skill_level", "intermediate")
        return (
            f"✅ *You're all set!*\n\n"
            f"📚 Domain: {domain_display}\n"
            f"📊 Level: {skill_level.capitalize()}\n"
            f"🎯 Topic: {topic_display}\n\n"
            f"Your first digest arrives tomorrow morning.\n"
            f"Until then, try:\n\n"
            f"*digest* — get today's learning now\n"
            f"*quiz* — take a quiz\n"
            f"*EXPLAIN: anything* — instant explanation\n"
            f"*SET TOPIC: anything* — change your topic\n"
            f"*HELP* — see all commands\n\n"
            f"Welcome aboard! 🚀"
        )

    # Should not reach here
    return "Type *RESET* to start setup again."


# ==========================================
# 14. WHATSAPP WEBHOOK
# ==========================================
async def process_message(user_message: str, source: str = "whatsapp") -> str:
    """
    Core intent-routing logic, shared by the WhatsApp webhook and the /chat-message web UI.
    Returns the reply text, or None when the block already sent its own message(s) directly
    (e.g. digest/weekly-report, which dispatch asynchronously and have nothing left to return).
    """
    user_message_clean = user_message.lower().strip().replace("’", "'")
    loop = asyncio.get_running_loop()
    today = date.today().isoformat()

    print(f"📥 [Incoming]: '{user_message_clean}'")

    def send_whatsapp(msg):
        try:
            send_whatsapp_chunked(msg)
        except Exception as e:
            print(f"❌ Twilio dispatch failed: {e}")

    async def advance_email_queue():
        """Move to the next queued priority draft, or send a wrap-up if none are left."""
        activated = await activate_next_draft(send_whatsapp)
        if not activated:
            medium = await get_medium_count()
            low = await get_low_count()
            msg = f"✅ *All priority emails handled.* {medium} medium, {low} low priority email(s) also came in."
            await log_chat_message("assistant", msg)
            send_whatsapp(msg)

    # =========================================================================
    # ONBOARDING GATE — runs before every other command
    # =========================================================================
    # RESET is always allowed, even mid-onboarding
    if user_message_clean == "reset":
        save_setting("onboarded", "0")
        save_setting("onboarding_step", "0")
        save_setting("domain", "")
        save_setting("domain_display", "")
        save_setting("skill_level", "")
        save_setting("topic", "")
        return "♻️ Profile reset! Send any message to start fresh."

    if source == "whatsapp":
        onboarded = get_setting("onboarded", "0")
        if onboarded != "1":
            return await handle_onboarding(user_message)

    # ── Normal command processing continues below ──

    # =========================================================================
    # CLAUDE CODE BRIDGE — live interactive session (modal). Checked before
    # every other command: once a session is active, every message except the
    # end-session phrase routes straight to the live `claude` process with full
    # permissions, the same way typing into the `claude` CLI itself works —
    # you have to exit before anything else is reachable. "cancel" is
    # deliberately NOT overloaded here, since during a live session you might
    # legitimately tell the agent itself to cancel/undo something.
    # =========================================================================
    if user_message_clean in ["end claude code session", "exit claude code session", "exit claude code"]:
        await log_chat_message("user", user_message)
        _cc_session = await get_active_cc_session()
        if not _cc_session:
            msg = "No live Claude Code session is active."
            await log_chat_message("assistant", msg)
            return msg
        await update_cc_session(_cc_session["id"], status="ended")
        msg = "🔴 Live Claude Code session ended."
        await log_chat_message("assistant", msg)
        return msg

    _active_cc_session = await get_active_cc_session()
    if _active_cc_session:
        await log_chat_message("user", user_message)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO local_command_queue (command_type, payload, source, cc_session_row_id) VALUES (?, ?, ?, ?)",
                (
                    "claude_code_chat",
                    json.dumps({"message": user_message, "resume_id": _active_cc_session["cc_session_id"]}),
                    source,
                    _active_cc_session["id"],
                )
            )
            await db.commit()
        if source == "whatsapp":
            return None
        return "🤖 working..."

    # =========================================================================
    # WEB UI — natural greeting (bypasses the learning-engine help menu)
    # =========================================================================
    if source == "web" and user_message_clean in [
        "hi", "hello", "hey", "how are you",
        "hello jarvis", "hi jarvis", "hey jarvis",
        "hello jarvis, how are you", "how are you doing"
    ]:
        await log_chat_message("user", user_message)
        hour = dt.datetime.now().hour
        time_of_day = "morning" if hour < 12 else "afternoon" if hour < 17 else "evening"
        greeting_msg = (
            f"Hey Madan! Good {time_of_day}. I'm running well — "
            f"all systems online. What do you need help with? "
            f"I can check your emails, set reminders, research something, "
            f"or just have a conversation."
        )
        await log_chat_message("assistant", greeting_msg)
        return greeting_msg

    # =========================================================================
    # GREETING / HELP MENU
    # =========================================================================
    if user_message_clean in ["hi", "hello", "hey", "start", "help", "menu", "commands"]:
        await log_chat_message("user", user_message)
        help_msg = (
            "📖 *Commands*\n\n"
            "Most of this works in plain English — just say what you mean. The lines below "
            "are examples, not exact syntax you have to match.\n\n"
            "*🧠 Memory*\n"
            "- \"Remember that...\" — save a fact\n"
            "- \"What's my...?\" — recall one specific thing\n"
            "- \"What have you remembered?\" — list everything saved\n\n"
            "*⏰ Reminders*\n"
            "- \"Remind me to... at...\" — set a one-time or recurring reminder\n"
            "- \"Show me my reminders\" — list active reminders\n\n"
            "*📧 Email*\n"
            "- \"Draft an email to x@example.com about...\" — compose (add \"save it as a draft\" "
            "instead of sending right away)\n"
            "- *SEND* / *EDIT EMAIL: ...* / *CANCEL* — manage a pending draft\n\n"
            "*📅 Calendar*\n"
            "- \"What's on my calendar today?\" / \"Am I free at 3pm tomorrow?\"\n"
            "- \"Put a meeting on my calendar tomorrow at 3pm\" — create an event\n\n"
            "*📚 Learning*\n"
            "*digest* — Today's learning now\n"
            "*quiz* — Start a quiz\n"
            "*EXPLAIN: topic* — Explain anything\n"
            "*SET TOPIC: topic* — Change your focus\n"
            "*too easy* — Make content harder\n"
            "*too hard* — Make content easier\n"
            "*bad content* — Flag bad quality\n"
            "*wrong answer* — Flag wrong quiz answer\n"
            "*RESET* — Start setup again\n"
            "*done* — Mark today complete\n"
            "*skip* — Skip quiz question\n"
            "*end quiz* — End quiz early"
        )
        return help_msg

    # =========================================================================
    # WEATHER — on-demand weather query
    # =========================================================================
    if any(phrase in user_message_clean for phrase in [
        "weather", "temperature", "climate today",
        "temp today", "current temp", "what's the temp", "whats the temp",
    ]):
        await log_chat_message("user", user_message)
        weather_msg = await get_weather(call_llm)
        await log_chat_message("assistant", weather_msg)
        return weather_msg

    # =========================================================================
    # LOCAL BRIDGE — queue a command for local_bridge.py (runs on the Mac)
    # and wait for it to poll, execute, and post the result back.
    # Same process as the /local-queue routes above, so this reads/writes
    # local_command_queue directly instead of calling its own HTTP routes.
    #
    # WhatsApp's webhook has a ~15s ack timeout — blocking incoming_whatsapp_
    # reply() for that long risks Twilio retrying and double-queuing the
    # command. So on WhatsApp we queue it, ack immediately (return None,
    # mirrors the digest/email-queue blocks), and poll in a background task
    # that self-sends the result when ready. The web chat UI has no such
    # timeout, so it keeps the original inline blocking wait.
    # =========================================================================
    if user_message_clean.startswith("show folder") or \
       user_message_clean.startswith("list folder") or \
       user_message_clean in ["show my project", "list my files", "show project folder"]:
        await log_chat_message("user", user_message)

        # Optional folder argument after the trigger phrase, e.g. "list folder Documents"
        # or "show folder /Users/madansaidaram/Desktop" — bare phrases (or the fixed
        # "show my project"-style ones) fall back to the project folder as before.
        # local_bridge.py's own ALLOWED_FOLDERS check still rejects anything outside
        # the whitelist (Desktop, Documents, Daily_AI_updates) — this just lets you
        # pick which of those to browse instead of always getting the project folder.
        folder_arg = ""
        if user_message_clean.startswith("show folder"):
            folder_arg = user_message[len("show folder"):].strip().lstrip(":").strip()
        elif user_message_clean.startswith("list folder"):
            folder_arg = user_message[len("list folder"):].strip().lstrip(":").strip()
        if folder_arg:
            target_folder = folder_arg if folder_arg.startswith("/") else f"/Users/madansaidaram/{folder_arg}"
        else:
            target_folder = "/Users/madansaidaram/Desktop/Daily_AI_updates"

        command_id = await _queue_local_command("list_folder", target_folder)
        return await _deliver_local_result(command_id, source)

    # ---- READ FILE — "read file <path>" (relative paths resolve under the
    # project folder; local_bridge.py's own allowlist/extension checks still apply) ----
    if user_message_clean.startswith("read file") or \
       user_message_clean.startswith("show file") or \
       user_message_clean.startswith("open file"):
        await log_chat_message("user", user_message)
        file_arg = ""
        for prefix in ("read file", "show file", "open file"):
            if user_message_clean.startswith(prefix):
                file_arg = user_message[len(prefix):].strip().lstrip(":").strip()
                break
        if not file_arg:
            msg = "Which file? e.g. *read file local_bridge.py*"
            await log_chat_message("assistant", msg)
            return msg
        target_file = file_arg if file_arg.startswith("/") else f"/Users/madansaidaram/Desktop/Daily_AI_updates/{file_arg}"
        command_id = await _queue_local_command("read_file", target_file)
        return await _deliver_local_result(command_id, source)

    # ---- SEARCH FILES — "search files <name>" (matches by filename, project folder only) ----
    if user_message_clean.startswith("search files") or \
       user_message_clean.startswith("search file") or \
       user_message_clean.startswith("find files") or \
       user_message_clean.startswith("find file"):
        await log_chat_message("user", user_message)
        query_arg = ""
        for prefix in ("search files", "search file", "find files", "find file"):
            if user_message_clean.startswith(prefix):
                query_arg = user_message[len(prefix):].strip().lstrip(":").strip()
                break
        if not query_arg:
            msg = "What filename should I search for? e.g. *search files reminder*"
            await log_chat_message("assistant", msg)
            return msg
        command_id = await _queue_local_command("search_files", query_arg)
        return await _deliver_local_result(command_id, source)

    # ---- SYSTEM INFO — "system info" (Mac OS version + disk usage) ----
    if user_message_clean in ["system info", "mac info", "machine info", "system status"]:
        await log_chat_message("user", user_message)
        command_id = await _queue_local_command("system_info", "")
        return await _deliver_local_result(command_id, source)

    # ---- RECENT FILES — "recent files" (last 10 modified files in the project folder) ----
    if user_message_clean in ["recent files", "recently modified files", "show recent files", "what files changed"]:
        await log_chat_message("user", user_message)
        command_id = await _queue_local_command("list_recent_files", "")
        return await _deliver_local_result(command_id, source)

    # ---- MEMORY ALERT THRESHOLD — "set memory alert <MB>" / "show alerts" / "health" ----
    if user_message_clean.startswith("set memory alert") or \
       user_message_clean.startswith("set mem alert") or \
       user_message_clean.startswith("set memory threshold"):
        await log_chat_message("user", user_message)
        m = re.search(r"(\d+)", user_message)
        if not m:
            msg = "Give me a number in MB — e.g. *set memory alert 420* ⚡ Needs your input"
        else:
            save_setting("mem_alert_threshold_mb", m.group(1))
            msg = f"Memory alert threshold set to {m.group(1)}MB — I'll ping you here if the engine crosses it. ✅ Done"
        await log_chat_message("assistant", msg)
        return msg

    if user_message_clean in ["alerts", "show alerts", "alert settings", "health", "engine health", "server health"]:
        await log_chat_message("user", user_message)
        s = await _health_snapshot()
        last = s["recent_jobs"][0] if s["recent_jobs"] else None
        last_job = f"{last['job_name']} ({last['status']})" if last else "none yet"
        msg = (
            f"🖥️ *Engine health*\n"
            f"Memory: {s['rss_mb']}MB / alert {s['mem_alert_threshold_mb']:.0f}MB ({s['mem_status']})\n"
            f"DB: {s['db']} · Uptime: {s['uptime']} · Scheduler: {s['scheduler_mode']}\n"
            f"Last job: {last_job} 📌 FYI only"
        )
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # CLAUDE CODE BRIDGE — passphrase-gated trigger for a real Claude Code agent
    # on Madan's Mac, via local_bridge.py. Literal exact-match parsing (not the
    # AI intent classifier) — same reasoning as the email/calendar approval
    # commands: this is security-sensitive and needs predictable, deterministic
    # matching, not an LLM's best guess.
    #
    # Two-phase by design: this block ONLY EVER queues a read-only
    # claude_code_propose task (--permission-mode plan in local_bridge.py —
    # no file edits, no bash writes, no git). Real execution only happens via
    # the explicit "approve claude code" command further down, after Madan
    # has reviewed the proposed plan. A leaked passphrase alone can only make
    # Claude Code *look* at the codebase and propose, never act.
    #
    # If the passphrase is missing/wrong: fall through silently to normal
    # chat handling. Acknowledging "that's the right command but wrong
    # password" to an unauthenticated caller is its own information leak.
    # =========================================================================
    if user_message_clean.startswith("claude code:") and CLAUDE_CODE_TRIGGER_SECRET:
        _cc_rest = user_message[len("claude code:"):].strip()
        _cc_parts = _cc_rest.split(None, 1)
        if len(_cc_parts) == 2 and _cc_parts[0] == CLAUDE_CODE_TRIGGER_SECRET:
            cc_task_text = _cc_parts[1].strip()
            await log_chat_message("user", user_message)

            existing_task = await get_pending_claude_code_task()
            if existing_task:
                msg = (
                    f"⚠️ Already have a pending Claude Code task (status: {existing_task['status']}). "
                    f"Reply *approve claude code* or *cancel* first."
                )
                await log_chat_message("assistant", msg)
                return msg

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO local_command_queue (command_type, payload, source) VALUES (?, ?, ?)",
                    ("claude_code_propose", cc_task_text, source)
                )
                await db.commit()

            # Delivery of the plan happens in /local-queue/result once the bridge
            # actually posts it back — not here. An in-memory wait-and-deliver task
            # would be silently lost if this server process restarts/redeploys/idles
            # before the bridge responds, even though the bridge's result lands fine.
            if source == "whatsapp":
                return None
            else:
                ack = "🤖 Investigating — this can take a few minutes, I'll post the plan here once it's ready."
                await log_chat_message("assistant", ack)
                return ack
        # wrong/missing passphrase: fall through silently, no return

    # =========================================================================
    # CLAUDE CODE BRIDGE — start a live interactive session. Same secret gate
    # as the propose trigger, but instead of one-shot plan-then-approve, this
    # opens a modal session (handled at the top of this function) where every
    # subsequent message goes straight to a real `claude` process with full
    # permissions via --resume, the same way this very Claude Code session
    # works — no per-message plan/approve gate, just live back-and-forth.
    # Usage: "claude code session: <secret> [optional first message]"
    # =========================================================================
    if user_message_clean.startswith("claude code session:") and CLAUDE_CODE_TRIGGER_SECRET:
        _ccs_rest = user_message[len("claude code session:"):].strip()
        _ccs_parts = _ccs_rest.split(None, 1)
        if len(_ccs_parts) >= 1 and _ccs_parts[0] == CLAUDE_CODE_TRIGGER_SECRET:
            await log_chat_message("user", user_message)

            if await get_active_cc_session():
                msg = "⚠️ A live Claude Code session is already active. Reply *end claude code session* to close it first."
                await log_chat_message("assistant", msg)
                return msg

            session_row_id = await start_cc_session()
            first_message = _ccs_parts[1].strip() if len(_ccs_parts) == 2 else ""

            if not first_message:
                msg = (
                    "🟢 Live Claude Code session started — full permissions, every message now goes "
                    "straight to it. Use the Terminal tab to drive it (it auto-refreshes); reply "
                    "*end claude code session* to exit."
                )
                await log_chat_message("assistant", msg)
                return msg

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO local_command_queue (command_type, payload, source, cc_session_row_id) VALUES (?, ?, ?, ?)",
                    ("claude_code_chat", json.dumps({"message": first_message, "resume_id": None}), source, session_row_id)
                )
                await db.commit()

            if source == "whatsapp":
                return None
            ack = "🟢 Live Claude Code session started — working on it now."
            await log_chat_message("assistant", ack)
            return ack
        # wrong/missing passphrase: fall through silently, no return

    # =========================================================================
    # CLAUDE CODE BRIDGE — approve a proposed plan. Re-runs the ORIGINAL task
    # text (not the proposed_plan text) with full permissions
    # (--permission-mode bypassPermissions in local_bridge.py) — Claude Code
    # re-investigates and acts, rather than literally replaying the
    # human-readable plan summary as a prompt.
    # =========================================================================
    if user_message_clean == "approve claude code":
        await log_chat_message("user", user_message)
        cc_task = await get_pending_claude_code_task()
        if not cc_task or cc_task["status"] != "proposed":
            msg = "No pending Claude Code plan to approve."
            await log_chat_message("assistant", msg)
            return msg

        await update_claude_code_task_status(cc_task["id"], "executing")

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO local_command_queue (command_type, payload, source, cc_task_id) VALUES (?, ?, ?, ?)",
                ("claude_code_execute", cc_task["task_text"], source, cc_task["id"])
            )
            await db.commit()

        # Delivery happens in /local-queue/result once the bridge posts the result —
        # see the comment on the propose branch above for why.
        if source == "whatsapp":
            return None
        else:
            ack = "🚀 Running it now with full permissions — this can take a while, I'll post the result here once it's done."
            await log_chat_message("assistant", ack)
            return ack

    # =========================================================================
    # EMAIL TRIAGE — approve the active draft reply, then advance the queue
    # =========================================================================
    if user_message_clean in ["approve email", "yes email"]:
        await log_chat_message("user", user_message)
        draft = await get_active_draft()
        if not draft:
            return "⚠️ *No active email draft.*"
        success, report = await approve_draft(draft["id"])
        msg = f"📤 *Email sent to {draft['sender']}.*" if success else f"❌ *Send failed:* {report}"
        await log_chat_message("assistant", msg)
        send_whatsapp(msg)
        if success:
            await advance_email_queue()
        return None

    # =========================================================================
    # EMAIL TRIAGE — discard the active draft entirely, then advance the queue
    # =========================================================================
    if user_message_clean == "don't send":
        await log_chat_message("user", user_message)
        draft = await get_active_draft()
        if not draft:
            return "⚠️ *No active email draft.*"
        await delete_draft(draft["id"])
        remaining = await count_pending_drafts()
        medium = await get_medium_count()
        low = await get_low_count()
        msg = f"🗑️ *Deleted.* {remaining} priority email(s) left, {medium} medium, {low} low priority email(s)."
        await log_chat_message("assistant", msg)
        send_whatsapp(msg)
        await advance_email_queue()
        return None

    # =========================================================================
    # JOB SCOUT → TRACKER handoff — explicit "TRACK <n>" reply on a job digest.
    # Resolves n against the last shown search/digest and files it in the tracker.
    # =========================================================================
    if user_message_clean.startswith("track"):
        m = re.search(r"track\s*#?\s*(\d+)", user_message_clean)
        if m:
            await log_chat_message("user", user_message)
            n = int(m.group(1))
            job = await get_scout_last_shown(n)
            if not job:
                msg = f"🤷 No job #{n} to track — run a job search first, then reply TRACK <n>."
            else:
                _ok, msg = await add_application(job, status="interested")
            await log_chat_message("assistant", msg)
            return msg

    # =========================================================================
    # JOB APPLY DESK — approve a queued email application: "APPLY <n>" (or just "APPLY").
    # Sends the tailored resume + cover note the apply-prep step drafted, marks it applied.
    # =========================================================================
    if user_message_clean.startswith("apply"):
        await log_chat_message("user", user_message)
        m = re.search(r"apply\s*#?\s*(\d+)", user_message_clean)
        ref = int(m.group(1)) if m else None
        try:
            prof = await get_job_profile()
        except Exception:
            prof = None
        msg = await confirm_apply(ref, notify_fn=None, profile=prof, track_fn=add_application)
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # EMAIL TRIAGE — edit the active draft reply
    # Usage: "edit: <new reply text>"
    # =========================================================================
    if user_message_clean.startswith("edit:"):
        await log_chat_message("user", user_message)
        new_text = user_message[len("edit:"):].strip()
        draft = await get_active_draft()
        if not draft:
            return "⚠️ *No active email draft.*"
        if not new_text:
            return "⚠️ Usage: EDIT: <your new reply text>"
        await record_email_edit(draft["id"], draft["draft_reply"], new_text)
        await edit_draft(draft["id"], new_text)
        await refresh_email_tone_pattern(call_llm)
        msg = f"✏️ *Draft updated.*\n\n{new_text}\n\nReply *APPROVE EMAIL* to send it, or *DON'T SEND* to discard it."
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # EMAIL COMPOSE — send confirmation
    # =========================================================================
    if user_message_clean in [
        "send", "send it", "send this",
        "send this email", "yeah send",
        "yes send it", "yeah, send this email",
        "send the email", "go ahead send",
    ]:
        await log_chat_message("user", user_message)
        draft = await get_latest_composed_draft()
        if not draft:
            msg = "No pending email draft found. Compose one first."
            await log_chat_message("assistant", msg)
            return msg

        to_addr = draft.get("sender", "")  # recipient is stored in the sender column for composed drafts
        subject = draft.get("subject", "No Subject")
        body = draft.get("draft_reply", "")
        draft_id = draft.get("id")

        if not to_addr or not body or not _is_valid_email(to_addr):
            msg = (
                f"⚠️ This draft's recipient (\"{to_addr}\") isn't a valid email address. "
                "Please compose it again with a real address, e.g. \"draft an email to x@example.com about ...\""
            )
            await log_chat_message("assistant", msg)
            return msg

        sent_ok = await send_composed_email(to_address=to_addr, subject=subject, body=body, draft_id=draft_id)
        if sent_ok:
            reply = (
                f"✅ *Email sent successfully!*\n\n"
                f"*To:* {to_addr}\n"
                f"*Subject:* {subject}\n\n"
                f"Check your Gmail sent folder to confirm."
            )
        else:
            reply = (
                "❌ Failed to send email.\n"
                "Check Render logs for details. Gmail credentials may need refreshing."
            )
        await log_chat_message("assistant", reply)
        return reply

    # =========================================================================
    # EMAIL COMPOSE — edit the pending composed draft
    # Usage: "edit email: <new text>"
    # =========================================================================
    if user_message_clean.startswith("edit email:"):
        await log_chat_message("user", user_message)
        new_body = user_message[len("edit email:"):].strip()
        draft = await get_latest_composed_draft()

        if not draft:
            msg = "No pending draft to edit."
        elif not new_body:
            msg = "⚠️ Usage: EDIT EMAIL: <your new text>"
        else:
            await edit_draft(draft["id"], new_body)
            msg = (
                f"✏️ *Draft updated:*\n\n{new_body}\n\n"
                f"─────────────────\n"
                f"Reply *SEND* to send · *EDIT EMAIL: <text>* to revise again"
            )
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # CALENDAR — confirm a pending event invite (one with attendees)
    # Usage: "confirm event" / "send the invite" / "yes invite them"
    # =========================================================================
    if user_message_clean in ["confirm event", "send the invite", "send invite", "yes invite them", "confirm invite"]:
        await log_chat_message("user", user_message)
        pending_event = await get_latest_pending_event()
        if not pending_event:
            msg = "No pending event invite found. Create one first."
        else:
            created = await create_event(
                pending_event["summary"], pending_event["start_dt"], pending_event["end_dt"],
                pending_event["description"], pending_event["attendees"],
            )
            if created:
                await confirm_pending_event(pending_event["id"])
                _run_bg(refresh_calendar_prefs_pattern(call_llm))
                msg = (
                    f"✅ *Event created and invite sent!*\n\n"
                    f"*Title:* {pending_event['summary']}\n"
                    f"*Inviting:* {', '.join(pending_event['attendees'])}"
                )
            else:
                msg = "❌ Failed to create the event. Check Render logs — Calendar credentials may need refreshing."
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # EMAIL COMPOSE — cancel the pending composed draft
    # Only handles bare "cancel" when a composed draft or pending event invite
    # actually exists — otherwise falls through to the CANCEL STAGED PATCH
    # block further down, which already handles "cancel"/"no"/"abort" for the
    # AI-architect flow.
    # =========================================================================
    if user_message_clean == "cancel":
        composed_draft = await get_latest_composed_draft()
        if composed_draft:
            await log_chat_message("user", user_message)
            await cancel_composed_draft(composed_draft["id"])
            msg = "🗑️ Email draft cancelled."
            await log_chat_message("assistant", msg)
            return msg

        pending_event = await get_latest_pending_event()
        if pending_event:
            await log_chat_message("user", user_message)
            await cancel_pending_event(pending_event["id"])
            msg = "🗑️ Event invite cancelled."
            await log_chat_message("assistant", msg)
            return msg

        cc_pending = await get_pending_claude_code_task()
        if cc_pending and cc_pending["status"] == "proposed":
            await log_chat_message("user", user_message)
            await update_claude_code_task_status(cc_pending["id"], "cancelled")
            msg = "🗑️ Claude Code plan cancelled."
            await log_chat_message("assistant", msg)
            return msg

    # =========================================================================
    # NOTES — force-save a fact on demand
    # Usage: "remember: <something>"
    # =========================================================================
    if user_message_clean.startswith("remember:"):
        await log_chat_message("user", user_message)
        fact_text = user_message[len("remember:"):].strip()
        if not fact_text:
            return "⚠️ Usage: REMEMBER: <something to remember>"
        await save_user_fact(fact_text)
        msg = f"🧠 *Got it, I'll remember:* {fact_text}"
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # NOTES — search saved facts
    # Usage: "what do i know about <topic>"
    # =========================================================================
    if user_message_clean.startswith("what do i know about"):
        await log_chat_message("user", user_message)
        topic = user_message[len("what do i know about"):].strip()
        if not topic:
            return "⚠️ Usage: WHAT DO I KNOW ABOUT <topic>"
        facts = await search_user_facts(topic)
        if facts:
            msg = "🧠 *Here's what I know:*\n\n" + "\n".join(f"- {f}" for f in facts)
        else:
            msg = f"🤷 Nothing saved about \"{topic}\" yet."
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # SET TOPIC — override what the bot teaches next morning
    # Usage: "set topic: Reinforcement Learning from Human Feedback"
    # =========================================================================
    if user_message_clean.startswith("set topic:"):
        await log_chat_message("user", user_message)
        new_topic = user_message[len("set topic:"):].strip()
        if new_topic:
            async with aiosqlite.connect(DB_PATH) as db:
                # Write to both user_settings (spec) and user_profile (curriculum planner reads it)
                await db.execute(
                    "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES ('current_topic', ?, datetime('now'))",
                    (new_topic,)
                )
                await db.execute(
                    "INSERT OR REPLACE INTO user_profile (key, value) VALUES ('override_topic', ?)",
                    (new_topic,)
                )
                await db.commit()
            reply = f"Got it! Your learning topic is now: *{new_topic}*\nI'll teach you concepts from this domain daily. Type SET TOPIC: anything to change it anytime — it can be literally any subject."
        else:
            reply = "⚠️ Usage: SET TOPIC: <your topic here>\nExample: SET TOPIC: Reinforcement Learning"
        return reply

    if user_message_clean == "clear topic":
        await log_chat_message("user", user_message)
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM user_profile WHERE key='override_topic'")
            await db.commit()
        return "✅ Topic override cleared. Auto-selection resumes tomorrow."

    # =========================================================================
    # EXPLAIN — instant concept explanation
    # Usage: "EXPLAIN: transformer attention mechanism"
    # =========================================================================
    if user_message_clean.startswith("explain:"):
        await log_chat_message("user", user_message)
        concept_to_explain = user_message[len("explain:"):].strip()
        if not concept_to_explain:
            return "⚠️ Usage: EXPLAIN: <concept>\nExample: EXPLAIN: transformer attention"
        try:
            explain_system = """You are a world-class educator who can explain any concept
from any field — science, math, history, coding, philosophy, economics,
psychology, engineering, art, music, or anything else.

When explaining:
1. Start with a plain English explanation anyone can understand
2. Give one memorable real-world analogy
3. Give one concrete example or mini exercise
4. Keep the total response under 1400 characters so it fits in WhatsApp

You are not limited to any domain. Explain whatever the user asks."""
            explain_response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=500, temperature=0.3,
                extra_body={"reasoning_effort": "low"},
                messages=[
                    {"role": "system", "content": explain_system},
                    {"role": "user", "content": f"Explain this concept clearly: {concept_to_explain}"},
                ]
            )
            explanation = explain_response.choices[0].message.content.strip()
            return explanation
        except Exception as e:
            return f"⚠️ Could not explain that right now: {str(e)}"

    # =========================================================================
    # STATUS / PROGRESS DASHBOARD
    # =========================================================================
    if user_message_clean in ["status", "progress", "my stats", "stats"]:
        await log_chat_message("user", user_message)
        skill_level, recent_topics, _ = await get_db_state()
        streak = await get_study_streak()
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT COUNT(*) FROM sent_history") as cursor:
                total_concepts = (await cursor.fetchone())[0]
            async with db.execute(
                "SELECT quiz_score, max_score, concept FROM performance_log ORDER BY timestamp DESC LIMIT 1"
            ) as cursor:
                last_quiz = await cursor.fetchone()
            async with db.execute(
                "SELECT COUNT(*) FROM review_queue WHERE completed=0"
            ) as cursor:
                pending_reviews = (await cursor.fetchone())[0]
        last_quiz_text = f"{last_quiz[0]}/{last_quiz[1]} on _{last_quiz[2][:30]}_" if last_quiz else "No quizzes yet"
        next_concept_hint = recent_topics[0] if recent_topics else "TBD"
        status_msg = (
            f"📊 *Your Learning Dashboard*\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"🎓 *Skill Level:* {skill_level}\n"
            f"🔥 *Study Streak:* {streak} day{'s' if streak != 1 else ''}\n"
            f"📚 *Concepts Learned:* {total_concepts}\n"
            f"📝 *Last Quiz:* {last_quiz_text}\n"
            f"🔁 *Pending Reviews:* {pending_reviews}\n"
            f"━━━━━━━━━━━━━━━━━━━━\n"
            f"Reply *done* after today's reading to start your quiz! 🚀"
        )
        await log_chat_message("assistant", status_msg)
        return status_msg

    # =========================================================================
    # DIFFICULTY FEEDBACK (E / J / H)
    # =========================================================================
    if user_message_clean in ["e", "j", "h"]:
        mapping = {"e": "too_easy", "j": "just_right", "h": "too_hard"}
        pref = mapping[user_message_clean]
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE user_profile SET value=? WHERE key='difficulty_preference'", (pref,))
            await db.commit()
        labels = {"e": "too easy 🟢", "j": "just right 🟡", "h": "too hard 🔴"}
        reply = f"Got it! I noted today's concept felt *{labels[user_message_clean]}*. I'll adjust future concepts accordingly. 📐"
        await log_chat_message("user", user_message)
        await log_chat_message("assistant", reply)
        return reply

    # =========================================================================
    # CODE REVIEW
    # =========================================================================
    if user_message_clean.startswith("review:"):
        await log_chat_message("user", user_message)
        code_snippet = user_message[7:].strip()
        if not code_snippet:
            return "⚠️ Send: *review: <your code here>*"
        skill_level, recent_topics, _ = await get_db_state()
        concept = recent_topics[0] if recent_topics else "AI Engineering"
        try:
            review_response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=600, temperature=0.2,
                extra_body={"reasoning_effort": "medium"},
                messages=[{"role": "user", "content": (
                    f"Review this code snippet for an {skill_level} student learning {concept}.\n"
                    f"```\n{code_snippet}\n```\n"
                    f"Give: 1) Correctness verdict, 2) One specific improvement, 3) One thing done well. "
                    f"Keep it under 200 words. Use WhatsApp *bold* formatting."
                )}]
            )
            review_msg = review_response.choices[0].message.content.strip()
        except Exception as e:
            review_msg = f"⚠️ Code review unavailable: {e}"
        await log_chat_message("assistant", review_msg)
        return review_msg

    # =========================================================================
    # QUIZ ANSWER HANDLER
    # =========================================================================
    quiz_state = load_quiz_state()
    if quiz_state:
        # Confirm end quiz
        if quiz_state.get("pending_end_confirm") and user_message_clean == "confirm":
            await log_chat_message("user", user_message)
            quiz_state.pop("pending_end_confirm", None)
            result_msg = await finalize_quiz(quiz_state)
            clear_quiz_state()
            final = f"🛑 *Quiz ended early.*\n\n{result_msg}"
            await log_chat_message("assistant", final)
            return final

        # End quiz early — ask for confirmation first
        if user_message_clean in ["end quiz", "end", "stop quiz", "finish"]:
            await log_chat_message("user", user_message)
            quiz_state["pending_end_confirm"] = True
            save_quiz_state(quiz_state)
            confirm_msg = (
                f"⚠️ Are you sure you want to end the quiz?\n\n"
                f"Current score: *{quiz_state.get('score', 0)}/{quiz_state.get('current_index', 0)}* answered\n\n"
                f"Reply *confirm* to end and see results, or keep answering to continue."
            )
            await log_chat_message("assistant", confirm_msg)
            return confirm_msg

        # Skip current question
        if user_message_clean == "skip":
            await log_chat_message("user", user_message)
            questions = quiz_state["questions"]
            current_index = quiz_state["current_index"]
            current_q = questions[current_index]

            # Log skipped as wrong
            quiz_state["answers"].append({
                "question_number": current_index + 1,
                "question_text": current_q["question"],
                "correct_answer": current_q["correct"],
                "user_answer": "SKIPPED",
                "difficulty": current_q["difficulty"],
                "is_correct": False
            })

            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "INSERT INTO quiz_answers (session_id, question_number, question_text, correct_answer, user_answer, difficulty, is_correct) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (quiz_state["session_id"], current_index+1, current_q["question"], current_q["correct"], "SKIPPED", current_q["difficulty"], 0)
                )
                await db.commit()

            quiz_state["current_index"] += 1
            save_quiz_state(quiz_state)

            if quiz_state["current_index"] >= len(questions):
                result_msg = await finalize_quiz(quiz_state)
                clear_quiz_state()
                skip_msg = f"⏭️ *Question skipped.*\n\n{result_msg}"
            else:
                next_q = questions[quiz_state["current_index"]]
                next_question_text = format_question(next_q, quiz_state["current_index"]+1, len(questions))
                options_footer = (
                    f"\n─────────────────────\n"
                    f"*What do you want to do?*\n"
                    f"▶️ Reply *A/B/C/D* — Answer next question\n"
                    f"⏭️ Reply *skip* — Skip this question\n"
                    f"🛑 Reply *end quiz* — End quiz and see results"
                )
                skip_msg = f"⏭️ *Question skipped.* Moving on...\n\n{next_question_text}{options_footer}"

            await log_chat_message("assistant", skip_msg)
            return skip_msg

        # Answer A B C D
        if user_message_clean.upper() in ["A", "B", "C", "D"]:
            await log_chat_message("user", user_message)
            result = await process_quiz_answer(user_message_clean.upper())
            if result:
                await log_chat_message("assistant", result)
            return result

    # =========================================================================
    # LEARNING DONE — trigger quiz
    # =========================================================================
    if user_message_clean in ["done", "completed", "finished", "complete"]:
        await log_chat_message("user", user_message)

        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT quiz_triggered, concept FROM daily_checkins WHERE date=?", (today,)) as cursor:
                row = await cursor.fetchone()

        if row and row[0]:
            return "✅ Quiz already completed today! Come back tomorrow for a new concept. 🌟"

        concept = row[1] if row and row[1] else _FALLBACK_CONCEPTS[0][0]

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE daily_checkins SET learning_status='done' WHERE date=?", (today,))
            await db.commit()

        skill_level, _, _ = await get_db_state()
        intro = f"🎉 Great work finishing today's concept! Testing your knowledge on *{concept}* now.\n\n10 questions — Easy to Advanced. Here we go!\n\n"
        first_question = await start_quiz_session(concept, skill_level)

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("UPDATE daily_checkins SET quiz_triggered=1 WHERE date=?", (today,))
            await db.commit()

        await log_chat_message("assistant", intro + first_question)
        return intro + first_question

    # =========================================================================
    # APPROVE STAGED PATCH
    # =========================================================================
    if user_message_clean in ["approve", "yes", "confirm", "push"]:
        await log_chat_message("user", user_message)
        if not os.path.exists(STAGED_CODE_FILE):
            return "⚠️ *No changes staged.* Send an upgrade instruction first!"

        def execute_staged_push():
            try:
                if not GITHUB_TOKEN or not GITHUB_REPO:
                    return False, "GITHUB_TOKEN or GITHUB_REPO missing."
                with open(STAGED_CODE_FILE, "r") as f:
                    staged_data = json.load(f)
                headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
                file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
                get_res = requests.get(file_url, headers=headers)
                if get_res.status_code != 200:
                    return False, f"GitHub fetch failed: {get_res.json().get('message')}"
                live_data = get_res.json()
                live_code = base64.b64decode(live_data["content"]).decode("utf-8")
                current_sha = live_data["sha"]
                find_text = staged_data.get("find")
                replace_text = staged_data.get("replace")
                if find_text not in live_code:
                    return False, "Patch target not found. File may have changed. Retry your instruction."
                patched_code = live_code.replace(find_text, replace_text, 1)
                put_res = requests.put(file_url, headers=headers, json={
                    "message": f"🤖 Surgical Patch: {staged_data['instruction'][:60]}",
                    "content": base64.b64encode(patched_code.encode("utf-8")).decode("utf-8"),
                    "sha": current_sha, "branch": "main"
                })
                if os.path.exists(STAGED_CODE_FILE):
                    os.remove(STAGED_CODE_FILE)
                return (True, "Success") if put_res.status_code in [200, 201] else (False, put_res.json().get("message", "Unknown error."))
            except Exception as e:
                return False, str(e)

        success, report = await loop.run_in_executor(None, execute_staged_push)
        msg = "🚀 *Approved!* Patch committed to GitHub.\n\n🔄 *Render Deployment Initiated.*" if success else f"❌ *Deployment Aborted.*\n\n`{report}`"
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # CANCEL STAGED PATCH
    # =========================================================================
    if user_message_clean in ["cancel", "no", "abort"]:
        await log_chat_message("user", user_message)
        if os.path.exists(STAGED_CODE_FILE):
            os.remove(STAGED_CODE_FILE)
            msg = "🛑 *Aborted.* Staged changes cleared."
        else:
            msg = "ℹ️ Nothing staged. Buffer is empty."
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # SYSTEM COMMANDS
    # =========================================================================
    if user_message_clean == "git status":
        await log_chat_message("user", user_message)
        def run_git():
            try: return subprocess.run(["git", "status"], capture_output=True, text=True, cwd=BASE_DIR).stdout.strip()
            except Exception as e: return str(e)
        output = await loop.run_in_executor(None, run_git)
        msg = f"📊 *Git Status*:\n\n```{output}```"
        await log_chat_message("assistant", msg)
        return msg

    if user_message_clean in ["digest", "refresh", "force digest"]:
        await log_chat_message("user", user_message)
        today_str = date.today().isoformat()
        # Check cache for today's pre-generated digest
        cached_content = None
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute(
                "SELECT content FROM digest_cache WHERE date=? AND sent=0 ORDER BY generated_at DESC LIMIT 1",
                (today_str,)
            ) as cursor:
                row = await cursor.fetchone()
                if row:
                    cached_content = row[0]
        if cached_content:
            print("⚡ [Cache HIT]: Sending pre-generated digest")
            send_whatsapp_chunked(cached_content)
            async with aiosqlite.connect(DB_PATH) as db:
                await db.execute(
                    "UPDATE digest_cache SET sent=1 WHERE date=? AND sent=0",
                    (today_str,)
                )
                await db.commit()
            await log_chat_message("assistant", "Cache HIT: sent pre-generated digest instantly")
        else:
            print("⚡ [Cache MISS]: Generating fresh digest, ~30 seconds...")
            send_whatsapp_chunked("⚡ Digest requested! Generating your update now — arrives in ~30 seconds...")
            digest_status = await run_morning_digest()
            await log_chat_message("assistant", f"Cache MISS: fresh digest done. Status: {digest_status.get('status')}")
        return None

    if user_message_clean in ["weekly report", "report", "my progress"]:
        await log_chat_message("user", user_message)
        await send_weekly_report()
        return None

    # =========================================================================
    # UPGRADE INTENT — SURGICAL PATCH
    # =========================================================================
    # Only trigger code patching for explicit code/system change requests
    UPGRADE_PHRASES = [
        "upgrade yourself",
        "modify your code",
        "update your code",
        "fix your code",
        "change your code",
        "patch yourself",
        "update the scheduler timings",
        "change the scheduler",
        "implement this change",
        "modify the bot",
        "update the bot",
        "change the bot",
    ]
    is_upgrade_intent = any(phrase in user_message_clean for phrase in UPGRADE_PHRASES)

    if is_upgrade_intent:
        await log_chat_message("user", user_message)
        if not GITHUB_TOKEN or not GITHUB_REPO:
            return "❌ *Operation Denied.* `GITHUB_TOKEN` or `GITHUB_REPO` missing."

        try:
            headers = {"Authorization": f"token {GITHUB_TOKEN}", "Accept": "application/vnd.github.v3+json"}
            file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
            res = await loop.run_in_executor(None, lambda: requests.get(file_url, headers=headers))
            if res.status_code != 200:
                return f"❌ *GitHub Error:* {res.json().get('message')}"

            file_data = res.json()
            current_sha = file_data["sha"]
            current_code = base64.b64decode(file_data["content"]).decode("utf-8")

            print("🧠 [AI Architect]: Generating surgical patch...")

            patch_response = await anthropic_client.chat.completions.create(
                model=OPENROUTER_MODEL, max_tokens=2500, temperature=0.1,
                extra_body={"reasoning_effort": "medium"},
                messages=[
                    {"role": "system", "content": (
                        "You are an expert Python code surgeon. "
                        "Given a user instruction and a Python file, identify the exact snippet to change. "
                        "Respond ONLY with a valid raw JSON object with exactly two keys: "
                        "\"find\" (exact existing code verbatim) and \"replace\" (new code). "
                        "No explanation, no markdown, no text outside the JSON."
                    )},
                    {"role": "user", "content": (
                        f"Instruction: {user_message}\n\n"
                        f"Current file:\n{current_code}\n\n"
                        f"Return ONLY: {{\"find\": \"exact old code\", \"replace\": \"new code\"}}"
                    )},
                ]
            )

            raw_text = re.sub(r'^```(?:json)?\s*|\s*```$', '', patch_response.choices[0].message.content.strip(), flags=re.MULTILINE).strip()
            print(f"🔍 PATCH RESPONSE:\n{raw_text}")

            try:
                raw = raw_text.strip() if raw_text else ""
                if not raw:
                    raise ValueError("Empty response from LLM")
                if raw.startswith("```"):
                    raw = raw.split("```")[1]
                    if raw.startswith("json"):
                        raw = raw[4:]
                patch_data = json.loads(raw.strip())
            except (json.JSONDecodeError, ValueError) as e:
                print(f"⚠️ JSON parse failed: {e}. Raw response was: {repr(raw_text[:200] if raw_text else 'EMPTY')}")
                patch_data = {}
            find_text = patch_data.get("find", "").strip()
            replace_text = patch_data.get("replace", "").strip()

            if not find_text or not replace_text:
                raise ValueError("Patch JSON missing 'find' or 'replace' keys.")
            if find_text not in current_code:
                raise ValueError("Patch target not found. Claude may have paraphrased instead of copying verbatim.")

            preview_find = find_text[:150] + "..." if len(find_text) > 150 else find_text
            preview_replace = replace_text[:150] + "..." if len(replace_text) > 150 else replace_text

            with open(STAGED_CODE_FILE, "w") as f:
                json.dump({"instruction": user_message, "find": find_text, "replace": replace_text, "sha": current_sha}, f)

            msg = (
                f"🛠️ *Surgical Patch Staged!*\n\n"
                f"*Change:* {user_message[:80]}\n\n"
                f"*Removing:*\n`{preview_find}`\n\n"
                f"*Replacing with:*\n`{preview_replace}`\n\n"
                f"Reply *'Approve'* to push or *'Cancel'* to discard."
            )
            await log_chat_message("assistant", msg)
            return msg

        except Exception as e:
            err = "⏳ *Claude overloaded.* Try again in a moment." if "529" in str(e) or "overloaded" in str(e).lower() else f"❌ *Patch Error:* {str(e)}"
            await log_chat_message("assistant", err)
            return err

    # =========================================================================
    # NOTES & REMINDERS — natural-language intent detection
    # =========================================================================
    try:
        now_str = dt.datetime.now(ZoneInfo("Asia/Kolkata")).isoformat()
        recent_history = await get_recent_chat_history(limit=6)
        history_str = "\n".join(f"{m['role']}: {m['content']}" for m in recent_history) or "(none)"
        # Learned scheduling habits — only used to fill in defaults the user leaves out
        # (a reminder time, an event duration/time). Optional: empty until real history
        # exists to learn from, and must NEVER override anything the user states explicitly.
        try:
            reminder_timing_note = await get_pattern_context("reminder_timing")
            calendar_prefs_note = await get_pattern_context("calendar_prefs")
        except Exception:
            reminder_timing_note = calendar_prefs_note = ""
        hint_parts = []
        if reminder_timing_note:
            hint_parts.append(f"Habitual reminder times: {reminder_timing_note}")
        if calendar_prefs_note:
            hint_parts.append(f"Calendar scheduling habits (typical duration/times): {calendar_prefs_note}")
        timing_hint = (
            "\n\nLearned defaults — use ONLY to fill in a time/duration the user does NOT specify; "
            "NEVER override a value they do give:\n" + "\n".join(hint_parts)
            if hint_parts else ""
        )
        t_intent = time.time()
        intent_raw = await call_llm(
            MEMORY_INTENT_PROMPT,
            f"Current datetime: {now_str}\n\nRecent conversation (use this to resolve references like "
            f"\"the same email\"/\"that person\"/\"send it again\" into concrete values):\n{history_str}\n\n"
            f"Latest message: {user_message}{timing_hint}",
            max_tokens=500,
        )
        print(f"⏱️ [process_message] intent classification took {time.time() - t_intent:.2f}s")
        intent_parsed = json.loads(intent_raw)
        memory_intent = intent_parsed.get("intent", "OTHER")
        memory_content = intent_parsed.get("content")
        memory_reminder = intent_parsed.get("reminder")
        memory_email = intent_parsed.get("email")
        memory_calendar = intent_parsed.get("calendar")
        memory_job = intent_parsed.get("job")
        memory_application = intent_parsed.get("application")
        memory_bill = intent_parsed.get("bill")
    except Exception as e:
        print(f"⚠️ Memory intent classification failed: {e}")
        memory_intent = "OTHER"
        memory_content = None
        memory_reminder = None
        memory_email = None
        memory_calendar = None
        memory_job = None
        memory_application = None
        memory_bill = None

    if memory_intent == "SAVE_FACT" and memory_content:
        await log_chat_message("user", user_message)
        await save_user_fact(memory_content)
        msg = f"🧠 *Got it, I'll remember:* {memory_content}"
        await log_chat_message("assistant", msg)
        return msg

    if memory_intent == "RECALL_FACT" and memory_content:
        await log_chat_message("user", user_message)
        facts = await search_user_facts(memory_content)
        if facts:
            msg = "🧠 *Here's what I know:*\n\n" + "\n".join(f"- {f}" for f in facts)
        else:
            msg = f"🤷 Nothing saved about \"{memory_content}\" yet."
        await log_chat_message("assistant", msg)
        return msg

    if memory_intent == "LIST_FACTS":
        await log_chat_message("user", user_message)
        all_facts = await get_user_facts(limit=50)
        if all_facts:
            msg = f"🧠 *Everything I've got saved ({len(all_facts)}):*\n\n" + "\n".join(f"- {f}" for f in all_facts)
        else:
            msg = "🤷 Nothing saved yet."
        await log_chat_message("assistant", msg)
        return msg

    if memory_intent == "SET_REMINDER" and memory_reminder:
        await log_chat_message("user", user_message)
        app_scheduler = getattr(app.state, "scheduler", None)
        if not app_scheduler:
            msg = "⚠️ *Scheduler not available right now.*"
        else:
            success, msg = await create_reminder_from_intent(
                app_scheduler, memory_reminder, send_whatsapp,
                register=(SCHEDULER_MODE != "external"),
            )
            if success:
                # Re-learn timing habits in the background — never delays the confirmation.
                _run_bg(refresh_reminder_timing_pattern(call_llm))
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # READ INBOX — interactive, read-only snapshot of recent/unread mail.
    # Routed by the LLM classifier (READ_INBOX); returns a JARVIS briefing inline
    # instead of the old "I can't read your inbox here" fallback.
    # =========================================================================
    if memory_intent == "READ_INBOX":
        await log_chat_message("user", user_message)
        reply = await summarize_inbox(call_llm)
        await log_chat_message("assistant", reply)
        return reply

    # =========================================================================
    # EMAIL COMPOSE — draft a brand-new outbound email via natural language
    # Routed entirely by the LLM intent classification above (COMPOSE_EMAIL) —
    # no hardcoded trigger phrases, so any natural phrasing reaches this real
    # Gmail-backed action instead of falling through to general chat (which
    # has no way to actually create a draft or send anything).
    # =========================================================================
    if memory_intent == "COMPOSE_EMAIL" and memory_email:
        await log_chat_message("user", user_message)
        to_address = (memory_email.get("to") or "").strip()
        subject = (memory_email.get("subject") or "").strip() or "No Subject"
        body = (memory_email.get("body") or "").strip()
        save_as_draft = bool(memory_email.get("save_as_draft"))

        if not to_address or not body or not _is_valid_email(to_address):
            msg = (
                "⚠️ I need a valid recipient email address and what the email should say.\n"
                "Try: \"draft an email to x@example.com about ...\""
            )
            await log_chat_message("assistant", msg)
            return msg

        if save_as_draft:
            gmail_draft_id = await create_gmail_draft(to_address, subject, body)
            if gmail_draft_id:
                msg = (
                    f"✅ *Saved to your Gmail Drafts folder.*\n\n"
                    f"*To:* {to_address}\n"
                    f"*Subject:* {subject}\n\n"
                    f"*Body:*\n{body}\n\n"
                    f"Open Gmail → Drafts to review or send it from there."
                )
            else:
                msg = (
                    "❌ Failed to save the draft to Gmail.\n"
                    "Check Render logs for details — Gmail credentials may need refreshing."
                )
        else:
            await save_composed_draft(to_address, subject, body)
            msg = (
                f"📧 *Email Draft Ready*\n\n"
                f"*To:* {to_address}\n"
                f"*Subject:* {subject}\n\n"
                f"*Body:*\n{body}\n\n"
                f"─────────────────\n"
                f"Reply *SEND* to send this email\n"
                f"Reply *EDIT EMAIL: <new text>* to revise\n"
                f"Reply *CANCEL* to discard"
            )
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # CALENDAR — view, check availability, create, or cancel an event
    # Routed entirely by the LLM intent classification above (CALENDAR_ACTION) —
    # same pattern as reminders/email compose, no hardcoded trigger phrases.
    # Events with attendees are held for confirmation (see CONFIRM EVENT /
    # bare CANCEL above) since creating them auto-emails the invite.
    # =========================================================================
    if memory_intent == "CALENDAR_ACTION" and memory_calendar:
        await log_chat_message("user", user_message)
        cal_action = memory_calendar.get("action")

        if cal_action == "list":
            events = await list_upcoming_events(max_results=10)
            if not events:
                msg = "📭 No upcoming events on your calendar."
            else:
                lines = [f"{i+1}. *{e['summary']}* — {e['start']}" for i, e in enumerate(events)]
                msg = f"📅 *Upcoming events ({len(events)}):*\n\n" + "\n".join(lines)

        elif cal_action == "check":
            start_dt = memory_calendar.get("start_dt")
            end_dt = memory_calendar.get("end_dt")
            if not start_dt or not end_dt:
                msg = "⚠️ I need a specific time window to check — try \"am I free tomorrow at 3pm?\""
            else:
                conflicts = await check_availability(start_dt, end_dt)
                if not conflicts:
                    msg = "✅ You're free during that time."
                else:
                    lines = [f"- *{e['summary']}* — {e['start']}" for e in conflicts]
                    msg = "⚠️ *You have something then:*\n\n" + "\n".join(lines)

        elif cal_action == "create":
            summary = (memory_calendar.get("summary") or "").strip() or "Untitled event"
            start_dt = memory_calendar.get("start_dt")
            end_dt = memory_calendar.get("end_dt")
            description = memory_calendar.get("description")
            attendees = memory_calendar.get("attendees") or []

            if not start_dt or not end_dt:
                msg = "⚠️ I need a start time for the event — try \"put a meeting on my calendar tomorrow at 3pm\""
            elif attendees:
                await save_pending_event(summary, start_dt, end_dt, description, attendees)
                msg = (
                    f"📅 *Event Ready — Invite Pending*\n\n"
                    f"*Title:* {summary}\n"
                    f"*When:* {start_dt} to {end_dt}\n"
                    f"*Inviting:* {', '.join(attendees)}\n\n"
                    f"─────────────────\n"
                    f"Reply *CONFIRM EVENT* to create it and send the invite\n"
                    f"Reply *CANCEL* to discard"
                )
            else:
                created = await create_event(summary, start_dt, end_dt, description)
                if created:
                    msg = f"✅ *Event created:* {summary}\n*When:* {start_dt} to {end_dt}"
                    # Re-learn scheduling habits in the background — never delays the reply.
                    _run_bg(refresh_calendar_prefs_pattern(call_llm))
                else:
                    msg = "❌ Failed to create the event. Check Render logs — Calendar credentials may need refreshing."

        elif cal_action == "delete":
            summary_hint = (memory_calendar.get("summary") or "").strip().lower()
            events = await list_upcoming_events(max_results=20)
            matches = [e for e in events if summary_hint and summary_hint in e["summary"].lower()]
            if not matches:
                msg = f"🤷 Couldn't find an upcoming event matching \"{summary_hint}\"."
            elif len(matches) > 1:
                lines = [f"- *{e['summary']}* — {e['start']}" for e in matches]
                msg = "⚠️ *Found more than one match — be more specific:*\n\n" + "\n".join(lines)
            else:
                ok = await delete_event(matches[0]["id"])
                msg = f"🗑️ *Event cancelled:* {matches[0]['summary']}" if ok else "❌ Failed to cancel the event."

        else:
            msg = "⚠️ I didn't understand what calendar action you wanted."

        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # JOB SEARCH — on-demand live listings (JSearch if configured, else live Adzuna).
    # Ephemeral: an ad-hoc query never mutates the standing job_profile unless the user
    # explicitly asks (save_profile). Read-only on the ledger; results are tagged if
    # already flagged by the daily cron, not silently dropped.
    # =========================================================================
    if memory_intent == "JOB_SEARCH":
        await log_chat_message("user", user_message)
        job = memory_job or {}
        override = {
            "role": job.get("role"),
            "query_location": job.get("location"),
            "remote_ok": job.get("remote"),
            "keywords": job.get("keywords"),
        }
        override = {k: v for k, v in override.items() if v is not None}
        if job.get("save_profile") and override:
            prof = dict(await get_job_profile())
            prof.update(override)
            await save_job_profile(prof)
        if source == "whatsapp":
            try:
                send_whatsapp("🔎 On it — pulling live listings…")
            except Exception:
                pass
        msg = await run_on_demand_search(call_llm, override=override or None)
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # APPLICATION TRACKER — view the pipeline or update an application's status.
    # =========================================================================
    if memory_intent == "APPLICATION_ACTION" and memory_application:
        await log_chat_message("user", user_message)
        action = memory_application.get("action")
        if action == "update":
            company = memory_application.get("company")
            new_status = memory_application.get("new_status")
            if not company or not new_status:
                msg = "⚠️ Tell me which application and the new status — e.g. \"mark BP as interviewing\"."
            else:
                _ok, msg = await update_application_status(company, new_status)
        elif action == "add":
            # "applied to <role> at <company> on Naukri" → drop a card on the board (default Applied).
            role = (memory_application.get("role") or "").strip()
            company = (memory_application.get("company") or "").strip()
            if not role and not company:
                msg = "⚠️ Tell me the role and company — e.g. \"applied to Data Analyst at Acme on Naukri\"."
            else:
                location = (memory_application.get("location") or "").strip()
                source = (memory_application.get("source") or "").strip() or "Manual"
                status = (memory_application.get("new_status") or "applied").strip() or "applied"
                slug = re.sub(r"[^a-z0-9]+", "-",
                              f"{role} {company} {location}".lower()).strip("-")
                job = {
                    "key": f"manual:{slug}" if slug else f"manual:{int(time.time())}",
                    "title": role or f"Role at {company}", "company": company,
                    "location": location, "url": "", "source": source,
                }
                _ok, msg = await add_application(job, status=status)
        else:  # list (default)
            apps = await list_applications(memory_application.get("status_filter"))
            msg = format_applications(apps)
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # BILL / DEADLINE WATCHER — add / list / mark paid / delete a tracked bill.
    # =========================================================================
    if memory_intent == "BILL_ACTION" and memory_bill:
        await log_chat_message("user", user_message)
        action = (memory_bill.get("action") or "list").lower()
        if action == "add":
            _ok, msg = await add_bill(
                name=memory_bill.get("name"),
                amount=memory_bill.get("amount") or 0,
                recurrence=memory_bill.get("recurrence") or "monthly",
                due_day=memory_bill.get("due_day"),
                due_date=memory_bill.get("due_date"),
            )
        elif action == "paid":
            name = (memory_bill.get("name") or "").strip()
            msg = "⚠️ Which bill did you pay? e.g. \"mark rent paid\"." if not name else (await mark_bill_paid(name))[1]
        elif action == "delete":
            name = (memory_bill.get("name") or "").strip()
            msg = "⚠️ Which bill should I stop tracking? e.g. \"delete netflix bill\"." if not name else (await delete_bill(name))[1]
        else:  # list (default)
            msg = format_bills(await list_bills())
        await log_chat_message("assistant", msg)
        return msg

    # =========================================================================
    # REMINDERS — list pending reminders
    # Routed entirely by the LLM intent classification above (LIST_REMINDERS) —
    # no hardcoded phrase list, so any natural phrasing of "show my reminders"
    # reaches this real DB lookup instead of falling through to general chat.
    # =========================================================================
    if memory_intent == "LIST_REMINDERS":
        await log_chat_message("user", user_message)
        rows = await get_active_reminders()
        if not rows:
            msg = "📭 No pending reminders."
            await log_chat_message("assistant", msg)
            return msg

        def _format_when(row):
            if row["kind"] == "once":
                return dt.datetime.fromisoformat(row["run_at"]).strftime("%d %b at %I:%M %p")
            elif row["kind"] == "daily":
                return f"every day at {row['hour']:02d}:{row['minute']:02d}"
            else:
                return f"every {row['day_of_week']} at {row['hour']:02d}:{row['minute']:02d}"

        lines = [f"{i+1}. {row['text']} — {_format_when(row)}" for i, row in enumerate(rows)]
        result = f"⏰ *Your reminders ({len(rows)}):*\n\n" + "\n".join(lines)
        await log_chat_message("assistant", result)
        return result

    # =========================================================================
    # GENERAL CONVERSATIONAL CHAT
    # =========================================================================
    try:
        skill_level, recent_topics, _ = await get_db_state()
        relevant_context = await retrieve_relevant_context(user_message, limit=2)
        user_facts = await get_user_facts(limit=10)
        chat_history = await get_recent_chat_history(limit=6)

        context_str = "\n".join([f"- {c['content']}" for c in relevant_context])
        facts_str = "\n".join([f"- {f}" for f in user_facts])

        # Live job-tracker snapshot so general chat can answer questions about the Kanban
        # board factually (counts by stage) instead of denying access to Madan's OWN tracker.
        # This is the safety net for phrasings that slip past the APPLICATION_ACTION classifier
        # (e.g. "how's my job portal doing"). Read-only; one cheap query per web message.
        try:
            _apps = await list_applications()
            if _apps:
                _by = {}
                for _a in _apps:
                    _st = (_a.get("status") or "unknown")
                    _by[_st] = _by.get(_st, 0) + 1
                _parts = ", ".join(f"{n} {s}" for s, n in sorted(_by.items(), key=lambda kv: -kv[1]))
                pipeline_fact_line = (
                    f"- LIVE JOB TRACKER SNAPSHOT (read-only, current): Madan has {len(_apps)} "
                    f"applications on his internal Kanban board — {_parts}. This board IS his "
                    "'applications'/'job portal'/'jobs portal'/'board'/'pipeline'; when he asks how "
                    "many applications he has or how his board/portal is doing, answer directly from "
                    "these real numbers. NEVER say you can't access it or ask him to provide the count.\n"
                )
            else:
                pipeline_fact_line = (
                    "- LIVE JOB TRACKER SNAPSHOT: Madan's internal Kanban board currently has 0 tracked "
                    "applications. If he asks how many, say none are tracked yet — never claim you "
                    "can't access his board/job portal.\n"
                )
        except Exception:
            pipeline_fact_line = ""

        # Cross-cutting learned reply style — how Madan actually communicates. Shapes every
        # JARVIS reply so it mirrors his register. Empty until there's enough history.
        try:
            reply_style_note = await get_pattern_context("reply_style")
        except Exception:
            reply_style_note = ""
        reply_style_block = (
            f"\n\nLEARNED REPLY STYLE — mirror how Madan himself writes (from his real messages): "
            f"{reply_style_note}\n"
            if reply_style_note else ""
        )

        if CONNECTED_GMAIL_ADDRESS:
            gmail_fact_line = (
                f"- Gmail is connected via OAuth to {CONNECTED_GMAIL_ADDRESS} — you CAN draft "
                "(save to Gmail Drafts) or send real emails when asked. Never deny this. This is "
                "the exact account drafts/sends actually go through — state it plainly if asked. "
                "It is NOT necessarily the same as any personal email address saved as a fact "
                "about Madan elsewhere; never conflate the two.\n"
            )
        else:
            gmail_fact_line = (
                "- Gmail is connected via OAuth — you CAN draft (save to Gmail Drafts) or send "
                "real emails when asked. Never deny this. But the exact linked address couldn't "
                "be confirmed at startup — never name any specific email address as the connected "
                "one until it's verified. Just say the integration is live and working.\n"
            )

        if source == "web":
            system_prompt = (
                "You are JARVIS, Madan's personal AI executive assistant. "
                "You are direct, concise, and conversational — like a smart "
                "assistant who knows Madan well, not a teacher or a chatbot.\n\n"

                "YOUR PERSONALITY:\n"
                "You're Madan's sharp, dry COO — you respect his time, lead with "
                "the answer, and never over-explain unless asked. Occasionally "
                "witty, never chatty. You know his full system and never pretend "
                "otherwise.\n\n"

                "RESPONSE RULES — follow these strictly:\n"
                "1. Always lead with the answer or conclusion first. Context and "
                "reasoning come after, only if needed.\n"
                "2. Never narrate what you're about to do. Don't say 'Sure, let me "
                "check that!' — just do it and report what happened.\n"
                "3. Answer in 1-3 sentences maximum for simple questions.\n"
                "4. For multi-item outputs (emails, reminders, news, briefings): "
                "bullet list — max 5 items, each under 15 words. Drop the rest "
                "unless Madan asks for more.\n"
                "5. End every response with exactly one of: ✅ Done | "
                "⚡ Needs your input | 📌 FYI only — this tag comes AFTER your real "
                "answer or question, it never replaces it. Never reply with just the "
                "tag alone; if you're asking for clarification, write the actual "
                "clarifying question first, then the tag.\n"
                "6. If the answer is yes or no, say yes or no first, "
                "then one sentence of context if needed.\n"
                "7. Never give tutorials, step-by-step guides, or long "
                "explanations unless specifically asked.\n"
                "8. Use plain conversational English for simple answers — no "
                "headers, no bullet lists, no code. But if Madan asks for "
                "multiple syntaxes, options, or steps, structure the answer "
                "with real markdown: a short bullet list for the items and a "
                "fenced code block for each code example — don't cram it "
                "all into one prose paragraph.\n"
                "9. Never show code unless Madan explicitly asks for it. "
                "When he does: wrap multi-line code in fenced code blocks "
                "(```language ... ```). Use single backticks only for short "
                "inline references like `.filter()`.\n"
                "10. Never suggest Madan install or set up things already "
                "built into his system.\n\n"

                "MADAN'S SYSTEM — real facts only, never guess or invent:\n"
                "- Project folder: /Users/madansaidaram/Desktop/Daily_AI_updates\n"
                "- Main app file: V3_updates.py in that folder\n"
                "- Database: agent_memory.db in the project folder\n"
                "- Deployed on Render (always-on cloud hosting)\n"
                "- Reminders fire via WhatsApp using Twilio (already configured)\n"
                "- Emails triage to WhatsApp every hour\n"
                "- Briefings go to WhatsApp\n"
                f"{gmail_fact_line}"
                f"{pipeline_fact_line}"
                "- Calendar features are built in (e.g. 'what's on my calendar "
                "today', 'put a meeting tomorrow at 3pm') — but do NOT claim "
                "calendar access definitely works OR definitely doesn't until "
                "OAuth re-authorization is confirmed.\n"
                "- These facts describe your OWN system only. If asked specifically whether YOU "
                "(JARVIS) have some feature/capability not listed above (e.g. 'can you do X', "
                "'do you have a Y feature'), say plainly you don't have that capability — never "
                "invent one, and never tell Madan to go check his own project folder for it. This "
                "restriction does NOT apply to general knowledge questions (news, concepts, how "
                "something works, advice, etc.) — answer those normally and fully using what you "
                "actually know, exactly like any knowledgeable assistant would.\n\n"

                "WHAT YOU CANNOT DO — never fake this:\n"
                "You are NOT shown Madan's actual reminders, emails, drafts, or "
                "live schedule in this conversation. You have NO ability to "
                "actually create reminders, send emails, save files, or perform "
                "real actions here — ever, under any circumstances.\n"
                "NEVER claim you did something that didn't happen. No 'Draft "
                "created!', no 'Email sent!', no 'Reminder scheduled!' — unless "
                "a real action route triggered it and confirmed it.\n"
                "Seeing something discussed in past messages does NOT mean it just "
                "happened again. If Madan asks to repeat or resend something, "
                "tell him plainly this phrasing didn't trigger a real action and "
                "suggest rephrasing — e.g. 'draft an email to x@example.com "
                "about...' — instead of faking a success.\n\n"

                "FILES & CODE — you are blind to them here:\n"
                "You CANNOT see the contents of any file in Madan's project "
                "(V3_updates.py, the database, anything) in this conversation. You have "
                "no file access unless a real file command runs — e.g. 'read file "
                "V3_updates.py', which goes through the local bridge on his Mac. So:\n"
                "- NEVER reproduce, rewrite, summarize, or output the contents of "
                "V3_updates.py or any of his real files from memory. You do not know "
                "what is in them, and guessing produces a fabricated file.\n"
                "- NEVER hand him a 'full updated file' or invent code and present it as "
                "his actual codebase — pasting that in could overwrite real work.\n"
                "- If he asks you to read, show, fix, or rewrite one of his files, say "
                "plainly you cannot see his files from here, and tell him to run the file "
                "command (e.g. 'read file <name>') — which needs the local bridge running "
                "(he starts it with start-bridge on his Mac) — or to make code changes "
                "through Claude Code directly. Then stop; do not guess at the contents.\n"
                "- General coding questions (how does X work, syntax, a concept) you "
                "answer normally — this restriction is ONLY about his specific files.\n\n"

                f"Facts about Madan:\n{facts_str}\n\n"
                f"Relevant context:\n{context_str}"
                f"{reply_style_block}"
            )
        else:
            system_prompt = (
                f"You are the user's Curriculum Coach and AI Architect.\n"
                f"Facts about user:\n{facts_str}\n\nContext:\n{context_str}\n\n"
                f"RULES: 2-4 sentences max. Use asterisks (*) for bold. End with one open-ended learning question."
                f"{reply_style_block}"
            )
        system_msg = {"role": "system", "content": system_prompt}
        t_reply = time.time()
        ai_response = (await _complete_with_fallback(
            [system_msg] + chat_history + [{"role": "user", "content": user_message}],
            max_tokens=800,
        )).strip()
        print(f"⏱️ [process_message] general-chat reply call took {time.time() - t_reply:.2f}s")
        await log_chat_message("assistant", ai_response)

        if "to *Advanced*" in ai_response:
            await update_db_skill("Advanced")
        elif "to *Foundational*" in ai_response:
            await update_db_skill("Foundational")

        # Fire-and-forget: this LLM call only saves background memory facts, it has
        # no bearing on ai_response, so it must not block the user's reply latency.
        asyncio.create_task(extract_and_save_facts(user_message, ai_response))

    except Exception as e:
        print(f"❌ Webhook LLM error: {e}")
        ai_response = "⚠️ Coaching engine interrupted. Check console logs."

    return ai_response


@app.post("/whatsapp-webhook")
async def incoming_whatsapp_reply(Body: str = Form(...)):
    reply = await process_message(Body.strip())
    if reply:
        try:
            send_whatsapp_chunked(reply)
        except Exception as e:
            print(f"❌ Twilio dispatch failed: {e}")
    return Response(content="<Response></Response>", media_type="text/xml")


@app.get("/chat-history")
async def chat_history_api(limit: int = 50):
    """Recent persisted chat_history rows, oldest first — lets the web UI
    re-render the conversation on page refresh instead of starting blank."""
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute(
            "SELECT role, content, timestamp FROM chat_history ORDER BY id DESC LIMIT ?",
            (limit,)
        ) as cursor:
            rows = await cursor.fetchall()
    messages = [{"role": r[0], "content": r[1], "timestamp": r[2]} for r in reversed(rows)]
    return JSONResponse({"messages": messages})


# ── Application Tracker web UI (kanban board) — read + update + remove ──
@app.get("/applications")
async def applications_list_api():
    apps = await list_applications()
    # Stamp each card with its latest ATS match score + recruiter fit score (only cards that
    # have been analysed / reviewed get one — the board shows both, clearly labelled).
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
        a["apply_method"] = apply_method(a)  # 'email' (can auto-send) or 'link' (apply on site)
        a["news_count"] = news_counts.get((a.get("company") or "").strip().lower(), 0)
    return JSONResponse({"applications": apps, "statuses": APPLICATION_STATUSES})


@app.get("/api/applications/{app_id}/intel")
async def api_application_intel(app_id: int):
    """Company intel for a card's ⋯ menu: recent news signals + any interview-prep brief."""
    from company_watch_agent import list_company_news, get_interview_brief
    apps = await list_applications()
    app = next((a for a in apps if a.get("id") == app_id), None)
    if not app:
        return JSONResponse({"news": [], "brief": None})
    news = await list_company_news(app.get("company"), limit=8)
    brief = await get_interview_brief(app_id)
    return JSONResponse({"company": app.get("company"), "news": news, "brief": brief})


# ── Trend Lab — weekly app-idea discovery from Reddit + YouTube ──
@app.get("/api/trends")
async def trends_list_api(status: str = ""):
    ideas = await list_trend_ideas(status=status or None)
    return JSONResponse({"ideas": ideas})


@app.get("/api/trends/stats")
async def trends_stats_api():
    return JSONResponse(await trend_lab_stats())


@app.get("/api/trends/pulse")
async def trends_pulse_api(domain: str = "", limit: int = 40):
    """Unified 'what's hot in my domains' — a read-time UNION of Trend Lab ideas (Reddit/HN) and
    the influencer feed (YouTube/RSS), normalized and blended into one ranked list. No new table."""
    dom = (domain or "").strip().lower()
    ideas = await list_trend_ideas(limit=30)
    from influencer_agent import get_feed
    posts = await get_feed(limit=30, only_relevant=True, domain=domain.strip())

    items = []
    for it in ideas:
        if dom:
            hay = f"{it.get('title','')} {it.get('pain','')}".lower()
            if not any(tok in hay for tok in dom.split()):
                continue
        items.append({
            "type": "idea", "title": it.get("title", ""), "summary": it.get("pain", ""),
            "url": "", "source": ", ".join(it.get("sources", [])) or "reddit", "domain": "",
            "score": min(100, int(it.get("total_score") or 0)), "when": it.get("created_at") or "",
            "status": it.get("status"), "id": it.get("id"),
        })

    now = dt.datetime.now(dt.timezone.utc)
    for p in posts:
        score = 55
        try:
            seen = dt.datetime.fromisoformat((p.get("seen_at") or "").replace("Z", "+00:00"))
            if seen.tzinfo is None:
                seen = seen.replace(tzinfo=dt.timezone.utc)
            age_days = (now - seen).total_seconds() / 86400.0
            score = int(max(50, 74 - age_days * 2))
        except Exception:
            pass
        items.append({
            "type": "post", "title": p.get("title", ""), "summary": p.get("relevance_note", ""),
            "url": p.get("url", ""), "source": p.get("name") or p.get("platform") or "feed",
            "domain": p.get("domain", ""), "score": score, "when": p.get("seen_at") or "",
        })

    items.sort(key=lambda x: x["score"], reverse=True)
    return JSONResponse({"items": items[:limit]})


@app.post("/api/trends/scan")
async def trends_scan_api():
    """Manual 'scan now' from the console. Runs the full fetch→cluster→score pipeline."""
    summary = await run_trend_scan(call_llm, notify_fn=lambda msg, cat="trends": _store_notification(msg, cat))
    return JSONResponse({"ok": True, **summary})


@app.post("/api/trends/{idea_id}/status")
async def trends_status_api(idea_id: int, request: Request):
    try:
        status = (await request.json()).get("status", "")
    except Exception:
        status = ""
    return JSONResponse(await set_trend_idea_status(idea_id, status))


@app.post("/api/trends/{idea_id}/brief")
async def trends_brief_generate_api(idea_id: int):
    """Generate (or refresh) a lean MVP build brief for one idea."""
    result = await generate_build_brief(idea_id, call_llm)
    if result.get("error"):
        return JSONResponse({"error": result["error"]}, status_code=400)
    return JSONResponse(result)


@app.get("/api/trends/{idea_id}/brief")
async def trends_brief_get_api(idea_id: int):
    brief = await get_build_brief(idea_id)
    if not brief:
        return JSONResponse({"error": "no brief"}, status_code=404)
    return JSONResponse(brief)


@app.post("/api/trends/{idea_id}/market-validation")
async def trends_market_validation_generate_api(idea_id: int):
    """Generate live search grounded market validation for a trend idea."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT title, summary, pain FROM trend_ideas WHERE id = ?", (idea_id,)
        )
        row = await cur.fetchone()
    if not row:
        return JSONResponse({"error": "Trend idea not found"}, status_code=404)
    
    title = row["title"]
    summary = row["summary"]
    pain = row["pain"] or ""

    prompt = (
        f"You are JARVIS. Perform a real-time Google Search market validation for the following app idea:\n"
        f"TITLE: {title}\n"
        f"SUMMARY/PAIN: {summary} (Pain: {pain})\n\n"
        f"Search for:\n"
        f"1. Existing apps, SaaS platforms, or Chrome extensions solving this exact pain point.\n"
        f"2. GitHub open-source repositories doing similar things.\n"
        f"3. Highlight 3 direct competitors, their pricing models (if visible), and potential product gaps we can exploit.\n"
        f"Format your response as a professional Market Validation & Competitor Brief."
    )

    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"googleSearch": {}}]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini Grounding API returned {res.status_code}"}, status_code=500)

        data = res.json()
        candidate = data["candidates"][0]
        text = candidate["content"]["parts"][0]["text"]
        
        grounding_meta = candidate.get("groundingMetadata") or {}
        search_chunks = grounding_meta.get("groundingChunks") or []
        citations = []
        for chk in search_chunks:
            web = chk.get("web")
            if web:
                citations.append({"title": web.get("title", "Source"), "url": web.get("uri", "#")})

        result = {
            "validation": text,
            "citations": citations[:6]
        }

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE trend_ideas SET market_validation = ?, updated_at = ? WHERE id = ?",
                (json.dumps(result), datetime.now(timezone.utc).isoformat(), idea_id)
            )
            await db.commit()

        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": f"Validation failed: {str(e)}"}, status_code=500)


@app.get("/api/trends/{idea_id}/market-validation")
async def trends_market_validation_get_api(idea_id: int):
    """Retrieve cached market validation for a trend idea."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT market_validation FROM trend_ideas WHERE id = ?", (idea_id,))
        row = await cur.fetchone()
    if not row or not row["market_validation"]:
        return JSONResponse({"error": "No market validation found"}, status_code=404)
    try:
        return JSONResponse(json.loads(row["market_validation"]))
    except Exception:
        return JSONResponse({"error": "Invalid validation cache"}, status_code=500)


@app.post("/cron/trend-scan")
async def cron_trend_scan(token: str = ""):
    """Weekly external trigger (cron-job.org). Fetches + clusters + scores app ideas."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    _run_bg_job("trend-scan", lambda: run_trend_scan(
        call_llm, notify_fn=lambda msg, cat="trends": _store_notification(msg, cat)))
    return JSONResponse({"status": "trend scan triggered"}, status_code=202)


# ── Job Scout review queue — per-job review popup (fresh matches awaiting a decision) ──
@app.get("/api/job-scout/review-queue")
async def api_review_queue():
    """Fresh scout matches (reviewed=0), enriched with the LLM match score/why/flags and the
    ATS score if already analysed. Full ATS keyword matrix is lazy-loaded via /ats/<job_ref>."""
    cards = await list_review_queue()
    keys = [(c.get("job_key") or f"app:{c['id']}") for c in cards]
    scores = await get_ats_scores_map(keys)
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT job_key, score, why, flags FROM matched_jobs")
        mj = {r["job_key"]: dict(r) for r in await cur.fetchall()}
    out = []
    for c in cards:
        jk = c.get("job_key") or f"app:{c['id']}"
        s = scores.get(jk)
        m = mj.get(c.get("job_key"), {})
        out.append({
            "id": c["id"], "job_key": c.get("job_key"), "title": c.get("title"),
            "company": c.get("company"), "location": c.get("location"), "source": c.get("source"),
            "url": c.get("url"), "description": c.get("description"), "status": c.get("status"),
            "match_score": m.get("score"), "why": m.get("why"), "flags": m.get("flags"),
            "ats_score": s["ats_score"] if s else None,
            "ats_pending": not (s and s.get("ats_score") is not None),
            "apply_method": apply_method(c),  # 'email' (can auto-send) or 'link' (apply on site)
        })
    return JSONResponse({"queue": out, "statuses": APPLICATION_STATUSES})


@app.get("/api/job-scout/review-queue/count")
async def api_review_queue_count():
    return JSONResponse({"count": await count_review_queue()})


@app.post("/api/job-scout/search-now")
async def api_search_now(request: Request):
    """Console 'Find jobs now' — runs a live search and drops the top matches into the NEW lane
    (reviewed=0), so on-demand search feeds the same triage funnel as the daily digest."""
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    override = {}
    if (body.get("role") or "").strip():
        override["role"] = body["role"].strip()
    if (body.get("location") or "").strip():
        override["query_location"] = body["location"].strip()
    try:
        res = await search_now_to_board(call_llm, override=override or None, track_fn=add_scout_application)
    except Exception as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    return JSONResponse({"ok": True, **res})


@app.post("/api/job-scout/ats-search")
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

    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body_data = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"googleSearch": {}}]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body_data)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini Grounding API returned {res.status_code}: {res.text[:200]}"}, status_code=500)

        data = res.json()
        candidate = data["candidates"][0]
        text = candidate["content"]["parts"][0]["text"]
        
        jobs = _parse_json_object(text)
        if not isinstance(jobs, list):
            jobs = jobs.get("jobs") if isinstance(jobs, dict) else []

        return JSONResponse({"jobs": jobs})
    except Exception as e:
        return JSONResponse({"error": f"ATS Search failed: {str(e)}"}, status_code=500)


@app.get("/api/skill-gap")
async def api_skill_gap():
    """Market demand vs résumé coverage, aggregated from every analysed job's keyword matrix.
    Pure read over ats_analysis_cache — no LLM cost."""
    return JSONResponse(await skill_gap_summary())


@app.get("/api/response-analytics")
async def api_response_analytics():
    """Funnel + response-rate/ghost-rate/source-yield over the applications + event ledger."""
    return JSONResponse(await response_analytics())


# ── Recruiter follow-up (stale 'applied' cards → drafted follow-up → 1-tap Gmail send) ──
@app.get("/api/followups")
async def api_followups():
    """Stale candidates, each tagged `ready` if a follow-up has already been auto-drafted for it."""
    cands = await list_followup_candidates()
    ready = {d["app_id"] for d in await list_followup_drafts()}
    for c in cands:
        c["ready"] = c["id"] in ready
    return JSONResponse({"candidates": cands})


@app.post("/api/followups/{app_id}/draft")
async def api_followup_draft(app_id: int):
    """Return the auto-drafted follow-up if one is waiting (instant); otherwise draft it now
    and store it so it's reusable."""
    existing = await get_open_draft(app_id)
    if existing:
        card = await get_application(app_id)
        return JSONResponse({
            "ok": True, "subject": existing["subject"], "body": existing["body"],
            "recipient": existing["recipient"],
            "card": {"id": app_id, "title": (card or {}).get("title"),
                     "company": (card or {}).get("company")},
        })
    try:
        prof = await get_job_profile()
    except Exception:
        prof = None
    res = await draft_followup(app_id, call_llm, profile=prof)
    if res.get("ok"):
        await store_followup_draft(app_id, res.get("recipient"), res.get("subject"), res.get("body"))
    return JSONResponse(res)


@app.post("/api/followups/send")
async def api_followup_send(request: Request):
    """Send a follow-up. The Send click IS the approval. SAFE_MODE short-circuits the real send."""
    body = await request.json()
    to = (body.get("to") or "").strip()
    subject = (body.get("subject") or "").strip()
    text = body.get("body") or ""
    app_id = body.get("app_id")
    if SAFE_MODE:
        if app_id:
            await mark_draft_status(int(app_id), "sent")
        return JSONResponse({"ok": True, "message": f"[SAFE_MODE] Would send to {to}."})

    async def _send(to_addr, subj, b):
        return await send_composed_email(to_addr, subj, b)

    res = await send_followup(to, subject, text, _send)
    if res.get("ok") and app_id:
        await mark_draft_status(int(app_id), "sent")
    return JSONResponse(res)


@app.get("/api/applications/{app_id}/emails")
async def api_application_emails(app_id: int):
    """Per-company e-mail timeline for one card (Gmail search by company/domain)."""
    card = await get_application(app_id)
    if not card:
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    threads = await search_company_threads(card.get("company") or "")
    return JSONResponse({"ok": True, "company": card.get("company"), "threads": threads})


# ── Interview Prep Dock (upcoming calendar interviews → on-demand LLM prep brief) ──
@app.get("/api/interviews")
async def api_interviews():
    return JSONResponse({"interviews": await list_interview_events()})


@app.post("/api/interviews/prep")
async def api_interview_prep(request: Request):
    body = await request.json()
    event = {
        "id": body.get("id"), "summary": body.get("summary"),
        "start": body.get("start"), "end": body.get("end"),
        "attendees": body.get("attendees"), "role": body.get("role"),
        "company": body.get("company"),
    }
    app_row = None
    if body.get("matched_app_id"):
        app_row = await get_application(int(body["matched_app_id"]))
    return JSONResponse(await prep_brief(event, call_llm, app=app_row))


# ── Workspace Notes (DB-backed markdown scratchpad) ──
@app.get("/api/notes")
async def api_notes_list():
    return JSONResponse({"notes": await list_notes()})


@app.post("/api/notes")
async def api_notes_create(request: Request):
    body = await request.json()
    note = await create_note(body.get("title", ""), body.get("body", ""))
    return JSONResponse({"ok": True, "note": note})


@app.post("/api/notes/{note_id}")
async def api_notes_update(note_id: int, request: Request):
    body = await request.json()
    note = await update_note(note_id, title=body.get("title"), body=body.get("body"),
                             pinned=body.get("pinned"))
    return JSONResponse({"ok": True, "note": note})


@app.post("/api/notes/{note_id}/delete")
async def api_notes_delete(note_id: int):
    await delete_note(note_id)
    return JSONResponse({"ok": True})


# ── Networking CRM (contacts + follow-up cadence) ──
@app.get("/api/contacts")
async def api_contacts_list():
    return JSONResponse({"contacts": await list_contacts(), "relationships": CONTACT_RELATIONSHIPS})


@app.post("/api/contacts")
async def api_contacts_add(request: Request):
    return JSONResponse({"ok": True, "contact": await add_contact(await request.json())})


@app.post("/api/contacts/{cid}")
async def api_contacts_update(cid: int, request: Request):
    return JSONResponse({"ok": True, "contact": await update_contact(cid, await request.json())})


@app.post("/api/contacts/{cid}/contacted")
async def api_contacts_contacted(cid: int):
    return JSONResponse({"ok": True, "contact": await mark_contacted(cid)})


@app.post("/api/contacts/{cid}/delete")
async def api_contacts_delete(cid: int):
    await delete_contact(cid)
    return JSONResponse({"ok": True})


# ── People Watch — watch a contact's free feeds → networking nudges ──
@app.get("/api/contacts/{cid}/feeds")
async def api_contact_feeds(cid: int):
    from people_watch_agent import list_contact_feeds
    return JSONResponse(await list_contact_feeds(cid))


@app.post("/api/contacts/{cid}/feeds")
async def api_contact_feeds_add(cid: int, request: Request):
    from people_watch_agent import add_contact_feed
    body = await request.json()
    res = await add_contact_feed(cid, body.get("platform", ""), body.get("handle", ""), body.get("name", ""))
    return JSONResponse(res, status_code=200 if res.get("ok") else 400)


@app.post("/api/contacts/feeds/{feed_id}/delete")
async def api_contact_feed_delete(feed_id: int):
    from people_watch_agent import delete_contact_feed
    return JSONResponse(await delete_contact_feed(feed_id))


@app.get("/api/contacts/nudges")
async def api_contacts_nudges():
    from people_watch_agent import get_nudges
    return JSONResponse(await get_nudges())


@app.post("/api/contacts/nudges/{post_id}/dismiss")
async def api_contacts_nudge_dismiss(post_id: str):
    from people_watch_agent import dismiss_nudge
    return JSONResponse(await dismiss_nudge(post_id))


@app.post("/cron/people-watch")
async def cron_people_watch(token: str = ""):
    """Daily: scrape watched contacts' free feeds → networking nudges. Fire once/day."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    from people_watch_agent import run_people_watch
    _run_bg_job("people-watch", lambda: run_people_watch(call_llm))
    return JSONResponse({"status": "people watch triggered"}, status_code=202)


@app.post("/api/people-watch/run")
async def api_people_watch_run():
    from people_watch_agent import run_people_watch
    return JSONResponse({"ok": True, "result": await run_people_watch(call_llm)})


# ── Profile-Freshness ──
@app.get("/api/profile-freshness")
async def api_profile_freshness():
    return JSONResponse({"assets": await list_profile_assets()})


@app.post("/api/profile-freshness")
async def api_profile_freshness_add(request: Request):
    body = await request.json()
    await add_profile_asset(body.get("name", ""), body.get("url", ""),
                            body.get("interval_days", 30))
    return JSONResponse({"ok": True, "assets": await list_profile_assets()})


@app.post("/api/profile-freshness/{asset_id}/updated")
async def api_profile_freshness_mark(asset_id: int):
    await mark_asset_updated(asset_id)
    return JSONResponse({"ok": True, "assets": await list_profile_assets()})


@app.post("/api/profile-freshness/{asset_id}")
async def api_profile_freshness_update(asset_id: int, request: Request):
    body = await request.json()
    await update_profile_asset(asset_id, url=body.get("url"),
                               interval_days=body.get("interval_days"))
    return JSONResponse({"ok": True, "assets": await list_profile_assets()})


@app.post("/api/profile-freshness/{asset_id}/delete")
async def api_profile_freshness_delete(asset_id: int):
    await delete_profile_asset(asset_id)
    return JSONResponse({"ok": True, "assets": await list_profile_assets()})


# ── Calendar Shield ──
@app.get("/api/calendar-shield")
async def api_calendar_shield():
    return JSONResponse(await calendar_shield_analyze())


# ── Home cockpit — greeting + prioritized next-steps + pipeline pulse (no LLM) ──
@app.get("/api/cockpit")
async def api_cockpit():
    return JSONResponse(await cockpit_brief())


# ── Voice Daily Standup ──
@app.get("/api/standup")
async def api_standup():
    return JSONResponse(await standup_briefing(call_llm))


@app.get("/api/tts/available")
async def api_tts_available():
    """Tells the console whether the natural (Gemini) voice can be offered, plus the voice list."""
    return JSONResponse({
        "available": gemini_tts_available(),
        "default": GEMINI_DEFAULT_VOICE,
        "voices": [{"name": n, "style": s} for n, s in GEMINI_VOICES],
    })


@app.post("/api/tts")
async def api_tts(request: Request):
    """Synthesize text to a natural voice via Gemini TTS. Opt-in only (the console calls this
    when the user enables the natural voice). Returns WAV audio, or 204 so the console falls
    back to the free browser voice on any failure/quota — never an error the user sees."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    if not text:
        return Response(status_code=204)
    audio = await gemini_synthesize(text, voice=body.get("voice"))
    if not audio:
        return Response(status_code=204)  # signal: fall back to browser TTS
    return Response(content=audio, media_type="audio/wav")


@app.post("/api/job-scout/review/{app_id}/decide")
async def api_review_decide(app_id: int, request: Request):
    """Resolve a reviewed match. action='skip' just clears it from the queue; action='apply'
    moves the card to the chosen stage (default 'applied') AND fires apply-prep for it (tailored
    resume + cover note; email-apply jobs honor the confirm-first setting)."""
    body = await request.json()
    action = (body.get("action") or "").strip().lower()
    card = await get_application(app_id)
    if not card:
        return JSONResponse({"ok": False, "error": "not found"}, status_code=404)
    if action == "skip":
        # Discard a fresh match you don't want. seen_jobs already blocks it from re-appearing,
        # so removing the card is safe. Clean its ATS cache so counts don't orphan.
        await delete_ats_analysis(card.get("job_key") or f"app:{app_id}")
        await delete_application(app_id)
        return JSONResponse({"ok": True, "outcome": "skipped"})
    if action == "save":
        # Keep it on the board as a chosen "interested" card — just clear it from the New lane.
        await update_application_status_by_id(app_id, "interested")
        await mark_reviewed(app_id)
        return JSONResponse({"ok": True, "outcome": "saved"})
    if action == "apply":
        stage = body.get("status") or "applied"
        await update_application_status_by_id(app_id, stage)
        await mark_reviewed(app_id)
        job = {"key": card.get("job_key"), "title": card.get("title"),
               "company": card.get("company"), "location": card.get("location"),
               "url": card.get("url"), "description": card.get("description"),
               "source": card.get("source")}
        try:
            prof = await get_job_profile()
        except Exception:
            prof = None
        # Card already exists — don't re-track; just prep + route.
        res = await apply_now(job, call_llm, notify_fn=send_whatsapp_chunked, profile=prof)
        return JSONResponse({"ok": True, "outcome": res.get("outcome"),
                             "message": res.get("message"), "stage": stage})
    return JSONResponse({"ok": False, "error": "unknown action"}, status_code=400)


@app.post("/applications/update")
async def applications_update_api(request: Request):
    body = await request.json()
    ok, result = await update_application_status_by_id(int(body.get("id")), body.get("status", ""))
    return JSONResponse({"ok": ok, "result": result}, status_code=200 if ok else 400)


@app.post("/applications/delete")
async def applications_delete_api(request: Request):
    body = await request.json()
    app_id = int(body.get("id"))
    # Drop the card's cached ATS analysis too, so it can't orphan and inflate the counts.
    app_row = await get_application(app_id)
    if app_row:
        await delete_ats_analysis(app_row.get("job_key") or f"app:{app_id}")
    await delete_application(app_id)
    return JSONResponse({"ok": True})


@app.post("/applications/add-manual")
async def applications_add_manual_api(request: Request):
    """Manually track a job the user applied to elsewhere (LinkedIn, Naukri, a
    company careers page…). Not from Job Scout — the user types the details in."""
    body = await request.json()
    title = (body.get("title") or "").strip()
    if not title:
        return JSONResponse({"ok": False, "error": "Job title is required."}, status_code=400)
    company = (body.get("company") or "").strip()
    location = (body.get("location") or "").strip()
    url = (body.get("url") or "").strip()
    # "source" = where they applied (portal/site); defaults to a generic manual tag.
    source = (body.get("source") or "").strip() or "Manual"
    status = (body.get("status") or "applied").strip() or "applied"
    # Stable-ish key so an accidental double-submit dedups, but distinct roles stay distinct.
    slug = re.sub(r"[^a-z0-9]+", "-", f"{title} {company} {location}".lower()).strip("-")
    job = {
        "key": f"manual:{slug}" if slug else f"manual:{int(time.time())}",
        "title": title, "company": company, "location": location,
        "url": url, "source": source,
        "description": (body.get("description") or "").strip() or None,
        "notes": (body.get("notes") or "").strip() or None,
    }
    ok, msg = await add_application(job, status=status)
    app_id = None
    if ok:
        async with aiosqlite.connect(DB_PATH) as db:
            async with db.execute("SELECT id FROM applications WHERE job_key = ?", (job["key"],)) as cur:
                row = await cur.fetchone()
                if row:
                    app_id = row[0]
    return JSONResponse({"ok": ok, "result": msg, "id": app_id}, status_code=200 if ok else 200)



@app.post("/applications/scan")
async def applications_scan_api():
    """On-demand email→board scan that RETURNS its result (unlike the background cron path),
    so the UI can show exactly what happened — moved / added / needs-confirmation / nothing."""
    summary = await scan_application_emails(call_llm, _store_notification)
    return JSONResponse(summary)


@app.get("/applications/pending")
async def applications_pending_api():
    """Low-confidence / ambiguous email→board suggestions awaiting the user's confirmation."""
    return JSONResponse({"pending": await list_application_pending()})


@app.post("/applications/pending/{pending_id}/confirm")
async def applications_pending_confirm_api(pending_id: int):
    ok, msg = await confirm_application_pending(pending_id)
    return JSONResponse({"ok": ok, "result": msg}, status_code=200)


@app.post("/applications/pending/{pending_id}/dismiss")
async def applications_pending_dismiss_api(pending_id: int):
    await dismiss_application_pending(pending_id)
    return JSONResponse({"ok": True})


# ── Resume ATS alignment (on-demand per application) ──
@app.get("/resume/status")
async def resume_status_api():
    return JSONResponse({"has_resume": bool((await get_resume_template()).strip())})


@app.get("/resume")
async def resume_get_api():
    return JSONResponse({"content": await get_resume_template()})


@app.post("/resume/upload")
async def resume_upload_api(request: Request):
    body = await request.json()
    content = (body.get("content") or "").strip()
    if not content:
        return JSONResponse({"ok": False, "error": "empty resume"}, status_code=400)
    await save_resume_template(content)
    return JSONResponse({"ok": True})


@app.post("/resume/delete")
async def resume_delete_api():
    """Wipe the stored master résumé (text + original .docx + cached audit) for a clean
    re-upload. Per-job ATS analyses are kept. The console guards this behind a confirm."""
    return JSONResponse(await delete_resume_template())


def _extract_resume_text(filename: str, data: bytes) -> str:
    """Extract plain text from an uploaded résumé — PDF, DOCX, or TXT.
    Detects formats defensively via magic bytes to prevent BadZipFile crashes."""
    # 1. Inspect file header magic bytes
    if data.startswith(b"%PDF-"):
        return extract_pdf_text(data) or ""
    if data.startswith(b"PK\x03\x04"):
        import docx2txt, io
        try:
            return (docx2txt.process(io.BytesIO(data)) or "").strip()
        except Exception:
            pass # fall back to extension matching if it fails
    if data.startswith(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1"):
        raise ValueError("This is an older Word Document (.doc) format. Please 'Save As' modern Word Document (.docx) or PDF and try again.")

    # 2. Fall back to extension matching
    name = (filename or "").lower()
    if name.endswith(".pdf"):
        return extract_pdf_text(data) or ""
    if name.endswith(".docx"):
        import docx2txt, io
        try:
            return (docx2txt.process(io.BytesIO(data)) or "").strip()
        except Exception as e:
            raise ValueError(f"File is not a valid modern Word Document (.docx). Details: {e}")
    if name.endswith(".txt"):
        return data.decode("utf-8", errors="ignore").strip()
    return ""


@app.post("/resume/upload-file")
async def resume_upload_file_api(file: UploadFile = File(...)):
    """Upload a résumé as a PDF / DOCX / TXT file — extracts the text and saves it
    as the master résumé template. Old binary .doc isn't supported (ask for PDF/DOCX)."""
    name = (file.filename or "").lower()
    if not name.endswith((".pdf", ".docx", ".txt")):
        hint = " Save it as PDF or DOCX and try again." if name.endswith(".doc") else ""
        return JSONResponse(
            {"ok": False, "error": f"Unsupported file type.{hint} Use PDF, DOCX, or TXT."},
            status_code=400,
        )
    try:
        data = await file.read()
        text = _extract_resume_text(file.filename, data)
        # Keep the raw .docx so we can later edit it in place (format-preserving).
        is_docx = name.endswith(".docx")
        docx_bytes = data if is_docx else None
        del data
        _malloc_trim()
    except Exception as e:
        print(f"❌ resume upload-file extraction error for {file.filename}: {e}")
        return JSONResponse({"ok": False, "error": f"Couldn't read that file: {e}"}, status_code=400)

    text = (text or "").strip()
    if not text:
        return JSONResponse(
            {"ok": False, "error": "No text found (a scanned/image-only PDF won't work — use a text PDF or DOCX)."},
            status_code=400,
        )
    await save_resume_template(text)
    if docx_bytes is not None:
        await save_master_docx(file.filename, docx_bytes)
    return JSONResponse({"ok": True, "content": text, "chars": len(text), "docx": docx_bytes is not None})


@app.post("/applications/{app_id}/ats")
async def application_ats_api(app_id: int, request: Request):
    """Run (or refresh) the ATS resume analysis for one tracked application, on demand.
    Cards added manually / from email / from a quick-apply arrive with no job description,
    so ATS has nothing to score against. In that case we return needs_jd=True and the UI
    prompts the user to paste the posting; the pasted JD is saved onto the card (once) and
    used from then on."""
    app_row = await get_application(app_id)
    if not app_row:
        return JSONResponse({"error": "application not found"}, status_code=404)

    # Optional pasted job description — persist it to the card, then analyse against it.
    pasted_jd = ""
    try:
        body = await request.json()
        pasted_jd = (body.get("job_description") or "").strip()
    except Exception:
        pasted_jd = ""
    if pasted_jd:
        await update_application_description(app_id, pasted_jd)

    description = pasted_jd or (app_row.get("description") or "").strip()
    if not description:
        return JSONResponse({
            "needs_jd": True,
            "title": app_row.get("title"),
            "company": app_row.get("company"),
            "message": "This job has no description saved. Paste the job posting so I can score your résumé against it.",
        })

    job = {"key": app_row.get("job_key") or f"app:{app_id}", "title": app_row.get("title"),
           "company": app_row.get("company"), "location": app_row.get("location"),
           "description": description}
    result = await run_ats_analysis(job, call_llm)
    if result.get("error"):
        return JSONResponse({"error": result["error"]}, status_code=400)
    return JSONResponse(result)


@app.get("/ats/{job_ref}")
async def ats_get_api(job_ref: str):
    a = await get_ats_analysis(job_ref)
    if not a:
        return JSONResponse({"error": "no analysis"}, status_code=404)
    await mark_ats_viewed(job_ref)
    return JSONResponse(a)


@app.post("/applications/{app_id}/recruiter-review")
async def application_recruiter_review_api(app_id: int, request: Request):
    """Run (or refresh) the recruiter's-eye feedback for one application — a separate on-demand
    LLM call from the ATS scorer (six-second test, strengths, red flags, learning roadmap).
    Same JD-needed handling as the ATS endpoint."""
    app_row = await get_application(app_id)
    if not app_row:
        return JSONResponse({"error": "application not found"}, status_code=404)
    pasted_jd = ""
    try:
        body = await request.json()
        pasted_jd = (body.get("job_description") or "").strip()
    except Exception:
        pasted_jd = ""
    if pasted_jd:
        await update_application_description(app_id, pasted_jd)
    description = pasted_jd or (app_row.get("description") or "").strip()
    if not description:
        return JSONResponse({
            "needs_jd": True,
            "title": app_row.get("title"),
            "company": app_row.get("company"),
            "message": "This job has no description saved. Paste the job posting so I can give recruiter feedback.",
        })
    job = {"key": app_row.get("job_key") or f"app:{app_id}", "title": app_row.get("title"),
           "company": app_row.get("company"), "location": app_row.get("location"),
           "description": description}
    result = await run_recruiter_review(job, call_llm)
    if result.get("error"):
        return JSONResponse({"error": result["error"]}, status_code=400)
    return JSONResponse(result)


@app.get("/ats/{job_ref}/recruiter-review")
async def recruiter_review_get_api(job_ref: str):
    r = await get_recruiter_review(job_ref)
    if not r:
        return JSONResponse({"error": "no review"}, status_code=404)
    return JSONResponse(r)


@app.get("/ats/{job_ref}/prep")
async def job_prep_get_api(job_ref: str):
    p = await get_job_prep(job_ref)
    if not p:
        return JSONResponse({"error": "no prep kit generated yet"}, status_code=404)
    return JSONResponse(p)


@app.post("/applications/{app_id}/prep")
async def application_job_prep_api(app_id: int, request: Request):
    """Run (or refresh) the outreach & STAR interview story preparation for one application —
    an on-demand LLM call. Tailored to your resume and this job posting."""
    app_row = await get_application(app_id)
    if not app_row:
        return JSONResponse({"error": "application not found"}, status_code=404)
    pasted_jd = ""
    try:
        body = await request.json()
        pasted_jd = (body.get("job_description") or "").strip()
    except Exception:
        pasted_jd = ""
    if pasted_jd:
        await update_application_description(app_id, pasted_jd)
    description = pasted_jd or (app_row.get("description") or "").strip()
    if not description:
        return JSONResponse({
            "needs_jd": True,
            "title": app_row.get("title"),
            "company": app_row.get("company"),
            "message": "This job has no description saved. Paste the job posting so I can prepare outreach & interview stories.",
        })
    job = {"key": app_row.get("job_key") or f"app:{app_id}", "title": app_row.get("title"),
           "company": app_row.get("company"), "location": app_row.get("location"),
           "description": description}
    result = await generate_job_prep(job, call_llm)
    if result.get("error"):
        return JSONResponse({"error": result["error"]}, status_code=400)
    return JSONResponse(result)


@app.get("/ats/{job_ref}/download")
async def ats_download_api(job_ref: str):
    a = await get_ats_analysis(job_ref)
    if not a:
        return JSONResponse({"error": "no analysis"}, status_code=404)
    fname = "".join(c for c in (a.get("company") or "resume") if c.isalnum())[:24] or "resume"
    return Response(
        content=a.get("downloadable_txt_content") or "",
        media_type="text/plain",
        headers={"Content-Disposition": f'attachment; filename="ATS_{fname}.txt"'},
    )


@app.post("/ats/{job_ref}/google-doc")
async def ats_google_doc_api(job_ref: str):
    """Create a Google Doc with the master résumé + the changes to make, return its URL."""
    a = await get_ats_analysis(job_ref)
    if not a:
        return JSONResponse({"ok": False, "error": "no analysis"}, status_code=404)
    master = await get_resume_template()
    if not (master or "").strip():
        return JSONResponse({"ok": False, "error": "No master résumé saved yet."}, status_code=400)
    try:
        loop = asyncio.get_running_loop()
        url = await loop.run_in_executor(
            None,
            lambda: create_resume_doc(master, a, a.get("job_title") or "Role", a.get("company") or "Company"),
        )
        return JSONResponse({"ok": True, "url": url})
    except Exception as e:
        msg = str(e)
        # A scope error means the refresh token predates the documents scope.
        if "insufficient" in msg.lower() or "scope" in msg.lower() or "permission" in msg.lower():
            msg = "Google Docs access isn't authorized yet — re-run the token step with the documents scope."
        print(f"❌ ats google-doc error for {job_ref}: {e}")
        return JSONResponse({"ok": False, "error": msg}, status_code=500)


@app.get("/ats/pending/count")
async def ats_pending_count_api():
    return JSONResponse({"count": await count_ats_unviewed()})


# ── Standalone résumé audit (job-agnostic health check) ──────────────────────
@app.get("/resume/audit")
async def resume_audit_get_api():
    return JSONResponse({"audit": await get_saved_audit()})


@app.post("/resume/audit")
async def resume_audit_run_api():
    result = await audit_resume(call_llm)
    if result.get("error"):
        return JSONResponse({"ok": False, "error": result["error"]}, status_code=400)
    return JSONResponse({"ok": True, "audit": result})


@app.post("/resume/auto-fix")
async def resume_auto_fix_api():
    """One-tap: apply the deterministic ATS fixes (single-column + SUMMARY heading) to the master
    résumé text and re-audit. Quantification is never auto-invented — it's returned as a count of
    bullets that still need real numbers from the user."""
    return JSONResponse(await auto_fix_resume(call_llm))


# ── Apply ATS changes to the original .docx (format-preserving, Option A) ─────
@app.get("/resume/docx-status")
async def resume_docx_status_api():
    return JSONResponse({"has_docx": await has_master_docx()})


@app.get("/resume/download")
async def resume_download_api():
    t = await get_master_docx()
    if not t:
        return JSONResponse({"error": "no master docx uploaded"}, status_code=404)
    filename, file_bytes = t
    return Response(
        content=file_bytes,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/resume/apply-audit")
async def resume_apply_audit_api(request: Request):
    """Apply the suggested grammar and wording fixes from the standalone Resume Audit
    directly to the master .docx file and update the master resume template."""
    audit = await get_saved_audit()
    if not audit:
        return JSONResponse({"ok": False, "error": "Run the Resume Audit first."}, status_code=400)
    
    master = await get_master_docx()
    if not master:
        return JSONResponse(
            {"ok": False, "error": "No master .docx found. Upload your résumé as a .docx file first."},
            status_code=400,
        )
    
    try:
        body = await request.json()
        approved_additions = body.get("additions", []) or []
        approved_rewrites = body.get("rewrites", []) or []
    except Exception:
        approved_additions = []
        approved_rewrites = []
    
    filename, docx_bytes = master
    
    if approved_rewrites:
        rewrites = [
            (r.get("original", ""), r.get("suggestion", ""))
            for r in approved_rewrites
            if (r.get("original") or "").strip() and (r.get("suggestion") or "").strip()
        ]
    else:
        grammar_items = audit.get("grammar", []) or []
        rewrites = [
            (g.get("original", ""), g.get("suggestion", ""))
            for g in grammar_items
            if (g.get("original") or "").strip() and (g.get("suggestion") or "").strip()
        ]
    
    loop = asyncio.get_running_loop()
    try:
        from resume_editor import apply_rewrites, append_bullet
        new_bytes, applied_list = await loop.run_in_executor(None, lambda: apply_rewrites(docx_bytes, rewrites))
        applied_count = len(applied_list)
        added_count = 0
        
        if approved_additions:
            line = "Additional skills: " + ", ".join(str(x) for x in approved_additions)
            new_bytes, ok = await loop.run_in_executor(None, lambda: append_bullet(new_bytes, "Skills", line))
            if ok:
                added_count = len(approved_additions)
        
        if applied_count > 0 or added_count > 0:
            # 1. Save the modified .docx to the database
            await save_master_docx(filename, new_bytes)
            
            # 2. Extract plain text and update the user_resume_templates
            text = _extract_resume_text(filename, new_bytes)
            if text:
                await save_resume_template(text)
            
            # 3. Automatically run a fresh audit to update the audit scores and priorities
            await audit_resume(call_llm)
    except Exception as e:
        print(f"❌ resume/apply-audit error: {e}")
        return JSONResponse({"ok": False, "error": f"Failed to apply suggestions: {e}"}, status_code=500)
        
    return JSONResponse({
        "ok": True,
        "applied_count": applied_count,
        "applied": [{"original": find, "suggestion": replace} for find, replace in applied_list],
        "added_count": added_count,
        "total": len(rewrites),
    })



@app.post("/ats/{job_ref}/apply-to-docx")
async def ats_apply_docx_api(job_ref: str, request: Request):
    """Auto-apply the rewrites to the stored master .docx (format preserved), plus any
    user-approved additions, and stash the tailored .docx for download."""
    a = await get_ats_analysis(job_ref)
    if not a:
        return JSONResponse({"ok": False, "error": "Run the ATS analysis first."}, status_code=400)
    master = await get_master_docx()
    if not master:
        return JSONResponse(
            {"ok": False, "error": "No .docx on file — re-upload your résumé as a .docx (PDFs can't be edited in place)."},
            status_code=400,
        )
    try:
        approved_additions = (await request.json()).get("additions", []) or []
    except Exception:
        approved_additions = []

    filename, docx_bytes = master
    breakdown = a.get("star_xyz_breakdown", []) or []
    rewrites = [
        (b.get("current_text", ""), b.get("optimized_text", ""))
        for b in breakdown
        if (b.get("current_text") or "").strip() and (b.get("optimized_text") or "").strip()
    ]

    loop = asyncio.get_running_loop()
    try:
        new_bytes, applied_list = await loop.run_in_executor(None, lambda: apply_rewrites(docx_bytes, rewrites))
        applied = len(applied_list)
        added = 0
        if approved_additions:
            line = "Additional skills: " + ", ".join(str(x) for x in approved_additions)
            new_bytes, ok = await loop.run_in_executor(None, lambda: append_bullet(new_bytes, "Skills", line))
            added = len(approved_additions) if ok else 0
    except Exception as e:
        print(f"❌ apply-to-docx error for {job_ref}: {e}")
        return JSONResponse({"ok": False, "error": f"Couldn't edit the .docx: {e}"}, status_code=500)

    out_name = f"Tailored_{(a.get('company') or 'resume')}.docx".replace(" ", "_")
    await save_tailored_docx(job_ref, out_name, new_bytes)
    return JSONResponse({
        "ok": True,
        "rewrites_applied": applied,
        "rewrites_total": len(rewrites),
        "rewrites_missed": len(rewrites) - applied,
        "additions_applied": added,
        "download": f"/ats/{job_ref}/tailored-docx",
    })


@app.get("/ats/{job_ref}/tailored-docx")
async def ats_tailored_docx_api(job_ref: str):
    t = await get_tailored_docx(job_ref)
    if not t:
        return JSONResponse({"error": "no tailored docx"}, status_code=404)
    filename, data = t
    return Response(
        content=data,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/chat-message")
async def chat_message(request: Request):
    body = await request.json()
    user_msg = body.get("message", "").strip()
    if not user_msg:
        return JSONResponse({"reply": "Please type a message."})
    
    # Secret trigger check for Project Believer (Private Encrypted Diary)
    msg_clean = user_msg.lower().strip()
    if msg_clean in ("/believer", "/pb") or "project believer" in msg_clean or "believer protocol" in msg_clean:
        return JSONResponse({
            "reply": "🔒 *Project Believer Initiated.* Opening encrypted vault...",
            "action": "open_believer_modal"
        })

    t0 = time.time()
    try:
        reply = await process_message(user_msg, source="web")
        print(f"⏱️ [chat-message] process_message took {time.time() - t0:.2f}s")
        return JSONResponse({"reply": reply or "✅ Done — check WhatsApp for details."})
    except Exception as e:
        print(f"❌ chat-message error after {time.time() - t0:.2f}s: {e}")
        return JSONResponse({"reply": "Something went wrong. Try again."})



PDF_SUMMARY_PROMPT = (
    "You are JARVIS. The user just handed you a PDF. Read the extracted text and brief them "
    "on it the way a composed, sharp assistant would — 2-4 sentences on what it actually is and "
    "the substantive content, not a generic 'this document discusses...' filler. If the text is "
    "garbled or empty, say so plainly instead of guessing. End by noting it's saved and they can "
    "ask you about it anytime. Plain text only, no markdown."
)


# Cap uploads so a large PDF can't OOM the 512MB free-tier instance before we can trim.
PDF_MAX_UPLOAD_BYTES = 12 * 1024 * 1024  # 12MB


@app.post("/web-terminal/upload-pdf")
async def upload_pdf(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".pdf"):
        return JSONResponse({"reply": "⚠️ Only PDF files are supported here."})
    try:
        file_bytes = await file.read()
        if len(file_bytes) > PDF_MAX_UPLOAD_BYTES:
            del file_bytes
            return JSONResponse({"reply": f"⚠️ That PDF is too large (max {PDF_MAX_UPLOAD_BYTES // (1024*1024)}MB)."})
        _mem_probe(f"pdf:before {file.filename} ({len(file_bytes)//1024}KB)")
        loop = asyncio.get_event_loop()
        text = await loop.run_in_executor(None, extract_pdf_text, file_bytes)
        del file_bytes  # drop the raw bytes before trimming so the heap can be reclaimed
        _mem_probe(f"pdf:after {file.filename}")
        _malloc_trim()
    except Exception as e:
        print(f"❌ upload-pdf extraction error for {file.filename}: {e}")
        return JSONResponse({"reply": f"⚠️ Couldn't read that PDF: {e}"})

    if not text:
        return JSONResponse({"reply": f"⚠️ *{file.filename}* has no extractable text (likely a scanned image PDF)."})

    pseudo_url = f"pdf://{file.filename}-{dt.datetime.now(dt.timezone.utc).isoformat()}"
    await save_articles_to_knowledge_store([{"url": pseudo_url, "title": file.filename, "content": text}])

    try:
        summary = await call_llm(PDF_SUMMARY_PROMPT, text[:6000], max_tokens=300)
    except Exception as e:
        print(f"⚠️ upload-pdf summary failed for {file.filename}: {e}")
        summary = "Saved it, but couldn't generate a summary right now — ask me about it directly."

    return JSONResponse({"reply": f"📄 *{file.filename}*\n\n{summary}"})


# ── PDF RAG — chat with an uploaded document, citation-verified answers ──────────
@app.post("/api/pdf-rag/upload")
async def pdf_rag_upload(file: UploadFile = File(...)):
    """Ingest a PDF into its own searchable, page-tagged index (see pdf_rag_agent.py)."""
    if not file.filename.lower().endswith(".pdf"):
        return JSONResponse({"error": "Only PDF files are supported."}, status_code=400)
    try:
        file_bytes = await file.read()
        if len(file_bytes) > PDF_MAX_UPLOAD_BYTES:
            del file_bytes
            return JSONResponse(
                {"error": f"PDF is too large (max {PDF_MAX_UPLOAD_BYTES // (1024*1024)}MB)."},
                status_code=413)
        _mem_probe(f"pdfrag:before {file.filename} ({len(file_bytes)//1024}KB)")
        # pdfplumber is CPU/IO-heavy — run it OFF the event loop so one upload can't freeze
        # every other request on the single free-tier worker.
        loop = asyncio.get_event_loop()
        pages = await loop.run_in_executor(None, extract_pdf_pages, file_bytes)
        del file_bytes  # drop raw bytes before trimming so the heap can be reclaimed
        _mem_probe(f"pdfrag:after {file.filename}")
        _malloc_trim()
    except Exception as e:
        print(f"❌ pdf-rag extraction error for {file.filename}: {e}")
        return JSONResponse({"error": f"Couldn't read that PDF: {e}"}, status_code=400)
    if not any((p or "").strip() for p in pages):
        return JSONResponse(
            {"error": f"{file.filename} has no extractable text (likely a scanned image PDF)."},
            status_code=422)
    meta = await pdf_rag_ingest(file.filename, pages)
    del pages  # the full document text is now in the DB; release it from the heap
    _malloc_trim()
    return JSONResponse({"ok": True, "document": meta})


# pandas/numpy/matplotlib code runs client-side in Pyodide (no host os/fs/network reachable). This
# denylist is defense-in-depth on the *generated* text — it keeps the model honest and blocks
# obviously-unsafe output. matplotlib/scipy imports are harmless in the WASM sandbox.
_ANALYST_DENY = (
    "__import__", "subprocess", "socket", "os.system", "os.popen", "os.remove", "os.rename",
    "os.unlink", "os.environ", "os.path", "import os", "eval(", "exec(", "compile(", "open(",
    "requests", "urllib", "sys.", "pickle", "shutil", "importlib", "getattr(", "globals(",
    "__builtins__", "builtins.", "pyodide", "js.", "fetch(", "pathlib",
    # generated analyst code never needs to read files — the data is already in memory
    "read_csv", "read_excel", "read_parquet", "read_sql", "read_json", "read_html", "read_pickle",
    "read_table", "pd.read", "savefig")


def _analyst_blocked(code: str) -> bool:
    lowered = code.lower()
    return any(bad in lowered for bad in _ANALYST_DENY)


@app.post("/api/analyst/code")
async def analyst_code(request: Request):
    """AI Data Analyst: natural-language question + a DataFrame profile -> pandas/matplotlib code
    (+ optional Recharts spec). The code is RUN CLIENT-SIDE in the browser's Pyodide sandbox — the
    server only generates it and never executes it, so a 512MB instance is never at risk.
    Self-correcting: if the browser's run threw, the client re-POSTs with previous_code + error and
    the model returns a corrected version."""
    body = await request.json()
    question = (body.get("question") or "").strip()
    schema = (body.get("schema") or "").strip()
    prev_code = (body.get("previous_code") or "").strip()
    run_error = (body.get("error") or "").strip()
    goal = (body.get("goal") or "").strip()
    if not question or not schema:
        return JSONResponse({"error": "Upload a dataset and ask a question."}, status_code=400)
    if prev_code and run_error:
        user_turn = (f"PROFILE: {schema[:5000]}\n\nQUESTION: {question}\n\n"
                     f"Your previous code raised an error when it ran. Fix it and return corrected "
                     f"JSON.\nPREVIOUS CODE:\n{prev_code[:1500]}\n\nERROR:\n{run_error[:600]}\n\nJSON:")
    elif prev_code:
        # follow-up: build on the prior analysis (no error => not a fix)
        user_turn = (f"PROFILE: {schema[:5000]}\n\nThis continues a prior analysis.\nPREVIOUS CODE:\n"
                     f"{prev_code[:1500]}\n\nNow answer this FOLLOW-UP, building on that where it helps: "
                     f"{question}\n\nJSON:")
    else:
        user_turn = f"PROFILE: {schema[:5000]}\n\nQUESTION: {question}\n\nJSON:"
    
    if goal:
        user_turn = f"USER'S OVERALL ANALYSIS GOAL: {goal}\n\n" + user_turn

    try:
        raw = await call_llm(ANALYST_SYSTEM, user_turn, max_tokens=900, temperature=0.1)
    except Exception as e:
        return JSONResponse({"error": f"Analysis failed: {e}"}, status_code=502)
    from influencer_agent import extract_json_object
    parsed = extract_json_object(raw) or {}
    code = (parsed.get("code") or "").strip()
    if not code:
        return JSONResponse({"error": "Couldn't turn that into an analysis — try rephrasing."}, status_code=422)
    if _analyst_blocked(code):
        return JSONResponse({"error": "Generated code was blocked by the safety filter."}, status_code=422)
    chart = parsed.get("chart") if isinstance(parsed.get("chart"), dict) else None
    return JSONResponse({"code": code, "explanation": (parsed.get("explanation") or "").strip(), "chart": chart})


@app.post("/api/analyst/hypotheses")
async def analyst_hypotheses(request: Request):
    """Phase 1 reconnaissance: given a deterministic client-computed profile, return an analyst's
    opening read — hypotheses, domain KPIs, and clickable starter questions. No code execution."""
    body = await request.json()
    profile = (body.get("profile") or "").strip()
    goal = (body.get("goal") or "").strip()
    if not profile:
        return JSONResponse({"error": "No profile provided."}, status_code=400)
    
    prompt = f"PROFILE:\n{profile[:6000]}\n\n"
    if goal:
        prompt += f"USER'S SPECIFIC ANALYSIS GOAL / REQUIREMENT:\n{goal}\n(Crucial: tailor all suggested hypotheses, KPIs, and starter questions directly to help the user achieve this specific goal!)\n\n"
    prompt += "JSON:"

    try:
        raw = await call_llm(ANALYST_HYPOTHESES_SYSTEM, prompt, max_tokens=700, temperature=0.3)
    except Exception as e:
        return JSONResponse({"error": f"Reconnaissance failed: {e}"}, status_code=502)
    from influencer_agent import extract_json_object
    parsed = extract_json_object(raw) or {}
    return JSONResponse({
        "read": (parsed.get("read") or "").strip(),
        "hypotheses": [str(h) for h in (parsed.get("hypotheses") or []) if str(h).strip()][:5],
        "kpis": [k for k in (parsed.get("kpis") or []) if isinstance(k, dict) and k.get("name")][:4],
        "questions": [str(q) for q in (parsed.get("questions") or []) if str(q).strip()][:6],
    })


@app.post("/api/analyst/synthesis")
async def analyst_synthesis(request: Request):
    """Phase 6: given the question + the actual (small) computed result, produce a decision-ready
    SCR / Descriptive-Diagnostic-Prescriptive executive brief."""
    body = await request.json()
    question = (body.get("question") or "").strip()
    result = (body.get("result") or "").strip()
    goal = (body.get("goal") or "").strip()
    if not question or not result:
        return JSONResponse({"error": "Nothing to synthesize."}, status_code=400)
    
    prompt = f"QUESTION: {question}\n\nRESULT:\n{result[:2500]}\n\n"
    if goal:
        prompt += f"USER'S OVERALL ANALYSIS GOAL:\n{goal}\n(Tailor your brief and recommendations to specifically support this analysis goal!)\n\n"
    prompt += "JSON:"

    try:
        raw = await call_llm(ANALYST_SCR_SYSTEM, prompt, max_tokens=550, temperature=0.35)
    except Exception as e:
        return JSONResponse({"error": f"Synthesis failed: {e}"}, status_code=502)
    from influencer_agent import extract_json_object
    parsed = extract_json_object(raw) or {}
    return JSONResponse({
        "scorecard": [str(s) for s in (parsed.get("scorecard") or []) if str(s).strip()][:3],
        "descriptive": (parsed.get("descriptive") or "").strip(),
        "diagnostic": (parsed.get("diagnostic") or "").strip(),
        "prescriptive": (parsed.get("prescriptive") or "").strip(),
    })


@app.get("/api/pdf-rag/docs")
async def pdf_rag_docs():
    return JSONResponse({"documents": await pdf_rag_list_docs()})


@app.post("/api/pdf-rag/{doc_id}/summary")
async def pdf_rag_summary_ep(doc_id: int):
    """A short 'what this document is about' overview + key topics (cached)."""
    result = await pdf_rag_summary(doc_id, call_llm)
    _malloc_trim()
    return JSONResponse(result)


@app.post("/api/pdf-rag/{doc_id}/ask")
async def pdf_rag_ask_ep(doc_id: int, request: Request):
    body = await request.json()
    question = (body.get("question") or "").strip()
    if not question:
        return JSONResponse({"error": "Ask a question about the document."}, status_code=400)
    return JSONResponse(await pdf_rag_ask(doc_id, question, call_llm))


@app.post("/api/pdf-rag/{doc_id}/assess")
async def pdf_rag_assess_ep(doc_id: int, request: Request):
    body = await request.json()
    criteria = body.get("criteria") or []
    if isinstance(criteria, str):
        criteria = [c.strip() for c in re.split(r"[\n,]", criteria) if c.strip()]
    return JSONResponse(await pdf_rag_assess(doc_id, criteria, call_llm))


@app.delete("/api/pdf-rag/{doc_id}")
async def pdf_rag_delete_ep(doc_id: int):
    await pdf_rag_delete(doc_id)
    return JSONResponse({"ok": True})


# ── JARVIS Notebooks (Built-in NotebookLM) Multi-Source Context Assembly ───────
async def assemble_notebook_context(sources: dict) -> str:
    """Consolidate text excerpts from selected sources (master resume, job descriptions, PDFs)."""
    context_parts = []
    
    # 1. Master Resume
    if sources.get("resume"):
        resume = await get_resume_template()
        if resume and resume.strip():
            context_parts.append(f"=== SOURCE: MASTER RÉSUMÉ ===\n{resume.strip()}\n")
            
    # 2. Target Job Descriptions
    job_refs = sources.get("job_refs") or []
    if job_refs and isinstance(job_refs, list):
        for ref in job_refs:
            analysis = await get_ats_analysis(ref)
            if analysis and analysis.get("job_title"):
                jd = analysis.get("description") or ""
                context_parts.append(
                    f"=== SOURCE: JOB DESCRIPTION ({analysis.get('job_title')} @ {analysis.get('company')}) ===\n"
                    f"{jd[:4000]}\n"
                )
                
    # 3. PDF Documents
    pdf_ids = sources.get("pdf_ids") or []
    if pdf_ids and isinstance(pdf_ids, list):
        for doc_id in pdf_ids:
            try:
                doc_id_int = int(doc_id)
            except (ValueError, TypeError):
                continue
            chunks = await pdf_rag_get_chunks(doc_id_int)
            if chunks:
                excerpt = "\n".join([c["content"] for c in chunks[:12]])[:6000]
                context_parts.append(f"=== SOURCE: UPLOADED PDF (Doc #{doc_id}) ===\n{excerpt}\n")
                
    if not context_parts:
        return "No active sources selected."
    return "\n\n".join(context_parts)


NOTEBOOK_SYSTEM_PROMPT = (
    "You are JARVIS, a master career copilot and research analyst. You are given a set of "
    "SELECTED SOURCE DOCUMENTS (Master Resume, Job Descriptions, and/or PDF research documents). "
    "Answer the user's question accurately based ONLY on the provided sources. Cite which source "
    "your answer is derived from. If the sources do not contain the answer, state that clearly."
)

NOTEBOOK_STUDY_PROMPT = (
    "You are JARVIS, an elite interview coach and technical mentor. You are given a set of "
    "SELECTED SOURCE DOCUMENTS. Generate a comprehensive, beautifully structured Markdown Study Guide "
    "and Cheat Sheet. Include:\n"
    "1. Executive Summary & Core Alignment\n"
    "2. Technical Mastery Points & Required Tools\n"
    "3. High-Frequency Interview Questions & Strategic Answers\n"
    "4. Actionable 3-Day Preparation Roadmap\n"
    "Output structured Markdown only."
)

NOTEBOOK_QUIZ_PROMPT = (
    "You are an assessment engine. You are given a set of SELECTED SOURCE DOCUMENTS. "
    "Generate a 5-question multiple choice practice quiz based on the key concepts, technical tools, "
    "and requirements in the sources. Return a STRICT JSON array of 5 objects — no markdown, no prose:\n"
    "[\n"
    "  {\n"
    '    "question": "...",\n'
    '    "options": ["Option A", "Option B", "Option C", "Option D"],\n'
    '    "correct_idx": 0,\n'
    '    "explanation": "..."\n'
    "  }\n"
    "]"
)

NOTEBOOK_AUDIO_PROMPT = (
    "You are an AI podcast scriptwriter. You are given a set of SELECTED SOURCE DOCUMENTS. "
    "Generate an engaging, natural 4-turn conversational briefing script between two hosts:\n"
    "- 'JARVIS' (the composed, witty AI lead)\n"
    "- 'Coach' (the sharp career strategist)\n"
    "They discuss the candidate's fit, key strengths, potential risks, and top interview tactics. "
    "Return a STRICT JSON array of objects — no markdown, no prose:\n"
    '[\n  {"speaker": "JARVIS", "text": "..."},\n  {"speaker": "Coach", "text": "..."}\n]'
)


@app.post("/api/notebook/chat")
async def notebook_chat_api(request: Request):
    body = await request.json()
    message = (body.get("message") or "").strip()
    sources = body.get("sources") or {}
    if not message:
        return JSONResponse({"error": "Message is required"}, status_code=400)
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nQUESTION: {message}"
    reply = await call_llm(NOTEBOOK_SYSTEM_PROMPT, user_prompt, max_tokens=1200)
    return JSONResponse({"reply": reply})


@app.post("/api/notebook/study-guide")
async def notebook_study_guide_api(request: Request):
    body = await request.json()
    sources = body.get("sources") or {}
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nGenerate the Study Guide now."
    guide = await call_llm(NOTEBOOK_STUDY_PROMPT, user_prompt, max_tokens=2200)
    return JSONResponse({"study_guide": guide})


@app.post("/api/notebook/quiz")
async def notebook_quiz_api(request: Request):
    body = await request.json()
    sources = body.get("sources") or {}
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nGenerate the JSON 5-question quiz array now."
    raw = await call_llm(NOTEBOOK_QUIZ_PROMPT, user_prompt, max_tokens=1500, temperature=0.2)
    quiz = _parse_json_object(raw)
    if not isinstance(quiz, list):
        quiz = quiz.get("quiz") if isinstance(quiz, dict) else []
    return JSONResponse({"quiz": quiz})


@app.post("/api/notebook/audio-overview")
async def notebook_audio_overview_api(request: Request):
    body = await request.json()
    sources = body.get("sources") or {}
    ctx = await assemble_notebook_context(sources)
    user_prompt = f"SOURCES:\n{ctx}\n\nGenerate the dialogue script JSON array now."
    raw = await call_llm(NOTEBOOK_AUDIO_PROMPT, user_prompt, max_tokens=1600, temperature=0.3)
    script = _parse_json_object(raw)
    if not isinstance(script, list):
        script = script.get("script") if isinstance(script, dict) else []
    return JSONResponse({"script": script})


@app.post("/api/notebook/speak")
async def notebook_speak_api(request: Request):
    """Synthesize speech audio for a text line using Gemini TTS (gemini-2.5-flash-preview-tts)."""
    body = await request.json()
    text = (body.get("text") or "").strip()
    voice = (body.get("voice") or "Charon").strip()
    if not text:
        return JSONResponse({"error": "No text provided"}, status_code=400)
    wav_bytes = await gemini_synthesize(text, voice)
    if not wav_bytes:
        return JSONResponse({"error": "TTS synthesis unavailable"}, status_code=503)
    return Response(content=wav_bytes, media_type="audio/wav")


# ── GEMINI AI TOOLS SUITE ────────────────────────────────────────────────────────

# 1. Gemini Live Search Grounding (Pre-Interview Dossier)
@app.post("/ats/{job_ref}/dossier")
async def gemini_search_dossier_api(job_ref: str):
    analysis = await get_ats_analysis(job_ref)
    if not analysis:
        return JSONResponse({"error": "No analysis found for this job"}, status_code=404)

    company = analysis.get("company") or "Company"
    title = analysis.get("job_title") or "Data Analyst"

    prompt = (
        f"You are JARVIS. Perform a real-time intelligence scan on '{company}' for a '{title}' candidate. "
        f"Search for:\n"
        f"1. Recent company news, product launches, acquisitions, and strategic direction.\n"
        f"2. Glassdoor and Reddit reported interview questions and hiring process for {company}.\n"
        f"3. Core tech stack tools, engineering practices, and executive leadership notes.\n"
        f"Format your response as a crisp, professional Executive Briefing Dossier with clear sections."
    )

    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"googleSearch": {}}]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini Grounding API returned {res.status_code}: {res.text[:200]}"}, status_code=500)

        data = res.json()
        candidate = data["candidates"][0]
        text = candidate["content"]["parts"][0]["text"]
        
        # Extract web citations from groundingMetadata
        grounding_meta = candidate.get("groundingMetadata") or {}
        search_chunks = grounding_meta.get("groundingChunks") or []
        citations = []
        for chk in search_chunks:
            web = chk.get("web")
            if web:
                citations.append({"title": web.get("title", "Source"), "url": web.get("uri", "#")})

        result = {
            "job_ref": job_ref,
            "company": company,
            "title": title,
            "dossier": text,
            "citations": citations[:6]
        }

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT OR REPLACE INTO company_intelligence_dossiers (job_ref, dossier_json) VALUES (?, ?)",
                (job_ref, json.dumps(result))
            )
            await db.commit()

        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": f"Dossier generation failed: {str(e)}"}, status_code=500)


@app.get("/ats/{job_ref}/dossier")
async def get_dossier_api(job_ref: str):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT dossier_json FROM company_intelligence_dossiers WHERE job_ref = ?", (job_ref,))
        row = await cur.fetchone()
        if row and row["dossier_json"]:
            return JSONResponse(json.loads(row["dossier_json"]))
    return JSONResponse({"dossier": None})


# 2. Gemini Multimodal Vision (Visual Job & Flyer Scanner)
@app.post("/api/jobs/upload-image")
async def upload_job_image_api(file: UploadFile = File(...)):
    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    contents = await file.read()
    b64_image = base64.b64encode(contents).decode("utf-8")
    mime_type = file.content_type or "image/png"

    prompt = (
        "Analyze this job posting screenshot/flyer. Extract the following information and return ONLY a STRICT JSON object:\n"
        "{\n"
        '  "title": "Job Title",\n'
        '  "company": "Company Name",\n'
        '  "location": "Location or Remote",\n'
        '  "description": "Full extracted job requirements and responsibilities",\n'
        '  "apply_url": "Application link or email if visible"\n'
        "}"
    )

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64_image}},
                {"text": prompt}
            ]
        }]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini Vision API returned {res.status_code}"}, status_code=500)

        data = res.json()
        raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
        parsed = _parse_json_object(raw_text) or {}

        title = (parsed.get("title") or "Position").strip()
        company = (parsed.get("company") or "Company").strip()
        location = (parsed.get("location") or "Remote").strip()
        description = (parsed.get("description") or "").strip()
        apply_url = (parsed.get("apply_url") or "#").strip()

        job_key = f"img:{hashlib.md5(contents).hexdigest()[:10]}"

        # Save to applications table
        async with aiosqlite.connect(DB_PATH) as db:
            cur = await db.execute(
                "INSERT INTO applications (job_key, title, company, location, source, status, apply_method, url, reviewed, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, ?, 'interested', 'link', ?, 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)",
                (job_key, title, company, location, "Image Scan", apply_url)
            )
            app_id = cur.lastrowid
            await db.commit()

        # Trigger ATS match scoring in background
        job_obj = {"key": job_key, "title": title, "company": company, "location": location, "description": description}
        await generate_ats_analysis(job_obj, call_llm)

        return JSONResponse({"ok": True, "app_id": app_id, "job_key": job_key, "title": title, "company": company})
    except Exception as e:
        return JSONResponse({"error": f"Image processing failed: {str(e)}"}, status_code=500)


# 3. Gemini Audio Understanding (Voice Mock Interview Evaluator)
@app.post("/api/voice-interview/evaluate")
async def evaluate_voice_interview_api(file: UploadFile = File(...), question: str = Form(...), job_ref: str = Form("default")):
    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    contents = await file.read()
    b64_audio = base64.b64encode(contents).decode("utf-8")
    mime_type = file.content_type or "audio/wav"

    prompt = (
        f"You are an expert interview coach. Listen to this spoken answer to the question: '{question}'.\n"
        f"Evaluate the candidate's audio recording across 4 dimensions and return ONLY a STRICT JSON object:\n"
        "{\n"
        '  "star_score": 85,\n'
        '  "filler_words_count": 2,\n'
        '  "pacing_feedback": "Ideal pace (approx 140 wpm), clear articulation.",\n'
        '  "tone_rating": "Confident & Composed",\n'
        '  "strengths": ["Clear Situation definition", "Strong Action metrics"],\n'
        '  "improvements": ["Emphasize final Result metrics more explicitly"]\n'
        "}"
    )

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{
            "parts": [
                {"inlineData": {"mimeType": mime_type, "data": b64_audio}},
                {"text": prompt}
            ]
        }]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini Audio API returned {res.status_code}"}, status_code=500)

        data = res.json()
        raw_text = data["candidates"][0]["content"]["parts"][0]["text"]
        result = _parse_json_object(raw_text) or {
            "star_score": 75,
            "filler_words_count": 1,
            "pacing_feedback": "Speech recorded clearly.",
            "tone_rating": "Professional",
            "strengths": ["Good verbal clarity"],
            "improvements": ["Elaborate on technical tools used"]
        }

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "INSERT INTO voice_interview_scores (job_ref, question, score, feedback_json) VALUES (?, ?, ?, ?)",
                (job_ref, question, result.get("star_score", 75), json.dumps(result))
            )
            await db.commit()

        return JSONResponse({"ok": True, "evaluation": result})
    except Exception as e:
        return JSONResponse({"error": f"Audio evaluation failed: {str(e)}"}, status_code=500)


# 4. Gemini Code Execution (Python Sandbox)
@app.post("/api/notebook/python-exec")
async def notebook_python_exec_api(request: Request):
    body = await request.json()
    prompt = (body.get("prompt") or "").strip()
    if not prompt:
        return JSONResponse({"error": "Prompt is required"}, status_code=400)

    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body_data = {
        "contents": [{"parts": [{"text": f"Write and execute Python code to answer/solve: {prompt}"}]}],
        "tools": [{"codeExecution": {}}]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body_data)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini CodeExecution API returned {res.status_code}"}, status_code=500)

        data = res.json()
        parts = data["candidates"][0]["content"]["parts"]
        text_resp = ""
        executable_code = ""
        execution_result = ""

        for p in parts:
            if "text" in p:
                text_resp += p["text"] + "\n"
            if "executableCode" in p:
                executable_code = p["executableCode"].get("code", "")
            if "codeExecutionResult" in p:
                execution_result = p["codeExecutionResult"].get("output", "")

        return JSONResponse({
            "response": text_resp.strip(),
            "code": executable_code,
            "output": execution_result
        })
    except Exception as e:
        return JSONResponse({"error": f"Python execution failed: {str(e)}"}, status_code=500)


# 5. Gemini 1M+ Long Context (Career Portfolio Vault Indexer)
@app.post("/api/vault/add")
async def vault_add_api(request: Request):
    body = await request.json()
    title = (body.get("title") or "Project").strip()
    category = (body.get("category") or "Code Repo").strip()
    content = (body.get("content") or "").strip()

    if not content:
        return JSONResponse({"error": "Content is required"}, status_code=400)

    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT INTO career_portfolio_vault (title, category, content) VALUES (?, ?, ?)",
            (title, category, content)
        )
        await db.commit()
    return JSONResponse({"ok": True, "title": title})


@app.post("/api/vault/search")
async def vault_search_api(request: Request):
    body = await request.json()
    query = (body.get("query") or "").strip()
    if not query:
        return JSONResponse({"error": "Query is required"}, status_code=400)

    # Aggregate all portfolio items into Gemini 1M token context window
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute("SELECT title, category, content FROM career_portfolio_vault")
        rows = await cur.fetchall()

    if not rows:
        return JSONResponse({"answer": "Your Career Vault is empty. Upload project repos, design docs, or old code first."})

    vault_text = "\n\n".join([f"=== PROJECT: {r['title']} ({r['category']}) ===\n{r['content']}" for r in rows])
    
    prompt = (
        f"You are JARVIS searching the candidate's entire multi-year career history and project vault.\n\n"
        f"PORTFOLIO VAULT:\n{vault_text[:100000]}\n\n"
        f"QUERY / JD REQUIREMENT: {query}\n\n"
        f"Find all matching projects, technical tools used, and quantify their experience for this requirement."
    )

    reply = await call_llm("You are JARVIS career vault search engine.", prompt, max_tokens=1500)
    return JSONResponse({"answer": reply})


TTS_SUMMARY_PROMPT = (
    "You are JARVIS, about to speak the verbal version of a longer written answer you already "
    "gave. Read it, actually understand the point being made, then brief it back in 2-3 sentences "
    "the way a composed, confident assistant would summarize something out loud to someone — not "
    "a list of facts, the actual takeaway. Skip code, skip numbers/lists, skip markdown entirely. "
    "End with a short, natural pointer back to the full answer on screen, phrased differently each "
    "time, not a fixed disclaimer — e.g. mention the complete breakdown/details/steps are there to "
    "read. Output plain spoken sentences only, nothing else."
)
TTS_SUMMARY_TIMEOUT_SEC = 3.0


def _fallback_speech_summary(text: str, max_chars: int = 280) -> str:
    """No-LLM summary used when the real summarizer is too slow/rate-limited — keeps voice from stalling."""
    sentences = re.split(r'(?<=[.!?])\s+', text.strip())
    summary = ""
    for sentence in sentences:
        if summary and len(summary) + len(sentence) > max_chars:
            break
        summary += (" " if summary else "") + sentence
    if not summary:
        summary = text[:max_chars]
    return summary.strip() + " The full details are right there in the chat."


@app.post("/tts")
async def text_to_speech(request: Request):
    """Returns the text JARVIS should speak — actual audio is generated client-side via the
    browser's own SpeechSynthesis API (works on Chrome, Safari/iOS, etc. with zero server
    compute and no per-character quota). Only does real work for long replies, where an LLM
    pass turns them into a short natural spoken summary instead of reading everything verbatim."""
    body = await request.json()
    text = body.get("text", "").strip()
    if not text:
        return JSONResponse({"speech_text": ""})
    if len(text) <= 400:
        return JSONResponse({"speech_text": text})
    t_summary = time.time()
    try:
        summary = await asyncio.wait_for(
            call_llm(TTS_SUMMARY_PROMPT, text, max_tokens=100), timeout=TTS_SUMMARY_TIMEOUT_SEC
        )
        speech_text = summary.strip() or text
        print(f"⏱️ [tts] summary took {time.time() - t_summary:.2f}s")
    except asyncio.TimeoutError:
        print(f"⚠️ [tts] summary timed out after {time.time() - t_summary:.2f}s, using fast fallback")
        speech_text = _fallback_speech_summary(text)
    except Exception as e:
        print(f"⚠️ [tts] summary failed after {time.time() - t_summary:.2f}s, using fast fallback: {e}")
        speech_text = _fallback_speech_summary(text)
    return JSONResponse({"speech_text": speech_text})


CHAT_UI_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0">
<title>J.A.R.V.I.S.</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700&family=Share+Tech+Mono&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  :root {
    --cyan: #00e5ff;
    --cyan-dim: rgba(0, 229, 255, 0.35);
    --cyan-faint: rgba(0, 229, 255, 0.12);
  }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: #000509; color: #d7f6ff;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    overflow: hidden;
  }
  #app {
    position: relative;
    display: flex; flex-direction: column; height: 100vh;
    background:
      radial-gradient(ellipse at top, rgba(0, 229, 255, 0.07), transparent 60%),
      repeating-linear-gradient(0deg, rgba(0, 229, 255, 0.025) 0px, rgba(0, 229, 255, 0.025) 1px, transparent 1px, transparent 28px),
      repeating-linear-gradient(90deg, rgba(0, 229, 255, 0.025) 0px, rgba(0, 229, 255, 0.025) 1px, transparent 1px, transparent 28px),
      #000509;
  }
  #scanline {
    position: absolute; left: 0; right: 0; height: 2px;
    background: linear-gradient(90deg, transparent, var(--cyan-dim), transparent);
    opacity: 0.5; pointer-events: none; z-index: 50;
    animation: scan 6s linear infinite;
  }
  @keyframes scan {
    0%   { top: 0%; }
    100% { top: 100%; }
  }

  header {
    flex: 0 0 auto;
    display: flex; align-items: center; justify-content: space-between;
    flex-wrap: wrap; row-gap: 10px;
    padding: 16px 20px;
    background: linear-gradient(180deg, rgba(0,229,255,0.06), transparent);
    border-bottom: 1px solid var(--cyan-dim);
    position: relative; z-index: 10;
  }
  @media (max-width: 480px) {
    header { padding: 12px 14px; }
    .header-right { width: 100%; justify-content: space-between; }
    .tab-bar { flex: 1 1 auto; }
    .tab-btn { flex: 1 1 auto; padding: 6px 6px; font-size: 9px; letter-spacing: 0.5px; }
  }
  header .brand {
    font-family: 'Orbitron', sans-serif;
    font-size: 18px; font-weight: 700; letter-spacing: 3px;
    color: var(--cyan);
    text-shadow: 0 0 8px var(--cyan-dim), 0 0 18px var(--cyan-dim);
  }
  header .subtitle {
    font-family: 'Share Tech Mono', monospace;
    font-size: 10px; letter-spacing: 2px; color: rgba(0,229,255,0.5);
    margin-top: 2px;
  }
  .status-ring {
    position: relative; width: 22px; height: 22px;
    display: flex; align-items: center; justify-content: center;
  }
  .status-ring::before {
    content: ''; position: absolute; inset: 0;
    border: 1px solid var(--cyan-dim); border-radius: 50%;
    animation: ring-pulse 2s ease-out infinite;
  }
  .pulse-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #22c55e;
    box-shadow: 0 0 6px #22c55e, 0 0 12px rgba(34, 197, 94, 0.6);
  }
  @keyframes ring-pulse {
    0%   { transform: scale(0.6); opacity: 1; }
    100% { transform: scale(1.8); opacity: 0; }
  }

  #chat-window {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 18px;
    display: flex; flex-direction: column; gap: 12px;
    position: relative; z-index: 10;
  }
  .bubble-row { display: flex; flex-direction: column; max-width: 75%; }
  .bubble-row.user { align-self: flex-end; align-items: flex-end; }
  .bubble-row.agent { align-self: flex-start; align-items: flex-start; }
  .bubble {
    padding: 10px 14px; border-radius: 10px;
    white-space: pre-wrap; word-wrap: break-word;
    font-size: 16px; line-height: 1.4;
  }
  .bubble-row.user .bubble {
    background: rgba(0, 229, 255, 0.08);
    color: #eafffd;
    border: 1px solid var(--cyan);
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.3);
  }
  .bubble-row.agent .bubble {
    background: rgba(0, 20, 28, 0.85);
    color: #d7f6ff;
    border: 1px solid var(--cyan-dim);
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.08);
  }
  .timestamp {
    font-family: 'Share Tech Mono', monospace;
    font-size: 10px; letter-spacing: 1px; color: rgba(0, 229, 255, 0.45);
    margin-top: 4px; padding: 0 4px;
  }
  .bubble pre {
    background: rgba(0, 8, 12, 0.9);
    border: 1px solid var(--cyan-dim);
    border-radius: 6px;
    padding: 10px 12px;
    margin: 8px 0;
    overflow-x: auto;
    font-family: 'Share Tech Mono', monospace;
    font-size: 13px; line-height: 1.5;
  }
  .bubble pre code {
    background: none; border: none; padding: 0; color: #9bf6ff;
  }
  .bubble code {
    background: rgba(0, 229, 255, 0.1);
    border: 1px solid rgba(0, 229, 255, 0.25);
    border-radius: 4px;
    padding: 1px 5px;
    font-family: 'Share Tech Mono', monospace;
    font-size: 0.9em;
    color: #7df9ff;
  }
  .bubble strong { color: var(--cyan); font-weight: 700; }
  .bubble ul, .bubble ol { margin: 6px 0; padding-left: 22px; }
  .bubble li { margin: 2px 0; }
  .bubble h1, .bubble h2, .bubble h3 {
    font-family: 'Orbitron', sans-serif;
    color: var(--cyan);
    margin: 8px 0 4px;
    line-height: 1.3;
  }
  .bubble h1 { font-size: 1.15em; }
  .bubble h2 { font-size: 1.08em; }
  .bubble h3 { font-size: 1.02em; }

  .typing-dots {
    display: flex; gap: 4px; padding: 10px 14px;
    background: rgba(0, 20, 28, 0.85); border: 1px solid var(--cyan-dim);
    border-radius: 10px; width: fit-content;
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.08);
  }
  .typing-dots span {
    width: 6px; height: 6px; border-radius: 50%; background: var(--cyan);
    animation: blink 1.2s infinite ease-in-out;
  }
  .typing-dots span:nth-child(2) { animation-delay: 0.2s; }
  .typing-dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 80%, 100% { opacity: 0.2; } 40% { opacity: 1; } }

  #input-bar {
    flex: 0 0 auto;
    display: flex; align-items: center; gap: 10px;
    padding: 12px 14px;
    padding-bottom: max(12px, env(safe-area-inset-bottom));
    background: linear-gradient(0deg, rgba(0,229,255,0.05), transparent);
    border-top: 1px solid var(--cyan-dim);
    position: relative; z-index: 10;
  }
  #input-frame {
    flex: 1 1 auto; position: relative;
    border: 1px solid var(--cyan-dim); border-radius: 6px;
    background: rgba(0, 20, 28, 0.6);
    transition: box-shadow 0.2s ease, border-color 0.2s ease;
  }
  #input-frame:focus-within {
    border-color: var(--cyan);
    box-shadow: 0 0 12px rgba(0, 229, 255, 0.35);
  }
  #input-frame::before, #input-frame::after {
    content: ''; position: absolute; width: 8px; height: 8px;
    border-top: 2px solid var(--cyan); border-left: 2px solid var(--cyan);
    top: -1px; left: -1px;
  }
  #input-frame::after {
    border-top: none; border-left: none;
    border-bottom: 2px solid var(--cyan); border-right: 2px solid var(--cyan);
    top: auto; left: auto; bottom: -1px; right: -1px;
  }
  #msg-input {
    width: 100%;
    background: transparent; color: #eafffd;
    border: none; border-radius: 6px;
    padding: 12px 14px;
    font-size: 16px;
    font-family: 'Share Tech Mono', monospace;
    outline: none;
  }
  #msg-input::placeholder { color: rgba(0, 229, 255, 0.4); }
  #send-btn {
    background: rgba(0, 229, 255, 0.08); color: var(--cyan);
    border: 1px solid var(--cyan); border-radius: 6px; padding: 12px 18px;
    font-family: 'Orbitron', sans-serif;
    font-size: 13px; font-weight: 700; letter-spacing: 1px; cursor: pointer;
    transition: background 0.2s ease, box-shadow 0.2s ease;
  }
  #send-btn:hover { background: rgba(0, 229, 255, 0.2); box-shadow: 0 0 14px rgba(0, 229, 255, 0.4); }
  #mic-btn {
    position: relative;
    background: rgba(0, 229, 255, 0.06); color: var(--cyan); border: 1px solid var(--cyan-dim);
    border-radius: 50%; width: 46px; height: 46px;
    font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  #mic-btn:hover { box-shadow: 0 0 10px rgba(0, 229, 255, 0.3); }
  #mic-btn.recording {
    border-color: #ff3b5c; color: #ff3b5c;
    box-shadow: 0 0 14px rgba(255, 59, 92, 0.5);
    animation: mic-pulse 1s ease-in-out infinite;
  }
  @keyframes mic-pulse {
    0%, 100% { box-shadow: 0 0 8px rgba(255, 59, 92, 0.4); }
    50%      { box-shadow: 0 0 18px rgba(255, 59, 92, 0.8); }
  }
  #voice-toggle-btn {
    position: relative;
    background: rgba(0, 229, 255, 0.06); color: var(--cyan); border: 1px solid var(--cyan-dim);
    border-radius: 50%; width: 46px; height: 46px;
    font-size: 18px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  #voice-toggle-btn:hover { box-shadow: 0 0 10px rgba(0, 229, 255, 0.3); }
  #voice-toggle-btn .icon-off { display: none; }
  #voice-toggle-btn.muted { border-color: rgba(0, 229, 255, 0.2); color: rgba(0, 229, 255, 0.35); }
  #voice-toggle-btn.muted .icon-on { display: none; }
  #voice-toggle-btn.muted .icon-off { display: block; }
  #voice-toggle-btn.speaking {
    border-color: var(--cyan);
    box-shadow: 0 0 14px rgba(0, 229, 255, 0.6);
    animation: mic-pulse 1s ease-in-out infinite;
  }
  #voice-toggle-btn.pending {
    border-color: var(--cyan-dim);
    animation: mic-pulse 1.6s ease-in-out infinite;
  }
  .header-right { display: flex; align-items: center; gap: 14px; }
  .tab-bar {
    display: flex; gap: 4px;
    background: rgba(0, 20, 28, 0.6); border: 1px solid var(--cyan-dim);
    border-radius: 8px; padding: 3px;
  }
  .tab-btn {
    position: relative;
    background: none; border: none; color: rgba(0, 229, 255, 0.5);
    font-family: 'Orbitron', sans-serif; text-transform: uppercase;
    font-size: 11px; font-weight: 700; letter-spacing: 1px;
    padding: 7px 14px; border-radius: 6px; cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease;
  }
  .tab-btn.active {
    background: rgba(0, 229, 255, 0.15); color: var(--cyan);
    box-shadow: 0 0 10px rgba(0, 229, 255, 0.25);
  }
  .tab-badge {
    display: none;
    position: absolute; top: -4px; right: -4px;
    min-width: 16px; height: 16px; padding: 0 3px;
    background: #ff3b5c; color: #fff;
    box-shadow: 0 0 8px rgba(255, 59, 92, 0.6);
    border-radius: 8px; font-size: 10px; font-weight: 700;
    align-items: center; justify-content: center;
  }
  .tab-badge.visible { display: flex; }

  .view { display: none; flex-direction: column; flex: 1 1 auto; min-height: 0; }
  .view.active { display: flex; }
  #privachat-view { padding: 0; }
  #privachat-frame { flex: 1 1 auto; width: 100%; height: 100%; border: none; }

  #terminal-log {
    flex: 1 1 auto; overflow-y: auto; padding: 14px 18px;
    background: #00060a;
    font-family: 'Share Tech Mono', monospace;
    font-size: 13px; line-height: 1.6;
  }
  .term-line { white-space: pre-wrap; word-wrap: break-word; margin-bottom: 6px; }
  .term-line.cmd { color: var(--cyan); }
  .term-line.cmd::before { content: '$ '; color: rgba(0, 229, 255, 0.5); }
  .term-line.result { color: #9bf6ff; padding-left: 4px; }
  .term-line.status { color: rgba(0, 229, 255, 0.4); font-style: italic; }
  #terminal-input-bar {
    flex: 0 0 auto; display: flex; align-items: center; gap: 8px;
    padding: 12px 14px; padding-bottom: max(12px, env(safe-area-inset-bottom));
    background: linear-gradient(0deg, rgba(0,229,255,0.05), transparent);
    border-top: 1px solid var(--cyan-dim);
  }
  .terminal-prompt {
    font-family: 'Share Tech Mono', monospace; color: var(--cyan); font-size: 15px;
  }
  #terminal-input {
    flex: 1 1 auto; background: transparent; color: #eafffd; border: none; outline: none;
    font-family: 'Share Tech Mono', monospace; font-size: 14px; padding: 6px 0;
  }
  #terminal-input::placeholder { color: rgba(0, 229, 255, 0.35); }
  #terminal-pdf-btn {
    flex: 0 0 auto;
    background: rgba(0, 229, 255, 0.06); color: var(--cyan); border: 1px solid var(--cyan-dim);
    border-radius: 50%; width: 36px; height: 36px;
    font-size: 15px; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  #terminal-pdf-btn:hover { box-shadow: 0 0 10px rgba(0, 229, 255, 0.3); }

  /* ── Applications (Jobs) kanban ── */
  #jobs-view { flex-direction: column; padding: 0; }
  #jobs-view.active { display: flex; }
  #jobs-toolbar { display: flex; align-items: center; justify-content: space-between;
    padding: 10px 14px; border-bottom: 1px solid rgba(0,229,255,0.12); flex: 0 0 auto; }
  #jobs-count { font-size: 13px; color: #9fb3c8; letter-spacing: .5px; }
  #jobs-refresh { background: transparent; border: 1px solid rgba(0,229,255,0.3); color: #00e5ff;
    border-radius: 8px; width: 30px; height: 30px; cursor: pointer; font-size: 15px; }
  #jobs-refresh:hover { box-shadow: 0 0 10px rgba(0,229,255,0.3); }
  #jobs-resume { background: transparent; border: 1px solid rgba(0,229,255,0.3); color: #00e5ff;
    border-radius: 8px; height: 30px; padding: 0 10px; cursor: pointer; font-size: 12px; }
  #jobs-resume:hover { box-shadow: 0 0 10px rgba(0,229,255,0.3); }
  #jobs-board { flex: 1 1 auto; overflow-x: auto; overflow-y: hidden; display: flex; gap: 12px;
    padding: 14px; align-items: flex-start; }
  .kb-col { flex: 0 0 200px; background: rgba(15,23,42,0.6); border: 1px solid rgba(148,163,184,0.15);
    border-radius: 12px; display: flex; flex-direction: column; max-height: 100%; }
  .kb-col-head { padding: 9px 11px; font-size: 12px; font-weight: 600; letter-spacing: .3px;
    border-bottom: 1px solid rgba(148,163,184,0.12); position: sticky; top: 0; }
  .kb-col-body { padding: 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .kb-card { background: #0b1120; border: 1px solid rgba(148,163,184,0.18); border-radius: 9px;
    padding: 9px 10px; font-size: 12px; color: #e5e7eb; }
  .kb-card .kb-title { font-weight: 600; line-height: 1.25; }
  .kb-card .kb-company { color: #9fb3c8; font-size: 11px; margin-top: 2px; }
  .kb-card .kb-actions { display: flex; align-items: center; gap: 6px; margin-top: 7px; }
  .kb-card select { flex: 1; background: #111827; color: #e5e7eb; border: 1px solid rgba(148,163,184,0.25);
    border-radius: 6px; font-size: 11px; padding: 3px 4px; }
  .kb-card a { color: #38bdf8; text-decoration: none; font-size: 11px; }
  .kb-card .kb-del { background: transparent; border: 0; color: #ef4444; cursor: pointer; font-size: 13px; }
  .kb-card .kb-ats { background: transparent; border: 0; cursor: pointer; font-size: 13px; }
  .kb-empty { color: #64748b; font-size: 12px; padding: 24px 14px; text-align: center; }

  /* ── ATS modal ── */
  .ats-card { background: #0b1120; border: 1px solid rgba(0,229,255,0.25); border-radius: 14px;
    width: 640px; max-width: 100%; max-height: 88vh; display: flex; flex-direction: column; overflow: hidden; }
  .ats-head { display: flex; align-items: center; gap: 12px; padding: 14px 16px;
    border-bottom: 1px solid rgba(148,163,184,0.15); }
  .ats-title { font-size: 14px; font-weight: 700; color: #e5e7eb; }
  .ats-sub { font-size: 12px; color: #9fb3c8; margin-top: 2px; }
  .ats-scorebox { margin-left: auto; text-align: center; color: #00e5ff; }
  .ats-scorebox span { font-size: 20px; font-weight: 800; }
  .ats-scorebox small { display: block; font-size: 9px; color: #64748b; letter-spacing: .5px; }
  .ats-x { background: transparent; border: 0; color: #94a3b8; font-size: 18px; cursor: pointer; }
  .ats-tabbar { display: flex; border-bottom: 1px solid rgba(148,163,184,0.12); }
  .ats-tabbtn { flex: 1; background: transparent; border: 0; color: #94a3b8; padding: 10px; cursor: pointer;
    font-size: 12px; border-bottom: 2px solid transparent; }
  .ats-tabbtn.active { color: #00e5ff; border-bottom-color: #00e5ff; }
  .ats-body { padding: 14px 16px; overflow-y: auto; }
  .kw-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .kw-table th { text-align: left; color: #9fb3c8; font-weight: 600; border-bottom: 1px solid rgba(148,163,184,0.2); padding: 6px 4px; }
  .kw-table td { padding: 5px 4px; border-bottom: 1px solid rgba(148,163,184,0.08); color: #e5e7eb; }
  .kw-yes { color: #22c55e; } .kw-no { color: #ef4444; }
  .kw-note { font-size: 11px; color: #64748b; margin-top: 10px; line-height: 1.4; }
  .delta { border: 1px solid rgba(148,163,184,0.15); border-radius: 9px; padding: 10px; margin-bottom: 10px; }
  .delta-sec { font-size: 12px; font-weight: 600; color: #cbd5e1; margin-bottom: 6px; }
  .delta-issue { font-weight: 400; color: #f59e0b; font-size: 11px; }
  .delta-cur { font-size: 12px; color: #94a3b8; margin-bottom: 5px; }
  .delta-opt { font-size: 12px; color: #d1fae5; }
  .delta-cur b, .delta-opt b { display: inline-block; font-size: 10px; letter-spacing: .5px; margin-right: 5px;
    text-transform: uppercase; opacity: .8; }
  .ats-foot { padding: 12px 16px; border-top: 1px solid rgba(148,163,184,0.15); }
  .ats-dl { width: 100%; background: #00e5ff; color: #001018; border: 0; border-radius: 9px; padding: 10px;
    font-weight: 700; font-size: 13px; cursor: pointer; }
  .ats-dl:hover { box-shadow: 0 0 14px rgba(0,229,255,0.4); }
</style>
</head>
<body>
<div id="app">
  <div id="scanline"></div>
  <header>
    <div>
      <div class="brand">J.A.R.V.I.S.</div>
      <div class="subtitle">PERSONAL AI INTERFACE</div>
    </div>
    <div class="header-right">
      <div class="tab-bar">
        <button class="tab-btn active" id="tab-jarvis" onclick="switchView('jarvis')">JARVIS</button>
        <button class="tab-btn" id="tab-privachat" onclick="switchView('privachat')">
          PrivaChat
          <span class="tab-badge" id="privachat-badge">0</span>
        </button>
        <button class="tab-btn" id="tab-terminal" onclick="switchView('terminal')">Terminal</button>
        <button class="tab-btn" id="tab-jobs" onclick="switchView('jobs')">Jobs<span class="tab-badge" id="jobs-ats-badge" style="display:none">0</span></button>
      </div>
      <div class="status-ring"><div class="pulse-dot"></div></div>
    </div>
  </header>
  <div id="jarvis-view" class="view active">
    <div id="chat-window"></div>
    <div id="input-bar">
      <div id="input-frame">
        <input id="msg-input" type="text" placeholder="Message JARVIS..." autocomplete="off">
      </div>
      <button id="voice-toggle-btn" title="Toggle JARVIS voice">
        <svg class="icon-on" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path>
          <path d="M19.07 4.93a10 10 0 0 1 0 14.14"></path>
        </svg>
        <svg class="icon-off" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon>
          <line x1="23" y1="9" x2="17" y2="15"></line>
          <line x1="17" y1="9" x2="23" y2="15"></line>
        </svg>
      </button>
      <button id="mic-btn" title="Voice input">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 2a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"></path>
          <path d="M19 10v1a7 7 0 0 1-14 0v-1"></path>
          <line x1="12" y1="18" x2="12" y2="22"></line>
          <line x1="8" y1="22" x2="16" y2="22"></line>
        </svg>
      </button>
      <button id="send-btn">SEND</button>
    </div>
  </div>
  <div id="privachat-view" class="view" style="position:relative">
    <button id="privachat-power-btn" onclick="togglePrivachat()" title="Turn PrivaChat on/off to save server time"
      style="position:absolute;top:10px;right:14px;z-index:10;padding:6px 10px;border:0;border-radius:8px;background:#dc2626;color:#fff;font-size:12px;cursor:pointer;opacity:.9">🔌 Turn Off</button>
    <div id="privachat-off-msg" style="display:none;position:absolute;inset:0;z-index:9;flex-direction:column;align-items:center;justify-content:center;gap:14px;background:#0b1120;color:#e5e7eb;text-align:center;padding:20px">
      <div>🔌 PrivaChat is off to save server time.<br><span style="color:#9ca3af;font-size:13px">It won't wake the engine while off.</span></div>
      <button onclick="setPrivachat(true)" style="padding:9px 16px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">🔗 Reconnect</button>
    </div>
    <iframe id="privachat-frame" src="" title="PrivaChat" allow="notifications"></iframe>
  </div>
  <div id="terminal-view" class="view">
    <div id="terminal-log"></div>
    <div id="terminal-input-bar">
      <span class="terminal-prompt">&gt;</span>
      <input id="terminal-input" type="text" placeholder="Type a command (e.g. list folder, system info)..." autocomplete="off">
      <input id="terminal-pdf-input" type="file" accept="application/pdf" style="display:none">
      <button id="terminal-pdf-btn" title="Upload a PDF" onclick="document.getElementById('terminal-pdf-input').click()">📎</button>
      <button id="cc-approve-btn" title="Approve the proposed Claude Code change" onclick="ccApprove()" style="display:none">✅ Approve</button>
      <button id="cc-mode-btn" title="Claude Code mode (enter secret once)" onclick="toggleCcMode()">🔐</button>
    </div>
  </div>
  <div id="jobs-view" class="view">
    <div id="jobs-toolbar">
      <span id="jobs-count">Applications</span>
      <div style="display:flex;gap:8px">
        <button id="jobs-resume" onclick="openResumeModal()" title="Set your master résumé (used for ATS analysis)">📄 Résumé</button>
        <button id="jobs-refresh" onclick="loadApplications()" title="Refresh">⟳</button>
      </div>
    </div>
    <div id="jobs-board"></div>
  </div>
</div>

<div id="resume-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9998;align-items:center;justify-content:center;padding:16px">
  <div class="ats-card" style="width:640px">
    <div class="ats-head">
      <div><div class="ats-title">📄 Master Résumé</div>
        <div class="ats-sub">Plain text. Used as the source for every ATS analysis — never sent anywhere except the LLM you trigger.</div></div>
      <button class="ats-x" onclick="closeResume()">✕</button>
    </div>
    <div class="ats-body">
      <textarea id="resume-text" style="width:100%;height:46vh;background:#0b1120;color:#e5e7eb;border:1px solid rgba(148,163,184,0.25);border-radius:9px;padding:10px;font-size:12px;font-family:inherit;resize:vertical" placeholder="Paste your Data Analyst résumé as plain text…"></textarea>
    </div>
    <div class="ats-foot"><button class="ats-dl" onclick="saveResume()">💾 Save Résumé</button></div>
  </div>
</div>

<div id="ats-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.65);z-index:9998;align-items:center;justify-content:center;padding:16px">
  <div class="ats-card">
    <div class="ats-head">
      <div>
        <div class="ats-title">🎯 ATS Alignment Analysis</div>
        <div id="ats-heading" class="ats-sub"></div>
      </div>
      <div class="ats-scorebox"><span id="ats-score">?/100</span><small>ATS match</small></div>
      <button class="ats-x" onclick="closeAts()">✕</button>
    </div>
    <div class="ats-tabbar">
      <button id="ats-tabbtn1" class="ats-tabbtn active" onclick="switchAtsTab(1)">Keyword Matrix</button>
      <button id="ats-tabbtn2" class="ats-tabbtn" onclick="switchAtsTab(2)">STAR / XYZ Plan</button>
    </div>
    <div class="ats-body">
      <div id="ats-tab1"></div>
      <div id="ats-tab2" style="display:none"></div>
    </div>
    <div class="ats-foot">
      <button id="ats-download" class="ats-dl">⬇ Download Optimized Text File</button>
    </div>
  </div>
</div>

<div id="cc-unlock-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9999;align-items:center;justify-content:center">
  <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:20px;width:300px;max-width:90%">
    <div style="color:#e5e7eb;font-weight:600;margin-bottom:10px">🔐 Unlock Claude Code</div>
    <div style="color:#9ca3af;font-size:12px;margin-bottom:10px">Enter your Claude Code secret. It's kept only for this browser tab.</div>
    <input id="cc-secret-input" type="password" autocomplete="off" placeholder="secret"
      style="width:100%;padding:9px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#e5e7eb;box-sizing:border-box">
    <div id="cc-modal-err" style="color:#f87171;font-size:12px;min-height:16px;margin-top:6px"></div>
    <div style="display:flex;gap:8px;margin-top:6px">
      <button onclick="submitCcSecret()" style="flex:1;padding:9px;border:0;border-radius:8px;background:#2563eb;color:#fff;cursor:pointer">Unlock</button>
      <button onclick="closeCcModal()" style="flex:1;padding:9px;border:0;border-radius:8px;background:#374151;color:#fff;cursor:pointer">Cancel</button>
    </div>
  </div>
</div>

<script>
const chatWindow = document.getElementById('chat-window');
const input = document.getElementById('msg-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const voiceToggleBtn = document.getElementById('voice-toggle-btn');

let voiceEnabled = localStorage.getItem('jarvis_voice_enabled') !== 'false';
voiceToggleBtn.classList.toggle('muted', !voiceEnabled);

const hasSpeechSynthesis = 'speechSynthesis' in window;

// Voice list loads asynchronously on most browsers (notably Chrome) — cache + refresh on change.
let cachedVoices = [];
function refreshVoices() {
  cachedVoices = hasSpeechSynthesis ? window.speechSynthesis.getVoices() : [];
}
if (hasSpeechSynthesis) {
  refreshVoices();
  window.speechSynthesis.onvoiceschanged = refreshVoices;
}

function pickVoice() {
  if (!cachedVoices.length) return null;
  return cachedVoices.find(v => /en-GB/i.test(v.lang) && /male|daniel|arthur|oliver|james/i.test(v.name))
      || cachedVoices.find(v => /en-GB/i.test(v.lang))
      || cachedVoices.find(v => /^en/i.test(v.lang))
      || cachedVoices[0];
}

// iOS Safari can silently drop the first speak() call unless it happens inside (or very
// close to) a real user-gesture handler — a silent warm-up utterance on the first tap fixes it.
let speechUnlocked = false;
function unlockSpeechSynthesis() {
  if (speechUnlocked || !hasSpeechSynthesis) return;
  speechUnlocked = true;
  const warmup = new SpeechSynthesisUtterance('');
  warmup.volume = 0;
  window.speechSynthesis.speak(warmup);
}
sendBtn.addEventListener('click', unlockSpeechSynthesis, { once: true });
micBtn.addEventListener('click', unlockSpeechSynthesis, { once: true });
input.addEventListener('keydown', unlockSpeechSynthesis, { once: true });

function setSpeaking(isSpeaking) {
  voiceToggleBtn.classList.toggle('speaking', isSpeaking);
}

function cleanForSpeech(text) {
  if (!text) return '';
  let cleaned = text.replace(/```[\\s\\S]*?```/g, ' Code example shown in the chat. ');
  cleaned = cleaned.replace(/`([^`]+)`/g, '$1');
  cleaned = cleaned.replace(/\\*\\*([^*]+)\\*\\*/g, '$1');
  cleaned = cleaned.replace(/\\*([^*]+)\\*/g, '$1');
  cleaned = cleaned.replace(/^#{1,3}\\s*/gm, '');
  cleaned = cleaned.replace(/^[-*]\\s+/gm, '');
  return cleaned.trim();
}

async function speak(text) {
  if (!voiceEnabled || !text || !hasSpeechSynthesis) return;
  voiceToggleBtn.classList.add('pending');
  try {
    let speechText = text;
    if (text.length > 400) {
      const res = await fetch('/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text })
      });
      if (res.ok) {
        const data = await res.json();
        speechText = data.speech_text || text;
      }
    }
    speechText = cleanForSpeech(speechText);
    voiceToggleBtn.classList.remove('pending');
    if (!speechText) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(speechText);
    const voice = pickVoice();
    if (voice) utterance.voice = voice;
    utterance.onstart = () => setSpeaking(true);
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.speak(utterance);
  } catch (err) {
    console.error('Voice playback failed', err);
    voiceToggleBtn.classList.remove('pending');
    setSpeaking(false);
  }
}

voiceToggleBtn.addEventListener('click', () => {
  voiceEnabled = !voiceEnabled;
  localStorage.setItem('jarvis_voice_enabled', String(voiceEnabled));
  voiceToggleBtn.classList.toggle('muted', !voiceEnabled);
  if (!voiceEnabled && hasSpeechSynthesis) {
    wind
    
    ow.speechSynthesis.cancel();
    setSpeaking(false);
  }
});

function timeNow() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatStoredTimestamp(ts) {
  if (!ts) return '';
  // SQLite CURRENT_TIMESTAMP is "YYYY-MM-DD HH:MM:SS" in UTC, no timezone marker
  const d = new Date(ts.replace(' ', 'T') + 'Z');
  if (isNaN(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function renderMarkdown(raw) {
  if (typeof raw !== 'string') {
    return raw == null ? '' : escapeHtml(String(raw));
  }
  try {
    // Pull fenced code blocks out first so their content survives untouched by other rules.
    const codeBlocks = [];
    let text = raw.replace(/```[a-zA-Z0-9]*\\n?([\\s\\S]*?)```/g, (match, code) => {
      codeBlocks.push(code.replace(/\\n$/, ''));
      return ' CODEBLOCK' + (codeBlocks.length - 1) + ' ';
    });

    text = escapeHtml(text);

    // Headers (#, ##, ###) — only when they start a line.
    text = text.replace(/^### (.+)$/gm, '<h3>$1</h3>');
    text = text.replace(/^## (.+)$/gm, '<h2>$1</h2>');
    text = text.replace(/^# (.+)$/gm, '<h1>$1</h1>');

    // Inline code.
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');

    // Bold: **text** then leftover single-asterisk *text* (WhatsApp-style, used elsewhere in this app).
    text = text.replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>');
    text = text.replace(/\\*([^*]+)\\*/g, '<strong>$1</strong>');

    // Consecutive "- " / "* " lines become a real <ul>.
    text = text.replace(/(?:^|\\n)((?:[-*] .+)(?:\\n[-*] .+)*)/g, (match, block) => {
      const items = block.split('\\n').map(line => '<li>' + line.replace(/^[-*]\\s+/, '') + '</li>').join('');
      return '\\n<ul>' + items + '</ul>';
    });

    text = text.replace(/\\n/g, '<br>');

    text = text.replace(/ CODEBLOCK(\\d+) /g, (match, idx) => {
      return '<pre><code>' + escapeHtml(codeBlocks[Number(idx)]) + '</code></pre>';
    });

    return text;
  } catch (err) {
    console.error('renderMarkdown failed, falling back to plain text', err);
    return escapeHtml(raw).replace(/\\n/g, '<br>');
  }
}

function appendBubble(text, who, timeStr) {
  const row = document.createElement('div');
  row.className = 'bubble-row ' + who;
  const bubble = document.createElement('div');
  bubble.className = 'bubble';
  if (who === 'agent') {
    bubble.innerHTML = renderMarkdown(text);
  } else {
    bubble.textContent = text;
  }
  const ts = document.createElement('div');
  ts.className = 'timestamp';
  ts.textContent = timeStr || timeNow();
  row.appendChild(bubble);
  row.appendChild(ts);
  chatWindow.appendChild(row);
  scrollToBottom();
}

function scrollToBottom() {
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

let typingRow = null;
function showTyping() {
  typingRow = document.createElement('div');
  typingRow.className = 'bubble-row agent';
  const dots = document.createElement('div');
  dots.className = 'typing-dots';
  dots.innerHTML = '<span></span><span></span><span></span>';
  typingRow.appendChild(dots);
  chatWindow.appendChild(typingRow);
  scrollToBottom();
}
function hideTyping() {
  if (typingRow) {
    typingRow.remove();
    typingRow = null;
  }
}

async function sendMessage() {
  const text = input.value.trim();
  if (!text) return;
  appendBubble(text, 'user');
  input.value = '';
  if (/^open terminal$/i.test(text)) {
    switchView('terminal');
    return;
  }
  showTyping();
  try {
    const res = await fetch('/chat-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text })
    });
    const data = await res.json();
    hideTyping();
    appendBubble(data.reply, 'agent');
    speak(data.reply);
  } catch (err) {
    hideTyping();
    appendBubble('⚠️ Connection error. Try again.', 'agent');
  }
}

sendBtn.addEventListener('click', sendMessage);
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendMessage();
  }
});

// Voice input — webkitSpeechRecognition. Auto-sends once it detects you've
// stopped talking (continuous=false + interimResults=false means onresult
// only fires after the browser's own end-of-speech detection).
let recognizing = false;
let recognizer = null;
if ('webkitSpeechRecognition' in window) {
  recognizer = new webkitSpeechRecognition();
  recognizer.continuous = false;
  recognizer.interimResults = false;
  recognizer.lang = 'en-US';

  recognizer.onresult = (event) => {
    const transcript = event.results[0][0].transcript;
    input.value = transcript;
    sendMessage();
  };
  recognizer.onend = () => {
    recognizing = false;
    micBtn.classList.remove('recording');
  };
  recognizer.onerror = () => {
    recognizing = false;
    micBtn.classList.remove('recording');
  };

  micBtn.addEventListener('click', () => {
    if (recognizing) {
      recognizer.stop();
      return;
    }
    recognizing = true;
    micBtn.classList.add('recording');
    recognizer.start();
  });
} else {
  micBtn.addEventListener('click', () => {
    appendBubble('⚠️ Voice input not supported in this browser.', 'agent');
  });
}

// Load persisted history on open so a refresh never wipes the conversation.
// Only show the canned greeting if there's no saved history yet.
async function loadHistory() {
  try {
    const res = await fetch('/chat-history');
    const data = await res.json();
    const messages = data.messages || [];
    if (messages.length > 0) {
      messages.forEach(m => {
        try {
          appendBubble(m.content, m.role === 'user' ? 'user' : 'agent', formatStoredTimestamp(m.timestamp));
        } catch (err) {
          console.error('Failed to render a history message, skipping it', err);
        }
      });
      return;
    }
  } catch (err) {
    console.error('Failed to load chat history', err);
  }
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'morning' : (hour < 17 ? 'afternoon' : 'evening');
  appendBubble('⚡ JARVIS online. Good ' + greeting + ', Madan.\\nWhat do you need?', 'agent');
}
loadHistory();
refreshAtsBadge();   // surface any unviewed ATS analyses on load

let currentView = 'jarvis';
let privachatUnread = 0;

function updatePrivachatBadge() {
  const badge = document.getElementById('privachat-badge');
  badge.textContent = privachatUnread > 9 ? '9+' : String(privachatUnread);
  badge.classList.toggle('visible', privachatUnread > 0);
}

// ---- PrivaChat connect/disconnect: the iframe holds a WebSocket + polling that wakes
// the engine on every call. To save Render hours we tear it down (about:blank) whenever
// you leave the tab / hide the app / press Turn Off, and reconnect on return.
let privachatManualOff = false;
function privachatSrc() {
  let src = '/privachat/';
  const saved = localStorage.getItem('jarvis_privachat_session');
  if (saved) {
    try {
      const { room, alias } = JSON.parse(saved);
      if (room && alias) src = `/privachat/chat?room=${encodeURIComponent(room)}&alias=${encodeURIComponent(alias)}`;
    } catch (e) {}
  }
  return src;
}
function setPrivachat(on) {
  const frame = document.getElementById('privachat-frame');
  const offMsg = document.getElementById('privachat-off-msg');
  const btn = document.getElementById('privachat-power-btn');
  if (on) {
    privachatManualOff = false;
    if (frame.dataset.loaded !== 'true') { frame.src = privachatSrc(); frame.dataset.loaded = 'true'; }
    frame.style.display = '';
    if (offMsg) offMsg.style.display = 'none';
    if (btn) btn.textContent = '🔌 Turn Off';
  } else {
    frame.src = 'about:blank';   // kills the WebSocket + polling inside the iframe
    delete frame.dataset.loaded;
    frame.style.display = 'none';
    if (offMsg) offMsg.style.display = 'flex';
    if (btn) btn.textContent = '🔗 Reconnect';
  }
}
function togglePrivachat() {
  const on = document.getElementById('privachat-frame').dataset.loaded === 'true';
  if (on) { privachatManualOff = true; setPrivachat(false); }
  else { setPrivachat(true); }
}

function switchView(view) {
  const prev = currentView;
  currentView = view;
  document.getElementById('tab-jarvis').classList.toggle('active', view === 'jarvis');
  document.getElementById('tab-privachat').classList.toggle('active', view === 'privachat');
  document.getElementById('tab-terminal').classList.toggle('active', view === 'terminal');
  document.getElementById('tab-jobs').classList.toggle('active', view === 'jobs');
  document.getElementById('jarvis-view').classList.toggle('active', view === 'jarvis');
  document.getElementById('privachat-view').classList.toggle('active', view === 'privachat');
  document.getElementById('terminal-view').classList.toggle('active', view === 'terminal');
  document.getElementById('jobs-view').classList.toggle('active', view === 'jobs');
  // Leaving privachat → disconnect it so it stops waking the engine.
  if (prev === 'privachat' && view !== 'privachat') setPrivachat(false);
  if (view === 'terminal') {
    document.getElementById('terminal-input').focus();
    pollTerminalHistory();            // catch up now that the Terminal is visible
  }
  if (view === 'jobs') { loadApplications(); refreshAtsBadge(); }
  if (view === 'privachat') {
    if (!privachatManualOff) setPrivachat(true);   // reconnect on return
    privachatUnread = 0;
    updatePrivachatBadge();
  }
}

// ── Applications (Jobs) kanban ──
const JOB_STATUSES = ['interested','applied','interviewing','offer','accepted','rejected'];
const JOB_EMOJI = {interested:'👀',applied:'📨',interviewing:'🗣️',offer:'🎉',accepted:'✅',rejected:'❌'};
function jobEsc(s){ return (s||'').replace(/[&<>"]/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c])); }
async function loadApplications(){
  const board=document.getElementById('jobs-board');
  board.innerHTML='<div class="kb-empty">Loading…</div>';
  try{
    const res=await fetch('/applications');
    const data=await res.json();
    renderKanban(data.applications||[]);
  }catch(e){ board.innerHTML='<div class="kb-empty">Failed to load.</div>'; }
}
function renderKanban(apps){
  document.getElementById('jobs-count').textContent='Applications ('+apps.length+')';
  const board=document.getElementById('jobs-board');
  if(!apps.length){ board.innerHTML='<div class="kb-empty">No applications yet.<br>Reply TRACK &lt;n&gt; on a job search to add one.</div>'; return; }
  const byStatus={}; JOB_STATUSES.forEach(s=>byStatus[s]=[]);
  apps.forEach(a=>{ (byStatus[a.status]=byStatus[a.status]||[]).push(a); });
  board.innerHTML=JOB_STATUSES.map(s=>{
    const items=byStatus[s]||[];
    return '<div class="kb-col"><div class="kb-col-head">'+JOB_EMOJI[s]+' '+s.charAt(0).toUpperCase()+s.slice(1)+' ('+items.length+')</div><div class="kb-col-body">'+items.map(cardHtml).join('')+'</div></div>';
  }).join('');
}
function cardHtml(a){
  const opts=JOB_STATUSES.map(s=>'<option value="'+s+'"'+(s===a.status?' selected':'')+'>'+s+'</option>').join('');
  const link=a.url?'<a href="'+jobEsc(a.url)+'" target="_blank" rel="noopener">open ↗</a>':'';
  return '<div class="kb-card"><div class="kb-title">'+jobEsc(a.title)+'</div><div class="kb-company">'+jobEsc(a.company||'')+(a.location?' · '+jobEsc(a.location):'')+'</div><div class="kb-actions"><select onchange="updateApp('+a.id+',this.value)">'+opts+'</select>'+link+'<button class="kb-ats" title="ATS resume analysis" onclick="runAts('+a.id+',this)">🎯</button><button class="kb-del" title="Remove" onclick="removeApp('+a.id+')">🗑</button></div></div>';
}
// ── ATS resume analysis ──
async function runAts(id, btn){
  const orig=btn?btn.textContent:''; if(btn){ btn.textContent='⏳'; btn.disabled=true; }
  try{
    const res=await fetch('/applications/'+id+'/ats',{method:'POST'});
    const data=await res.json();
    if(data.error){ alert('ATS: '+data.error); return; }
    openAtsModal(data);
    refreshAtsBadge();
  }catch(e){ alert('ATS analysis failed.'); }
  finally{ if(btn){ btn.textContent=orig||'🎯'; btn.disabled=false; } }
}
function openAtsModal(a){
  document.getElementById('ats-modal').style.display='flex';
  document.getElementById('ats-heading').textContent=(a.job_title||'')+' — '+(a.company||'')+(a.location?' ('+a.location+')':'');
  document.getElementById('ats-score').textContent=(a.ats_score!=null?a.ats_score:'?')+'/100';
  document.getElementById('ats-download').onclick=()=>{ window.open('/ats/'+encodeURIComponent(a.job_ref)+'/download','_blank'); };
  // Tab 1: keyword matrix
  const km=a.keyword_matrix||{}; const present=new Set(km.present||[]);
  const rows=(km.required||[]).map(k=>{
    const has=present.has(k);
    return '<tr><td>'+jobEsc(k)+'</td><td class="'+(has?'kw-yes':'kw-no')+'">'+(has?'✓ present':'✗ missing')+'</td></tr>';
  }).join('');
  document.getElementById('ats-tab1').innerHTML='<table class="kw-table"><thead><tr><th>Required by JD</th><th>Status</th></tr></thead><tbody>'+(rows||'<tr><td colspan=2>—</td></tr>')+'</tbody></table><p class="kw-note">Missing keywords are an honest gap report — learn them or judge role fit; they are not inserted into your bullets.</p>';
  // Tab 2: STAR/XYZ delta
  const deltas=(a.star_xyz_breakdown||[]).map(b=>
    '<div class="delta"><div class="delta-sec">'+jobEsc(b.section_name||'')+(b.issue?' <span class="delta-issue">'+jobEsc(b.issue)+'</span>':'')+'</div>'+
    '<div class="delta-cur"><b>Current</b> '+jobEsc(b.current_text||'')+'</div>'+
    '<div class="delta-opt"><b>Optimized</b> '+jobEsc(b.optimized_text||'')+'</div></div>'
  ).join('');
  document.getElementById('ats-tab2').innerHTML=deltas||'<p class="kw-note">No rewrite suggestions.</p>';
  switchAtsTab(1);
}
function switchAtsTab(n){
  document.getElementById('ats-tab1').style.display=n===1?'block':'none';
  document.getElementById('ats-tab2').style.display=n===2?'block':'none';
  document.getElementById('ats-tabbtn1').classList.toggle('active',n===1);
  document.getElementById('ats-tabbtn2').classList.toggle('active',n===2);
}
function closeAts(){ document.getElementById('ats-modal').style.display='none'; }
async function refreshAtsBadge(){
  try{
    const r=await fetch('/ats/pending/count'); const d=await r.json();
    const b=document.getElementById('jobs-ats-badge');
    if(d.count>0){ b.textContent=d.count; b.style.display='inline-block'; } else { b.style.display='none'; }
  }catch(e){}
}
async function openResumeModal(){
  document.getElementById('resume-modal').style.display='flex';
  try{ const d=await (await fetch('/resume')).json(); document.getElementById('resume-text').value=d.content||''; }catch(e){}
}
function closeResume(){ document.getElementById('resume-modal').style.display='none'; }
async function saveResume(){
  const content=document.getElementById('resume-text').value.trim();
  if(!content){ alert('Paste your résumé text first.'); return; }
  const r=await fetch('/resume/upload',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({content})});
  const d=await r.json();
  if(d.ok){ closeResume(); alert('✅ Résumé saved. ATS analysis is ready to use.'); } else { alert('Save failed.'); }
}
async function updateApp(id,status){
  await fetch('/applications/update',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,status})});
  loadApplications();
}
async function removeApp(id){
  if(!confirm('Remove this application?')) return;
  await fetch('/applications/delete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id})});
  loadApplications();
}

window.addEventListener('message', (event) => {
  const frame = document.getElementById('privachat-frame');
  if (event.source !== frame.contentWindow) return;
  if (event.data && event.data.type === 'privachat:session') {
    localStorage.setItem('jarvis_privachat_session', JSON.stringify({ room: event.data.room, alias: event.data.alias }));
  }
  if (event.data && event.data.type === 'privachat:left') {
    localStorage.removeItem('jarvis_privachat_session');
  }
  if (event.data && event.data.type === 'privachat:new-message' && currentView !== 'privachat') {
    privachatUnread += 1;
    updatePrivachatBadge();
  }
});

// ── Terminal tab: live feed of local_command_queue + direct command input ──
const terminalLog = document.getElementById('terminal-log');
const terminalInput = document.getElementById('terminal-input');
let terminalLastId = 0;
const terminalRenderedIds = new Set();
const terminalOpenRows = new Map(); // id -> status line element, for rows not yet completed

function appendTerminalLine(text, cls) {
  const line = document.createElement('div');
  line.className = 'term-line ' + cls;
  line.textContent = text;
  terminalLog.appendChild(line);
  terminalLog.scrollTop = terminalLog.scrollHeight;
  return line;
}

async function pollTerminalHistory() {
  // Only poll while the Terminal view is actually visible — a hidden tab OR sitting on
  // the JARVIS/PrivaChat view would otherwise hit /local-queue/history every few seconds
  // forever, keeping the free Render instance awake (defeats SCHEDULER_MODE=external).
  // switchView('terminal') and visibilitychange fire an immediate catch-up poll.
  if (document.hidden || currentView !== 'terminal') return;
  try {
    // While any row is still open (pending/executing), keep re-fetching from
    // just before it — otherwise its completion update is never seen once
    // its id falls below the watermark.
    const fetchFrom = terminalOpenRows.size
      ? Math.min(...terminalOpenRows.keys()) - 1
      : terminalLastId;
    const res = await fetch(`/local-queue/history?after_id=${fetchFrom}`);
    const data = await res.json();
    const commands = data.commands || [];
    commands.forEach(c => {
      terminalLastId = Math.max(terminalLastId, c.id);
      const openStatusEl = terminalOpenRows.get(c.id);
      // claude_code_chat turns are echoed by sendTerminalCommand() already
      // (the user's own typed message) — skip the redundant raw-payload cmd line.
      const isChat = c.command_type === 'claude_code_chat';

      if (c.status === 'completed') {
        if (openStatusEl) {
          openStatusEl.textContent = c.result || '(no output)';
          openStatusEl.className = 'term-line result';
          terminalOpenRows.delete(c.id);
        } else if (!terminalRenderedIds.has(c.id)) {
          if (!isChat) {
            const label = c.payload ? `${c.command_type} ${c.payload}` : c.command_type;
            appendTerminalLine(label, 'cmd');
          }
          appendTerminalLine(c.result || '(no output)', 'result');
        }
      } else if (!terminalRenderedIds.has(c.id)) {
        if (!isChat) {
          const label = c.payload ? `${c.command_type} ${c.payload}` : c.command_type;
          appendTerminalLine(label, 'cmd');
        }
        terminalOpenRows.set(c.id, appendTerminalLine(isChat ? '🤖 thinking...' : `[${c.status}]`, 'status'));
      }
      terminalRenderedIds.add(c.id);
    });
  } catch (err) {
    console.error('Terminal history poll failed', err);
  }
}
setInterval(pollTerminalHistory, 4000);
// When the whole app is backgrounded, disconnect privachat so it stops waking the engine.
// When it returns, resume the terminal feed / reconnect privachat as appropriate.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (currentView === 'privachat') setPrivachat(false);
  } else {
    if (currentView === 'terminal') pollTerminalHistory();
    if (currentView === 'privachat' && !privachatManualOff) setPrivachat(true);
  }
});

// ---- Claude Code mode: enter the secret once via a popup, then every task you type
// is auto-prefixed with `claude code: <secret> ` so you never paste the secret again.
// The secret lives only in this tab's sessionStorage (cleared when the tab closes).
let ccMode = false;
const ccModeBtn = document.getElementById('cc-mode-btn');
const ccApproveBtn = document.getElementById('cc-approve-btn');
const ccModal = document.getElementById('cc-unlock-modal');
const CC_CONTROL = ['approve claude code','cancel','end claude code session','exit claude code','exit claude code session'];

function ccSecret(){ return sessionStorage.getItem('cc_secret') || ''; }
function toggleCcMode(){
  if (ccMode){ setCcMode(false); return; }
  if (!ccSecret()){ openCcModal(); return; }
  setCcMode(true);
}
function setCcMode(on){
  ccMode = on;
  if (ccModeBtn){ ccModeBtn.textContent = on ? '🟢 CC' : '🔐'; ccModeBtn.style.color = on ? '#22c55e' : ''; }
  if (ccApproveBtn) ccApproveBtn.style.display = on ? '' : 'none';
  terminalInput.placeholder = on
    ? 'Claude Code: describe the task (secret auto-added)…'
    : 'Type a command (e.g. list folder, system info)...';
}
function openCcModal(){ document.getElementById('cc-modal-err').textContent=''; ccModal.style.display='flex'; document.getElementById('cc-secret-input').focus(); }
function closeCcModal(){ ccModal.style.display='none'; document.getElementById('cc-secret-input').value=''; }
function submitCcSecret(){
  const v = document.getElementById('cc-secret-input').value.trim();
  if (!v){ document.getElementById('cc-modal-err').textContent='Enter the secret.'; return; }
  sessionStorage.setItem('cc_secret', v);
  closeCcModal();
  setCcMode(true);
}
function ccLock(){ sessionStorage.removeItem('cc_secret'); setCcMode(false); }
function ccApprove(){ terminalInput.value = 'approve claude code'; sendTerminalCommand(); }
document.addEventListener('keydown', e => { if (e.key === 'Enter' && ccModal && ccModal.style.display === 'flex') submitCcSecret(); });

async function sendTerminalCommand() {
  const raw = terminalInput.value.trim();
  if (!raw) return;
  let toSend = raw;
  if (ccMode && !ccSecret()){ openCcModal(); return; }
  if (ccMode){
    const lower = raw.toLowerCase();
    const isControl = CC_CONTROL.includes(lower) || lower.startsWith('claude code');
    if (!isControl) toSend = `claude code: ${ccSecret()} ${raw}`;
  }
  appendTerminalLine(raw, 'cmd');   // show what you typed, never the secret
  terminalInput.value = '';
  appendTerminalLine('[running...]', 'status');
  try {
    const res = await fetch('/chat-message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: toSend })
    });
    const data = await res.json();
    terminalLog.lastChild.remove();
    appendTerminalLine(data.reply, 'result');
  } catch (err) {
    terminalLog.lastChild.remove();
    appendTerminalLine('⚠️ Connection error.', 'result');
  }
}

terminalInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    sendTerminalCommand();
  }
});

const terminalPdfInput = document.getElementById('terminal-pdf-input');
terminalPdfInput.addEventListener('change', async () => {
  const file = terminalPdfInput.files[0];
  terminalPdfInput.value = '';
  if (!file) return;
  appendTerminalLine(`📎 ${file.name}`, 'cmd');
  appendTerminalLine('[uploading PDF...]', 'status');
  const formData = new FormData();
  formData.append('file', file);
  try {
    const res = await fetch('/web-terminal/upload-pdf', { method: 'POST', body: formData });
    const data = await res.json();
    terminalLog.lastChild.remove();
    appendTerminalLine(data.reply, 'result');
  } catch (err) {
    terminalLog.lastChild.remove();
    appendTerminalLine('⚠️ Upload failed.', 'result');
  }
});
</script>
</body>
</html>"""


@app.get("/chat")
async def chat_ui():
    # The React console UI is now the primary interface. Redirect the legacy
    # /chat page to /console/ so there is a single UI. (CHAT_UI_HTML is kept as
    # a fallback below in case the console dist isn't built.)
    if os.path.isdir(_CONSOLE_DIST):
        return RedirectResponse(url="/console/", status_code=307)
    return HTMLResponse(content=CHAT_UI_HTML)


# ── PrivaChat reverse proxy ──────────────────────────────────────────────────
# PrivaChat is embedded as a same-origin iframe under "/privachat" so the
# browser will allow it to request notification permission directly (browsers
# block that permission prompt inside a cross-origin iframe). The actual app
# still runs on its own separate Render deployment; this just forwards traffic
# through so it appears to be part of this origin.
PRIVACHAT_HTTP_BASE = "https://privachat.onrender.com"
PRIVACHAT_WS_BASE = "wss://privachat.onrender.com"

@app.api_route("/privachat/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH"])
async def privachat_http_proxy(path: str, request: Request):
    url = f"{PRIVACHAT_HTTP_BASE}/privachat/{path}"
    body = await request.body()
    forward_headers = {
        k: v for k, v in request.headers.items()
        if k.lower() not in ("host", "content-length", "accept-encoding")
    }
    async with httpx.AsyncClient(follow_redirects=False, timeout=30.0) as client:
        upstream = await client.request(
            request.method, url,
            params=request.query_params,
            content=body,
            headers=forward_headers,
        )
    if len(upstream.content) > 512 * 1024:
        _mem_probe(f"proxy:{path} body={len(upstream.content)//1024}KB")
    excluded = {"content-encoding", "content-length", "transfer-encoding", "connection"}
    response_headers = {k: v for k, v in upstream.headers.items() if k.lower() not in excluded}
    return Response(
        content=upstream.content,
        status_code=upstream.status_code,
        headers=response_headers,
        media_type=upstream.headers.get("content-type"),
    )

@app.websocket("/privachat/ws/{room_code}/{alias}")
async def privachat_ws_proxy(websocket: WebSocket, room_code: str, alias: str):
    # Validate BEFORE building the upstream URL — raw path segments could otherwise smuggle
    # '../' or query params and redirect the proxy to an unintended upstream path.
    if not (re.fullmatch(r"[A-Za-z0-9_-]{1,64}", room_code) and re.fullmatch(r"[A-Za-z0-9_-]{1,64}", alias)):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    upstream_url = f"{PRIVACHAT_WS_BASE}/privachat/ws/{room_code}/{alias}"
    try:
        async with ws_lib.connect(upstream_url, ping_interval=10, ping_timeout=10) as upstream:
            async def client_to_upstream():
                while True:
                    msg = await websocket.receive_text()
                    await upstream.send(msg)

            async def upstream_to_client():
                async for msg in upstream:
                    await websocket.send_text(msg)

            tasks = [asyncio.ensure_future(client_to_upstream()), asyncio.ensure_future(upstream_to_client())]
            await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in tasks:
                t.cancel()
    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"[privachat-proxy] ws error: {e!r}", flush=True)
    finally:
        try:
            await websocket.close()
        except Exception:
            pass


# ── Search, Settings, and Job-Logs Console APIs ──────────────────────────────
@app.get("/api/settings")
async def api_get_settings():
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute("SELECT key, value FROM user_settings") as cursor:
            rows = await cursor.fetchall()
    settings = {r["key"]: r["value"] for r in rows}
    # Backfill Job Scout apply-desk defaults so the UI renders current-or-default values.
    from job_apply_agent import _DEFAULTS as _APPLY_DEFAULTS
    for k, v in _APPLY_DEFAULTS.items():
        settings.setdefault(k, v)
    # Inject read-only environment variables for reference
    settings["_env_gemini_model"] = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
    settings["_env_has_gemini_key"] = "yes" if os.environ.get("GEMINI_API_KEY") else "no"
    settings["_env_has_groq_key"] = "yes" if os.environ.get("GROQ_API_KEY") else "no"
    settings["_env_safe_mode"] = "yes" if SAFE_MODE else "no"
    return JSONResponse(settings)

@app.post("/api/settings")
async def api_save_settings(request: Request):
    body = await request.json()
    async with aiosqlite.connect(DB_PATH) as db:
        for k, v in body.items():
            if k.startswith("_"):  # Skip read-only env vars
                continue
            await db.execute(
                "INSERT OR REPLACE INTO user_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)",
                (k, str(v))
            )
        await db.commit()
    return JSONResponse({"ok": True})

@app.get("/api/job-logs")
async def api_job_logs(limit: int = 30):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, job_name, status, message, created_at FROM job_logs ORDER BY id DESC LIMIT ?",
            (limit,)
        ) as cur:
            rows = await cur.fetchall()
    return JSONResponse([dict(r) for r in rows])

@app.post("/api/job-logs/clear")
async def api_job_logs_clear():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM job_logs")
        await db.commit()
    return JSONResponse({"ok": True})


# ── In-app notifications (the JARVIS inbox that replaces WhatsApp) ────────────
@app.get("/api/notifications")
async def api_notifications(limit: int = 50):
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        async with db.execute(
            "SELECT id, body, category, read, created_at FROM notifications ORDER BY id DESC LIMIT ?",
            (limit,),
        ) as cur:
            rows = [dict(r) for r in await cur.fetchall()]
        # row_factory is Row here, so fetchone() is name-keyed — alias the count
        # instead of indexing [0] (which raises KeyError: 0 on a Row).
        async with db.execute("SELECT COUNT(*) AS n FROM notifications WHERE read = 0") as cur:
            unread = (await cur.fetchone())["n"]
    return JSONResponse({"notifications": rows, "unread": unread})


@app.get("/api/notifications/unread-count")
async def api_notifications_unread():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT COUNT(*) FROM notifications WHERE read = 0") as cur:
            unread = (await cur.fetchone())[0]
    return JSONResponse({"unread": unread})


@app.post("/api/notifications/read")
async def api_notifications_read(request: Request):
    body = await request.json()
    nid = body.get("id")
    async with aiosqlite.connect(DB_PATH) as db:
        if nid:
            await db.execute("UPDATE notifications SET read = 1 WHERE id = ?", (nid,))
        else:
            await db.execute("UPDATE notifications SET read = 1 WHERE read = 0")
        await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/notifications/clear")
async def api_notifications_clear():
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM notifications")
        await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/notifications/delete")
async def api_notifications_delete(request: Request):
    body = await request.json()
    nid = body.get("id")
    if not nid:
        return JSONResponse({"ok": False, "error": "id required"}, status_code=400)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM notifications WHERE id = ?", (nid,))
        await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/webhooks/render")
async def api_render_webhook(request: Request, token: str = ""):
    """Webhook receiver for Render deployment events. Translates build/deploy statuses
    into JARVIS notifications for the user."""
    if (deny := _cron_guard(token)) is not None:
        return deny
    try:
        body = await request.json()
    except Exception:
        return JSONResponse({"error": "invalid json"}, status_code=400)
        
    event_type = body.get("type")
    data = body.get("data") or {}
    service = data.get("service") or {}
    service_name = service.get("name") or "JARVIS Engine"
    
    if event_type == "deploy_ended":
        deploy = data.get("deploy") or {}
        status = deploy.get("status")
        if status == "succeeded":
            msg = f"🚀 System Update: The deployment has completed successfully, sir. All new updates are now active and the system engine is running smoothly."
            _store_notification(msg, "system")
        elif status == "failed":
            msg = f"⚠️ System Update: Pardon me, sir, but the latest deployment has failed to compile. You may want to check the build logs on Render."
            _store_notification(msg, "system")
    elif event_type == "deploy_started":
        msg = f"⚙️ System Update: I have detected a new code deployment starting for the system engine. Building the update now, sir."
        _store_notification(msg, "system")
        
    return JSONResponse({"status": "received"})


# ── Web Push subscription endpoints ──────────────────────────────────────────
@app.get("/api/push/vapid-public-key")
async def api_vapid_public_key():
    return JSONResponse({"key": VAPID_PUBLIC_KEY, "enabled": _PUSH_ENABLED})


@app.post("/api/push/subscribe")
async def api_push_subscribe(request: Request):
    sub = await request.json()
    endpoint = sub.get("endpoint")
    keys = sub.get("keys") or {}
    p256dh, auth = keys.get("p256dh"), keys.get("auth")
    if not (endpoint and p256dh and auth):
        return JSONResponse({"ok": False, "error": "invalid subscription"}, status_code=400)
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute(
            "INSERT OR REPLACE INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?, ?, ?)",
            (endpoint, p256dh, auth),
        )
        await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/push/unsubscribe")
async def api_push_unsubscribe(request: Request):
    body = await request.json()
    endpoint = body.get("endpoint")
    if endpoint:
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute("DELETE FROM push_subscriptions WHERE endpoint = ?", (endpoint,))
            await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/push/test")
async def api_push_test():
    """Fire a test notification through the full store+push path."""
    _store_notification("🔔 Test notification from JARVIS — Web Push is working.", category="test")
    return JSONResponse({"ok": True, "push_enabled": _PUSH_ENABLED})


# Real system metrics for the Core HUD — replaces the old decorative gauges.
# Every number here is derived from live process/DB state (no fake telemetry).
_AGENT_MODULES = [
    "job_scout_agent", "application_tracker", "resume_ats_agent",
    "calendar_agent", "weather_agent", "pattern_learning",
]
# Human-readable names for the Core HUD "AGENTS" tooltip.
_AGENT_NAMES = [
    "Job Scout", "Application Tracker", "Resume ATS",
    "Calendar", "Weather", "Pattern Learning",
]
MEM_LIMIT_MB = float(os.environ.get("MEM_LIMIT_MB", "512"))  # Render free tier


async def _count(db, sql: str, params: tuple = ()) -> int:
    try:
        async with db.execute(sql, params) as cur:
            row = await cur.fetchone()
            return int(row[0]) if row and row[0] is not None else 0
    except Exception:
        return 0


# Weather is cached for 10 min so the every-20s metrics poll doesn't hammer Open-Meteo.
_weather_cache = {"data": {}, "ts": 0.0}


async def _get_weather_cached() -> dict:
    now = time.time()
    if _weather_cache["data"] and (now - _weather_cache["ts"]) < 600:
        return _weather_cache["data"]
    data = await get_weather_data()
    if data:
        _weather_cache["data"] = data
        _weather_cache["ts"] = now
    return _weather_cache["data"] or {}


@app.get("/api/system-metrics")
async def api_system_metrics():
    rss = _rss_mb()
    mem_pct = round(min(100.0, max(0.0, (rss / MEM_LIMIT_MB) * 100))) if rss > 0 else 0
    threshold = float(get_setting("mem_alert_threshold_mb", str(DEFAULT_MEM_ALERT_MB)))

    reminders = automations = queue = ats_pending = patterns = errors_24h = 0
    async with aiosqlite.connect(DB_PATH) as db:
        reminders = await _count(db, "SELECT COUNT(*) FROM reminders WHERE status='active'")
        automations = await _count(db, "SELECT COUNT(*) FROM scheduled_automations WHERE status='active'")
        queue = await _count(db, "SELECT COUNT(*) FROM local_command_queue WHERE status='pending'")
        ats_pending = await _count(db, "SELECT COUNT(*) FROM ats_analysis_cache WHERE viewed = 0")
        patterns = await _count(db, "SELECT COUNT(*) FROM learned_patterns")
        errors_24h = await _count(
            db,
            "SELECT COUNT(*) FROM job_logs WHERE (LOWER(status) LIKE '%error%' OR LOWER(status) LIKE '%fail%') "
            "AND created_at >= datetime('now', '-1 day')",
        )

    backlog_total = reminders + automations + queue + ats_pending

    return JSONResponse({
        "memory": {
            "rss_mb": round(rss, 1),
            "limit_mb": MEM_LIMIT_MB,
            "pct": mem_pct,
            "status": "ok" if rss < threshold else "high",
        },
        "uptime": _uptime_str(),
        "uptime_seconds": int(time.time() - APP_START_TIME),
        "errors_24h": errors_24h,
        "backlog": {
            "total": backlog_total,
            "reminders": reminders,
            "automations": automations,
            "queue": queue,
            "ats_pending": ats_pending,
        },
        "agents": len(_AGENT_MODULES),
        "agent_names": _AGENT_NAMES,
        "patterns_learned": patterns,
        "db": _db_status(),
        "scheduler_mode": SCHEDULER_MODE,
        "weather": await _get_weather_cached(),
    })


def _day_series(n: int) -> list:
    """Last n calendar days as 'YYYY-MM-DD' strings (UTC), oldest first."""
    today = dt.datetime.now(dt.timezone.utc).date()
    return [(today - dt.timedelta(days=i)).isoformat() for i in range(n - 1, -1, -1)]


@app.get("/api/insights/llm")
async def api_insights_llm():
    """Live view of the LLM gateway (llm_gateway.py): per-provider circuit-breaker state
    and rate-limiter usage (in-memory, this process) fused with the historical provider /
    model split from the llm_calls ledger. Powers the 'Gateway health' card on Insights."""
    async def _rows(sql, args=()):
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(sql, args)
            return [dict(r) for r in await cur.fetchall()]

    live = GATEWAY.snapshot()

    prov_rows = await _rows("SELECT provider, COUNT(*) AS n FROM llm_calls GROUP BY provider")
    totals = [{"provider": r["provider"] or "unknown", "calls": r["n"]} for r in prov_rows]
    total_calls = sum(x["calls"] for x in totals)
    gemini_calls = sum(x["calls"] for x in totals if x["provider"] == "gemini")
    fallback_rate = round(100 * gemini_calls / total_calls) if total_calls else 0

    today_str = dt.datetime.now(dt.timezone.utc).date().isoformat()
    today_rows = await _rows(
        "SELECT COUNT(*) AS n FROM llm_calls WHERE substr(created_at,1,10) = ?", (today_str,))
    today = today_rows[0]["n"] if today_rows else 0

    model_rows = await _rows(
        "SELECT model, COUNT(*) AS n FROM llm_calls GROUP BY model ORDER BY n DESC LIMIT 8")
    models = [{"model": (r["model"] or "unknown").split("/")[-1][:24], "calls": r["n"]}
              for r in model_rows]

    return JSONResponse({
        "gateway": live,                 # {providers:{groq:{circuit,...}}, config:{...}}
        "totals": totals,                # lifetime calls per provider (from ledger)
        "total_calls": total_calls,
        "fallback_rate": fallback_rate,  # % served by the Gemini fallback
        "today": today,
        "models": models,                # which models actually answered
    })


@app.get("/api/analytics")
async def api_analytics():
    """Aggregates the console 'Insights' tab from data JARVIS already logs — activity,
    agent runs, errors, busiest hours, job pipeline, and dev-tool (Claude Code / Antigravity)
    usage. All grouped in-DB; substr(...,1,10) gets the day across every timestamp format."""
    DAYS = 14
    days = _day_series(DAYS)
    since = days[0]

    async def _rows(sql, args=()):
        async with aiosqlite.connect(DB_PATH) as db:
            db.row_factory = aiosqlite.Row
            cur = await db.execute(sql, args)
            return [dict(r) for r in await cur.fetchall()]

    # Activity per day: user chat messages + agent/job runs
    msg_rows = await _rows(
        "SELECT substr(timestamp,1,10) AS d, COUNT(*) AS n FROM chat_history "
        "WHERE role='user' AND substr(timestamp,1,10) >= ? GROUP BY d", (since,))
    job_rows = await _rows(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM job_logs "
        "WHERE substr(created_at,1,10) >= ? GROUP BY d", (since,))
    err_rows = await _rows(
        "SELECT substr(created_at,1,10) AS d, COUNT(*) AS n FROM job_logs "
        "WHERE lower(status) IN ('failed','error') AND substr(created_at,1,10) >= ? GROUP BY d", (since,))
    msg_map = {r["d"]: r["n"] for r in msg_rows}
    job_map = {r["d"]: r["n"] for r in job_rows}
    err_map = {r["d"]: r["n"] for r in err_rows}
    activity = [{"day": d[5:], "messages": msg_map.get(d, 0),
                 "jobs": job_map.get(d, 0), "errors": err_map.get(d, 0)} for d in days]

    # Agent/job run breakdown (all-time), success vs error + last-run status (health matrix)
    agent_rows = await _rows(
        "SELECT job_name AS name, COUNT(*) AS total, "
        "SUM(CASE WHEN lower(status) IN ('failed','error') THEN 1 ELSE 0 END) AS errors, "
        "MAX(created_at) AS last_run "
        "FROM job_logs GROUP BY job_name ORDER BY total DESC LIMIT 12")
    last_run_rows = await _rows(
        "SELECT j1.job_name AS name, j1.status AS status, j1.message AS message, "
        "j1.severity AS severity, j1.traceback AS traceback, j1.attempt_number AS attempt "
        "FROM job_logs j1 WHERE j1.id IN (SELECT MAX(id) FROM job_logs GROUP BY job_name)")
    last_details = {
        r["name"]: {
            "status": r["status"] or "",
            "message": r["message"] or "",
            "severity": r["severity"] or "info",
            "traceback": r["traceback"] or "",
            "attempt": r["attempt"] or 1
        }
        for r in last_run_rows
    }
    agents = []
    for r in agent_rows:
        nm = r["name"] or "unknown"
        details = last_details.get(nm, {"status": "", "message": "", "severity": "info", "traceback": "", "attempt": 1})
        st = details["status"].lower()
        health = "error" if st in ("failed", "error") else "ok"
        agents.append({
            "name": nm,
            "total": r["total"],
            "errors": r["errors"] or 0,
            "last_run": r["last_run"],
            "last_status": details["status"],
            "last_message": details["message"],
            "health": health,
            "severity": details["severity"],
            "traceback": details["traceback"],
            "attempt": details["attempt"]
        })
    tot_runs = sum(a["total"] for a in agents)
    tot_errs = sum(a["errors"] for a in agents)
    success_rate = round(100 * (1 - tot_errs / tot_runs)) if tot_runs else 100

    # LLM provider split (Groq primary vs Gemini fallback)
    llm_day = await _rows(
        "SELECT substr(created_at,1,10) AS d, provider, COUNT(*) AS n FROM llm_calls "
        "WHERE substr(created_at,1,10) >= ? GROUP BY d, provider", (since,))
    llm_tot = await _rows("SELECT provider, COUNT(*) AS n FROM llm_calls GROUP BY provider")
    llm_pmap = {}
    for r in llm_day:
        llm_pmap.setdefault(r["d"], {})[r["provider"]] = r["n"]
    llm_by_day = []
    for d in days:
        row = {"day": d[5:]}
        for prov, n in llm_pmap.get(d, {}).items():
            row[prov] = n
        llm_by_day.append(row)
    llm_totals = [{"provider": r["provider"] or "unknown", "calls": r["n"]} for r in llm_tot]
    llm_total_calls = sum(x["calls"] for x in llm_totals)
    gemini_calls = sum(x["calls"] for x in llm_totals if x["provider"] == "gemini")
    fallback_rate = round(100 * gemini_calls / llm_total_calls) if llm_total_calls else 0
    # Which specific models actually answered (the free-model chain) — the "model distribution".
    model_rows = await _rows(
        "SELECT model, COUNT(*) AS n FROM llm_calls GROUP BY model ORDER BY n DESC LIMIT 8")
    def _short_model(m):
        m = (m or "unknown").split("/")[-1]
        return m[:24]
    llm_models = [{"model": _short_model(r["model"]), "calls": r["n"]} for r in model_rows]
    today_str = dt.datetime.now(dt.timezone.utc).date().isoformat()
    today_rows = await _rows(
        "SELECT COUNT(*) AS n FROM llm_calls WHERE substr(created_at,1,10) = ?", (today_str,))
    llm_today = today_rows[0]["n"] if today_rows else 0

    # Busiest hours (user prompts by hour of day, all-time)
    hour_rows = await _rows(
        "SELECT substr(timestamp,12,2) AS h, COUNT(*) AS n FROM chat_history "
        "WHERE role='user' GROUP BY h")
    hour_map = {r["h"]: r["n"] for r in hour_rows}
    prompts_by_hour = [{"hour": f"{h:02d}", "count": hour_map.get(f"{h:02d}", 0)} for h in range(24)]

    # Job pipeline + ATS
    pipe_rows = await _rows("SELECT status, COUNT(*) AS n FROM applications GROUP BY status")
    pipeline = [{"status": r["status"], "count": r["n"]} for r in pipe_rows]
    ats_rows = await _rows("SELECT COUNT(*) AS n, AVG(ats_score) AS avg FROM ats_analysis_cache")
    ats_count = ats_rows[0]["n"] if ats_rows else 0
    ats_avg = round(ats_rows[0]["avg"] or 0) if ats_rows and ats_rows[0]["avg"] is not None else 0

    # Dev-tool usage (Claude Code / Antigravity)
    dev_day = await _rows(
        "SELECT day AS d, tool, SUM(tokens) AS tokens, SUM(cost) AS cost, SUM(duration_min) AS mins "
        "FROM dev_usage WHERE day >= ? GROUP BY day, tool", (since,))
    dev_tot = await _rows(
        "SELECT tool, SUM(tokens) AS tokens, SUM(cost) AS cost, SUM(duration_min) AS mins, COUNT(*) AS sessions "
        "FROM dev_usage GROUP BY tool ORDER BY tokens DESC")
    dev_by_day = []
    dmap = {}
    for r in dev_day:
        dmap.setdefault(r["d"], {})[r["tool"]] = {"tokens": r["tokens"] or 0, "cost": round(r["cost"] or 0, 4), "mins": round(r["mins"] or 0, 1)}
    for d in days:
        row = {"day": d[5:]}
        for tool, v in dmap.get(d, {}).items():
            row[tool] = v["tokens"]
        dev_by_day.append(row)
    dev_totals = [{"tool": r["tool"], "tokens": r["tokens"] or 0, "cost": round(r["cost"] or 0, 4),
                   "mins": round(r["mins"] or 0, 1), "sessions": r["sessions"]} for r in dev_tot]

    totals = {
        "messages": sum(msg_map.values()),
        "job_runs": sum(job_map.values()),
        "errors": sum(err_map.values()),
        "applications": sum(p["count"] for p in pipeline),
        "ats_runs": ats_count,
        "ats_avg": ats_avg,
    }
    return JSONResponse({
        "days": DAYS, "activity": activity, "agents": agents,
        "success_rate": success_rate,
        "llm_by_day": llm_by_day, "llm_totals": llm_totals, "fallback_rate": fallback_rate,
        "llm_models": llm_models, "llm_total_calls": llm_total_calls, "llm_today": llm_today,
        "prompts_by_hour": prompts_by_hour, "pipeline": pipeline,
        "dev_by_day": dev_by_day, "dev_totals": dev_totals, "totals": totals,
    })


@app.post("/api/dev-usage")
async def api_dev_usage(request: Request):
    """Log a Claude Code / Antigravity work session (manual entry or pushed by a local script)."""
    body = await request.json()
    tool = (body.get("tool") or "").strip().lower() or "claude-code"
    day = (body.get("day") or "").strip() or dt.datetime.now(dt.timezone.utc).date().isoformat()
    try:
        tokens = int(body.get("tokens") or 0)
    except Exception:
        tokens = 0
    try:
        cost = float(body.get("cost") or 0)
    except Exception:
        cost = 0.0
    try:
        duration = float(body.get("duration_min") or 0)
    except Exception:
        duration = 0.0
    note = (body.get("note") or "").strip()
    # replace=true (used by the backfill script) makes a day idempotent — re-running never
    # double-counts. Manual UI entries append (replace omitted), so you can log several a day.
    replace = bool(body.get("replace"))
    async with aiosqlite.connect(DB_PATH) as db:
        if replace:
            await db.execute("DELETE FROM dev_usage WHERE tool = ? AND day = ?", (tool, day))
        await db.execute(
            "INSERT INTO dev_usage (tool, day, tokens, cost, duration_min, note) VALUES (?,?,?,?,?,?)",
            (tool, day, tokens, cost, duration, note))
        await db.commit()
    return JSONResponse({"ok": True})


# ── Watched Influencers (Influencer Agent UI) ──
@app.get("/api/influencers")
async def api_influencers_list():
    from influencer_agent import get_watched_influencers
    return JSONResponse(await get_watched_influencers())


@app.post("/api/influencers")
async def api_influencers_add(request: Request):
    body = await request.json()
    platform = body.get("platform", "").strip().lower()
    handle = body.get("handle", "").strip()
    name = body.get("name", "").strip() or handle
    domain = (body.get("domain", "") or "").strip()
    yt_content = (body.get("yt_content", "all") or "all").strip().lower()
    if yt_content not in ("all", "videos", "shorts"):
        yt_content = "all"

    if not platform or not handle:
        return JSONResponse({"ok": False, "result": "Platform and handle are required."}, status_code=400)

    if platform == "youtube":
        from influencer_agent import resolve_youtube_channel_id
        handle = await resolve_youtube_channel_id(handle)
    else:
        yt_content = "all"  # only meaningful for YouTube

    async with aiosqlite.connect(DB_PATH) as db:
        try:
            await db.execute(
                "INSERT INTO watched_influencers (handle, platform, name, yt_content, domain) VALUES (?, ?, ?, ?, ?)",
                (handle, platform, name, yt_content, domain)
            )
            await db.commit()
            tag = f" → {domain}" if domain else ""
            return JSONResponse({"ok": True, "result": f"Added {name} ({platform}){tag}"})
        except aiosqlite.IntegrityError:
            return JSONResponse({"ok": False, "result": f"{name} is already registered."}, status_code=400)


@app.post("/api/influencers/{inf_id}/delete")
async def api_influencers_delete(inf_id: int):
    async with aiosqlite.connect(DB_PATH) as db:
        await db.execute("DELETE FROM watched_influencers WHERE id = ?", (inf_id,))
        await db.commit()
    return JSONResponse({"ok": True})


@app.post("/api/influencers/sync")
async def api_influencers_sync():
    from influencer_agent import run_influencer_watcher_digest
    digest = await run_influencer_watcher_digest(call_llm)
    return JSONResponse({"ok": True, "result": digest})


@app.post("/api/influencers/{inf_id}/sync")
async def api_influencers_sync_single(inf_id: int):
    from influencer_agent import run_single_influencer_sync
    digest = await run_single_influencer_sync(inf_id, call_llm)
    return JSONResponse({"ok": True, "result": digest})


@app.get("/api/influencers/feed")
async def api_influencers_feed(limit: int = 60, all: int = 0, domain: str = "", days: int = 5):
    """Persistent, relevance-ranked post history for the console feed view. Defaults to the last
    `days` days of content (recent-only); pass days=0 to see the full history."""
    from influencer_agent import get_feed
    posts = await get_feed(limit=limit, only_relevant=(all == 0), domain=domain.strip(), days=days)
    return JSONResponse(posts)


@app.post("/api/influencers/post/{post_id}/insight")
async def api_influencer_post_insight(post_id: str):
    """On-demand: brief summary of what a feed post says + a concrete 'use it in your project'
    takeaway. Cached on the post row, so repeat opens are free."""
    from influencer_agent import generate_post_insight
    result = await generate_post_insight(call_llm, post_id)
    _malloc_trim()  # release the video transcript / article text pulled during analysis
    return JSONResponse(result)


@app.post("/api/influencers/post/{post_id}/ground")
async def api_influencer_post_ground(post_id: str):
    """On-demand: perform real-time Google Search Grounding to verify / gather context on an influencer update."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT title, summary, name FROM influencer_posts WHERE post_id = ?", (post_id,)
        )
        row = await cur.fetchone()
    if not row:
        return JSONResponse({"error": "Post not found"}, status_code=404)

    title = row["title"]
    summary = row["summary"] or ""
    author = row["name"] or "Influencer"

    prompt = (
        f"You are JARVIS. Perform a real-time Google Search context validation and fact-check for this update "
        f"posted by {author}:\n"
        f"TITLE: {title}\n"
        f"CONTENT: {summary}\n\n"
        f"Search for:\n"
        f"1. Official documentation, release announcements, or GitHub repository activity relating to this update.\n"
        f"2. Validate the claims and state of the technology mentioned.\n"
        f"3. Provide clear links to official sources, doc pages, or repository URLs.\n"
        f"Format your response as a professional Factual Context & Grounding Brief."
    )

    if not GEMINI_API_KEY:
        return JSONResponse({"error": "GEMINI_API_KEY not configured"}, status_code=503)

    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "tools": [{"googleSearch": {}}]
    }

    try:
        async with httpx.AsyncClient(timeout=45) as client:
            res = await client.post(endpoint, json=body)
        if res.status_code != 200:
            return JSONResponse({"error": f"Gemini Grounding API returned {res.status_code}"}, status_code=500)

        data = res.json()
        candidate = data["candidates"][0]
        text = candidate["content"]["parts"][0]["text"]
        
        grounding_meta = candidate.get("groundingMetadata") or {}
        search_chunks = grounding_meta.get("groundingChunks") or []
        citations = []
        for chk in search_chunks:
            web = chk.get("web")
            if web:
                citations.append({"title": web.get("title", "Source"), "url": web.get("uri", "#")})

        result = {
            "grounded_context": text,
            "citations": citations[:6]
        }

        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                "UPDATE influencer_posts SET grounded_context = ? WHERE post_id = ?",
                (json.dumps(result), post_id)
            )
            await db.commit()

        return JSONResponse(result)
    except Exception as e:
        return JSONResponse({"error": f"Grounding failed: {str(e)}"}, status_code=500)


@app.get("/api/influencers/post/{post_id}/ground")
async def api_influencer_post_ground_get(post_id: str):
    """Retrieve cached grounding context for an influencer post."""
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        cur = await db.execute(
            "SELECT grounded_context FROM influencer_posts WHERE post_id = ?", (post_id,)
        )
        row = await cur.fetchone()
    if not row or not row["grounded_context"]:
        return JSONResponse({"error": "No grounding context found"}, status_code=404)
    try:
        return JSONResponse(json.loads(row["grounded_context"]))
    except Exception:
        return JSONResponse({"error": "Invalid grounding context cache"}, status_code=500)


@app.get("/api/influencers/domains")
async def api_influencers_domains():
    from influencer_agent import get_domains
    return JSONResponse(await get_domains())


@app.post("/api/influencers/discover")
async def api_influencers_discover(request: Request):
    """LLM-curate + validate the top YouTube creators for a domain. Adds nothing — review first."""
    body = await request.json()
    domain = (body.get("domain") or "").strip()
    if not domain:
        return JSONResponse({"ok": False, "result": "Domain is required."}, status_code=400)
    limit = int(body.get("limit") or 15)
    from influencer_agent import discover_creators_for_domain
    result = await discover_creators_for_domain(domain, call_llm, limit=limit)
    return JSONResponse({"ok": True, **result})


@app.post("/api/influencers/bulk-add")
async def api_influencers_bulk_add(request: Request):
    """Add reviewed creators to a domain (from the discovery review step)."""
    body = await request.json()
    domain = (body.get("domain") or "").strip()
    creators = body.get("creators") or []
    yt_content = (body.get("yt_content") or "videos").strip().lower()
    if yt_content not in ("all", "videos", "shorts"):
        yt_content = "videos"
    if not creators:
        return JSONResponse({"ok": False, "result": "No creators selected."}, status_code=400)
    from influencer_agent import bulk_add_creators
    result = await bulk_add_creators(domain, creators, yt_content)
    return JSONResponse({"ok": True, **result})


@app.get("/api/influencers/unread-count")
async def api_influencers_unread_count():
    from influencer_agent import get_unread_count
    return JSONResponse({"count": await get_unread_count()})


@app.post("/api/influencers/feed/read")
async def api_influencers_feed_read(request: Request):
    """Mark specific post_ids read, or all relevant posts when body is empty/omitted."""
    from influencer_agent import mark_feed_read
    try:
        body = await request.json()
    except Exception:
        body = {}
    ids = body.get("post_ids") if isinstance(body, dict) else None
    await mark_feed_read(ids)
    return JSONResponse({"ok": True})



# ── Bills / deadlines (Bill Watcher UI) ──
@app.get("/api/bills")
async def api_bills_list():
    return JSONResponse(await bills_view())


@app.post("/api/bills")
async def api_bills_add(request: Request):
    body = await request.json()
    ok, msg = await add_bill(
        name=body.get("name"),
        amount=body.get("amount") or 0,
        recurrence=(body.get("recurrence") or "monthly"),
        due_day=body.get("due_day"),
        due_date=body.get("due_date"),
        currency=body.get("currency"),
        category=body.get("category"),
        notify_days_before=body.get("notify_days_before") or 3,
    )
    return JSONResponse({"ok": ok, "result": msg}, status_code=200 if ok else 400)


@app.post("/api/bills/{bill_id}/paid")
async def api_bills_paid(bill_id: int):
    ok, msg = await mark_bill_paid_by_id(bill_id)
    return JSONResponse({"ok": ok, "result": msg}, status_code=200 if ok else 404)


@app.post("/api/bills/{bill_id}/delete")
async def api_bills_delete(bill_id: int):
    await delete_bill_by_id(bill_id)
    return JSONResponse({"ok": True})


@app.post("/api/run-job")
async def api_run_job(request: Request):
    body = await request.json()
    job_name = body.get("job_name")

    # Log every manual trigger immediately so it always shows in System Logs —
    # several of these jobs don't self-log otherwise.
    _KNOWN_JOBS = {"morning-digest", "job-scout", "learn-patterns", "reminders-due", "inbox-check", "weekly-report", "scan-applications", "bills-check"}
    if job_name in _KNOWN_JOBS:
        await _log_job(job_name, "triggered", "manual run from console")

    if job_name == "morning-digest":
        _run_bg_job("morning-digest", lambda: run_morning_digest())
        return JSONResponse({"ok": True, "message": "Morning digest started in background."})
    elif job_name == "job-scout":
        _run_bg_job("job-scout", lambda: run_job_scout_digest(
            call_llm, send_whatsapp_chunked, track_fn=add_scout_application, apply_hook=_job_apply_hook))
        return JSONResponse({"ok": True, "message": "Job scout digest started in background."})
    elif job_name == "learn-patterns":
        _run_bg_job("learn-patterns", lambda: refresh_all_patterns(call_llm))
        return JSONResponse({"ok": True, "message": "Pattern learning started in background."})
    elif job_name == "reminders-due":
        try:
            fired = await _fire_due_reminders_and_automations()
            await _log_job("reminders-due", "success", f"fired {fired} due reminder(s)", "info", "", 1)
            return JSONResponse({"ok": True, "message": f"Reminders check complete. Fired {fired} due reminders."})
        except Exception as e:
            import traceback
            tb_str = traceback.format_exc()
            await _log_job("reminders-due", "failed", str(e), "error", tb_str, 1)
            return JSONResponse({"ok": False, "error": f"Reminders check failed: {str(e)}"}, status_code=500)
    elif job_name == "inbox-check":
        _run_bg_job("inbox-check", lambda: check_inbox_and_notify(call_llm, send_whatsapp_chunked))
        return JSONResponse({"ok": True, "message": "Inbox check started in background."})
    elif job_name == "weekly-report":
        _run_bg_job("weekly-report", lambda: send_weekly_report())
        return JSONResponse({"ok": True, "message": "Weekly report send started in background."})
    elif job_name == "scan-applications":
        _run_bg_job("scan-applications", lambda: scan_application_emails(call_llm, _store_notification))
        return JSONResponse({"ok": True, "message": "Scanning your email to sync the board…"})
    elif job_name == "bills-check":
        sent = await check_bills_and_notify(_store_notification)
        await _log_job("bills-check", "completed", f"sent {sent} bill alert(s)")
        return JSONResponse({"ok": True, "message": f"Bill check complete. Sent {sent} alert(s)."})

    return JSONResponse({"ok": False, "error": f"Unknown job: {job_name}"}, status_code=400)

@app.get("/api/search")
async def api_search(q: str = ""):
    q = q.strip()
    if not q:
        return JSONResponse({"results": []})
    
    results = []
    like_pat = f"%{q}%"
    
    async with aiosqlite.connect(DB_PATH) as db:
        db.row_factory = aiosqlite.Row
        
        # 1. Search Applications
        try:
            async with db.execute(
                "SELECT id, title, company, location, status FROM applications WHERE title LIKE ? OR company LIKE ? OR location LIKE ? LIMIT 5",
                (like_pat, like_pat, like_pat)
            ) as cur:
                for r in await cur.fetchall():
                    results.append({
                        "category": "Applications",
                        "title": f"{r['title']} at {r['company']}",
                        "subtitle": f"{r['location']} — Status: {r['status']}",
                        "target": "jobs",
                        "meta": {"id": r["id"]}
                    })
        except Exception as e:
            print(f"Search applications error: {e}")
            
        # 2. Search Chat History
        try:
            async with db.execute(
                "SELECT content, timestamp, role FROM chat_history WHERE content LIKE ? LIMIT 5",
                (like_pat,)
            ) as cur:
                for r in await cur.fetchall():
                    results.append({
                        "category": "Chat History",
                        "title": r["content"][:80] + ("..." if len(r["content"]) > 80 else ""),
                        "subtitle": f"{r['role']} — {r['timestamp']}",
                        "target": "assistant",
                        "meta": {}
                    })
        except Exception as e:
            print(f"Search chat history error: {e}")

        # 3. Search Reminders
        try:
            async with db.execute(
                "SELECT text, run_at, hour, minute, status FROM reminders WHERE text LIKE ? LIMIT 5",
                (like_pat,)
            ) as cur:
                for r in await cur.fetchall():
                    due_info = r["run_at"] if r["run_at"] else f"{r['hour']:02d}:{r['minute']:02d}" if r["hour"] is not None else "recurring"
                    results.append({
                        "category": "Reminders",
                        "title": r["text"],
                        "subtitle": f"Due: {due_info} — Status: {r['status']}",
                        "target": "terminal",
                        "meta": {}
                    })
        except Exception as e:
            print(f"Search reminders error: {e}")

        # 4. Search Knowledge Store
        try:
            async with db.execute(
                "SELECT title, url FROM knowledge_store WHERE title LIKE ? OR content LIKE ? LIMIT 5",
                (like_pat, like_pat)
            ) as cur:
                for r in await cur.fetchall():
                    results.append({
                        "category": "Knowledge Store",
                        "title": r["title"] or r["url"],
                        "subtitle": r["url"],
                        "target": "core",
                        "meta": {}
                    })
        except Exception as e:
            print(f"Search knowledge store error: {e}")

        # 5. Search Job Logs (System Activities)
        try:
            async with db.execute(
                "SELECT job_name, status, message, created_at FROM job_logs WHERE job_name LIKE ? OR message LIKE ? LIMIT 5",
                (like_pat, like_pat)
            ) as cur:
                for r in await cur.fetchall():
                    results.append({
                        "category": "System Logs",
                        "title": f"{r['job_name']} ({r['status']})",
                        "subtitle": f"{r['message']} — {r['created_at']}",
                        "target": "core",
                        "meta": {}
                    })
        except Exception as e:
            print(f"Search job logs error: {e}")

        # 6. Search Matched Jobs (Job Scout results)
        try:
            async with db.execute(
                "SELECT title, company, location, score, status FROM matched_jobs "
                "WHERE title LIKE ? OR company LIKE ? OR location LIKE ? OR why LIKE ? "
                "ORDER BY score DESC LIMIT 5",
                (like_pat, like_pat, like_pat, like_pat)
            ) as cur:
                for r in await cur.fetchall():
                    results.append({
                        "category": "Matched Jobs",
                        "title": f"{r['title']} at {r['company']}",
                        "subtitle": f"{r['location']} — Match {r['score']}/100 — {r['status']}",
                        "target": "jobs",
                        "meta": {}
                    })
        except Exception as e:
            print(f"Search matched jobs error: {e}")

        # 7. Search ATS Analyses
        try:
            async with db.execute(
                "SELECT job_ref, job_title, company, ats_score FROM ats_analysis_cache "
                "WHERE job_title LIKE ? OR company LIKE ? OR job_ref LIKE ? "
                "ORDER BY created_at DESC LIMIT 5",
                (like_pat, like_pat, like_pat)
            ) as cur:
                for r in await cur.fetchall():
                    results.append({
                        "category": "ATS Analyses",
                        "title": f"{r['job_title']} at {r['company']}",
                        "subtitle": f"ATS Score {r['ats_score']}/100 — ref {r['job_ref']}",
                        "target": "jobs",
                        "meta": {"job_ref": r["job_ref"]}
                    })
        except Exception as e:
            print(f"Search ATS analyses error: {e}")

    return JSONResponse({"results": results})


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("V3_updates:app", host="0.0.0.0", port=port, reload=False)

#@app.get("/clear-today")
#async def clear_today():
        #from datetime import date
        #today = date.today().isoformat()
        #async with aiosqlite.connect(DB_PATH) as db:
         #   async with db.execute("SELECT id FROM quiz_sessions WHERE date=?", (today,)) as cursor:
          #      session_ids = [row[0] for row in await cursor.fetchall()]
           # for sid in session_ids:
             #   await db.execute("DELETE FROM quiz_answers WHERE session_id=?", (sid,))
            #await db.execute("DELETE FROM quiz_sessions WHERE date=?", (today,))
            #await db.execute("DELETE FROM performance_log WHERE date=?", (today,))
           # await db.execute("DELETE FROM daily_checkins WHERE date=?", (today,))
            #await db.execute("DELETE FROM sent_history WHERE timestamp LIKE ?", (f"{today}%",))
            #await db.commit()
        #return {"status": f"All data for {today} cleared successfully"}
        

        