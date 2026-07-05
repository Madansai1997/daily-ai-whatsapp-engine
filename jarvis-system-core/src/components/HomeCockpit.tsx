import React, { useCallback, useEffect, useState } from "react";
import { motion } from "motion/react";
import { ScreenId } from "../types";
import {
  Volume2, Square, RefreshCw, ArrowRight, Sparkles, Clock, CalendarClock,
  Wallet, Users, AlertTriangle, MessageSquare, Sun, Coffee, Moon, CheckCircle2,
} from "lucide-react";

interface CockpitStep {
  key: string; severity: string; icon: string; label: string;
  action?: string; target: string; count?: number;
}
interface Cockpit {
  greeting: string; name: string; date: string; headline: string;
  next_steps: CockpitStep[];
  pulse: { active: number; response_rate: number | null; week_applied: number; funnel: { stage: string; count: number }[] };
}

interface Props {
  onNavigate: (screen: ScreenId, intent?: string) => void;
}

const SEV: Record<string, string> = {
  red: "#ffb4ab", green: "#5eead4", purple: "#c084fc", amber: "#ffd6a3", grey: "#859397",
};
const ICONS: Record<string, React.ElementType> = {
  alert: AlertTriangle, calendar: CalendarClock, sparkles: Sparkles,
  clock: Clock, wallet: Wallet, users: Users, refresh: RefreshCw,
};

