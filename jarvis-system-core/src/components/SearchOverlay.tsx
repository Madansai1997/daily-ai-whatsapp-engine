import React, { useState, useEffect, useRef } from "react";
import { motion } from "motion/react";
import {
  Search,
  X,
  Compass,
  FileText,
  MessageSquare,
  Terminal as TerminalIcon,
  Bell,
  Sparkles,
  Play,
  Briefcase,
  ScanLine,
  ArrowLeft,
  ArrowRight,
  Database
} from "lucide-react";
import { ScreenId } from "../types";

interface SearchOverlayProps {
  onClose: () => void;
  onNavigate: (screen: ScreenId) => void;
}

// A palette row can be: navigation, a backend action (run-job), an ask-JARVIS
// prompt, or a raw search result. `action` discriminates the behavior.
interface SearchResult {
  category: string;
  title: string;
  subtitle: string;
  target?: string;            // navigation target screen
  action?: "run-job" | "ask"; // special behaviors
  jobName?: string;           // for run-job actions
  meta?: { id?: number; job_ref?: string };
}

// Tier-2 action commands — run backend jobs straight from the palette.
const actionCommands: SearchResult[] = [
  { category: "Action", title: "Run Job Scout now", subtitle: "Fetch & rank fresh job matches", action: "run-job", jobName: "job-scout" },
  { category: "Action", title: "Check inbox now", subtitle: "Scan Gmail and notify on important mail", action: "run-job", jobName: "inbox-check" },
  { category: "Action", title: "Learn my patterns", subtitle: "Refresh calendar & reply-style preferences", action: "run-job", jobName: "learn-patterns" },
  { category: "Action", title: "Send morning digest", subtitle: "Compile and push today's briefing", action: "run-job", jobName: "morning-digest" },
];

// Navigation commands.
const navCommands: SearchResult[] = [
  { category: "Navigation", title: "Go to Core dashboard", subtitle: "System telemetry & health monitor", target: "core" },
  { category: "Navigation", title: "Go to JARVIS chat", subtitle: "Autonomous LLM assistant", target: "assistant" },
  { category: "Navigation", title: "Go to PrivaChat", subtitle: "Encrypted private messenger", target: "chat" },
  { category: "Navigation", title: "Go to System Terminal", subtitle: "Live feed, commands & PDF upload", target: "terminal" },
  { category: "Navigation", title: "Go to Jobs board", subtitle: "Kanban pipeline, ATS & résumé", target: "jobs" },
];

const defaultCommands: SearchResult[] = [...actionCommands, ...navCommands];

