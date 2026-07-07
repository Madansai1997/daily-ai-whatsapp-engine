import { useEffect, useState, useCallback } from "react";
import {
  FlaskConical, RefreshCw, TrendingUp, Star, Hammer, X, ChevronDown, ChevronUp,
  MessageSquare, ExternalLink,
} from "lucide-react";

interface Quote { text: string; url: string; }
interface Idea {
  id: number;
  title: string;
  pain: string;
  summary: string;
  frequency: number;
  competition: number;   // higher = less competition = better
  monetization: number;
  total_score: number;
  sources: string[];
  quotes: Quote[];
  status: "new" | "shortlisted" | "building" | "dismissed";
}
interface Stats { signals: number; ideas: number; shortlisted: number; youtube_enabled: boolean; }

const scoreColor = (s: number) =>
  s >= 70 ? { text: "#a3e635", bg: "#a3e635" }
    : s >= 45 ? { text: "#ffd6a3", bg: "#ffd6a3" }
      : { text: "#ffb4ab", bg: "#ffb4ab" };

const FILTERS = [
  { key: "", label: "All" },
  { key: "shortlisted", label: "Shortlisted" },
  { key: "building", label: "Building" },
  { key: "new", label: "New" },
] as const;

export default function TrendLab() {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [scanMsg, setScanMsg] = useState("");
  const [filter, setFilter] = useState<string>("");
  const [expanded, setExpanded] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const [iRes, sRes] = await Promise.all([
        fetch(`/api/trends${filter ? `?status=${filter}` : ""}`),
        fetch("/api/trends/stats"),
      ]);
      if (iRes.ok) setIdeas((await iRes.json()).ideas || []);
      if (sRes.ok) setStats(await sRes.json());
    } catch { /* leave */ } finally { setLoading(false); }
  }, [filter]);

  useEffect(() => { load(); }, [load]);

  const scan = async () => {
    setScanning(true); setScanMsg("");
    try {
      const res = await fetch("/api/trends/scan", { method: "POST" });
      const d = await res.json();
      if (!res.ok || d?.ok === false) throw new Error(d?.error || `HTTP ${res.status}`);
      const parts = [`${d.new_signals ?? 0} new signal(s)`, `${d.ideas_created ?? 0} new idea(s)`];
      if (!d.reddit && !d.youtube) parts.push("— 0 fetched: set Reddit / YouTube keys (see Help).");
      setScanMsg(parts.join(" · "));
      await load();
    } catch (e) { setScanMsg(`Scan failed: ${e instanceof Error ? e.message : e}`); }
    finally { setScanning(false); }
  };

  const setStatus = async (id: number, status: string) => {
    setIdeas((prev) => prev.map((i) => (i.id === id ? { ...i, status: status as Idea["status"] } : i)));
    try {
      await fetch(`/api/trends/${id}/status`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
    } finally { if (filter) load(); }
  };

  const Bar = ({ label, val }: { label: string; val: number }) => (
    <div className="flex items-center gap-2">
      <span className="text-[9px] font-mono uppercase tracking-wider text-[#859397] w-24 shrink-0">{label}</span>
      <div className="flex-1 h-1.5 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full" style={{ width: `${Math.max(3, val)}%`, backgroundColor: "#8aebff88" }} />
      </div>
      <span className="text-[10px] font-mono text-[#bbc9cd] w-7 text-right">{val}</span>
    </div>
  );

  return (
    <div className="w-full max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="glass-panel rounded-2xl border border-[#8aebff]/20 p-6 sm:p-8">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-[#8aebff]/10 border border-[#8aebff]/30 flex items-center justify-center">
              <FlaskConical className="w-5.5 h-5.5 text-[#8aebff]" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono glow-cyan">
                Trend Lab
              </h1>
              <p className="text-xs text-[#859397] mt-1 leading-relaxed max-w-xl">
                App ideas mined from Reddit + YouTube, scored by demand, competition and
                monetisation. Build the top of the list.
              </p>
            </div>
          </div>
          <button
            onClick={scan}
            disabled={scanning}
            className="bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-4.5 h-4.5 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "SCANNING…" : "SCAN NOW"}
          </button>
        </div>

        {/* Stats + filters */}
        <div className="mt-5 flex items-center gap-2 flex-wrap font-mono text-[10px]">
          {stats && (
            <>
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[#bbc9cd]">{stats.signals} signals</span>
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[#bbc9cd]">{stats.ideas} ideas</span>
              <span className="px-2 py-1 rounded bg-white/5 border border-white/10 text-[#a3e635]">{stats.shortlisted} shortlisted</span>
              <span className={`px-2 py-1 rounded border ${stats.youtube_enabled ? "bg-[#a3e635]/10 border-[#a3e635]/20 text-[#a3e635]" : "bg-white/5 border-white/10 text-[#859397]"}`}>
                YouTube {stats.youtube_enabled ? "on" : "off"}
              </span>
            </>
          )}
          <div className="flex-1" />
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded border transition-all cursor-pointer ${
                filter === f.key ? "border-[#8aebff] text-[#8aebff] bg-[#8aebff]/10" : "border-white/10 text-[#859397] hover:text-[#dfe2f3]"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
        {scanMsg && (
          <div className="mt-3 text-[11px] font-mono text-[#8aebff] bg-[#8aebff]/5 border border-[#8aebff]/15 rounded-lg px-3 py-2">
            {scanMsg}
          </div>
        )}
      </div>

      {/* Ideas */}
      {loading ? (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm">
          Loading ideas…
        </div>
      ) : ideas.length === 0 ? (
        <div className="glass-panel rounded-2xl border border-white/10 p-8 text-center text-[#859397] font-mono text-sm space-y-2">
          <p>No ideas yet.</p>
          <p className="text-[11px]">Hit <span className="text-[#8aebff]">SCAN NOW</span> — needs a Reddit app + (optional) YouTube key. See <span className="text-[#8aebff]">Help</span> for the 2-minute setup.</p>
        </div>
      ) : (
        ideas.map((idea) => {
          const c = scoreColor(idea.total_score);
          const open = expanded === idea.id;
          return (
            <div
              key={idea.id}
              className={`glass-panel rounded-2xl border overflow-hidden transition-all ${
                idea.status === "dismissed" ? "border-white/5 opacity-50" : "border-white/10"
              }`}
            >
              <div className="p-5 sm:p-6">
                <div className="flex items-start gap-4">
                  {/* Score */}
                  <div className="flex flex-col items-center flex-shrink-0 w-14">
                    <span className="text-3xl font-extrabold font-mono leading-none" style={{ color: c.text }}>
                      {idea.total_score}
                    </span>
                    <span className="text-[8px] font-mono text-[#859397] uppercase tracking-widest mt-1">score</span>
                  </div>
                  {/* Body */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <h3 className="text-[#dfe2f3] font-bold text-base">{idea.title}</h3>
                      {idea.sources.map((s) => (
                        <span key={s} className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[#859397]">{s}</span>
                      ))}
                      {idea.status !== "new" && (
                        <span className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-[#8aebff]/30 bg-[#8aebff]/10 text-[#8aebff]">{idea.status}</span>
                      )}
                    </div>
                    {idea.pain && <p className="text-[13px] text-[#bbc9cd] leading-relaxed mb-1"><span className="text-[#859397]">Pain: </span>{idea.pain}</p>}
                    {idea.summary && <p className="text-[12px] text-[#859397] leading-relaxed">{idea.summary}</p>}

                    <div className="mt-3 space-y-1.5 max-w-md">
                      <Bar label="Demand" val={Math.min(100, idea.frequency * 18)} />
                      <Bar label="Open market" val={idea.competition} />
                      <Bar label="Monetization" val={idea.monetization} />
                    </div>

                    {/* Evidence toggle */}
                    {idea.quotes.length > 0 && (
                      <button
                        onClick={() => setExpanded(open ? null : idea.id)}
                        className="mt-3 text-[11px] font-mono text-[#8aebff] hover:underline flex items-center gap-1 cursor-pointer"
                      >
                        <MessageSquare className="w-3 h-3" /> {idea.quotes.length} evidence quote(s)
                        {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                      </button>
                    )}
                    {open && (
                      <div className="mt-2 space-y-2">
                        {idea.quotes.map((q, i) => (
                          <div key={i} className="text-[11px] text-[#bbc9cd] bg-white/5 border border-white/5 rounded-lg p-2.5 leading-relaxed">
                            “{q.text}”
                            {q.url && (
                              <a href={q.url} target="_blank" rel="noreferrer" className="ml-2 text-[#8aebff] inline-flex items-center gap-0.5 hover:underline">
                                source <ExternalLink className="w-3 h-3" />
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="mt-4 flex items-center gap-2 flex-wrap">
                      <button onClick={() => setStatus(idea.id, "shortlisted")} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#a3e635] bg-[#a3e635]/10 border border-[#a3e635]/30 hover:bg-[#a3e635]/20 transition-all cursor-pointer flex items-center gap-1.5"><Star className="w-3 h-3" /> Shortlist</button>
                      <button onClick={() => setStatus(idea.id, "building")} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 transition-all cursor-pointer flex items-center gap-1.5"><Hammer className="w-3 h-3" /> Building</button>
                      <button onClick={() => setStatus(idea.id, "dismissed")} className="px-3 py-1.5 rounded-lg text-[11px] font-semibold font-mono text-[#ffb4ab] bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 hover:bg-[#ffb4ab]/20 transition-all cursor-pointer flex items-center gap-1.5"><X className="w-3 h-3" /> Dismiss</button>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })
      )}

      <p className="text-center text-[11px] text-[#859397] font-mono pb-4 flex items-center justify-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" /> Scores: 40% demand · 30% open market · 30% monetisation.
      </p>
    </div>
  );
}
