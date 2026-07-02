import React, { useState, useEffect, useRef, useCallback } from "react";
import { motion } from "motion/react";
import { Brain, Terminal as TerminalIcon, Volume2, Mic, Paperclip, Lock } from "lucide-react";

// ---- Inline types ----
interface TerminalLine {
  id: string;
  type: "system" | "prompt" | "reply";
  text: string;
  time?: string;
  glow?: boolean;
}

// Shape of a row returned by GET /local-queue/history
interface QueueCommand {
  id: number;
  command_type: string;
  payload: unknown;
  status: string;
  result?: unknown;
  created_at?: string;
  completed_at?: string;
}

interface HistoryResponse {
  commands?: QueueCommand[];
}

interface ChatResponse {
  reply?: string;
}

// Best-effort stringify of an unknown payload/result field for terminal display.
function summarize(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  try {
    const s = JSON.stringify(value);
    return s.length > 400 ? s.slice(0, 400) + "…" : s;
  } catch {
    return String(value);
  }
}

export default function SystemTerminal() {
  const [terminalLines, setTerminalLines] = useState<TerminalLine[]>([
    { id: "1", type: "system", text: "[SYSTEM] BOOT SEQUENCE INITIATED..." },
    { id: "2", type: "system", text: "[SYSTEM] KERNEL VERSION 14.8.2-STARK" },
    { id: "3", type: "system", text: "[SYSTEM] NEURAL CORE HANDSHAKE... SUCCESS" },
    { id: "4", type: "system", text: "[SYSTEM] IDENTITY VERIFIED: TONY STARK" },
  ]);
  const [commandInput, setCommandInput] = useState("");
  const [ccMode, setCcMode] = useState(false);
  const [sending, setSending] = useState(false);
  const terminalBodyRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastIdRef = useRef<number>(0);

  const appendLines = useCallback((lines: TerminalLine[]) => {
    setTerminalLines((prev) => [...prev, ...lines]);
  }, []);

  // Auto-scroll terminal lines whenever content changes
  useEffect(() => {
    terminalBodyRef.current?.scrollTo({
      top: terminalBodyRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [terminalLines]);

  // ---- STEP 2: poll the live command feed ----
  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        const res = await fetch(
          `/local-queue/history?after_id=${lastIdRef.current}&limit=30`
        );
        if (!res.ok) return;
        const data: HistoryResponse = await res.json();
        const rows = data.commands ?? [];
        if (cancelled || rows.length === 0) return;

        const newLines: TerminalLine[] = [];
        for (const row of rows) {
          if (row.id <= lastIdRef.current) continue;
          lastIdRef.current = row.id;

          const payloadSummary = summarize(row.payload);
          const head =
            `[${(row.command_type || "cmd").toUpperCase()}] ` +
            (payloadSummary ? `${payloadSummary} ` : "") +
            `(${(row.status || "?").toUpperCase()})`;
          newLines.push({
            id: `q-${row.id}`,
            type: "prompt",
            text: head,
            time: row.created_at,
          });

          const resultSummary = summarize(row.result);
          if (resultSummary) {
            newLines.push({
              id: `q-${row.id}-r`,
              type: "reply",
              text: resultSummary,
              time: row.completed_at,
            });
          }
        }
        if (!cancelled && newLines.length) appendLines(newLines);
      } catch {
        // Network hiccup — degrade gracefully, try again next tick.
      }
    };

    poll();
    const interval = setInterval(poll, 4000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [appendLines]);

  // ---- STEP 3 / 5: send a chat message (typed command / approve) ----
  const sendChat = useCallback(
    async (rawMessage: string, echoLabel?: string) => {
      const message = rawMessage.trim();
      if (!message || sending) return;
      setSending(true);

      const stamp = Date.now();
      appendLines([
        {
          id: `prompt-${stamp}`,
          type: "prompt",
          text: `$ ${(echoLabel ?? message).toUpperCase()}`,
        },
      ]);

      try {
        const res = await fetch("/chat-message", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ChatResponse = await res.json();
        appendLines([
          {
            id: `reply-${stamp}`,
            type: "reply",
            text: data.reply ?? "[JARVIS]: (no reply)",
          },
        ]);
      } catch (err) {
        appendLines([
          {
            id: `reply-${stamp}`,
            type: "reply",
            text: `[JARVIS WARNING]: Transmission failed — ${
              err instanceof Error ? err.message : "unknown error"
            }.`,
          },
        ]);
      } finally {
        setSending(false);
      }
    },
    [appendLines, sending]
  );

  const handleTransmit = () => {
    const val = commandInput.trim();
    if (!val) return;
    setCommandInput("");
    // Local convenience: clear the buffer without a round-trip.
    if (val.toLowerCase() === "clear") {
      setTerminalLines([
        {
          id: `init-${Date.now()}`,
          type: "system",
          text: "[LOG BUFFER FLUSHED -- NEW SESSION INITIATED]",
        },
      ]);
      return;
    }
    // STEP 5: in Claude Code mode, prefix the raw input.
    const message = ccMode ? `claude code: ${val}` : val;
    sendChat(message, val);
  };

  // ---- STEP 5: approve a proposed Claude Code change ----
  const approveClaudeCode = () => {
    sendChat("approve claude code", "APPROVE CLAUDE CODE");
  };

  // ---- STEP 4: PDF upload ----
  const handlePickPdf = () => fileInputRef.current?.click();

  const handlePdfSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // Reset so picking the same file again re-triggers change.
    e.target.value = "";
    if (!file) return;

    const stamp = Date.now();
    appendLines([
      { id: `pdf-${stamp}`, type: "prompt", text: `$ UPLOAD PDF: ${file.name.toUpperCase()}` },
    ]);

    try {
      const formData = new FormData();
      // Field name must match FastAPI: `file: UploadFile = File(...)`
      formData.append("file", file);
      const res = await fetch("/web-terminal/upload-pdf", {
        method: "POST",
        body: formData,
      });
      const data: ChatResponse = await res.json().catch(() => ({}));
      appendLines([
        {
          id: `pdf-${stamp}-r`,
          type: "reply",
          text: data.reply ?? (res.ok ? "[JARVIS]: PDF processed." : "[JARVIS WARNING]: Upload failed."),
        },
      ]);
    } catch (err) {
      appendLines([
        {
          id: `pdf-${stamp}-r`,
          type: "reply",
          text: `[JARVIS WARNING]: PDF upload failed — ${
            err instanceof Error ? err.message : "unknown error"
          }.`,
        },
      ]);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col h-[calc(100vh-140px)] gap-6"
    >
      {/* Terminal Output logs and Input Prompt */}
      <main className="flex-1 flex flex-col bg-[#0a0e1a]/70 hairline-cyan rounded-lg overflow-hidden relative">
        {/* Terminal tab bar */}
        <div className="h-12 border-b border-[#8aebff]/20 px-6 flex items-center justify-between bg-black/20 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <TerminalIcon className="w-4 h-4 text-[#8aebff]" />
            <span className="text-[10px] font-mono text-[#8aebff] tracking-tight font-bold uppercase">
              ROOT@JARVIS: ~ (SESSION: CLAUDE_HUD_X1)
            </span>
          </div>
          <div className="hidden lg:flex gap-6 text-[9px] font-mono text-[#8aebff]/40 uppercase tracking-[0.15em]">
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8aebff]/50"></span>
              ENCRYPTION: AES-256-GCM
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8aebff]/50"></span>
              BUFFER: 4096KB
            </span>
            <span className="text-[#8aebff]/70 font-bold border-l border-white/10 pl-6 ml-2">
              STARK_SAT_LINK_7
            </span>
          </div>
        </div>

        {/* Terminal output stream list */}
        <div
          ref={terminalBodyRef}
          className="flex-1 p-8 overflow-y-auto terminal-scroll font-mono text-sm leading-relaxed space-y-6"
        >
          <div className="space-y-1.5 opacity-40 text-xs">
            {terminalLines
              .filter((l) => l.type === "system")
              .slice(0, 4)
              .map((l) => (
                <p key={l.id} className="text-[#8aebff]/70">
                  {l.text}
                </p>
              ))}
            <div className="h-[1px] w-24 bg-[#8aebff]/20 my-4"></div>
          </div>

          <p className="text-[#8aebff] font-bold text-lg glow-cyan tracking-wide">
            J.A.R.V.I.S. online. Command protocol active.
          </p>

          {/* Claude Code mode banner + approve control */}
          {ccMode && (
            <div className="border border-[#8aebff]/15 border-l-4 border-l-[#8aebff] p-6 bg-[#8aebff]/5 rounded-r-lg backdrop-blur-sm space-y-4 max-w-2xl">
              <div className="flex items-center gap-3">
                <Brain className="w-5 h-5 text-[#8aebff]" />
                <p className="text-[#8aebff] font-bold tracking-widest uppercase text-xs">
                  Claude Code Mode Active
                </p>
              </div>
              <p className="text-[#bbc9cd] leading-relaxed text-sm">
                Typed commands are now prefixed with{" "}
                <span className="bg-[#8aebff]/20 px-2 py-0.5 rounded text-[#8aebff] font-bold">
                  claude code:
                </span>{" "}
                before transmission. Approve a proposed change once JARVIS
                reports its plan.
              </p>
              <div className="flex gap-4 pt-2">
                <button
                  onClick={approveClaudeCode}
                  disabled={sending}
                  className="text-[10px] uppercase font-bold tracking-widest text-[#8aebff] border border-[#8aebff]/30 px-5 py-2 rounded bg-[#8aebff]/10 hover:bg-[#8aebff]/20 transition-all cursor-pointer font-mono disabled:opacity-40"
                >
                  ✅ Approve Claude Code
                </button>
              </div>
            </div>
          )}

          {/* Dynamically appended prompt/reply/feed terminal lines */}
          <div className="space-y-4 pt-4 border-t border-white/5">
            {terminalLines
              .filter((l) => l.type !== "system")
              .map((line) => (
                <div key={line.id}>
                  {line.type === "prompt" ? (
                    <div className="flex gap-3 items-center">
                      <span className="text-[#8aebff] font-black opacity-40 select-none">$</span>
                      <span className="text-[#8aebff] font-semibold tracking-widest break-all">
                        {line.text}
                      </span>
                    </div>
                  ) : (
                    <div className="text-[#8aebff]/70 italic ml-6 border-l-2 border-white/10 pl-4 py-1 leading-relaxed text-xs whitespace-pre-wrap break-words">
                      {line.text}
                    </div>
                  )}
                </div>
              ))}
          </div>
        </div>

        {/* Terminal shell input prompt */}
        <div className="p-6 bg-black/20 border-t border-[#8aebff]/15 backdrop-blur-md shrink-0">
          <div className="flex items-center gap-4 bg-black/40 border border-[#8aebff]/30 rounded-lg px-4 py-3 glow-cyan-border transition-all focus-within:border-[#8aebff]/60">
            <span className="text-[#8aebff] font-bold text-xl leading-none font-mono select-none">
              &gt;_
            </span>
            <input
              className="flex-1 min-w-0 bg-transparent border-none focus:ring-0 text-[#8aebff] font-mono text-base outline-none p-0"
              placeholder={ccMode ? "claude code › enter directive…" : "Enter system command..."}
              value={commandInput}
              onChange={(e) => setCommandInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") handleTransmit();
              }}
            />

            {/* Hidden PDF file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={handlePdfSelected}
            />

            <div className="flex items-center gap-3 text-[#8aebff]/50 shrink-0">
              {/* PDF upload */}
              <button
                onClick={handlePickPdf}
                title="Upload PDF"
                className="hover:text-[#8aebff] transition-colors p-1 cursor-pointer"
              >
                <Paperclip className="w-5 h-5" />
              </button>

              {/* Claude Code mode toggle */}
              <button
                onClick={() => setCcMode((v) => !v)}
                title="Toggle Claude Code mode"
                className={`transition-colors p-1 cursor-pointer ${
                  ccMode ? "text-[#8aebff]" : "hover:text-[#8aebff]"
                }`}
              >
                <Lock className="w-5 h-5" />
              </button>

              <button className="hover:text-[#8aebff] transition-colors p-1 cursor-pointer">
                <Volume2 className="w-5 h-5" />
              </button>
              <button className="hover:text-[#8aebff] transition-colors p-1 cursor-pointer">
                <Mic className="w-5 h-5" />
              </button>
              <button
                onClick={handleTransmit}
                disabled={sending}
                className="bg-[#8aebff]/10 hover:bg-[#8aebff]/25 text-[#8aebff] px-4 py-1.5 rounded text-[11px] font-bold uppercase tracking-[0.2em] transition-all border border-[#8aebff]/30 active:scale-95 cursor-pointer font-mono shrink-0 flex items-center justify-center disabled:opacity-40"
              >
                {sending ? "..." : "Transmit"}
              </button>
            </div>
          </div>
        </div>
      </main>
    </motion.div>
  );
}
