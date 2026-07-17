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
  { id: 1, job_key: "demo:1", title: "Data Analyst", company: "Nimbus Analytics", location: "Bengaluru", source: "LinkedIn", status: "interviewing", reviewed: 1, apply_method: "link", ats_score: 82, ats_scored_at: iso(2), recruiter_score: 78, recruiter_scored_at: iso(2), news_count: 2, applied_at: iso(11), updated_at: iso(2), url: "#" },
  { id: 2, job_key: "demo:2", title: "Analytics Engineer", company: "Vela Systems", location: "Remote", source: "Wellfound", status: "applied", reviewed: 1, apply_method: "email", ats_score: 74, ats_scored_at: iso(4), recruiter_score: 71, recruiter_scored_at: iso(4), news_count: 0, applied_at: iso(5), updated_at: iso(5), url: "#" },
  { id: 3, job_key: "demo:3", title: "BI Developer", company: "Corewave", location: "Hyderabad", source: "Naukri", status: "applied", reviewed: 1, apply_method: "link", ats_score: 68, ats_scored_at: iso(6), recruiter_score: null, recruiter_scored_at: null, news_count: 1, applied_at: iso(6), updated_at: iso(6), url: "#" },
  { id: 4, job_key: "demo:4", title: "Product Data Analyst", company: "Lumen Labs", location: "Remote", source: "LinkedIn", status: "offer", reviewed: 1, apply_method: "email", ats_score: 88, ats_scored_at: iso(1), recruiter_score: 84, recruiter_scored_at: iso(1), news_count: 3, applied_at: iso(20), updated_at: iso(1), url: "#" },
  { id: 5, job_key: "demo:5", title: "Data Scientist (Jr)", company: "Aster Health", location: "Pune", source: "Instahyre", status: "interested", reviewed: 0, apply_method: "link", ats_score: null, ats_scored_at: null, recruiter_score: null, recruiter_scored_at: null, news_count: 0, applied_at: null, updated_at: iso(1), url: "#" },
  { id: 6, job_key: "demo:6", title: "Business Analyst", company: "Quill Finance", location: "Mumbai", source: "Naukri", status: "interested", reviewed: 0, apply_method: "link", ats_score: null, ats_scored_at: null, recruiter_score: null, recruiter_scored_at: null, news_count: 0, applied_at: null, updated_at: iso(0), url: "#" },
  { id: 7, job_key: "demo:7", title: "Analytics Consultant", company: "Grid Dynamics", location: "Remote", source: "LinkedIn", status: "rejected", reviewed: 1, apply_method: "link", ats_score: 61, ats_scored_at: iso(15), recruiter_score: 55, recruiter_scored_at: iso(15), news_count: 0, applied_at: iso(24), updated_at: iso(9), url: "#" },
  { id: 8, job_key: "demo:8", title: "Data Analyst II", company: "Pixel Retail", location: "Gurugram", source: "Wellfound", status: "applied", reviewed: 1, apply_method: "email", ats_score: 79, ats_scored_at: iso(3), recruiter_score: 73, recruiter_scored_at: iso(3), news_count: 1, applied_at: iso(3), updated_at: iso(3), url: "#" },
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
  return null;
}

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
    // Read-only demo: acknowledge without persisting anything.
    return json({ ok: false, demo: true, error: "This is a read-only demo — sign in to make changes." }, 200);
  }
  const fx = fixtureFor(path);
  if (fx !== null) return json(fx);
  // Unknown data endpoint → empty-but-valid shape so the screen degrades gracefully.
  return json({});
}
