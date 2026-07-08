import { useEffect, useState, useCallback, useRef } from "react";
import {
  Newspaper, RefreshCw, ExternalLink, BookOpen, Code2, Send,
  CheckCircle2, Smile, Meh, Frown, History, GraduationCap, Brain, XCircle, AlertCircle,
  Flame, Layers, Target, Repeat, MessageCircleQuestion, Download, StickyNote, CalendarRange,
  Play, Sparkles, Search, User, Bot, Lightbulb,
} from "lucide-react";
import { getToken } from "../lib/auth";

// Pyodide (Python-in-WASM) loaded lazily from CDN only when the learner first runs code.
declare global { interface Window { loadPyodide?: (opts: { indexURL: string }) => Promise<PyodideAPI>; } }
interface PyodideAPI {
  runPythonAsync: (code: string) => Promise<unknown>;
  setStdout: (opts: { batched: (s: string) => void }) => void;
  setStderr: (opts: { batched: (s: string) => void }) => void;
}
const PYODIDE_VER = "0.26.4";
let _pyodidePromise: Promise<PyodideAPI> | null = null;
function loadPyodideOnce(): Promise<PyodideAPI> {
  if (_pyodidePromise) return _pyodidePromise;
  _pyodidePromise = new Promise((resolve, reject) => {
    const url = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VER}/full/`;
    const s = document.createElement("script");
    s.src = `${url}pyodide.js`;
    s.onload = async () => {
      try { resolve(await window.loadPyodide!({ indexURL: url })); }
      catch (e) { _pyodidePromise = null; reject(e); }
    };
    s.onerror = () => { _pyodidePromise = null; reject(new Error("Couldn't load the Python runtime (offline?).")); };
    document.head.appendChild(s);
  });
  return _pyodidePromise;
}

interface NewsItem { title: string; url: string; snippet: string; }
interface Digest {
  empty?: boolean;
  date?: string;
  concept?: string;
  pedagogical_focus?: string;
  news?: NewsItem[];
  digest_text?: string;
  reference_code?: string;
  difficulty?: string | null;
  sent_whatsapp?: boolean;
}
interface HistRow { date: string; concept: string; difficulty: string | null; sent_whatsapp: boolean; }
interface Track { key: string; name: string; description: string; total: number; }
interface Progress { key: string; name: string; total: number; completed: number; next: string | null; }
interface GradeItem { verdict: string; explanation: string; }
interface Grade { overall: number; items: GradeItem[]; }
interface Feynman { rating: string; correct: string; missing: string[]; feedback: string; }
interface Mastery { concept: string; score: number; }
interface Stats { streak: number; concepts_learned: number; quizzed: number; avg_recall: number | null; reviews_due: number; mastery: Mastery[]; }
interface ReviewItem { concept: string; rep: number; next_due: string; }
interface FollowTurn { role: string; content: string; }
interface NoteHit { id: number; title: string; snippet: string; }
interface Explain {
  tldr: string;
  analogy?: string;
  sections?: { heading: string; body: string }[];
  example?: { caption?: string; code?: string };
  key_points?: string[];
  pitfalls?: string[];
  quick_check?: { q: string; a: string };
}

// digest_text is the full WhatsApp-format payload (news list + learning notes + any legacy
// mini-project / weekly-project / QA-assert scaffolding). On the web the news is shown as linked
// cards + the Home newspaper strip, so here we keep ONLY the learning prose: strip the news list,
// the project sections, and any assert/QA lines. Returns "" when nothing meaningful is left.
function cleanLesson(raw: string): string {
  // Drop any leaked reference-implementation code block + stray xml-ish tags before line parsing.
  raw = raw
    .replace(/<reference_implementation>[\s\S]*?<\/reference_implementation>/gi, "")
    .replace(/<\/?(reference_implementation|whatsapp_payload)>/gi, "");
  const out: string[] = [];
  let section: "pre" | "news" | "learn" | "project" = "pre";
  let skipAssertRules = false;
  let inCode = false;
  for (const rawLine of raw.split("\n")) {
    const line = rawLine.replace(/\*/g, "").replace(/\r/g, "");
    const t = line.trim();
    const low = t.toLowerCase();
    if (t.startsWith("```")) { inCode = !inCode; continue; }  // drop code blocks (shown in the editor)
    if (inCode) continue;
    if (low.includes("regular daily ai updates")) { section = "news"; continue; }
    if (low.includes("what i need to learn")) { section = "learn"; skipAssertRules = false; continue; }
    if (low.includes("this week") && low.includes("project")) { section = "project"; continue; }
    if (section === "news" || section === "project") continue;
    if (low.startsWith("practical mini-project") || low.startsWith("- practical mini-project")) continue;
    if (low.includes("qa validation lines")) continue;
    if (low.startsWith("critical assertion")) { skipAssertRules = true; continue; }
    if (skipAssertRules) { if (/^\d+\./.test(t)) continue; skipAssertRules = false; }
    if (t.startsWith("assert ")) continue;
    if (low.startsWith("core concept to master") || low.startsWith("- core concept to master")) continue;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Parse a response as JSON, but never throw on a plain-text error page (e.g. a 500
// "Internal Server Error") — return a clean {error} instead so the UI shows a friendly message.
async function safeJson(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  try { return JSON.parse(text); }
  catch { return { error: res.ok ? "Unexpected response from the server." : `Server error (${res.status}). Please try again.` }; }
}

// Smooth-scroll to a section (used by the "study in 4 steps" hint card).
function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

// Tiny markdown-lite renderer: **bold** + "- " bullets + paragraphs. Keeps tutor replies readable
// instead of a single wall of text, without pulling in a markdown library.
function RichText({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  const fmt = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith("**") && p.endsWith("**")
        ? <strong key={j} className="text-[#dfe2f3] font-semibold">{p.slice(2, -2)}</strong>
        : <span key={j}>{p}</span>);
  return (
    <div className="space-y-1">
      {lines.map((ln, i) => {
        const isBullet = /^\s*[-*•]\s+/.test(ln);
        if (isBullet) {
          return <div key={i} className="flex gap-1.5"><span className="text-[#8aebff] mt-0.5">•</span><p className="leading-relaxed flex-1">{fmt(ln.replace(/^\s*[-*•]\s+/, ""))}</p></div>;
        }
        return <p key={i} className="leading-relaxed">{fmt(ln)}</p>;
      })}
    </div>
  );
}

const FOLLOWUP_CHIPS = ["Explain more simply", "Give a real-world example", "Show me the code", "Quiz me on this"];

export default function DailyUpdate() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");
  const [tracks, setTracks] = useState<Track[]>([]);
  const [track, setTrack] = useState<{ active: string; progress: Progress | null }>({ active: "", progress: null });
  // Active recall
  const [quiz, setQuiz] = useState<{ q: string }[] | null>(null);
  const [answers, setAnswers] = useState<string[]>([]);
  const [grade, setGrade] = useState<Grade | null>(null);
  const [quizBusy, setQuizBusy] = useState(false);
  const [feynText, setFeynText] = useState("");
  const [feyn, setFeyn] = useState<Feynman | null>(null);
  const [feynBusy, setFeynBusy] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [reviews, setReviews] = useState<{ due: ReviewItem[]; upcoming: ReviewItem[]; due_count: number } | null>(null);
  // Deep-dive explainer
  const [explain, setExplain] = useState<Explain | null>(null);
  const [explainBusy, setExplainBusy] = useState(false);
  const [checkOpen, setCheckOpen] = useState(false);
  // Go-deeper extras — follow-up chat thread
  const [followQ, setFollowQ] = useState("");
  const [followThread, setFollowThread] = useState<FollowTurn[]>([]);
  const [followBusy, setFollowBusy] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  // Try-it code — LLM review + real in-browser execution
  const [codeText, setCodeText] = useState("");
  const [codeResult, setCodeResult] = useState<{ passed: boolean; feedback: string } | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const [runOut, setRunOut] = useState<{ out: string; err: boolean } | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  // Notes: highlight-to-save + search-back
  const [highlight, setHighlight] = useState("");
  const [noteQ, setNoteQ] = useState("");
  const [noteHits, setNoteHits] = useState<NoteHit[] | null>(null);
  const [noteSearchBusy, setNoteSearchBusy] = useState(false);
  const [recap, setRecap] = useState<{ recap: string; quiz: string[] } | null>(null);
  const [recapBusy, setRecapBusy] = useState(false);
  // "Study in 4 steps" hint card — dismissible, remembered across sessions.
  const [showHint, setShowHint] = useState(() => {
    try { return localStorage.getItem("daily_hint_dismissed") !== "1"; } catch { return true; }
  });
  const dismissHint = () => {
    setShowHint(false);
    try { localStorage.setItem("daily_hint_dismissed", "1"); } catch { /* ignore */ }
  };

  const loadDay = useCallback(async (d?: string) => {
    const r = await fetch(d ? `/api/daily/${d}` : "/api/daily/today");
    let day: Digest | null = null;
    if (r.ok) { day = await r.json(); setDigest(day); }
    setQuiz(null); setAnswers([]); setGrade(null); setFeyn(null); setFeynText("");
    setFollowThread([]); setCodeResult(null); setRunOut(null); setExplain(null); setCheckOpen(false);
    // Pre-fill the code editor with the day's runnable example so "Run" works out of the box.
    setCodeText(day?.reference_code || "");
    // Load the persistent follow-up thread + any cached deep-dive explainer for this concept.
    if (day?.date) {
      const [tr, er] = await Promise.all([
        fetch(`/api/daily/${day.date}/followups`),
        fetch(`/api/daily/${day.date}/explain`),
      ]);
      if (tr.ok) setFollowThread((await tr.json()).turns || []);
      if (er.ok) { const ed = await er.json(); if (ed.explanation) setExplain(ed.explanation); }
    }
  }, []);

  const loadTrack = useCallback(async () => {
    const [tRes, cRes, sRes, rRes] = await Promise.all([
      fetch("/api/study/tracks"), fetch("/api/study/current"),
      fetch("/api/study/stats"), fetch("/api/study/reviews"),
    ]);
    if (tRes.ok) setTracks((await tRes.json()).tracks || []);
    if (cRes.ok) setTrack(await cRes.json());
    if (sRes.ok) setStats(await sRes.json());
    if (rRes.ok) setReviews(await rRes.json());
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [, hRes] = await Promise.all([loadDay(), fetch("/api/daily/history"), loadTrack()]);
      if (hRes.ok) setHistory((await hRes.json()).history || []);
    } finally { setLoading(false); }
  }, [loadDay, loadTrack]);

  const selectTrack = async (key: string) => {
    const res = await fetch("/api/study/select", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ track_key: key }),
    });
    if (res.ok) {
      await loadTrack();
      setMsg(key ? "Study track set — your next update will follow this syllabus." : "Study track cleared — free-choice topics.");
    }
  };

  useEffect(() => { loadAll(); }, [loadAll]);
  // Keep the follow-up chat scrolled to the latest turn.
  useEffect(() => { threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" }); }, [followThread]);

  // Capture text the learner highlights inside the lesson → offer to save it.
  const captureSelection = () => {
    const sel = window.getSelection?.()?.toString().trim() || "";
    if (sel.length >= 8) setHighlight(sel);
  };

  const generate = async () => {
    setGenerating(true); setMsg("");
    try {
      const res = await fetch("/api/daily/generate", { method: "POST" });
      const d = await res.json();
      if (!res.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${res.status}`);
      setMsg(`Generated: ${d.concept}${d.qa_passed ? "" : " (QA flagged — you can regenerate)"}`);
      await loadAll();
    } catch (e) { setMsg(`Generation failed: ${e instanceof Error ? e.message : e}`); }
    finally { setGenerating(false); }
  };

  const sendWhatsApp = async () => {
    if (!digest?.date) return;
    setSending(true);
    try {
      const res = await fetch(`/api/daily/${digest.date}/whatsapp`, { method: "POST" });
      const d = await res.json();
      if (!res.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${res.status}`);
      setDigest((p) => (p ? { ...p, sent_whatsapp: true } : p));
      setMsg("Sent to WhatsApp.");
    } catch (e) { setMsg(`WhatsApp send failed: ${e instanceof Error ? e.message : e}`); }
    finally { setSending(false); }
  };

  const rate = async (rating: "E" | "J" | "H") => {
    if (!digest?.date) return;
    setDigest((p) => (p ? { ...p, difficulty: rating } : p));
    const res = await fetch(`/api/daily/${digest.date}/difficulty`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rating }),
    });
    const d = await res.json().catch(() => ({}));
    if (d?.skill_level) setMsg(`Noted — skill level now ${d.skill_level}.`);
  };

  const startQuiz = async () => {
    if (!digest?.date) return;
    setQuizBusy(true); setMsg("");
    try {
      const res = await fetch(`/api/daily/${digest.date}/quiz`, { method: "POST" });
      const dd = await res.json();
      if (dd.error) throw new Error(dd.error);
      setQuiz(dd.questions); setAnswers(new Array(dd.questions.length).fill(""));
      if (dd.graded) setGrade(dd.graded);
    } catch (e) { setMsg(`Quiz: ${e instanceof Error ? e.message : e}`); }
    finally { setQuizBusy(false); }
  };
  const submitQuiz = async () => {
    if (!digest?.date) return;
    setQuizBusy(true);
    try {
      const res = await fetch(`/api/daily/${digest.date}/quiz/grade`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ answers }),
      });
      const dd = await res.json();
      if (dd.error) throw new Error(dd.error);
      setGrade(dd);
    } catch (e) { setMsg(`Grade: ${e instanceof Error ? e.message : e}`); }
    finally { setQuizBusy(false); }
  };
  const checkFeynman = async () => {
    if (!digest?.date || feynText.trim().length < 10) return;
    setFeynBusy(true);
    try {
      const res = await fetch(`/api/daily/${digest.date}/feynman`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ explanation: feynText }),
      });
      const dd = await res.json();
      if (dd.error) throw new Error(dd.error);
      setFeyn(dd);
    } catch (e) { setMsg(`Feynman: ${e instanceof Error ? e.message : e}`); }
    finally { setFeynBusy(false); }
  };

  const getExplain = async () => {
    if (!digest?.date || explainBusy) return;
    setExplainBusy(true);
    try {
      const res = await fetch(`/api/daily/${digest.date}/explain`, { method: "POST" });
      const dd = await safeJson(res);
      if (dd.error) setMsg(`Explainer: ${dd.error}`);
      else setExplain(dd.explanation as Explain);
    } catch (e) { setMsg(`Explainer: ${e instanceof Error ? e.message : e}`); }
    finally { setExplainBusy(false); }
  };

  const askFollowup = async (preset?: string) => {
    const q = (preset ?? followQ).trim();
    if (!digest?.date || q.length < 3 || followBusy) return;
    setFollowBusy(true); if (!preset) setFollowQ("");
    // Optimistically show the learner's turn.
    setFollowThread((t) => [...t, { role: "user", content: q }]);
    try {
      const res = await fetch(`/api/daily/${digest.date}/followup`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }),
      });
      const dd = await safeJson(res);
      setFollowThread((t) => [...t, { role: "assistant", content: dd.error ? `${dd.error}` : String(dd.answer || "") }]);
    } catch (e) {
      setFollowThread((t) => [...t, { role: "assistant", content: `Error: ${e instanceof Error ? e.message : e}` }]);
    } finally { setFollowBusy(false); }
  };
  const checkCode = async () => {
    if (!digest?.date || codeText.trim().length < 5) return;
    setCodeBusy(true); setCodeResult(null);
    try {
      const res = await fetch(`/api/daily/${digest.date}/check-code`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ code: codeText }),
      });
      const dd = await res.json();
      if (!dd.error) setCodeResult(dd);
      else setMsg(`Code check: ${dd.error}`);
    } finally { setCodeBusy(false); }
  };
  const runCode = async () => {
    if (codeText.trim().length < 3 || runBusy) return;
    setRunBusy(true); setRunOut({ out: "Booting Python runtime… (first run downloads ~6 MB)", err: false });
    try {
      const py = await loadPyodideOnce();
      const buf: string[] = [];
      py.setStdout({ batched: (s) => buf.push(s) });
      py.setStderr({ batched: (s) => buf.push(s) });
      try {
        await py.runPythonAsync(codeText);
        setRunOut({ out: buf.join("\n").trimEnd() || "(ran with no output)", err: false });
      } catch (execErr) {
        const trace = execErr instanceof Error ? execErr.message : String(execErr);
        setRunOut({ out: (buf.join("\n") + "\n" + trace).trim(), err: true });
      }
    } catch (e) {
      setRunOut({ out: e instanceof Error ? e.message : String(e), err: true });
    } finally { setRunBusy(false); }
  };
  const saveNote = async (text?: string) => {
    if (!digest?.date) return;
    const res = await fetch(`/api/daily/${digest.date}/save-note`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: text || "" }),
    });
    const dd = await res.json().catch(() => ({}));
    setMsg(res.ok ? (dd.kind === "highlight" ? "Highlight saved to your knowledge base." : "Full lesson saved to notes.") : "Couldn't save note.");
    if (text) setHighlight("");
  };
  const searchNotes = async () => {
    if (noteQ.trim().length < 2) return;
    setNoteSearchBusy(true);
    try {
      const res = await fetch(`/api/study/notes/search?q=${encodeURIComponent(noteQ.trim())}`);
      const dd = await res.json();
      setNoteHits(dd.results || []);
    } finally { setNoteSearchBusy(false); }
  };
  const exportFlashcards = () => {
    const tok = getToken();
    window.open(`/api/study/flashcards/export${tok ? `?token=${encodeURIComponent(tok)}` : ""}`, "_blank");
  };
  const weeklyRecap = async () => {
    setRecapBusy(true); setRecap(null);
    try {
      const res = await fetch("/api/study/weekly-recap", { method: "POST" });
      const dd = await res.json();
      if (!dd.error) setRecap(dd); else setMsg(`Recap: ${dd.error}`);
    } finally { setRecapBusy(false); }
  };

  const d = digest;
  const hasDigest = d && !d.empty;
  const lesson = hasDigest && d!.digest_text ? cleanLesson(d!.digest_text) : "";
  const verdictColor = (v: string) => v === "correct" ? "#a3e635" : v === "partial" ? "#ffd6a3" : "#ffb4ab";

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass-panel rounded-2xl border border-[#8aebff]/20 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#8aebff]/10 border border-[#8aebff]/30 flex items-center justify-center">
              <Newspaper className="w-5.5 h-5.5 text-[#8aebff]" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono glow-cyan">Daily AI Update</h1>
              <p className="text-xs text-[#859397] mt-1 leading-relaxed max-w-xl">
                Fresh AI news + today's concept, mini-project and a self-test — in the console.
                WhatsApp only when you tap send.
              </p>
            </div>
          </div>
          <button onClick={generate} disabled={generating}
            className="bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50">
            <RefreshCw className={`w-4.5 h-4.5 ${generating ? "animate-spin" : ""}`} />
            {generating ? "GENERATING…" : hasDigest ? "REGENERATE" : "GENERATE TODAY"}
          </button>
        </div>
        {msg && <div className="mt-3 text-[11px] font-mono text-[#8aebff] bg-[#8aebff]/5 border border-[#8aebff]/15 rounded-lg px-3 py-2">{msg}</div>}
      </div>

      {/* Study track */}
      <div className="glass-panel rounded-2xl border border-[#a3e635]/15 p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-2.5">
            <GraduationCap className="w-5 h-5 text-[#a3e635]" />
            <div>
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono block">Study track</span>
              <span className="text-sm font-bold text-[#dfe2f3]">{track.progress ? track.progress.name : "Free choice (any topic)"}</span>
            </div>
          </div>
          <select
            value={track.active}
            onChange={(e) => selectTrack(e.target.value)}
            className="bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2 text-xs font-mono text-[#dfe2f3] outline-none focus:border-[#a3e635]/50 cursor-pointer"
          >
            <option value="">Free choice (any topic)</option>
            {tracks.map((t) => (
              <option key={t.key} value={t.key}>{t.name} ({t.total})</option>
            ))}
          </select>
        </div>
        {track.progress && (
          <div className="mt-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[#859397]">{track.progress.completed} / {track.progress.total} concepts</span>
              {track.progress.next && <span className="text-[#a3e635] truncate ml-3">Next: {track.progress.next}</span>}
            </div>
            <div className="h-1.5 rounded-full bg-white/5 overflow-hidden">
              <div className="h-full rounded-full bg-[#a3e635]/70" style={{ width: `${Math.round((track.progress.completed / Math.max(1, track.progress.total)) * 100)}%` }} />
            </div>
          </div>
        )}

        {/* Progress stats */}
        {stats && (
          <div className="mt-4 pt-4 border-t border-white/5 grid grid-cols-2 sm:grid-cols-4 gap-3">
            {([
              [Flame, stats.streak, "day streak", "#ffb4ab"],
              [Layers, stats.concepts_learned, "concepts", "#8aebff"],
              [Target, stats.avg_recall ?? "—", "avg recall", "#a3e635"],
              [Repeat, stats.reviews_due, "due to review", "#ffd6a3"],
            ] as [typeof Flame, number | string, string, string][]).map(([Icon, val, label], i) => (
              <div key={i} className="flex items-center gap-2">
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: label === "avg recall" && stats.avg_recall === null ? "#859397" : (label as string) === "day streak" ? "#ffb4ab" : undefined }} />
                <div className="leading-tight">
                  <span className="block text-lg font-extrabold font-mono text-[#dfe2f3]">{val}</span>
                  <span className="block text-[9px] uppercase tracking-wider text-[#859397] font-mono -mt-0.5">{label}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reviews due + weakest concepts */}
      {(reviews && (reviews.due_count > 0 || reviews.upcoming.length > 0)) || (stats && stats.mastery.length > 0) ? (
        <div className="glass-panel rounded-2xl border border-[#ffd6a3]/15 p-5 sm:p-6 space-y-3">
          <div className="flex items-center gap-2"><Repeat className="w-4.5 h-4.5 text-[#ffd6a3]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Spaced review</span></div>
          {reviews && reviews.due_count > 0 && (
            <div className="text-[12px] text-[#ffd6a3] bg-[#ffd6a3]/5 border border-[#ffd6a3]/15 rounded-lg px-3 py-2">
              <span className="font-bold">{reviews.due_count} concept{reviews.due_count > 1 ? "s" : ""} due for review.</span> Your next update will resurface {reviews.due_count > 1 ? "them" : "it"} before new material.
            </div>
          )}
          {reviews && reviews.upcoming.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Upcoming reviews</span>
              {reviews.upcoming.slice(0, 5).map((r) => (
                <div key={r.concept} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-[#bbc9cd] truncate mr-3">{r.concept}</span>
                  <span className="text-[#859397] flex-shrink-0">{r.next_due}</span>
                </div>
              ))}
            </div>
          )}
          {stats && stats.mastery.length > 0 && (
            <div className="space-y-1 pt-1">
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Weakest recall — worth revisiting</span>
              {stats.mastery.slice(0, 5).map((m) => (
                <div key={m.concept} className="flex items-center justify-between text-[11px] font-mono">
                  <span className="text-[#bbc9cd] truncate mr-3">{m.concept}</span>
                  <span className="flex-shrink-0 font-bold" style={{ color: m.score >= 70 ? "#a3e635" : m.score >= 40 ? "#ffd6a3" : "#ffb4ab" }}>{m.score}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {loading ? (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm">Loading…</div>
      ) : !hasDigest ? (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm space-y-2">
          <p>No update yet today.</p>
          <p className="text-[11px]">Tap <span className="text-[#8aebff]">GENERATE TODAY</span> — it pulls fresh AI news and builds your lesson (~20-40s).</p>
        </div>
      ) : (
        <>
          {/* How to study today — dismissible, clickable 4-step flow */}
          {showHint && (
            <div className="glass-panel rounded-2xl border border-[#8aebff]/20 p-4 sm:p-5">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] uppercase tracking-widest text-[#8aebff] font-mono font-bold">How to study today</span>
                <button onClick={dismissHint} title="Got it — hide this" className="text-[#859397] hover:text-[#dfe2f3] cursor-pointer"><XCircle className="w-4 h-4" /></button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {([
                  [BookOpen, "Read", "the concept + lesson", "daily-read"],
                  [MessageCircleQuestion, "Ask", "“Go deeper” until it clicks", "daily-ask"],
                  [Play, "Run", "the code / check your own", "daily-run"],
                  [Brain, "Recall", "quiz + explain it back", "daily-recall"],
                ] as [typeof BookOpen, string, string, string][]).map(([Icon, title, sub, id], i) => (
                  <button key={id} onClick={() => scrollToId(id)}
                    className="text-left rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.06] hover:border-[#8aebff]/25 p-3 transition-all cursor-pointer group">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-mono font-bold text-[#8aebff]">{i + 1}</span>
                      <Icon className="w-3.5 h-3.5 text-[#8aebff]" />
                      <span className="text-[12px] font-bold text-[#dfe2f3]">{title}</span>
                    </div>
                    <p className="text-[10px] text-[#859397] mt-1 leading-snug group-hover:text-[#bbc9cd]">{sub}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Concept */}
          <div id="daily-read" className="glass-panel rounded-2xl border border-[#8aebff]/15 p-5 sm:p-6 scroll-mt-24">
            <div className="flex items-center gap-2 mb-1"><BookOpen className="w-4 h-4 text-[#8aebff]" /><span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Today's concept</span></div>
            <h2 className="text-lg font-bold text-[#dfe2f3]">{d!.concept}</h2>
            {d!.pedagogical_focus && <p className="text-[13px] text-[#bbc9cd] leading-relaxed mt-1">{d!.pedagogical_focus}</p>}
          </div>

          {/* Deep dive — full, from-scratch explainer of the concept */}
          <div className="glass-panel rounded-2xl border border-[#8aebff]/15 p-5 sm:p-6 space-y-4">
            <div className="flex items-center gap-2"><GraduationCap className="w-4.5 h-4.5 text-[#8aebff]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Understand this topic</span><span className="text-[10px] text-[#859397]">— the full explainer, from scratch</span></div>
            {!explain ? (
              <div className="space-y-2.5">
                <p className="text-[12px] text-[#859397] leading-relaxed">
                  Get a proper, from-scratch explanation of <span className="text-[#dfe2f3] font-semibold">{d!.concept}</span> — plain language, an analogy, a worked example, key points and common pitfalls. Read this first, then ask JARVIS anything below.
                </p>
                <button onClick={getExplain} disabled={explainBusy}
                  className="px-4 py-2 rounded-lg text-xs font-bold font-mono text-[#0a0e1a] bg-[#8aebff] hover:bg-[#a5f0ff] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2">
                  {explainBusy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Writing your explainer…</> : <><BookOpen className="w-3.5 h-3.5" /> Explain this topic in detail</>}
                </button>
              </div>
            ) : (
              <div className="space-y-4" onMouseUp={captureSelection} onTouchEnd={captureSelection}>
                <p className="text-[13px] text-[#dfe2f3] leading-relaxed selection:bg-[#8aebff]/30">{explain.tldr}</p>
                {explain.analogy && (
                  <div className="flex items-start gap-2 p-3 rounded-lg bg-[#ffd6a3]/5 border border-[#ffd6a3]/15">
                    <Lightbulb className="w-4 h-4 text-[#ffd6a3] mt-0.5 flex-shrink-0" />
                    <p className="text-[12px] text-[#bbc9cd] leading-relaxed selection:bg-[#8aebff]/30"><span className="text-[#ffd6a3] font-semibold">Think of it like: </span>{explain.analogy.replace(/^\s*think of (it )?(like|as)?[:,]?\s*/i, "")}</p>
                  </div>
                )}
                {explain.sections?.map((s, i) => (
                  <div key={i}>
                    <h3 className="text-[13px] font-bold text-[#8aebff]">{s.heading}</h3>
                    <p className="text-[12px] text-[#bbc9cd] leading-relaxed mt-1 selection:bg-[#8aebff]/30">{s.body}</p>
                  </div>
                ))}
                {explain.example && (explain.example.caption || explain.example.code) && (
                  <div className="rounded-lg border border-white/10 overflow-hidden">
                    <div className="px-3 py-2 bg-white/5 text-[10px] uppercase tracking-wider font-mono text-[#a3e635] flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5" /> Worked example</div>
                    {explain.example.caption && <p className="px-3 py-2 text-[12px] text-[#bbc9cd] leading-relaxed">{explain.example.caption}</p>}
                    {explain.example.code && <pre className="px-3 pb-3 overflow-x-auto text-[11px] font-mono text-[#a3e635] leading-relaxed whitespace-pre-wrap">{explain.example.code}</pre>}
                  </div>
                )}
                {(explain.key_points?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Key points</span>
                    <ul className="mt-1 space-y-1">{explain.key_points!.map((k, i) => (<li key={i} className="flex items-start gap-1.5 text-[12px] text-[#dfe2f3] leading-relaxed"><CheckCircle2 className="w-3.5 h-3.5 text-[#a3e635] mt-0.5 flex-shrink-0" />{k}</li>))}</ul>
                  </div>
                )}
                {(explain.pitfalls?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Common pitfalls</span>
                    <ul className="mt-1 space-y-1">{explain.pitfalls!.map((p, i) => (<li key={i} className="flex items-start gap-1.5 text-[12px] text-[#bbc9cd] leading-relaxed"><AlertCircle className="w-3.5 h-3.5 text-[#ffb4ab] mt-0.5 flex-shrink-0" />{p}</li>))}</ul>
                  </div>
                )}
                {explain.quick_check?.q && (
                  <div className="p-3 rounded-lg bg-[#a3e635]/5 border border-[#a3e635]/20 space-y-2">
                    <div className="flex items-center gap-1.5"><Brain className="w-3.5 h-3.5 text-[#a3e635]" /><span className="text-[10px] uppercase tracking-wider text-[#a3e635] font-mono font-bold">Quick check — can you answer this?</span></div>
                    <p className="text-[12px] text-[#dfe2f3] leading-relaxed">{explain.quick_check.q}</p>
                    {checkOpen ? (
                      <p className="text-[12px] text-[#bbc9cd] leading-relaxed border-l-2 border-[#a3e635]/40 pl-2">{explain.quick_check.a}</p>
                    ) : (
                      <button onClick={() => setCheckOpen(true)} className="px-2.5 py-1 rounded-lg text-[10px] font-mono text-[#a3e635] bg-[#a3e635]/10 border border-[#a3e635]/30 hover:bg-[#a3e635]/20 cursor-pointer">Reveal answer</button>
                    )}
                  </div>
                )}
                <p className="text-[10px] text-[#859397]/70 font-mono pt-1">Still unclear on anything? Use “Go deeper” below to ask JARVIS.</p>
              </div>
            )}
          </div>

          {/* News */}
          {d!.news && d!.news.length > 0 && (
            <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center gap-2"><Newspaper className="w-4 h-4 text-[#8aebff]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">AI news today</span></div>
              <div className="divide-y divide-white/5">
                {d!.news.map((n, i) => (
                  <a key={i} href={n.url} target="_blank" rel="noreferrer" className="block p-4 sm:px-6 hover:bg-white/5 transition-colors group">
                    <div className="flex items-start gap-2">
                      <span className="text-[#8aebff] font-mono text-xs mt-0.5">{i + 1}.</span>
                      <div className="min-w-0">
                        <p className="text-[13px] text-[#dfe2f3] font-semibold group-hover:text-[#8aebff] flex items-center gap-1">{n.title || n.url}<ExternalLink className="w-3 h-3 opacity-50 flex-shrink-0" /></p>
                        {n.snippet && <p className="text-[11px] text-[#859397] leading-relaxed mt-0.5 line-clamp-2">{n.snippet}</p>}
                      </div>
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Today's lesson — learning prose only (news lives in the cards above + Home strip) */}
          {lesson && (
            <div className="glass-panel rounded-2xl border border-white/10 p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Today's lesson</span>
                <span className="text-[9px] text-[#859397]/70 font-mono flex items-center gap-1"><Sparkles className="w-3 h-3" /> select any text to save it</span>
              </div>
              <pre onMouseUp={captureSelection} onTouchEnd={captureSelection} className="mt-2 text-[12px] text-[#dfe2f3] leading-relaxed whitespace-pre-wrap font-sans selection:bg-[#8aebff]/30">{lesson}</pre>
            </div>
          )}

          {/* Active recall — quiz + Feynman */}
          <div id="daily-recall" className="glass-panel rounded-2xl border border-[#8aebff]/15 p-5 sm:p-6 space-y-4 scroll-mt-24">
            <div className="flex items-center gap-2"><Brain className="w-4.5 h-4.5 text-[#8aebff]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Test your recall</span><span className="text-[10px] text-[#859397]">— reading is passive; recall is what sticks</span></div>

            {/* Quiz */}
            {!quiz ? (
              <button onClick={startQuiz} disabled={quizBusy}
                className="px-4 py-2 rounded-lg text-xs font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {quizBusy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Building quiz…</> : <><Brain className="w-3.5 h-3.5" /> Start recall quiz</>}
              </button>
            ) : (
              <div className="space-y-3">
                {quiz.map((q, i) => (
                  <div key={i} className="space-y-1.5">
                    <p className="text-[13px] text-[#dfe2f3] font-semibold flex gap-2"><span className="text-[#8aebff] font-mono">{i + 1}.</span>{q.q}</p>
                    <textarea
                      value={answers[i] || ""}
                      onChange={(e) => setAnswers((a) => { const n = [...a]; n[i] = e.target.value; return n; })}
                      disabled={!!grade}
                      placeholder="Your answer…"
                      className="w-full bg-[#0a0e1a]/50 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-[#dfe2f3] font-sans outline-none focus:border-[#8aebff]/40 resize-y min-h-[52px] disabled:opacity-70"
                    />
                    {grade?.items?.[i] && (
                      <div className="flex items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: verdictColor(grade.items[i].verdict) }}>
                        {grade.items[i].verdict === "correct" ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : grade.items[i].verdict === "partial" ? <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> : <XCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />}
                        <span><span className="uppercase font-bold mr-1">{grade.items[i].verdict}</span><span className="text-[#bbc9cd]">{grade.items[i].explanation}</span></span>
                      </div>
                    )}
                  </div>
                ))}
                {!grade ? (
                  <button onClick={submitQuiz} disabled={quizBusy}
                    className="px-4 py-2 rounded-lg text-xs font-bold font-mono text-[#0a0e1a] bg-[#8aebff] hover:bg-[#a5f0ff] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2">
                    {quizBusy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Grading…</> : <>Submit answers</>}
                  </button>
                ) : (
                  <div className="flex items-center gap-3 pt-1">
                    <span className="text-2xl font-extrabold font-mono" style={{ color: grade.overall >= 70 ? "#a3e635" : grade.overall >= 40 ? "#ffd6a3" : "#ffb4ab" }}>{grade.overall}</span>
                    <span className="text-[10px] text-[#859397] uppercase tracking-widest">recall score</span>
                  </div>
                )}
              </div>
            )}

            {/* Feynman */}
            <div className="pt-3 border-t border-white/5 space-y-2">
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Explain it back (Feynman)</span>
              <textarea
                value={feynText}
                onChange={(e) => setFeynText(e.target.value)}
                placeholder="In 2-3 sentences, explain today's concept in your own words…"
                className="w-full bg-[#0a0e1a]/50 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-[#dfe2f3] font-sans outline-none focus:border-[#8aebff]/40 resize-y min-h-[60px]"
              />
              <button onClick={checkFeynman} disabled={feynBusy || feynText.trim().length < 10}
                className="px-4 py-2 rounded-lg text-xs font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {feynBusy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Checking…</> : <>Check my understanding</>}
              </button>
              {feyn && (
                <div className="p-3 rounded-lg bg-white/5 border border-white/5 space-y-2 text-[12px]">
                  <span className="text-[10px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border" style={{ color: feyn.rating === "solid" ? "#a3e635" : feyn.rating === "partial" ? "#ffd6a3" : "#ffb4ab", borderColor: "currentColor" }}>{feyn.rating}</span>
                  {feyn.feedback && <p className="text-[#dfe2f3] leading-relaxed">{feyn.feedback}</p>}
                  {feyn.missing?.length > 0 && (
                    <div><span className="text-[10px] uppercase tracking-wider text-[#ffd6a3]">You missed</span>
                      <ul className="mt-1 space-y-1">{feyn.missing.map((m, i) => (<li key={i} className="flex items-start gap-1.5 text-[#bbc9cd] leading-relaxed"><span className="text-[#ffd6a3]">·</span>{m}</li>))}</ul>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Go deeper — threaded follow-up chat + try-it code (run in-browser or LLM review) */}
          <div id="daily-ask" className="glass-panel rounded-2xl border border-white/10 p-5 sm:p-6 space-y-4 scroll-mt-24">
            <div className="flex items-center gap-2"><MessageCircleQuestion className="w-4.5 h-4.5 text-[#8aebff]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Go deeper</span><span className="text-[10px] text-[#859397]">— a running conversation about this concept</span></div>
            <div className="space-y-2">
              {followThread.length > 0 && (
                <div ref={threadRef} className="max-h-72 overflow-y-auto space-y-2.5 pr-1">
                  {followThread.map((t, i) => (
                    <div key={i} className={`flex gap-2 ${t.role === "user" ? "flex-row-reverse" : ""}`}>
                      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${t.role === "user" ? "bg-[#8aebff]/15 border border-[#8aebff]/30" : "bg-white/5 border border-white/10"}`}>
                        {t.role === "user" ? <User className="w-3 h-3 text-[#8aebff]" /> : <Bot className="w-3 h-3 text-[#a3e635]" />}
                      </div>
                      <div className={`text-[12px] leading-relaxed rounded-lg px-3 py-2 max-w-[85%] ${t.role === "user" ? "bg-[#8aebff]/10 border border-[#8aebff]/15 text-[#dfe2f3]" : "bg-white/5 border border-white/5 text-[#bbc9cd]"}`}>{t.role === "assistant" ? <RichText text={t.content} /> : t.content}</div>
                    </div>
                  ))}
                  {followBusy && <div className="flex gap-2"><div className="w-6 h-6 rounded-full bg-white/5 border border-white/10 flex items-center justify-center mt-0.5"><Bot className="w-3 h-3 text-[#a3e635]" /></div><p className="text-[12px] text-[#859397] italic px-3 py-2">thinking…</p></div>}
                </div>
              )}
              <div className="flex gap-2">
                <input value={followQ} onChange={(e) => setFollowQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && askFollowup()}
                  placeholder={followThread.length ? "Ask another — it remembers the thread…" : "Ask a follow-up about today's concept…"}
                  className="flex-1 bg-[#0a0e1a]/50 border border-white/10 rounded-lg px-3 py-2 text-[12px] text-[#dfe2f3] font-sans outline-none focus:border-[#8aebff]/40" />
                <button onClick={() => askFollowup()} disabled={followBusy || followQ.trim().length < 3}
                  className="px-3 py-2 rounded-lg text-xs font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 cursor-pointer disabled:opacity-50">{followBusy ? "…" : "Ask"}</button>
              </div>
              {/* Tappable prompts — keeps it interactive, one tap to dig deeper */}
              <div className="flex flex-wrap gap-1.5">
                {FOLLOWUP_CHIPS.map((c) => (
                  <button key={c} onClick={() => askFollowup(c)} disabled={followBusy}
                    className="px-2.5 py-1 rounded-full text-[10px] font-mono text-[#8aebff] bg-[#8aebff]/5 border border-[#8aebff]/20 hover:bg-[#8aebff]/15 cursor-pointer disabled:opacity-50 transition-colors">{c}</button>
                ))}
              </div>
            </div>
            <div id="daily-run" className="space-y-2 pt-2 border-t border-white/5 scroll-mt-24">
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono flex items-center gap-1.5"><Code2 className="w-3.5 h-3.5" /> Try it — today's example is loaded; run it, tweak it, or write your own</span>
              <textarea value={codeText} onChange={(e) => setCodeText(e.target.value)} placeholder="# today's runnable example loads here — press Run, or edit it"
                spellCheck={false}
                className="w-full bg-[#0a0e1a]/50 border border-white/10 rounded-lg px-3 py-2 text-[11.5px] text-[#a3e635] font-mono outline-none focus:border-[#8aebff]/40 resize-y min-h-[90px]" />
              <div className="flex items-center gap-2 flex-wrap">
                <button onClick={runCode} disabled={runBusy || codeText.trim().length < 3}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold font-mono text-[#0a0e1a] bg-[#a3e635] hover:bg-[#b6f24d] cursor-pointer disabled:opacity-50 flex items-center gap-1.5">
                  {runBusy ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> Running…</> : <><Play className="w-3.5 h-3.5" /> Run (Python)</>}
                </button>
                <button onClick={checkCode} disabled={codeBusy || codeText.trim().length < 5}
                  className="px-3 py-1.5 rounded-lg text-xs font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 cursor-pointer disabled:opacity-50">{codeBusy ? "Checking…" : "Check my code (AI)"}</button>
              </div>
              {runOut && (
                <div className="rounded-lg overflow-hidden border border-white/10">
                  <div className="px-3 py-1.5 bg-white/5 text-[9px] uppercase tracking-wider font-mono flex items-center gap-1.5" style={{ color: runOut.err ? "#ffb4ab" : "#a3e635" }}>{runOut.err ? <XCircle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />} output</div>
                  <pre className="p-3 overflow-x-auto text-[11px] leading-relaxed font-mono bg-[#0a0e1a]/70 whitespace-pre-wrap" style={{ color: runOut.err ? "#ffb4ab" : "#dfe2f3" }}>{runOut.out}</pre>
                </div>
              )}
              {codeResult && (
                <div className="flex items-start gap-1.5 text-[12px] leading-relaxed p-3 rounded-lg bg-white/5 border border-white/5" style={{ color: codeResult.passed ? "#a3e635" : "#ffb4ab" }}>
                  {codeResult.passed ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                  <span><span className="font-bold uppercase mr-1">{codeResult.passed ? "Looks right" : "Not quite"}</span><span className="text-[#bbc9cd]">{codeResult.feedback}</span></span>
                </div>
              )}
            </div>
          </div>

          {/* Knowledge base — save the full lesson + search everything you've saved */}
          <div className="glass-panel rounded-2xl border border-white/10 p-5 sm:p-6 space-y-3">
            <div className="flex items-center gap-2"><StickyNote className="w-4.5 h-4.5 text-[#8aebff]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Your knowledge base</span><span className="text-[10px] text-[#859397]">— saved lessons + highlights, searchable</span></div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-[#859397] absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={noteQ} onChange={(e) => setNoteQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && searchNotes()}
                  placeholder="Search everything you've saved…"
                  className="w-full bg-[#0a0e1a]/50 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-[12px] text-[#dfe2f3] font-sans outline-none focus:border-[#8aebff]/40" />
              </div>
              <button onClick={searchNotes} disabled={noteSearchBusy || noteQ.trim().length < 2}
                className="px-3 py-2 rounded-lg text-xs font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 cursor-pointer disabled:opacity-50">{noteSearchBusy ? "…" : "Search"}</button>
            </div>
            {noteHits !== null && (
              noteHits.length === 0
                ? <p className="text-[11px] text-[#859397] font-mono">No matches — highlight lesson text or hit “Save full lesson” to build your base.</p>
                : <div className="space-y-1.5">
                    {noteHits.map((h) => (
                      <div key={h.id} className="p-2.5 rounded-lg bg-white/5 border border-white/5">
                        <p className="text-[12px] text-[#dfe2f3] font-semibold">{h.title}</p>
                        <p className="text-[11px] text-[#859397] leading-relaxed mt-0.5">{h.snippet}</p>
                      </div>
                    ))}
                  </div>
            )}
          </div>

          {/* Extras toolbar */}
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => saveNote()} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer flex items-center gap-1.5"><StickyNote className="w-3.5 h-3.5" /> Save full lesson</button>
            <button onClick={exportFlashcards} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export flashcards (Anki)</button>
            <button onClick={weeklyRecap} disabled={recapBusy} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer disabled:opacity-50 flex items-center gap-1.5"><CalendarRange className="w-3.5 h-3.5" /> {recapBusy ? "Building…" : "Weekly recap"}</button>
          </div>
          {recap && (
            <div className="glass-panel rounded-2xl border border-[#a3e635]/15 p-5 sm:p-6 space-y-3">
              <div className="flex items-center gap-2"><CalendarRange className="w-4.5 h-4.5 text-[#a3e635]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Weekly recap</span></div>
              <p className="text-[13px] text-[#dfe2f3] leading-relaxed">{recap.recap}</p>
              {recap.quiz?.length > 0 && (
                <div><span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Mixed recall</span>
                  <ol className="mt-1 space-y-1">{recap.quiz.map((q, i) => (<li key={i} className="flex items-start gap-2 text-[12px] text-[#bbc9cd]"><span className="text-[#a3e635] font-mono">{i + 1}.</span>{q}</li>))}</ol>
                </div>
              )}
            </div>
          )}

          {/* Difficulty + actions */}
          <div className="glass-panel rounded-2xl border border-white/10 p-5 sm:p-6 flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono mr-1">Was this</span>
              {([["E", "Too easy", Smile], ["J", "Just right", Meh], ["H", "Too hard", Frown]] as [string, string, typeof Smile][]).map(([r, label, Icon]) => (
                <button key={r} onClick={() => rate(r as "E" | "J" | "H")}
                  className={`px-3 py-1.5 rounded-lg text-[11px] font-mono border transition-all cursor-pointer flex items-center gap-1.5 ${d!.difficulty === r ? "border-[#8aebff] text-[#8aebff] bg-[#8aebff]/10" : "border-white/10 text-[#859397] hover:text-[#dfe2f3]"}`}>
                  <Icon className="w-3.5 h-3.5" />{label}
                </button>
              ))}
            </div>
            <button onClick={sendWhatsApp} disabled={sending || d!.sent_whatsapp}
              className={`px-4 py-2 rounded-lg text-xs font-bold font-mono flex items-center gap-2 transition-all cursor-pointer disabled:opacity-60 ${d!.sent_whatsapp ? "text-[#a3e635] bg-[#a3e635]/10 border border-[#a3e635]/30" : "text-[#25D366] bg-[#25D366]/10 border border-[#25D366]/40 hover:bg-[#25D366]/20"}`}>
              {d!.sent_whatsapp ? <><CheckCircle2 className="w-4 h-4" /> Sent to WhatsApp</> : sending ? <><RefreshCw className="w-4 h-4 animate-spin" /> Sending…</> : <><Send className="w-4 h-4" /> Send to WhatsApp</>}
            </button>
          </div>

          {/* History */}
          {history.length > 1 && (
            <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center gap-2"><History className="w-4 h-4 text-[#859397]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Past updates</span></div>
              <div className="divide-y divide-white/5">
                {history.map((h) => (
                  <button key={h.date} onClick={() => loadDay(h.date)}
                    className={`w-full text-left p-3.5 sm:px-6 hover:bg-white/5 transition-colors flex items-center justify-between gap-3 cursor-pointer ${d!.date === h.date ? "bg-[#8aebff]/5" : ""}`}>
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="text-[10px] font-mono text-[#859397] flex-shrink-0">{h.date}</span>
                      <span className="text-[12px] text-[#dfe2f3] truncate">{h.concept}</span>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {h.difficulty && <span className="text-[9px] font-mono text-[#859397] border border-white/10 rounded px-1">{h.difficulty}</span>}
                      {h.sent_whatsapp && <CheckCircle2 className="w-3 h-3 text-[#a3e635]" />}
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* Floating "save highlight" bar — appears when you select lesson text */}
      {highlight && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3 max-w-[92vw] bg-[#0f131f]/95 backdrop-blur-md border border-[#8aebff]/40 rounded-xl px-4 py-3 shadow-[0_0_24px_rgba(138,235,255,0.2)]">
          <Sparkles className="w-4 h-4 text-[#8aebff] flex-shrink-0" />
          <span className="text-[12px] text-[#bbc9cd] truncate max-w-[46vw]">“{highlight}”</span>
          <button onClick={() => saveNote(highlight)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#0a0e1a] bg-[#8aebff] hover:bg-[#a5f0ff] cursor-pointer flex items-center gap-1.5 flex-shrink-0"><StickyNote className="w-3.5 h-3.5" /> Save highlight</button>
          <button onClick={() => setHighlight("")} className="text-[#859397] hover:text-[#dfe2f3] cursor-pointer flex-shrink-0"><XCircle className="w-4 h-4" /></button>
        </div>
      )}
    </div>
  );
}
