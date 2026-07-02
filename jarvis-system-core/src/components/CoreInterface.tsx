import React, { useState, useEffect } from "react";
import { ScreenId, SystemLog } from "../types";
import { motion } from "motion/react";
import { ZoomIn, RotateCw, ShieldCheck, MessageSquare, Terminal as TerminalIcon, FileText, Bolt } from "lucide-react";

interface CoreInterfaceProps {
  onNavigate: (screen: ScreenId) => void;
}

// Real system-status signal: null = probing/unknown, true = ONLINE, false = OFFLINE
type OnlineStatus = boolean | null;

export default function CoreInterface({ onNavigate }: CoreInterfaceProps) {
  const [uptimeSec, setUptimeSec] = useState(513125); // ~142h 32m 05s
  const [synapticLoad, setSynapticLoad] = useState(42);

  // REAL signals from the backend (same-origin, absolute-from-root paths)
  const [online, setOnline] = useState<OnlineStatus>(null);
  const [trackedRoles, setTrackedRoles] = useState<number | null>(null);
  const [pendingAnalyses, setPendingAnalyses] = useState<number | null>(null);

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
    const timer = setInterval(ping, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  // TRACKED ROLES: GET /applications -> { applications: [...] }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/applications", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const apps = (data as { applications?: unknown[] })?.applications;
        if (!cancelled && Array.isArray(apps)) setTrackedRoles(apps.length);
      } catch {
        /* leave neutral placeholder */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // PENDING ANALYSES: GET /ats/pending/count -> { count }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/ats/pending/count", { method: "GET", cache: "no-store" });
        if (!res.ok) return;
        const data: unknown = await res.json();
        const count = (data as { count?: unknown })?.count;
        if (!cancelled && typeof count === "number") setPendingAnalyses(count);
      } catch {
        /* leave neutral placeholder */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // System Uptime counter
  useEffect(() => {
    const timer = setInterval(() => {
      setUptimeSec((prev) => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Soft fluctuations for synaptic load
  useEffect(() => {
    const interval = setInterval(() => {
      setSynapticLoad((prev) => {
        const delta = Math.floor(Math.random() * 5) - 2;
        const next = prev + delta;
        return next >= 35 && next <= 50 ? next : prev;
      });
    }, 3000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (totalSeconds: number) => {
    const hrs = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    return `${hrs.toString().padStart(3, "0")}:${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const initialLogs: SystemLog[] = [
    { id: "1", time: "14:22", tag: "SEC_INIT", content: "Handshake protocol Alpha-9 verified.", colorClass: "text-[#8aebff]" },
    { id: "2", time: "14:18", tag: "WARN_RES", content: "Memory leak detected in sector 4.", colorClass: "text-[#ffd6a3]" },
    { id: "3", time: "14:15", tag: "SYS_UP", content: "Global cluster re-sync complete.", colorClass: "text-[#8aebff]" },
    { id: "4", time: "13:58", tag: "DB_SYNC", content: "Archive backup scheduled.", colorClass: "text-[#bbc9cd]" },
    { id: "5", time: "13:42", tag: "SYS_INIT", content: "Mainframe cluster connection verified.", colorClass: "text-[#8aebff]" },
    { id: "6", time: "13:30", tag: "SEC_ENC", content: "AES-256 handshake established securely.", colorClass: "text-[#bbc9cd]" },
  ];

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
            Welcome back, User_01.
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
              {formatUptime(uptimeSec)}
            </span>
          </div>
          <div className="w-[1px] h-10 bg-[#3c494c]"></div>
          <div className="text-right">
            <span className="text-[10px] font-mono text-[#859397] block tracking-wider">LOCATION</span>
            <span className="text-xl md:text-2xl font-bold text-[#dfe2f3] font-mono">
              NODE_ALPHA_7
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
                  SYNAPTIC LOAD: {synapticLoad}%
                </p>
              </div>
              <div className="text-right font-mono">
                <span className="text-xs text-[#8aebff] block tracking-wider">LATENCY: 0.2ms</span>
                <span className="text-[10px] text-[#859397]">PACKET LOSS: 0.00%</span>
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
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#bbc9cd]">CORE TEMP</span>
                  <span className="text-[#8aebff] font-bold">38°C</span>
                </div>
                <div className="w-full bg-[#313442] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#8aebff] h-full w-[38%] shadow-[0_0_8px_rgba(138,235,255,0.4)]"></div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#bbc9cd]">POWER FLUX</span>
                  <span className="text-[#ffd6a3] font-bold">1.21 GW</span>
                </div>
                <div className="w-full bg-[#313442] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#ffd6a3] h-full w-[72%] shadow-[0_0_8px_rgba(255,214,163,0.4)]"></div>
                </div>
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[#bbc9cd]">SIGNAL DECOY</span>
                  <span className="text-[#8aebff] font-bold">99.9%</span>
                </div>
                <div className="w-full bg-[#313442] h-1.5 rounded-full overflow-hidden">
                  <div className="bg-[#8aebff] h-full w-[99.9%] shadow-[0_0_8px_rgba(138,235,255,0.4)]"></div>
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
              <span className="text-[11px] font-mono text-[#8aebff] cursor-pointer hover:underline">
                View All
              </span>
            </div>
            <div className="space-y-3 font-mono text-[11px] flex-1 overflow-y-auto max-h-[170px] pr-1 custom-scrollbar">
              {initialLogs.map((log) => (
                <div key={log.id} className="flex gap-2 items-start leading-snug">
                  <span className="text-[#859397] shrink-0">{log.time}</span>
                  <span className={`${log.colorClass} font-semibold shrink-0`}>{log.tag}</span>
                  <span className="text-[#bbc9cd] truncate" title={log.content}>
                    {log.content}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Featured Nav Launchers Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Card 1: PrivaChat */}
        <div
          id="core-privachat-card"
          onClick={() => onNavigate(ScreenId.Chat)}
          className="md:col-span-1 p-6 glass-panel rounded-xl border border-[#3c494c] hover:border-[#8aebff]/50 transition-all cursor-pointer group hover:shadow-2xl flex flex-col justify-between"
        >
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-[#22d3ee]/10 flex items-center justify-center border border-[#8aebff]/20 group-hover:border-[#8aebff]/60 transition-all">
                <MessageSquare className="w-6 h-6 text-[#8aebff]" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-[#dfe2f3] group-hover:text-[#8aebff] transition-colors">
                  PrivaChat
                </h3>
                <p className="text-[11px] font-mono text-[#859397] tracking-wider uppercase">
                  E2E Encrypted Comm
                </p>
              </div>
            </div>
            <p className="text-xs font-mono text-[#bbc9cd] leading-relaxed">
              Secure line is active. 3 pending messages in the encrypted queue from [REDACTED].
            </p>
          </div>
          <div className="flex justify-between items-center pt-6 border-t border-white/5 mt-4">
            <span className="text-[10px] font-semibold font-mono text-[#8aebff] tracking-widest uppercase">
              OPEN CHANNEL
            </span>
            <span className="text-[#8aebff] font-bold group-hover:translate-x-1.5 transition-transform duration-200">
              →
            </span>
          </div>
        </div>

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
    </motion.div>
  );
}
