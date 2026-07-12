import { useEffect, useState } from "react";
import { Newspaper, FlaskConical, Radio } from "lucide-react";
import DailyUpdate from "./DailyUpdate";
import TrendLab from "./TrendLab";
import Influencers from "./Influencers";

/* Discover groups the three AI-feed screens under one nav destination:
   Daily AI Update (learn) + Trend Lab (build) + Influencer Watcher (scrape). */
export default function Discover({ initial = "daily" }: { initial?: "daily" | "trends" | "influencers" }) {
  const [tab, setTab] = useState<"daily" | "trends" | "influencers">(initial);
  const [unread, setUnread] = useState(0);
  useEffect(() => { setTab(initial); }, [initial]);

  // Relevant-unread badge on the Watcher tab — the "NEW lane" signal for the feed.
  useEffect(() => {
    let alive = true;
    const poll = () =>
      fetch("/api/influencers/unread-count", { cache: "no-store" })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (alive && d) setUnread(d.count || 0); })
        .catch(() => { /* ignore */ });
    poll();
    const t = setInterval(() => { if (!document.hidden) poll(); }, 60000);
    return () => { alive = false; clearInterval(t); };
  }, [tab]);

  const tabCls = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-bold font-mono flex items-center gap-2 transition-all cursor-pointer ${
      active
        ? "bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff]"
        : "border border-transparent text-[#859397] hover:text-[#dfe2f3]"
    }`;

  return (
    <div className="w-full">
      <div className="max-w-4xl mx-auto mb-5 flex flex-wrap items-center gap-2">
        <button onClick={() => setTab("daily")} className={tabCls(tab === "daily")}>
          <Newspaper className="w-4 h-4" /> Daily AI Update
        </button>
        <button onClick={() => setTab("trends")} className={tabCls(tab === "trends")}>
          <FlaskConical className="w-4 h-4" /> Trend Lab
        </button>
        <button onClick={() => setTab("influencers")} className={tabCls(tab === "influencers")}>
          <Radio className="w-4 h-4" /> Influencer Watcher
          {unread > 0 && (
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold bg-[#a3e635] text-[#0a0e1a] leading-none">
              {unread}
            </span>
          )}
        </button>
      </div>
      {tab === "daily" ? <DailyUpdate /> : tab === "trends" ? <TrendLab /> : <Influencers onRead={() => setUnread(0)} />}
    </div>
  );
}
