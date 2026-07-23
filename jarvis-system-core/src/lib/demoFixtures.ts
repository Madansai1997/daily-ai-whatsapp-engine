/* Demo-mode sample data.
 *
 * When the console is unlocked with the demo PIN, the backend hands back an EMPTY,
 * non-privileged token — so every protected endpoint would 401. Instead of hitting
 * the network, the fetch interceptor (auth.ts) serves these fixtures locally, so a
 * recruiter/guest sees a fully-populated console without any of Madan's real data
 * ever being served. All values here are invented for the demo.
 */

const now = Date.now();
const iso = (daysAgo: number) => new Date(now - daysAgo * 86400_000).toISOString();
const daySeries = (n: number) =>
  Array.from({ length: n }, (_, i) => new Date(now - (n - 1 - i) * 86400_000).toISOString().slice(5, 10));

// ── Job board ──────────────────────────────────────────────────────────────
const APPLICATIONS = [
  { id: 1, job_key: "demo:1", title: "Data Analyst", company: "Nimbus Analytics", location: "Bengaluru", source: "LinkedIn", status: "interviewing", reviewed: 1, apply_method: "link", ats_score: 82, ats_scored_at: iso(2), recruiter_score: 78, recruiter_scored_at: iso(2), news_count: 2, applied_at: iso(11), updated_at: iso(2), url: "#", ghost_job_risk: "none", ghost_job_reasons: [] },
  { id: 2, job_key: "demo:2", title: "Analytics Engineer", company: "Vela Systems", location: "Remote", source: "Wellfound", status: "applied", reviewed: 1, apply_method: "email", ats_score: 74, ats_scored_at: iso(4), recruiter_score: 71, recruiter_scored_at: iso(4), news_count: 0, applied_at: iso(5), updated_at: iso(5), url: "#", ghost_job_risk: "none", ghost_job_reasons: [] },
  { id: 3, job_key: "demo:3", title: "BI Developer", company: "Corewave", location: "Hyderabad", source: "Naukri", status: "applied", reviewed: 1, apply_method: "link", ats_score: 68, ats_scored_at: iso(6), recruiter_score: null, recruiter_scored_at: null, news_count: 1, applied_at: iso(6), updated_at: iso(6), url: "#", ghost_job_risk: "high", ghost_job_reasons: ["Posted over 60 days ago", "Generic boilerplate description", "No contact details"] },
  { id: 4, job_key: "demo:4", title: "Product Data Analyst", company: "Lumen Labs", location: "Remote", source: "LinkedIn", status: "offer", reviewed: 1, apply_method: "email", ats_score: 88, ats_scored_at: iso(1), recruiter_score: 84, recruiter_scored_at: iso(1), news_count: 3, applied_at: iso(20), updated_at: iso(1), url: "#", ghost_job_risk: "none", ghost_job_reasons: [] },
  { id: 5, job_key: "demo:5", title: "Data Scientist (Jr)", company: "Aster Health", location: "Pune", source: "Instahyre", status: "interested", reviewed: 0, apply_method: "link", ats_score: null, ats_scored_at: null, recruiter_score: null, recruiter_scored_at: null, news_count: 0, applied_at: null, updated_at: iso(1), url: "#", ghost_job_risk: "none", ghost_job_reasons: [] },
  { id: 6, job_key: "demo:6", title: "Business Analyst", company: "Quill Finance", location: "Mumbai", source: "Naukri", status: "interested", reviewed: 0, apply_method: "link", ats_score: null, ats_scored_at: null, recruiter_score: null, recruiter_scored_at: null, news_count: 0, applied_at: null, updated_at: iso(0), url: "#", ghost_job_risk: "none", ghost_job_reasons: [] },
  { id: 7, job_key: "demo:7", title: "Analytics Consultant", company: "Grid Dynamics", location: "Remote", source: "LinkedIn", status: "rejected", reviewed: 1, apply_method: "link", ats_score: 61, ats_scored_at: iso(15), recruiter_score: 55, recruiter_scored_at: iso(15), news_count: 0, applied_at: iso(24), updated_at: iso(9), url: "#", ghost_job_risk: "medium", ghost_job_reasons: ["Vague job description", "Salary range not disclosed"] },
  { id: 8, job_key: "demo:8", title: "Data Analyst II", company: "Pixel Retail", location: "Gurugram", source: "Wellfound", status: "applied", reviewed: 1, apply_method: "email", ats_score: 79, ats_scored_at: iso(3), recruiter_score: 73, recruiter_scored_at: iso(3), news_count: 1, applied_at: iso(3), updated_at: iso(3), url: "#", ghost_job_risk: "none", ghost_job_reasons: [] },
];
const STATUSES = ["interested", "applied", "interviewing", "offer", "accepted", "rejected"];

