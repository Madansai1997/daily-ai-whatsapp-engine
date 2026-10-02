import os
import sys
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfgen import canvas

class NumberedCanvas(canvas.Canvas):
    """Adds page numbers and running header/footer to all pages."""
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self.draw_page_decorations(num_pages)
            super().showPage()
        super().save()

    def draw_page_decorations(self, page_count):
        self.saveState()
        self.setFont("Helvetica", 8)
        self.setFillColor(colors.HexColor("#718096"))
        
        # Header (pages > 1)
        if self._pageNumber > 1:
            self.drawString(54, 750, "JARVIS AI Operating System — Comprehensive Project Portfolio & Architecture")
            self.setStrokeColor(colors.HexColor("#E2E8F0"))
            self.setLineWidth(0.5)
            self.line(54, 744, 558, 744)

        # Footer (all pages)
        footer_text = f"Page {self._pageNumber} of {page_count}"
        self.drawRightString(558, 36, footer_text)
        self.drawString(54, 36, "Confidential & Proprietary — Prepared for AI/ML Engineering Interview")
        self.setStrokeColor(colors.HexColor("#E2E8F0"))
        self.setLineWidth(0.5)
        self.line(54, 48, 558, 48)
        self.restoreState()

def build_pdf(filename="JARVIS_AI_Project_Master_Portfolio.pdf"):
    doc = SimpleDocTemplate(
        filename,
        pagesize=letter,
        leftMargin=54,
        rightMargin=54,
        topMargin=54,
        bottomMargin=54
    )

    styles = getSampleStyleSheet()
    
    # Custom Palette
    c_primary = colors.HexColor("#0F172A")    # Deep Navy
    c_accent = colors.HexColor("#0284C7")     # Cyan / Blue
    c_secondary = colors.HexColor("#334155")  # Slate
    c_text = colors.HexColor("#1E293B")       # Dark Charcoal
    c_muted = colors.HexColor("#64748B")      # Slate Muted
    c_bg_light = colors.HexColor("#F8FAFC")   # Light Gray
    c_border = colors.HexColor("#CBD5E1")     # Border

    # Styles
    title_style = ParagraphStyle(
        'DocTitle',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=24,
        leading=28,
        textColor=c_primary,
        spaceAfter=4
    )

    subtitle_style = ParagraphStyle(
        'DocSubTitle',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=12,
        leading=16,
        textColor=c_accent,
        spaceAfter=14
    )

    h1_style = ParagraphStyle(
        'Heading1_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=15,
        leading=19,
        textColor=c_primary,
        spaceBefore=12,
        spaceAfter=6,
        keepWithNext=True
    )

    h2_style = ParagraphStyle(
        'Heading2_Custom',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=11,
        leading=15,
        textColor=c_accent,
        spaceBefore=8,
        spaceAfter=4,
        keepWithNext=True
    )

    body_style = ParagraphStyle(
        'Body_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=9,
        leading=13,
        textColor=c_text,
        spaceAfter=6
    )

    body_bold = ParagraphStyle(
        'Body_Bold',
        parent=body_style,
        fontName='Helvetica-Bold'
    )

    bullet_style = ParagraphStyle(
        'Bullet_Custom',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8.5,
        leading=12,
        textColor=c_text,
        leftIndent=14,
        firstLineIndent=-10,
        spaceAfter=3
    )

    callout_style = ParagraphStyle(
        'Callout_Text',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=8.5,
        leading=12,
        textColor=c_secondary
    )

    script_quote = ParagraphStyle(
        'Script_Quote',
        parent=styles['Normal'],
        fontName='Helvetica-Oblique',
        fontSize=9,
        leading=13,
        textColor=c_primary
    )

    table_header = ParagraphStyle(
        'TH_Style',
        parent=styles['Normal'],
        fontName='Helvetica-Bold',
        fontSize=8.5,
        leading=11,
        textColor=colors.white
    )

    table_cell = ParagraphStyle(
        'TC_Style',
        parent=styles['Normal'],
        fontName='Helvetica',
        fontSize=8,
        leading=10.5,
        textColor=c_text
    )

    table_cell_bold = ParagraphStyle(
        'TC_Bold_Style',
        parent=table_cell,
        fontName='Helvetica-Bold',
        textColor=c_primary
    )

    story = []

    # ==========================================
    # HEADER / TITLE BANNER
    # ==========================================
    story.append(Paragraph("JARVIS — Autonomous AI Operating System", title_style))
    story.append(Paragraph("Full-Stack AI/ML Engineering, Multi-Agent Orchestration & Production Architecture", subtitle_style))
    story.append(HRFlowable(width="100%", thickness=1.5, color=c_accent, spaceBefore=0, spaceAfter=10))

    meta_table_data = [
        [
            Paragraph("<b>Candidate:</b> Madan Sai", body_style),
            Paragraph("<b>Focus:</b> AI/ML Engineering & Distributed Systems", body_style),
            Paragraph("<b>Status:</b> Production Live on Render & Edge", body_style)
        ]
    ]
    t_meta = Table(meta_table_data, colWidths=[160, 200, 144])
    t_meta.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), c_bg_light),
        ('BOX', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
    ]))
    story.append(t_meta)
    story.append(Spacer(1, 10))

    # ==========================================
    # 1. EXECUTIVE SUMMARY
    # ==========================================
    story.append(Paragraph("1. Executive Summary & Vision", h1_style))
    story.append(Paragraph(
        "<b>JARVIS</b> is a production-grade, 24/7 autonomous AI assistant and cognitive operating system. "
        "Unlike fragile LLM wrappers or rigid chatbots, JARVIS combines <b>cascading multi-model inference</b>, "
        "<b>in-memory BM25 lexical RAG</b>, <b>autonomous task agents</b>, <b>cognitive spaced repetition</b>, and "
        "<b>low-level Linux glibc memory tuning</b> into a responsive, zero-downtime platform.",
        body_style
    ))

    # Highlights Box
    box_data = [
        [Paragraph(
            "<b>Key Engineering Highlights:</b><br/>"
            "• <b>Resilient Multi-Model Gateway:</b> Automatic sub-second failover across Groq (Llama 3.3/3.1), Gemini 2.5 Flash, and OpenRouter with circuit breakers.<br/>"
            "• <b>Lexical & Passage RAG Engine:</b> In-memory BM25 tokenizer and PDF passage extractor achieving sub-10ms query grounding without heavy vector database memory overhead.<br/>"
            "• <b>Autonomous Agent Suite:</b> 7 specialized modules (Email Triage, Calendar Manager, Job Scout, ATS Resume Alignment, Deploy Watcher, Bill Watcher, Encrypted Diary).<br/>"
            "• <b>Memory Leak Elimination:</b> Capped glibc malloc arenas (<code>M_ARENA_MAX=2</code>) and trimmed heap transients, flattening container RSS from 512MB+ to a steady ~90MB.",
            callout_style
        )]
    ]
    t_box = Table(box_data, colWidths=[504])
    t_box.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#F0F9FF")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#BAE6FD")),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(t_box)
    story.append(Spacer(1, 10))

    # ==========================================
    # 2. 2-5 MINUTE INTERVIEW PRESENTATION SCRIPT
    # ==========================================
    story.append(Paragraph("2. 2–5 Minute Interview Walkthrough Script", h1_style))
    story.append(Paragraph("Use this structured script to present the project with maximum technical clarity:", body_style))

    script_data = [
        [
            Paragraph("<b>Phase</b>", table_header),
            Paragraph("<b>Time</b>", table_header),
            Paragraph("<b>Verbatim Presentation Script</b>", table_header)
        ],
        [
            Paragraph("<b>Hook & Problem</b>", table_cell_bold),
            Paragraph("30s", table_cell),
            Paragraph(
                "<i>\"Most AI assistant projects are either basic chat wrappers or brittle rule-based bots that break on edge cases and cost a fortune to run. I built JARVIS—a production-grade autonomous operating system that handles my daily workflows: intelligent email triage, calendar scheduling, automated job market scouting with ATS resume alignment, and an interactive cognitive learning engine, running 24/7 with zero-downtime multi-model failover.\"</i>",
                table_cell
            )
        ],
        [
            Paragraph("<b>Core AI Architecture</b>", table_cell_bold),
            Paragraph("90s", table_cell),
            Paragraph(
                "<i>\"From an AI/ML engineering standpoint, I engineered 4 key systems:<br/>"
                "1. <b>Multi-Provider LLM Gateway:</b> A cascading chain using Groq LPU (Llama 3.3/3.1) for ultra-fast generation, falling back to Gemini 2.5 Flash and OpenRouter, protected by advisory circuit breakers and sliding-window rate limiters.<br/>"
                "2. <b>Passage RAG Engine:</b> In-memory BM25 retrieval over knowledge docs and PDF notes that prevents hallucinations without vector DB RAM bloat.<br/>"
                "3. <b>Autonomous Agents & Safety:</b> 7 specialized agents operating with a strict 'Human-in-the-Loop' hold pattern (pending tables) before dispatching external emails or calendar invites.<br/>"
                "4. <b>Cognitive SM-2 Algorithm:</b> Implemented SuperMemo spaced repetition to model the Ebbinghaus forgetting curve for daily technical flight drills.\"</i>",
                table_cell
            )
        ],
        [
            Paragraph("<b>Systems Hardening & Impact</b>", table_cell_bold),
            Paragraph("45s", table_cell),
            Paragraph(
                "<i>\"On the infrastructure side, I solved real-world memory leaks on Linux containers by capping glibc malloc arenas at 2 (<code>M_ARENA_MAX=2</code>) and running heap trims after PDF parsing, keeping RSS memory under 95MB on free cloud tiers. The UI is a modern React 18 / Vite SPA with continuous voice recognition, and the backend is an async FastAPI service running on Render.\"</i>",
                table_cell
            )
        ]
    ]

    t_script = Table(script_data, colWidths=[90, 35, 379])
    t_script.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('BOX', (0, 0), (-1, -1), 0.5, c_border),
        ('GRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LEFTPADDING', (0, 0), (-1, -1), 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light])
    ]))
    story.append(t_script)
    story.append(Spacer(1, 12))

    # Page Break for clean reading
    story.append(PageBreak())

    # ==========================================
    # 3. COMPLETE TECHNOLOGY STACK & JUSTIFICATION
    # ==========================================
    story.append(Paragraph("3. Full Technology Stack & Engineering Justification", h1_style))
    story.append(Paragraph("Why each specific technology was selected over alternatives:", body_style))

    tech_data = [
        [
            Paragraph("<b>Component</b>", table_header),
            Paragraph("<b>Technology</b>", table_header),
            Paragraph("<b>Alternative Considered</b>", table_header),
            Paragraph("<b>Why I Chose It (Engineering Rationale)</b>", table_header)
        ],
        [
            Paragraph("<b>Backend API</b>", table_cell_bold),
            Paragraph("FastAPI<br/>(Python 3.11)", table_cell),
            Paragraph("Flask, Django", table_cell),
            Paragraph("Native <code>asyncio</code> support for high-concurrency external API dispatch (Twilio, Google APIs, LLMs) + automatic Pydantic request schema validation.", table_cell)
        ],
        [
            Paragraph("<b>Primary Inference</b>", table_cell_bold),
            Paragraph("Groq LPU<br/>(Llama 3.3/3.1)", table_cell),
            Paragraph("OpenAI GPT-4o, Claude 3.5", table_cell),
            Paragraph("Sub-second Time-To-First-Token (TTFT) and high token generation speed at near-zero cost, making voice & chat feel instantaneous.", table_cell)
        ],
        [
            Paragraph("<b>Fallback LLMs</b>", table_cell_bold),
            Paragraph("Google Gemini 2.5 Flash & OpenRouter", table_cell),
            Paragraph("Local Ollama, Single Provider", table_cell),
            Paragraph("Huge 1M+ token context window for dense PDF extraction, combined with multi-provider failover when primary limits hit.", table_cell)
        ],
        [
            Paragraph("<b>RAG Retrieval</b>", table_cell_bold),
            Paragraph("Custom BM25 + <code>pdfplumber</code>", table_cell),
            Paragraph("Pinecone, ChromaDB, Weaviate", table_cell),
            Paragraph("Zero RAM bloat (under 10MB vs 250MB+ for vector engines) with superior exact keyword/term matching for technical queries.", table_cell)
        ],
        [
            Paragraph("<b>Database</b>", table_cell_bold),
            Paragraph("SQLite + Turso (libSQL)", table_cell),
            Paragraph("PostgreSQL, MongoDB", table_cell),
            Paragraph("Embedded zero-latency local file development with cloud replication via <code>db_compat</code> without managing heavy database instances.", table_cell)
        ],
        [
            Paragraph("<b>Scheduler</b>", table_cell_bold),
            Paragraph("APScheduler 3.x", table_cell),
            Paragraph("Celery + Redis, Cron daemon", table_cell),
            Paragraph("In-process cron and interval scheduling with database-backed state restore on server restart—no extra Redis infrastructure needed.", table_cell)
        ],
        [
            Paragraph("<b>Security & Cryptography</b>", table_cell_bold),
            Paragraph("Fernet<br/>(AES-128-CBC)", table_cell),
            Paragraph("Plaintext DB, bcrypt", table_cell),
            Paragraph("Symmetric authenticated encryption for Project Believer, ensuring zero-knowledge confidential diary entries.", table_cell)
        ],
        [
            Paragraph("<b>Frontend UI</b>", table_cell_bold),
            Paragraph("React 18 + Vite + TypeScript", table_cell),
            Paragraph("Next.js, Vanilla HTML/JS", table_cell),
            Paragraph("Instant Hot-Module Reloading (HMR), strict compile-time type safety across complex dashboard state, and responsive glassmorphism UI.", table_cell)
        ],
        [
            Paragraph("<b>Voice Interface</b>", table_cell_bold),
            Paragraph("Web Speech Recognition API", table_cell),
            Paragraph("Whisper API (Cloud)", table_cell),
            Paragraph("Zero-latency client-side continuous voice capture with custom closing phrase detection ('it's over') and silence fallbacks.", table_cell)
        ]
    ]

    t_tech = Table(tech_data, colWidths=[75, 80, 80, 269])
    t_tech.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('BOX', (0, 0), (-1, -1), 0.5, c_border),
        ('GRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light])
    ]))
    story.append(t_tech)
    story.append(Spacer(1, 12))

    # ==========================================
    # 4. SPECIALIZED AUTONOMOUS AGENT FLEET
    # ==========================================
    story.append(Paragraph("4. Specialized Autonomous Agent Fleet", h1_style))
    story.append(Paragraph("Detailed overview of the modular agent fleet deployed in the system:", body_style))

    agents_data = [
        [
            Paragraph("<b>Agent Module</b>", table_header),
            Paragraph("<b>Key Architectural Capabilities & Workflows</b>", table_header),
            Paragraph("<b>Safety & Persistence</b>", table_header)
        ],
        [
            Paragraph("<b>Email Triage Agent</b><br/><code>email_triage.py</code>", table_cell_bold),
            Paragraph("Watches Gmail inbox via OAuth2, analyzes priority using LLM, extracts actionable tasks, learns user tone from prior edits, and generates response drafts.", table_cell),
            Paragraph("<b>Hold Table:</b> <code>pending_drafts</code> (Requires explicit approval before sending).", table_cell)
        ],
        [
            Paragraph("<b>Calendar Agent</b><br/><code>calendar_agent.py</code>", table_cell_bold),
            Paragraph("Checks schedule availability, resolves conflicting times, and formats event descriptions with attendees.", table_cell),
            Paragraph("<b>Safety Hold:</b> <code>pending_calendar_events</code> holds external invites until approved.", table_cell)
        ],
        [
            Paragraph("<b>Job Scout Agent</b><br/><code>job_scout_agent.py</code>", table_cell_bold),
            Paragraph("Daily cron scraping across Adzuna, Remotive, and JSearch; deduplicates against <code>seen_jobs</code>; LLM pre-filters and ranks high-match roles.", table_cell),
            Paragraph("<b>Tracking:</b> Auto-populates <code>applications</code> table with Kanban statuses.", table_cell)
        ],
        [
            Paragraph("<b>Resume ATS Agent</b><br/><code>resume_ats_agent.py</code>", table_cell_bold),
            Paragraph("Extracts requirements from job descriptions, scores master resume, reframes bullets to STAR/XYZ format, and generates downloadable tailored resumes.", table_cell),
            Paragraph("<b>Conservative:</b> Never fabricates skills; outputs honest gap reports.", table_cell)
        ],
        [
            Paragraph("<b>Deploy Watcher</b><br/><code>deploy_watcher_agent.py</code>", table_cell_bold),
            Paragraph("Monitors GitHub commits, tracks container RSS memory, probes health endpoints, and alerts on anomalies or memory leaks.", table_cell),
            Paragraph("<b>Telemetry:</b> Logs memory trends and HTTP status codes in SQLite.", table_cell)
        ],
        [
            Paragraph("<b>Bill Watcher</b><br/><code>bill_watcher.py</code>", table_cell_bold),
            Paragraph("Natural language bill registration ('rent 25000 on the 1st'), recurring cycle tracking, notification deduplication, and paid cycle rolling.", table_cell),
            Paragraph("<b>Web Inbox:</b> Generates in-app notifications and dashboard reminders.", table_cell)
        ],
        [
            Paragraph("<b>Cognitive Learning</b><br/><code>learning_engine.py</code>", table_cell_bold),
            Paragraph("Generates 10-minute Socratic flight drills with broken code, evaluates user solutions with diagnostic scoring, and calculates SM-2 mastery schedules.", table_cell),
            Paragraph("<b>SM-2 Radar:</b> Tracks ease factor and interval days per concept.", table_cell)
        ]
    ]

    t_agents = Table(agents_data, colWidths=[110, 244, 150])
    t_agents.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), c_primary),
        ('BOX', (0, 0), (-1, -1), 0.5, c_border),
        ('GRID', (0, 0), (-1, -1), 0.5, c_border),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ('LEFTPADDING', (0, 0), (-1, -1), 5),
        ('RIGHTPADDING', (0, 0), (-1, -1), 5),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, c_bg_light])
    ]))
    story.append(t_agents)
    story.append(Spacer(1, 12))

    # Page Break for clean reading
    story.append(PageBreak())

    # ==========================================
    # 5. PRODUCTION ENGINEERING & MEMORY TUNING
    # ==========================================
    story.append(Paragraph("5. Production Engineering & Low-Level Performance Tuning", h1_style))
    story.append(Paragraph(
        "One of the strongest technical stories of this project is solving the <b>Linux glibc malloc arena ratcheting bug</b> "
        "that caused container Out-Of-Memory (OOM) crashes on Render.",
        body_style
    ))

    mem_box_data = [
        [Paragraph(
            "<b>The glibc Memory Arena Problem & Fix:</b><br/>"
            "<b>Problem:</b> In Linux glibc, multi-threaded background workers (e.g. <code>requests.get</code>, PDF parsers) create separate memory arenas (up to 8× CPU cores). When large buffers (PDF bytes, scraped HTML) are freed in Python, glibc hoards the memory arenas instead of returning them to the OS. Over time, RSS ratchets past 512MB.<br/>"
            "<b>Engineering Solution:</b><br/>"
            "1. Capped malloc arenas at startup via <code>ctypes.CDLL('libc.so.6').mallopt(-8, 2)</code> (equivalent to <code>M_ARENA_MAX=2</code>).<br/>"
            "2. Added explicit <code>ctypes.CDLL('libc.so.6').malloc_trim(0)</code> calls immediately after transient PDF parsing and digest runs.<br/>"
            "<b>Result:</b> Server idle RSS memory dropped and flattened to a stable <b>~64–90 MB</b> permanently.",
            callout_style
        )]
    ]
    t_mem = Table(mem_box_data, colWidths=[504])
    t_mem.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), colors.HexColor("#FEF3C7")),
        ('BOX', (0, 0), (-1, -1), 1, colors.HexColor("#FDE68A")),
        ('TOPPADDING', (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
    ]))
    story.append(t_mem)
    story.append(Spacer(1, 10))

    # ==========================================
    # 6. TOP INTERVIEW Q&A PREPARATION
    # ==========================================
    story.append(Paragraph("6. Key Interview Questions & Winning Answers", h1_style))

    qa_items = [
        (
            "Q1: How do you prevent hallucinations in your LLM agent workflows?",
            "<b>Answer:</b> I implement a three-layer defense: First, <b>Grounding via BM25 RAG</b>—I retrieve verified top-k passages from internal notes and inject them as system context. Second, <b>Strict JSON Schema Enforcement</b>—prompts require exact JSON keys, and outputs are stripped of markdown fences before parsing. Third, <b>Conservative Tailoring Constraints</b>—for example, in the Resume ATS agent, the system prompt explicitly forbids hallucinating tools not in the master resume, producing an honest gap report instead."
        ),
        (
            "Q2: Why did you build an in-memory BM25 engine instead of using a Vector Database (like Pinecone/Chroma)?",
            "<b>Answer:</b> Resource efficiency and query precision. Heavy vector DBs and embedding models consume 250MB+ RAM and add external latency/cost. In our personal agent architecture, documents are dense technical notes where exact keyword terms (e.g. function names, specific dates, error codes) matter. BM25 runs in sub-10ms with under 5MB RAM and zero external dependencies."
        ),
        (
            "Q3: How do you handle natural language intent routing without brittle regex matching?",
            "<b>Answer:</b> Early hardcoded keyword matching broke on natural conversational phrasing. I replaced it with an AI Intent Classifier (<code>MEMORY_INTENT_PROMPT</code>). Incoming text is classified into structured intent enums (<code>JOB_SEARCH</code>, <code>CALENDAR_ACTION</code>, <code>BILL_ACTION</code>) by a high-speed Groq model. If confidence is high, it routes to the dedicated agent; otherwise, it falls back to conversational chat."
        ),
        (
            "Q4: What is the SuperMemo SM-2 algorithm and how did you implement it in the Learning Engine?",
            "<b>Answer:</b> SM-2 models the Ebbinghaus forgetting curve by calculating optimal review intervals. When a user completes a Socratic flight drill, their score (0-100) translates to a quality score (0-5). We update the concept's <i>Ease Factor</i> (minimum 1.3) and scale the <i>Interval Days</i> (1 day → 6 days → interval × ease factor). This guarantees high-difficulty concepts are reviewed sooner, while mastered topics are spaced further out."
        )
    ]

    for q, a in qa_items:
        story.append(Paragraph(f"<b>{q}</b>", h2_style))
        story.append(Paragraph(a, body_style))
        story.append(Spacer(1, 4))

    # Build Document
    doc.build(story, canvasmaker=NumberedCanvas)
    print(f"✅ Successfully generated master project PDF at: {filename}")

if __name__ == "__main__":
    out_file = sys.argv[1] if len(sys.argv) > 1 else "/Users/madansaidaram/Desktop/Daily_AI_updates/JARVIS_AI_Project_Master_Portfolio.pdf"
    build_pdf(out_file)
