import os
import sqlite3
import requests
from bs4 import BeautifulSoup
from fastapi import FastAPI, Response, Form
from twilio.rest import Client
from apscheduler.schedulers.background import BackgroundScheduler
from contextlib import asynccontextmanager

# Core Credentials
TWILIO_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
CLAUDE_API_KEY = os.getenv("ANTHROPIC_API_KEY")
FROM_WHATSAPP = "whatsapp:+14155238886"
TO_WHATSAPP = "whatsapp:+919963214141"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "agent_memory.db")

def init_db_tables():
    """Ensures all required tracking tables exist on boot (crucial for cloud deployments)."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    
    # 1. Core Profile Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_profile (
            key TEXT PRIMARY KEY,
            value TEXT
        )
    ''')
    
    # Seed default skill level if the table was just created empty
    cursor.execute("SELECT value FROM user_profile WHERE key='skill_level'")
    if not cursor.fetchone():
        cursor.execute("INSERT INTO user_profile (key, value) VALUES ('skill_level', 'Foundational')")
        print("💾 State Engine: Initialized default 'Foundational' profile state on host server.")

    # 2. Sent Concept History Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS sent_history (
            concept TEXT PRIMARY KEY,
            summary TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')

    # 3. Conversational Chat History Table
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS chat_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            role TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ State Engine: All database tables verified and ready.")

# 🚀 RUN THE INITIALIZER IMMEDIATELY ON SCRIPBOOT
init_db_tables()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Spin up the background scheduler clock
    scheduler = BackgroundScheduler(timezone="Asia/Kolkata") # Set to your local India timezone
    
    # Schedule 'run_morning_digest' to execute every single day at 9:00 AM
    scheduler.add_job(run_morning_digest, "cron", hour=22, minute=23)
    scheduler.start()
    print("⏰ Automated Scheduler Active: Set to fire daily at 09:00 AM.")
    
    yield
    
    # Shutdown when the server stops
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)


# ==========================================
# 1. DATABASE STATE UTILITIES
# ==========================================
def get_db_state():
    # FIXED: Added check_same_thread=False to allow background thread execution
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute("SELECT value FROM user_profile WHERE key='skill_level'")
    skill = cursor.fetchone()[0]
    
    cursor.execute("SELECT concept, summary FROM sent_history ORDER BY timestamp DESC LIMIT 7")
    rows = cursor.fetchall()
    
    history_concepts = [row[0] for row in rows]
    full_history_log = "\n---\n".join([f"Concept: {row[0]}\nFull Payload Sent:\n{row[1]}" for row in rows])
    
    conn.close()
    return skill, history_concepts, full_history_log

def update_db_skill(new_level):
    # FIXED: Added check_same_thread=False
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute("UPDATE user_profile SET value=? WHERE key='skill_level'", (new_level,))
    conn.commit()
    conn.close()

def log_sent_concept(concept, summary):
    # FIXED: Added check_same_thread=False
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO sent_history (concept, summary) VALUES (?, ?)", (concept, summary))
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()


def log_sent_concept(concept, summary):
    # FIXED: Added check_same_thread=False
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    try:
        cursor.execute("INSERT INTO sent_history (concept, summary) VALUES (?, ?)", (concept, summary))
        conn.commit()
    except sqlite3.IntegrityError:
        pass
    conn.close()



def log_chat_message(role, content):
    """Logs a message (either from 'user' or 'assistant') into the database."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    cursor.execute("INSERT INTO chat_history (role, content) VALUES (?, ?)", (role, content))
    conn.commit()
    conn.close()

def get_recent_chat_history(limit=5):
    """Retrieves the last N messages formatted specifically for Anthropic's API structure."""
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    cursor = conn.cursor()
    # Fetch latest messages first, then reverse them to keep chronological order
    cursor.execute("SELECT role, content FROM chat_history ORDER BY timestamp DESC LIMIT ?", (limit,))
    rows = cursor.fetchall()
    conn.close()
    
    # Format rows into standard Anthropic message structures
    history = [{"role": row[0], "content": row[1]} for row in reversed(rows)]
    return history



# ==========================================
# 2. WEB SOURCE INGESTION
# ==========================================
def fetch_live_internet_updates():
    compiled_news = []
    search_url = "https://html.duckduckgo.com/html/?q=latest+artificial+intelligence+news+breakthroughs"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"}
    try:
        res = requests.get(search_url, headers=headers, timeout=10)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            links = soup.find_all('a', class_='result__url')[:6]
            for link in links:
                compiled_news.append(link.text.strip())
    except:
        pass
    return "\n".join(compiled_news) if compiled_news else "Scaling multi-agent frameworks."

