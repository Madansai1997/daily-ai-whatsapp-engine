import os
import sqlite3
import aiosqlite
import asyncio
import json
import requests
import subprocess
import random
import re
import base64
from bs4 import BeautifulSoup
from fastapi import FastAPI, Response, Form
from twilio.rest import Client
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from contextlib import asynccontextmanager
from anthropic import AsyncAnthropic
from rag_engine import retrieve_relevant_context

# Core Credentials
TWILIO_SID = os.getenv("TWILIO_SID")
TWILIO_TOKEN = os.getenv("TWILIO_TOKEN")
CLAUDE_API_KEY = os.getenv("CLAUDE_API_KEY")
CLAUDE_MODEL = "claude-sonnet-4-6"
FROM_WHATSAPP = "whatsapp:+14155238886"
TO_WHATSAPP = "whatsapp:+919963214141"

# GitHub REST API Credentials for Remote Deployment
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")
GITHUB_REPO = os.getenv("GITHUB_REPO") # Expected layout: "username/repository_name"

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "agent_memory.db")
STAGED_CODE_FILE = "/tmp/staged_code_update.json"

# Initialize Anthropic client safely
def get_anthropic_client():
    key = os.getenv("CLAUDE_API_KEY")
    if not key:
        print("⚠️ WARNING: CLAUDE_API_KEY environment variable is not set!")
        return AsyncAnthropic(api_key="dummy_key_for_compilation_safety", max_retries=0)
    return AsyncAnthropic(api_key=key, max_retries=5)

anthropic_client = get_anthropic_client()

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
    
    # 4. Knowledge Store Table (RAG Cache)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS knowledge_store (
            url TEXT PRIMARY KEY,
            title TEXT,
            content TEXT,
            timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    # 5. User Facts Memory Table (Long-Term Memory)
    cursor.execute('''
        CREATE TABLE IF NOT EXISTS user_facts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            fact TEXT UNIQUE,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    ''')
    
    conn.commit()
    conn.close()
    print("✅ State Engine: All database tables verified and ready.")

# 🚀 RUN THE INITIALIZER IMMEDIATELY ON SCRIPT BOOT
init_db_tables()

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Verify environment variables on startup
    missing_env = []
    if not TWILIO_SID: missing_env.append("TWILIO_SID")
    if not TWILIO_TOKEN: missing_env.append("TWILIO_TOKEN")
    if not CLAUDE_API_KEY: missing_env.append("CLAUDE_API_KEY")
    
    if missing_env:
        print(f"⚠️ STARTUP WARNING: The following environment variables are missing: {', '.join(missing_env)}")
    else:
        print("✅ Environment Variables Verified: Credentials loaded successfully.")

    # Spin up the background scheduler clock (AsyncIOScheduler runs inside the FastAPI event loop)
    scheduler = AsyncIOScheduler(timezone="Asia/Kolkata") # Set to India timezone
    
    # 🕒 Scheduled timing dynamically set to 11:56 AM as requested
    scheduler.add_job(run_morning_digest, "cron", hour=11, minute=56)
    scheduler.start()
    print("⏰ Automated Scheduler Active: Set to fire daily at 11:56 AM.")
    
    yield
    
    # Shutdown when the server stops
    scheduler.shutdown()

app = FastAPI(lifespan=lifespan)

@app.get("/")
def health_check():
    """Lightweight endpoint for cron-job.org to ping and keep the server awake."""
    return {"status": "healthy", "message": "Engine is awake"}


# ==========================================
# 1. DATABASE STATE UTILITIES (ASYNC)
# ==========================================
async def get_db_state():
    async with aiosqlite.connect(DB_PATH) as db:
        async with db.execute("SELECT value FROM user_profile WHERE key='skill_level'") as cursor:
            row = await cursor.fetchone()
            skill = row[0] if row else "Foundational"
            
        async with db.execute("SELECT concept, summary FROM sent_history ORDER BY timestamp DESC LIMIT 7") as cursor:
            rows = await cursor.fetchall()
            
    history_concepts = [row[0] for row in rows]
    full_history_log = "\n---\n".join([f"Concept: {row[0]}\nFull Payload Sent:\n{row[1]}" for row in rows])
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
        async with db.execute("SELECT role, content FROM chat_history ORDER BY timestamp DESC LIMIT ?", (limit,)) as cursor:
            rows = await cursor.fetchall()
            
    history = [{"role": row[0], "content": row[1]} for row in reversed(rows)]
    return history

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
                    "INSERT OR IGNORE INTO knowledge_store (url, title, content) VALUES (?, ?, ?)",
                    (article['url'], article['title'], article['content'])
                )
            except Exception as e:
                print(f"⚠️ State Engine: Error saving article to knowledge store: {e}")
        await db.commit()

