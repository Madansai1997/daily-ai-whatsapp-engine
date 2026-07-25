import React, { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Lock, KeyRound, ShieldAlert, Plus, Trash2, Search, X, Sparkles, Heart, Zap, Target, BookOpen, Clock } from "lucide-react";

interface ProjectBelieverModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Entry {
  id: number;
  content: string;
  mood_tag: string;
  created_at: string;
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

  const idleTimerRef = useRef<NodeJS.Timeout | null>(null);

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    if (activeKey) {
      idleTimerRef.current = setTimeout(() => {
        // Auto-lock after 3 mins idle
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

  // Check initialization status when modal opens
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
    } else {
      // Clear key on close for zero-knowledge safety
      setActiveKey(null);
      setEntries([]);
      setPassphrase("");
      setShowAddForm(false);
    }
  }, [isOpen]);

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
        // Setup passphrase
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
        // Verify passphrase
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
      if (res.ok) {
        setNewContent("");
        setShowAddForm(false);
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

  const handleDelete = async (id: number) => {
    if (!activeKey || !window.confirm("Permanently erase this secret entry?")) return;
    try {
      const res = await fetch(`/api/believer/entries/${id}`, {
        method: "DELETE",
        headers: { "X-Passphrase": activeKey },
      });
      if (res.ok) {
        setEntries((prev) => prev.filter((item) => item.id !== id));
      }
    } catch {
      setError("Failed to delete entry");
    }
  };

  const handleResetVault = async () => {
    if (!window.confirm("⚠️ Reset Master Passphrase? This will wipe all stored encrypted entries and allow you to set a brand new Master Passphrase.")) {
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/believer/reset", { method: "POST" });
      if (res.ok) {
        setIsInitialized(false);
        setPassphrase("");
        setActiveKey(null);
        setEntries([]);
        setError("Vault reset successfully. Enter your new Master Passphrase below.");
      } else {
        setError("Failed to reset vault");
      }
    } catch {
      setError("Network error while resetting vault");
    } finally {
      setLoading(false);
    }
  };

  const filteredEntries = entries.filter((e) =>
    e.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    e.mood_tag.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className="relative w-full max-w-2xl bg-zinc-950 border border-amber-500/30 rounded-2xl shadow-2xl shadow-amber-950/20 overflow-hidden flex flex-col max-h-[85vh]"
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
                    AES-256 Encrypted
                  </span>
                </h2>
                <p className="text-xs text-zinc-400">Private Reflection & Personal Vault</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

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
                <div className="w-14 h-14 rounded-2xl bg-zinc-900 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-4 shadow-lg shadow-amber-500/5">
                  <Lock className="w-7 h-7" />
                </div>
                <h3 className="text-xl font-medium text-zinc-100 mb-1">
                  {isInitialized ? "Enter Master Passphrase" : "Set Your Master Passphrase"}
                </h3>
                <p className="text-sm text-zinc-400 max-w-sm mb-6">
                  {isInitialized
                    ? "Your entries are encrypted locally. Enter your passphrase to unlock your journal."
                    : "Create a Master Passphrase to initialize your zero-knowledge private vault."}
                </p>

                <form onSubmit={handleUnlock} className="w-full max-w-sm space-y-4">
                  <div className="relative">
                    <input
                      type="password"
                      value={passphrase}
                      onChange={(e) => setPassphrase(e.target.value)}
                      placeholder="Master Passphrase"
                      className="w-full px-4 py-3 bg-zinc-900 border border-zinc-700 rounded-xl text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
                      autoFocus
                    />
                    <KeyRound className="absolute right-3.5 top-3.5 w-5 h-5 text-zinc-500" />
                  </div>
                  <button
                    type="submit"
                    disabled={loading || !passphrase}
                    className="w-full py-3 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium rounded-xl transition-all disabled:opacity-50 flex items-center justify-center gap-2 shadow-lg shadow-amber-500/20 cursor-pointer"
                  >
                    {loading ? "Processing..." : isInitialized ? "Unlock Vault" : "Initialize Believer"}
                  </button>

                  {isInitialized && (
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleResetVault}
                        className="text-xs text-rose-400 hover:text-rose-300 underline cursor-pointer transition-colors"
                      >
                        Forgot Passphrase? Reset Vault & Create New Passphrase
                      </button>
                    </div>
                  )}
                </form>
              </div>
            ) : (

              /* Journal Vault Interface */
              <div className="space-y-6">
                {/* Search & Actions Header */}
                <div className="flex flex-col sm:flex-row items-center gap-3">
                  <div className="relative flex-1 w-full">
                    <Search className="absolute left-3 top-2.5 w-4 h-4 text-zinc-500" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search secret entries..."
                      className="w-full pl-9 pr-4 py-2 bg-zinc-900 border border-zinc-800 rounded-xl text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50"
                    />
                  </div>
                  <button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="w-full sm:w-auto px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-medium text-sm rounded-xl flex items-center justify-center gap-2 transition-all shrink-0"
                  >
                    <Plus className="w-4 h-4" />
                    New Entry
                  </button>
                </div>

                {/* Entry Creation Form */}
                {showAddForm && (
                  <motion.form
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    onSubmit={handleCreateEntry}
                    className="p-4 bg-zinc-900/60 border border-amber-500/30 rounded-xl space-y-4"
                  >
                    <textarea
                      value={newContent}
                      onChange={(e) => setNewContent(e.target.value)}
                      placeholder="What is on your mind today? Write freely..."
                      rows={4}
                      className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-lg text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none focus:border-amber-500/50 resize-none"
                      autoFocus
                    />
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-zinc-400 font-medium">Tag:</span>
                        {MOODS.map((m) => {
                          const Icon = m.icon;
                          const isSel = selectedMood === m.id;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setSelectedMood(m.id)}
                              className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border transition-all ${
                                isSel
                                  ? m.color
                                  : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:text-zinc-200"
                              }`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                              {m.id}
                            </button>
                          );
                        })}
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setShowAddForm(false)}
                          className="px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={loading || !newContent.trim()}
                          className="px-4 py-1.5 bg-amber-500 text-zinc-950 text-xs font-semibold rounded-lg hover:bg-amber-400 transition-all disabled:opacity-50"
                        >
                          Save Encrypted
                        </button>
                      </div>
                    </div>
                  </motion.form>
                )}

                {/* Entry List */}
                <div className="space-y-4">
                  {filteredEntries.length === 0 ? (
                    <div className="py-12 text-center text-zinc-500 text-sm border border-dashed border-zinc-800 rounded-xl">
                      {searchQuery ? "No matching entries found" : "Your vault is empty. Click 'New Entry' to write."}
                    </div>
                  ) : (
                    filteredEntries.map((entry) => {
                      const moodObj = MOODS.find((m) => m.id === entry.mood_tag) || MOODS[0];
                      const Icon = moodObj.icon;
                      return (
                        <div
                          key={entry.id}
                          className="p-4 bg-zinc-900/40 border border-zinc-800/80 hover:border-zinc-700/80 rounded-xl space-y-2 transition-all group"
                        >
                          <div className="flex items-center justify-between text-xs text-zinc-500">
                            <div className="flex items-center gap-2">
                              <span className={`flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${moodObj.color}`}>
                                <Icon className="w-3 h-3" />
                                {entry.mood_tag}
                              </span>
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3 text-zinc-600" />
                                {new Date(entry.created_at).toLocaleDateString(undefined, {
                                  month: "short",
                                  day: "numeric",
                                  year: "numeric",
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </span>
                            </div>
                            <button
                              onClick={() => handleDelete(entry.id)}
                              className="opacity-0 group-hover:opacity-100 p-1 text-zinc-500 hover:text-rose-400 transition-all"
                              title="Delete Entry"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                          <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                            {entry.content}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
