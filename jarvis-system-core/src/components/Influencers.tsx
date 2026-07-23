import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, Plus, X, Trash2, Radio, Youtube, Instagram, Twitter, Rss, CheckCircle2, AlertTriangle, ExternalLink, CheckCheck, Compass, Sparkles, ChevronDown, ChevronRight, Globe } from "lucide-react";

interface Influencer {
  id: number;
  handle: string;
  platform: string;
  name: string;
  yt_content?: string;
  domain?: string;
  added_at: string;
}

interface Domain { domain: string; n: number; }
interface Candidate { name: string; handle: string; display_handle: string; why: string; recent: string; }

interface FeedPost {
  post_id: string;
  platform: string;
  handle: string;
  name: string;
  title: string;
  summary?: string;
  url: string;
  relevant: number;
  relevance_note: string;
  is_read: number;
  published_at: string;
  seen_at: string;
  brief?: string;
  apply?: string;
  insight_source?: string;
}
interface Insight { open?: boolean; loading?: boolean; brief?: string; apply?: string; source?: string; error?: string; }

const SOURCE_LABEL: Record<string, string> = {
  transcript: "summarized from the video transcript",
  article: "summarized from the full article",
  description: "from the post description (no transcript available)",
  title: "from the title only (couldn't read the content)",
  saved: "saved analysis",
};

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

  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [feedLoading, setFeedLoading] = useState(true);
  const [showFiltered, setShowFiltered] = useState(false);
  const [insights, setInsights] = useState<Record<string, Insight>>({});

  const [groundingState, setGroundingState] = useState<Record<string, { open?: boolean; loading?: boolean; context?: string; citations?: any[]; error?: string; }>>({});

  const toggleGrounding = async (p: FeedPost) => {
    const cur = groundingState[p.post_id];
    if (cur?.open) {
      setGroundingState((s) => ({ ...s, [p.post_id]: { ...cur, open: false } }));
      return;
    }
    if (cur?.context) {
      setGroundingState((s) => ({ ...s, [p.post_id]: { ...cur, open: true } }));
      return;
    }
    setGroundingState((s) => ({ ...s, [p.post_id]: { open: true, loading: true } }));
    try {
      const checkRes = await fetch(`/api/influencers/post/${encodeURIComponent(p.post_id)}/ground`);
      if (checkRes.ok) {
        const d = await checkRes.json();
        setGroundingState((s) => ({
          ...s,
          [p.post_id]: { open: true, context: d.grounded_context, citations: d.citations }
        }));
        return;
      }
      const res = await fetch(`/api/influencers/post/${encodeURIComponent(p.post_id)}/ground`, { method: "POST" });
      const d = await res.json();
      if (d.grounded_context) {
        setGroundingState((s) => ({
          ...s,
          [p.post_id]: { open: true, context: d.grounded_context, citations: d.citations }
        }));
      } else {
        setGroundingState((s) => ({
          ...s,
          [p.post_id]: { open: true, error: d.error || "Failed to generate grounding brief." }
        }));
      }
    } catch {
      setGroundingState((s) => ({
        ...s,
        [p.post_id]: { open: true, error: "Failed to connect to grounding engine." }
      }));
    }
  };

  // "What's in it + use it in your project" — brief summary + a concrete project takeaway,
  // generated on demand and cached on the server so re-opening is instant.
  const toggleInsight = async (p: FeedPost) => {
    const cur = insights[p.post_id];
    if (cur?.open) { setInsights((s) => ({ ...s, [p.post_id]: { ...cur, open: false } })); return; }
    // Already have it (from the feed row or a prior fetch)? Just open.
    const have = cur?.brief || p.brief;
    if (have) {
      setInsights((s) => ({ ...s, [p.post_id]: { open: true, brief: cur?.brief || p.brief, apply: cur?.apply || p.apply, source: cur?.source || p.insight_source } }));
      return;
    }
    setInsights((s) => ({ ...s, [p.post_id]: { open: true, loading: true } }));
    try {
      const res = await fetch(`/api/influencers/post/${encodeURIComponent(p.post_id)}/insight`, { method: "POST" });
      const d = await res.json();
      if (d?.ok) setInsights((s) => ({ ...s, [p.post_id]: { open: true, brief: d.brief, apply: d.apply, source: d.source } }));
      else setInsights((s) => ({ ...s, [p.post_id]: { open: true, error: d?.error || "Couldn't analyze this one." } }));
    } catch {
      setInsights((s) => ({ ...s, [p.post_id]: { open: true, error: "Couldn't reach the analyzer." } }));
    }
  };

  const [domains, setDomains] = useState<Domain[]>([]);
  const [activeDomain, setActiveDomain] = useState("");

  // Discovery flow (create a domain -> find creators -> review -> add).
  const [discOpen, setDiscOpen] = useState(false);
  const [discDomain, setDiscDomain] = useState("");
  const [discYt, setDiscYt] = useState("videos");
  const [discLoading, setDiscLoading] = useState(false);
  const [discCands, setDiscCands] = useState<Candidate[] | null>(null);
  const [discChecked, setDiscChecked] = useState<Record<string, boolean>>({});
  const [discMsg, setDiscMsg] = useState("");
  const [discAdding, setDiscAdding] = useState(false);

  const emptyForm = { handle: "", platform: "youtube", name: "", yt_content: "videos", domain: "" };
  const [form, setForm] = useState({ ...emptyForm });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const [showOlder, setShowOlder] = useState(false);
  const windowDaysRef = useRef(5); // feed shows the last few days by default; 0 = full history

  const loadFeed = useCallback(async (domain = "") => {
    setFeedLoading(true);
    try {
      // Pull everything (all=1); we curate to the relevant subset client-side so the "filtered"
      // items can be revealed on demand instead of silently vanishing. days keeps it recent.
      const q = domain ? `&domain=${encodeURIComponent(domain)}` : "";
      const res = await fetch(`/api/influencers/feed?all=1&limit=60&days=${windowDaysRef.current}${q}`, { cache: "no-store" });
      if (res.ok) setPosts(await res.json());
    } catch {
      /* ignore */
    } finally {
      setFeedLoading(false);
    }
  }, []);

  const toggleOlder = () => {
    const next = !showOlder;
    setShowOlder(next);
    windowDaysRef.current = next ? 0 : 5;
    loadFeed(activeDomain);
  };

  const loadDomains = useCallback(async () => {
    try {
      const res = await fetch("/api/influencers/domains", { cache: "no-store" });
      if (res.ok) setDomains(await res.json());
    } catch {
      /* ignore */
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
    loadDomains();
  }, [load, loadFeed, loadDomains]);

  const selectDomain = (d: string) => {
    setActiveDomain(d);
    setShowFiltered(false);
    loadFeed(d);
  };

  const openDiscover = () => {
    setDiscOpen(true);
    setDiscDomain("");
    setDiscYt("videos");
    setDiscCands(null);
    setDiscChecked({});
    setDiscMsg("");
  };

  const runDiscover = async () => {
    if (!discDomain.trim()) { setDiscMsg("Enter a domain first."); return; }
    setDiscLoading(true);
    setDiscMsg("");
    setDiscCands(null);
    try {
      const res = await fetch("/api/influencers/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: discDomain.trim(), limit: 15 }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.result || `HTTP ${res.status}`);
      const cands: Candidate[] = data.candidates || [];
      setDiscCands(cands);
      setDiscChecked(Object.fromEntries(cands.map((c) => [c.handle, true])));
      if (cands.length === 0) setDiscMsg("No verifiable channels found — try a broader domain name.");
    } catch (e) {
      setDiscMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscLoading(false);
    }
  };

  const addDiscovered = async () => {
    const chosen = (discCands || []).filter((c) => discChecked[c.handle]);
    if (chosen.length === 0) { setDiscMsg("Select at least one creator."); return; }
    setDiscAdding(true);
    try {
      const res = await fetch("/api/influencers/bulk-add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domain: discDomain.trim(), yt_content: discYt, creators: chosen }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.result || `HTTP ${res.status}`);
      setDiscOpen(false);
      await load();
      await loadDomains();
      setSyncResult(`Added ${data.added} creator(s) to "${discDomain.trim()}". Hit SYNC ALL FEEDS to pull their latest.`);
    } catch (e) {
      setDiscMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setDiscAdding(false);
    }
  };

  const relevant = posts.filter((p) => p.relevant);
  const filtered = posts.filter((p) => !p.relevant);
  const visible = showFiltered ? posts : relevant;
  const unread = relevant.filter((p) => p.is_read === 0).length;

  // Group the feed by channel so multiple synced feeds don't merge into one endless pile.
  // `visible` is newest-first, so first occurrence of a channel orders the groups by recency.
  const groups: [string, FeedPost[]][] = [];
  {
    const idx: Record<string, number> = {};
    for (const p of visible) {
      const key = p.name || p.handle;
      if (idx[key] === undefined) { idx[key] = groups.length; groups.push([key, []]); }
      groups[idx[key]][1].push(p);
    }
  }
  const allCollapsed = groups.length > 0 && groups.every(([c]) => collapsed[c]);
  const toggleAll = () => {
    const next = !allCollapsed;
    setCollapsed(Object.fromEntries(groups.map(([c]) => [c, next])));
  };

  const markAllRead = async () => {
    try {
      await fetch("/api/influencers/feed/read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      setPosts((f) => f.map((p) => ({ ...p, is_read: 1 })));
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
      await loadFeed(activeDomain);
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
          yt_content: form.platform === "youtube" ? form.yt_content : "all",
          domain: form.domain.trim(),
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.result || `HTTP ${res.status}`);
      setAddOpen(false);
      setForm({ ...emptyForm });
      await load();
      await loadDomains();
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
      await loadFeed(activeDomain);
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

      {/* ── Domains: auto-discover the top creators in a topic ── */}
      <div className="glass-panel rounded-xl border border-[#3c494c] p-6 space-y-4">
        <div className="flex justify-between items-center">
          <div className="flex items-center gap-2">
            <Compass className="w-4 h-4 text-[#8aebff]" />
            <h3 className="text-lg font-bold text-[#dfe2f3]">Domains</h3>
          </div>
          <button
            onClick={openDiscover}
            className="flex items-center gap-1.5 py-1.5 px-3 bg-[#8aebff]/10 hover:bg-[#8aebff]/20 border border-[#8aebff]/30 text-[#8aebff] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all"
          >
            <Sparkles className="w-3.5 h-3.5" /> NEW DOMAIN
          </button>
        </div>
        <p className="text-xs text-[#859397] -mt-1">
          Name a topic and JARVIS finds & verifies the top YouTube creators in it — then analyzes their uploads.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => selectDomain("")}
            className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${activeDomain === "" ? "bg-[#8aebff]/15 border-[#8aebff]/50 text-[#8aebff]" : "border-white/10 text-[#859397] hover:text-[#dfe2f3]"}`}
          >
            All
          </button>
          {domains.map((d) => (
            <button
              key={d.domain}
              onClick={() => selectDomain(d.domain)}
              className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all cursor-pointer ${activeDomain === d.domain ? "bg-[#8aebff]/15 border-[#8aebff]/50 text-[#8aebff]" : "border-white/10 text-[#859397] hover:text-[#dfe2f3]"}`}
            >
              {d.domain} <span className="opacity-60">· {d.n}</span>
            </button>
          ))}
          {domains.length === 0 && (
            <span className="text-[11px] text-[#5c6a6d] font-mono py-1.5">No domains yet — create one to auto-build a feed.</span>
          )}
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
            <h3 className="text-lg font-bold text-[#dfe2f3]">Latest Updates {activeDomain && <span className="text-xs font-mono text-[#8aebff]">· {activeDomain}</span>}</h3>
            <p className="text-xs text-[#859397]">
              {showOlder ? "Full history · " : "Last 5 days · "}
              <button onClick={toggleOlder} className="text-[#8aebff] hover:underline cursor-pointer font-mono">
                {showOlder ? "show recent only" : "show older →"}
              </button>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {groups.length > 1 && (
              <button
                onClick={toggleAll}
                className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 text-[#bbc9cd] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all"
              >
                {allCollapsed ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                {allCollapsed ? "EXPAND ALL" : "COLLAPSE ALL"}
              </button>
            )}
            {unread > 0 && (
              <button
                onClick={markAllRead}
                className="flex items-center gap-1.5 py-1.5 px-3 bg-white/5 hover:bg-white/10 border border-white/10 hover:border-[#a3e635]/40 text-[#a3e635] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all"
              >
                <CheckCheck className="w-3.5 h-3.5" /> MARK ALL READ
              </button>
            )}
          </div>
        </div>

        {feedLoading ? (
          <div className="text-center py-10 text-[#859397] font-mono text-sm">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 opacity-50" /> Loading feed…
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-10 text-[#859397] text-xs">
            No updates yet. Add a feed below and hit <span className="text-[#8aebff]">SYNC ALL FEEDS</span> to pull the latest.
          </div>
        ) : (
          <>
            <div className="space-y-3">
              {groups.map(([channel, items]) => {
                const isCollapsed = !!collapsed[channel];
                const unreadN = items.filter((p) => p.is_read === 0 && p.relevant).length;
                return (
                  <div key={channel} className="rounded-lg border border-white/8 overflow-hidden">
                    <button
                      onClick={() => setCollapsed((m) => ({ ...m, [channel]: !m[channel] }))}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-white/[0.03] hover:bg-white/[0.06] transition-colors cursor-pointer"
                    >
                      {isCollapsed ? <ChevronRight className="w-3.5 h-3.5 text-[#859397] shrink-0" /> : <ChevronDown className="w-3.5 h-3.5 text-[#859397] shrink-0" />}
                      {platformIcon(items[0].platform, "w-3.5 h-3.5")}
                      <span className="text-[13px] font-bold text-[#dfe2f3] truncate">{channel}</span>
                      <span className="text-[10px] font-mono text-[#859397]">· {items.length}</span>
                      {unreadN > 0 && (
                        <span className="ml-auto text-[10px] font-mono font-bold text-[#0a0e1a] bg-[#a3e635] px-1.5 py-0.5 rounded-full leading-none shrink-0">{unreadN} new</span>
                      )}
                    </button>
                    {!isCollapsed && (
                      <div className="divide-y divide-white/5">
                        {items.map((p) => {
                          const ins = insights[p.post_id];
                          const open = !!ins?.open;
                          return (
                          <div
                            key={p.post_id}
                            className={`px-3 py-2.5 transition-all ${p.relevant ? "" : "opacity-45 grayscale-[0.4] hover:opacity-90"}`}
                          >
                            <div className="flex items-start gap-3 group">
                              {p.is_read === 0 && p.relevant ? (
                                <span className="w-2 h-2 rounded-full bg-[#a3e635] mt-1.5 shrink-0" title="unread" />
                              ) : (
                                <span className="w-2 h-2 mt-1.5 shrink-0" />
                              )}
                              <div className="min-w-0 flex-1">
                                <a href={p.url || "#"} target={p.url ? "_blank" : undefined} rel="noreferrer"
                                  className="text-[13px] text-[#dfe2f3] font-medium leading-snug hover:text-[#8aebff] flex items-start gap-1">
                                  <span className="min-w-0">{p.title || p.url}</span>
                                  {p.url && <ExternalLink className="w-3 h-3 opacity-40 shrink-0 mt-1" />}
                                </a>
                                <div className="flex items-center gap-2 mt-1 flex-wrap">
                                  {p.relevant && p.relevance_note && (
                                    <span className="text-[10px] font-mono text-[#a3e635]/80 bg-[#a3e635]/10 px-1.5 py-0.5 rounded">{p.relevance_note}</span>
                                  )}
                                  {!p.relevant && (
                                    <span className="text-[10px] font-mono text-[#859397]/70 bg-white/5 px-1.5 py-0.5 rounded">off-topic</span>
                                  )}
                                  <button onClick={() => toggleInsight(p)}
                                    className="text-[10px] font-mono text-[#8aebff]/90 bg-[#8aebff]/10 hover:bg-[#8aebff]/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer transition-all">
                                    <Sparkles className="w-3 h-3" /> {open ? "hide" : (ins?.brief || p.brief ? "brief + use it" : "what's in it + use it")}
                                    <ChevronDown className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`} />
                                  </button>
                                  <button onClick={() => toggleGrounding(p)}
                                    className="text-[10px] font-mono text-[#c084fc]/90 bg-[#c084fc]/10 hover:bg-[#c084fc]/20 px-1.5 py-0.5 rounded inline-flex items-center gap-1 cursor-pointer transition-all">
                                    <Globe className="w-3 h-3" /> Verify Live Context
                                    <ChevronDown className={`w-3 h-3 transition-transform ${groundingState[p.post_id]?.open ? "rotate-180" : ""}`} />
                                  </button>
                                </div>
                              </div>
                            </div>
                            {open && (
                              <div className="mt-2 ml-5 rounded-lg border border-[#8aebff]/15 bg-[#8aebff]/[0.04] p-3 space-y-2">
                                {ins?.loading ? (
                                  <div className="flex items-center gap-2 text-[11px] font-mono text-[#859397]">
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Reading it and mapping it to your project…
                                  </div>
                                ) : ins?.error ? (
                                  <p className="text-[11px] font-mono text-[#ffb4ab]">{ins.error}</p>
                                ) : (
                                  <>
                                    <div>
                                      <div className="text-[9px] font-mono uppercase tracking-widest text-[#859397] mb-0.5">What it says</div>
                                      <p className="text-[12px] text-[#dfe2f3] leading-relaxed">{ins?.brief || p.brief}</p>
                                    </div>
                                    <div>
                                      <div className="text-[9px] font-mono uppercase tracking-widest text-[#5eead4] mb-0.5 flex items-center gap-1"><Compass className="w-3 h-3" /> Use it in your project</div>
                                      <p className="text-[12px] text-[#bbc9cd] leading-relaxed">{ins?.apply || p.apply}</p>
                                    </div>
                                    {(ins?.source || p.insight_source) && (
                                      <p className="text-[9px] font-mono text-[#859397]/70 pt-1 border-t border-white/5">
                                        {SOURCE_LABEL[(ins?.source || p.insight_source) as string] || (ins?.source || p.insight_source)}
                                      </p>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                            {groundingState[p.post_id]?.open && (
                              <div className="mt-2 ml-5 rounded-lg border border-[#c084fc]/15 bg-[#c084fc]/[0.04] p-3 space-y-2 font-mono text-xs">
                                {groundingState[p.post_id]?.loading ? (
                                  <div className="flex items-center gap-2 text-[11px] text-[#859397]">
                                    <RefreshCw className="w-3.5 h-3.5 animate-spin" /> Verifying facts and documentation...
                                  </div>
                                ) : groundingState[p.post_id]?.error ? (
                                  <p className="text-[11px] text-red-400">{groundingState[p.post_id]?.error}</p>
                                ) : (
                                  <>
                                    <div>
                                      <div className="text-[9px] uppercase tracking-widest text-[#c084fc] mb-1">Factual Context & Grounding Brief</div>
                                      <p className="text-[12px] text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">
                                        {groundingState[p.post_id]?.context}
                                      </p>
                                    </div>
                                    {groundingState[p.post_id]?.citations && (groundingState[p.post_id]?.citations || []).length > 0 && (
                                      <div className="pt-2 border-t border-white/5 space-y-1">
                                        <div className="text-[9px] uppercase tracking-widest text-[#859397]">Verified Documentation URLs:</div>
                                        <div className="flex flex-wrap gap-2 pt-1">
                                          {(groundingState[p.post_id]?.citations || []).map((cit: any, i: number) => (
                                            <a
                                              key={i}
                                              href={cit.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="px-2 py-0.5 rounded bg-[#c084fc]/10 border border-[#c084fc]/20 text-[10px] text-[#c084fc] hover:bg-[#c084fc]/20 flex items-center gap-1"
                                            >
                                              {cit.title}
                                            </a>
                                          ))}
                                        </div>
                                      </div>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {relevant.length === 0 && !showFiltered && filtered.length > 0 && (
              <p className="text-center text-[11px] text-[#859397] pt-1">
                Nothing ranked as relevant to your interests yet.
              </p>
            )}
            {filtered.length > 0 && (
              <button
                onClick={() => setShowFiltered((s) => !s)}
                className="w-full text-center text-[11px] font-mono text-[#8aebff]/80 hover:text-[#8aebff] py-1.5 cursor-pointer transition-colors"
              >
                {showFiltered ? "Hide filtered" : `Show ${filtered.length} filtered (off-topic) →`}
              </button>
            )}
          </>
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
            onClick={() => { setForm({ ...emptyForm, domain: activeDomain }); setErr(""); setAddOpen(true); }}
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
                    {item.platform.toLowerCase() === "youtube" && item.yt_content && item.yt_content !== "all" && (
                      <span className="text-[9px] font-mono text-[#859397] bg-white/5 px-1.5 py-0.5 rounded shrink-0 uppercase">
                        {item.yt_content === "videos" ? "videos" : "shorts"}
                      </span>
                    )}
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

                {form.platform === "youtube" && (
                  <div className="space-y-1">
                    <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">Content type</label>
                    <select
                      value={form.yt_content}
                      onChange={(e) => setForm({ ...form, yt_content: e.target.value })}
                      className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none"
                    >
                      <option value="videos">Full videos only</option>
                      <option value="shorts">Shorts only</option>
                      <option value="all">Both</option>
                    </select>
                    <span className="text-[9px] text-[#859397] font-mono mt-1 block">
                      Skips Shorts by default — flip to include the channel's rapid-fire clips.
                    </span>
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

                <div className="space-y-1">
                  <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">Add to domain <span className="text-[#5c6a6d] normal-case">(optional)</span></label>
                  <input
                    type="text"
                    list="domain-options"
                    placeholder="Pick a domain or type a new one — leave blank for none"
                    value={form.domain}
                    onChange={(e) => setForm({ ...form, domain: e.target.value })}
                    className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none placeholder:text-white/20"
                  />
                  <datalist id="domain-options">
                    {domains.map((d) => <option key={d.domain} value={d.domain} />)}
                  </datalist>
                  <span className="text-[9px] text-[#859397] font-mono mt-1 block">
                    Groups this channel under a domain so it shows with the rest of that topic.
                  </span>
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

      {/* Discover-a-Domain Modal */}
      <AnimatePresence>
        {discOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => !discLoading && !discAdding && setDiscOpen(false)}
              className="absolute inset-0 bg-[#0a0e1a]/80 backdrop-blur-sm"
            ></motion.div>

            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 15 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 15 }}
              className="relative w-full max-w-lg p-6 glass-panel border border-[#3c494c] rounded-xl shadow-2xl space-y-5 max-h-[85vh] overflow-y-auto"
            >
              <div className="flex justify-between items-center border-b border-white/10 pb-3">
                <h4 className="text-md font-bold text-[#dfe2f3] flex items-center gap-2">
                  <Compass className="w-4 h-4 text-[#8aebff]" /> Build a Domain Feed
                </h4>
                <button onClick={() => !discLoading && !discAdding && setDiscOpen(false)} className="p-1 hover:bg-white/5 rounded cursor-pointer transition-colors">
                  <X className="w-4 h-4 text-[#859397]" />
                </button>
              </div>

              <div className="flex gap-2 items-end">
                <div className="flex-1 space-y-1">
                  <label className="text-[10px] font-mono text-[#859397] tracking-wider uppercase block">Domain / topic</label>
                  <input
                    type="text"
                    placeholder="e.g. AI & LLMs, Data Analytics, Startup growth"
                    value={discDomain}
                    onChange={(e) => setDiscDomain(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !discLoading) runDiscover(); }}
                    className="w-full py-2 px-3 bg-[#1b1f2c]/85 border border-[#3c494c] rounded-lg text-sm text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none placeholder:text-white/20"
                  />
                </div>
                <button
                  onClick={runDiscover}
                  disabled={discLoading}
                  className="py-2 px-4 bg-[#8aebff]/10 hover:bg-[#8aebff]/20 border border-[#8aebff]/30 text-[#8aebff] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  {discLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
                  {discLoading ? "FINDING…" : "FIND CREATORS"}
                </button>
              </div>

              {discMsg && (
                <div className="p-2.5 border border-[#ffd6a3]/25 bg-[#ffd6a3]/5 rounded-lg text-[11px] text-[#ffd6a3] font-mono">{discMsg}</div>
              )}

              {discLoading && (
                <div className="text-center py-8 text-[#859397] font-mono text-xs">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-3 opacity-50" />
                  Curating creators & verifying their channels…
                </div>
              )}

              {discCands && discCands.length > 0 && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-mono text-[#859397]">
                      {discCands.filter((c) => discChecked[c.handle]).length}/{discCands.length} selected · verified channels
                    </span>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] font-mono text-[#859397]">Content</label>
                      <select
                        value={discYt}
                        onChange={(e) => setDiscYt(e.target.value)}
                        className="py-1 px-2 bg-[#1b1f2c]/85 border border-[#3c494c] rounded text-[11px] text-[#dfe2f3] font-mono focus:border-[#8aebff] outline-none"
                      >
                        <option value="videos">Videos only</option>
                        <option value="shorts">Shorts only</option>
                        <option value="all">Both</option>
                      </select>
                    </div>
                  </div>

                  <div className="space-y-2 max-h-[38vh] overflow-y-auto pr-1">
                    {discCands.map((c) => (
                      <label
                        key={c.handle}
                        className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all ${discChecked[c.handle] ? "border-[#8aebff]/40 bg-[#8aebff]/5" : "border-white/10 bg-white/[0.02] opacity-70"}`}
                      >
                        <input
                          type="checkbox"
                          checked={!!discChecked[c.handle]}
                          onChange={(e) => setDiscChecked((m) => ({ ...m, [c.handle]: e.target.checked }))}
                          className="mt-1 accent-[#8aebff]"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Youtube className="w-3.5 h-3.5 text-red-500 shrink-0" />
                            <span className="text-[13px] font-bold text-[#dfe2f3] truncate">{c.name}</span>
                            <span className="text-[10px] font-mono text-[#859397] truncate">{c.display_handle}</span>
                          </div>
                          {c.why && <p className="text-[11px] text-[#a3e635]/80 mt-0.5">{c.why}</p>}
                          {c.recent && <p className="text-[10px] font-mono text-[#5c6a6d] mt-0.5 truncate">latest: {c.recent}</p>}
                        </div>
                      </label>
                    ))}
                  </div>

                  <div className="flex gap-3 justify-end pt-1 border-t border-white/10">
                    <button onClick={() => setDiscOpen(false)} className="py-2 px-4 bg-white/5 border border-transparent hover:border-white/10 rounded-lg text-xs font-mono text-[#bbc9cd] cursor-pointer transition-all">
                      CANCEL
                    </button>
                    <button
                      onClick={addDiscovered}
                      disabled={discAdding}
                      className="py-2 px-4 bg-[#a3e635]/10 hover:bg-[#a3e635]/20 border border-[#a3e635]/30 text-[#a3e635] rounded-lg text-xs font-mono font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1.5"
                    >
                      {discAdding ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                      ADD {discCands.filter((c) => discChecked[c.handle]).length} CREATOR(S)
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