async def extract_and_save_facts(user_message: str, assistant_response: str):
    """Asynchronously extracts permanent user facts from conversation and saves them to the DB."""
    print("🧠 [Memory Agent]: Scanning message for facts to remember...")
    
    prompt = f"""
You are an expert user memory profiling agent.
Analyze the following recent exchange between the user (Madan) and the AI Assistant (Curriculum Coach).

Exchange:
User: {user_message}
Assistant: {assistant_response}

Your job is to identify if the user shared any permanent facts about themselves that are worth remembering for future learning sessions.
High-signal facts to extract:
- Technical preferences (e.g. 'Prefers pytest over unittest', 'Uses FastAPI for backend API development')
- Student skill state/experience (e.g. 'Has built a basic RAG system', 'Finds async database calls confusing')
- Work environment details (e.g. 'Working on a Mac', 'Hosting services on Render')
- Learning milestones completed (e.g. 'Completed the Prompt Scaffolding tutorial')

Low-signal facts to ignore:
- Greetings (e.g. 'Hello', 'Good morning')
- Simple acknowledgments (e.g. 'Okay', 'Thanks')
- Temporary state (e.g. 'I am busy right now', 'I am going to check this later')

Output a JSON array of strings containing the extracted facts.
Output raw JSON only. If no facts are extracted, output an empty array [].
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=300,
            temperature=0.0,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()
        
        if text.startswith("```json"):
            text = text.replace("```json", "", 1)
        if text.startswith("```"):
            text = text.replace("```", "", 1)
        if text.endswith("```"):
            text = text.rsplit("```", 1)[0]
        text = text.strip()
        
        facts = json.loads(text)
        if isinstance(facts, list) and facts:
            print(f"🧠 [Memory Agent]: Extracted {len(facts)} facts: {facts}")
            for fact in facts:
                await save_user_fact(str(fact))
        else:
            print("🧠 [Memory Agent]: No new facts to extract.")
    except Exception as e:
        print(f"⚠️ Memory Agent: Error extracting facts: {e}")

# ==========================================
# 2. 🚀 UPGRADED WEB SOURCE INGESTION ENGINE
# ==========================================
TAVILY_API_KEY = os.getenv("TAVILY_API_KEY")

def fetch_live_internet_updates() -> list[dict]:
    """Executes search queries to aggregate intelligence parameters."""
    articles = []
    unified_query = "latest artificial intelligence breakthroughs enterprise multi agent frameworks production architectures LLM evaluation guardrails testing evals"
    
    if TAVILY_API_KEY:
        print("🔍 Ingestion: Fetching broad multi-track data via Tavily API...")
        url = "https://api.tavily.com/search"
        payload = {
            "api_key": TAVILY_API_KEY,
            "query": unified_query,
            "search_depth": "advanced",
            "include_raw_content": False,
            "max_results": 8
        }
        try:
            res = requests.post(url, json=payload, timeout=15)
            if res.status_code == 200:
                results = res.json().get("results", [])
                for item in results:
                    articles.append({
                        "url": item.get("url", ""),
                        "title": item.get("title", ""),
                        "content": item.get("content", "")
                    })
                if articles:
                    return articles
        except Exception as e:
            print(f"⚠️ Ingestion: Tavily API request failed ({e}). Falling back to DuckDuckGo...")
            
    print("🕷️ Ingestion: Scraping broad multi-track updates from DuckDuckGo...")
    encoded_query = unified_query.replace(" ", "+")
    search_url = f"https://html.duckduckgo.com/html/?q={encoded_query}"
    headers = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"}
    
    try:
        res = requests.get(search_url, headers=headers, timeout=12)
        if res.status_code == 200:
            soup = BeautifulSoup(res.text, 'html.parser')
            results = soup.find_all('div', class_='result')[:8]
            for result in results:
                title_link = result.find('a', class_='result__snip')
                url_elem = result.find('a', class_='result__url')
                snippet_elem = result.find('a', class_='result__snippet')
                
                title = title_link.text.strip() if title_link else ""
                url = url_elem.text.strip() if url_elem else ""
                content = snippet_elem.text.strip() if snippet_elem else ""
                
                if not title and result.find('a', class_='result__a'):
                    a_elem = result.find('a', class_='result__a')
                    title = a_elem.text.strip()
                    url = a_elem.get('href', '')
                
                if url and not url.startswith('http'):
                    url = "https://" + url
                    
                if title and url not in [a["url"] for a in articles]:
                    articles.append({
                        "url": url,
                        "title": title,
                        "content": content
                    })
    except Exception as e:
        print(f"⚠️ Ingestion: DuckDuckGo scraper failed: {e}")
        
    if not articles:
        articles = [
            {
                "url": "https://openai.com/news",
                "title": "Scaling multi-agent frameworks in enterprise QA architectures",
                "content": "Enterprise applications are scaling multi-agent frameworks with robust assertion verification loops and state tracking."
            },
            {
                "url": "https://github.com/blog",
                "title": "Industrializing Agentic Infrastructure and Testing Paradigms",
                "content": "How enterprise development groups are structuring sandboxed runtimes to continuously assert code quality."
            }
        ]
        
    return articles


# ==========================================
# 3. CURRICULUM PLANNER AGENT
# ==========================================
async def run_curriculum_planner(skill_level, history_concepts):
    print("📋 [Curriculum Planner Agent]: Selecting today's focus concept...")
    
    prompt = f"""
