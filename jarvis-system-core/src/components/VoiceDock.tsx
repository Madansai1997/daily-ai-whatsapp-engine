import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Mic, Square, Loader2, Volume2, X } from "lucide-react";
import type { VoiceAgent } from "../lib/voiceAgent";

/* Always-on, app-wide voice control. Collapsed = a mic button; active = a live dock
 * showing state (listening / thinking / speaking) + the last line, with an instant STOP.
 * Space cuts speech from anywhere (except while typing). */
export default function VoiceDock({ agent }: { agent: VoiceAgent }) {
  const { state, active, speaking, caption, supported, toggle, stopSpeaking, stopAll } = agent;

  // No SpeechRecognition (Firefox/Safari desktop, some webviews) → hide the dock entirely
  // rather than show a mic that silently does nothing.
  if (!supported) return null;

  // Space = instant stop while speaking (ignored when typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const typing = el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      if (e.code === "Space" && speaking && !typing) { e.preventDefault(); stopSpeaking(); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [speaking, stopSpeaking]);

  const dot =
    state === "listening" ? { c: "#8aebff", label: "Listening…" } :
    state === "thinking" ? { c: "#ffd6a3", label: "Thinking…" } :
    state === "speaking" ? { c: "#5eead4", label: "Speaking…" } :
    { c: "#859397", label: "" };

  return (
    <div className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-[70] flex flex-col items-end gap-2">
      <AnimatePresence>
        {active && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 12, scale: 0.96 }}
            className="w-[min(78vw,360px)] glass-panel rounded-2xl border border-[#8aebff]/20 bg-[#0f131f]/90 backdrop-blur-md p-4 shadow-2xl"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="relative flex h-2.5 w-2.5">
                  {state !== "off" && <span className="absolute inline-flex h-full w-full rounded-full opacity-60 animate-ping" style={{ background: dot.c }} />}
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ background: dot.c }} />
                </span>
                <span className="text-[11px] font-mono uppercase tracking-widest" style={{ color: dot.c }}>{dot.label}</span>
              </div>
              <button onClick={stopAll} title="End voice" className="text-[#859397] hover:text-[#ffb4ab] cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            {caption && <p className="text-[13px] text-[#dfe2f3] leading-relaxed max-h-28 overflow-y-auto">{caption}</p>}
            <div className="flex items-center gap-2 mt-3">
              {speaking ? (
                <button onClick={stopSpeaking} className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-bold font-mono bg-[#ffb4ab]/15 border border-[#ffb4ab]/30 text-[#ffb4ab] hover:bg-[#ffb4ab]/25 cursor-pointer">
                  <Square className="w-3.5 h-3.5" /> STOP <span className="opacity-50 font-normal">(space)</span>
                </button>
              ) : (
                <div className="flex-1 flex items-center gap-2 text-[10px] font-mono text-[#859397]">
                  <Mic className="w-3.5 h-3.5" /> Say “open jobs”, ask a question, or say “stop”.
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Persistent mic button */}
      <button
        onClick={toggle}
        title={active ? "End voice conversation" : "Talk to JARVIS"}
        className={`flex items-center justify-center rounded-full shadow-xl transition-all cursor-pointer border ${
          active
            ? "w-12 h-12 bg-[#ffb4ab]/15 border-[#ffb4ab]/40 text-[#ffb4ab]"
            : "w-14 h-14 bg-[#8aebff]/15 border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff]/25"
        }`}
      >
        {active
          ? (state === "thinking" ? <Loader2 className="w-5 h-5 animate-spin" /> : state === "speaking" ? <Volume2 className="w-5 h-5" /> : <Square className="w-5 h-5" />)
          : <Mic className="w-6 h-6" />}
      </button>
    </div>
  );
}
