import { useEffect, useState, useCallback } from "react";
import {
  Newspaper, RefreshCw, ExternalLink, BookOpen, Hammer, Code2, Send,
  CheckCircle2, Smile, Meh, Frown, History,
} from "lucide-react";

interface NewsItem { title: string; url: string; snippet: string; }
interface Project { project_title?: string; subtask_title?: string; subtask_description?: string; day_number?: number; }
interface Digest {
  empty?: boolean;
  date?: string;
  concept?: string;
  pedagogical_focus?: string;
  news?: NewsItem[];
  project?: Project;
  digest_text?: string;
  reference_code?: string;
  difficulty?: string | null;
  sent_whatsapp?: boolean;
}
interface HistRow { date: string; concept: string; difficulty: string | null; sent_whatsapp: boolean; }

export default function DailyUpdate() {
  const [digest, setDigest] = useState<Digest | null>(null);
  const [history, setHistory] = useState<HistRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState("");

  const loadDay = useCallback(async (d?: string) => {
    const r = await fetch(d ? `/api/daily/${d}` : "/api/daily/today");
    if (r.ok) setDigest(await r.json());
  }, []);

  const loadAll = useCallback(async () => {
    try {
      const [, hRes] = await Promise.all([loadDay(), fetch("/api/daily/history")]);
      if (hRes.ok) setHistory((await hRes.json()).history || []);
    } finally { setLoading(false); }
  }, [loadDay]);

  useEffect(() => { loadAll(); }, [loadAll]);

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

  const d = digest;
  const hasDigest = d && !d.empty;

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

      {loading ? (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm">Loading…</div>
      ) : !hasDigest ? (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm space-y-2">
          <p>No update yet today.</p>
          <p className="text-[11px]">Tap <span className="text-[#8aebff]">GENERATE TODAY</span> — it pulls fresh AI news and builds your lesson (~20-40s).</p>
        </div>
      ) : (
        <>
          {/* Concept */}
          <div className="glass-panel rounded-2xl border border-[#8aebff]/15 p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-1"><BookOpen className="w-4 h-4 text-[#8aebff]" /><span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Today's concept</span></div>
            <h2 className="text-lg font-bold text-[#dfe2f3]">{d!.concept}</h2>
            {d!.pedagogical_focus && <p className="text-[13px] text-[#bbc9cd] leading-relaxed mt-1">{d!.pedagogical_focus}</p>}
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

          {/* Mini-project */}
          {d!.project && (d!.project.project_title || d!.project.subtask_title) && (
            <div className="glass-panel rounded-2xl border border-[#a3e635]/15 p-5 sm:p-6">
              <div className="flex items-center gap-2 mb-1.5"><Hammer className="w-4 h-4 text-[#a3e635]" /><span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Mini-project{d!.project.day_number ? ` · day ${d!.project.day_number}` : ""}</span></div>
              {d!.project.project_title && <p className="text-[13px] text-[#a3e635] font-semibold">{d!.project.project_title}</p>}
              {d!.project.subtask_title && <p className="text-[13px] text-[#dfe2f3] font-semibold mt-1.5">▹ {d!.project.subtask_title}</p>}
              {d!.project.subtask_description && <p className="text-[12px] text-[#bbc9cd] leading-relaxed mt-1">{d!.project.subtask_description}</p>}
            </div>
          )}

          {/* Full digest text */}
          {d!.digest_text && (
            <div className="glass-panel rounded-2xl border border-white/10 p-5 sm:p-6">
              <span className="text-[10px] uppercase tracking-wider text-[#859397] font-mono">Briefing</span>
              <pre className="mt-2 text-[12px] text-[#dfe2f3] leading-relaxed whitespace-pre-wrap font-sans">{d!.digest_text.replace(/\*/g, "")}</pre>
            </div>
          )}

          {/* Reference code */}
          {d!.reference_code && (
            <div className="glass-panel rounded-2xl border border-white/10 overflow-hidden">
              <div className="px-6 py-3 border-b border-white/5 bg-white/5 flex items-center gap-2"><Code2 className="w-4 h-4 text-[#8aebff]" /><span className="text-xs font-extrabold text-[#dfe2f3] uppercase tracking-wide font-mono">Reference implementation</span></div>
              <pre className="p-5 overflow-x-auto text-[11.5px] leading-relaxed font-mono text-[#a3e635] bg-[#0a0e1a]/50">{d!.reference_code}</pre>
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
    </div>
  );
}
