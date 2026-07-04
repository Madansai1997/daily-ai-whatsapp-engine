import React, { useState, useRef, useEffect } from "react";
import { ChatMessage } from "../types";
import { motion } from "motion/react";
import { Plus, Mic, Send, Volume2, VolumeX } from "lucide-react";

/**
 * Backend contract (same-origin FastAPI, API paths are absolute-from-root):
 *   GET  /chat-history  -> { messages: { role: "user" | "assistant"; content: string; timestamp?: string }[] }  (oldest first)
 *   POST /chat-message  { message: string } -> { reply: string }
 */
interface ChatHistoryEntry {
  role: "user" | "assistant";
  content: string;
  timestamp?: string;
}
interface ChatHistoryResponse {
  messages: ChatHistoryEntry[];
}
interface ChatMessageResponse {
  reply: string;
}

// Minimal Web Speech API typing (avoids relying on lib.dom SpeechRecognition types).
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
};

const nowTime = () =>
  new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

// Turn a backend ISO/timestamp (or nothing) into the short display time.
// SQLite CURRENT_TIMESTAMP is UTC but emits "YYYY-MM-DD HH:MM:SS" with no zone
// marker, which V8 parses as *local* time — shifting history by the UTC offset.
// Normalize such naive strings to explicit UTC so they render in the correct
// local time, matching live-sent messages (which use nowTime()).
const formatTime = (ts?: string): string => {
  if (!ts) return nowTime();
  let iso = ts.trim();
  if (
    /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(iso) &&
    !/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)
  ) {
    iso = iso.replace(" ", "T") + "Z";
  }
  const d = new Date(iso);
  if (isNaN(d.getTime())) return ts;
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

