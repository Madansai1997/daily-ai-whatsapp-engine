/* JARVIS voice agent — an app-wide, conversational voice loop.
 *
 * Design (deliberate, to make it feel like a person, not a machine):
 *  • Turn-taking: the mic is OFF while JARVIS is speaking (so it never hears its own
 *    voice — that's what kills echo on the web), then reopens the instant it finishes.
 *  • Commands first: "open jobs", "stop", "go to insights" are caught and EXECUTED
 *    before anything reaches the chat brain, so it acts instead of rambling.
 *  • Instant stop: "stop"/"pause", the STOP control, Space, or navigating all cut
 *    speech immediately.
 *  • One shared speaking state + audio level, so the Home globe pulses to the same
 *    voice everywhere.
 *
 * Everything is a hook (useVoiceAgent) used ONCE at the App root and passed down.
 */
import type React from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ScreenId } from "../types";

export type VoiceState = "off" | "idle" | "listening" | "thinking" | "speaking";

// Spoken phrase → screen. Checked before the chat brain ever sees the utterance.
const NAV_MAP: { keys: string[]; screen: ScreenId; intent?: string; label: string }[] = [
  { keys: ["home", "cockpit", "dashboard"], screen: ScreenId.Core, label: "Home" },
  { keys: ["jobs", "job board", "board", "kanban", "applications", "pipeline"], screen: ScreenId.Jobs, label: "Jobs" },
  { keys: ["insights", "analytics", "stats", "metrics"], screen: ScreenId.Insights, label: "Insights" },
  { keys: ["docs", "documents", "document", "pdf", "papers"], screen: ScreenId.Docs, label: "Docs" },
  { keys: ["bills", "payments", "expenses"], screen: ScreenId.Bills, label: "Bills" },
  { keys: ["chat", "assistant", "messages"], screen: ScreenId.Assistant, label: "Chat" },
  { keys: ["discover", "trends", "daily", "news", "feed"], screen: ScreenId.Discover, label: "Discover" },
  { keys: ["terminal", "console", "system terminal"], screen: ScreenId.Terminal, label: "Terminal" },
];

const STOP_WORDS = ["stop", "pause", "quiet", "cancel", "shut up", "be quiet", "enough",
  "silence", "never mind", "nevermind", "wait", "hold on"];
const NAV_VERB = /\b(open|go to|goto|show|take me to|switch to|bring up|navigate to|move to)\b/;

export interface Command { kind: "stop" | "navigate" | "ask"; screen?: ScreenId; intent?: string; label?: string; text: string; }

/** Pure command parser — unit-testable, no side effects. */
export function parseCommand(said: string): Command {
  const t = said.toLowerCase().trim().replace(/[.?!]+$/, "");
  if (!t) return { kind: "ask", text: said };
  if (STOP_WORDS.some((w) => t === w || t.startsWith(w + " "))) return { kind: "stop", text: said };
  const words = t.split(/\s+/);
  const hasVerb = NAV_VERB.test(t);
  for (const n of NAV_MAP) {
    for (const k of n.keys) {
      const hit = t === k || t === "open " + k || (hasVerb && t.includes(k)) || (words.length <= 3 && words.includes(k));
      if (hit) return { kind: "navigate", screen: n.screen, intent: n.intent, label: n.label, text: said };
    }
  }
  return { kind: "ask", text: said };
}

interface Options { onNavigate: (screen: ScreenId, intent?: string) => void; }

export interface VoiceAgent {
  state: VoiceState;
  active: boolean;                 // conversation running
  speaking: boolean;               // TTS currently playing
  caption: string;                 // what to show in the dock
  supported: boolean;              // Web Speech available
  level: React.MutableRefObject<number>;  // audio envelope for the globe (-1 = no signal)
  toggle: () => void;              // start / stop the conversation
  stopSpeaking: () => void;        // cut the current utterance only
  stopAll: () => void;             // stop speech + end the conversation
  sendCurrentUtterance: () => void;// manually send accumulated speech
  speak: (text: string) => Promise<void>;
  notifyManualNavigate: () => void; // call when the user navigates by hand → hush speech
}