// ── Home cockpit ───────────────────────────────────────────────────────────
const COCKPIT = {
  greeting: "Good morning", name: "Guest", date: new Date().toDateString(),
  headline: "You're in a live demo of JARVIS — a multi-agent AI career copilot. Everything here is sample data.",
  next_steps: [
    { key: "s1", severity: "amber", icon: "clock", label: "Follow up with Vela Systems — applied 5 days ago, no reply", action: "Follow up", target: "jobs:followups", count: 1 },
    { key: "s2", severity: "purple", icon: "calendar", label: "Interview prep brief ready for Nimbus Analytics", action: "Open brief", target: "jobs:interviews" },
    { key: "s3", severity: "green", icon: "sparkles", label: "New offer from Lumen Labs — review & respond", action: "Review", target: "jobs:offer" },
    { key: "s4", severity: "grey", icon: "refresh", label: "2 fresh roles matched your profile overnight", action: "Review queue", target: "jobs:review", count: 2 },
  ],
  pulse: {
    active: 5, response_rate: 43, week_applied: 3,
    funnel: [{ stage: "applied", count: 5 }, { stage: "interviewing", count: 1 }, { stage: "offer", count: 1 }],
  },
};

// ── Insights: analytics ────────────────────────────────────────────────────
const D14 = daySeries(14);
const ANALYTICS = {
  days: 14,
  activity: D14.map((day, i) => ({ day, messages: 8 + ((i * 5) % 14), jobs: 3 + (i % 5), errors: i === 9 ? 1 : 0 })),
  agents: [
    { name: "job-scout", total: 14, errors: 0, last_run: iso(0), last_status: "ok", health: "ok", severity: "info", attempt: 1 },
    { name: "application-email-tracker", total: 28, errors: 0, last_run: iso(0), last_status: "ok", health: "ok", severity: "info", attempt: 1 },
    { name: "company-watch", total: 14, errors: 0, last_run: iso(0), last_status: "ok", health: "ok", severity: "info", attempt: 1 },
    { name: "influencer-digest", total: 14, errors: 1, last_run: iso(1), last_status: "ok", health: "ok", severity: "warning", attempt: 2 },
    { name: "bills-check", total: 14, errors: 0, last_run: iso(0), last_status: "ok", health: "ok", severity: "info", attempt: 1 },
    { name: "people-watch", total: 14, errors: 0, last_run: iso(0), last_status: "ok", health: "ok", severity: "info", attempt: 1 },
  ],
  success_rate: 98,
  llm_by_day: D14.map((day, i) => ({ day, groq: 20 + ((i * 7) % 25), gemini: i % 4 === 0 ? 2 : 0 })),
  llm_totals: [{ provider: "groq", calls: 412 }, { provider: "gemini", calls: 18 }],
  llm_models: [
    { model: "gpt-oss-120b", calls: 331 }, { model: "llama-3.3-70b-versatile", calls: 63 },
    { model: "llama-3.1-8b-instant", calls: 18 }, { model: "gemini-2.5-flash", calls: 18 },
  ],
  llm_total_calls: 430, llm_today: 24, fallback_rate: 4,
  prompts_by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: String(h).padStart(2, "0"), count: h >= 9 && h <= 22 ? 3 + ((h * 3) % 9) : 0 })),
  pipeline: STATUSES.map((s) => ({ status: s, count: APPLICATIONS.filter((a) => a.status === s).length })),
  dev_by_day: D14.map((day, i) => ({ day, "claude-code": i % 2 === 0 ? 45000 + i * 1000 : 0 })),
  dev_totals: [{ tool: "claude-code", tokens: 480000, cost: 0, mins: 320, sessions: 9 }],
  totals: { messages: 168, job_runs: 84, errors: 1, applications: 8, ats_runs: 6, ats_avg: 76 },
};

