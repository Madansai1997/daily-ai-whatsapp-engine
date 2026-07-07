import { useEffect, useState } from "react";
import { Newspaper, FlaskConical } from "lucide-react";
import DailyUpdate from "./DailyUpdate";
import TrendLab from "./TrendLab";

/* Discover groups the two AI-feed screens under one nav destination:
   Daily AI Update (learn) + Trend Lab (build). */
export default function Discover({ initial = "daily" }: { initial?: "daily" | "trends" }) {
  const [tab, setTab] = useState<"daily" | "trends">(initial);
  useEffect(() => { setTab(initial); }, [initial]);

  const tabCls = (active: boolean) =>
    `px-4 py-2 rounded-lg text-sm font-bold font-mono flex items-center gap-2 transition-all cursor-pointer ${
      active
        ? "bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff]"
        : "border border-transparent text-[#859397] hover:text-[#dfe2f3]"
    }`;

  return (
    <div className="w-full">
      <div className="max-w-4xl mx-auto mb-5 flex items-center gap-2">
        <button onClick={() => setTab("daily")} className={tabCls(tab === "daily")}>
          <Newspaper className="w-4 h-4" /> Daily AI Update
        </button>
        <button onClick={() => setTab("trends")} className={tabCls(tab === "trends")}>
          <FlaskConical className="w-4 h-4" /> Trend Lab
        </button>
      </div>
      {tab === "daily" ? <DailyUpdate /> : <TrendLab />}
    </div>
  );
}
