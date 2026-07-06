import { useMemo, useState } from "react";
import { ScreenId } from "../types";
import {
  Compass, ClipboardCheck, Send, ListChecks, MailCheck, CalendarClock,
  BarChart3, Wallet, TerminalSquare, Sparkles, Bot, Search, LifeBuoy,
} from "lucide-react";

interface HelpProps {
  onNavigate: (screen: ScreenId) => void;
}

interface HelpItem {
  name: string;
  what: string;
  how: string;
  tag?: string;
}

interface HelpSection {
  id: string;
  title: string;
  blurb: string;
  Icon: typeof Compass;
  items: HelpItem[];
}

/* Every capability, grouped by the job-search lifecycle. Pure documentation —
   the "how" tells you exactly where to click or what to say to JARVIS. */
const SECTIONS: HelpSection[] = [
  {
    id: "basics",
    title: "Console basics",
    blurb: "The pieces you touch every day.",
    Icon: LifeBuoy,
    items: [
      { name: "Home cockpit", what: "Your landing screen — a JARVIS greeting, a prioritized 'next steps' queue that deep-links into the right tool, and a live pipeline pulse.", how: "Click HOME. Each next-step is clickable and jumps you straight to the action." },
      { name: "JARVIS chat", what: "Talk to the assistant in plain English. It routes your words to the right agent — no commands to memorize.", how: "Open JARVIS and type naturally, e.g. \"applied to Data Analyst at Acme on LinkedIn\", \"add electricity bill 1200 due on the 5th monthly\", or \"what interviews do I have this week?\"" },
      { name: "Search & notifications", what: "The top search jumps between screens fast; the bell collects agent updates (follow-ups drafted, board moved, bills due).", how: "Use 'Search protocols…' up top, or click the 🔔 bell for what changed." },
    ],
  },
  {
    id: "discover",
    title: "1 · Discover",
    blurb: "Find roles worth your time.",
    Icon: Compass,
    items: [
      { name: "Job Scout", what: "Auto-searches Data-Analyst roles daily (Adzuna + Remotive), dedupes, ranks them, and surfaces the fresh matches. On-demand search too.", how: "JOBS → review the fresh matches banner, or ask JARVIS \"find data analyst jobs in Hyderabad\"." },
    ],
  },
  {
    id: "assess",
    title: "2 · Assess — Résumé & ATS",
    blurb: "Know your score before you apply. This is the big one.",
    Icon: ClipboardCheck,
    items: [
      { name: "Résumé Audit", what: "A deterministic health score (0–100) with a full breakdown — contact, sections, dates, quantified impact, hygiene, length, ATS parse-safety. Not tied to any job. The number is rule-based, so fixing something moves it up and it stays up.", how: "JOBS → RÉSUMÉ → RE-RUN AUDIT." },
      { name: "AUTO-FIX", what: "One tap that reclaims the structural points: inlines tab 'columns' into a single column, converts indented lines to • bullets, and adds a SUMMARY heading if missing. It moves the score. It NEVER invents numbers — those are yours to add.", how: "In the Résumé Audit, click AUTO-FIX. It tells you exactly what it changed and how many bullets still need real numbers.", tag: "moves score" },
      { name: "APPLY AI SUGGESTIONS", what: "Takes the grammar/wording corrections you tick (spelling, tense, passive-voice, date-range fixes) and applies them to your .docx, preserving formatting. This is polish — it does NOT change the score.", how: "In the Résumé Audit, tick the corrections you agree with, then click APPLY AI SUGGESTIONS.", tag: "polish only" },
      { name: "ATS Analysis (per job)", what: "Scores your résumé against ONE job's description. Shows a keyword matrix (required / present / missing) and a STAR-XYZ rewrite plan. The match score is computed from the matrix — stable and explainable ('7 of 10 required present = 70').", how: "On any job card with a description, click ATS ANALYSIS. No description? Paste the posting when prompted." },
      { name: "Recruiter Read", what: "A recruiter's-eye take on your résumé for that job: a fit verdict, the 6-second test (role / skills / impact clear?), what stands out, what makes a recruiter hesitate, and a learning roadmap for genuinely-missing skills. Coaching only — never suggests fabricating experience.", how: "Inside ATS Analysis, open the RECRUITER READ tab. First open runs it; re-opening is instant from cache.", tag: "new" },
    ],
  },
  {
    id: "apply",
    title: "3 · Apply",
    blurb: "Turn a match into a tracked application.",
    Icon: Send,
    items: [
      { name: "Add a job", what: "Track a role you're applying to. Add it by hand, or just tell JARVIS and it creates the card.", how: "JOBS → Add Job, or say \"applied to X at Y on Naukri\"." },
      { name: "Apply prep", what: "Preps what you need to apply and, when you approve it, can assist the apply step — nothing goes out without your go-ahead.", how: "From a card's actions in the Discover/Apply flow." },
    ],
  },
  {
    id: "track",
    title: "4 · Track",
    blurb: "Keep the pipeline honest without manual bookkeeping.",
    Icon: ListChecks,
    items: [
      { name: "Kanban board", what: "Your applications across stages: interested → applied → interviewing → offer → accepted / rejected. Cards carry the ATS score badge and next-step cues.", how: "JOBS is the board. Drag a card or use its status control to move it." },
      { name: "Email → board auto-sync", what: "Reads your Gmail twice a day and advances cards automatically (applied → interviewing → offer, etc.). Confident single matches move on their own; ambiguous ones wait for your confirm.", how: "Runs automatically. Resolve any 'Needs your confirmation' items on the board, or trigger a scan from the Jobs toolbar." },
    ],
  },
  {
    id: "followup",
    title: "5 · Follow-up",
    blurb: "Nudge stalled applications and track the people.",
    Icon: MailCheck,
    items: [
      { name: "Auto follow-ups", what: "For applications sitting in 'applied' too long with no reply, JARVIS drafts a gracious follow-up and parks it for you. It NEVER sends on its own — your Send click is the approval.", how: "Review drafts in JOBS → Follow-ups, edit if you like, then send." },
      { name: "Networking CRM", what: "Tracks the people behind your applications (recruiters, referrers). Auto-captures a contact when a real person emails you about a role.", how: "JOBS → Network. Contacts are added automatically from recruiter emails; add or edit any manually." },
    ],
  },
  {
    id: "interview",
    title: "6 · Interview",
    blurb: "Walk in prepared, protect your calendar.",
    Icon: CalendarClock,
    items: [
      { name: "Interview Prep Dock", what: "Surfaces upcoming interviews from your Google Calendar and, on demand, drafts a focused prep brief for the role.", how: "JOBS → Interview, or watch for the 'Prep' cue on interview-stage cards." },
      { name: "Calendar Shield", what: "Guards your schedule around interviews so nothing double-books over them.", how: "Runs in the background; see its status on the INSIGHTS screen." },
    ],
  },
  {
    id: "reflect",
    title: "7 · Reflect — Insights",
    blurb: "See what's working and where the gaps are.",
    Icon: BarChart3,
    items: [
      { name: "Insights", what: "Response funnel (how far applications get), skill-gap (market demand vs your résumé's coverage across every analysed job), calendar-shield status, and profile freshness.", how: "Open INSIGHTS." },
      { name: "Voice Standup", what: "A single spoken briefing that pulls the whole search together — interviews, follow-ups due, pipeline momentum.", how: "From the Home cockpit, hit BRIEF ME." },
      { name: "Profile Freshness", what: "Nudges to keep your shop-window (LinkedIn, résumé) current so recruiters see the latest you.", how: "Surfaced on INSIGHTS and via notifications." },
    ],
  },
  {
    id: "utilities",
    title: "Everyday utilities",
    blurb: "The rest of the toolkit.",
    Icon: Wallet,
    items: [
      { name: "Bills & deadlines", what: "Track recurring or one-off bills with due-date status dots and one-tap Mark Paid; get notified before each is due.", how: "Open BILLS, or say \"add rent 15000 due on the 1st monthly\" / \"mark rent paid\"." },
      { name: "Terminal", what: "Upload a PDF to read, bridge to scoped local files, and check system info.", how: "Open TERMINAL." },
    ],
  },
];