// ── Insights: LLM gateway ──────────────────────────────────────────────────
const INSIGHTS_LLM = {
  gateway: {
    providers: {
      groq: { circuit: "closed", opens_in_secs: 0, calls: 412, successes: 406, failures: 6, rate_limit_skips: 3, breaker_trips: 1, window_used: 7, rpm_limit: 25 },
      gemini: { circuit: "closed", opens_in_secs: 0, calls: 18, successes: 18, failures: 0, rate_limit_skips: 0, breaker_trips: 0, window_used: 0, rpm_limit: 25 },
    },
    config: { fail_threshold: 4, cooldown_secs: 30, rpm_limit: 25, window_secs: 60 },
  },
  totals: [{ provider: "groq", calls: 412 }, { provider: "gemini", calls: 18 }],
  total_calls: 430, fallback_rate: 4, today: 24,
  models: [{ model: "gpt-oss-120b", calls: 331 }, { model: "llama-3.3-70b-versatile", calls: 63 }, { model: "gemini-2.5-flash", calls: 18 }],
};

const SYSTEM_METRICS = {
  memory: { rss_mb: 168, limit_mb: 512, pct: 33, status: "healthy" },
  uptime: "6d 4h", errors_24h: 0, agents: 6, patterns_learned: 4, db: "turso", scheduler_mode: "external",
};

const RESPONSE_ANALYTICS = {
  funnel: [{ stage: "applied", count: 5 }, { stage: "interviewing", count: 1 }, { stage: "offer", count: 1 }],
  rejected: 1, applied_total: 5, response_rate: 43, responded_total: 3, avg_response_days: 6,
  ghost_rate: 20, ghosted: 1, ghost_days: 14,
  sources: [
    { source: "LinkedIn", applied: 3, responded: 2, yield: 67 },
    { source: "Wellfound", applied: 2, responded: 1, yield: 50 },
    { source: "Naukri", applied: 2, responded: 0, yield: 0 },
  ],
};

const SKILL_GAP = {
  analyzed_jobs: 6,
  skills: [
    { skill: "SQL", demand: 6, have: 6, gap: 0, coverage: 100 },
    { skill: "Python", demand: 6, have: 6, gap: 0, coverage: 100 },
    { skill: "Power BI", demand: 5, have: 4, gap: 1, coverage: 80 },
    { skill: "Tableau", demand: 4, have: 2, gap: 2, coverage: 50 },
    { skill: "dbt", demand: 3, have: 0, gap: 3, coverage: 0 },
    { skill: "Snowflake", demand: 3, have: 1, gap: 2, coverage: 33 },
  ],
  top_gaps: [{ skill: "dbt", demand: 3, gap: 3 }, { skill: "Tableau", demand: 4, gap: 2 }, { skill: "Snowflake", demand: 3, gap: 2 }],
};

const DAILY_TODAY = {
  empty: false, date: new Date().toISOString().slice(0, 10), concept: "Retrieval-Augmented Generation (RAG)",
  news: [
    { title: "Why hybrid search beats pure vector RAG", url: "#", snippet: "Combining BM25 with embeddings recovers exact-match recall that dense retrieval alone drops." },
    { title: "Citation-grounded answers reduce hallucination", url: "#", snippet: "Forcing the model to cite retrieved passages makes unsupported claims easy to catch." },
  ],
};

const INFLUENCER_FEED = {
  posts: [
    { id: 1, name: "Andrej Karpathy", platform: "youtube", title: "Let's build a RAG system from scratch", url: "#", relevance_note: "Matches your RAG learning track" },
    { id: 2, name: "Hamel Husain", platform: "rss", title: "Evals are all you need", url: "#", relevance_note: "Your golden-eval work in Insights" },
    { id: 3, name: "Jason Liu", platform: "rss", title: "Structured outputs for agents", url: "#", relevance_note: "Relevant to your intent router" },
    { id: 4, name: "Eugene Yan", platform: "rss", title: "Patterns for building LLM apps", url: "#", relevance_note: "Full-stack GenAI patterns" },
  ],
};