# ==========================================
# 3. CREATOR AGENT (GENERATOR WITH CRITIC FEEDBACK)
# ==========================================
def generate_daily_payload(raw_data, skill_level, exclusions, feedback_loop_msg=""):
    print("🤖 [Creator Agent]: Requesting a compact update from Claude...")
    url = "https://api.anthropic.com/v1/messages"
    headers = {"x-api-key": CLAUDE_API_KEY, "anthropic-version": "2023-06-01", "content-type": "application/json"}
    
    prompt = f"""
You are the Lead Curriculum Director for an Engineer tracking towards Agentic AI Test Architecture.
Current Student State Difficulty Track: {skill_level}
Strict Exclusion List (Topics covered recently, DO NOT REPEAT): {exclusions}

Using these fresh live internet updates:
{raw_data}

CRITICAL SIZE CONSTRAINT: Your total output response must be strictly under 1300 characters to fit on a messaging screen. Keep every single bullet point brief, ultra-short, single-sentence, and tightly compressed. Do not add conversational fluff.

Structure your response EXACTLY matching this layout. Use ONLY asterisks (*) for WhatsApp bold text formatting. No markdown hashes (#) or markdown tables.

*🔴 REGULAR DAILY AI UPDATES*
(Provide exactly 5 to 7 high-signal, short, single-sentence points blending these live internet updates with core principles from the Generalist Roadmap tracks like Advanced Prompting/Scaffolding, RAG systems, and Multi-Agent Topologies).

*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*
- *Core Concept to Master Today*: [Provide a specific concept name here] — Followed by a 1 sentence explanation tailored to the {skill_level} track.
- *Practical Mini-Project Blueprint*: A quick technical project loop.
- *QA Validation Lines*: Write exactly 3 short 'assert' code verification lines.
"""

    if feedback_loop_msg:
        prompt += f"\n\n⚠️ CRITICAL CORRECTION REQUIRED FROM PREVIOUS ATTEMPT:\n{feedback_loop_msg}"

    data = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 800,
        "temperature": 0.2,
        "messages": [{"role": "user", "content": prompt}]
    }
    
    response = requests.post(url, headers=headers, json=data)
    if response.status_code != 200:
        raise Exception(f"API Error {response.status_code}: {response.text}")
    return response.json()["content"][0]["text"]

# ==========================================
# 4. RESTORED QA CRITIC AGENT (AUDITOR ENGINE)
# ==========================================
def run_qa_critic(content):
    print("🕵️‍♂️ [QA Critic Agent]: Verifying pipeline parameters...")
    
    has_updates = "*🔴 REGULAR DAILY AI UPDATES*" in content
    has_learnings = "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*" in content
    has_assert_syntax = "assert " in content
    
    char_length = len(content)
    within_twilio_limit = char_length <= 1550
    
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
    if not has_assert_syntax: errors.append("Missing executable 'assert' statements.")
    if not within_twilio_limit: errors.append(f"Payload out of size bounds ({char_length}/1600 chars).")
    if not (0 <= update_count <= 7): errors.append(f"Density check mismatch. Found {update_count} updates, expected 5-7.")

    print("\n" + "="*50)
    print("📊 QA CRITIC STATUS AND INTEGRITY METRICS")
    print("-"*50)
    print(f"  - Daily Updates Section:         {'PASS' if has_updates else 'FAIL'}")
    print(f"  - Learning & Projects Section:  {'PASS' if has_learnings else 'FAIL'}")
    print(f"  - QA Assertion Lines Included:   {'PASS' if has_assert_syntax else 'FAIL'}")
    print(f"  - Twilio Message Size Safety:    {char_length}/1600 chars ({'PASS' if within_twilio_limit else 'FAIL'})")
    print(f"  - Density Metric:                {update_count} updates processed")
    
    if not errors:
        print("\nSTATUS: ALL PARAMETERS ARE WORKING FINE. RELEASING PAYLOAD.")
        print("="*50 + "\n")
        return True, ""
    else:
        feedback_report = " | ".join(errors)
        print(f"\nSTATUS: REJECTED. Violations: {feedback_report}")
        print("="*50 + "\n")
        return False, feedback_report