// Strip markdown / emojis so speech synthesis reads clean prose.
const cleanForSpeech = (text: string): string => {
  return text
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]*)`/g, "$1") // inline code
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1") // links / images
    .replace(/[*_~#>]/g, "") // markdown emphasis / headings
    .replace(
      /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu,
      ""
    ) // emojis & symbols
    .replace(/\s+/g, " ")
    .trim();
};

export default function SecureChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputVal, setInputVal] = useState("");

  const [isThinking, setIsThinking] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [voiceOutput, setVoiceOutput] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

  // Feature detection (evaluated once at module-run; safe for SSR-less Vite build).
  const speechRecognitionSupported =
    typeof window !== "undefined" &&
    !!((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const speechSynthesisSupported =
    typeof window !== "undefined" && "speechSynthesis" in window;

  // Auto-scroll chat to bottom whenever messages or thinking state change.
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isThinking]);

  // Load real chat history on mount.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/chat-history");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: ChatHistoryResponse = await res.json();
        if (cancelled) return;
        const mapped: ChatMessage[] = (data.messages || []).map((m, idx) => ({
          id: `hist-${idx}-${m.timestamp ?? idx}`,
          sender: m.role === "assistant" ? "JARVIS" : "User_Admin",
          time: formatTime(m.timestamp),
          content: m.content
        }));
        setMessages(mapped);
      } catch (err) {
        if (!cancelled) {
          setHistoryError(
            "Unable to establish secure channel with the assistant core."
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Speak a JARVIS reply aloud when voice output is enabled.
  const speak = (text: string) => {
    if (!voiceOutput || !speechSynthesisSupported) return;
    const clean = cleanForSpeech(text);
    if (!clean) return;
    try {
      const utter = new SpeechSynthesisUtterance(clean);
      window.speechSynthesis.cancel(); // avoid overlap
      window.speechSynthesis.speak(utter);
    } catch {
      /* speech synthesis failed silently */
    }
  };

  const sendMessage = async (raw: string) => {
    const commandText = raw.trim();
    if (!commandText || isThinking) return;

    const userMsg: ChatMessage = {
      id: `msg-user-${Date.now()}`,
      sender: "User_Admin",
      time: nowTime(),
      content: commandText
    };
    setMessages((prev) => [...prev, userMsg]);
    setInputVal("");
    setIsThinking(true);

    try {
      const res = await fetch("/chat-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: commandText })
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ChatMessageResponse = await res.json();
      const replyText = data.reply ?? "";
      const jarvisMsg: ChatMessage = {
        id: `msg-jarvis-${Date.now()}`,
        sender: "JARVIS",
        time: nowTime(),
        content: replyText
      };
      setMessages((prev) => [...prev, jarvisMsg]);
      speak(replyText);
    } catch (err) {
      const errMsg: ChatMessage = {
        id: `msg-err-${Date.now()}`,
        sender: "JARVIS",
        time: nowTime(),
        content:
          "Signal lost. I was unable to reach the core to process that request. Please try again."
      };
      setMessages((prev) => [...prev, errMsg]);
    } finally {
      setIsThinking(false);
    }
  };

  const handleSend = () => {
    sendMessage(inputVal);
  };

  // --- Voice input (Web Speech API) ---
  const toggleListening = () => {
    if (!speechRecognitionSupported) return;

    if (isListening) {
      recognitionRef.current?.stop();
      return;
    }

    const SR =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;
    const recognition: SpeechRecognitionInstance = new SR();
    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript ?? "";
      if (transcript) {
        setInputVal((prev) => (prev ? `${prev} ${transcript}` : transcript));
      }
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
    }
  };

  const toggleVoiceOutput = () => {
    setVoiceOutput((prev) => {
      const next = !prev;
      // If turning off, stop any in-progress speech.
      if (!next && speechSynthesisSupported) {
        try {
          window.speechSynthesis.cancel();
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="flex flex-col h-[calc(100vh-140px)]"
    >
      {/* Encryption Status indicator */}
      <div className="mt-2 mb-4 flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <div className="w-2.5 h-2.5 rounded-full bg-[#8aebff] shadow-[0_0_10px_#8aebff]"></div>
          <h3 className="text-[#8aebff] font-bold text-xs tracking-[0.2em] uppercase font-mono">
            Encryption Status
          </h3>
        </div>
        <p className="text-[10px] font-mono text-[#8aebff]/60 tracking-widest uppercase ml-5">
          Level 7 Secure Channel // Active
        </p>
      </div>

      {/* Main chat interface */}
      <section className="flex-1 glass-panel rounded-2xl flex flex-col overflow-hidden">
        {/* Chat window header */}
        <div className="px-6 py-4 border-b border-[#8aebff]/10 bg-[#1b1f2c]/30 flex justify-between items-center">
          <div>
            <h2 className="text-lg font-bold text-[#dfe2f3] flex items-center gap-3 tracking-wide">
              JARVIS Assistant
              <span className="px-2 py-0.5 bg-[#8aebff]/10 rounded text-[9px] font-mono text-[#8aebff] border border-[#8aebff]/20 tracking-widest font-semibold">
                #8821-X
              </span>
            </h2>
            <p className="text-[11px] font-mono text-[#8aebff]/60 flex items-center gap-2 mt-1 uppercase tracking-wider">
              <span className="w-1.5 h-1.5 rounded-full bg-[#8aebff] animate-pulse"></span>
              End-to-end encrypted protocol engaged.
            </p>
          </div>

          <div className="flex items-center gap-2 bg-[#8aebff]/5 rounded-full px-4 py-1.5 border border-[#8aebff]/20">
            <span className="w-1.5 h-1.5 rounded-full bg-[#34d399] animate-pulse"></span>
            <span className="text-[10px] font-mono text-[#8aebff] tracking-widest uppercase font-semibold">
              Online
            </span>
          </div>
        </div>

            {/* Chat message logs scrollbox */}
            <div className="flex-1 overflow-y-auto px-6 py-8 space-y-8 custom-scrollbar">
              {historyError && (
                <div className="text-[11px] font-mono text-[#ffb4ab]/80 tracking-wide text-center">
                  {historyError}
                </div>
              )}
              {messages.map((msg) => {
                const isJarvis = msg.sender === "JARVIS";
                return (
                  <div
                    key={msg.id}
                    className={`flex flex-col ${
                      isJarvis ? "items-start max-w-2xl" : "items-end"
                    }`}
                  >
                    {/* Message Meta Info */}
                    <div className="flex items-center gap-2 mb-1 px-1">
                      {isJarvis && (
                        <div className="w-1.5 h-1.5 rounded-full bg-[#8aebff]"></div>
                      )}
                      <span
                        className={`text-[10px] font-mono tracking-widest uppercase font-bold ${
                          isJarvis ? "text-[#8aebff]" : "text-[#dfe2f3]"
                        }`}
                      >
                        {msg.sender === "JARVIS" ? "JARVIS" : "User_Admin"}
                      </span>
                      <span className="text-[9px] font-mono text-[#8aebff]/30">
                        {msg.time}
                      </span>
                      {!isJarvis && (
                        <div className="w-1.5 h-1.5 rounded-full border border-[#8aebff]/50"></div>
                      )}
                    </div>

                    {/* Message Balloon */}
                    <div
                      className={`p-5 rounded-xl backdrop-blur-md relative overflow-hidden text-sm leading-relaxed ${
                        isJarvis
                          ? "hologram-bubble rounded-tl-none border-l-2 border-l-[#8aebff]"
                          : "user-bubble rounded-tr-none text-right text-[#8aebff]/90 max-w-xl"
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>

                      {/* Diagnostic details box for JARVIS */}
                      {isJarvis && msg.codeBlock && (
                        <div className="bg-[#0a0e1a]/60 p-4 rounded-lg border border-[#8aebff]/20 font-mono text-xs text-[#8aebff]/80 mt-4 backdrop-blur-sm">
                          <div className="flex items-center gap-2 mb-2 text-[#8aebff]/40">
                            <span className="text-[10px] font-bold uppercase tracking-wider">
                              {msg.codeBlock.title}
                            </span>
                          </div>
                          <code className="block space-y-1">
                            {msg.codeBlock.lines.map((line, idx) => {
                              let style = "text-[#8aebff]/60";
                              if (line.includes("[WARN]"))
                                style = "text-[#ffb4ab]/80";
                              if (line.includes("[OK]"))
                                style = "text-[#8aebff]/90";
                              return (
                                <span key={idx} className="block">
                                  <span className={style}>
                                    {line.slice(0, 8)}
                                  </span>
                                  {line.slice(8)}
                                </span>
                              );
                            })}
                          </code>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Thinking / typing indicator */}
              {isThinking && (
                <div className="flex flex-col items-start max-w-2xl">
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <div className="w-1.5 h-1.5 rounded-full bg-[#8aebff]"></div>
                    <span className="text-[10px] font-mono tracking-widest uppercase font-bold text-[#8aebff]">
                      JARVIS
                    </span>
                  </div>
                  <div className="p-5 rounded-xl rounded-tl-none hologram-bubble border-l-2 border-l-[#8aebff] backdrop-blur-md">
                    <div className="flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-[#8aebff] animate-pulse"></span>
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#8aebff] animate-pulse"
                        style={{ animationDelay: "0.15s" }}
                      ></span>
                      <span
                        className="w-1.5 h-1.5 rounded-full bg-[#8aebff] animate-pulse"
                        style={{ animationDelay: "0.3s" }}
                      ></span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={chatEndRef}></div>
            </div>

            {/* Chat user input dock */}
            <div className="p-6 pt-0">
              <div className="max-w-4xl mx-auto relative">
                <div className="flex items-center gap-3 bg-[#161e2e]/40 backdrop-blur-2xl rounded-full px-5 py-2.5 border border-[#8aebff]/20 shadow-2xl">
                  <button
                    className="text-[#8aebff]/40 hover:text-[#8aebff] transition-colors p-2 cursor-pointer"
                    title="Attach Protocol File"
                  >
                    <Plus className="w-5 h-5" />
                  </button>
                  <div className="h-4 w-[1px] bg-[#8aebff]/20 mx-1"></div>
                  <input
                    className="flex-1 bg-transparent border-none focus:ring-0 text-sm text-[#dfe2f3] placeholder:text-[#8aebff]/20 px-2 outline-none"
                    placeholder="Type a secure command..."
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSend();
                    }}
                  />
                  <div className="flex items-center gap-2">
                    {/* Voice input (mic) — only render when supported */}
                    {speechRecognitionSupported && (
                      <button
                        onClick={toggleListening}
                        className={`p-2 transition-colors cursor-pointer ${
                          isListening
                            ? "text-[#8aebff] animate-pulse"
                            : "text-[#8aebff]/40 hover:text-[#8aebff]"
                        }`}
                        title={
                          isListening
                            ? "Listening… click to stop"
                            : "Voice Command"
                        }
                      >
                        <Mic className="w-4.5 h-4.5" />
                      </button>
                    )}
                    {/* Voice output toggle — only render when supported */}
                    {speechSynthesisSupported && (
                      <button
                        onClick={toggleVoiceOutput}
                        className={`p-2 transition-colors cursor-pointer ${
                          voiceOutput
                            ? "text-[#8aebff]"
                            : "text-[#8aebff]/40 hover:text-[#8aebff]"
                        }`}
                        title={
                          voiceOutput
                            ? "Voice Synthesis: ON"
                            : "Voice Synthesis: OFF"
                        }
                      >
                        {voiceOutput ? (
                          <Volume2 className="w-4.5 h-4.5" />
                        ) : (
                          <VolumeX className="w-4.5 h-4.5" />
                        )}
                      </button>
                    )}
                    <button
                      onClick={handleSend}
                      disabled={isThinking}
                      className="bg-[#8aebff] text-[#00363e] w-9 h-9 rounded-full flex items-center justify-center hover:scale-105 active:scale-95 transition-all shadow-[0_0_15px_rgba(138,235,255,0.4)] ml-1 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      title="Transmit Signal"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
                <div className="flex justify-center mt-3">
                  <span className="text-[9px] font-mono text-[#8aebff]/30 tracking-[0.25em] uppercase">
                    JARVIS v4.0.2 - Secure Enclave Active
                  </span>
                </div>
              </div>
            </div>
      </section>
    </motion.div>
  );
}
