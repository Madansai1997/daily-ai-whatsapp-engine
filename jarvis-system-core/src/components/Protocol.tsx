import React, { useState, useEffect } from "react";
import {
  Shield,
  Zap,
  Flame,
  Brain,
  MessageSquare,
  Sparkles,
  Scissors,
  Dumbbell,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  Copy,
  ChevronRight,
  TrendingUp,
  Clock,
  Send,
  Eye,
  Check,
  Compass,
  Lock,
  Plus
} from "lucide-react";

interface Streak {
  habit_key: string;
  title: string;
  category: string;
  current_streak: number;
  best_streak: number;
  last_logged_date: string | null;
  history_json?: string;
}

interface GroomingTask {
  id: number;
  task_name: string;
  category: string;
  frequency_days: number;
  last_completed_date: string | null;
  notes: string;
}

interface ObsessionData {
  id: number;
  craft_title: string;
  description: string;
  start_date: string;
  target_date: string;
  total_deep_mins: number;
  milestones_json: string;
}

interface BoundaryScript {
  category: string;
  title: string;
  script: string;
  context: string;
}

export default function Protocol() {
  const [activeSubTab, setActiveSubTab] = useState<"cockpit" | "mind" | "boundaries" | "monk" | "obsession">("cockpit");
  const [loading, setLoading] = useState(true);

  // Cockpit Data
  const [selfTrustScore, setSelfTrustScore] = useState(65);
  const [streaks, setStreaks] = useState<Streak[]>([]);
  const [todayClarity, setTodayClarity] = useState<any | null>(null);
  const [groomingTasks, setGroomingTasks] = useState<GroomingTask[]>([]);
  const [obsession, setObsession] = useState<ObsessionData | null>(null);
  const [decisionsCount, setDecisionsCount] = useState(0);

  // Clarity / Brain-Dump State
  const [rawThoughts, setRawThoughts] = useState("");
  const [triggerCause, setTriggerCause] = useState("Overthinking / Work Stress");
  const [isClaritySubmitting, setIsClaritySubmitting] = useState(false);
  const [clarityResult, setClarityResult] = useState<any | null>(null);
  const [clarityHistory, setClarityHistory] = useState<any[]>([]);

  // Solo Decision State
  const [newDecision, setNewDecision] = useState("");
  const [decisionCategory, setDecisionCategory] = useState("Career");
  const [feltDiscomfort, setFeltDiscomfort] = useState(true);
  const [decisionList, setDecisionList] = useState<any[]>([]);

  // The Mirror Interaction Debrief State
  const [interactionTitle, setInteractionTitle] = useState("");
  const [interactionContext, setInteractionContext] = useState("");
  const [interactionDetails, setInteractionDetails] = useState("");
  const [isMirrorAnalyzing, setIsMirrorAnalyzing] = useState(false);
  const [mirrorResult, setMirrorResult] = useState<any | null>(null);

  // Anti-Apology Converter State
  const [apologyDraft, setApologyDraft] = useState("");
  const [isConvertingApology, setIsConvertingApology] = useState(false);
  const [convertedApologies, setConvertedApologies] = useState<any | null>(null);

  // Boundary Scripts
  const [scripts, setScripts] = useState<BoundaryScript[]>([]);
  const [copiedScriptIndex, setCopiedScriptIndex] = useState<number | null>(null);

  // 4-Day Strength State
  const [workouts, setWorkouts] = useState<any[]>([]);
  const [workoutSplit, setWorkoutSplit] = useState("Upper Heavy (Push/Pull)");
  const [workoutNotes, setWorkoutNotes] = useState("");
  const [energyRating, setEnergyRating] = useState(8);

  // SOS Emergency Reset State
  const [isSosOpen, setIsSosOpen] = useState(false);
  const [sosSeconds, setSosSeconds] = useState(60);
  const [sosActive, setSosActive] = useState(false);

  // Deep Work Timer State
  const [timerRunning, setTimerRunning] = useState(false);
  const [timerSeconds, setTimerSeconds] = useState(3600); // 60 mins

  useEffect(() => {
    loadProtocolData();
  }, []);

  // SOS Breathing Countdown
  useEffect(() => {
    let interval: any;
    if (sosActive && sosSeconds > 0) {
      interval = setInterval(() => setSosSeconds((prev) => prev - 1), 1000);
    } else if (sosSeconds === 0) {
      setSosActive(false);
    }
    return () => clearInterval(interval);
  }, [sosActive, sosSeconds]);

  // Deep Work Countdown
  useEffect(() => {
    let timer: any;
    if (timerRunning && timerSeconds > 0) {
      timer = setInterval(() => setTimerSeconds((prev) => prev - 1), 1000);
    } else if (timerSeconds === 0 && timerRunning) {
      setTimerRunning(false);
      handleLogDeepWork(60);
      alert("🏆 60-Minute Deep Work Session Completed!");
    }
    return () => clearInterval(timer);
  }, [timerRunning, timerSeconds]);

  const loadProtocolData = async () => {
    setLoading(true);
    try {
      const [cockpitRes, scriptsRes, decisionsRes, clarityHistRes, workoutsRes] = await Promise.all([
        fetch("/api/protocol/cockpit"),
        fetch("/api/protocol/scripts"),
        fetch("/api/protocol/decisions"),
        fetch("/api/protocol/clarity/history"),
        fetch("/api/protocol/workouts")
      ]);

      if (cockpitRes.ok) {
        const cData = await cockpitRes.json();
        setSelfTrustScore(cData.self_trust_score || 65);
        setStreaks(cData.streaks || []);
        setTodayClarity(cData.today_clarity);
        setGroomingTasks(cData.grooming_tasks || []);
        setObsession(cData.obsession);
        setDecisionsCount(cData.decisions_count || 0);
      }

      if (scriptsRes.ok) {
        const sData = await scriptsRes.json();
        setScripts(sData.scripts || []);
      }

      if (decisionsRes.ok) {
        const dData = await decisionsRes.json();
        setDecisionList(dData.decisions || []);
      }

      if (clarityHistRes.ok) {
        const hData = await clarityHistRes.json();
        setClarityHistory(hData.history || []);
      }

      if (workoutsRes.ok) {
        const wData = await workoutsRes.json();
        setWorkouts(wData.workouts || []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  const handleStreakCheckin = async (habit_key: string) => {
    try {
      const res = await fetch(`/api/protocol/streaks/${habit_key}/checkin`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        await loadProtocolData();
      }
    } catch {
      alert("Error logging check-in.");
    }
  };

  const handleStreakReset = async (habit_key: string) => {
    const reason = prompt("Enter brief reason for reset (for Stoic reflection):") || "Slip-up / Reset";
    try {
      const res = await fetch(`/api/protocol/streaks/${habit_key}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason })
      });
      const data = await res.json();
      if (data.ok) {
        await loadProtocolData();
      }
    } catch {
      alert("Error logging reset.");
    }
  };

  const handleSubmitClarity = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rawThoughts.trim()) return;
    setIsClaritySubmitting(true);
    try {
      const res = await fetch("/api/protocol/clarity", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ raw_thoughts: rawThoughts, trigger_cause: triggerCause })
      });
      const data = await res.json();
      if (data.ok) {
        setClarityResult(data);
        setRawThoughts("");
        await loadProtocolData();
      }
    } catch {
      alert("Error analyzing clarity dump.");
    } finally {
      setIsClaritySubmitting(false);
    }
  };

  const handleAddSoloDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDecision.trim()) return;
    try {
      const res = await fetch("/api/protocol/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision_text: newDecision,
          category: decisionCategory,
          felt_discomfort: feltDiscomfort,
          outcome_notes: "Executed independently with zero external consultation."
        })
      });
      const data = await res.json();
      if (data.ok) {
        setNewDecision("");
        await loadProtocolData();
      }
    } catch {
      alert("Error adding decision.");
    }
  };

  const handleAnalyzeMirror = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!interactionDetails.trim()) return;
    setIsMirrorAnalyzing(true);
    try {
      const res = await fetch("/api/protocol/mirror/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: interactionTitle || "Social Interaction",
          context: interactionContext,
          what_happened: interactionDetails
        })
      });
      const data = await res.json();
      if (data.ok) {
        setMirrorResult(data.analysis);
      }
    } catch {
      alert("Error analyzing interaction.");
    } finally {
      setIsMirrorAnalyzing(false);
    }
  };

  const handleConvertApology = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!apologyDraft.trim()) return;
    setIsConvertingApology(true);
    try {
      const res = await fetch("/api/protocol/anti-apology", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: apologyDraft })
      });
      const data = await res.json();
      if (data.ok) {
        setConvertedApologies(data.conversions);
      }
    } catch {
      alert("Error converting apology.");
    } finally {
      setIsConvertingApology(false);
    }
  };

  const handleCompleteGrooming = async (id: number) => {
    try {
      const res = await fetch(`/api/protocol/grooming/${id}/complete`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        await loadProtocolData();
      }
    } catch {
      alert("Error updating grooming task.");
    }
  };

  const handleLogWorkout = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch("/api/protocol/workouts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workout_split: workoutSplit,
          exercises: [],
          energy_rating: energyRating,
          notes: workoutNotes
        })
      });
      const data = await res.json();
      if (data.ok) {
        setWorkoutNotes("");
        await loadProtocolData();
        alert("🏋️ Strength workout logged successfully!");
      }
    } catch {
      alert("Error logging workout.");
    }
  };

  const handleLogDeepWork = async (mins: number) => {
    try {
      const res = await fetch("/api/protocol/obsession/log-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ minutes: mins })
      });
      const data = await res.json();
      if (data.ok) {
        await loadProtocolData();
      }
    } catch {
      /* ignore */
    }
  };

  return (
    <div className="w-full flex-1 flex flex-col space-y-6 animate-fade-in text-zinc-100">
      {/* TOP SOVEREIGN HUD BANNER */}
      <div className="p-6 bg-zinc-950/80 border border-amber-500/30 rounded-2xl backdrop-blur-md shadow-2xl relative overflow-hidden flex flex-wrap items-center justify-between gap-6">
        <div className="absolute -right-16 -top-16 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none"></div>

        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-amber-500/10 border border-amber-500/30 rounded-2xl text-amber-400 shadow-inner">
            <Shield className="w-8 h-8" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold font-mono tracking-tight text-zinc-100">PROTOCOL SOVEREIGN</h1>
              <span className="text-[10px] font-bold px-2 py-0.5 bg-amber-500/20 text-amber-400 border border-amber-500/40 rounded-full uppercase tracking-wider">
                Life OS & Self-Mastery
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1 max-w-xl">
              Internal Sovereignty, Social Gravitas, Dopamine Armor, and High-Income Craft Obsession.
            </p>
          </div>
        </div>

        {/* METRICS STRIP */}
        <div className="flex items-center gap-4 flex-wrap">
          {/* SELF-TRUST SCORE */}
          <div className="px-4 py-2.5 bg-zinc-900/90 border border-amber-500/30 rounded-xl flex items-center gap-3 shadow-md">
            <div>
              <span className="text-[10px] uppercase font-mono text-zinc-400 block">Self-Trust Score</span>
              <span className="text-xl font-extrabold font-mono text-amber-400">{selfTrustScore}/100</span>
            </div>
            <TrendingUp className="w-5 h-5 text-amber-400/80" />
          </div>

          {/* DOPAMINE PURITY STREAK */}
          <div className="px-4 py-2.5 bg-zinc-900/90 border border-cyan-500/30 rounded-xl flex items-center gap-3 shadow-md">
            <div>
              <span className="text-[10px] uppercase font-mono text-zinc-400 block">Dopamine Purity</span>
              <span className="text-xl font-extrabold font-mono text-cyan-400">
                {streaks.find((s) => s.habit_key === "no_porn")?.current_streak || 0}d
              </span>
            </div>
            <Flame className="w-5 h-5 text-cyan-400/80" />
          </div>

          {/* 🚨 SOS RESET BUTTON */}
          <button
            onClick={() => { setIsSosOpen(true); setSosSeconds(60); setSosActive(true); }}
            className="px-4 py-2.5 bg-rose-500/20 hover:bg-rose-500/30 border border-rose-500/40 text-rose-300 font-bold text-xs rounded-xl flex items-center gap-2 transition-all shadow-lg shadow-rose-500/10 cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4 text-rose-400" />
            SOS Reset (Urge / Anger)
          </button>
        </div>
      </div>

      {/* NAVIGATION SUB-TABS */}
      <div className="flex items-center gap-2 border-b border-zinc-800 pb-3 overflow-x-auto">
        {[
          { id: "cockpit", label: "🛡️ Command Cockpit", count: null },
          { id: "mind", label: "🧠 Mind Shield & Clarity", count: todayClarity ? "Logged" : "Pending" },
          { id: "boundaries", label: "🗣️ Boundaries & Gravitas", count: "Scripts + Mirror" },
          { id: "monk", label: "🔥 Monk Protocol & Armor", count: `${streaks.length} Streaks` },
          { id: "obsession", label: "🎯 90-Day Obsession", count: `${obsession?.total_deep_mins || 0}m` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveSubTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold font-mono tracking-wide transition-all flex items-center gap-2 cursor-pointer ${
              activeSubTab === tab.id
                ? "bg-amber-500 text-zinc-950 shadow-md shadow-amber-500/20 font-bold"
                : "bg-zinc-900/60 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
            }`}
          >
            {tab.label}
            {tab.count && (
              <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-bold ${
                activeSubTab === tab.id ? "bg-zinc-950/20 text-zinc-950" : "bg-zinc-800 text-amber-400"
              }`}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 1. COMMAND COCKPIT SUB-VIEW */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "cockpit" && (
        <div className="space-y-6">
          {/* QUICK STREAKS CHECK-IN GRID */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {streaks.map((s) => (
              <div key={s.habit_key} className="p-4 bg-zinc-900/70 border border-zinc-800/90 rounded-2xl space-y-3 shadow-md hover:border-amber-500/30 transition-all">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-mono text-zinc-400 uppercase tracking-wider">{s.category}</span>
                  <span className="text-xs font-mono text-amber-400 font-bold">Best: {s.best_streak}d</span>
                </div>
                <div>
                  <h4 className="text-xs font-bold text-zinc-100 line-clamp-1">{s.title}</h4>
                  <p className="text-2xl font-black font-mono text-amber-400 mt-1 flex items-center gap-1.5">
                    {s.current_streak} <span className="text-xs font-normal text-zinc-400 font-sans">days</span>
                  </p>
                </div>
                <div className="pt-2 border-t border-zinc-800/60 flex items-center gap-2">
                  <button
                    onClick={() => handleStreakCheckin(s.habit_key)}
                    className="flex-1 py-1.5 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 font-semibold text-[11px] rounded-lg transition-all flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" /> Check In
                  </button>
                  <button
                    onClick={() => handleStreakReset(s.habit_key)}
                    className="p-1.5 text-zinc-500 hover:text-rose-400 rounded-lg transition-colors"
                    title="Reset streak"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* TWO COLUMN SUMMARY: CLARITY DRAGON + GROOMING CHECKPOINTS */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* TODAY'S STOIC CLARITY & DRAGON */}
            <div className="p-6 bg-zinc-900/60 border border-amber-500/30 rounded-2xl space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                  <Brain className="w-4 h-4 text-amber-400" /> Today's Clarity & Action
                </h3>
                <button
                  onClick={() => setActiveSubTab("mind")}
                  className="text-xs text-amber-400 hover:underline flex items-center gap-1 font-mono"
                >
                  Brain Dump <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>

              {todayClarity ? (
                <div className="space-y-3">
                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-2">
                    <span className="text-[10px] uppercase font-mono text-zinc-400 block">Stoic Reframe</span>
                    <p className="text-xs text-zinc-200 leading-relaxed italic">"{todayClarity.stoic_reframe}"</p>
                  </div>
                  <div className="p-4 bg-amber-500/10 border border-amber-500/30 rounded-xl space-y-1">
                    <span className="text-[10px] uppercase font-mono text-amber-400 font-bold block">The 1 Action for Today</span>
                    <p className="text-xs text-zinc-100 font-bold">{todayClarity.tomorrow_action}</p>
                  </div>
                </div>
              ) : (
                <div className="py-8 text-center space-y-3 border border-dashed border-zinc-800 rounded-xl">
                  <p className="text-xs text-zinc-400">No brain dump logged yet for today.</p>
                  <button
                    onClick={() => setActiveSubTab("mind")}
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl shadow-md"
                  >
                    Start 3-Min Evening Brain Dump
                  </button>
                </div>
              )}
            </div>

            {/* VISUAL ARMOR & GROOMING CHECKPOINTS */}
            <div className="p-6 bg-zinc-900/60 border border-zinc-800 rounded-2xl space-y-4 shadow-xl">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                  <Scissors className="w-4 h-4 text-cyan-400" /> Visual Armor & Grooming
                </h3>
                <span className="text-xs font-mono text-zinc-400">High-Status Standards</span>
              </div>

              <div className="space-y-2.5">
                {groomingTasks.slice(0, 4).map((t) => (
                  <div key={t.id} className="p-3 bg-zinc-950 border border-zinc-800/80 rounded-xl flex items-center justify-between gap-3">
                    <div>
                      <h5 className="text-xs font-semibold text-zinc-200">{t.task_name}</h5>
                      <p className="text-[11px] text-zinc-500">{t.notes} · Every {t.frequency_days}d</p>
                    </div>
                    <button
                      onClick={() => handleCompleteGrooming(t.id)}
                      className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 rounded-lg transition-all"
                    >
                      Mark Done
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 2. MIND SHIELD & CLARITY SUB-VIEW */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "mind" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* NIGHTLY BRAIN DUMP FORM */}
          <div className="p-6 bg-zinc-900/70 border border-amber-500/30 rounded-2xl space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                <Brain className="w-4 h-4 text-amber-400" /> Nightly Stoic Brain Dump
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">Dismantle overthinking loops into cold, actionable stoic clarity.</p>
            </div>

            <form onSubmit={handleSubmitClarity} className="space-y-4">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">What is triggering overthinking or anxiety today?</label>
                <input
                  type="text"
                  value={triggerCause}
                  onChange={(e) => setTriggerCause(e.target.value)}
                  placeholder="e.g. Job search anxiety, money worries, conversation regret"
                  className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Dump your raw, unfiltered thoughts here:</label>
                <textarea
                  value={rawThoughts}
                  onChange={(e) => setRawThoughts(e.target.value)}
                  rows={5}
                  placeholder="Pour out every worry, self-doubt, or looping thought..."
                  className="w-full p-3.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <button
                type="submit"
                disabled={isClaritySubmitting}
                className="w-full py-2.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl transition-all shadow-lg shadow-amber-500/20 flex items-center justify-center gap-2"
              >
                <Sparkles className="w-4 h-4" />
                {isClaritySubmitting ? "Dismantling Mental Noise..." : "Dismantle & Extract Stoic Action"}
              </button>
            </form>

            {clarityResult && (
              <div className="p-4 bg-zinc-950 border border-amber-500/40 rounded-xl space-y-3 animate-fade-in">
                <div>
                  <span className="text-[10px] uppercase font-mono text-amber-400 block">Stoic Reframe</span>
                  <p className="text-xs text-zinc-200 mt-1 italic">"{clarityResult.stoic_reframe}"</p>
                </div>
                <div className="pt-2 border-t border-zinc-800">
                  <span className="text-[10px] uppercase font-mono text-emerald-400 font-bold block">Tomorrow's Non-Negotiable Action</span>
                  <p className="text-xs font-bold text-zinc-100 mt-0.5">➔ {clarityResult.tomorrow_action}</p>
                </div>
              </div>
            )}
          </div>

          {/* SOLO DECISION LEDGER (MICRO-SOVEREIGNTY) */}
          <div className="p-6 bg-zinc-900/70 border border-zinc-800 rounded-2xl space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                <Compass className="w-4 h-4 text-cyan-400" /> Solo Decision Ledger (Micro-Sovereignty)
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">Log 1 decision made today without asking anyone for validation.</p>
            </div>

            <form onSubmit={handleAddSoloDecision} className="space-y-3">
              <input
                type="text"
                value={newDecision}
                onChange={(e) => setNewDecision(e.target.value)}
                placeholder="What independent decision did you execute today?"
                className="w-full px-3.5 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-cyan-500"
              />
              <div className="flex items-center justify-between gap-3">
                <select
                  value={decisionCategory}
                  onChange={(e) => setDecisionCategory(e.target.value)}
                  className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 text-xs text-zinc-300 rounded-xl focus:outline-none"
                >
                  <option value="Career">Career</option>
                  <option value="Money">Money</option>
                  <option value="Personal">Personal Routine</option>
                  <option value="Social">Social Boundary</option>
                </select>

                <button
                  type="submit"
                  className="px-4 py-2 bg-cyan-500 hover:bg-cyan-400 text-zinc-950 font-bold text-xs rounded-xl shadow-md"
                >
                  Log Solo Decision
                </button>
              </div>
            </form>

            <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
              {decisionList.map((d) => (
                <div key={d.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between gap-3 text-xs">
                  <div>
                    <p className="text-zinc-200 font-medium">"{d.decision_text}"</p>
                    <span className="text-[10px] font-mono text-zinc-500">{d.category} · {d.date}</span>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 rounded text-[10px] font-mono">
                    Self-Led
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 3. BOUNDARIES & SOCIAL GRAVITAS SUB-VIEW */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "boundaries" && (
        <div className="space-y-6">
          {/* TOP SPLIT: ANTI-APOLOGY CONVERTER & THE MIRROR DEBRIEF */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* ANTI-APOLOGY CONVERTER */}
            <div className="p-6 bg-zinc-900/70 border border-purple-500/30 rounded-2xl space-y-4 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                  <MessageSquare className="w-4 h-4 text-purple-400" /> Anti-Apology & Gratitude Converter
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">Type any apologetic draft; JARVIS outputs 3 high-status assertive reframes.</p>
              </div>

              <form onSubmit={handleConvertApology} className="space-y-3">
                <textarea
                  value={apologyDraft}
                  onChange={(e) => setApologyDraft(e.target.value)}
                  rows={3}
                  placeholder="e.g. 'Sorry for taking your time, just wanted to check if you saw my message...'"
                  className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-purple-500"
                />
                <button
                  type="submit"
                  disabled={isConvertingApology}
                  className="w-full py-2 bg-purple-500 hover:bg-purple-400 text-zinc-950 font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  {isConvertingApology ? "Re-calibrating Status..." : "Elevate to High-Status Response"}
                </button>
              </form>

              {convertedApologies && (
                <div className="space-y-3 pt-2 text-xs">
                  <div className="p-3 bg-zinc-950 border border-emerald-500/30 rounded-xl space-y-1">
                    <span className="text-[10px] uppercase font-mono text-emerald-400 font-bold">1. Gratitude Reframe</span>
                    <p className="text-zinc-200">"{convertedApologies.gratitude_reframe}"</p>
                  </div>
                  <div className="p-3 bg-zinc-950 border border-cyan-500/30 rounded-xl space-y-1">
                    <span className="text-[10px] uppercase font-mono text-cyan-400 font-bold">2. Direct & Assertive</span>
                    <p className="text-zinc-200">"{convertedApologies.direct_assertive}"</p>
                  </div>
                  <div className="p-3 bg-zinc-950 border border-purple-500/30 rounded-xl space-y-1">
                    <span className="text-[10px] uppercase font-mono text-purple-400 font-bold">3. Executive Diplomatic</span>
                    <p className="text-zinc-200">"{convertedApologies.executive_diplomatic}"</p>
                  </div>
                </div>
              )}
            </div>

            {/* "THE MIRROR" POST-INTERACTION DEBRIEF */}
            <div className="p-6 bg-zinc-900/70 border border-zinc-800 rounded-2xl space-y-4 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                  <Eye className="w-4 h-4 text-amber-400" /> "The Mirror" Interaction Power Debrief
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">Analyze a conversation to identify boundary leaks and power surrenders.</p>
              </div>

              <form onSubmit={handleAnalyzeMirror} className="space-y-3">
                <input
                  type="text"
                  value={interactionTitle}
                  onChange={(e) => setInteractionTitle(e.target.value)}
                  placeholder="Title (e.g. Call with manager / chat with friend)"
                  className="w-full px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
                <textarea
                  value={interactionDetails}
                  onChange={(e) => setInteractionDetails(e.target.value)}
                  rows={3}
                  placeholder="Describe what happened: What did they say, and how did you respond?"
                  className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
                <button
                  type="submit"
                  disabled={isMirrorAnalyzing}
                  className="w-full py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isMirrorAnalyzing ? "Analyzing Power Dynamics..." : "Debrief Interaction with JARVIS"}
                </button>
              </form>

              {mirrorResult && (
                <div className="p-4 bg-zinc-950 border border-amber-500/40 rounded-xl space-y-3 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase font-mono text-zinc-400">Boundary Mastery Score</span>
                    <span className="text-sm font-bold font-mono text-amber-400">{mirrorResult.boundary_score}/100</span>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-mono text-rose-400 font-bold block">Power Leaks Detected:</span>
                    <ul className="list-disc list-inside text-zinc-300 space-y-0.5 mt-1">
                      {mirrorResult.power_leaks?.map((l: string, i: number) => (
                        <li key={i}>{l}</li>
                      ))}
                    </ul>
                  </div>
                  <div className="pt-2 border-t border-zinc-800">
                    <span className="text-[10px] uppercase font-mono text-emerald-400 font-bold block">Future High-Status Script:</span>
                    <p className="text-zinc-100 font-mono mt-0.5 bg-zinc-900 p-2.5 rounded-lg border border-zinc-800">"{mirrorResult.future_script}"</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* BOUNDARY SCRIPT VAULT */}
          <div className="p-6 bg-zinc-900/60 border border-zinc-800 rounded-2xl space-y-4 shadow-xl">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-400" /> Curated High-Status Script Vault
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">Battle-tested unapologetic scripts for saying No, holding boundaries, and demanding respect.</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {scripts.map((s, idx) => (
                <div key={idx} className="p-4 bg-zinc-950 border border-zinc-800/90 rounded-xl space-y-2.5 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-amber-400 uppercase">{s.category}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(s.script);
                          setCopiedScriptIndex(idx);
                          setTimeout(() => setCopiedScriptIndex(null), 2000);
                        }}
                        className="text-[10px] px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 rounded flex items-center gap-1"
                      >
                        {copiedScriptIndex === idx ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                        {copiedScriptIndex === idx ? "Copied" : "Copy"}
                      </button>
                    </div>
                    <h5 className="text-xs font-bold text-zinc-200 mt-1">{s.title}</h5>
                    <p className="text-xs text-zinc-300 font-mono mt-2 bg-zinc-900/80 p-2 rounded-lg border border-zinc-800/80 leading-relaxed">
                      "{s.script}"
                    </p>
                  </div>
                  <p className="text-[10px] text-zinc-500 italic">{s.context}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 4. MONK PROTOCOL & PHYSICAL ARMOR SUB-VIEW */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "monk" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* 4-DAY PROGRESSIVE COMPOUND STRENGTH SPLIT */}
            <div className="p-6 bg-zinc-900/70 border border-amber-500/30 rounded-2xl space-y-4 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                  <Dumbbell className="w-4 h-4 text-amber-400" /> 4-Day Progressive Strength Protocol
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">Physical pain builds mental callous. Heavy compounds only.</p>
              </div>

              <form onSubmit={handleLogWorkout} className="space-y-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Workout Split</label>
                  <select
                    value={workoutSplit}
                    onChange={(e) => setWorkoutSplit(e.target.value)}
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  >
                    <option value="Upper Heavy (Bench / OHP / Barbell Rows / Pullups)">Upper Heavy (Bench / OHP / Rows / Pullups)</option>
                    <option value="Lower Heavy (Squats / Romanian Deadlifts / Lunges)">Lower Heavy (Squats / RDLs / Lunges)</option>
                    <option value="Upper Hypertrophy (Incline DB / Dips / Lateral Raises / Curls)">Upper Hypertrophy (Incline DB / Dips / Shoulders)</option>
                    <option value="Lower Power & Core (Deadlifts / Front Squats / Planks)">Lower Power & Core (Deadlifts / Front Squats)</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Session Notes (Weights, Sets, Reps)</label>
                  <textarea
                    value={workoutNotes}
                    onChange={(e) => setWorkoutNotes(e.target.value)}
                    rows={3}
                    placeholder="e.g. Bench: 80kg x 5, Squat: 100kg x 5. High intensity, clean form."
                    className="w-full p-3 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                </div>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-400">Energy (1-10):</span>
                    <input
                      type="number"
                      min={1}
                      max={10}
                      value={energyRating}
                      onChange={(e) => setEnergyRating(Number(e.target.value))}
                      className="w-16 px-2 py-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-100 text-center"
                    />
                  </div>

                  <button
                    type="submit"
                    className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl shadow-md"
                  >
                    Log Workout Session
                  </button>
                </div>
              </form>

              {/* RECENT WORKOUTS LIST */}
              <div className="space-y-2 pt-2 max-h-48 overflow-y-auto pr-1">
                {workouts.map((w) => (
                  <div key={w.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <h5 className="font-bold text-zinc-200">{w.workout_split}</h5>
                      <p className="text-[11px] text-zinc-400 mt-0.5">{w.notes || "No notes"}</p>
                    </div>
                    <span className="text-[10px] font-mono text-amber-400 font-bold">⚡ {w.energy_rating}/10</span>
                  </div>
                ))}
              </div>
            </div>

            {/* GROOMING & CAPSULE WARDROBE MATRIX */}
            <div className="p-6 bg-zinc-900/70 border border-zinc-800 rounded-2xl space-y-4 shadow-xl">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                  <Scissors className="w-4 h-4 text-cyan-400" /> Visual Armor Checklist
                </h3>
                <p className="text-xs text-zinc-400 mt-0.5">High-status visual presence removes social insecurity before you speak.</p>
              </div>

              <div className="space-y-2.5">
                {groomingTasks.map((t) => (
                  <div key={t.id} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between gap-3 text-xs">
                    <div>
                      <h5 className="font-bold text-zinc-200">{t.task_name}</h5>
                      <p className="text-[11px] text-zinc-400 mt-0.5">{t.notes}</p>
                      <span className="text-[10px] font-mono text-zinc-500">Every {t.frequency_days} days</span>
                    </div>
                    <button
                      onClick={() => handleCompleteGrooming(t.id)}
                      className="px-3 py-1 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-amber-400 rounded-lg font-mono font-bold"
                    >
                      Complete
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 5. 90-DAY CRAFT OBSESSION SUB-VIEW */}
      {/* ───────────────────────────────────────────────────────────── */}
      {activeSubTab === "obsession" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* OBSESSION HUB & DEEP WORK TIMER */}
          <div className="p-6 bg-zinc-900/70 border border-amber-500/30 rounded-2xl space-y-5 shadow-xl">
            <div>
              <span className="text-[10px] uppercase font-mono text-amber-400 tracking-wider">The 90-Day North Star</span>
              <h3 className="text-base font-bold text-zinc-100 mt-1">
                {obsession?.craft_title || "Full-Stack AI Systems & Algorithmic Automation"}
              </h3>
              <p className="text-xs text-zinc-400 mt-1">{obsession?.description}</p>
            </div>

            {/* DEEP WORK STOPWATCH */}
            <div className="p-6 bg-zinc-950 border border-amber-500/30 rounded-2xl text-center space-y-3">
              <span className="text-xs uppercase font-mono text-zinc-400 block">60-Min Daily Deep Work Session</span>
              <div className="text-4xl font-black font-mono text-amber-400 tracking-wider">
                {Math.floor(timerSeconds / 60)}:{String(timerSeconds % 60).padStart(2, "0")}
              </div>
              <div className="flex items-center justify-center gap-3 pt-2">
                <button
                  onClick={() => setTimerRunning(!timerRunning)}
                  className={`px-6 py-2.5 font-bold text-xs rounded-xl transition-all cursor-pointer ${
                    timerRunning
                      ? "bg-rose-500 hover:bg-rose-400 text-zinc-950 shadow-lg shadow-rose-500/20"
                      : "bg-amber-500 hover:bg-amber-400 text-zinc-950 shadow-lg shadow-amber-500/20"
                  }`}
                >
                  {timerRunning ? "Pause Session" : "Start Deep Work Session"}
                </button>
                <button
                  onClick={() => { setTimerRunning(false); setTimerSeconds(3600); }}
                  className="px-4 py-2 bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-zinc-200 text-xs rounded-xl"
                >
                  Reset
                </button>
              </div>
            </div>

            <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl flex items-center justify-between">
              <div>
                <span className="text-xs text-zinc-400 block">Total Craft Obsession Logged:</span>
                <span className="text-xl font-bold font-mono text-amber-400">
                  {obsession?.total_deep_mins || 0} mins ({((obsession?.total_deep_mins || 0) / 60).toFixed(1)} hrs)
                </span>
              </div>
              <button
                onClick={() => handleLogDeepWork(60)}
                className="px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 rounded-lg"
              >
                + Quick Log 60m
              </button>
            </div>
          </div>

          {/* 90-DAY MILESTONE ROADMAP */}
          <div className="p-6 bg-zinc-900/70 border border-zinc-800 rounded-2xl space-y-4 shadow-xl">
            <div>
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2 font-mono">
                <TrendingUp className="w-4 h-4 text-cyan-400" /> 90-Day Milestone Roadmap
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">Execution milestones to establish sovereign mastery.</p>
            </div>

            <div className="space-y-3">
              {[
                { id: 1, title: "Phase 1: Foundation & High-Leverage Architecture Mastery", desc: "Build & internalize full-stack intelligence systems with zero friction.", days: "Day 1 - 30" },
                { id: 2, title: "Phase 2: Ship 3 Production Systems (Live Demos)", desc: "Create high-caliber production deployments with proven market utility.", days: "Day 31 - 60" },
                { id: 3, title: "Phase 3: High-Income Monetization & Sovereign Cashflow", desc: "Generate recurring enterprise revenue or high-tier placement.", days: "Day 61 - 90" }
              ].map((m) => (
                <div key={m.id} className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5">
                  <div className="flex items-center justify-between">
                    <h5 className="text-xs font-bold text-zinc-100">{m.title}</h5>
                    <span className="text-[10px] font-mono text-cyan-400 bg-cyan-500/10 px-2 py-0.5 rounded border border-cyan-500/30">
                      {m.days}
                    </span>
                  </div>
                  <p className="text-[11px] text-zinc-400">{m.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ───────────────────────────────────────────────────────────── */}
      {/* 🚨 SOS RESET MODAL (URGE / ANGER INTERCEPTOR) */}
      {/* ───────────────────────────────────────────────────────────── */}
      {isSosOpen && (
        <div className="fixed inset-0 bg-black/90 backdrop-blur-md z-50 flex items-center justify-center p-4">
          <div className="max-w-md w-full bg-zinc-950 border border-rose-500/40 rounded-3xl p-8 space-y-6 text-center shadow-2xl animate-fade-in relative">
            <div className="w-16 h-16 bg-rose-500/10 border border-rose-500/40 rounded-2xl flex items-center justify-center mx-auto text-rose-400 animate-pulse">
              <AlertTriangle className="w-8 h-8" />
            </div>

            <div>
              <h2 className="text-xl font-bold font-mono text-zinc-100">SOVEREIGNTY RESET</h2>
              <p className="text-xs text-rose-400 font-semibold mt-1 uppercase tracking-wider">
                Do Not Surrender Your Power
              </p>
            </div>

            {/* 60-SEC STOIC COUNTDOWN CIRCLE */}
            <div className="py-4">
              <div className="w-28 h-28 rounded-full border-4 border-rose-500/30 border-t-rose-500 flex items-center justify-center mx-auto animate-spin-slow">
                <span className="text-3xl font-black font-mono text-zinc-100">{sosSeconds}s</span>
              </div>
              <p className="text-xs text-zinc-400 mt-4 font-mono">
                Breathe in for 4s · Hold for 4s · Exhale for 4s
              </p>
            </div>

            <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-2xl text-xs text-zinc-300 italic leading-relaxed">
              "You have power over your mind - not outside events. Realize this, and you will find strength. The urge or anger will pass in 3 minutes. Hold the line."
            </div>

            <button
              onClick={() => setIsSosOpen(false)}
              className="w-full py-3 bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-200 font-bold text-xs rounded-xl transition-all cursor-pointer"
            >
              I Am Back in Control
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