/** Map a request path → fixture object. null means "no specific fixture" (caller
 *  falls back to a safe empty shape so the screen renders 'no data yet'). */
function fixtureFor(path: string): unknown | null {
  const p = path.split("?")[0];
  switch (p) {
    case "/applications": return { applications: APPLICATIONS, statuses: STATUSES };
    case "/applications/pending": return { pending: [] };
    case "/api/cockpit": return COCKPIT;
    case "/api/analytics": return ANALYTICS;
    case "/api/insights/llm": return INSIGHTS_LLM;
    case "/api/system-metrics": return SYSTEM_METRICS;
    case "/api/response-analytics": return RESPONSE_ANALYTICS;
    case "/api/skill-gap": return SKILL_GAP;
    case "/api/daily/today": return DAILY_TODAY;
    case "/api/profile-freshness": return { assets: [{ id: 1, name: "Résumé", days_since: 3, interval_days: 30, status: "fresh", auto: true }] };
    case "/api/calendar-shield": return { checked: 4, clear: true, buffer_min: 30, conflicts: [], unbuffered: [] };
    case "/api/followups": return { candidates: [] };
    case "/api/interviews": return { interviews: [] };
    case "/api/notes": return [];
    case "/api/notifications": return { notifications: [], unread: 0 };
    case "/api/job-scout/review-queue/count": return { count: 2 };
    case "/api/job-scout/review-queue": return { jobs: [] };
    case "/ats/pending/count": return { count: 0 };

    // Discover tab endpoints
    case "/api/study/tracks": return {
      tracks: [
        { key: "rag", name: "Retrieval-Augmented Generation (RAG)", description: "Vector stores, chunking, semantic retrieval, and self-checks.", total: 10 },
        { key: "agent", name: "AI Agents & MCP", description: "Function calling, tool registry, task loop, and server protocols.", total: 12 }
      ]
    };
    case "/api/study/current": return {
      key: "rag",
      name: "Retrieval-Augmented Generation (RAG)",
      description: "Vector stores, chunking, semantic retrieval, and self-checks.",
      total: 10
    };
    case "/api/study/stats": return {
      streak: 5,
      concepts_learned: 8,
      q_quizzed: 12,
      avg_recall: 88,
      reviews_due: 0,
      mastery: [
        { concept: "Retrieval-Augmented Generation (RAG)", score: 92 },
        { concept: "Vector Embeddings", score: 85 }
      ]
    };
    case "/api/study/reviews": return {
      due_count: 0,
      upcoming: []
    };
    case "/api/daily/history": return {
      history: [
        { date: iso(1).slice(0, 10), concept: "Vector Search Basics", difficulty: "easy", sent_whatsapp: true },
        { date: iso(2).slice(0, 10), concept: "Cosine Similarity", difficulty: "medium", sent_whatsapp: true }
      ]
    };
    case "/api/trends": return {
      ideas: [
        { id: 1, title: "In-Browser WASM Data Profiler", description: "A tool that runs pandas profiling client-side to save compute cost.", platform: "reddit", score: 85, status: "shortlisted", created_at: iso(3) },
        { id: 2, title: "Multi-Agent Email Triager", description: "An inbox watchdog that classifies and pre-drafts replies.", platform: "youtube", score: 78, status: "raw", created_at: iso(1) }
      ]
    };
    case "/api/trends/stats": return {
      signals: 28,
      ideas: 12,
      shortlisted: 4,
      youtube_enabled: true
    };
    case "/api/influencers": return [
      { id: 1, name: "Andrej Karpathy", handle: "karpathy", platform: "youtube", is_active: 1, created_at: iso(10) },
      { id: 2, name: "Hamel Husain", handle: "hamel", platform: "rss", is_active: 1, created_at: iso(8) }
    ];
    case "/api/trends/pulse": return {
      items: [
        { id: 1, type: "idea", title: "In-Browser WASM Data Profiler", summary: "A tool that runs pandas profiling client-side to save compute cost.", url: "", source: "reddit", score: 85, when: iso(3), status: "shortlisted" },
        { id: 2, type: "post", title: "Let's build a RAG system from scratch", summary: "Andrej Karpathy's comprehensive guide to building a citation-verified RAG pipeline.", url: "#", source: "Andrej Karpathy", score: 74, when: iso(1) }
      ]
    };
    case "/api/influencers/domains": return [
      { domain: "AI Engineering", count: 4 },
      { domain: "Data Science", count: 2 }
    ];
  }
  if (p.startsWith("/api/influencers/feed")) return INFLUENCER_FEED.posts;
  if (p.startsWith("/api/influencers/unread")) return { count: 0 };
  if (p.startsWith("/api/daily/") && p !== "/api/daily/today" && p !== "/api/daily/history") return DAILY_TODAY;
  if (p.includes("/followups")) return { turns: [] };
  if (p.includes("/explain")) return { explanation: { tldr: "Retrieval-Augmented Generation (RAG) is a technique that grounds model responses in factual source documents." } };
  if (p.includes("/brief")) return { brief: "This is a detailed product design brief generated by JARVIS." };
  if (p.includes("/recruiter-review")) return DEMO_RECRUITER_REVIEW;
  if (p.includes("/prep")) return DEMO_PREP;
  if (p === "/api/notebook/chat") return { reply: "JARVIS Notebook: Based on your active sources (Master Résumé + Target JDs), your SQL and Python background aligns strongly with their data pipeline stack. You should highlight your indexing and automation experience." };
  if (p === "/api/notebook/study-guide") return { study_guide: "# JARVIS Notebook Study Guide — Data Analyst & RAG Pipelines\n\n## 1. Executive Summary & Core Alignment\nYour Master Résumé highlights strong Python, SQL, and FastAPI experience. This matches 85% of target Data Analyst roles.\n\n## 2. Technical Mastery Points\n- **SQL Window Functions**: Review RANK(), DENSE_RANK(), LEAD(), LAG().\n- **Indexing & Performance**: Study B-tree indexing and query execution plans.\n\n## 3. Top Interview Questions\n- **Q**: How do you optimize a slow-running SQL query?\n  **A**: Analyze the EXPLAIN execution plan, verify missing indexes, and reduce subqueries.\n\n## 4. 3-Day Actionable Roadmap\n- Day 1: Master SQL window functions.\n- Day 2: Review project metrics and quantified achievements.\n- Day 3: Practice mock behavioral STAR stories." };
  if (p === "/api/notebook/quiz") return { quiz: [
    { question: "Which SQL clause is used to filter aggregated results after a GROUP BY?", options: ["WHERE", "HAVING", "ORDER BY", "QUALIFY"], correct_idx: 1, explanation: "HAVING filters aggregated groups, whereas WHERE filters individual rows before aggregation." },
    { question: "What is the primary purpose of BM25 in a RAG pipeline?", options: ["Generating embeddings", "Sparse lexical retrieval", "Fine-tuning LLMs", "Chunking PDFs"], correct_idx: 1, explanation: "BM25 is a ranking algorithm used for sparse keyword/lexical retrieval." },
    { question: "In Python, which data structure provides O(1) average-time key lookups?", options: ["List", "Tuple", "Dictionary", "Deque"], correct_idx: 2, explanation: "Python dictionaries use hash tables to achieve O(1) average lookup time." }
  ]};
  if (p === "/api/notebook/audio-overview") return { script: [
    { speaker: "JARVIS", text: "Welcome to your career overview briefing. Today we're analyzing your alignment with senior data analyst roles across your active sources." },
    { speaker: "Coach", text: "That's right, JARVIS. The candidate's Python and SQL expertise is a major highlight, but they need to emphasize business impact in their STAR responses." },
    { speaker: "JARVIS", text: "Precisely. Focusing on quantified metrics will elevate their match score past 90%." }
  ]};
  if (p.includes("/dossier")) return {
    dossier: "# Executive Intelligence Dossier — Nimbus Analytics\n\n## 1. Recent Company News\n- **Funding & Expansion**: Nimbus Analytics recently secured Series B funding to scale real-time analytics for e-commerce clients.\n- **Tech Stack Shift**: Moving core ETL pipelines from legacy batch jobs to streaming Apache Flink and dbt models.\n\n## 2. Reported Glassdoor & Reddit Interview Questions\n- 'How do you structure window functions for sessionization?'\n- 'Describe a time you diagnosed a memory leak or OOM ratcheting in Python.'\n- 'How do you handle missing values in time-series aggregations?'\n\n## 3. Executive Notes\nLeadership values proactive automation and self-service analytics.",
    citations: [
      { title: "Nimbus Analytics Series B Announcement", url: "#" },
      { title: "Glassdoor Data Analyst Interview Experiences", url: "#" }
    ]
  };
  if (p === "/api/jobs/upload-image") return { ok: true, app_id: 99, job_key: "img:demo", title: "Data Engineer (Scanned)", company: "Apex Data" };
  if (p === "/api/voice-interview/evaluate") return { evaluation: {
    star_score: 88,
    filler_words_count: 1,
    pacing_feedback: "Pacing was clear at 135 wpm with strong voice modulation.",
    tone_rating: "Confident & Structured",
    strengths: ["Explicit Situation metrics", "Clear Action steps using SQL window functions"],
    improvements: ["Highlight business ROI in the final Result sentence"]
  }};
  if (p === "/api/notebook/python-exec") return {
    response: "Calculated summary statistics for the provided array using Python NumPy.",
    code: "import numpy as np\ndata = [12, 45, 67, 89, 23, 56, 78, 90, 34, 65]\nprint('Mean:', np.mean(data))\nprint('Std Dev:', np.std(data))\nprint('95th Pct:', np.percentile(data, 95))",
    output: "Mean: 55.9\nStd Dev: 25.1\n95th Pct: 89.55"
  };
  if (p === "/api/vault/search") return { answer: "JARVIS Vault Match: Found 2 past projects matching this requirement:\n1. **WASM Data Profiler (2025)**: Built in-browser profiling using Pandas and WebAssembly.\n2. **PDF RAG Engine (2026)**: Designed page-chunked BM25 lexical retrieval and Gemini LLM verification." };
  if (p.includes("/market-validation")) return {
    validation: "## Live Google Search Grounded Validation\n\n### 1. Existing Solutions\n- **ProductivityHub (SaaS)**: A web portal mapping calendar tasks to daily priority slots.\n- **TaskSync (Chrome Extension)**: Simple side-panel helper but lacks LLM prioritization.\n\n### 2. GitHub Repositories\n- `priority-schedule-optimizer` (Python, 450 stars)\n- `local-calendar-rag` (NodeJS, 120 stars)\n\n### 3. Competitor Gaps\nNone of the existing tools support offline privacy-first local databases or outbound WhatsApp scheduling reminders. Building a WhatsApp-native agent gives us a 10x distribution advantage.",
    citations: [
      { title: "ProductivityHub Official Page", url: "#" },
      { title: "GitHub task-sync repo", url: "#" }
    ]
  };
  if (p.includes("/ground")) return {
    grounded_context: "## Factual Grounded Context\n\n- **Official Status**: Verified release of Vite 6.0.0-beta.2 on July 15, 2026.\n- **Breaking Changes**: Introduces deprecation of legacy CSS import syntax and upgrades to Rollup 4.\n- **Performance**: Up to 18% improvement in dev cold-start timings.",
    citations: [
      { title: "Vite 6 Changelog & Release Notes", url: "#" },
      { title: "Vite Official Documentation", url: "#" }
    ]
  };
  return null;
}

