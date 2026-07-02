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
  Settings,
  ArrowRight,
  Database
} from "lucide-react";
import { ScreenId } from "../types";

interface SearchOverlayProps {
  onClose: () => void;
  onNavigate: (screen: ScreenId) => void;
}

interface SearchResult {
  category: string;
  title: string;
  subtitle: string;
  target: string;
  meta?: { id?: number };
}

export default function SearchOverlay({ onClose, onNavigate }: SearchOverlayProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Default quick actions / navigation commands
  const defaultCommands: SearchResult[] = [
    { category: "Navigation", title: "Go to Core status dashboard", subtitle: "System Telemetry & Health Monitor", target: "core" },
    { category: "Navigation", title: "Go to JARVIS Secure Chat", subtitle: "Autonomous LLM Assistant Chat", target: "assistant" },
    { category: "Navigation", title: "Go to PrivaChat Matrix Client", subtitle: "Encrypted direct messenger rooms", target: "chat" },
    { category: "Navigation", title: "Go to System Terminal", subtitle: "Interactive command terminal & PDF upload", target: "terminal" },
    { category: "Navigation", title: "Go to Kanban Jobs Board", subtitle: "Track and analyze job application pipelines", target: "jobs" },
  ];

  // Close on Escape
  useEffect(() => {
    inputRef.current?.focus();
    
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  // Debounced search query
  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      setSelectedIndex(0);
      return;
    }

    setLoading(true);
    const delayDebounceFn = setTimeout(async () => {
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

    return () => clearTimeout(delayDebounceFn);
  }, [query]);

  const activeList = query.trim() ? results : defaultCommands;

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (activeList.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % activeList.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + activeList.length) % activeList.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      handleSelect(activeList[selectedIndex]);
    }
  };

  const handleSelect = (item: SearchResult) => {
    if (item.target) {
      onNavigate(item.target as ScreenId);
      onClose();
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "Navigation":
        return <Compass className="w-4 h-4 text-[#8aebff]" />;
      case "Applications":
        return <FileText className="w-4 h-4 text-[#ffb13b]" />;
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

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md">
      <div 
        className="absolute inset-0 cursor-default" 
        onClick={onClose}
      />
      
      <motion.div
        initial={{ opacity: 0, y: -20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: -10, scale: 0.98 }}
        transition={{ duration: 0.2 }}
        className="relative w-full max-w-2xl bg-[#0f131f]/95 border border-[#3c494c] rounded-xl shadow-[0_0_30px_rgba(34,211,238,0.15)] overflow-hidden flex flex-col h-[450px]"
        onKeyDown={handleKeyDown}
      >
        {/* Glow boarder accent */}
        <div className="absolute top-0 left-0 w-full h-[2px] bg-gradient-to-r from-transparent via-[#8aebff] to-transparent"></div>

        {/* Input Bar */}
        <div className="flex items-center px-4 py-3.5 border-b border-white/10 gap-3">
          <Search className="w-5 h-5 text-[#8aebff]" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search database tables, chat logs, reminders, or navigation..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 bg-transparent border-0 outline-0 text-white font-mono text-[14px] placeholder-[#859397]"
          />
          {loading && (
            <span className="w-4.5 h-4.5 rounded-full border-2 border-[#8aebff]/30 border-t-[#8aebff] animate-spin"></span>
          )}
          <button 
            onClick={onClose} 
            className="p-1 hover:bg-white/5 rounded transition-colors text-[#bbc9cd] hover:text-white"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* List stage */}
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
                  <div className={`p-1.5 rounded-md ${
                    idx === selectedIndex ? "bg-[#8aebff]/10" : "bg-white/5"
                  }`}>
                    {getCategoryIcon(item.category)}
                  </div>
                  <div>
                    <div className="font-semibold text-sm font-mono flex items-center gap-2">
                      {item.title}
                      <span className="text-[10px] uppercase font-bold tracking-wider opacity-60 px-1.5 py-0.5 rounded bg-white/5 font-sans">
                        {item.category}
                      </span>
                    </div>
                    <div className="text-xs text-[#859397] mt-0.5 font-sans">
                      {item.subtitle}
                    </div>
                  </div>
                </div>
                {idx === selectedIndex && (
                  <motion.div 
                    initial={{ opacity: 0, x: -5 }} 
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center gap-1.5 text-xs text-[#8aebff] font-mono font-bold"
                  >
                    <span>EXEC</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </motion.div>
                )}
              </div>
            ))
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center p-6 text-[#859397]">
              <Database className="w-12 h-12 text-white/5 mb-3" />
              <p className="font-mono text-sm">No records found matching "{query}"</p>
              <p className="text-xs mt-1">Try searching for "leak", "Google", "re-sync", or "digest"</p>
            </div>
          )}
        </div>

        {/* Footer info bar */}
        <div className="px-4 py-2 bg-[#0a0e1a] border-t border-white/5 flex justify-between items-center text-[10px] font-mono text-[#859397]">
          <div>
            Use <kbd className="bg-white/10 px-1 rounded text-white font-sans text-[9px]">↑</kbd> <kbd className="bg-white/10 px-1 rounded text-white font-sans text-[9px]">↓</kbd> to navigate, <kbd className="bg-white/10 px-1 rounded text-white font-sans text-[9px]">↵</kbd> to select
          </div>
          <div>
            ESC to close
          </div>
        </div>
      </motion.div>
    </div>
  );
}