You are the Lead Curriculum Planner for an engineer transitioning to Agentic AI Quality Engineering.
Student skill track: {skill_level}
Previously covered concepts: {history_concepts}

Your job is to select the next logical learning concept. Focus on one of these core areas:
1. Advanced Prompting/Scaffolding
2. RAG QA Testing
3. Multi-Agent Systems Testing
4. LLM Guardrails & Evals

Output a single, compact JSON object with exactly these keys: "concept", "pedagogical_focus", "assert_template".
CRITICAL: Do not enclose your output in markdown ```json blocks. Do not add trailing commas or leave strings unterminated. Output raw, valid JSON only.
Provide your selection inside <plan> tags as a JSON object with these keys: "concept", "pedagogical_focus", "assert_template".
Example: <plan>{{"concept": "...", ...}}</plan>
"""
    try:
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=300,
            temperature=0.4,
            messages=[{"role": "user", "content": prompt}]
        )
        text = response.content[0].text.strip()

        # Robust extraction using Regex to find the JSON inside <plan> tags
        plan_match = re.search(r'<plan>\s*(.*?)\s*</plan>', text, re.DOTALL | re.IGNORECASE)
        plan_content = plan_match.group(1).strip() if plan_match else text.strip()

        # Clean up potential markdown code fences if LLM included them inside the tags
        plan_content = re.sub(r'^```(?:json)?\s*|\s*```$', '', plan_content, flags=re.MULTILINE | re.IGNORECASE)

        data = json.loads(plan_content.strip())
        print(f"🎯 Planner Agent selected concept: '{data.get('concept')}'")
        return data
    except Exception as e:
        print(f"⚠️ Planner Agent failed to select concept: {e}. Using fallback.")
        return {
            "concept": "Agentic Scaffolding Testing",
            "pedagogical_focus": "Master testing control flow logic of complex agentic scaffolding.",
            "assert_template": "Test that the router directs prompts correctly based on mock criteria."
        }


# ==========================================
# 4. CREATOR AGENT (GENERATOR WITH SANDBOX & CRITIC FEEDBACK)
# ==========================================
async def generate_daily_payload(raw_data, skill_level, exclusions, planner_context, feedback_loop_msg=""):
    print("🤖 [Creator Agent]: Requesting a compact update from Claude...")
    
    concept = planner_context.get("concept")
    pedagogical_focus = planner_context.get("pedagogical_focus")
    assert_template = planner_context.get("assert_template")
    
    prompt = f"""
You are the Lead Curriculum Director for an Engineer tracking towards Agentic AI Test Architecture.
Current Student Skill Level: {skill_level}
Strict Exclusion List (Topics covered recently, DO NOT REPEAT): {exclusions}

Today's Curriculum Focus:
- Concept to Master: {concept}
- Pedagogical Focus: {pedagogical_focus}
- Assert Template Guide: {assert_template}

Using these fresh live internet updates:
{raw_data}

We need two outputs from you:
1. A compact, WhatsApp-friendly learning digest payload wrapped in `<whatsapp_payload>` tags.
2. A valid Python reference implementation that solves the mini-project and satisfies the assertions, wrapped in `<reference_implementation>` tags.

CRITICAL SIZE CONSTRAINT FOR WHATSAPP PAYLOAD:
The content inside `<whatsapp_payload>` must be strictly under 1300 characters to fit on a messaging screen. Keep every single bullet point brief, ultra-short, single-sentence, and tightly compressed. Do not add conversational fluff.

Structure the `<whatsapp_payload>` response EXACTLY matching this layout. Use ONLY asterisks (*) for WhatsApp bold text formatting. No markdown hashes (#) or markdown tables.

*🔴 REGULAR DAILY AI UPDATES*
(Provide exactly 5 to 7 high-signal, short, single-sentence points blending these live internet updates with core principles from the Generalist Roadmap tracks like Advanced Prompting/Scaffolding, RAG systems, and Multi-Agent Topologies).

*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*
- *Core Concept to Master Today*: {concept} — {pedagogical_focus}
- *Practical Mini-Project Blueprint*: A quick technical project loop.
- *QA Validation Lines*:
assert your_function_here() == True
assert your_second_function() is not None
assert your_third_function() == expected_value

CRITICAL FORMATTING RULE FOR QA LINES: Write exactly 3 standard, executable Python assertion lines. Every line MUST start with the raw lowercase word "assert" followed by a space. Do not place emojis, hyphens, numbers, or markdown code blocks (```) on these lines. Ensure the functions called in the assertions match the ones defined in your reference implementation.

