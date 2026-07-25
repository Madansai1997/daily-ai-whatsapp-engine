import React, { useState, useEffect } from "react";
import { ScreenId } from "../types";
import { motion } from "motion/react";
import { ZoomIn, RotateCw, ShieldCheck, MessageSquare, Terminal as TerminalIcon, FileText, Bolt } from "lucide-react";
import ProjectBelieverModal from "./ProjectBelieverModal";

interface CoreInterfaceProps {
  onNavigate: (screen: ScreenId) => void;
  onOpenNotifications?: () => void;
}


// Real system-status signal: null = probing/unknown, true = ONLINE, false = OFFLINE
type OnlineStatus = boolean | null;

// A real job-log row from GET /api/job-logs
interface JobLog {
  id: number;
  job_name: string;
  status: string;
  message: string;
  created_at: string;
}

// Real system metrics from GET /api/system-metrics
interface SystemMetrics {
  memory: { rss_mb: number; limit_mb: number; pct: number; status: string };
  uptime: string;
  uptime_seconds: number;
  errors_24h: number;
  backlog: { total: number; reminders: number; automations: number; queue: number; ats_pending: number };
  agents: number;
  agent_names?: string[];
  patterns_learned: number;
  db: string;
  scheduler_mode: string;
}

export default function CoreInterface({ onNavigate, onOpenNotifications }: CoreInterfaceProps) {
  // REAL signals from the backend (same-origin, absolute-from-root paths)
  const [online, setOnline] = useState<OnlineStatus>(null);
  const [trackedRoles, setTrackedRoles] = useState<number | null>(null);
  const [pendingAnalyses, setPendingAnalyses] = useState<number | null>(null);
  const [logs, setLogs] = useState<JobLog[] | null>(null);
  const [metrics, setMetrics] = useState<SystemMetrics | null>(null);
  const [believerOpen, setBelieverOpen] = useState(false);

  // Global hotkey: Cmd + Shift + B / Ctrl + Shift + B -> Project Believer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "B" || e.key === "b")) {
        e.preventDefault();
        setBelieverOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);


  // SYSTEM ONLINE indicator: probe /ping on mount and every ~15s
  useEffect(() => {
    let cancelled = false;
    const ping = async () => {
      try {
        const res = await fetch("/ping", { method: "GET", cache: "no-store" });
        if (!cancelled) setOnline(res.ok);
      } catch {
        if (!cancelled) setOnline(false);
      }
    };
    ping();
    const timer = setInterval(() => { if (!document.hidden) ping(); }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // TRACKED ROLES = jobs on the board; PENDING ANALYSES = of those, how many have no
  // ATS score yet (roles still awaiting an ATS check). Both derived from one /applications call.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/applications", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const apps = (data as { applications?: { ats_score?: number | null }[] })?.applications;
        if (!cancelled && Array.isArray(apps)) {
          setTrackedRoles(apps.length);
          setPendingAnalyses(apps.filter((a) => typeof a?.ats_score !== "number").length);
        }
      } catch {
        /* leave neutral placeholder */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // SYSTEM LOGS: GET /api/job-logs -> [{ job_name, status, message, created_at }]
  // Refresh on mount and every ~20s so the Core widget mirrors real activity.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/job-logs?limit=8", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled && Array.isArray(data)) setLogs(data as JobLog[]);
      } catch {
        /* leave prior logs / neutral state */
      }
    };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // SYSTEM METRICS: GET /api/system-metrics -> real memory / backlog / errors / uptime
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/system-metrics", { cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        if (!cancelled && data && typeof data === "object") setMetrics(data as SystemMetrics);
      } catch {
        /* leave prior metrics / neutral state */
      }
    };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 20000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // Format a job-log row for the HUD list.
  const logTime = (iso: string) => {
    const d = new Date(iso.includes("T") ? iso : iso.replace(" ", "T") + "Z");
    if (isNaN(d.getTime())) return "--:--";
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  };
  const logTag = (jobName: string) => (jobName || "job").toUpperCase().slice(0, 12);
  const logColor = (status: string) => {
    const s = (status || "").toLowerCase();
    if (s.includes("error") || s.includes("fail")) return "text-[#ffb4ab]";
    if (s.includes("run") || s.includes("start") || s.includes("pending")) return "text-[#ffd6a3]";
    if (s.includes("success") || s.includes("ok") || s.includes("done") || s.includes("complete")) return "text-[#5eead4]";
    return "text-[#8aebff]";
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="space-y-8"
    >
      {/* Welcome Header */}
      <section className="flex flex-col md:flex-row justify-between items-start md:items-end gap-6 pt-4">
        <div>
          <span className="text-xs font-semibold text-[#8aebff] tracking-[0.2em] font-mono block mb-1">
            AUTHORIZATION GRANTED
          </span>
          <h2 className="text-4xl md:text-5xl font-extrabold tracking-tighter text-[#dfe2f3] leading-none mb-3">
            Welcome back, Madan.
          </h2>
          <p className="text-sm md:text-base text-[#bbc9cd] max-w-xl leading-relaxed">
            Neural link established. JARVIS core protocols are operating at 98.4% efficiency. All secondary sub-systems remain encrypted.
          </p>
        </div>
        <div className="flex items-center gap-6 bg-[#1b1f2c]/30 px-6 py-3 border border-white/5 rounded-lg">
          <div className="text-right">
            <span className="text-[10px] font-mono text-[#859397] block tracking-wider">SYSTEM</span>
            <span
              className={`text-xl md:text-2xl font-bold font-mono flex items-center gap-2 justify-end ${
                online === false ? "text-[#ff6b6b]" : online === true ? "text-[#5eead4] glow-cyan" : "text-[#859397]"
              }`}
            >
              <span
                className={`w-2.5 h-2.5 rounded-full ${
                  online === false
                    ? "bg-[#ff6b6b] shadow-[0_0_10px_rgba(255,107,107,0.6)]"
                    : online === true
                      ? "bg-[#5eead4] shadow-[0_0_10px_rgba(94,234,212,0.6)] animate-pulse"
                      : "bg-[#859397] animate-pulse"
                }`}
              ></span>
              {online === false ? "OFFLINE" : online === true ? "ONLINE" : "PROBING"}
            </span>
          </div>
          <div className="w-[1px] h-10 bg-[#3c494c]"></div>
          <div className="text-right">
            <span className="text-[10px] font-mono text-[#859397] block tracking-wider">UPTIME</span>
            <span className="text-xl md:text-2xl font-bold text-[#8aebff] font-mono glow-cyan">
              {metrics?.uptime ?? "—"}
            </span>
          </div>
          <div className="w-[1px] h-10 bg-[#3c494c]"></div>
          <div
            className="text-right cursor-help"
            title={
              metrics?.agent_names?.length
                ? "Active agents:\n• " + metrics.agent_names.join("\n• ")
                : "Active agent modules"
            }
          >
            <span className="text-[10px] font-mono text-[#859397] block tracking-wider">AGENTS</span>
            <span className="text-xl md:text-2xl font-bold text-[#dfe2f3] font-mono">
              {metrics?.agents ?? "—"}
            </span>
          </div>
        </div>
      </section>

      {/* Bento HUD Layout Grid */}
      <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
        {/* Center Neural Link Visualization Panel */}
        <div className="md:col-span-8 relative rounded-xl border border-[#3c494c] overflow-hidden group h-[480px] glass-panel shadow-2xl flex flex-col justify-between">
          {/* Neural link scan grid background */}
          <div
            className="absolute inset-0 bg-cover bg-center opacity-40 group-hover:scale-[1.02] transition-transform duration-1000"
            style={{
              backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuCa0Td-0PuLe21NkVsvcCUr-_xR0HsoDsl78afjCYHN62sknS6605qCaIGfDOcQDgSqkda7-Z7FR1uR6mwbfwhJztTxtjPnMVEeKPhavpelm0LlsfC7fHCA0GgTT3aH6v4i5jCTrriGd0AtFSwB15AKxAy8251JKxXL0E_l9SCuuKCbW0qZnMwbdBSpZCEHvh5V3jyU7_-C9tiiOGMA6G3JwaoFcBBZ8j9mTfE27VgtWAyV2xke4DgAP5JiwLfexRAXFNYXTvRki__O')",
            }}
          ></div>
          {/* Ambient gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#0f131f] via-transparent to-transparent"></div>

          {/* HUD Content Overlay */}
          <div className="relative z-10 p-6 flex-1 flex flex-col justify-between">
            {/* Top row */}
            <div className="flex justify-between items-start">
              <div className="space-y-1">
                <span className="px-2 py-0.5 bg-[#8aebff]/10 border border-[#8aebff]/30 text-[#8aebff] text-[10px] font-semibold font-mono rounded">
                  NEURAL LINK ACTIVE
                </span>
                <p className="text-xs font-mono text-[#dfe2f3]/80 tracking-wider">
                  ENCRYPTED DATA STREAM_v4.2
                </p>
              </div>
              <div className="flex gap-2">
                <button className="p-2 bg-[#1b1f2c]/50 border border-[#3c494c] hover:border-[#8aebff] transition-all rounded cursor-pointer">
                  <ZoomIn className="w-4 h-4 text-[#8aebff]" />
                </button>
                <button className="p-2 bg-[#1b1f2c]/50 border border-[#3c494c] hover:border-[#8aebff] transition-all rounded cursor-pointer">
                  <RotateCw className="w-4 h-4 text-[#8aebff]" />
                </button>
              </div>
            </div>

            {/* Middle decorative grid coordinate elements */}
            <div className="pointer-events-none flex justify-center items-center h-48">
              <div className="w-24 h-24 border border-[#8aebff]/20 rounded-full flex items-center justify-center animate-pulse">
                <div className="w-16 h-16 border border-[#8aebff]/10 rounded-full border-dashed animate-spin"></div>
              </div>
            </div>

            {/* Bottom row */}
            <div className="flex justify-between items-end">
              <div className="space-y-2">
                <div className="flex items-center gap-1.5">
                  <div className="w-16 h-1 bg-[#8aebff] shadow-[0_0_10px_rgba(138,235,255,0.5)]"></div>
                  <div className="w-8 h-1 bg-[#8aebff]/30"></div>
                  <div className="w-12 h-1 bg-[#8aebff]/50"></div>
                </div>
                <p className="text-[10px] font-mono text-[#859397] uppercase tracking-widest">
                  MEMORY LOAD: {metrics ? `${metrics.memory.pct}%` : "—"}
                </p>
              </div>
              <div className="text-right font-mono">
                <span className="text-xs text-[#8aebff] block tracking-wider">
                  DB: {metrics ? metrics.db.toUpperCase() : "—"}
                </span>
                <span className="text-[10px] text-[#859397]">
                  PATTERNS LEARNED: {metrics?.patterns_learned ?? "—"}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Side Diagnostic widgets */}
        <div className="md:col-span-4 space-y-6 flex flex-col justify-between">
          {/* Widget: System core status */}
          <div className="p-6 glass-panel rounded-xl border border-[#3c494c] space-y-4">
            <div className="flex justify-between items-center border-b border-white/10 pb-2">
              <span className="text-[10px] font-semibold font-mono text-[#859397] tracking-widest uppercase">
                CORE STATUS
              </span>
              <ShieldCheck className="w-4.5 h-4.5 text-[#8aebff]" />
            </div>
            {/* REAL backend stats: tracked roles + pending ATS analyses */}
            <div className="grid grid-cols-2 gap-3">
              <div
                onClick={() => onNavigate(ScreenId.Jobs)}
                className="p-3 rounded-lg bg-[#1b1f2c]/40 border border-[#3c494c] hover:border-[#8aebff]/50 transition-all cursor-pointer text-center"
              >
                <span className="block text-2xl font-bold font-mono text-[#8aebff] glow-cyan leading-none">
                  {trackedRoles === null ? "—" : trackedRoles}
                </span>
                <span className="block text-[9px] font-mono text-[#859397] tracking-widest uppercase mt-1.5">
                  Tracked Roles
                </span>
              </div>
              <div
                onClick={() => onNavigate(ScreenId.Jobs)}
                className="p-3 rounded-lg bg-[#1b1f2c]/40 border border-[#3c494c] hover:border-[#ffd6a3]/50 transition-all cursor-pointer text-center"
              >
                <span className="block text-2xl font-bold font-mono text-[#ffd6a3] leading-none">
                  {pendingAnalyses === null ? "—" : pendingAnalyses}
                </span>
                <span className="block text-[9px] font-mono text-[#859397] tracking-widest uppercase mt-1.5">
                  Pending Analyses
                </span>
              </div>
            </div>

            <div className="space-y-4 font-mono text-xs">
              {/* MEMORY — real RSS vs the 512MB Render cap */}
              <div
                className="space-y-1 cursor-help"
                title={
                  metrics
                    ? `Engine memory: ${Math.round(metrics.memory.rss_mb)} MB of ${Math.round(metrics.memory.limit_mb)} MB (${metrics.memory.pct}%) — status ${metrics.memory.status}`
                    : "Engine memory usage"
                }
              >
                <div className="flex justify-between">
                  <span className="text-[#bbc9cd]">MEMORY</span>
                  <span className={`font-bold ${metrics && metrics.memory.status !== "ok" ? "text-[#ffb4ab]" : "text-[#8aebff]"}`}>
                    {metrics ? `${Math.round(metrics.memory.rss_mb)} / ${Math.round(metrics.memory.limit_mb)} MB` : "—"}
                  </span>
                </div>
                <div className="w-full bg-[#313442] h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${metrics && metrics.memory.status !== "ok" ? "bg-[#ffb4ab]" : "bg-[#8aebff]"} shadow-[0_0_8px_rgba(138,235,255,0.4)]`}
                    style={{ width: `${metrics ? metrics.memory.pct : 0}%` }}
                  ></div>
                </div>
              </div>

              {/* BACKLOG — pending reminders + automations + queue + unviewed ATS */}
              <div
                className="space-y-1 cursor-help"
                title={
                  metrics
                    ? `Backlog breakdown:\n• ${metrics.backlog.reminders} reminder(s)\n• ${metrics.backlog.automations} automation(s)\n• ${metrics.backlog.queue} queued command(s)\n• ${metrics.backlog.ats_pending} unviewed ATS`
                    : "Pending work"
                }
              >
                <div className="flex justify-between">
                  <span className="text-[#bbc9cd]">BACKLOG</span>
                  <span className="text-[#ffd6a3] font-bold">
                    {metrics ? `${metrics.backlog.total} item${metrics.backlog.total === 1 ? "" : "s"}` : "—"}
                  </span>
                </div>
                <div className="w-full bg-[#313442] h-1.5 rounded-full overflow-hidden">
                  <div
                    className="bg-[#ffd6a3] h-full transition-all duration-500 shadow-[0_0_8px_rgba(255,214,163,0.4)]"
                    style={{ width: `${metrics ? Math.min(100, metrics.backlog.total * 10) : 0}%` }}
                  ></div>
                </div>
              </div>

              {/* ERRORS — job failures in the last 24h */}
              <div
                className="space-y-1 cursor-help"
                title={metrics ? `${metrics.errors_24h} job failure(s) in the last 24 hours` : "Recent job failures"}
              >
                <div className="flex justify-between">
                  <span className="text-[#bbc9cd]">ERRORS (24H)</span>
                  <span className={`font-bold ${metrics && metrics.errors_24h > 0 ? "text-[#ffb4ab]" : "text-[#5eead4]"}`}>
                    {metrics ? metrics.errors_24h : "—"}
                  </span>
                </div>
                <div className="w-full bg-[#313442] h-1.5 rounded-full overflow-hidden">
                  <div
                    className={`h-full transition-all duration-500 ${metrics && metrics.errors_24h > 0 ? "bg-[#ffb4ab]" : "bg-[#5eead4]"}`}
                    style={{ width: `${metrics ? (metrics.errors_24h > 0 ? Math.min(100, metrics.errors_24h * 20) : 100) : 0}%` }}
                  ></div>
                </div>
              </div>
            </div>
          </div>

          {/* Widget: Recent system logs */}
          <div className="p-6 glass-panel rounded-xl border border-[#3c494c] space-y-4 flex-1 flex flex-col min-h-[220px]">
            <div className="flex justify-between items-center border-b border-white/10 pb-2">
              <span className="text-[10px] font-semibold font-mono text-[#859397] tracking-widest uppercase">
                SYSTEM LOGS
              </span>
              <span
                onClick={() => onOpenNotifications?.()}
                className="text-[11px] font-mono text-[#8aebff] cursor-pointer hover:underline"
              >
                View All
              </span>
            </div>
            <div className="space-y-3 font-mono text-[11px] flex-1 overflow-y-auto max-h-[170px] pr-1 custom-scrollbar">
              {logs === null ? (
                <div className="text-[#859397] text-center py-6">Loading activity…</div>
              ) : logs.length === 0 ? (
                <div className="text-[#859397] text-center py-6">No system activity logged yet.</div>
              ) : (
                logs.map((log) => (
                  <div key={log.id} className="flex gap-2 items-start leading-snug">
                    <span className="text-[#859397] shrink-0">{logTime(log.created_at)}</span>
                    <span className={`${logColor(log.status)} font-semibold shrink-0`}>{logTag(log.job_name)}</span>
                    <span className="text-[#bbc9cd] truncate" title={log.message}>
                      {log.message}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Featured Nav Launchers Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">

        {/* Card 2: Terminal */}
        <div
          id="core-terminal-card"
          onClick={() => onNavigate(ScreenId.Terminal)}
          className="md:col-span-1 p-6 glass-panel rounded-xl border border-[#3c494c] hover:border-[#8aebff]/50 transition-all cursor-pointer group hover:shadow-2xl flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#ffb13b]/10 flex items-center justify-center border border-[#ffb13b]/20 group-hover:border-[#ffb13b]/60 transition-all">
                <TerminalIcon className="w-6 h-6 text-[#ffd6a3]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#dfe2f3] group-hover:text-[#ffd6a3] transition-colors">
                  Terminal
                </h3>
                <p className="text-[11px] font-mono text-[#859397] tracking-wider uppercase">
                  Root Access Shell
                </p>
              </div>
            </div>
            <p className="text-xs font-mono text-[#bbc9cd] leading-relaxed">
              System shell v9.2. Executing maintenance scripts... all partitions healthy.
            </p>
          </div>
          <div className="flex justify-between items-center pt-6 border-t border-white/5 mt-4">
            <span className="text-[10px] font-semibold font-mono text-[#ffd6a3] tracking-widest uppercase">
              INVOKE ROOT
            </span>
            <span className="text-[#ffd6a3] font-bold group-hover:translate-x-1.5 transition-transform duration-200">
              →
            </span>
          </div>
        </div>

        {/* Card 3: Resume */}
        <div
          id="core-resume-card"
          onClick={() => onNavigate(ScreenId.Jobs)}
          className="md:col-span-1 p-6 glass-panel rounded-xl border border-[#3c494c] hover:border-[#8aebff]/50 transition-all cursor-pointer group hover:shadow-2xl flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-white/5 flex items-center justify-center border border-[#859397]/20 group-hover:border-[#8aebff]/40 transition-all">
                <FileText className="w-6 h-6 text-[#c1c6d9]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#dfe2f3] group-hover:text-[#c1c6d9] transition-colors">
                  Resume
                </h3>
                <p className="text-[11px] font-mono text-[#859397] tracking-wider uppercase">
                  Personal Bio-data
                </p>
              </div>
            </div>
            <p className="text-xs font-mono text-[#bbc9cd] leading-relaxed">
              Operational history and cryptographic identity verified for Level 7 access.
            </p>
          </div>
          <div className="flex justify-between items-center pt-6 border-t border-white/5 mt-4">
            <span className="text-[10px] font-semibold font-mono text-[#c1c6d9] tracking-widest uppercase">
              VIEW PROFILE
            </span>
            <span className="text-[#c1c6d9] font-bold group-hover:translate-x-1.5 transition-transform duration-200">
              →
            </span>
          </div>
        </div>
      </div>

      {/* Floating Action Button (FAB) */}
      <button
        onClick={() => onNavigate(ScreenId.Terminal)}
        className="fixed bottom-6 right-6 w-14 h-14 bg-[#22d3ee] hover:bg-[#8aebff] text-[#00363e] rounded-full flex items-center justify-center shadow-2xl hover:scale-105 active:scale-95 transition-all z-50 border border-[#8aebff]/40 cursor-pointer"
        title="Activate Emergency Override Terminal"
      >
        <Bolt className="w-6 h-6" />
      </button>

      {/* Secret Project Believer Encrypted Diary Modal */}
      <ProjectBelieverModal
        isOpen={believerOpen}
        onClose={() => setBelieverOpen(false)}
      />
    </motion.div>
  );
}