export default function Help({ onNavigate }: HelpProps) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SECTIONS;
    return SECTIONS.map((s) => ({
      ...s,
      items: s.items.filter(
        (it) =>
          it.name.toLowerCase().includes(q) ||
          it.what.toLowerCase().includes(q) ||
          it.how.toLowerCase().includes(q)
      ),
    })).filter((s) => s.items.length > 0 || s.title.toLowerCase().includes(q));
  }, [query]);

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass-panel rounded-2xl border border-[#8aebff]/20 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#8aebff]/10 border border-[#8aebff]/30 flex items-center justify-center">
              <Sparkles className="w-5.5 h-5.5 text-[#8aebff]" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono glow-cyan">
                Help & Guide
              </h1>
              <p className="text-xs text-[#859397] mt-1 leading-relaxed max-w-xl">
                Everything this console does — what each tool is for and exactly how to use it,
                laid out along your job-search lifecycle.
              </p>
            </div>
          </div>
          <button
            onClick={() => onNavigate(ScreenId.Assistant)}
            className="bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all cursor-pointer"
          >
            <Bot className="w-4.5 h-4.5" /> Ask JARVIS
          </button>
        </div>

        {/* Search */}
        <div className="mt-5 flex items-center gap-2 bg-[#0a0e1a]/50 border border-white/10 rounded-lg px-3 py-2 focus-within:border-[#8aebff]/50 transition-colors">
          <Search className="w-4 h-4 text-[#859397]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help — e.g. auto-fix, follow-up, ATS…"
            className="bg-transparent outline-none text-sm text-[#dfe2f3] placeholder:text-[#859397] w-full font-mono"
          />
        </div>
      </div>

      {/* Sections */}
      {filtered.length === 0 && (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm">
          No help topic matches “{query}”. Try a different word, or ask JARVIS directly.
        </div>
      )}

      {filtered.map((section) => (
        <div key={section.id} className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
          <div className="px-6 py-4 border-b border-white/5 bg-white/5 flex items-center gap-3">
            <section.Icon className="w-5 h-5 text-[#8aebff]" />
            <div>
              <h2 className="text-sm font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">
                {section.title}
              </h2>
              <p className="text-[11px] text-[#859397]">{section.blurb}</p>
            </div>
          </div>
          <div className="divide-y divide-white/5">
            {section.items.map((it) => (
              <div key={it.name} className="p-5 sm:px-6">
                <div className="flex items-center gap-2 flex-wrap mb-1.5">
                  <span className="text-[#dfe2f3] font-semibold text-sm">{it.name}</span>
                  {it.tag && (
                    <span className="text-[9px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-[#8aebff]/30 bg-[#8aebff]/10 text-[#8aebff]">
                      {it.tag}
                    </span>
                  )}
                </div>
                <p className="text-[13px] text-[#bbc9cd] leading-relaxed">{it.what}</p>
                <p className="text-[12px] text-[#8aebff]/90 leading-relaxed mt-2 flex items-start gap-1.5">
                  <TerminalSquare className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 opacity-70" />
                  <span><span className="text-[#859397] uppercase text-[10px] tracking-wider mr-1">How</span>{it.how}</span>
                </p>
              </div>
            ))}
          </div>
        </div>
      ))}

      <p className="text-center text-[11px] text-[#859397] font-mono pb-4">
        Can't find it? Open <button onClick={() => onNavigate(ScreenId.Assistant)} className="text-[#8aebff] hover:underline cursor-pointer">JARVIS</button> and just ask.
      </p>
    </div>
  );
}
