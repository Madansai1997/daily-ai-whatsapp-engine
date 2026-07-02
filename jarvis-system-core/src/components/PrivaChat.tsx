import { ShieldCheck } from "lucide-react";

/**
 * PrivaChat — the user's SEPARATE private-chat app, embedded as a SAME-ORIGIN iframe
 * under /privachat/ (the engine proxies it there so session/room + notifications work).
 * This is NOT the JARVIS assistant chat. It unmounts when the user leaves this tab
 * (App.tsx conditionally renders screens), so its connection doesn't keep the engine awake.
 */
export default function PrivaChat() {
  return (
    <div className="w-full flex-1 flex flex-col">
      <div className="flex items-center gap-2 mb-3">
        <ShieldCheck className="w-4 h-4 text-[#8aebff]" />
        <span className="text-sm font-mono tracking-wide text-[#8aebff] uppercase">PrivaChat</span>
        <span className="text-[11px] font-mono text-[#859397]">encrypted private session</span>
      </div>
      <div className="flex-1 rounded-xl overflow-hidden border border-white/10 bg-[#0f131f]/40 min-h-[60vh]">
        <iframe
          src="/privachat/"
          title="PrivaChat"
          allow="notifications"
          className="w-full h-full min-h-[60vh] border-0"
        />
      </div>
    </div>
  );
}
