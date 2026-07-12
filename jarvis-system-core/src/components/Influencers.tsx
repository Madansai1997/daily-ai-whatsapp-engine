import React, { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, Plus, X, Trash2, Radio, Youtube, Instagram, Twitter, CheckCircle2, AlertTriangle, MessageSquare } from "lucide-react";

interface Influencer {
  id: number;
  handle: string;
  platform: string;
  name: string;
  added_at: string;
}

const CYAN = "#8aebff", AMBER = "#ffd6a3", GREEN = "#5eead4", RED = "#ffb4ab";

export default function Influencers() {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  
  const emptyForm = { handle: "", platform: "youtube", name: "" };
  const [form, setForm] = useState({ ...emptyForm });

  const syncInfluencerSingle = async (id: number, name: string) => {
    setSyncingId(id);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/influencers/${id}/sync`, { method: "POST" });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setSyncResult(data.result || `No new updates found for ${name}.`);
      } else {
        setSyncResult(`Failed to sync updates for ${name}.`);
      }
    } catch {
      setSyncResult("Failed to contact backend scraper.");
    } finally {
      setSyncingId(null);
    }
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/influencers", { cache: "no-store" });
      if (res.ok) {
        setInfluencers(await res.json());
      }
    } catch {
      /* fallback */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const addInfluencer = async () => {
    if (!form.handle.trim()) {
      setErr("Handle or Channel ID is required.");
      return;
    }
    setSaving(true);
    setErr("");
    try {
      const res = await fetch("/api/influencers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          handle: form.handle.trim(),
          platform: form.platform,
          name: form.name.trim() || form.handle.trim()
        })
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.result || `HTTP ${res.status}`);
      }
      setAddOpen(false);
      setForm({ ...emptyForm });
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  const removeInfluencer = async (id: number, name: string) => {
    if (!confirm(`Stop monitoring updates from "${name}"?`)) return;
    setBusyId(id);
    try {
      await fetch(`/api/influencers/${id}/delete`, { method: "POST" });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch("/api/influencers/sync", { method: "POST" });
      const data = await res.json();
      if (res.ok && data?.ok) {
        setSyncResult(data.result || "No new updates found.");
      } else {
        setSyncResult("Scrape completed, but failed to compile summary digest.");
      }
    } catch {
      setSyncResult("Failed to contact backend scraper. Make sure the server is running.");
    } finally {
      setSyncing(false);
    }
  };

  const getPlatformIcon = (platform: string) => {
    switch (platform.toLowerCase()) {
      case "youtube":
        return <Youtube className="w-4 h-4 text-red-500" />;
      case "instagram":
        return <Instagram className="w-4 h-4 text-pink-500" />;
      default:
        return <Twitter className="w-4 h-4 text-sky-400" />;
    }
  };

  const getPlatformStyle = (platform: string) => {
    switch (platform.toLowerCase()) {
      case "youtube":
        return "border-red-500/20 bg-red-950/10 text-red-400";
      case "instagram":
        return "border-pink-500/20 bg-pink-950/10 text-pink-400";
      default:
        return "border-sky-500/20 bg-sky-950/10 text-sky-400";
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top HUD Stats & Sync Control */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="p-4 glass-panel rounded-xl border border-white/5 flex flex-col justify-between h-28">
          <span className="text-[10px] font-mono text-[#859397] tracking-widest uppercase">Monitored Profiles</span>
          <div className="flex justify-between items-end">
            <span className="text-4xl font-extrabold font-mono text-[#8aebff] leading-none glow-cyan">{influencers.length}</span>
            <span className="text-xs text-[#859397] font-mono">active feeds</span>
          </div>
        </div>

        <div className="p-4 glass-panel rounded-xl border border-white/5 flex flex-col justify-between h-28">
          <span className="text-[10px] font-mono text-[#859397] tracking-widest uppercase">System Frequency</span>
          <div className="flex justify-between items-end">
            <span className="text-2xl font-bold font-mono text-[#5eead4] leading-none">24 HOUR</span>
            <span className="text-[10px] text-green-400 flex items-center gap-1 font-mono">
              <span className="w-2 h-2 rounded-full bg-green-400 animate-ping"></span>
              schedule active
            </span>
          </div>
        </div>

        {/* Sync trigger button */}
        <div className="p-4 glass-panel rounded-xl border border-[#3c494c] flex flex-col justify-between h-28">
          <span className="text-[10px] font-mono text-[#859397] tracking-widest uppercase">Manual Overrides</span>
          <button
            onClick={syncNow}
            disabled={syncing || influencers.length === 0}
            className="w-full flex items-center justify-center gap-2 py-2 px-4 bg-[#8aebff]/10 hover:bg-[#8aebff]/20 active:scale-98 border border-[#8aebff]/30 hover:border-[#8aebff]/60 text-[#8aebff] rounded-lg transition-all text-xs font-mono font-bold cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${syncing ? "animate-spin" : ""}`} />
            {syncing ? "RUNNING SYNC..." : "SYNC ALL FEEDS"}
          </button>
        </div>
      </div>

      {/* Main stage list */}
      <div className="glass-panel rounded-xl border border-[#3c494c] p-6 space-y-6">
        <div className="flex justify-between items-center border-b border-white/10 pb-4">
          <div>
            <h3 className="text-lg font-bold text-[#dfe2f3]">Monitored Feeds</h3>
            <p className="text-xs text-[#859397]">JARVIS scans these daily for announcements and digests.</p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#8aebff]/40 text-[#8aebff] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> ADD FEED
          </button>
        </div>

        {/* Scraped Sync Output Block */}
        <AnimatePresence>
          {syncResult && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="p-4 border border-[#5eead4]/30 bg-[#5eead4]/5 rounded-lg space-y-2 overflow-hidden"
            >
              <div className="flex items-center gap-2 text-[#5eead4] text-xs font-mono font-bold">
                <CheckCircle2 className="w-4 h-4" /> SYNC COMPLETED SUCCESSFULLY
              </div>
              <div className="text-xs font-mono text-[#bbc9cd] leading-relaxed whitespace-pre-wrap bg-[#1b1f2c]/50 p-3 rounded border border-white/5">
                {syncResult}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {loading ? (
          <div className="text-center py-12 text-[#859397] font-mono text-sm">
            <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 opacity-50" />
            Decrypting watcher database...
          </div>
        ) : influencers.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/5 rounded-xl space-y-3">
            <Radio className="w-12 h-12 text-[#859397] mx-auto opacity-35" />
            <h4 className="text-[#dfe2f3] font-bold text-sm">No Monitored Channels</h4>
            <p className="text-xs text-[#859397] max-w-sm mx-auto">
              Add YouTube channels, Instagram handles, or Twitter names to start collecting structured digests.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {influencers.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-xl border flex items-center justify-between transition-all ${getPlatformStyle(item.platform)}`}
              >
                <div className="space-y-1.5 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    {getPlatformIcon(item.platform)}
                    <span className="font-bold text-sm text-[#dfe2f3] truncate block">{item.name}</span>
                  </div>
                  <span className="text-xs font-mono text-[#859397] block truncate">
                    Handle: {item.handle}
                  </span>
                </div>

                <div className="flex gap-2 items-center">
                  <button
                    disabled={busyId === item.id || syncingId !== null}
                    onClick={() => syncInfluencerSingle(item.id, item.name)}
                    className="p-2 bg-white/0 hover:bg-white/5 border border-transparent hover:border-white/10 active:scale-95 text-[#8aebff] rounded-lg cursor-pointer transition-all disabled:opacity-50"
                    title="Sync updates for this profile"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${syncingId === item.id ? "animate-spin" : ""}`} />
                  </button>

                  <button
                    disabled={busyId === item.id || syncingId !== null}
                    onClick={() => removeInfluencer(item.id, item.name)}
                    className="p-2 bg-white/0 hover:bg-white/5 border border-transparent hover:border-white/10 active:scale-95 text-[#ffb4ab] rounded-lg cursor-pointer transition-all disabled:opacity-50"
                    title="Remove influencer"
                  >
                    <Trash2 className="w-4.5 h-4.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Influencer Modal */}
      <AnimatePresence>
        {addOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setAddOpen(false)}
              className="absolute inset-0 bg-[#0a0e1a]/80 backdrop-blur-sm"
            ></motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-md p-6 glass-panel border border-[#3c494c] rounded-xl shadow-2xl space-y-6"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-3">
                <h4 className="text-md font-bold text-[#dfe2f3] flex items-center gap-2">
                  <Radio className="w-4 h-4 text-[#8aebff]" /> Add Watcher Feed
                </h4>
                <button
                  onClick={() => setAddOpen(false)}
                  className="p-1 hover:bg-white/5 rounded cursor-pointer transition-colors"
                >
                  <X className="w-4 h-4 text-[#859397]" />
                </button>
              </div>

              {err && (
                <div className="p-3 border border-red-500/30 bg-red-950/20 rounded-lg flex items-start gap-2 text-xs text-red-400">
                  <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{err}</span>
                </div>
              )}

              <div className="space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">Platform</label>
                  <select
                    value={form.platform}
                    onChange={(e) => setForm({ ...form, platform: e.target.value })}
                    className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none"
                  >
                    <option value="youtube">YouTube</option>
                    <option value="instagram">Instagram</option>
                    <option value="twitter">Twitter / X</option>
                  </select>
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">
                    {form.platform === "youtube" ? "YouTube Channel ID" : "Username Handle"}
                  </label>
                  <input
                    type="text"
                    placeholder={form.platform === "youtube" ? "e.g. UCBJycsmduvYEL83R_U4JriQ" : "e.g. nasa"}
                    value={form.handle}
                    onChange={(e) => setForm({ ...form, handle: e.target.value })}
                    className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none placeholder:text-white/20"
                  />
                  {form.platform === "youtube" && (
                    <span className="text-[9px] text-[#859397] font-mono mt-1 block">
                      Note: Channel ID starts with "UC". Find it in the page's source code or URL.
                    </span>
                  )}
                </div>

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">Display Name</label>
                  <input
                    type="text"
                    placeholder="e.g. MKBHD"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none placeholder:text-white/20"
                  />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <button
                  onClick={() => setAddOpen(false)}
                  className="py-2 px-4 bg-white/5 border border-transparent hover:border-white/10 rounded-lg text-xs font-mono text-[#bbc9cd] hover:text-[#dfe2f3] cursor-pointer transition-all"
                >
                  CANCEL
                </button>
                <button
                  onClick={addInfluencer}
                  disabled={saving}
                  className="py-2 px-4 bg-[#8aebff]/10 hover:bg-[#8aebff]/20 border border-[#8aebff]/30 text-[#8aebff] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all disabled:opacity-50"
                >
                  {saving ? "SAVING..." : "REGISTER FEED"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
