import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { ScreenId } from "../types";
import {
  Volume2, Square, RefreshCw, ArrowRight, Sparkles, Clock, CalendarClock,
  Wallet, Users, AlertTriangle, MessageSquare, Sun, Coffee, Moon, CheckCircle2,
  Newspaper, ExternalLink, BookOpen, Radio, Mic,
} from "lucide-react";
import JarvisGlobe from "./JarvisGlobe";

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

interface Headline { title: string; url: string; snippet: string; }
interface DailySnapshot { empty?: boolean; date?: string; concept?: string; news?: Headline[]; }
interface FeedHighlight { name: string; platform: string; title: string; url: string; relevance_note: string; }

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
  const [listening, setListening] = useState(false);
  const [voiceMsg, setVoiceMsg] = useState<string>("");
  const [daily, setDaily] = useState<DailySnapshot | null>(null);
  const [watch, setWatch] = useState<FeedHighlight[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<any>(null);
  const levelRef = useRef(-1);            // live audio envelope for the globe (-1 = no signal)
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRafRef = useRef(0);

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
    return () => {
      clearInterval(t);
      try { window.speechSynthesis?.cancel(); } catch { /* */ }
      try { audioRef.current?.pause(); } catch { /* */ }
      try { recogRef.current?.stop(); } catch { /* */ }
      try { cancelAnimationFrame(levelRafRef.current); } catch { /* */ }
      try { audioCtxRef.current?.close(); } catch { /* */ }
    };
  }, [load]);

  // Today's AI headlines — the "front page" strip (read-only; full lesson lives on the Daily tab).
  useEffect(() => {
    fetch("/api/daily/today", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDaily(d); })
      .catch(() => { /* leave empty */ });
  }, []);

  // Watching — top relevant posts from monitored feeds (folds the Influencer Watcher into Home).
  useEffect(() => {
    fetch("/api/influencers/feed?limit=4", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (Array.isArray(d)) setWatch(d); })
      .catch(() => { /* leave empty */ });
  }, []);

  // Stop whatever's currently talking (natural audio or browser voice).
  const stopSpeaking = useCallback(() => {
    try { cancelAnimationFrame(levelRafRef.current); } catch { /* */ }
    levelRef.current = -1;
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* */ }
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    setSpeaking(false);
  }, []);

  // Drive the globe's pulse from the REAL audio via a Web Audio analyser (natural voice only;
  // the browser fallback can't be tapped, so the globe uses its synthetic envelope there).
  const attachAnalyser = useCallback((audio: HTMLAudioElement) => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = audioCtxRef.current || new AC();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const srcNode = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      srcNode.connect(analyser);
      analyser.connect(ctx.destination);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i];
        levelRef.current = Math.min(1, (sum / buf.length / 255) * 1.9); // 0..1, scaled for punch
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* analyser is a nice-to-have; ignore if the browser blocks it */ }
  }, []);

  // Speak text — prefer the natural Gemini voice (/api/tts → WAV), fall back to the free
  // browser voice on 204/quota/error. Keeps `speaking` true for the whole utterance so the
  // globe pulses in time with the actual playback.
  const speak = useCallback(async (text: string) => {
    if (!text) return;
    setSpeaking(true);
    try {
      const res = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (res.ok && res.status !== 204) {
        const buf = await res.arrayBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
        const audio = new Audio(url);
        audioRef.current = audio;
        const cleanup = () => {
          try { cancelAnimationFrame(levelRafRef.current); } catch { /* */ }
          levelRef.current = -1;
          setSpeaking(false);
          URL.revokeObjectURL(url);
        };
        audio.onended = cleanup;
        audio.onerror = cleanup;
        attachAnalyser(audio);
        await audio.play();
        return;
      }
    } catch { /* fall through to browser voice */ }
    // Fallback: free browser voice.
    try {
      const synth = window.speechSynthesis;
      if (!synth) { setSpeaking(false); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      synth.speak(u);
    } catch { setSpeaking(false); }
  }, []);

  // ▶ reads the full JARVIS standup aloud.
  const speakBriefing = async () => {
    if (speaking) { stopSpeaking(); return; }
    setVoiceMsg("");
    try {
      const d = await fetch("/api/standup").then((r) => r.json());
      const text = d?.ok ? d.text : `${data?.greeting}, ${data?.name}. ${data?.headline}`;
      await speak(text);
    } catch { setSpeaking(false); }
  };

  // 🎙 "Hey JARVIS" — record a question with the browser's Web Speech API, send it through
  // the same chat brain, then speak the reply while the globe pulses. All free.
  const askByVoice = () => {
    if (listening) { try { recogRef.current?.stop(); } catch { /* */ } return; }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) { setVoiceMsg("Voice input isn't supported in this browser — try Chrome."); return; }
    stopSpeaking();
    const recog = new SR();
    recogRef.current = recog;
    recog.lang = "en-US";
    recog.interimResults = false;
    recog.maxAlternatives = 1;
    recog.onstart = () => { setListening(true); setVoiceMsg("Listening…"); };
    recog.onerror = () => { setListening(false); setVoiceMsg("Didn't catch that."); };
    recog.onend = () => setListening(false);
    recog.onresult = async (e: any) => {
      const said = e.results?.[0]?.[0]?.transcript?.trim();
      setListening(false);
      if (!said) { setVoiceMsg("Didn't catch that."); return; }
      setVoiceMsg(`“${said}”`);
      try {
        const res = await fetch("/chat-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: said }),
        });
        const d = await res.json();
        const reply = (d?.reply || d?.response || d?.message || "").toString().trim();
        if (reply) { setVoiceMsg(reply); await speak(reply); }
        else setVoiceMsg("No reply came back.");
      } catch { setVoiceMsg("Couldn't reach JARVIS just now."); }
    };
    try { recog.start(); } catch { setListening(false); }
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
      {/* Cinematic hero — the JARVIS energy-sphere reacts to the briefing voice */}
      <section className="glass-panel rounded-2xl border border-white/5 p-6 sm:p-8 relative overflow-hidden">
        <div className="flex flex-col items-center text-center">
          <div className="text-[10px] font-mono tracking-[0.35em] text-[#8aebff]/70 uppercase mb-1">J.A.R.V.I.S</div>
          <div className="relative w-full max-w-[300px]">
            <JarvisGlobe speaking={speaking} level={levelRef} />
            {/* status ring caption */}
            <div className="absolute -bottom-1 left-0 w-full flex items-center justify-center gap-2 text-[10px] font-mono">
              <span className={`w-1.5 h-1.5 rounded-full ${speaking ? "bg-[#ffb4ab] animate-pulse" : "bg-[#5eead4]"}`} />
              <span className={speaking ? "text-[#ffb4ab]" : "text-[#5eead4]/80"}>
                {speaking ? "SPEAKING" : "SYSTEMS ONLINE"}
              </span>
            </div>
          </div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[#dfe2f3] flex items-center gap-2.5 mt-5">
            <GreetIcon className="w-6 h-6 text-[#ffd6a3]" />
            {data ? `${data.greeting}, ${data.name}.` : "Loading…"}
          </h1>
          <p className="text-sm text-[#bbc9cd] mt-2 max-w-xl">{data?.headline}</p>
          <p className="text-[11px] font-mono text-[#5c6a6d] uppercase tracking-widest mt-1">{data?.date}</p>
          <div className="flex items-center gap-3 mt-5">
            <button
              onClick={speakBriefing}
              title="Read my day aloud"
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold font-mono border transition-all cursor-pointer ${speaking ? "bg-[#ffb4ab]/10 border-[#ffb4ab]/30 text-[#ffb4ab]" : "bg-[#8aebff]/10 border-[#8aebff]/30 text-[#8aebff] hover:bg-[#8aebff]/20"}`}
            >
              {speaking ? <><Square className="w-4 h-4" /> STOP</> : <><Volume2 className="w-4 h-4" /> BRIEF ME</>}
            </button>
            <button
              onClick={askByVoice}
              title="Ask JARVIS out loud"
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold font-mono border transition-all cursor-pointer ${listening ? "bg-[#8aebff]/20 border-[#8aebff]/50 text-[#8aebff]" : "bg-white/5 border-white/10 text-[#bbc9cd] hover:border-[#8aebff]/30 hover:text-[#8aebff]"}`}
            >
              <Mic className={`w-4 h-4 ${listening ? "animate-pulse" : ""}`} /> {listening ? "LISTENING…" : "ASK"}
            </button>
          </div>
          {voiceMsg && <p className="text-[11px] font-mono text-[#859397] mt-3 max-w-lg">{voiceMsg}</p>}
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

      {/* The front page — today's 5 AI headlines (newspaper strip) */}
      <section className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
        <div className="px-5 py-3 border-b border-white/5 bg-white/[0.03] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Newspaper className="w-4 h-4 text-[#8aebff] shrink-0" />
            <h2 className="text-xs font-bold font-mono uppercase tracking-widest text-[#dfe2f3]">The Daily AI</h2>
            {daily?.date && <span className="text-[10px] font-mono text-[#5c6a6d] hidden sm:inline truncate">{daily.date}</span>}
          </div>
          <button onClick={() => onNavigate(ScreenId.Daily)} className="text-[10px] font-mono text-[#8aebff] hover:underline cursor-pointer shrink-0">read + study →</button>
        </div>
        {daily?.concept && (
          <button onClick={() => onNavigate(ScreenId.Daily)} className="w-full text-left px-5 pt-3 flex items-center gap-2 group cursor-pointer">
            <BookOpen className="w-3.5 h-3.5 text-[#a3e635] shrink-0" />
            <span className="text-[11px] font-mono text-[#859397]">Today's concept:</span>
            <span className="text-[11px] font-semibold text-[#a3e635] group-hover:underline truncate">{daily.concept}</span>
          </button>
        )}
        {daily && !daily.empty && (daily.news?.length || 0) > 0 ? (
          <ol className="divide-y divide-white/5 mt-2">
            {daily.news!.slice(0, 5).map((n, i) => (
              <li key={i}>
                <a href={n.url || "#"} target={n.url ? "_blank" : undefined} rel="noreferrer"
                  className="flex items-start gap-3 px-5 py-2.5 hover:bg-white/[0.04] transition-colors group">
                  <span className="text-[#8aebff] font-mono text-sm font-bold leading-tight w-4 shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#dfe2f3] font-medium leading-snug group-hover:text-[#8aebff] flex items-start gap-1">
                      <span className="min-w-0">{n.title || n.url}</span>
                      {n.url && <ExternalLink className="w-3 h-3 opacity-40 shrink-0 mt-1" />}
                    </p>
                    {n.snippet && <p className="text-[11px] text-[#859397] leading-relaxed mt-0.5 line-clamp-1">{n.snippet}</p>}
                  </div>
                </a>
              </li>
            ))}
          </ol>
        ) : (
          <button onClick={() => onNavigate(ScreenId.Daily)} className="w-full px-5 py-6 text-center cursor-pointer group">
            <p className="text-[12px] text-[#859397] group-hover:text-[#bbc9cd]">No edition yet today — <span className="text-[#8aebff]">generate today's update →</span></p>
          </button>
        )}
      </section>

      {/* Watching — relevant updates from monitored feeds */}
      {watch.length > 0 && (
        <section className="glass-panel rounded-2xl border border-white/5 overflow-hidden">
          <div className="px-5 py-3 border-b border-white/5 bg-white/[0.03] flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <Radio className="w-4 h-4 text-[#a3e635] shrink-0" />
              <h2 className="text-xs font-bold font-mono uppercase tracking-widest text-[#dfe2f3]">Watching</h2>
            </div>
            <button onClick={() => onNavigate(ScreenId.Discover, "influencers")} className="text-[10px] font-mono text-[#8aebff] hover:underline cursor-pointer shrink-0">all feeds →</button>
          </div>
          <ol className="divide-y divide-white/5">
            {watch.map((w, i) => (
              <li key={i}>
                <a href={w.url || "#"} target={w.url ? "_blank" : undefined} rel="noreferrer"
                  className="flex items-start gap-3 px-5 py-2.5 hover:bg-white/[0.04] transition-colors group">
                  <span className="text-[10px] font-mono text-[#5c6a6d] uppercase w-16 shrink-0 pt-0.5 truncate">{w.name}</span>
                  <div className="min-w-0">
                    <p className="text-[13px] text-[#dfe2f3] font-medium leading-snug group-hover:text-[#a3e635] flex items-start gap-1">
                      <span className="min-w-0">{w.title || w.url}</span>
                      {w.url && <ExternalLink className="w-3 h-3 opacity-40 shrink-0 mt-1" />}
                    </p>
                    {w.relevance_note && <p className="text-[11px] text-[#a3e635]/70 leading-relaxed mt-0.5 line-clamp-1">{w.relevance_note}</p>}
                  </div>
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}

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