export default function HomeCockpit({ onNavigate }: Props) {
  const [data, setData] = useState<Cockpit | null>(null);
  const [loading, setLoading] = useState(true);
  const [speaking, setSpeaking] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const d = await fetch("/api/cockpit", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      if (d) setData(d);
    } catch { /* keep last */ } finally {
      if (!silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => { if (!document.hidden) load(true); }, 30000);
    return () => { clearInterval(t); try { window.speechSynthesis?.cancel(); } catch { /* */ } };
  }, [load]);

  // ▶ reads the full JARVIS standup aloud (browser voice; the natural Gemini voice lives on the Standup tool).
  const speakBriefing = async () => {
    if (speaking) { try { window.speechSynthesis?.cancel(); } catch { /* */ } setSpeaking(false); return; }
    try {
      const d = await fetch("/api/standup").then((r) => r.json());
      const text = d?.ok ? d.text : `${data?.greeting}, ${data?.name}. ${data?.headline}`;
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(u);
    } catch { setSpeaking(false); }
  };

  const go = (target: string) => {
    if (target.startsWith("jobs:")) onNavigate(ScreenId.Jobs, target.slice(5));
    else if (target === "insights") onNavigate(ScreenId.Insights);
    else if (target === "bills") onNavigate(ScreenId.Bills);
    else onNavigate(ScreenId.Jobs);
  };

  const GreetIcon = data && /morning/i.test(data.greeting) ? Sun : data && /evening/i.test(data.greeting) ? Moon : Coffee;
  const steps = data?.next_steps || [];
  const pulse = data?.pulse;
  const topFunnel = pulse?.funnel?.[0]?.count || 1;

  return (
    <div className="w-full max-w-3xl mx-auto flex flex-col gap-6">
      {/* Greeting band */}
      <section className="glass-panel rounded-2xl border border-white/5 p-6">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-[#dfe2f3] flex items-center gap-2.5">
              <GreetIcon className="w-6 h-6 text-[#ffd6a3]" />
              {data ? `${data.greeting}, ${data.name}.` : "Loading…"}
            </h1>
            <p className="text-sm text-[#bbc9cd] mt-2">{data?.headline}</p>
            <p className="text-[11px] font-mono text-[#5c6a6d] uppercase tracking-widest mt-1">{data?.date}</p>
          </div>
          <button
            onClick={speakBriefing}
            title="Read my day aloud"
            className={`shrink-0 flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold font-mono border transition-all cursor-pointer ${speaking ? "bg-[#ffb4ab]/10 border-[#ffb4ab]/30 text-[#ffb4ab]" : "bg-[#8aebff]/10 border-[#8aebff]/30 text-[#8aebff] hover:bg-[#8aebff]/20"}`}
          >
            {speaking ? <><Square className="w-4 h-4" /> STOP</> : <><Volume2 className="w-4 h-4" /> BRIEF ME</>}
          </button>
        </div>
      </section>

      {/* Next steps band */}
      <section className="glass-panel rounded-2xl border border-white/5 p-5">
        <h2 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-4 flex items-center gap-2">
          <ArrowRight className="w-4 h-4" /> Next steps
        </h2>
        {loading && !data ? (
          <div className="text-center text-[#859397] font-mono text-sm py-8">Assembling your day…</div>
        ) : steps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center gap-2">
            <CheckCircle2 className="w-9 h-9 text-[#5eead4]/60" />
            <p className="text-sm text-[#dfe2f3]">Nothing needs you right now.</p>
            <p className="text-[11px] font-mono text-[#859397]">Clear runway — a good moment to polish your résumé or hunt fresh roles.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {steps.map((s, i) => {
              const tint = SEV[s.severity] || SEV.grey;
              const Icon = ICONS[s.icon] || Sparkles;
              return (
                <button
                  key={`${s.key}-${i}`}
                  onClick={() => go(s.target)}
                  className="group w-full flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] hover:bg-white/[0.05] hover:border-white/10 px-4 py-3 transition-all cursor-pointer text-left"
                >
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tint }} />
                  <Icon className="w-4 h-4 shrink-0" style={{ color: tint }} />
                  <span className="flex-1 text-sm text-[#dfe2f3]">{s.label}</span>
                  <span className="shrink-0 flex items-center gap-1 text-[11px] font-mono font-semibold" style={{ color: tint }}>
                    {s.action || "Open"} <ArrowRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* Pipeline pulse band */}
      <section className="glass-panel rounded-2xl border border-white/5 p-5">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397]">Pipeline</h2>
          <button onClick={() => onNavigate(ScreenId.Insights)} className="text-[10px] font-mono text-[#8aebff] hover:underline cursor-pointer">full stats →</button>
        </div>
        <div className="flex items-center gap-4 text-sm font-mono mb-3 flex-wrap">
          <span className="text-[#dfe2f3]"><b className="text-[#8aebff]">{pulse?.active ?? 0}</b> active</span>
          <span className="text-[#5c6a6d]">·</span>
          <span className="text-[#dfe2f3]"><b className="text-[#5eead4]">{pulse?.response_rate ?? 0}%</b> response</span>
          <span className="text-[#5c6a6d]">·</span>
          <span className="text-[#dfe2f3]"><b className="text-[#a3e635]">+{pulse?.week_applied ?? 0}</b> this week {(pulse?.week_applied ?? 0) > 0 ? "↑" : ""}</span>
        </div>
        <div className="flex items-end gap-1.5 h-14">
          {(pulse?.funnel || []).map((f) => (
            <div key={f.stage} className="flex-1 flex flex-col items-center gap-1">
              <div className="w-full rounded-t bg-gradient-to-t from-[#8aebff]/40 to-[#5eead4]/70" style={{ height: `${Math.max(6, Math.round((f.count / topFunnel) * 100))}%` }} title={`${f.stage}: ${f.count}`} />
              <span className="text-[9px] font-mono text-[#5c6a6d] capitalize truncate w-full text-center">{f.stage.slice(0, 5)}</span>
              <span className="text-[10px] font-mono text-[#859397] -mt-1">{f.count}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Ask JARVIS footer */}
      <button
        onClick={() => onNavigate(ScreenId.Assistant)}
        className="glass-panel rounded-2xl border border-white/5 hover:border-[#8aebff]/20 p-4 flex items-center gap-3 text-left cursor-pointer transition-all group"
      >
        <MessageSquare className="w-5 h-5 text-[#8aebff]" />
        <span className="flex-1 text-sm text-[#859397] group-hover:text-[#bbc9cd] transition-colors">Ask JARVIS anything…</span>
        <ArrowRight className="w-4 h-4 text-[#859397] group-hover:text-[#8aebff] group-hover:translate-x-0.5 transition-all" />
      </button>
    </div>
  );
}
