import { useEffect, useState, useCallback } from "react";
import {
  FlaskConical, RefreshCw, TrendingUp, Star, Hammer, X, ChevronDown, ChevronUp,
  MessageSquare, ExternalLink, FileText, Activity, Lightbulb, Radio, Globe,
} from "lucide-react";

interface PulseItem { type: string; title: string; summary: string; url: string; source: string; domain: string; score: number; when: string; }

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
  has_brief?: boolean;
  created_at?: string;
}

// Relative age of a discovery, and whether it's "fresh" (found in the last ~36h). This is about
// WHEN a trend was discovered — distinct from `status` (a workflow state that's also called "new").
const ideaAge = (ts?: string): { label: string; fresh: boolean } => {
  if (!ts) return { label: "", fresh: false };
  const d = new Date(ts);
  const s = (Date.now() - d.getTime()) / 1000;
  if (isNaN(s)) return { label: "", fresh: false };
  const fresh = s <= 36 * 3600;
  let label = "just now";
  if (s >= 86400) label = `${Math.floor(s / 86400)}d ago`;
  else if (s >= 3600) label = `${Math.floor(s / 3600)}h ago`;
  else if (s >= 60) label = `${Math.floor(s / 60)}m ago`;
  return { label, fresh };
};
interface Brief {
  mvp_features: string[];
  stack: string[];
  differentiator: string;
  monetization: string;
  v1_scope: string;
  first_steps: string[];
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
  const [briefFor, setBriefFor] = useState<Idea | null>(null);
  const [brief, setBrief] = useState<Brief | null>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState("");

  // Live Google Search Grounding for Market Validation
  const [activeBriefTab, setActiveBriefTab] = useState<"brief" | "market">("brief");
  const [validationData, setValidationData] = useState<any | null>(null);
  const [validationLoading, setValidationLoading] = useState(false);
  const [validationError, setValidationError] = useState("");

  const openMarketValidation = async (idea: Idea, force = false) => {
    setActiveBriefTab("market");
    setValidationData(null);
    setValidationError("");
    setValidationLoading(true);
    try {
      if (!force) {
        const check = await fetch(`/api/trends/${idea.id}/market-validation`);
        if (check.ok) {
          setValidationData(await check.json());
          return;
        }
      }
      const res = await fetch(`/api/trends/${idea.id}/market-validation`, { method: "POST" });
      const d = await res.json();
      if (!res.ok || d.error) throw new Error(d.error || "Failed to generate market validation");
      setValidationData(d);
    } catch (err: any) {
      setValidationError(err.message || String(err));
    } finally {
      setValidationLoading(false);
    }
  };
  // Unified cross-source pulse (Trend Lab ideas + influencer feed)
  const [pulse, setPulse] = useState<PulseItem[]>([]);
  const [pulseOpen, setPulseOpen] = useState(false);
  const [pulseLoading, setPulseLoading] = useState(false);

