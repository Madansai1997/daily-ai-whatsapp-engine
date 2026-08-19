import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import {
  Lock, KeyRound, ShieldAlert, Plus, Trash2, Search, X, Sparkles, Heart, Zap, Target,
  BookOpen, Clock, Bot, Mic, MicOff, MessageSquare, Compass, RefreshCw, Send, Layers,
  ChevronLeft, ChevronRight, Maximize2, ShieldCheck, Award, Eye, Calendar, Smile,
  Edit3, Save, Check
} from "lucide-react";

interface ProjectBelieverModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Entry {
  id: number;
  content: string;
  reflection?: string;
  mood_tag: string;
  created_at: string;
}

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const MOODS = [
  { id: "Reflective", icon: BookOpen, color: "text-blue-400 border-blue-500/30 bg-blue-500/10" },
  { id: "Focused", icon: Target, color: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
  { id: "Energetic", icon: Zap, color: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  { id: "Venting", icon: Heart, color: "text-rose-400 border-rose-500/30 bg-rose-500/10" },
];

export default function ProjectBelieverModal({ isOpen, onClose }: ProjectBelieverModalProps) {
  const [isInitialized, setIsInitialized] = useState<boolean | null>(null);
  const [passphrase, setPassphrase] = useState("");
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [newContent, setNewContent] = useState("");
  const [selectedMood, setSelectedMood] = useState("Reflective");
  const [searchQuery, setSearchQuery] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showAddForm, setShowAddForm] = useState(false);
  const [prompts, setPrompts] = useState<string[]>([]);
  const [activePrompt, setActivePrompt] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [reflectingId, setReflectingId] = useState<number | null>(null);
  const [selectedEntryId, setSelectedEntryId] = useState<number | null>(null);

  // Edit State for Existing Entries & Reflections
  const [editingEntryId, setEditingEntryId] = useState<number | null>(null);
  const [editContent, setEditContent] = useState("");
  const [editReflection, setEditReflection] = useState("");
  const [editMood, setEditMood] = useState("Reflective");
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [activeVoiceField, setActiveVoiceField] = useState<"new" | "edit-content" | "edit-reflection" | null>(null);

  // Active Main Studio Tab
  const [activeTab, setActiveTab] = useState<"journal" | "chat" | "cards" | "lenses" | "capsules">("journal");

  // Conversational Chat State
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);

  // Key Cards Presentation Deck State
  const [keyCards, setKeyCards] = useState<any | null>(null);
  const [cardsLoading, setCardsLoading] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);

  // Perspective Lenses State
  const [perspectiveLenses, setPerspectiveLenses] = useState<any | null>(null);
  const [perspectiveLoading, setPerspectiveLoading] = useState(false);

  // Time Capsule State
  const [timeCapsules, setTimeCapsules] = useState<any[]>([]);
  const [capsuleTitle, setCapsuleTitle] = useState("");
  const [capsuleContent, setCapsuleContent] = useState("");
  const [unlockDate, setUnlockDate] = useState("");
  const [capsuleMsg, setCapsuleMsg] = useState("");

  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (activeKey) {
      idleTimerRef.current = setTimeout(() => {
        setActiveKey(null);
        setEntries([]);
        setError("Vault auto-locked due to inactivity.");
      }, 180000);
    }
  }, [activeKey]);

  useEffect(() => {
    const handleActivity = () => resetIdleTimer();
    window.addEventListener("mousemove", handleActivity);
    window.addEventListener("keydown", handleActivity);
    return () => {
      window.removeEventListener("mousemove", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [resetIdleTimer]);

  const loadPrompts = useCallback(() => {
    fetch("/api/believer/prompts")
      .then((res) => res.json())
      .then((data) => {
        if (data.prompts && data.prompts.length > 0) {
          setPrompts(data.prompts);
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isOpen) {
      setError("");
      setLoading(true);
      fetch("/api/believer/status")
        .then((res) => res.json())
        .then((data) => {
          setIsInitialized(!!data.is_initialized);
        })
        .catch(() => setError("Failed to connect to backend vault"))
        .finally(() => setLoading(false));

      loadPrompts();
    } else {
      setActiveKey(null);
      setEntries([]);
      setPassphrase("");
      setShowAddForm(false);
      setIsListening(false);
    }
  }, [isOpen, loadPrompts]);

  const loadEntries = async (key: string) => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/believer/entries", {
        headers: { "X-Passphrase": key },
      });
      const data = await res.json();
      if (res.ok && data.status === "ok") {
        setEntries(data.entries || []);
        setActiveKey(key);
      } else {
        setError(data.detail || "Failed to decrypt entries");
      }
    } catch {
      setError("Network error while accessing vault");
    } finally {
      setLoading(false);
    }
  };

  const handleUnlock = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passphrase) return;
    setLoading(true);
    setError("");

    try {
      if (!isInitialized) {
        const res = await fetch("/api/believer/setup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passphrase }),
        });
        const data = await res.json();
        if (res.ok) {
          setIsInitialized(true);
          await loadEntries(passphrase);
        } else {
          setError(data.detail || "Setup failed");
        }
      } else {
        const res = await fetch("/api/believer/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ passphrase }),
        });
        const data = await res.json();
        if (res.ok && data.verified) {
          await loadEntries(passphrase);
        } else {
          setError("Incorrect Master Passphrase");
        }
      }
    } catch {
      setError("Vault authentication request failed");
    } finally {
      setLoading(false);
    }
  };

  const handleCreateEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newContent.trim() || !activeKey) return;
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/believer/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passphrase: activeKey,
          content: newContent,
          mood_tag: selectedMood,
        }),
      });
      const data = await res.json();
      if (res.ok && data.id) {
        setNewContent("");
        setShowAddForm(false);
        setActivePrompt(null);
        await loadEntries(activeKey);
      } else {
        setError(data.detail || "Failed to save encrypted entry");
      }
    } catch {
      setError("Error saving entry to vault");
    } finally {
      setLoading(false);
    }
  };

  // Conversational Chat Function
  const handleSendChatMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeKey) return;

    const userMsg = chatInput.trim();
    setChatInput("");
    const newHistory: ChatMessage[] = [...chatMessages, { role: "user", content: userMsg }];
    setChatMessages(newHistory);
    setChatLoading(true);

    try {
      const res = await fetch("/api/believer/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passphrase: activeKey,
          message: userMsg,
          history: newHistory,
        }),
      });
      const data = await res.json();
      if (data.status === "ok" && data.reply) {
        setChatMessages([...newHistory, { role: "assistant", content: data.reply }]);
      }
    } catch {
      /* fallback */
    } finally {
      setChatLoading(false);
    }
  };

  // Generate Key Cards Function
  const handleGenerateKeyCards = async (entryId: number) => {
    if (!activeKey) return;
    setSelectedEntryId(entryId);
    setCardsLoading(true);
    try {
      const res = await fetch("/api/believer/key-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: activeKey, entry_id: entryId }),
      });
      const data = await res.json();
      if (data.status === "ok" && data.key_cards) {
        setKeyCards(data.key_cards);
        setActiveTab("cards");
      }
    } catch {
      /* fallback */
    } finally {
      setCardsLoading(false);
    }
  };

  // Generate Perspective Lenses
  const handleGeneratePerspective = async (entryId: number) => {
    if (!activeKey) return;
    setSelectedEntryId(entryId);
    setPerspectiveLoading(true);
    try {
      const res = await fetch("/api/believer/perspective", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: activeKey, entry_id: entryId }),
      });
      const data = await res.json();
      if (data.status === "ok" && data.lenses) {
        setPerspectiveLenses(data.lenses);
        setActiveTab("lenses");
      }
    } catch {
      /* fallback */
    } finally {
      setPerspectiveLoading(false);
    }
  };

  // Time Capsule Functions
  const handleCreateTimeCapsule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!capsuleContent.trim() || !unlockDate || !activeKey) return;

    try {
      const res = await fetch("/api/believer/time-capsule", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passphrase: activeKey,
          title: capsuleTitle || "Letter to Future Self",
          content: capsuleContent,
          unlock_date: unlockDate,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setCapsuleMsg(`Locked until ${unlockDate}!`);
        setCapsuleTitle("");
        setCapsuleContent("");
        setUnlockDate("");
        loadTimeCapsules(activeKey);
      }
    } catch {
      setCapsuleMsg("Failed to lock time capsule");
    }
  };

  const loadTimeCapsules = async (key: string) => {
    try {
      const res = await fetch("/api/believer/time-capsules", {
        headers: { "X-Passphrase": key },
      });
      const data = await res.json();
      if (data.status === "ok") {
        setTimeCapsules(data.capsules || []);
      }
    } catch {}
  };

  // Edit & Reflection Handlers
  const handleStartEdit = (entry: Entry) => {
    setEditingEntryId(entry.id);
    setEditContent(entry.content);
    setEditReflection(entry.reflection || "");
    setEditMood(entry.mood_tag || "Reflective");
    setShowAddForm(false);
  };

  const handleCancelEdit = () => {
    setEditingEntryId(null);
    setEditContent("");
    setEditReflection("");
    if (isListening) {
      try { recognitionRef.current?.stop(); } catch {}
      setIsListening(false);
      setActiveVoiceField(null);
    }
  };

  const handleSaveEdit = async (entryId: number) => {
    if (!editContent.trim() || !activeKey) return;
    setIsSavingEdit(true);
    setError("");
    try {
      const res = await fetch(`/api/believer/entries/${entryId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passphrase: activeKey,
          content: editContent,
          reflection: editReflection,
          mood_tag: editMood,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setEditingEntryId(null);
        await loadEntries(activeKey);
      } else {
        setError(data.detail || "Failed to update entry");
      }
    } catch {
      setError("Network error while updating entry");
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleGenerateReflection = async (entryId: number) => {
    if (!activeKey) return;
    setReflectingId(entryId);
    try {
      const res = await fetch("/api/believer/reflect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase: activeKey, entry_id: entryId }),
      });
      const data = await res.json();
      if (res.ok && data.reflection) {
        if (editingEntryId === entryId) {
          setEditReflection(data.reflection);
        }
        await loadEntries(activeKey);
      }
    } catch {
      /* ignore */
    } finally {
      setReflectingId(null);
    }
  };

  const handleDeleteEntry = async (entryId: number) => {
    if (!activeKey) return;
    if (!window.confirm("Are you sure you want to delete this reflection entry from your private vault?")) return;
    try {
      const res = await fetch(`/api/believer/entries/${entryId}`, {
        method: "DELETE",
        headers: { "X-Passphrase": activeKey },
      });
      if (res.ok) {
        if (editingEntryId === entryId) setEditingEntryId(null);
        await loadEntries(activeKey);
      }
    } catch {
      /* ignore */
    }
  };

  const initialTargetTextRef = useRef("");

  const toggleVoiceInput = (target: "new" | "edit-content" | "edit-reflection" = "new") => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening && activeVoiceField === target) {
      try { recognitionRef.current?.stop(); } catch {}
      setIsListening(false);
      setActiveVoiceField(null);
      return;
    }

    if (isListening) {
      try { recognitionRef.current?.stop(); } catch {}
    }

    const initialText =
      target === "new" ? newContent :
      target === "edit-content" ? editContent :
      editReflection;
    initialTargetTextRef.current = (initialText || "").trim();

    const recog = new SR();
    recog.lang = "en-US";
    recog.continuous = true;
    recog.interimResults = true;

    recog.onresult = (e: any) => {
      let sessionText = "";
      for (let i = 0; i < e.results.length; ++i) {
        sessionText += e.results[i][0].transcript;
      }
      sessionText = sessionText.trim();
      if (!sessionText) return;

      const fullLive = [initialTargetTextRef.current, sessionText].filter(Boolean).join(" ").trim();

      // Check if user says closing phrase: "it's over", "that's all", "done", "stop dictation", "over"
      const closingMatch = fullLive.match(/\b(it'?s over|that'?s over|it is over|that'?s it|thats it|that is all|that'?s all|thats all|i'?m done|im done|i am done|it'?s done|its done|all done|done|finished|over and out|send it|send this|send|stop dictation|over)\b[.!?, \t\n\r"'\)]*$/i);

      let cleanText = fullLive;
      if (closingMatch) {
        cleanText = fullLive.slice(0, closingMatch.index).trim().replace(/[,;.\s]+$/, "").trim();
      }

      if (target === "new") {
        setNewContent(cleanText);
      } else if (target === "edit-content") {
        setEditContent(cleanText);
      } else if (target === "edit-reflection") {
        setEditReflection(cleanText);
      }

      if (closingMatch) {
        try { recog.stop(); } catch {}
        setIsListening(false);
        setActiveVoiceField(null);
      }
    };

    recog.onerror = () => { setIsListening(false); setActiveVoiceField(null); };
    recog.onend = () => { setIsListening(false); setActiveVoiceField(null); };

    recognitionRef.current = recog;
    try {
      recog.start();
      setIsListening(true);
      setActiveVoiceField(target);
    } catch {
      setIsListening(false);
      setActiveVoiceField(null);
    }
  };

  const filteredEntries = entries.filter((e) =>
    e.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (e.reflection && e.reflection.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-4xl bg-zinc-950 border border-amber-500/30 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
        >
          {/* Top Bar */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-amber-500/10 border border-amber-500/30 text-amber-400">
                <Sparkles className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                  Project Believer
                  <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    Master Introspective Suite
                  </span>
                </h2>
                <p className="text-xs text-zinc-400">Private Reflection, Conversational Confidant & Key Cards</p>
              </div>
            </div>

            <button onClick={onClose} className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors">
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* 5 Master Studio Navigation Tabs */}
          {activeKey && (
            <div className="flex space-x-1 p-2 bg-zinc-900 border-b border-zinc-800 overflow-x-auto">
              {[
                { id: "journal", label: "📖 Journal Vault", icon: BookOpen },
                { id: "chat", label: "💬 Conversational Sounding Board", icon: MessageSquare },
                { id: "cards", label: "🃏 Key Presentation Cards", icon: Layers },
                { id: "lenses", label: "🔮 3 Lenses Perspective", icon: Compass },
                { id: "capsules", label: "🔒 Time Capsules", icon: Lock },
              ].map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                      activeTab === tab.id
                        ? "bg-amber-500 text-zinc-950 font-bold shadow-lg"
                        : "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Main Content Area */}
          <div className="p-6 flex-1 overflow-y-auto">
            {error && (
              <div className="mb-4 p-3 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-400 text-sm flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                {error}
              </div>
            )}

            {!activeKey ? (
              /* Passphrase Lock Screen */
              <div className="py-8 flex flex-col items-center justify-center text-center">
                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-lg">
                  <Lock className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-medium text-zinc-100 mb-1">
                  {isInitialized ? "Enter Master Passphrase" : "Set Your Master Passphrase"}
                </h3>
                <p className="text-sm text-zinc-400 max-w-sm mb-6">
                  Unlock your zero-knowledge private journal, conversational confidant, and key presentation cards.
                </p>

                <form onSubmit={handleUnlock} className="w-full max-w-sm space-y-4">
                  <div className="relative">
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Master Passphrase"
                      className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 focus:outline-none focus:border-amber-500 transition-colors"
                      autoFocus
                    />
                    <KeyRound className="absolute right-3.5 top-3.5 w-5 h-5 text-zinc-500" />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !passphrase}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg cursor-pointer font-bold"
                  >
                    {loading ? "Processing..." : isInitialized ? "Unlock Vault" : "Initialize Believer"}
                  </button>
                </form>
              </div>
            ) : (
              /* TAB CONTENT PANELS */
              <div>
                {/* TAB 1: JOURNAL VAULT */}
                {activeTab === "journal" && (
                  <div className="space-y-6">
                    {/* Guided Prompts */}
                    {prompts.length > 0 && (
                      <div className="p-4 bg-amber-500/5 border border-amber-500/20 rounded-xl space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-semibold uppercase text-amber-400 flex items-center gap-1.5 font-mono">
                            <Compass className="w-3.5 h-3.5" /> Today's Inquiries from JARVIS
                          </span>
                        </div>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 pt-1">
                          {prompts.map((p, idx) => (
                            <button
                              key={idx}
                              onClick={() => {
                                setActivePrompt(p);
                                setShowAddForm(true);
                                setNewContent((prev) => (prev ? `${prev}\n\n[Inquiry: ${p}]\n` : `[Inquiry: ${p}]\n`));
                              }}
                              className="p-2.5 text-left bg-zinc-900/60 hover:bg-zinc-800 border border-zinc-800 rounded-lg text-xs text-zinc-300 transition-all italic font-serif"
                            >
                              "{p}"
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Entry Form */}
                    <div className="flex justify-between items-center">
                      <input
                        type="text"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search entries..."
                        className="px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 flex-1 max-w-sm"
                      />
                      <button
                        onClick={() => setShowAddForm(!showAddForm)}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl flex items-center gap-1.5"
                      >
                        <Plus className="w-4 h-4" /> New Reflection
                      </button>
                    </div>

                    {showAddForm && (
                      <form onSubmit={handleCreateEntry} className="p-4 bg-zinc-900/60 border border-amber-500/30 rounded-xl space-y-3">
                        <textarea
                          value={newContent}
                          onChange={(e) => setNewContent(e.target.value)}
                          placeholder="Speak or write freely. What's on your mind today, Sir?"
                          rows={4}
                          className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 resize-none"
                          autoFocus
                        />
                        <div className="flex justify-between items-center">
                          <button type="button" onClick={toggleVoiceInput} className="p-2 bg-zinc-800 text-zinc-300 rounded-lg">
                            {isListening ? <MicOff className="w-4 h-4 text-rose-400" /> : <Mic className="w-4 h-4" />}
                          </button>
                          <button type="submit" className="px-4 py-1.5 bg-amber-500 text-zinc-950 font-bold text-xs rounded-lg">
                            Save Entry
                          </button>
                        </div>
                      </form>
                    )}

                    {/* Entries List */}
                    <div className="space-y-4">
                      {filteredEntries.length === 0 ? (
                        <div className="py-10 text-center text-xs text-zinc-500 font-mono">
                          No reflections found. Click "+ New Reflection" above to begin.
                        </div>
                      ) : (
                        filteredEntries.map((entry) => {
                          const isEditing = editingEntryId === entry.id;
                          const moodObj = MOODS.find((m) => m.id === entry.mood_tag) || MOODS[0];
                          const MoodIcon = moodObj.icon;

                          if (isEditing) {
                            return (
                              <div key={entry.id} className="p-5 bg-zinc-900/90 border border-amber-500/50 rounded-xl space-y-4 shadow-xl">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-amber-400 flex items-center gap-1.5 font-mono">
                                    <Edit3 className="w-4 h-4" /> Editing Entry #{entry.id} (Saved {entry.created_at?.slice(0, 10)})
                                  </span>
                                  <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="text-xs text-zinc-400 hover:text-zinc-200 cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                </div>

                                {/* Mood Selector */}
                                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                                  <span className="text-xs text-zinc-400 font-mono">Mood:</span>
                                  {MOODS.map((m) => {
                                    const Icon = m.icon;
                                    const isSelected = editMood === m.id;
                                    return (
                                      <button
                                        key={m.id}
                                        type="button"
                                        onClick={() => setEditMood(m.id)}
                                        className={`px-2.5 py-1 rounded-lg text-xs flex items-center gap-1.5 border transition-all cursor-pointer ${
                                          isSelected ? `${m.color} font-bold shadow-sm` : "bg-zinc-950/60 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                                        }`}
                                      >
                                        <Icon className="w-3.5 h-3.5" />
                                        <span>{m.id}</span>
                                      </button>
                                    );
                                  })}
                                </div>

                                {/* Content Field */}
                                <div className="space-y-1.5">
                                  <div className="flex items-center justify-between">
                                    <label className="text-xs font-mono text-zinc-300">Journal Content / Thoughts:</label>
                                    <button
                                      type="button"
                                      onClick={() => toggleVoiceInput("edit-content")}
                                      className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1 border transition-all cursor-pointer ${
                                        isListening && activeVoiceField === "edit-content"
                                          ? "bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse"
                                          : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                                      }`}
                                      title="Dictate content (say 'it's over' when done)"
                                    >
                                      {isListening && activeVoiceField === "edit-content" ? <MicOff className="w-3 h-3 text-rose-400" /> : <Mic className="w-3 h-3 text-amber-400" />}
                                      <span>{isListening && activeVoiceField === "edit-content" ? "Listening (Say 'it's over')..." : "Voice Dictate"}</span>
                                    </button>
                                  </div>
                                  <textarea
                                    value={editContent}
                                    onChange={(e) => setEditContent(e.target.value)}
                                    rows={5}
                                    placeholder="Edit or extend your entry..."
                                    className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 focus:border-amber-500/60 focus:outline-none leading-relaxed resize-y"
                                  />
                                </div>

                                {/* Reflection Field */}
                                <div className="space-y-1.5 pt-2 border-t border-zinc-800/60">
                                  <div className="flex items-center justify-between">
                                    <label className="text-xs font-mono text-amber-400/90 flex items-center gap-1">
                                      <Sparkles className="w-3.5 h-3.5" /> Personal / JARVIS Reflection:
                                    </label>
                                    <div className="flex items-center gap-2">
                                      <button
                                        type="button"
                                        onClick={() => handleGenerateReflection(entry.id)}
                                        disabled={reflectingId === entry.id}
                                        className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded text-[11px] font-mono flex items-center gap-1 transition-all disabled:opacity-50 cursor-pointer"
                                      >
                                        <Sparkles className="w-3 h-3" />
                                        <span>{reflectingId === entry.id ? "Reflecting..." : "Ask JARVIS to Reflect"}</span>
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => toggleVoiceInput("edit-reflection")}
                                        className={`px-2.5 py-1 rounded text-[11px] font-mono flex items-center gap-1 border transition-all cursor-pointer ${
                                          isListening && activeVoiceField === "edit-reflection"
                                            ? "bg-rose-500/20 border-rose-500/40 text-rose-400 animate-pulse"
                                            : "bg-zinc-800 border-zinc-700 text-zinc-300 hover:bg-zinc-700"
                                        }`}
                                        title="Dictate reflection (say 'it's over' when done)"
                                      >
                                        {isListening && activeVoiceField === "edit-reflection" ? <MicOff className="w-3 h-3 text-rose-400" /> : <Mic className="w-3 h-3 text-amber-400" />}
                                        <span>{isListening && activeVoiceField === "edit-reflection" ? "Listening..." : "Dictate"}</span>
                                      </button>
                                    </div>
                                  </div>
                                  <textarea
                                    value={editReflection}
                                    onChange={(e) => setEditReflection(e.target.value)}
                                    rows={3}
                                    placeholder="Write, edit, or extend your personal reflection..."
                                    className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:border-amber-500/60 focus:outline-none italic resize-y"
                                  />
                                </div>

                                {/* Buttons */}
                                <div className="flex items-center justify-end gap-2 pt-2">
                                  <button
                                    type="button"
                                    onClick={handleCancelEdit}
                                    className="px-3.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 text-xs font-semibold rounded-lg cursor-pointer"
                                  >
                                    Cancel
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleSaveEdit(entry.id)}
                                    disabled={isSavingEdit || !editContent.trim()}
                                    className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-lg flex items-center gap-1.5 shadow-md disabled:opacity-50 cursor-pointer"
                                  >
                                    <Save className="w-3.5 h-3.5" />
                                    <span>{isSavingEdit ? "Saving..." : "Save Changes"}</span>
                                  </button>
                                </div>
                              </div>
                            );
                          }

                          return (
                            <div key={entry.id} className="p-4 bg-zinc-900/50 border border-zinc-800 hover:border-zinc-700/80 rounded-xl space-y-3 transition-all group">
                              {/* Top Header of Card */}
                              <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold border flex items-center gap-1 ${moodObj.color}`}>
                                    <MoodIcon className="w-3 h-3" />
                                    {entry.mood_tag}
                                  </span>
                                  <span className="text-[11px] font-mono text-zinc-500 flex items-center gap-1">
                                    <Clock className="w-3 h-3" /> {entry.created_at?.slice(0, 16)}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => handleStartEdit(entry)}
                                    className="px-2.5 py-1 bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 transition-all cursor-pointer"
                                    title="Edit this reflection or extend your journal content"
                                  >
                                    <Edit3 className="w-3.5 h-3.5" /> Edit
                                  </button>
                                  <button
                                    onClick={() => handleDeleteEntry(entry.id)}
                                    className="p-1 text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors cursor-pointer"
                                    title="Delete entry"
                                  >
                                    <Trash2 className="w-3.5 h-3.5" />
                                  </button>
                                </div>
                              </div>

                              {/* Main Journal Content */}
                              <p className="text-sm text-zinc-100 whitespace-pre-wrap leading-relaxed">{entry.content}</p>

                              {/* Reflection block (if present) */}
                              {entry.reflection ? (
                                <div className="p-3 bg-amber-500/5 border-l-2 border-amber-500/70 rounded-r-lg space-y-1">
                                  <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-mono uppercase tracking-wider text-amber-400 flex items-center gap-1">
                                      <Sparkles className="w-3 h-3" /> Confidential Reflection:
                                    </span>
                                    <button
                                      onClick={() => handleStartEdit(entry)}
                                      className="text-[10px] text-amber-400/80 hover:text-amber-300 underline font-mono cursor-pointer"
                                    >
                                      Edit Reflection
                                    </button>
                                  </div>
                                  <p className="text-xs text-zinc-300 italic whitespace-pre-wrap leading-relaxed">{entry.reflection}</p>
                                </div>
                              ) : (
                                <div className="pt-1">
                                  <button
                                    onClick={() => handleGenerateReflection(entry.id)}
                                    disabled={reflectingId === entry.id}
                                    className="text-xs text-amber-400/70 hover:text-amber-400 flex items-center gap-1 font-mono hover:underline disabled:opacity-50 cursor-pointer"
                                  >
                                    <Sparkles className="w-3 h-3" /> {reflectingId === entry.id ? "Reflecting with JARVIS..." : "+ Generate JARVIS Reflection"}
                                  </button>
                                </div>
                              )}

                              {/* Bottom Action Ribbons */}
                              <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-zinc-800/60">
                                <button
                                  onClick={() => {
                                    setChatMessages([{ role: "assistant", content: `I am listening closely regarding: "${entry.content.slice(0, 60)}...". How are you feeling about this right now?` }]);
                                    setActiveTab("chat");
                                  }}
                                  className="px-3 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-amber-500/20 transition-all cursor-pointer"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" /> Conversational Sounding Board
                                </button>
                                <button
                                  onClick={() => handleGenerateKeyCards(entry.id)}
                                  className="px-3 py-1 bg-cyan-500/10 text-cyan-400 border border-cyan-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-cyan-500/20 transition-all cursor-pointer"
                                >
                                  <Layers className="w-3.5 h-3.5" /> Generate Key Cards
                                </button>
                                <button
                                  onClick={() => handleGeneratePerspective(entry.id)}
                                  className="px-3 py-1 bg-purple-500/10 text-purple-400 border border-purple-500/30 rounded-lg text-xs font-semibold flex items-center gap-1 hover:bg-purple-500/20 transition-all cursor-pointer"
                                >
                                  <Compass className="w-3.5 h-3.5" /> 3 Lenses Perspective
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                )}

                {/* TAB 2: CONVERSATIONAL CHAT */}
                {activeTab === "chat" && (
                  <div className="space-y-4 flex flex-col h-[500px]">
                    <div className="p-3 bg-zinc-900 border border-zinc-800 rounded-xl flex items-center space-x-2 text-xs text-amber-400">
                      <Bot className="w-4 h-4" />
                      <span>Empathetic Human-to-Human Dialogue Studio with Probing Follow-Up Questions</span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 p-4 bg-zinc-950 rounded-xl border border-zinc-800">
                      {chatMessages.length === 0 ? (
                        <p className="text-xs text-zinc-500 text-center py-8">
                          Start a conversation below. Share any feeling or thought to begin interactive dialogue.
                        </p>
                      ) : (
                        chatMessages.map((msg, idx) => (
                          <div
                            key={idx}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                          >
                            <div
                              className={`max-w-lg p-3 rounded-xl text-xs leading-relaxed ${
                                msg.role === "user"
                                  ? "bg-amber-500 text-zinc-950 font-medium"
                                  : "bg-zinc-900 text-zinc-200 border border-zinc-800"
                              }`}
                            >
                              {msg.content}
                            </div>
                          </div>
                        ))
                      )}
                      {chatLoading && <div className="text-xs text-amber-400 animate-pulse">JARVIS is reflecting...</div>}
                    </div>

                    <form onSubmit={handleSendChatMessage} className="flex gap-2">
                      <input
                        type="text"
                        value={chatInput}
                        onChange={(e) => setChatInput(e.target.value)}
                        placeholder="Discuss your thoughts or feelings..."
                        className="flex-1 p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-100"
                      />
                      <button type="submit" className="px-5 py-3 bg-amber-500 text-zinc-950 font-bold text-xs rounded-xl flex items-center gap-1">
                        <Send className="w-4 h-4" /> Send
                      </button>
                    </form>
                  </div>
                )}

                {/* TAB 3: KEY PRESENTATION CARDS */}
                {activeTab === "cards" && (
                  <div className="space-y-4">
                    {/* Entry Selector Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl gap-3">
                      <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 font-mono">
                        <Layers className="w-4 h-4" /> Select Entry to Analyze:
                      </span>
                      <select
                        value={selectedEntryId || ""}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          if (id) {
                            setSelectedEntryId(id);
                            handleGenerateKeyCards(id);
                          }
                        }}
                        className="px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-amber-500 cursor-pointer"
                      >
                        <option value="">-- Choose Entry from Vault ({entries.length} available) --</option>
                        {entries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.created_at?.slice(0, 10)}: "{entry.content.slice(0, 45)}..." ({entry.mood_tag})
                          </option>
                        ))}
                      </select>
                    </div>

                    {cardsLoading ? (
                      <div className="py-12 text-center text-xs text-amber-400 animate-pulse">
                        Generating Key Cards presentation deck...
                      </div>
                    ) : keyCards ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="p-4 bg-zinc-900 border border-amber-500/30 rounded-xl space-y-2">
                          <h4 className="text-xs font-bold text-amber-400 uppercase">💡 {keyCards.mindset_shift?.title}</h4>
                          <p className="text-xs text-zinc-200 leading-relaxed">{keyCards.mindset_shift?.content}</p>
                        </div>
                        <div className="p-4 bg-zinc-900 border border-cyan-500/30 rounded-xl space-y-2">
                          <h4 className="text-xs font-bold text-cyan-400 uppercase">🎯 {keyCards.actionable_steps?.title}</h4>
                          <ul className="text-xs text-zinc-200 list-disc pl-4 space-y-1">
                            {keyCards.actionable_steps?.steps?.map((s: string, i: number) => <li key={i}>{s}</li>)}
                          </ul>
                        </div>
                        <div className="p-4 bg-zinc-900 border border-purple-500/30 rounded-xl space-y-2">
                          <h4 className="text-xs font-bold text-purple-400 uppercase">⚡ {keyCards.reflection_question?.title}</h4>
                          <p className="text-xs text-zinc-200 italic">"{keyCards.reflection_question?.question}"</p>
                        </div>
                        <div className="p-4 bg-zinc-900 border border-emerald-500/30 rounded-xl space-y-2">
                          <h4 className="text-xs font-bold text-emerald-400 uppercase">🛡️ {keyCards.affirmation?.title}</h4>
                          <p className="text-xs text-zinc-200 font-bold">"{keyCards.affirmation?.statement}"</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 text-center py-8">
                        Use the dropdown above to select any entry from your Journal Vault to generate presentation key cards.
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 4: 3 LENSES PERSPECTIVE */}
                {activeTab === "lenses" && (
                  <div className="space-y-4">
                    {/* Entry Selector Header */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 bg-zinc-900 border border-zinc-800 rounded-xl gap-3">
                      <span className="text-xs font-semibold text-purple-400 flex items-center gap-1.5 font-mono">
                        <Compass className="w-4 h-4" /> Select Entry to Analyze:
                      </span>
                      <select
                        value={selectedEntryId || ""}
                        onChange={(e) => {
                          const id = Number(e.target.value);
                          if (id) {
                            setSelectedEntryId(id);
                            handleGeneratePerspective(id);
                          }
                        }}
                        className="px-3 py-1.5 bg-zinc-950 border border-zinc-700 rounded-lg text-xs text-zinc-100 focus:outline-none focus:border-purple-500 cursor-pointer"
                      >
                        <option value="">-- Choose Entry from Vault ({entries.length} available) --</option>
                        {entries.map((entry) => (
                          <option key={entry.id} value={entry.id}>
                            {entry.created_at?.slice(0, 10)}: "{entry.content.slice(0, 45)}..." ({entry.mood_tag})
                          </option>
                        ))}
                      </select>
                    </div>

                    {perspectiveLoading ? (
                      <div className="py-12 text-center text-xs text-purple-400 animate-pulse">
                        Analyzing 3 Perspective Lenses (Stoic, Visionary, Mentor)...
                      </div>
                    ) : perspectiveLenses ? (
                      <div className="space-y-3">
                        <div className="p-4 bg-zinc-900 border border-amber-500/30 rounded-xl space-y-1">
                          <h4 className="text-xs font-bold text-amber-400">🏛️ Stoic Wisdom Lens</h4>
                          <p className="text-xs text-zinc-300">{perspectiveLenses.stoic_lens}</p>
                        </div>
                        <div className="p-4 bg-zinc-900 border border-cyan-500/30 rounded-xl space-y-1">
                          <h4 className="text-xs font-bold text-cyan-400">🚀 Visionary First-Principles Lens</h4>
                          <p className="text-xs text-zinc-300">{perspectiveLenses.visionary_lens}</p>
                        </div>
                        <div className="p-4 bg-zinc-900 border border-emerald-500/30 rounded-xl space-y-1">
                          <h4 className="text-xs font-bold text-emerald-400">❤️ Compassionate Mentor Lens</h4>
                          <p className="text-xs text-zinc-300">{perspectiveLenses.compassionate_lens}</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-zinc-500 text-center py-8">
                        Use the dropdown above to select any entry from your Journal Vault to view 3-lenses perspective.
                      </p>
                    )}
                  </div>
                )}

                {/* TAB 5: TIME CAPSULES */}
                {activeTab === "capsules" && (
                  <div className="space-y-6">
                    <form onSubmit={handleCreateTimeCapsule} className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-3">
                      <h4 className="text-xs font-bold text-amber-400">Create Time-Capsule Letter to Future Self</h4>
                      <input
                        type="text"
                        placeholder="Capsule Title"
                        value={capsuleTitle}
                        onChange={(e) => setCapsuleTitle(e.target.value)}
                        className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100"
                      />
                      <textarea
                        placeholder="Write your letter to future self..."
                        value={capsuleContent}
                        onChange={(e) => setCapsuleContent(e.target.value)}
                        rows={3}
                        className="w-full p-2.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 resize-none"
                      />
                      <div className="flex justify-between items-center">
                        <input
                          type="date"
                          value={unlockDate}
                          onChange={(e) => setUnlockDate(e.target.value)}
                          className="p-2 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100"
                        />
                        <button type="submit" className="px-4 py-2 bg-amber-500 text-zinc-950 font-bold text-xs rounded-lg">
                          Lock Time Capsule 🔒
                        </button>
                      </div>
                      {capsuleMsg && <p className="text-xs text-emerald-400 font-bold">{capsuleMsg}</p>}
                    </form>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
