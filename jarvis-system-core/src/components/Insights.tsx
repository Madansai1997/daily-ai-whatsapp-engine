import React, { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  RefreshCw, Activity, Cpu, TerminalSquare, Plus, X,
  CircuitBoard, Database, Clock, Zap, ShieldCheck, AlertTriangle, Eye,
} from "lucide-react";

interface Agent {
  name: string; total: number; errors: number;
  last_run?: string; last_status?: string; health: "ok" | "error";
  last_message?: string; severity?: string; traceback?: string; attempt?: number;
}
interface Analytics {
  days: number;
  activity: { day: string; messages: number; jobs: number; errors: number }[];
  agents: Agent[];
  success_rate: number;
  llm_by_day: Record<string, any>[];
  llm_totals: { provider: string; calls: number }[];
  llm_models: { model: string; calls: number }[];
  llm_total_calls: number;
  llm_today: number;
  fallback_rate: number;
  prompts_by_hour: { hour: string; count: number }[];
  pipeline: { status: string; count: number }[];
  dev_by_day: Record<string, any>[];
  dev_totals: { tool: string; tokens: number; cost: number; mins: number; sessions: number }[];
  totals: { messages: number; job_runs: number; errors: number; applications: number; ats_runs: number; ats_avg: number };
}
interface Metrics {
  memory: { rss_mb: number; limit_mb: number; pct: number; status: string };
  uptime: string; errors_24h: number; agents: number;
  patterns_learned: number; db: string; scheduler_mode: string;
}

const CYAN = "#8aebff", AMBER = "#ffd6a3", GREEN = "#5eead4", LIME = "#a3e635", RED = "#ffb4ab", MUTED = "#859397", PURPLE = "#c084fc";
const TOOL_COLORS: Record<string, string> = { "claude-code": CYAN, antigravity: PURPLE };
const tip = { background: "#0f131f", border: "1px solid #3c494c", borderRadius: 8, fontFamily: "monospace", fontSize: 12, color: "#dfe2f3" };