Structure the `<reference_implementation>` response as valid Python code containing the function definitions tested by the assertions.
"""

    if feedback_loop_msg:
        prompt += f"\n\n⚠️ CRITICAL CORRECTION REQUIRED FROM PREVIOUS ATTEMPT:\n{feedback_loop_msg}"

    response = await anthropic_client.messages.create(
        model=CLAUDE_MODEL,
        max_tokens=1200,
        temperature=0.2,
        messages=[{"role": "user", "content": prompt}]
    )
    
    text = response.content[0].text
    
    whatsapp_payload = ""
    reference_code = ""
    
    if "<whatsapp_payload>" in text and "</whatsapp_payload>" in text:
        whatsapp_payload = text.split("<whatsapp_payload>")[1].split("</whatsapp_payload>")[0].strip()
    else:
        whatsapp_payload = text
        
    if "<reference_implementation>" in text and "</reference_implementation>" in text:
        reference_code = text.split("<reference_implementation>")[1].split("</reference_implementation>")[0].strip()
        if reference_code.startswith("```python"):
            reference_code = reference_code.replace("```python", "", 1)
        if reference_code.startswith("```"):
            reference_code = reference_code.replace("```", "", 1)
        if reference_code.endswith("```"):
            reference_code = reference_code.rsplit("```", 1)[0]
        reference_code = reference_code.strip()
        
    return whatsapp_payload, reference_code


# ==========================================
# 5. EXECUTION SANDBOX
# ==========================================
def run_code_sandbox(reference_code: str, assert_lines: list) -> tuple[bool, str]:
    """Runs the reference implementation and assertions in a restricted context to verify logic."""
    print("🧪 [Sandbox Executor]: Verifying code assertions...")
    
    import math, json, re

    full_code = reference_code + "\n\n" + "\n".join(assert_lines)
    
    sandbox_globals = {
        "math": math,
        "json": json,
        "re": re,
        "__builtins__": {
            "abs": abs, "all": all, "any": any, "bin": bin, "bool": bool,
            "chr": chr, "dict": dict, "dir": dir, "divmod": divmod, "enumerate": enumerate,
            "filter": filter, "float": float, "format": format, "hash": hash, "hex": hex,
            "id": id, "int": int, "isinstance": isinstance, "issubclass": issubclass,
            "iter": iter, "len": len, "list": list, "map": map, "max": max, "min": min,
            "next": next, "object": object, "oct": oct, "ord": ord, "pow": pow, "print": print,
            "range": range, "repr": repr, "reversed": reversed, "round": round, "set": set, "slice": slice,
            "sorted": sorted, "str": str, "sum": sum, "tuple": tuple, "type": type,
            "zip": zip, "AssertionError": AssertionError, "ValueError": ValueError,
            "TypeError": TypeError, "KeyError": KeyError, "IndexError": IndexError,
            "Exception": Exception, "StopIteration": StopIteration, "RuntimeError": RuntimeError
        }
    }
    
    try:
        compiled = compile(full_code, "<sandbox>", "exec")
        exec(compiled, sandbox_globals)
        return True, "All assertions passed successfully."
    except AssertionError as e:
        return False, f"AssertionError: A QA assertion failed. Check logic. {str(e) if str(e) else 'Assert verification failed.'}"
    except SyntaxError as e:
        return False, f"SyntaxError on line {e.lineno}: {e.msg}"
    except Exception as e:
        return False, f"RuntimeException: {type(e).__name__}: {str(e)}"


# ==========================================
# 6. QA CRITIC AGENT (AUDITOR ENGINE)
# ==========================================
def run_qa_critic(content, reference_code):
    print("🕵️‍♂️ [QA Critic Agent]: Verifying pipeline parameters...")
    
    has_updates = "*🔴 REGULAR DAILY AI UPDATES*" in content
    has_learnings = "*📘 WHAT I NEED TO LEARN & PROJECTS TO WORK ON*" in content
    
    assert_lines = []
    for line in content.split('\n'):
        if line.strip().startswith('assert ') or 'assert' in line:
            clean_line = line.replace('*', '').replace('-', '').strip()
            if clean_line.startswith('assert '):
                assert_lines.append(clean_line)
                
    has_assert_syntax = len(assert_lines) >= 3
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
    if not has_assert_syntax: errors.append(f"Found {len(assert_lines)} assertions, expected at least 3.")
    if not within_twilio_limit: errors.append(f"Payload out of size bounds ({char_length}/1600 chars).")
    if not (3 <= update_count <= 8): errors.append(f"Density check mismatch. Found {update_count} updates, expected 5-7.")

    sandbox_passed = False
    sandbox_msg = ""
    if has_assert_syntax and reference_code:
        sandbox_passed, sandbox_msg = run_code_sandbox(reference_code, assert_lines)
        if not sandbox_passed:
            errors.append(f"Sandbox Verification Failed: {sandbox_msg}")
            
    print("\n" + "="*50)
    print("📊 QA CRITIC STATUS AND INTEGRITY METRICS")
    print("-"*50)
    print(f"  - Daily Updates Section:         {'PASS' if has_updates else 'FAIL'}")
    print(f"  - Learning & Projects Section:  {'PASS' if has_learnings else 'FAIL'}")
    print(f"  - Sandbox Assert Execution:      {'PASS' if (has_assert_syntax and sandbox_passed) else 'FAIL'}")
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
# 7. ENDPOINTS WITH EMBEDDED RETRY AGENT LOOPS
# ==========================================
@app.post("/run-morning-digest")
async def run_morning_digest():
    try:
        skill_level, recent_topics, full_history_log = await get_db_state()
        
        planner_context = await run_curriculum_planner(skill_level, recent_topics)
        concept = planner_context.get("concept", "Agentic Scaffolding Testing")
        
        loop = asyncio.get_running_loop()
        raw_news = await loop.run_in_executor(None, fetch_live_internet_updates)
        
        await save_articles_to_knowledge_store(raw_news)
        
        relevant_articles = await retrieve_relevant_context(concept, limit=3)
        
        if relevant_articles:
            print(f"📚 RAG Engine: Retrieved {len(relevant_articles)} relevant articles matching concept '{concept}'")
            context_blocks = []
            for idx, art in enumerate(relevant_articles):
                context_blocks.append(f"[{idx+1}] Title: {art['title']}\nURL: {art['url']}\nSnippet: {art['content']}")
            news_context = "\n\n".join(context_blocks)
        else:
            print("📚 RAG Engine: No high-relevance matches found in knowledge store. Using fallback recent news.")
            context_blocks = []
            for idx, art in enumerate(raw_news[:3]):
                context_blocks.append(f"[{idx+1}] Title: {art['title']}\nURL: {art['url']}\nSnippet: {art['content']}")
            news_context = "\n\n".join(context_blocks)
            
        exclusions = ", ".join(recent_topics) if recent_topics else "None"
        
        max_retries = 3
        current_attempt = 1
        feedback = ""
        final_text = ""
        reference_code = ""
        is_valid_run = False
        
        while current_attempt <= max_retries:
            print(f"🔄 Evaluation Run Sequence: Loop {current_attempt}/{max_retries}")
            try:
                final_text, reference_code = await generate_daily_payload(
                    news_context, skill_level, exclusions, planner_context, feedback_loop_msg=feedback
                )
                is_valid_run, feedback = run_qa_critic(final_text, reference_code)
                if is_valid_run:
                    break
                current_attempt += 1
            except Exception as e:
                import traceback
                print(f"❌ Internal processing failure during generation/validation: {e}")
                traceback.print_exc()
                feedback = f"Internal generation error: {str(e)}"
                current_attempt += 1
                
        if is_valid_run:
            await log_sent_concept(concept, final_text)
            
            try:
                def send_twilio():
                    twilio_client = Client(TWILIO_SID, TWILIO_TOKEN)
                    twilio_client.messages.create(body=final_text, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
                await loop.run_in_executor(None, send_twilio)
                return {"status": "Digest approved and dispatched.", "concept": concept}
            except Exception as e:
                return {"status": "QA Passed, but Twilio failed to dispatch", "error": str(e)}
        else:
            return {"status": "Aborted. Failed structural validation limits.", "errors": feedback}
    except Exception as e:
        import traceback
        traceback.print_exc()
        return {"status": "Error running digest pipeline", "error": str(e)}


# ==========================================
# 🛠️ HARDENED LINEAR SUBPROCESS WORKFLOW ROUTING
# ==========================================
@app.post("/whatsapp-webhook")
async def incoming_whatsapp_reply(Body: str = Form(...)):
    user_message = Body.strip()
    user_message_clean = user_message.lower().strip()
    loop = asyncio.get_running_loop()
    
    print(f"📥 [Incoming Message]: '{user_message_clean}'")

    # =========================================================================
    # PHASE 2: EVALUATE APPROVAL / CONFIRMATION COMMANDS
    # =========================================================================
    if user_message_clean in ["approve", "yes", "confirm", "push"]:
        await log_chat_message("user", user_message)
        if not os.path.exists(STAGED_CODE_FILE):
            no_stage_msg = "⚠️ *No changes are currently staged.* Send me an upgrade instruction first!"
            await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=no_stage_msg, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
            return Response(content="<Response></Response>", media_type="text/xml")
            
        def execute_staged_push():
            try:
                if not GITHUB_TOKEN or not GITHUB_REPO:
                    return False, "GITHUB_TOKEN or GITHUB_REPO missing from Render platform environment variables."
                    
                with open(STAGED_CODE_FILE, "r") as f:
                    staged_data = json.load(f)
                
                headers = {
                    "Authorization": f"token {GITHUB_TOKEN}",
                    "Accept": "application/vnd.github.v3+json"
                }
                file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
                payload = {
                    "message": f"🤖 Approved Auto-Upgrade: {staged_data['instruction'][:50]}...",
                    "content": base64.b64encode(staged_data["code"].encode("utf-8")).decode("utf-8"),
                    "sha": staged_data["sha"],
                    "branch": "main"
                }
                
                put_res = requests.put(file_url, headers=headers, json=payload)
                
                if os.path.exists(STAGED_CODE_FILE):
                    os.remove(STAGED_CODE_FILE)
                
                if put_res.status_code in [200, 201]:
                    return True, "Success"
                else:
                    return False, put_res.json().get("message", "Unknown write fault.")
            except Exception as e:
                return False, str(e)

        success, report = await loop.run_in_executor(None, execute_staged_push)
        if success:
            execution_response = "🚀 *Approval Received!* Code has been committed and pushed to GitHub main branch.\n\n🔄 *Render Continuous Deployment Initiated.* Monitor dashboard for live container updates."
        else:
            execution_response = f"❌ *Deployment Engine Aborted.*\n\nDetails: `{report}`"
            
        await log_chat_message("assistant", execution_response)
        await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=execution_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
        return Response(content="<Response></Response>", media_type="text/xml")

    if user_message_clean in ["cancel", "no", "abort"]:
        await log_chat_message("user", user_message)
        if os.path.exists(STAGED_CODE_FILE):
            os.remove(STAGED_CODE_FILE)
            cancel_msg = "🛑 *Deployment Aborted.* Staged repository changes have been cleared from memory cache."
        else:
            cancel_msg = "ℹ️ No adjustments were staged. Staging buffer is already empty."
            
        await log_chat_message("assistant", cancel_msg)
        await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=cancel_msg, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # 🚀 SYSTEM COMMAND PASS-THROUGHS (LOCAL BACKDOORS)
    # =========================================================================
    if user_message_clean == "git status":
        await log_chat_message("user", user_message)
        def run_git_status():
            try: return subprocess.run(["git", "status"], capture_output=True, text=True, cwd=BASE_DIR).stdout.strip()
            except Exception as e: return str(e)
        status_output = await loop.run_in_executor(None, run_git_status)
        execution_response = f"📊 *Current Render Container Status Tree*:\n\nPath: `{BASE_DIR}`\n\n```{status_output}```"
        await log_chat_message("assistant", execution_response)
        await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=execution_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
        return Response(content="<Response></Response>", media_type="text/xml")
    
    if user_message_clean in ["digest", "refresh", "force digest"]:
        await log_chat_message("user", user_message)
        print("⚡ [Manual Override]: Triggering morning engine immediately...")
        digest_status = await run_morning_digest()
        await log_chat_message("assistant", f"Manual trigger activated. Status: {digest_status.get('status')}")
        return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # PHASE 1: EVALUATE REQUESTS FOR CODE REWRITES, UPGRADES, & CONFIGS
    # =========================================================================
    is_upgrade_intent = any(k in user_message_clean for k in ["change", "update", "set", "add", "modify", "upgrade", "fix", "scheduler", "timings", "implement"])
    
    if is_upgrade_intent:
        await log_chat_message("user", user_message)
        
        if not GITHUB_TOKEN or not GITHUB_REPO:
            error_response = "❌ *Operation Denied.* `GITHUB_TOKEN` or `GITHUB_REPO` environment parameters missing on Render configuration setup."
            await log_chat_message("assistant", error_response)
            await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=error_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
            return Response(content="<Response></Response>", media_type="text/xml")

        try:
            headers = {
                "Authorization": f"token {GITHUB_TOKEN}",
                "Accept": "application/vnd.github.v3+json"
            }
            file_url = f"https://api.github.com/repos/{GITHUB_REPO}/contents/V3_updates.py"
            
            def fetch_from_github():
                return requests.get(file_url, headers=headers)
                
            res = await loop.run_in_executor(None, fetch_from_github)
            if res.status_code != 200:
                execution_response = f"❌ *GitHub Access Error:* {res.json().get('message', 'Validation error')}"
                await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=execution_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
                return Response(content="<Response></Response>", media_type="text/xml")
            
            file_data = res.json()
            current_sha = file_data["sha"]
            current_code = base64.b64decode(file_data["content"]).decode("utf-8")
            
            print("🧠 [AI Architect]: Constructing autonomous staging payload using Claude...")
            
            system_prompt = (
                "You are an expert autonomous software engineer. Modify the current python code base strictly matching "
                "the user's structural instructions (e.g., code changes, scheduler adjustment, logic upgrades). "
                "CRITICAL: You MUST provide your response in two parts using XML-style tags:\n"
                "1. <summary>: A brief bullet-point summary of exactly what changes were performed.\n"
                "2. <code>: The ENTIRE updated python codebase file ready for execution.\n"
                "Do not include any conversational filler or markdown outside these tags."
            )
            
            user_prompt = f"User Request: {user_message}\n\nCurrent Code Base:\n{current_code}"
            
            response_data = await anthropic_client.messages.create(
                model=CLAUDE_MODEL,
                max_tokens=8192,
                temperature=0.1,
                messages=[{"role": "user", "content": f"{system_prompt}\n\n{user_prompt}"}]
            )
            
            raw_text = response_data.content[0].text

            try:
                # Use Regex for robust tag extraction
                summary_match = re.search(r'<summary>(.*?)</summary>', raw_text, re.DOTALL | re.IGNORECASE)
                code_match = re.search(r'<code>(.*?)</code>', raw_text, re.DOTALL | re.IGNORECASE)

                summary = summary_match.group(1).strip() if summary_match else ""
                new_code = code_match.group(1).strip() if code_match else ""

                if new_code:
                    # Aggressively clean up potential markdown blocks inside tags
                    new_code = re.sub(r'^```python\s*', '', new_code, flags=re.MULTILINE)
                    new_code = re.sub(r'^```\s*', '', new_code, flags=re.MULTILINE)
                    new_code = re.sub(r'```$', '', new_code, flags=re.MULTILINE)
                    new_code = new_code.strip()

                if not summary or not new_code:
                    print(f"DEBUG: Failed to parse AI response. Raw text:\n{raw_text}")
                    raise ValueError("AI response missing <summary> or <code> tags.")

                with open(STAGED_CODE_FILE, "w") as f:
                    json.dump({
                        "instruction": user_message,
                        "summary": summary,
                        "code": new_code,
                        "sha": current_sha
                    }, f)

                execution_response = f"🛠️ *Code Upgrade Staged!*\n\n*Summary of Changes:*\n{summary}\n\nReply with *'Approve'* to push to GitHub or *'Cancel'* to discard."
                await log_chat_message("assistant", execution_response)
                await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=execution_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
                return Response(content="<Response></Response>", media_type="text/xml")
            except Exception as e:
                error_msg = f"❌ *AI Architect Parsing Error:* {str(e)}"
                await log_chat_message("assistant", error_msg)
                await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=error_msg, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
                return Response(content="<Response></Response>", media_type="text/xml")

        except Exception as e:
            if "529" in str(e) or "overloaded" in str(e).lower():
                error_response = "⏳ *Claude is currently overloaded.* I tried retrying several times, but the server is still busy. Please wait a moment and try your upgrade request again."
            else:
                error_response = f"❌ *Deployment Engine Fault:* {str(e)}"
            await log_chat_message("assistant", error_response)
            await loop.run_in_executor(None, lambda: Client(TWILIO_SID, TWILIO_TOKEN).messages.create(body=error_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP))
            return Response(content="<Response></Response>", media_type="text/xml")

    # =========================================================================
    # PHASE 3: GENERAL CONVERSATIONAL CHAT (RAG + LONG-TERM MEMORY)
    # =========================================================================
    try:
        skill_level, recent_topics, full_history_log = await get_db_state()
        relevant_context = await retrieve_relevant_context(user_message, limit=2)
        user_facts = await get_user_facts(limit=10)
        chat_history = await get_recent_chat_history(limit=6)

        context_str = "\n".join([f"- {c['content']}" for c in relevant_context])
        facts_str = "\n".join([f"- {f}" for f in user_facts])

        system_msg = (
            f"You are Madan's Curriculum Coach and AI Architect tracking toward Agentic AI Quality Engineering.\n"
            f"Facts about Madan:\n{facts_str}\n\n"
            f"Context:\n{context_str}\n\n"
            f"CRITICAL FORMATTING RULES:\n"
            f"1. Keep responses restricted to 2-4 sentences max per message block.\n"
            f"2. Use brief, punchy bullet points if conveying technical details.\n"
            f"3. Use asterisks (*) for WhatsApp bolding instead of markdown hashes (#).\n"
            f"4. Always end your response with a single open-ended learning question."
        )
        
        response = await anthropic_client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=800,
            system=system_msg,
            messages=chat_history + [{"role": "user", "content": user_message}]
        )
        
        ai_response = response.content[0].text.strip()
        await log_chat_message("assistant", ai_response)
        
        if "shifting their profile state to 'Advanced'" in ai_response or "to *Advanced*" in ai_response:
            await update_db_skill("Advanced")
            print("💾 State Engine: Automatically scaled user state to Advanced.")
        elif "shifting their profile state to 'Foundational'" in ai_response or "to *Foundational*" in ai_response:
            await update_db_skill("Foundational")
            print("💾 State Engine: Automatically dialed user state back to Foundational.")
                
        asyncio.create_task(extract_and_save_facts(user_message, ai_response))
                
    except Exception as e:
        print(f"❌ Webhook LLM routing error: {e}")
        ai_response = "⚠️ Connection to the coaching engine was interrupted. Please check your terminal console logs for structural issues."

    try:
        def send_twilio():
            client = Client(TWILIO_SID, TWILIO_TOKEN)
            client.messages.create(body=ai_response, from_=FROM_WHATSAPP, to=TO_WHATSAPP)
        await loop.run_in_executor(None, send_twilio)
    except Exception as e:
        print(f"❌ Twilio dispatch failed in webhook: {e}")
        
    return Response(content="<Response></Response>", media_type="text/xml")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("V3_updates:app", host="0.0.0.0", port=port, reload=False)