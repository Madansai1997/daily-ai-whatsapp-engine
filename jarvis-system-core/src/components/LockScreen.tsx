import React, { useState, useEffect, useCallback } from "react";
import { motion } from "motion/react";
import { Delete, Lock, ShieldCheck, Play } from "lucide-react";
import { login, loginDemo, authStatus } from "../lib/auth";

interface LockScreenProps {
  onUnlock: () => void;
}

const MAX_LEN = 8;

export default function LockScreen({ onUnlock }: LockScreenProps) {
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);
  const [demoAvailable, setDemoAvailable] = useState(false);

  useEffect(() => {
    authStatus().then((s) => setDemoAvailable(!!s.demo_available));
  }, []);

  const startDemo = useCallback(async () => {
    setBusy(true);
    setError("");
    const r = await loginDemo();
    if (r.ok) { onUnlock(); return; }
    setError(r.error || "Demo unavailable.");
    setBusy(false);
  }, [onUnlock]);

  const submit = useCallback(async (value: string) => {
    setBusy(true);
    setError("");
    const r = await login(value);
    if (r.ok) {
      onUnlock();
      return;
    }
    setError(r.error || "Incorrect PIN.");
    setPin("");
    setShake(true);
    setTimeout(() => setShake(false), 500);
    setBusy(false);
  }, [onUnlock]);

  const press = useCallback((d: string) => {
    if (busy) return;
    setError("");
    setPin((p) => (p.length >= MAX_LEN ? p : p + d));
  }, [busy]);

  const backspace = useCallback(() => setPin((p) => p.slice(0, -1)), []);

  // Physical keyboard support
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy) return;
      if (e.key >= "0" && e.key <= "9") press(e.key);
      else if (e.key === "Backspace") backspace();
      else if (e.key === "Enter" && pin.length >= 4) submit(pin);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pin, busy, press, backspace, submit]);

  const keys = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#0a0e1a] bg-hud-cinematic text-[#dfe2f3] px-6">
      <div className="scanline"></div>
      <div className="fixed inset-0 bg-[#0a0e1a]/60 pointer-events-none"></div>

      <motion.div
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.35 }}
        className="relative z-10 w-full max-w-xs flex flex-col items-center"
      >
        <div className="w-14 h-14 rounded-full border border-[#8aebff]/30 bg-[#1b1f2c] flex items-center justify-center mb-4 glow-cyan">
          <Lock className="w-6 h-6 text-[#8aebff]" />
        </div>
        <h1 className="text-lg font-bold font-mono tracking-widest text-[#8aebff] uppercase glow-cyan">
          JARVIS Locked
        </h1>
        <p className="text-[11px] font-mono text-[#859397] mb-6">Enter access PIN</p>

        {/* PIN dots */}
        <motion.div
          animate={shake ? { x: [-8, 8, -6, 6, -3, 3, 0] } : {}}
          transition={{ duration: 0.45 }}
          className="flex items-center gap-3 h-6 mb-2"
        >
          {Array.from({ length: Math.max(MAX_LEN, pin.length) }).slice(0, Math.max(4, pin.length || 4)).map((_, i) => (
            <span
              key={i}
              className={`w-3 h-3 rounded-full border transition-all ${
                i < pin.length
                  ? "bg-[#8aebff] border-[#8aebff] shadow-[0_0_8px_rgba(138,235,255,0.6)]"
                  : "border-[#3c494c]"
              }`}
            ></span>
          ))}
        </motion.div>

        <div className="h-5 mb-4">
          {error && <p className="text-[11px] font-mono text-[#ff6b6b]">{error}</p>}
        </div>

        {/* Keypad */}
        <div className="grid grid-cols-3 gap-3">
          {keys.map((k) => (
            <button
              key={k}
              onClick={() => press(k)}
              disabled={busy}
              className="w-16 h-16 rounded-full border border-[#3c494c] bg-[#1b1f2c]/50 text-xl font-mono font-bold text-[#dfe2f3] hover:border-[#8aebff]/60 hover:text-[#8aebff] active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
            >
              {k}
            </button>
          ))}
          <button
            onClick={backspace}
            disabled={busy}
            className="w-16 h-16 rounded-full flex items-center justify-center text-[#859397] hover:text-[#ffb4ab] active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
            aria-label="Backspace"
          >
            <Delete className="w-6 h-6" />
          </button>
          <button
            onClick={() => press("0")}
            disabled={busy}
            className="w-16 h-16 rounded-full border border-[#3c494c] bg-[#1b1f2c]/50 text-xl font-mono font-bold text-[#dfe2f3] hover:border-[#8aebff]/60 hover:text-[#8aebff] active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
          >
            0
          </button>
          <button
            onClick={() => pin.length >= 4 && submit(pin)}
            disabled={busy || pin.length < 4}
            className="w-16 h-16 rounded-full flex items-center justify-center bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] active:scale-95 transition-all disabled:opacity-30 cursor-pointer"
            aria-label="Unlock"
          >
            <ShieldCheck className="w-6 h-6" />
          </button>
        </div>

        {demoAvailable && (
          <button
            onClick={startDemo}
            disabled={busy}
            className="mt-7 flex items-center gap-2 px-5 py-2.5 rounded-full border border-[#8aebff]/25 bg-[#8aebff]/[0.06] text-[11px] font-mono font-semibold text-[#8aebff] tracking-wider hover:bg-[#8aebff]/15 active:scale-95 transition-all disabled:opacity-40 cursor-pointer"
          >
            <Play className="w-3.5 h-3.5" /> EXPLORE THE DEMO
          </button>
        )}

        <p className="text-[10px] font-mono text-[#859397]/60 mt-6 tracking-wider">
          {demoAvailable ? "SAMPLE DATA · NO SIGN-IN NEEDED" : "AUTHORIZED ACCESS ONLY"}
        </p>
      </motion.div>
    </div>
  );
}