export function useVoiceAgent({ onNavigate }: Options): VoiceAgent {
  const [state, setState] = useState<VoiceState>("off");
  const [caption, setCaption] = useState("");

  const activeRef = useRef(false);
  const stateRef = useRef<VoiceState>("off");
  const recogRef = useRef<any>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const levelRef = useRef(-1);
  const levelRafRef = useRef(0);
  const restartTimer = useRef<number | null>(null);
  const silenceTimerRef = useRef<number | null>(null);

  // Accumulated speech buffers across reconnects
  const sessionFinalTranscriptRef = useRef("");
  const currentSessionFinalRef = useRef("");
  const currentInterimRef = useRef("");

  const supported = typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const setBoth = (s: VoiceState) => { stateRef.current = s; setState(s); };

  // ── recognition (continuous hold until 'it's over' or stop) ────────────────
  const stopRecognition = useCallback(() => {
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; }
    if (silenceTimerRef.current) { clearTimeout(silenceTimerRef.current); silenceTimerRef.current = null; }
    try { recogRef.current?.abort(); } catch { /* */ }
    recogRef.current = null;
  }, []);

  const startRecognition = useCallback(() => {
    if (!activeRef.current) return;
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    stopRecognition();
    const recog = new SR();
    recogRef.current = recog;
    recog.lang = "en-US";
    recog.interimResults = true;
    recog.maxAlternatives = 1;
    recog.continuous = true;

    recog.onstart = () => {
      if (activeRef.current) setBoth("listening");
    };

    recog.onresult = (e: any) => {
      let sessionFinal = "";
      let sessionInterim = "";
      for (let i = 0; i < e.results.length; ++i) {
        if (e.results[i].isFinal) {
          sessionFinal += e.results[i][0].transcript + " ";
        } else {
          sessionInterim += e.results[i][0].transcript;
        }
      }

      currentSessionFinalRef.current = sessionFinal.trim();
      currentInterimRef.current = sessionInterim.trim();

      const fullLiveText = [
        sessionFinalTranscriptRef.current,
        currentSessionFinalRef.current,
        currentInterimRef.current
      ].filter(Boolean).join(" ").trim();

      if (fullLiveText) {
        setCaption(`“${fullLiveText}”`);
      }

      // Check for explicit cancellation phrases:
      const cancellationMatch = fullLiveText.match(/\b(cancel command|never mind|nevermind|abort command|abort|dismiss|close it out)\b[.!?, \t\n\r"'\)]*$/i);
      if (cancellationMatch) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        stopRecognition();
        sessionFinalTranscriptRef.current = "";
        currentSessionFinalRef.current = "";
        currentInterimRef.current = "";
        setCaption("Voice command cancelled.");
        stopAllRef.current();
        return;
      }

      // Check for explicit completion / closing phrases:
      const completionMatch = fullLiveText.match(/\b(it'?s over|that'?s over|it is over|that'?s it|thats it|that is it|that is all|that'?s all|thats all|i'?m done|im done|i am done|it'?s done|its done|all done|done|finished|over and out|send it|send this|send message|send|over)\b[.!?, \t\n\r"'\)]*$/i);

      if (completionMatch) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        let cleanText = fullLiveText.slice(0, completionMatch.index).trim().replace(/[,;.\s]+$/, "").trim();
        stopRecognition();
        sessionFinalTranscriptRef.current = "";
        currentSessionFinalRef.current = "";
        currentInterimRef.current = "";
        if (cleanText) {
          handleUtteranceRef.current(cleanText);
        } else {
          setCaption("No command detected.");
          scheduleRelisten(400);
        }
        return;
      }

      // Auto-finalize on comfortable pause (3.5s pause after speech has arrived)
      if (fullLiveText.length > 2) {
        if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = window.setTimeout(() => {
          if (activeRef.current && stateRef.current === "listening") {
            const finalCandidate = [
              sessionFinalTranscriptRef.current,
              currentSessionFinalRef.current,
              currentInterimRef.current
            ].filter(Boolean).join(" ").trim();
            if (finalCandidate) {
              stopRecognition();
              sessionFinalTranscriptRef.current = "";
              currentSessionFinalRef.current = "";
              currentInterimRef.current = "";
              handleUtteranceRef.current(finalCandidate);
            }
          }
        }, 3500);
      }
    };

    recog.onerror = (e: any) => {
      // no-speech / aborted are normal in continuous mode; keep holding unless permission denied
      if (activeRef.current && stateRef.current === "listening" && e?.error !== "not-allowed") {
        scheduleRelisten(400);
      } else if (e?.error === "not-allowed") {
        setCaption("Microphone blocked — allow mic access to talk.");
        stopAllRef.current();
      }
    };

    recog.onend = () => {
      // Save any final text before reopening
      if (currentSessionFinalRef.current) {
        sessionFinalTranscriptRef.current = [sessionFinalTranscriptRef.current, currentSessionFinalRef.current].filter(Boolean).join(" ").trim();
        currentSessionFinalRef.current = "";
        currentInterimRef.current = "";
      }
      // If still active & listening, immediately reopen to keep holding seamlessly
      if (activeRef.current && stateRef.current === "listening") {
        scheduleRelisten(150);
      }
    };

    try { recog.start(); } catch { scheduleRelisten(500); }
  }, [stopRecognition]);

  const scheduleRelisten = useCallback((ms: number) => {
    if (!activeRef.current) return;
    if (restartTimer.current) clearTimeout(restartTimer.current);
    restartTimer.current = window.setTimeout(() => {
      if (activeRef.current && stateRef.current !== "speaking" && stateRef.current !== "thinking") {
        startRecognition();
      }
    }, ms);
  }, [startRecognition]);

  // ── speaking (mic is off for the whole utterance) ─────────────────────────
  const attachAnalyser = useCallback((audio: HTMLAudioElement) => {
    try {
      const AC = window.AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ctx: AudioContext = audioCtxRef.current || new AC();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const src = ctx.createMediaElementSource(audio);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      const buf = new Uint8Array(analyser.frequencyBinCount);
      src.connect(analyser); analyser.connect(ctx.destination);
      const tick = () => {
        analyser.getByteFrequencyData(buf);
        let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i];
        levelRef.current = Math.min(1, (sum / buf.length / 255) * 1.9);
        levelRafRef.current = requestAnimationFrame(tick);
      };
      tick();
    } catch { /* analyser is optional */ }
  }, []);

  const afterSpeech = useCallback(() => {
    try { cancelAnimationFrame(levelRafRef.current); } catch { /* */ }
    levelRef.current = -1;
    sessionFinalTranscriptRef.current = "";
    currentSessionFinalRef.current = "";
    currentInterimRef.current = "";
    if (activeRef.current) { setBoth("listening"); startRecognition(); }
    else setBoth("idle");
  }, [startRecognition]);

  const speak = useCallback(async (text: string) => {
    if (!text) return;
    stopRecognition();               // mic OFF while talking → no echo
    setBoth("speaking");
    try {
      const res = await fetch("/api/tts", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }),
      });
      if (res.ok && res.status !== 204) {
        const buf = await res.arrayBuffer();
        const url = URL.createObjectURL(new Blob([buf], { type: "audio/wav" }));
        const audio = new Audio(url);
        audioRef.current = audio;
        const done = () => { URL.revokeObjectURL(url); if (audioRef.current === audio) audioRef.current = null; afterSpeech(); };
        audio.onended = done; audio.onerror = done;
        attachAnalyser(audio);
        await audio.play();
        return;
      }
    } catch { /* fall through to browser voice */ }
    try {
      const synth = window.speechSynthesis;
      if (!synth) { afterSpeech(); return; }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.03;
      u.onend = () => afterSpeech();
      u.onerror = () => afterSpeech();
      synth.speak(u);
    } catch { afterSpeech(); }
  }, [stopRecognition, attachAnalyser, afterSpeech]);

  const stopSpeaking = useCallback(() => {
    try { cancelAnimationFrame(levelRafRef.current); } catch { /* */ }
    levelRef.current = -1;
    sessionFinalTranscriptRef.current = "";
    currentSessionFinalRef.current = "";
    currentInterimRef.current = "";
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* */ }
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    if (activeRef.current) { setBoth("listening"); setCaption("Okay."); startRecognition(); }
    else setBoth("idle");
  }, [startRecognition]);

  // ── the turn handler: command-first, then chat ────────────────────────────
  const handleUtterance = useCallback(async (said: string) => {
    stopRecognition();
    const cmd = parseCommand(said);
    if (cmd.kind === "stop") { setCaption("Okay."); stopSpeaking(); return; }
    if (cmd.kind === "navigate" && cmd.screen) {
      setCaption(`Opening ${cmd.label}.`);
      onNavigate(cmd.screen, cmd.intent);
      await speak(`Opening ${cmd.label}.`);
      return;
    }
    // otherwise → the real brain
    setBoth("thinking");
    setCaption(`“${said}”`);
    try {
      const res = await fetch("/chat-message", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message: said }),
      });
      const d = await res.json();
      const reply = (d?.reply || d?.response || d?.message || "").toString().trim();
      if (d?.action === "open_believer_modal") {
        window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: true, shiftKey: true }));
      }
      if (reply) { setCaption(reply); await speak(reply); }
      else { setCaption("No reply came back."); afterSpeech(); }

    } catch {
      setCaption("Couldn't reach JARVIS just now.");
      afterSpeech();
    }
  }, [stopRecognition, stopSpeaking, onNavigate, speak, afterSpeech]);

  // keep the latest handler reachable from recognition callbacks (avoid stale closures)
  const handleUtteranceRef = useRef(handleUtterance);
  useEffect(() => { handleUtteranceRef.current = handleUtterance; }, [handleUtterance]);

  const sendCurrentUtterance = useCallback(() => {
    const fullLiveText = [
      sessionFinalTranscriptRef.current,
      currentSessionFinalRef.current,
      currentInterimRef.current
    ].filter(Boolean).join(" ").trim();

    stopRecognition();
    sessionFinalTranscriptRef.current = "";
    currentSessionFinalRef.current = "";
    currentInterimRef.current = "";
    if (fullLiveText) {
      handleUtterance(fullLiveText);
    } else {
      stopAll();
    }
  }, [stopRecognition, handleUtterance]);

  const stopAll = useCallback(() => {
    activeRef.current = false;
    stopRecognition();
    sessionFinalTranscriptRef.current = "";
    currentSessionFinalRef.current = "";
    currentInterimRef.current = "";
    try { audioRef.current?.pause(); audioRef.current = null; } catch { /* */ }
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    try { cancelAnimationFrame(levelRafRef.current); } catch { /* */ }
    levelRef.current = -1;
    setBoth("off");
    setCaption("");
  }, [stopRecognition]);
  const stopAllRef = useRef(stopAll);
  useEffect(() => { stopAllRef.current = stopAll; }, [stopAll]);

  const toggle = useCallback(() => {
    if (activeRef.current) {
      if (stateRef.current === "listening") {
        const fullLiveText = [
          sessionFinalTranscriptRef.current,
          currentSessionFinalRef.current,
          currentInterimRef.current
        ].filter(Boolean).join(" ").trim();
        if (fullLiveText) {
          sendCurrentUtterance();
          return;
        }
      }
      stopAll();
      return;
    }
    if (!supported) { setCaption("Voice input needs Chrome or Edge."); return; }
    activeRef.current = true;
    sessionFinalTranscriptRef.current = "";
    currentSessionFinalRef.current = "";
    currentInterimRef.current = "";
    setCaption("Holding mic… speak freely. Say “it's over” to send.");
    setBoth("listening");
    startRecognition();
  }, [supported, stopAll, startRecognition, sendCurrentUtterance]);

  // User navigated by hand → hush any speech but keep the conversation alive.
  const notifyManualNavigate = useCallback(() => {
    if (stateRef.current === "speaking") stopSpeaking();
  }, [stopSpeaking]);

  // Teardown on unmount.
  useEffect(() => () => { stopAllRef.current(); try { audioCtxRef.current?.close(); } catch { /* */ } }, []);

  return {
    state, active: state !== "off", speaking: state === "speaking", caption, supported,
    level: levelRef, toggle, stopSpeaking, stopAll, sendCurrentUtterance, speak, notifyManualNavigate,
  };
}
