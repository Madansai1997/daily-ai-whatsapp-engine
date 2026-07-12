import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, Plus, X, Trash2, Radio, Youtube, Instagram, Twitter, Rss, CheckCircle2, AlertTriangle, ExternalLink, CheckCheck } from "lucide-react";

interface Influencer {
  id: number;
  handle: string;
  platform: string;
  name: string;
  added_at: string;
}

interface FeedPost {
  post_id: string;
  platform: string;
  handle: string;
  name: string;
  title: string;
  url: string;
  relevance_note: string;
  is_read: number;
  published_at: string;
  seen_at: string;
}

export default function Influencers({ onRead }: { onRead?: () => void }) {
  const [influencers, setInfluencers] = useState<Influencer[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [syncingId, setSyncingId] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  const [feed, setFeed] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);

  const emptyForm = { handle: "", platform: "youtube", name: "" };
  const [form, setForm] = useState({ ...emptyForm });

  const loadFeed = useCallback(async () => {
    setFeedLoading(true);
    try {
      const res = await fetch("/api/influencers/feed?limit=40", { cache: "no-store" });
      if (res.ok) setFeed(await res.json());
    } catch {
      /* ignore */
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/influencers", { cache: "no-store" });
      if (res.ok) setInfluencers(await res.json());
    } catch {
      /* fallback */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    loadFeed();
  }, [load, loadFeed]);

  const unread = feed.filter((p) => p.is_read === 0).length;

  const markAllRead = async () => {
    try {
      await fetch("/api/influencers/feed/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setFeed((f) => f.map((p) => ({ ...p, is_read: 1 })));
      onRead?.();
    } catch {
      /* ignore */
    }
  };

  const syncInfluencerSingle = async (id: number, name: string) => {
    setSyncingId(id);
    setSyncResult(null);
    try {
      const res = await fetch(`/api/influencers/${id}/sync`, { method: "POST" });
      const data = await res.json();
      setSyncResult(res.ok && data?.ok ? (data.result || `No new updates found for ${name}.`) : `Failed to sync updates for ${name}.`);
      await loadFeed();
    } catch {
      setSyncResult("Failed to contact backend scraper.");
    } finally {
      setSyncingId(null);
    }
  };

  const addInfluencer = async () => {
    if (!form.handle.trim()) {
      setErr(form.platform === "rss" ? "Feed URL is required." : "Handle or Channel ID is required.");
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
          name: form.name.trim() || form.handle.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.result || `HTTP ${res.status}`);
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
      setSyncResult(res.ok && data?.ok ? (data.result || "No new updates found.") : "Scrape completed, but failed to compile summary digest.");
      await loadFeed();
    } catch {
      setSyncResult("Failed to contact backend scraper. Make sure the server is running.");
    } finally {
      setSyncing(false);
    }
  };

  const platformIcon = (platform: string, cls = "w-4 h-4") => {
    switch (platform.toLowerCase()) {
      case "youtube": return <Youtube className={`${cls} text-red-500`} />;
      case "instagram": return <Instagram className={`${cls} text-pink-500`} />;
      case "rss": return <Rss className={`${cls} text-orange-400`} />;
      default: return <Twitter className={`${cls} text-sky-400`} />;
    }
  };

  const platformStyle = (platform: string) => {
    switch (platform.toLowerCase()) {
      case "youtube": return "border-red-500/20 bg-red-950/10";
      case "instagram": return "border-pink-500/20 bg-pink-950/10";
      case "rss": return "border-orange-500/20 bg-orange-950/10";
      default: return "border-sky-500/20 bg-sky-950/10";
    }
  };

  const needsKey = form.platform === "instagram" || form.platform === "twitter";

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      {/* Top HUD Stats & Sync Control */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
        <div className="p-4 glass-panel rounded-xl border border-white/5 flex flex-col justify-between h-28">
          <span className="text-[10px] font-mono text-[#859397] tracking-widest uppercase">Monitored Feeds</span>
          <div className="flex justify-between items-end">
            <span className="text-4xl font-extrabold font-mono text-[#8aebff] leading-none glow-cyan">{influencers.length}</span>
            <span className="text-xs text-[#859397] font-mono">active</span>
          </div>
        </div>

        <div className="p-4 glass-panel rounded-xl border border-white/5 flex flex-col justify-between h-28">
          <span className="text-[10px] font-mono text-[#859397] tracking-widest uppercase">Unread · Relevant</span>
          <div className="flex justify-between items-end">
            <span className="text-4xl font-extrabold font-mono text-[#a3e635] leading-none">{unread}</span>
            <span className="text-[10px] text-[#859397] font-mono">signal-ranked</span>
          </div>
        </div>

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
              <CheckCircle2 className="w-4 h-4" /> SYNC COMPLETED
            </div>
            <div className="text-xs font-mono text-[#bbc9cd] leading-relaxed whitespace-pre-wrap bg-[#1b1f2c]/50 p-3 rounded border border-white/5">
              {syncResult}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Latest feed (signal-ranked persistent history) ── */}
      <div className="glass-panel rounded-xl border border-[#3c494c] p-6 space-y-4">
        <div className="flex justify-between items-center border-b border-white/10 pb-4">
          <div>
            <h3 className="text-lg font-bold text-[#dfe2f3]">Latest Updates</h3>
            <p className="text-xs text-[#859397]">Relevance-ranked to your interests — noise is filtered out automatically.</p>
          </div>
          {unread > 0 && (
            <button
              onClick={markAllRead}
              className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#a3e635]/40 text-[#a3e635] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all"
            >
              <CheckCheck className="w-3.5 h-3.5" /> MARK ALL READ
            </button>
          )}
        </div>

        {feedLoading ? (
          <div className="text-center py-10 text-[#859397] font-mono text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 opacity-50" /> Loading feed…
          </div>
        ) : feed.length === 0 ? (
          <div className="text-center py-10 text-[#859397] text-xs">
            No updates yet. Add a feed below and hit <span className="text-[#8aebff]">SYNC ALL FEEDS</span> to pull the latest.
          </div>
        ) : (
          <div className="space-y-2">
            {feed.map((p) => (
              <a
                key={p.post_id}
                href={p.url || "#"}
                target={p.url ? "_blank" : undefined}
                rel="noreferrer"
                className={`flex items-start gap-3 p-3 rounded-lg border transition-all group ${platformStyle(p.platform)} ${p.is_read === 0 ? "" : "opacity-60"} hover:opacity-100 hover:border-white/20`}
              >
                {p.is_read === 0 && <span className="w-2 h-2 rounded-full bg-[#a3e635] mt-1.5 shrink-0" title="unread" />}
                <span className="mt-0.5 shrink-0">{platformIcon(p.platform, "w-3.5 h-3.5")}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] text-[#dfe2f3] font-medium leading-snug group-hover:text-[#8aebff] flex items-start gap-1">
                    <span className="min-w-0">{p.title || p.url}</span>
                    {p.url && <ExternalLink className="w-3 h-3 opacity-40 shrink-0 mt-1" />}
                  </p>
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-[10px] font-mono text-[#859397]">{p.name}</span>
                    {p.relevance_note && (
                      <span className="text-[10px] font-mono text-[#a3e635]/80 bg-[#a3e635]/10 px-1.5 py-0.5 rounded">
                        {p.relevance_note}
                      </span>
                    )}
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>

      {/* ── Manage feeds ── */}
      <div className="glass-panel rounded-xl border border-[#3c494c] p-6 space-y-6">
        <div className="flex justify-between items-center border-b border-white/10 pb-4">
          <div>
            <h3 className="text-lg font-bold text-[#dfe2f3]">Monitored Feeds</h3>
            <p className="text-xs text-[#859397]">JARVIS scans these daily. YouTube & RSS are free; Instagram/X need a RapidAPI key.</p>
          </div>
          <button
            onClick={() => setAddOpen(true)}
            className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#8aebff]/40 text-[#8aebff] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all"
          >
            <Plus className="w-3.5 h-3.5" /> ADD FEED
          </button>
        </div>

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
              Add a YouTube channel or any RSS feed (Substack, Medium, blogs, Reddit) to start collecting ranked digests — all free.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {influencers.map((item) => (
              <div
                key={item.id}
                className={`p-4 rounded-xl border flex items-center justify-between transition-all ${platformStyle(item.platform)}`}
              >
                <div className="space-y-1.5 min-w-0 pr-4">
                  <div className="flex items-center gap-2">
                    {platformIcon(item.platform)}
                    <span className="font-bold text-sm text-[#dfe2f3] truncate block">{item.name}</span>
                  </div>
                  <span className="text-xs font-mono text-[#859397] block truncate">{item.handle}</span>
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

      {/* Add Feed Modal */}
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
                <button onClick={() => setAddOpen(false)} className="p-1 hover:bg-white/5 rounded cursor-pointer transition-colors">
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
                    <option value="youtube">YouTube (free)</option>
                    <option value="rss">RSS / Blog / Substack (free)</option>
                    <option value="instagram">Instagram (needs API key)</option>
                    <option value="twitter">Twitter / X (needs API key)</option>
                  </select>
                </div>

                {needsKey && (
                  <div className="p-2.5 border border-[#ffd6a3]/25 bg-[#ffd6a3]/5 rounded-lg text-[10px] text-[#ffd6a3] font-mono flex items-start gap-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>Requires a paid RAPIDAPI_KEY on the server. It'll register, but stay quiet until a key is set.</span>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">
                    {form.platform === "youtube" ? "YouTube Handle or Channel ID" : form.platform === "rss" ? "Feed URL" : "Username Handle"}
                  </label>
                  <input
                    type="text"
                    placeholder={
                      form.platform === "youtube" ? "e.g. @mkbhd or UCBJycsmduvYEL83R_U4JriQ"
                        : form.platform === "rss" ? "e.g. https://simonwillison.net/atom/everything/"
                        : "e.g. nasa"
                    }
                    value={form.handle}
                    onChange={(e) => setForm({ ...form, handle: e.target.value })}
                    className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none placeholder:text-white/20"
                  />
                  {form.platform === "rss" && (
                    <span className="text-[9px] text-[#859397] font-mono mt-1 block">
                      Any RSS/Atom URL. Reddit: add <span className="text-[#8aebff]">.rss</span> to a subreddit; Medium: <span className="text-[#8aebff]">/feed/@user</span>.
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
                <button onClick={() => setAddOpen(false)} className="py-2 px-4 bg-white/5 border border-transparent hover:border-white/10 rounded-lg text-xs font-mono text-[#bbc9cd] hover:text-[#dfe2f3] cursor-pointer transition-all">
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