export default function SearchOverlay({ onClose, onNavigate }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  // Ask-JARVIS (Tier 3) inline conversation state
  const [asking, setAsking] = useState(false);
  const [askPrompt, setAskPrompt] = useState("");
  const [askReply, setAskReply] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus + Escape handling
  useEffect(() => {
    inputRef.current?.focus();
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (askReply !== null || asking) {
          setAskReply(null);
          setAsking(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose, askReply, asking]);

  // Debounced search
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }
    setLoading(true);
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
        if (res.ok) {
          const data = await res.json();
          setResults(data.results || []);
        }
      } catch (err) {
        console.error("Search query failed:", err);
      } finally {
        setLoading(false);
        setSelectedIndex(0);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [query]);

  // When there's a query, pin an "Ask JARVIS" row at the top so the box doubles
  // as a natural-language assistant entry point.
  const askRow: SearchResult | null = query.trim()
    ? { category: "Ask JARVIS", title: `Ask JARVIS: "${query.trim()}"`, subtitle: "Route this straight to the assistant", action: "ask" }
    : null;

  const activeList: SearchResult[] = query.trim()
    ? [askRow!, ...results]
    : defaultCommands;

  const runAsk = async (prompt: string) => {
    setAsking(true);
    setAskPrompt(prompt);
    setAskReply(null);
    try {
      const res = await fetch("/chat-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: prompt }),
      });
      const data = await res.json();
      setAskReply(data.reply || "No response.");
    } catch (err) {
      setAskReply("⚠️ Couldn't reach JARVIS. Try again.");
    } finally {
      setAsking(false);
    }
  };

  const runJob = async (item: SearchResult) => {
    setStatusMsg(`Running ${item.title.toLowerCase()}…`);
    try {
      const res = await fetch("/api/run-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: item.jobName }),
      });
      const data = await res.json();
      setStatusMsg(data.ok ? `✅ ${data.message || "Started."}` : `⚠️ ${data.error || "Failed."}`);
    } catch (err) {
      setStatusMsg("⚠️ Request failed.");
    }
    setTimeout(() => setStatusMsg(null), 4000);
  };

  const handleSelect = (item: SearchResult) => {
    if (!item) return;
    if (item.action === "ask") {
      runAsk(query.trim());
      return;
    }
    if (item.action === "run-job") {
      runJob(item);
      return;
    }
    if (item.target) {
      onNavigate(item.target as ScreenId);
      onClose();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (askReply !== null || asking) return;
    if (activeList.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((p) => (p + 1) % activeList.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((p) => (p - 1 + activeList.length) % activeList.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(activeList[selectedIndex]);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Ask JARVIS":
        return <Sparkles className="w-4 h-4 text-[#8aebff]" />;
      case "Action":
        return <Play className="w-4 h-4 text-[#a3e635]" />;
      case "Navigation":
        return <Compass className="w-4 h-4 text-[#8aebff]" />;
      case "Applications":
        return <FileText className="w-4 h-4 text-[#ffb13b]" />;
      case "Matched Jobs":
        return <Briefcase className="w-4 h-4 text-[#7dd3fc]" />;
      case "ATS Analyses":
        return <ScanLine className="w-4 h-4 text-[#c4b5fd]" />;
      case "Chat History":
        return <MessageSquare className="w-4 h-4 text-[#5eead4]" />;
      case "Reminders":
        return <TerminalIcon className="w-4 h-4 text-[#ffd6a3]" />;
      case "System Logs":
        return <Bell className="w-4 h-4 text-[#ffb4ab]" />;
      default:
        return <Database className="w-4 h-4 text-[#bbc9cd]" />;
    }
  };

  const showAskPanel = asking || askReply !== null;

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md">
      <div className="absolute inset-0 cursor-default" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-2xl bg-[#0f131f]/95 border border-[#3c494c] rounded-xl shadow-[0_0_30px_rgba(34,211,238,0.15)] overflow-hidden flex flex-col h-[450px]"
        onKeyDown={handleKeyDown}
      >
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#8aebff] to-transparent"></div>

        {/* Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-white/10 gap-3">
          <Search className="w-5 h-5 text-[#8aebff]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search, run an action, or ask JARVIS anything…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-0 outline-0 text-white font-mono text-[14px] placeholder-[#859397]"
          />
          {loading && (
            <span className="w-4.5 h-4.5 rounded-full border-2 border-[#8aebff]/30 border-t-[#8aebff] animate-spin"></span>
          )}
          <button onClick={onClose} className="p-1 hover:bg-white/5 rounded transition-colors text-[#bbc9cd] hover:text-white">
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Ask-JARVIS response panel (replaces list when active) */}
        {showAskPanel ? (
          <div className="flex-1 overflow-y-auto custom-scrollbar p-4">
            <button
              onClick={() => { setAskReply(null); setAsking(false); }}
              className="flex items-center gap-1.5 text-xs text-[#8aebff] font-mono mb-3 hover:opacity-80"
            >
              <ArrowLeft className="w-3.5 h-3.5" /> back to results
            </button>
            <div className="flex items-start gap-2 mb-3">
              <MessageSquare className="w-4 h-4 text-[#859397] mt-0.5 shrink-0" />
              <p className="text-sm text-[#bbc9cd] font-mono">{askPrompt}</p>
            </div>
            <div className="flex items-start gap-2 rounded-lg bg-[#1b1f2c]/60 border border-[#8aebff]/20 p-3">
              <Sparkles className="w-4 h-4 text-[#8aebff] mt-0.5 shrink-0" />
              {asking ? (
                <span className="flex items-center gap-2 text-sm text-[#859397]">
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-[#8aebff]/30 border-t-[#8aebff] animate-spin"></span>
                  JARVIS is thinking…
                </span>
              ) : (
                <p className="text-sm text-[#dfe2f3] whitespace-pre-wrap leading-relaxed">{askReply}</p>
              )}
            </div>
            {!asking && (
              <button
                onClick={() => { onNavigate(ScreenId.Assistant); onClose(); }}
                className="mt-3 flex items-center gap-1.5 text-xs text-[#8aebff] font-mono hover:opacity-80"
              >
                Continue in JARVIS chat <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ) : (
          /* Results / commands list */
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
            {activeList.length > 0 ? (
              activeList.map((item, idx) => (
                <div
                  key={idx}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  className={`flex items-center justify-between px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-150 border ${
                    idx === selectedIndex
                      ? "bg-[#1b1f2c] border-[#8aebff]/40 text-[#8aebff]"
                      : "bg-transparent border-transparent text-[#bbc9cd]"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-1.5 rounded-md ${idx === selectedIndex ? "bg-[#8aebff]/10" : "bg-white/5"}`}>
                      {getCategoryIcon(item.category)}
                    </div>
                    <div>
                      <div className="font-semibold text-sm font-mono flex items-center gap-2">
                        {item.title}
                        <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 px-1.5 py-0.5 rounded bg-white/5 font-sans">
                          {item.category}
                        </span>
                      </div>
                      <div className="text-xs text-[#859397] mt-0.5 font-sans">{item.subtitle}</div>
                    </div>
                  </div>
                  {idx === selectedIndex && (
                    <motion.div
                      initial={{ opacity: 0, x: -5 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="flex items-center gap-1.5 text-xs text-[#8aebff] font-mono font-bold"
                    >
                      <span>{item.action === "ask" ? "ASK" : item.action === "run-job" ? "RUN" : "GO"}</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </motion.div>
                  )}
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center p-6 text-[#859397]">
                <Database className="w-12 h-12 text-white/5 mb-3" />
                <p className="font-mono text-sm">No records found matching "{query}"</p>
                <p className="text-xs mt-1">Press <kbd className="bg-white/10 px-1 rounded text-white text-[9px]">↵</kbd> to ask JARVIS instead</p>
              </div>
            )}
          </div>
        )}

        {/* Footer info bar */}
        <div className="px-4 py-2 bg-[#0a0e1a] border-t border-white/5 flex justify-between items-center text-[10px] font-mono text-[#859397]">
          {statusMsg ? (
            <div className="text-[#8aebff]">{statusMsg}</div>
          ) : (
            <div>
              <kbd className="bg-white/10 px-1 rounded text-white font-sans text-[9px]">↑</kbd>{" "}
              <kbd className="bg-white/10 px-1 rounded text-white font-sans text-[9px]">↓</kbd> navigate,{" "}
              <kbd className="bg-white/10 px-1 rounded text-white font-sans text-[9px]">↵</kbd> select
            </div>
          )}
          <div>ESC to close</div>
        </div>
      </motion.div>
    </div>
  );
}