  const loadPulse = useCallback(async () => {
    setPulseLoading(true);
    try { const d = await fetch("/api/trends/pulse", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)); setPulse(d?.items || []); }
    catch { setPulse([]); } finally { setPulseLoading(false); }
  }, []);
  const togglePulse = () => { const n = !pulseOpen; setPulseOpen(n); if (n && pulse.length === 0) loadPulse(); };

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
      const src = [d.reddit && `${d.reddit} reddit`, d.youtube && `${d.youtube} youtube`, d.hackernews && `${d.hackernews} HN`].filter(Boolean);
      if (src.length) parts.push(`(${src.join(" · ")})`);
      else parts.push("— 0 fetched: check Help for source setup.");
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

  const openBrief = async (idea: Idea, forceNew = false) => {
    setActiveBriefTab("brief");
    setBriefFor(idea);
    setBrief(null);
    setBriefError("");
    setBriefLoading(true);
    try {
      // Use the cached brief if one exists and we're not regenerating.
      if (idea.has_brief && !forceNew) {
        const g = await fetch(`/api/trends/${idea.id}/brief`);
        if (g.ok) { setBrief(await g.json()); return; }
      }
      const res = await fetch(`/api/trends/${idea.id}/brief`, { method: "POST" });
      const d = await res.json();
      if (!res.ok || d?.error) throw new Error(d?.error || `HTTP ${res.status}`);
      setBrief(d as Brief);
      setIdeas((prev) => prev.map((i) => (i.id === idea.id ? { ...i, has_brief: true } : i)));
    } catch (e) {
      setBriefError(e instanceof Error ? e.message : String(e));
    } finally { setBriefLoading(false); }
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
          <div className="flex items-center gap-2">
            <button
              onClick={togglePulse}
              className={`px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all cursor-pointer border ${pulseOpen ? "bg-[#a3e635]/15 border-[#a3e635]/40 text-[#a3e635]" : "bg-white/5 border-white/10 text-[#bbc9cd] hover:bg-white/10"}`}
              title="Cross-source pulse: Trend Lab ideas + your influencer feed in one ranked view"
            >
              <Activity className="w-4.5 h-4.5" /> PULSE
            </button>
            <button
              onClick={scan}
              disabled={scanning}
              className="bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] px-4 py-2.5 rounded-lg text-sm font-bold flex items-center gap-2 transition-all cursor-pointer disabled:opacity-50"
            >
              <RefreshCw className={`w-4.5 h-4.5 ${scanning ? "animate-spin" : ""}`} />
              {scanning ? "SCANNING…" : "SCAN NOW"}
            </button>
          </div>
        </div>

        {/* Unified cross-source pulse */}
        {pulseOpen && (
          <div className="mt-5 rounded-xl border border-[#a3e635]/20 bg-[#a3e635]/[0.03] p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[11px] font-mono uppercase tracking-widest text-[#a3e635] flex items-center gap-1.5"><Activity className="w-3.5 h-3.5" /> What's hot — ideas + creators</span>
              <button onClick={loadPulse} className="text-[10px] font-mono text-[#859397] hover:text-[#a3e635] cursor-pointer flex items-center gap-1"><RefreshCw className={`w-3 h-3 ${pulseLoading ? "animate-spin" : ""}`} /> refresh</button>
            </div>
            {pulseLoading ? (
              <p className="text-[11px] font-mono text-[#859397] py-4 text-center">Loading pulse…</p>
            ) : pulse.length === 0 ? (
              <p className="text-[11px] font-mono text-[#859397] py-4 text-center">No signals yet — run a Trend scan or sync your influencer feeds.</p>
            ) : (
              <div className="space-y-1.5 max-h-[420px] overflow-y-auto">
                {pulse.map((it, i) => (
                  <div key={i} className="flex items-start gap-2.5 p-2.5 rounded-lg bg-white/[0.02] border border-white/5 hover:border-white/15 transition-colors group">
                    <span className={`mt-0.5 shrink-0 w-6 h-6 rounded flex items-center justify-center ${it.type === "idea" ? "bg-[#8aebff]/10 text-[#8aebff]" : "bg-[#a3e635]/10 text-[#a3e635]"}`} title={it.type}>
                      {it.type === "idea" ? <Lightbulb className="w-3.5 h-3.5" /> : <Radio className="w-3.5 h-3.5" />}
                    </span>
                    <div className="min-w-0 flex-1">
                      {it.url ? (
                        <a href={it.url} target="_blank" rel="noreferrer" className="text-[12px] text-[#dfe2f3] font-medium group-hover:text-[#a3e635] flex items-start gap-1"><span className="min-w-0">{it.title}</span><ExternalLink className="w-3 h-3 opacity-40 shrink-0 mt-0.5" /></a>
                      ) : (
                        <p className="text-[12px] text-[#dfe2f3] font-medium">{it.title}</p>
                      )}
                      {it.summary && <p className="text-[10px] text-[#859397] leading-relaxed mt-0.5 line-clamp-1">{it.summary}</p>}
                      <span className="text-[9px] font-mono text-[#5c6a6d] uppercase">{it.source}</span>
                    </div>
                    <span className="shrink-0 text-[10px] font-mono font-bold text-[#8aebff] mt-0.5">{it.score}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

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
                      {(() => { const a = ideaAge(idea.created_at); return a.fresh ? (
                        <span className="text-[8px] font-mono font-bold uppercase tracking-wide px-1.5 py-0.5 rounded border border-[#a3e635]/40 bg-[#a3e635]/15 text-[#a3e635] flex items-center gap-1">
                          <span className="w-1.5 h-1.5 rounded-full bg-[#a3e635] animate-pulse" /> JUST FOUND
                        </span>
                      ) : null; })()}
                      <h3 className="text-[#dfe2f3] font-bold text-base">{idea.title}</h3>
                      {idea.sources.map((s) => (
                        <span key={s} className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-white/10 bg-white/5 text-[#859397]">{s}</span>
                      ))}
                      {idea.status !== "new" && (
                        <span className="text-[8px] font-mono uppercase tracking-wide px-1.5 py-0.5 rounded border border-[#8aebff]/30 bg-[#8aebff]/10 text-[#8aebff]">{idea.status}</span>
                      )}
                      {idea.created_at && (
                        <span className="text-[9px] font-mono text-[#859397]/70 ml-auto">{ideaAge(idea.created_at).label}</span>
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
                      <button onClick={() => openBrief(idea)} className="px-3 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#22d3ee] bg-[#22d3ee]/10 border border-[#22d3ee]/40 hover:bg-[#22d3ee]/20 transition-all cursor-pointer flex items-center gap-1.5"><FileText className="w-3 h-3" /> {idea.has_brief ? "Build Brief" : "Build Brief"}</button>
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

      {/* Build Brief modal */}
      {briefFor && (
        <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4" onClick={() => setBriefFor(null)}>
          <div className="w-full max-w-2xl glass-panel rounded-2xl border border-[#22d3ee]/30 shadow-2xl max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            {/* Tabs Header */}
            <div className="flex border-b border-white/5 font-mono text-xs px-5 bg-black/20">
              <button
                onClick={() => setActiveBriefTab("brief")}
                className={`px-5 py-3 border-b-2 font-bold tracking-wider transition-all cursor-pointer ${
                  activeBriefTab === "brief"
                    ? "border-[#22d3ee] text-[#22d3ee] bg-[#22d3ee]/5"
                    : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                }`}
              >
                BUILD BRIEF
              </button>
              <button
                onClick={() => openMarketValidation(briefFor)}
                className={`px-5 py-3 border-b-2 font-bold tracking-wider transition-all cursor-pointer flex items-center gap-1.5 ${
                  activeBriefTab === "market"
                    ? "border-[#c084fc] text-[#c084fc] bg-[#c084fc]/5"
                    : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                }`}
              >
                <Globe className="w-3.5 h-3.5" /> LIVE MARKET SCAN
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 font-mono text-xs flex-1">
              {activeBriefTab === "brief" ? (
                <>
                  {briefLoading && (
                    <div className="flex items-center gap-2 text-[#22d3ee] py-8 justify-center"><RefreshCw className="w-4 h-4 animate-spin" /> Drafting your MVP plan…</div>
                  )}
                  {!briefLoading && briefError && (
                    <div className="p-4 rounded-lg bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 text-[#ffb4ab]">{briefError}
                      <button onClick={() => openBrief(briefFor, true)} className="ml-3 underline cursor-pointer">Retry</button>
                    </div>
                  )}
                  {!briefLoading && brief && (
                    <>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#22d3ee]">MVP features (v1)</span>
                        <ul className="mt-1.5 space-y-1">
                          {brief.mvp_features?.map((f, i) => (
                            <li key={i} className="flex items-start gap-2 text-[#dfe2f3]"><span className="text-[#22d3ee]">▹</span>{f}</li>
                          ))}
                        </ul>
                      </div>
                      <div>
                        <span className="text-[10px] uppercase tracking-wider text-[#859397]">Stack (free-tier)</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {brief.stack?.map((s, i) => (
                            <span key={i} className="px-2 py-0.5 rounded border border-white/10 bg-white/5 text-[#bbc9cd]">{s}</span>
                          ))}
                        </div>
                      </div>
                      {brief.differentiator && (
                        <div><span className="text-[10px] uppercase tracking-wider text-[#859397]">Differentiator</span><p className="mt-1 text-[#dfe2f3] leading-relaxed">{brief.differentiator}</p></div>
                      )}
                      {brief.monetization && (
                        <div><span className="text-[10px] uppercase tracking-wider text-[#a3e635]">Monetisation</span><p className="mt-1 text-[#dfe2f3] leading-relaxed">{brief.monetization}</p></div>
                      )}
                      {brief.v1_scope && (
                        <div className="p-3 rounded-lg bg-[#22d3ee]/5 border border-[#22d3ee]/15"><span className="text-[10px] uppercase tracking-wider text-[#22d3ee]">Ship first (v1 scope)</span><p className="mt-1 text-[#dfe2f3] leading-relaxed">{brief.v1_scope}</p></div>
                      )}
                      {brief.first_steps?.length > 0 && (
                        <div>
                          <span className="text-[10px] uppercase tracking-wider text-[#859397]">First 3 steps</span>
                          <ol className="mt-1.5 space-y-1">
                            {brief.first_steps.map((s, i) => (
                              <li key={i} className="flex items-start gap-2 text-[#dfe2f3]"><span className="flex-shrink-0 w-4 h-4 rounded-full bg-[#22d3ee]/15 text-[#22d3ee] text-[9px] font-bold flex items-center justify-center mt-0.5">{i + 1}</span>{s}</li>
                            ))}
                          </ol>
                        </div>
                      )}
                      <div className="pt-1">
                        <button onClick={() => openBrief(briefFor, true)} className="text-[11px] text-[#8aebff] hover:underline flex items-center gap-1 cursor-pointer"><RefreshCw className="w-3 h-3" /> Regenerate</button>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-white/5 pb-2">
                    <span className="text-[10px] uppercase tracking-wider text-[#c084fc]">Market Analysis & Competitor Intel</span>
                    <button
                      onClick={() => openMarketValidation(briefFor, true)}
                      disabled={validationLoading}
                      className="px-2.5 py-1 rounded text-[10px] font-bold bg-[#c084fc]/20 border border-[#c084fc]/40 text-[#c084fc] hover:bg-[#c084fc]/30 cursor-pointer disabled:opacity-50"
                    >
                      RE-SCAN MARKET
                    </button>
                  </div>

                  {validationLoading ? (
                    <div className="py-12 text-center text-xs text-[#859397] space-y-2">
                      <RefreshCw className="w-6 h-6 animate-spin text-[#c084fc] mx-auto" />
                      <p>Searching Google Search, GitHub, and competitor listings...</p>
                    </div>
                  ) : validationError ? (
                    <div className="p-3 rounded bg-red-950/20 border border-red-500/20 text-red-200 text-xs">
                      {validationError}
                    </div>
                  ) : validationData ? (
                    <div className="space-y-4">
                      <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">
                        {validationData.validation}
                      </div>

                      {validationData.citations && validationData.citations.length > 0 && (
                        <div className="space-y-2 border-t border-white/5 pt-3">
                          <h4 className="text-[10px] uppercase font-bold text-[#c084fc]">Grounded Sources found:</h4>
                          <div className="flex flex-wrap gap-2">
                            {validationData.citations.map((c: any, idx: number) => (
                              <a
                                key={idx}
                                href={c.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="px-2.5 py-1 rounded bg-[#c084fc]/10 border border-[#c084fc]/20 text-[10px] text-[#c084fc] hover:bg-[#c084fc]/20 flex items-center gap-1"
                              >
                                {c.title}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="py-8 text-center text-xs text-[#859397]">
                      Click "RE-SCAN MARKET" to search Google Grounding for competitor analysis.
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <p className="text-center text-[11px] text-[#859397] font-mono pb-4 flex items-center justify-center gap-1.5">
        <TrendingUp className="w-3.5 h-3.5" /> Scores: 40% demand · 30% open market · 30% monetisation.
      </p>
    </div>
  );
}