# ==========================================
# 5. ENDPOINTS WITH EMBEDDED RETRY AGENT LOOPS
# ==========================================
@app.post("/run-morning-digest")
def run_morning_digest():
    skill_level, recent_topics, full_history_log = get_db_state()
    raw_news = fetch_live_internet_updates()
    exclusions = ", ".join(recent_topics) if recent_topics else "None"
    
    max_retries = 3
    current_attempt = 1
    feedback = ""
    final_text = ""
    is_valid_run = False
    
    while current_attempt <= max_retries:
        print(f"🔄 Evaluation Run Sequence: Loop {current_attempt}/{max_retries}")
        try:
            final_text = generate_daily_payload(raw_news, skill_level, exclusions, feedback_loop_msg=feedback)
            is_valid_run, feedback = run_qa_critic(final_text)
            if is_valid_run:
                break
            current_attempt += 1
        except Exception as e:
            print(f"❌ Internal processing failure: {e}")
            break
            
    if is_valid_run:
        try:
            concept_part = final_text.split("*Core Concept to Master Today*:")[1].split("—")[0].strip()
        except:
            concept_part = f"Topic-{len(recent_topics)}"
            
        log_sent_concept(concept_part, final_text)
        
        try:
            twilio_client = Client(TWILIO_SID, TWILIO_TOKEN)
            twilio_client.messages.create(body=final_text, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
            return {"status": "Digest approved and dispatched.", "concept": concept_part}
        except Exception as e:
            return {"status": "QA Passed, but Twilio failed to dispatch", "error": str(e)}
    else:
        return {"status": "Aborted. Failed structural validation limits.", "errors": feedback}

@app.post("/whatsapp-webhook")
def incoming_whatsapp_reply(Body: str = Form(...)):
    user_message = Body.strip()
     # 🚀 NEW UPGRADE: Manual Trigger Command
    if user_message.lower() in ["digest", "refresh", "force digest"]:
        print("⚡ [Manual Override]: 'digest' keyword detected. Triggering morning engine immediately...")
        # Fire off your existing morning digest routine directly
        digest_status = run_morning_digest()
        
        # Log this specific control event into your chat history
        log_chat_message("user", user_message)
        log_chat_message("assistant", f"Manual trigger activated. Status: {digest_status.get('status')}")
        
        return Response(content="<Response></Response>", media_type="text/xml")
    # 1. Log the incoming user message to the database immediately
    log_chat_message("user", user_message)
    
    skill_level, recent_topics, full_history_log = get_db_state()   
    exclusions = ", ".join(recent_topics) if recent_topics else "None"
    
    print(f"📥 Received WhatsApp message: '{user_message}' [Current Track: {skill_level}]")
    
    url = "https://api.anthropic.com/v1/messages"
    headers = {
        "x-api-key": CLAUDE_API_KEY, 
        "anthropic-version": "2023-06-01", 
        "content-type": "application/json"
    }
    
    system_instruction = f"""
You are an expert AI Test Architect and Curriculum Coach guiding an engineer named Madan transitioning into Agentic AI Quality Engineering.
The student's current skill track level is: {skill_level}
The topics covered recently are: {exclusions}

CRITICAL WHATSAPP CONVERSATIONAL FORMATTING RULES:
1. NEVER send long paragraphs, essays, or walls of text. 
2. Keep responses highly interactive, snappy, and restricted to 2-4 sentences max per message block.
3. If providing technical details, use short, punchy bullet points.
4. Match his energy as a sharp, practical engineering peer. Use emojis sparingly (e.g., 🚀, 🔍, 🛠️) to cleanly format text blocks.
5. Always end your response with a single, highly contextual, open-ended question to keep the conversation flowing.

EXECUTION LOGIC:
- If the user explicitly asks to scale up the difficulty, mention that you are shifting their profile state to 'Advanced'.
- If they ask to slow down or request simpler foundations, mention that you are shifting their profile state to 'Foundational'.
- If they submit code snippets or questions about a mini-project, review their implementation instantly and provide a brief QA code critique or advice.
"""

    # 2. Fetch the last 5 messages from the database to give Claude memory context
    conversation_history = get_recent_chat_history(limit=5)

    data = {
        "model": "claude-sonnet-4-6",
        "max_tokens": 500,
        "temperature": 0.3,
        "system": system_instruction,  
        "messages": conversation_history  # 🚀 Claude now receives the full recent context array!
    }
    
    try:
        res = requests.post(url, headers=headers, json=data)
        if res.status_code != 200:
            print(f"❌ Anthropic API Rejected Request: Status {res.status_code} - {res.text}")
            raise Exception("API rejected request parameters.")
            
        res_json = res.json()
        ai_response = res_json["content"][0]["text"].strip()
        
        # 3. Log Claude's response as the assistant so it's remembered next time
        log_chat_message("assistant", ai_response)
        
        # Stateful Self-Correction
        if "shifting their profile state to 'Advanced'" in ai_response or "to *Advanced*" in ai_response:
            update_db_skill("Advanced")
            print("💾 State Engine: Automatically scaled user state to Advanced.")
        elif "shifting their profile state to 'Foundational'" in ai_response or "to *Foundational*" in ai_response:
            update_db_skill("Foundational")
            print("💾 State Engine: Automatically dialed user state back to Foundational.")
            
    except Exception as e:
        print(f"❌ Webhook LLM routing error: {e}")
        ai_response = "⚠️ Connection to the coaching engine was interrupted. Please check your terminal console logs for structural issues."

    # Echo the dialogue back directly to your phone thread
    client = Client(TWILIO_SID, TWILIO_TOKEN)
    client.messages.create(body=ai_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
    return Response(content="<Response></Response>", media_type="text/xml")

if __name__ == "__main__":
    import uvicorn
    # Read the port assigned by Render, defaulting to 8000 locally
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("V3_updates:app", host="0.0.0.0", port=port, reload=False)