const DEMO_RECRUITER_REVIEW = {
  role_fit_score: 85,
  verdict: "Strong candidate with solid Python/SQL foundations. Good match for a mid-level data analyst role, but needs to highlight more business impact in recent projects.",
  six_second_test: {
    role_clear: true,
    skills_clear: true,
    impact_clear: false,
    note: "The candidate's core skills are highly visible, but business impact/metrics are buried."
  },
  strengths: [
    "Proven experience building end-to-end data pipelines using Python and SQL.",
    "Strong understanding of database internals and performance optimization.",
    "Experienced in automated reporting and dashboard design."
  ],
  red_flags: [
    "Lacks explicit cloud platform experience (AWS/GCP/Azure) in the résumé bullets.",
    "Missing clear quantification of data pipeline performance improvements."
  ],
  learning_roadmap: [
    { skill: "dbt (data build tool)", importance: "high", reason: "Required by the job description for modular SQL workflows.", est_time: "1 week" },
    { skill: "Cloud Services (AWS/GCP)", importance: "medium", reason: "Important for deploying modern cloud data platforms.", est_time: "2 weeks" }
  ]
};

const DEMO_PREP = {
  job_ref: "demo:1",
  outreach_linkedin: "Hi Sarah, saw your posting for the Data Analyst role. My background in building automated pipelines with Python & SQL aligns perfectly. Would love to connect and share how I optimized data queries by 40% at Nimbus. Thanks!",
  outreach_email: "Subject: Data Analyst Application - Madan Sai\n\nHi Sarah,\n\nI hope you're doing well.\n\nI recently applied for the Data Analyst position at Nimbus Analytics. With 3+ years of experience designing data pipelines, writing complex SQL queries, and translating raw data into business insights, I'm confident I can make an immediate impact on your team.\n\nAt Nimbus, I built an automated reporting engine that saved the team 10+ hours weekly and reduced query latency by 40%. My master résumé is attached for your review.\n\nI would welcome the opportunity to chat briefly about how my skills align with your current needs. Do you have 10 minutes next Tuesday afternoon?\n\nBest regards,\nMadan Sai",
  star_stories: [
    {
      question: "Tell me about a time you optimized a slow query or database pipeline.",
      situation: "At Nimbus Analytics, a daily dashboard query was taking over 45 minutes to execute, causing delayed morning briefings for executives.",
      task: "I was tasked with identifying the bottleneck and optimizing the query execution time to under 10 minutes.",
      action: "I analyzed the execution plan, added missing compound indexes on frequently joined tables, and rewritten nested subqueries into CTEs.",
      result: "The execution time dropped from 45 minutes to just 3 minutes (a 93% improvement), and the executive briefing was fully automated."
    },
    {
      question: "How do you handle missing or messy data in your analysis?",
      situation: "We received a batch of customer interaction data from a third-party vendor that had over 30% missing values in critical columns like location and timestamp.",
      task: "I needed to clean and prepare this data for a quarterly customer retention report without skewing the results.",
      action: "I designed an auto-imputation script in Python using pandas, applying median values for numeric gaps and forward-filling categorical markers based on historical user sessions.",
      result: "The cleaned dataset achieved a 98% validity rate, allowing us to successfully deliver the retention report on schedule."
    },
    {
      question: "Explain a project where you translated business requests into technical requirements.",
      situation: "The product manager wanted to track user drop-offs in the checkout funnel but couldn't specify the exact event triggers needed.",
      task: "I needed to design the tracking schema and funnel visualization that the engineering team could implement.",
      action: "I interviewed the product manager to define key conversion milestones, mapped these to specific page events, and built a prototype dashboard in Tableau.",
      result: "The engineering team successfully instrumented the events within one sprint, and the new funnel dashboard identified a 15% checkout drop-off bottleneck."
    }
  ]
};

/** Build a synthetic Response for a demo request, or null to let it hit the network. */
export function demoResponse(url: string, method: string): Response | null {
  let path: string;
  try { path = new URL(url, window.location.origin).pathname + new URL(url, window.location.origin).search; }
  catch { path = url; }

  // Never intercept auth or static console assets — those must work for real.
  if (path.startsWith("/auth/") || path.startsWith("/console/") || path === "/ping") return null;

  const m = method.toUpperCase();
  const json = (obj: unknown, status = 200) =>
    new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

  if (m !== "GET") {
    if (path.includes("/recruiter-review") || path.includes("/prep")) {
      return json(fixtureFor(path));
    }
    // Read-only demo: acknowledge without persisting anything.
    return json({ ok: false, demo: true, error: "This is a read-only demo — sign in to make changes." }, 200);
  }
  const fx = fixtureFor(path);
  if (fx !== null) return json(fx);
  // Unknown data endpoint → empty-but-valid shape so the screen degrades gracefully.
  return json({});
}