const relTime = (ts?: string) => {
  if (!ts) return "never";
  const d = new Date(ts.includes("T") ? ts : ts.replace(" ", "T") + "Z");
  const s = (Date.now() - d.getTime()) / 1000;
  if (isNaN(s)) return "—";
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

function Panel({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass-panel rounded-xl border border-white/5 p-5 ${className}`}>
      <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-4">
        {icon} {title}
      </h3>
      {children}
    </div>
  );
}

export default function Insights() {
  const [data, setData] = useState<Analytics | null>(null);
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [skillGap, setSkillGap] = useState<{ analyzed_jobs: number; skills: { skill: string; demand: number; have: number; gap: number; coverage: number }[]; top_gaps: { skill: string; demand: number; gap: number }[] } | null>(null);
  const [funnel, setFunnel] = useState<{ funnel: { stage: string; count: number }[]; rejected: number; applied_total: number; response_rate: number; responded_total: number; avg_response_days: number | null; ghost_rate: number; ghosted: number; ghost_days: number; sources: { source: string; applied: number; responded: number; yield: number }[] } | null>(null);
  const [freshness, setFreshness] = useState<{ id: number; name: string; url?: string; days_since: number | null; interval_days: number; status: string; auto: boolean }[] | null>(null);
  const [shield, setShield] = useState<{ checked: number; clear: boolean; buffer_min: number; conflicts: { a: string; b: string; when: string; interview_involved: boolean }[]; unbuffered: { summary: string; when: string; issues: string[] }[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [logOpen, setLogOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const todayStr = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({ tool: "claude-code", day: todayStr, tokens: "", cost: "", duration_min: "", note: "" });

  const [diagAgent, setDiagAgent] = useState<any | null>(null);
  const [retryingJob, setRetryingJob] = useState<string | null>(null);

  const handleManualRetry = async (jobName: string) => {
    setRetryingJob(jobName);
    try {
      const res = await fetch("/api/run-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: jobName }),
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || `HTTP ${res.status}`);
      alert(`Triggered retry for ${jobName}!`);
      setDiagAgent(null); // close modal on success
      await load(true); // reload telemetry
    } catch (e) {
      alert(`Retry failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setRetryingJob(null);
    }
  };

  const markFresh = async (assetId: number) => {
    try {
      const res = await fetch(`/api/profile-freshness/${assetId}/updated`, { method: "POST" });
      const data = await res.json();
      if (data?.assets) setFreshness(data.assets);
    } catch { /* ignore */ }
  };

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [a, m, sg, fn, pf, cs] = await Promise.all([
        fetch("/api/analytics", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/system-metrics", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/skill-gap", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/response-analytics", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/profile-freshness", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
        fetch("/api/calendar-shield", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)),
      ]);
      if (a) setData(a);
      if (m) setMetrics(m);
      if (sg) setSkillGap(sg);
      if (fn) setFunnel(fn);
      if (pf?.assets) setFreshness(pf.assets);
      if (cs) setShield(cs);
    } catch { /* keep last */ } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (!document.hidden) {
        load(true); // silent refresh in background
      }
    }, 8000);
    return () => clearInterval(timer);
  }, [load]);

  const saveSession = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/dev-usage", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setLogOpen(false);
      setForm({ tool: "claude-code", day: todayStr, tokens: "", cost: "", duration_min: "", note: "" });
      await load();
    } catch (e) { alert(`Couldn't log session: ${e instanceof Error ? e.message : e}`); } finally { setSaving(false); }
  };

  const memPct = metrics?.memory?.pct ?? 0;
  const memColor = memPct >= 85 ? RED : memPct >= 65 ? AMBER : GREEN;
  const sr = data?.success_rate ?? 100;
  const srColor = sr >= 95 ? GREEN : sr >= 80 ? AMBER : RED;
  const fb = data?.fallback_rate ?? 0;

  const hero = [
    { label: "STATUS", val: "ONLINE", color: GREEN, dot: true },
    { label: "UPTIME", val: metrics?.uptime ?? "—", color: CYAN },
    { label: "SUCCESS RATE", val: `${sr}%`, color: srColor },
    { label: "AGENTS", val: metrics?.agents ?? "—", color: CYAN },
    { label: "ERRORS 24H", val: metrics?.errors_24h ?? 0, color: (metrics?.errors_24h ?? 0) > 0 ? RED : GREEN },
    { label: "LLM FALLBACK", val: `${fb}%`, color: fb > 30 ? AMBER : GREEN },
  ];

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">05 //</span> SYSTEM INSIGHTS
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            Engine health · agents · LLM routing — last {data?.days ?? 14} days
          </p>
        </div>
        <div className="flex items-center gap-3 font-mono">
          <button onClick={() => setLogOpen(true)} className="flex items-center gap-2 px-5 py-2 bg-[#8aebff]/10 border border-[#8aebff]/30 rounded-lg text-xs font-semibold hover:bg-[#8aebff]/20 transition-all text-[#8aebff] cursor-pointer">
            <Plus className="w-4 h-4" /> LOG DEV SESSION
          </button>
          <button onClick={load} aria-label="Refresh" className="flex items-center justify-center w-10 h-10 bg-white/5 border border-white/10 rounded-lg text-[#859397] hover:text-[#8aebff] transition-all cursor-pointer">
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </section>

      {/* Hero status tiles */}
      <section className="grid grid-cols-2 md:grid-cols-6 gap-3">
        {hero.map((s) => (
          <div key={s.label} className="glass-panel rounded-xl border border-white/5 p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-0.5" style={{ background: s.color, opacity: 0.5 }} />
            <div className="flex items-center gap-2">
              {s.dot && <span className="w-2 h-2 rounded-full animate-pulse" style={{ background: s.color, boxShadow: `0 0 8px ${s.color}` }} />}
              <div className="text-xl font-bold font-mono truncate" style={{ color: s.color }}>{s.val}</div>
            </div>
            <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest mt-1">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Memory + Agent health */}
      <section className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Panel title="Memory" icon={<CircuitBoard className="w-4 h-4" />}>
          <div className="flex items-end justify-between mb-2">
            <div className="text-4xl font-bold font-mono" style={{ color: memColor }}>{memPct}<span className="text-lg text-[#859397]">%</span></div>
            <div className="text-right font-mono text-[11px] text-[#859397]">
              {metrics?.memory?.rss_mb ?? "—"} / {metrics?.memory?.limit_mb ?? "—"} MB
              <div className="uppercase tracking-widest text-[9px] mt-0.5" style={{ color: memColor }}>{metrics?.memory?.status ?? ""}</div>
            </div>
          </div>
          <div className="w-full h-3 rounded-full bg-white/5 overflow-hidden">
            <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, memPct)}%`, background: memColor, boxShadow: `0 0 10px ${memColor}88` }} />
          </div>
          <div className="grid grid-cols-3 gap-2 mt-5 text-center">
            {[
              { l: "DB", v: (metrics?.db || "—").toUpperCase(), i: <Database className="w-3.5 h-3.5" /> },
              { l: "SCHED", v: (metrics?.scheduler_mode || "—").toUpperCase(), i: <Clock className="w-3.5 h-3.5" /> },
              { l: "PATTERNS", v: metrics?.patterns_learned ?? 0, i: <Zap className="w-3.5 h-3.5" /> },
            ].map((x) => (
              <div key={x.l} className="bg-white/[0.03] border border-white/5 rounded-lg py-2">
                <div className="flex justify-center text-[#8aebff] mb-1">{x.i}</div>
                <div className="text-[11px] font-mono font-bold text-[#dfe2f3] truncate px-1">{x.v}</div>
                <div className="text-[8px] font-mono text-[#859397] uppercase tracking-widest">{x.l}</div>
              </div>
            ))}
          </div>
        </Panel>

        <Panel title="Agent / job health" icon={<Cpu className="w-4 h-4" />} className="lg:col-span-2">
          {(data?.agents?.length ?? 0) === 0 ? (
            <p className="text-sm text-[#859397] font-mono py-6 text-center">No agent runs logged yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {data!.agents.map((a) => {
                const c = a.health === "error" ? RED : GREEN;
                return (
                  <div key={a.name} className="flex items-center gap-3 bg-white/[0.03] border border-white/5 rounded-lg p-3 hover:border-white/10 transition-all">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: c, boxShadow: `0 0 8px ${c}` }} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-mono font-semibold text-[#dfe2f3] truncate flex items-center gap-1.5">
                        {a.name}
                        {(a.attempt ?? 1) > 1 && (
                          <span className="text-[9px] px-1 bg-amber-500/20 text-amber-300 rounded font-bold font-mono" title={`Attempt #${a.attempt}`}>
                            A{a.attempt}
                          </span>
                        )}
                        {a.severity && a.severity !== "info" && (
                          <span className={`text-[9px] px-1.5 rounded font-mono font-bold ${
                            a.severity === "critical" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300"
                          }`}>
                            {a.severity.toUpperCase()}
                          </span>
                        )}
                      </div>
                      <div className="text-[10px] font-mono text-[#859397] mt-0.5">
                        {a.total} run{a.total === 1 ? "" : "s"} · {a.errors} err · {relTime(a.last_run)}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setDiagAgent(a)}
                        className="p-1.5 bg-white/5 hover:bg-[#8aebff]/10 border border-white/5 hover:border-[#8aebff]/30 text-[#859397] hover:text-[#8aebff] rounded transition-all cursor-pointer"
                        title="View Diagnostics"
                      >
                        <Eye className="w-4 h-4" />
                      </button>
                      {a.health === "error"
                        ? <AlertTriangle className="w-4 h-4 text-[#ffb4ab] shrink-0" />
                        : <ShieldCheck className="w-4 h-4 text-[#5eead4] shrink-0" />}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Panel>
      </section>

      {/* Activity + LLM routing */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Activity — runs & errors" icon={<Activity className="w-4 h-4" />}>
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={data?.activity || []}>
              <defs>
                <linearGradient id="gJob" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={LIME} stopOpacity={0.5} /><stop offset="100%" stopColor={LIME} stopOpacity={0} /></linearGradient>
                <linearGradient id="gMsg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={CYAN} stopOpacity={0.4} /><stop offset="100%" stopColor={CYAN} stopOpacity={0} /></linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="day" tick={{ fill: MUTED, fontSize: 10, fontFamily: "monospace" }} />
              <YAxis tick={{ fill: MUTED, fontSize: 10, fontFamily: "monospace" }} allowDecimals={false} />
              <Tooltip contentStyle={tip} />
              <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 11 }} />
              <Area type="monotone" dataKey="jobs" stroke={LIME} fill="url(#gJob)" strokeWidth={2} name="Agent runs" />
              <Area type="monotone" dataKey="messages" stroke={CYAN} fill="url(#gMsg)" strokeWidth={2} name="Prompts" />
              <Area type="monotone" dataKey="errors" stroke={RED} fill="none" strokeWidth={2} name="Errors" />
            </AreaChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="LLM engine — models & fallback health" icon={<Zap className="w-4 h-4" />}>
          {(data?.llm_total_calls ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center h-[210px] text-center gap-2">
              <Zap className="w-8 h-8 text-[#8aebff]/40" />
              <p className="text-sm text-[#bbc9cd]">No LLM calls recorded yet.</p>
              <p className="text-[11px] font-mono text-[#859397] max-w-xs">Ask JARVIS anything — this shows which models answer and whether Groq ever falls back to Gemini.</p>
            </div>
          ) : (
            <>
              {/* Verdict + volume */}
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <div className="text-3xl font-bold font-mono text-[#dfe2f3]">{data!.llm_total_calls.toLocaleString()}</div>
                  <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest">LLM calls · {data!.days}d ({data!.llm_today} today)</div>
                </div>
                <div
                  className="px-3 py-2 rounded-lg border text-right"
                  style={{ borderColor: `${fb > 30 ? AMBER : GREEN}55`, background: `${fb > 30 ? AMBER : GREEN}12` }}
                >
                  <div className="text-lg font-bold font-mono" style={{ color: fb > 30 ? AMBER : GREEN }}>
                    {fb === 0 ? "✓ healthy" : `${fb}% fallback`}
                  </div>
                  <div className="text-[9px] font-mono text-[#859397] uppercase tracking-widest">
                    {fb === 0 ? "Groq handled all — no Gemini fallback" : `${data!.llm_totals.find((p) => p.provider === "gemini")?.calls ?? 0} calls fell back to Gemini`}
                  </div>
                </div>
              </div>
              {/* Which models answered */}
              <div className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mb-2">Models that answered</div>
              <div className="space-y-1.5">
                {data!.llm_models.map((m) => {
                  const pct = Math.round((100 * m.calls) / Math.max(1, data!.llm_total_calls));
                  const isGem = m.model.toLowerCase().includes("gemini");
                  const c = isGem ? PURPLE : CYAN;
                  return (
                    <div key={m.model} className="flex items-center gap-2">
                      <div className="w-40 text-[11px] font-mono text-[#dfe2f3] truncate" title={m.model}>{m.model}</div>
                      <div className="flex-1 h-4 rounded bg-white/5 overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${pct}%`, background: c, boxShadow: `0 0 8px ${c}66` }} />
                      </div>
                      <div className="w-16 text-right text-[11px] font-mono text-[#859397]">{m.calls} · {pct}%</div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </Panel>
      </section>

      {/* Busiest hours + Dev tools */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Busiest hours (prompts by hour)" icon={<Activity className="w-4 h-4" />}>
          <ResponsiveContainer width="100%" height={230}>
            <BarChart data={data?.prompts_by_hour || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
              <XAxis dataKey="hour" tick={{ fill: MUTED, fontSize: 9, fontFamily: "monospace" }} interval={1} />
              <YAxis tick={{ fill: MUTED, fontSize: 10, fontFamily: "monospace" }} allowDecimals={false} />
              <Tooltip contentStyle={tip} cursor={{ fill: "#ffffff08" }} />
              <Bar dataKey="count" fill={AMBER} name="Prompts" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Panel>

        <Panel title="AI coding tools — tokens/day" icon={<TerminalSquare className="w-4 h-4" />}>
          {(data?.dev_totals?.length ?? 0) === 0 ? (
            <div className="flex flex-col items-center justify-center h-[210px] text-center gap-2">
              <TerminalSquare className="w-8 h-8 text-[#8aebff]/40" />
              <p className="text-sm text-[#bbc9cd]">No dev-tool usage logged yet.</p>
              <p className="text-[11px] font-mono text-[#859397] max-w-xs">Log a Claude Code / Antigravity session with the button above, or run the push script.</p>
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={175}>
                <BarChart data={data?.dev_by_day || []}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff10" />
                  <XAxis dataKey="day" tick={{ fill: MUTED, fontSize: 9, fontFamily: "monospace" }} />
                  <YAxis tick={{ fill: MUTED, fontSize: 10, fontFamily: "monospace" }} />
                  <Tooltip contentStyle={tip} cursor={{ fill: "#ffffff08" }} />
                  <Legend wrapperStyle={{ fontFamily: "monospace", fontSize: 11 }} />
                  {(data?.dev_totals || []).map((t) => (
                    <Bar key={t.tool} dataKey={t.tool} stackId="a" fill={TOOL_COLORS[t.tool] || LIME} name={t.tool} radius={[2, 2, 0, 0]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
              <div className="flex flex-wrap gap-3 mt-3">
                {(data?.dev_totals || []).map((t) => (
                  <div key={t.tool} className="text-[11px] font-mono text-[#bbc9cd] flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full" style={{ background: TOOL_COLORS[t.tool] || LIME }} />
                    <b>{t.tool}</b>: {t.tokens > 0
                      ? `${t.tokens.toLocaleString()} tok · ${Math.round(t.mins)}m`
                      : `${Math.round(t.mins)}m active · ${t.sessions} ${t.sessions === 1 ? "day" : "days"}`}
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </section>

      <section className="grid grid-cols-1 gap-6">
        <Panel title="Application funnel — where things actually go" icon={<Activity className="w-4 h-4" />}>
          {!funnel || funnel.funnel[0]?.count === 0 ? (
            <div className="flex flex-col items-center justify-center h-[150px] text-center gap-2">
              <Activity className="w-8 h-8 text-[#8aebff]/40" />
              <p className="text-sm text-[#bbc9cd]">No pipeline data yet.</p>
              <p className="text-[11px] font-mono text-[#859397] max-w-xs">Track a few jobs and move them through the board — response rate, ghost rate and source yield build up here.</p>
            </div>
          ) : (
            <>
              {/* KPI row */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
                {[
                  { label: "Applied", val: funnel.applied_total, tone: CYAN },
                  { label: "Response rate", val: `${funnel.response_rate}%`, tone: GREEN, sub: `${funnel.responded_total} replied` },
                  { label: "Avg response", val: funnel.avg_response_days == null ? "—" : `${funnel.avg_response_days}d`, tone: AMBER },
                  { label: "Ghost rate", val: `${funnel.ghost_rate}%`, tone: RED, sub: `${funnel.ghosted} silent >${funnel.ghost_days}d` },
                ].map((k) => (
                  <div key={k.label} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                    <div className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">{k.label}</div>
                    <div className="text-2xl font-bold font-mono" style={{ color: k.tone }}>{k.val}</div>
                    {k.sub && <div className="text-[9px] font-mono text-[#859397] mt-0.5">{k.sub}</div>}
                  </div>
                ))}
              </div>
              {/* Funnel bars */}
              <div className="space-y-1.5 mb-4">
                {funnel.funnel.map((s) => {
                  const top = funnel.funnel[0]?.count || 1;
                  const pct = Math.round((s.count / top) * 100);
                  return (
                    <div key={s.stage} className="flex items-center gap-2">
                      <span className="w-24 shrink-0 text-xs font-mono text-[#dfe2f3] capitalize">{s.stage}</span>
                      <div className="flex-1 h-4 bg-white/5 rounded overflow-hidden">
                        <div className="h-full rounded" style={{ width: `${pct}%`, background: "linear-gradient(90deg,#8aebff,#5eead4)" }} />
                      </div>
                      <span className="w-8 shrink-0 text-right text-xs font-mono text-[#859397]">{s.count}</span>
                    </div>
                  );
                })}
                {funnel.rejected > 0 && (
                  <div className="text-[10px] font-mono text-[#ffb4ab] pt-1">+ {funnel.rejected} rejected</div>
                )}
              </div>
              {/* Source yield */}
              {funnel.sources.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mb-1.5">Which sources convert</div>
                  <div className="space-y-1">
                    {funnel.sources.map((s) => (
                      <div key={s.source} className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="w-28 shrink-0 text-[#dfe2f3] truncate" title={s.source}>{s.source}</span>
                        <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                          <div className="h-full rounded-full" style={{ width: `${s.yield}%`, background: s.yield >= 50 ? "#5eead4" : s.yield >= 20 ? "#fbbf24" : "#ffb4ab" }} />
                        </div>
                        <span className="w-24 shrink-0 text-right text-[#859397]">{s.responded}/{s.applied} · {s.yield}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </Panel>

        <Panel title="Skill gap — market demand vs your résumé" icon={<Activity className="w-4 h-4" />}>
          {!skillGap || skillGap.analyzed_jobs === 0 ? (
            <div className="flex flex-col items-center justify-center h-[150px] text-center gap-2">
              <Activity className="w-8 h-8 text-[#8aebff]/40" />
              <p className="text-sm text-[#bbc9cd]">No skill data yet.</p>
              <p className="text-[11px] font-mono text-[#859397] max-w-xs">Run ATS analysis on jobs in your board — the skills each JD demands are aggregated here vs what's on your résumé.</p>
            </div>
          ) : (
            <>
              <div className="text-[11px] font-mono text-[#859397] mb-3">
                Across {skillGap.analyzed_jobs} analysed {skillGap.analyzed_jobs === 1 ? "job" : "jobs"}
              </div>
              {skillGap.top_gaps.length > 0 && (
                <div className="mb-4">
                  <div className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mb-1.5">Biggest gaps — learn these next</div>
                  <div className="flex flex-wrap gap-1.5">
                    {skillGap.top_gaps.map((g) => (
                      <span key={g.skill} className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[#ffb4ab]/10 text-[#ffb4ab] border border-[#ffb4ab]/20">
                        {g.skill} · missing in {g.gap}/{g.demand}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto pr-1">
                {skillGap.skills.map((s) => (
                  <div key={s.skill} className="flex items-center gap-2">
                    <span className="w-28 shrink-0 text-xs font-mono text-[#dfe2f3] truncate" title={s.skill}>{s.skill}</span>
                    <div className="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${s.coverage}%`, background: s.coverage >= 67 ? "#5eead4" : s.coverage >= 34 ? "#fbbf24" : "#ffb4ab" }} />
                    </div>
                    <span className="w-20 shrink-0 text-right text-[10px] font-mono text-[#859397]">{s.have}/{s.demand} · {s.coverage}%</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </Panel>
      </section>

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Calendar Shield */}
        <Panel title="Calendar shield — schedule guard" icon={<ShieldCheck className="w-4 h-4" />}>
          {!shield ? (
            <div className="text-[11px] font-mono text-[#859397] py-6 text-center">Connect Google Calendar to guard your schedule.</div>
          ) : shield.clear ? (
            <div className="flex flex-col items-center justify-center h-[120px] text-center gap-2">
              <ShieldCheck className="w-8 h-8 text-[#5eead4]/60" />
              <p className="text-sm text-[#dfe2f3]">All clear.</p>
              <p className="text-[11px] font-mono text-[#859397]">Checked {shield.checked} upcoming events — no conflicts, no tight interviews.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {shield.conflicts.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono text-[#ffb4ab] uppercase tracking-widest mb-1.5">Double-booked</div>
                  <div className="space-y-1.5">
                    {shield.conflicts.map((c, i) => (
                      <div key={i} className="rounded-lg border border-[#ffb4ab]/20 bg-[#ffb4ab]/[0.04] p-2.5">
                        <div className="text-[12px] text-[#dfe2f3] flex items-center gap-1.5">
                          {c.interview_involved && <AlertTriangle className="w-3.5 h-3.5 text-[#ffb4ab] shrink-0" />}
                          <span className="truncate">“{c.a}” ↔ “{c.b}”</span>
                        </div>
                        <div className="text-[10px] font-mono text-[#859397] mt-0.5">{c.when}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {shield.unbuffered.length > 0 && (
                <div>
                  <div className="text-[10px] font-mono text-[#ffd6a3] uppercase tracking-widest mb-1.5">Interviews with no buffer ({shield.buffer_min}m)</div>
                  <div className="space-y-1.5">
                    {shield.unbuffered.map((u, i) => (
                      <div key={i} className="rounded-lg border border-[#ffd6a3]/20 bg-[#ffd6a3]/[0.04] p-2.5">
                        <div className="text-[12px] text-[#dfe2f3] truncate">{u.summary}</div>
                        <div className="text-[10px] font-mono text-[#859397] mt-0.5">{u.when} · {u.issues.join("; ")}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </Panel>

        {/* Profile freshness */}
        <Panel title="Profile freshness" icon={<Clock className="w-4 h-4" />}>
          {!freshness ? (
            <div className="text-[11px] font-mono text-[#859397] py-6 text-center">Loading…</div>
          ) : (
            <div className="space-y-2">
              {freshness.map((a) => {
                const tone = a.status === "stale" || a.status === "unknown" ? RED : a.status === "aging" ? AMBER : GREEN;
                const pct = a.days_since == null ? 100 : Math.min(100, Math.round((a.days_since / a.interval_days) * 100));
                return (
                  <div key={a.id} className="flex items-center gap-3">
                    <span className="w-24 shrink-0 text-xs font-mono text-[#dfe2f3] truncate" title={a.name}>{a.name}{a.auto ? " ·auto" : ""}</span>
                    <div className="flex-1 h-2.5 bg-white/5 rounded-full overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
                    </div>
                    <span className="w-24 shrink-0 text-right text-[10px] font-mono" style={{ color: tone }}>
                      {a.days_since == null ? "never" : `${a.days_since}d`} / {a.interval_days}d
                    </span>
                    <button onClick={() => markFresh(a.id)} title="Mark updated today"
                      className="shrink-0 text-[10px] font-mono px-2 py-1 rounded border border-white/10 text-[#859397] hover:text-[#5eead4] hover:border-[#5eead4]/30 cursor-pointer">✓</button>
                  </div>
                );
              })}
              <p className="text-[10px] font-mono text-[#859397] pt-1">Résumé freshness tracks your résumé template automatically; mark the rest when you refresh them.</p>
            </div>
          )}
        </Panel>
      </section>

      {/* Log dev session modal */}
      {logOpen && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-4 bg-[#0a0e1a]/80 backdrop-blur-md">
          <div className="absolute inset-0" onClick={() => setLogOpen(false)} />
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative w-full max-w-md bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl p-6">
            <div className="flex justify-between items-start mb-4">
              <h3 className="text-lg font-bold font-mono tracking-wide text-[#8aebff]">LOG DEV SESSION</h3>
              <button onClick={() => setLogOpen(false)} className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Tool</label>
                  <select value={form.tool} onChange={(e) => setForm((f) => ({ ...f, tool: e.target.value }))} className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 cursor-pointer">
                    <option value="claude-code" className="bg-[#0a0e1a]">claude-code</option>
                    <option value="antigravity" className="bg-[#0a0e1a]">antigravity</option>
                  </select>
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Day</label>
                  <input type="date" value={form.day} max={todayStr} onChange={(e) => setForm((f) => ({ ...f, day: e.target.value }))} className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 cursor-pointer" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                {[{ k: "tokens", label: "Tokens", ph: "120000" }, { k: "cost", label: "Cost $", ph: "2.40" }, { k: "duration_min", label: "Minutes", ph: "45" }].map((fld) => (
                  <div key={fld.k}>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">{fld.label}</label>
                    <input value={(form as any)[fld.k]} onChange={(e) => setForm((f) => ({ ...f, [fld.k]: e.target.value }))} placeholder={fld.ph} inputMode="decimal" className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-2.5 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                  </div>
                ))}
              </div>
              <div>
                <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">Note</label>
                <input value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} placeholder="what you worked on" className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-5">
              <button onClick={() => setLogOpen(false)} className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer">CANCEL</button>
              <button onClick={saveSession} disabled={saving} className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-50 flex items-center gap-2">
                {saving ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> SAVING…</> : "SAVE"}
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Diagnostics Modal */}
      {diagAgent && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center px-4 bg-[#0a0e1a]/85 backdrop-blur-md">
          <div className="absolute inset-0" onClick={() => setDiagAgent(null)} />
          <motion.div initial={{ opacity: 0, y: 20, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} className="relative w-full max-w-2xl bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl p-6 flex flex-col max-h-[85vh]">
            <div className="flex justify-between items-start mb-4 border-b border-white/5 pb-3">
              <div>
                <h3 className="text-lg font-bold font-mono tracking-wide text-[#8aebff] flex items-center gap-2">
                  <TerminalSquare className="w-5 h-5" /> AGENT DIAGNOSTICS: {diagAgent.name}
                </h3>
                <p className="text-[11px] font-mono text-[#859397] uppercase tracking-widest mt-1">
                  System Health & Exception Trace logs
                </p>
              </div>
              <button onClick={() => setDiagAgent(null)} className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>

            <div className="space-y-4 overflow-y-auto pr-1 flex-1">
              {/* Telemetry stats summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-[#0a0e1a]/40 border border-white/5 rounded-xl p-3">
                  <div className="text-[10px] font-mono uppercase text-[#859397]">Total Executions</div>
                  <div className="text-lg font-mono font-bold text-[#dfe2f3] mt-0.5">{diagAgent.total}</div>
                </div>
                <div className="bg-[#0a0e1a]/40 border border-white/5 rounded-xl p-3">
                  <div className="text-[10px] font-mono uppercase text-[#859397]">Total Errors</div>
                  <div className="text-lg font-mono font-bold text-[#ffb4ab] mt-0.5">{diagAgent.errors}</div>
                </div>
                <div className="bg-[#0a0e1a]/40 border border-white/5 rounded-xl p-3">
                  <div className="text-[10px] font-mono uppercase text-[#859397]">Last Status</div>
                  <div className={`text-sm font-mono font-bold mt-1 uppercase ${
                    diagAgent.health === "error" ? "text-[#ffb4ab]" : "text-[#5eead4]"
                  }`}>
                    {diagAgent.last_status || "UNKNOWN"}
                  </div>
                </div>
                <div className="bg-[#0a0e1a]/40 border border-white/5 rounded-xl p-3">
                  <div className="text-[10px] font-mono uppercase text-[#859397]">Last Attempt</div>
                  <div className="text-lg font-mono font-bold text-[#8aebff] mt-0.5">#{diagAgent.attempt || 1}</div>
                </div>
              </div>

              {/* Status details */}
              <div className="bg-[#0a0e1a]/60 border border-white/10 rounded-xl p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">Execution Details</div>
                  {diagAgent.severity && (
                    <span className={`text-[10px] font-mono font-bold px-2 py-0.5 rounded ${
                      diagAgent.severity === "critical" ? "bg-red-500/20 text-red-300 border border-red-500/30" :
                      diagAgent.severity === "warning" ? "bg-amber-500/20 text-amber-300 border border-amber-500/30" :
                      "bg-blue-500/20 text-blue-300 border border-blue-500/30"
                    }`}>
                      {diagAgent.severity.toUpperCase()}
                    </span>
                  )}
                </div>
                <div className="text-sm font-mono text-[#dfe2f3] break-words">
                  {diagAgent.last_message || "No message logged for the last execution."}
                </div>
                <div className="text-[10px] font-mono text-[#859397] pt-1 border-t border-white/5">
                  Timestamp: {diagAgent.last_run || "Never"}
                </div>
              </div>

              {/* Traceback Log */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#859397] mb-1.5 flex items-center gap-1">
                  <span>Stack Trace / Error logs</span>
                </div>
                {diagAgent.traceback ? (
                  <pre className="bg-[#0a0e1a]/90 border border-white/10 rounded-xl p-4 text-[11px] font-mono text-[#ffb4ab] overflow-x-auto overflow-y-auto max-h-[220px] select-text">
                    {diagAgent.traceback}
                  </pre>
                ) : (
                  <div className="bg-[#0a0e1a]/30 border border-white/5 rounded-xl p-6 text-center text-xs font-mono text-[#859397]">
                    ✓ No traceback error logs. The last execution completed with clean system conditions.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-between items-center mt-5 border-t border-white/5 pt-4">
              <div className="text-[9px] font-mono text-[#859397] uppercase tracking-wider">
                Interactive Diagnostics Console
              </div>
              <div className="flex gap-3">
                <button onClick={() => setDiagAgent(null)} className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 cursor-pointer">CLOSE</button>
                <button
                  onClick={() => handleManualRetry(diagAgent.name)}
                  disabled={retryingJob !== null}
                  className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {retryingJob === diagAgent.name ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> RETRYING…</>
                  ) : (
                    "RETRY AGENT NOW"
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </motion.div>
  );
}
