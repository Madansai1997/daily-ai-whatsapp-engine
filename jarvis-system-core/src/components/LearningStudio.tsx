import React, { useEffect, useState } from "react";
import {
  Sparkles, Brain, Flame, Target, CheckCircle2, AlertTriangle,
  RefreshCw, Search, Send, BookOpen, Layers, Zap, ArrowRight,
  Database, Code2, Award, ShieldAlert, Cpu, Check, HelpCircle
} from "lucide-react";
import { getToken } from "../lib/auth";

interface DrillData {
  id: number;
  topic: string;
  title: string;
  scenario: string;
  broken_snippet?: string;
  hint?: string;
  rag_context?: string;
}

interface EvaluationResult {
  score: number;
  verdict: string;
  strengths: string[];
  gaps: string[];
  corrected_code?: string;
  explanation: string;
}

interface ExplorationData {
  topic: string;
  intuitive_summary: string;
  mechanics_under_the_hood: string;
  production_realities: string[];
  signal_filter: {
    must_learn: string[];
    must_skip: string[];
  };
  suggested_exercises: string[];
  rag_sources?: string[];
}

interface MasteryTopic {
  topic: string;
  category: string;
  mastery_score: number;
  interval_days: number;
  next_review_date: string;
  last_reviewed_at?: string;
}

interface RadarData {
  topics: MasteryTopic[];
  shaky_count: number;
  mastered_count: number;
  overall_mastery: number;
}

export default function LearningStudio() {
  const [activeTab, setActiveTab] = useState<"drill" | "explore" | "radar">("drill");

  // Drill State
  const [drill, setDrill] = useState<DrillData | null>(null);
  const [userSolution, setUserSolution] = useState<string>("");
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<EvaluationResult | null>(null);
  const [showHint, setShowHint] = useState<boolean>(false);

  // Explore / Synthesis State
  const [searchTopic, setSearchTopic] = useState<string>("");
  const [enableRag, setEnableRag] = useState<boolean>(true);
  const [isSynthesizing, setIsSynthesizing] = useState<boolean>(false);
  const [synthesis, setSynthesis] = useState<ExplorationData | null>(null);

  // Mastery Radar State
  const [radar, setRadar] = useState<RadarData | null>(null);
  const [isLoadingDrill, setIsLoadingDrill] = useState<boolean>(true);

  // Load Daily Drill & Radar on Mount
  useEffect(() => {
    fetchDailyDrill();
    fetchMasteryRadar();
  }, []);

  const fetchDailyDrill = async (topicOverride?: string) => {
    setIsLoadingDrill(true);
    setEvaluation(null);
    setUserSolution("");
    try {
      const token = getToken();
      const url = topicOverride
        ? `/api/learning/daily-drill?topic=${encodeURIComponent(topicOverride)}`
        : `/api/learning/daily-drill`;
      const res = await fetch(url, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setDrill(data);
        if (data.broken_snippet) {
          setUserSolution(data.broken_snippet);
        }
      }
    } catch {
      /* ignore */
    } finally {
      setIsLoadingDrill(false);
    }
  };

  const fetchMasteryRadar = async () => {
    try {
      const token = getToken();
      const res = await fetch("/api/learning/mastery-radar", {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (res.ok) {
        const data = await res.json();
        setRadar(data);
      }
    } catch {
      /* ignore */
    }
  };

  const handleSubmitSolution = async () => {
    if (!drill || !userSolution.trim()) return;
    setIsSubmitting(true);
    try {
      const token = getToken();
      const res = await fetch("/api/learning/submit-answer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          drill_id: drill.id,
          user_response: userSolution,
        }),
      });
      if (res.ok) {
        const evalData = await res.json();
        setEvaluation(evalData);
        fetchMasteryRadar(); // Refresh SM-2 scores
      }
    } catch {
      /* ignore */
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSynthesizeTopic = async (topicToSearch?: string) => {
    const target = (topicToSearch || searchTopic).trim();
    if (!target) return;
    setIsSynthesizing(true);
    setSynthesis(null);
    try {
      const token = getToken();
      const res = await fetch("/api/learning/explore", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          topic: target,
          enable_rag: enableRag,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        setSynthesis(data);
        setActiveTab("explore");
      }
    } catch {
      /* ignore */
    } finally {
      setIsSynthesizing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#090d16] text-[#dfe2f3] p-4 md:p-8 font-sans">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-cyan-500/20 pb-6">
          <div>
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400">
                <Brain className="w-6 h-6 animate-pulse" />
              </div>
              <div>
                <h1 className="text-2xl md:text-3xl font-bold font-mono tracking-wide text-white flex items-center gap-2">
                  AI LEARNING ENGINE
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/20 text-cyan-300 font-mono border border-cyan-500/30">
                    4-PATTERN SYNTHESIS
                  </span>
                </h1>
                <p className="text-xs text-[#859397] font-mono mt-0.5">
                  Multi-LLM Perspective • Socratic Flight Drills • Signal Filter • Vault RAG
                </p>
              </div>
            </div>
          </div>

          {/* Mastery Score Header Badge */}
          {radar && (
            <div className="flex items-center gap-4 bg-zinc-900/80 border border-zinc-800 rounded-xl p-3 px-4 shadow-lg">
              <div className="text-right">
                <div className="text-[10px] font-mono uppercase tracking-widest text-zinc-400">Cognitive Mastery</div>
                <div className="text-lg font-bold font-mono text-cyan-400">{radar.overall_mastery}%</div>
              </div>
              <div className="w-10 h-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-300 font-bold font-mono">
                <Award className="w-5 h-5" />
              </div>
            </div>
          )}
        </div>

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 mt-6 overflow-x-auto pb-2">
          <button
            onClick={() => setActiveTab("drill")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono font-semibold tracking-wide border transition-all cursor-pointer ${activeTab === "drill"
                ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-md shadow-cyan-500/10"
                : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
          >
            <Zap className="w-4 h-4" /> 10-MIN FLIGHT DRILL
          </button>

          <button
            onClick={() => setActiveTab("explore")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono font-semibold tracking-wide border transition-all cursor-pointer ${activeTab === "explore"
                ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-md shadow-cyan-500/10"
                : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
          >
            <Layers className="w-4 h-4" /> MULTI-LLM SYNTHESIS & RAG
          </button>

          <button
            onClick={() => setActiveTab("radar")}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-mono font-semibold tracking-wide border transition-all cursor-pointer ${activeTab === "radar"
                ? "bg-cyan-500/15 border-cyan-500/40 text-cyan-300 shadow-md shadow-cyan-500/10"
                : "bg-zinc-900/60 border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
              }`}
          >
            <Target className="w-4 h-4" /> MASTERY RADAR & SCHEDULE
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="max-w-6xl mx-auto">
        {/* TAB 1: 10-MIN FLIGHT DRILL */}
        {activeTab === "drill" && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            <div className="lg:col-span-7 flex flex-col gap-6">
              {isLoadingDrill ? (
                <div className="glass-panel p-12 rounded-2xl border border-zinc-800 text-center">
                  <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
                  <p className="font-mono text-sm text-zinc-400">Assembling today's Socratic drill...</p>
                </div>
              ) : drill ? (
                <div className="bg-zinc-950/80 rounded-2xl border border-cyan-500/30 p-6 shadow-xl relative overflow-hidden">
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[11px] font-mono uppercase tracking-widest text-cyan-400 px-3 py-1 rounded-full bg-cyan-500/10 border border-cyan-500/20">
                      {drill.topic}
                    </span>
                    <button
                      onClick={() => fetchDailyDrill()}
                      title="Next Drill"
                      className="text-xs font-mono text-zinc-400 hover:text-cyan-300 flex items-center gap-1.5 cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" /> Refresh Scenario
                    </button>
                  </div>

                  <h2 className="text-xl font-bold font-mono text-white mb-3">{drill.title}</h2>
                  <p className="text-sm text-zinc-300 leading-relaxed mb-4">{drill.scenario}</p>

                  {/* Vault RAG Context Badge */}
                  {drill.rag_context && (
                    <div className="mb-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-mono text-amber-300 flex items-start gap-2">
                      <Database className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
                      <div>
                        <span className="font-bold text-amber-200">Vault RAG Grounding:</span>
                        <p className="text-[11px] text-amber-300/80 mt-0.5 line-clamp-2">{drill.rag_context}</p>
                      </div>
                    </div>
                  )}

                  {/* Interactive Code Snippet / Problem Input */}
                  {drill.broken_snippet && (
                    <div className="mb-4">
                      <div className="text-[11px] font-mono text-zinc-400 mb-1.5 flex items-center gap-1.5">
                        <Code2 className="w-3.5 h-3.5 text-cyan-400" /> Code / Scenario Workspace:
                      </div>
                      <textarea
                        value={userSolution}
                        onChange={(e) => setUserSolution(e.target.value)}
                        rows={6}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-500/60 leading-relaxed"
                        placeholder="Write your analysis, corrected query, or proposed system design..."
                      />
                    </div>
                  )}

                  {!drill.broken_snippet && (
                    <div className="mb-4">
                      <textarea
                        value={userSolution}
                        onChange={(e) => setUserSolution(e.target.value)}
                        rows={5}
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-xs font-mono text-cyan-200 focus:outline-none focus:border-cyan-500/60 leading-relaxed"
                        placeholder="Type your explanation or system fix here..."
                      />
                    </div>
                  )}

                  {/* Actions Bar */}
                  <div className="flex items-center justify-between pt-2">
                    {drill.hint && (
                      <button
                        onClick={() => setShowHint(!showHint)}
                        className="text-xs font-mono text-amber-400/90 hover:text-amber-300 flex items-center gap-1 cursor-pointer"
                      >
                        <HelpCircle className="w-3.5 h-3.5" /> {showHint ? "Hide Hint" : "Need a Hint?"}
                      </button>
                    )}

                    <button
                      onClick={handleSubmitSolution}
                      disabled={isSubmitting || !userSolution.trim()}
                      className="ml-auto flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold font-mono bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50 cursor-pointer shadow-lg transition-all"
                    >
                      {isSubmitting ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" /> DIAGNOSING...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" /> SUBMIT FOR AI DIAGNOSIS
                        </>
                      )}
                    </button>
                  </div>

                  {showHint && drill.hint && (
                    <div className="mt-4 p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-amber-200">
                      💡 <strong>Hint:</strong> {drill.hint}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Diagnostic Evaluation Panel */}
            <div className="lg:col-span-5">
              {evaluation ? (
                <div className="bg-zinc-950/80 rounded-2xl border border-cyan-500/40 p-6 shadow-xl flex flex-col gap-4">
                  <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                    <div className="flex items-center gap-2">
                      <Award className="w-5 h-5 text-cyan-400" />
                      <span className="font-mono font-bold text-sm text-white">Diagnostic Feedback</span>
                    </div>
                    <span className={`text-xs font-mono font-bold px-2.5 py-1 rounded-full border ${evaluation.score >= 80 ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                      }`}>
                      {evaluation.verdict} ({evaluation.score}/100)
                    </span>
                  </div>

                  <p className="text-xs text-zinc-300 leading-relaxed italic">{evaluation.explanation}</p>

                  {/* Strengths */}
                  {evaluation.strengths?.length > 0 && (
                    <div>
                      <div className="text-[11px] font-mono text-emerald-400 font-bold mb-1 flex items-center gap-1">
                        <CheckCircle2 className="w-3.5 h-3.5" /> What You Nailed:
                      </div>
                      <ul className="list-disc list-inside text-xs text-zinc-300 space-y-1">
                        {evaluation.strengths.map((s, idx) => (
                          <li key={idx}>{s}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Gaps */}
                  {evaluation.gaps?.length > 0 && (
                    <div>
                      <div className="text-[11px] font-mono text-amber-400 font-bold mb-1 flex items-center gap-1">
                        <AlertTriangle className="w-3.5 h-3.5" /> Edge Cases & Blindspots:
                      </div>
                      <ul className="list-disc list-inside text-xs text-zinc-300 space-y-1">
                        {evaluation.gaps.map((g, idx) => (
                          <li key={idx}>{g}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* Corrected Code */}
                  {evaluation.corrected_code && (
                    <div>
                      <div className="text-[11px] font-mono text-cyan-400 font-bold mb-1">Optimized Solution Reference:</div>
                      <pre className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 text-[11px] font-mono text-cyan-300 overflow-x-auto">
                        {evaluation.corrected_code}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <div className="glass-panel p-8 rounded-2xl border border-zinc-800 text-center flex flex-col items-center justify-center min-h-[300px]">
                  <Cpu className="w-10 h-10 text-zinc-600 mb-3" />
                  <p className="text-sm font-mono text-zinc-400">Complete the flight drill on the left to receive immediate diagnostic evaluation.</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: MULTI-LLM SYNTHESIS & RAG EXPLORER */}
        {activeTab === "explore" && (
          <div className="flex flex-col gap-6">
            {/* Search Input Bar */}
            <div className="bg-zinc-950/80 rounded-2xl border border-zinc-800 p-4 shadow-xl flex flex-col md:flex-row items-center gap-3">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 text-zinc-400 absolute left-3.5 top-3.5" />
                <input
                  type="text"
                  value={searchTopic}
                  onChange={(e) => setSearchTopic(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSynthesizeTopic()}
                  placeholder="Enter any topic (e.g., 'PostgreSQL Window Functions', 'RAG Context Optimization', 'Kafka Streams')..."
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-xl pl-10 pr-4 py-2.5 text-xs font-mono text-white focus:outline-none focus:border-cyan-500/60"
                />
              </div>

              <div className="flex items-center gap-3 w-full md:w-auto">
                <label className="flex items-center gap-2 text-xs font-mono text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enableRag}
                    onChange={(e) => setEnableRag(e.target.checked)}
                    className="accent-cyan-500 rounded"
                  />
                  Inject Vault RAG Context
                </label>

                <button
                  onClick={() => handleSynthesizeTopic()}
                  disabled={isSynthesizing || !searchTopic.trim()}
                  className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-bold font-mono bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-500/30 disabled:opacity-50 cursor-pointer shadow-md"
                >
                  {isSynthesizing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                  SYNTHESIZE
                </button>
              </div>
            </div>

            {/* Quick Topic Chips */}
            <div className="flex items-center gap-2 overflow-x-auto pb-2">
              <span className="text-[11px] font-mono text-zinc-500 shrink-0">Popular:</span>
              {["SQL Window Functions", "RAG Architecture", "Python Asyncio", "Agentic Tool Calling", "Data Lakehouse Design"].map((t) => (
                <button
                  key={t}
                  onClick={() => {
                    setSearchTopic(t);
                    handleSynthesizeTopic(t);
                  }}
                  className="px-3 py-1 rounded-full text-[11px] font-mono bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 hover:text-cyan-300 cursor-pointer whitespace-nowrap"
                >
                  {t}
                </button>
              ))}
            </div>

            {/* Synthesis Results */}
            {isSynthesizing ? (
              <div className="glass-panel p-12 rounded-2xl border border-zinc-800 text-center">
                <RefreshCw className="w-8 h-8 text-cyan-400 animate-spin mx-auto mb-3" />
                <p className="font-mono text-sm text-zinc-400">Synthesizing insights across Claude, Gemini & Grok...</p>
              </div>
            ) : synthesis ? (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
                {/* 3-Tier Synthesis Details */}
                <div className="lg:col-span-7 flex flex-col gap-6">
                  {/* Tier 1: Intuition */}
                  <div className="bg-zinc-950/80 rounded-2xl border border-cyan-500/30 p-5 shadow-xl">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-cyan-400 mb-2">
                      <Brain className="w-4 h-4" /> TIER 1: THE INTUITIVE MENTAL MODEL (Claude Style)
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed">{synthesis.intuitive_summary}</p>
                  </div>

                  {/* Tier 2: Mechanics */}
                  <div className="bg-zinc-950/80 rounded-2xl border border-purple-500/30 p-5 shadow-xl">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-purple-400 mb-2">
                      <Cpu className="w-4 h-4" /> TIER 2: UNDER-THE-HOOD MECHANICS (Gemini System Style)
                    </div>
                    <p className="text-xs text-zinc-300 leading-relaxed whitespace-pre-line">{synthesis.mechanics_under_the_hood}</p>
                  </div>

                  {/* Tier 3: Production Edge Cases */}
                  <div className="bg-zinc-950/80 rounded-2xl border border-amber-500/30 p-5 shadow-xl">
                    <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400 mb-2">
                      <ShieldAlert className="w-4 h-4" /> TIER 3: PRODUCTION REALITIES & PITFALLS (Grok Style)
                    </div>
                    <ul className="list-disc list-inside text-xs text-zinc-300 space-y-1.5">
                      {synthesis.production_realities?.map((p, idx) => (
                        <li key={idx}>{p}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Signal Filter: What to Learn vs Skip */}
                <div className="lg:col-span-5 flex flex-col gap-6">
                  <div className="bg-zinc-950/80 rounded-2xl border border-zinc-800 p-5 shadow-xl">
                    <div className="text-xs font-mono font-bold text-white mb-4 flex items-center gap-2 border-b border-zinc-800 pb-2">
                      <Target className="w-4 h-4 text-cyan-400" /> SIGNAL FILTER ("WHAT TO LEARN VS SKIP")
                    </div>

                    {/* Must Learn */}
                    <div className="mb-4">
                      <div className="text-[11px] font-mono text-emerald-400 font-bold mb-2 flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5" /> MUST MASTER (High-ROI Core):
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {synthesis.signal_filter?.must_learn?.map((item, idx) => (
                          <div key={idx} className="p-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-xs font-mono text-emerald-200">
                            ✓ {item}
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Must Skip */}
                    <div>
                      <div className="text-[11px] font-mono text-rose-400 font-bold mb-2 flex items-center gap-1.5">
                        <ShieldAlert className="w-3.5 h-3.5" /> MUST SKIP (Low-ROI Fluff):
                      </div>
                      <div className="flex flex-col gap-1.5">
                        {synthesis.signal_filter?.must_skip?.map((item, idx) => (
                          <div key={idx} className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs font-mono text-rose-300">
                            ✗ {item}
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* RAG Vault Grounding Badge */}
                  {synthesis.rag_sources && synthesis.rag_sources.length > 0 && (
                    <div className="p-4 rounded-2xl bg-amber-500/10 border border-amber-500/30 text-xs font-mono text-amber-200">
                      <div className="font-bold flex items-center gap-1.5 mb-1 text-amber-300">
                        <Database className="w-4 h-4" /> Vault RAG Grounding Active
                      </div>
                      <p className="text-[11px] text-amber-300/80 mb-2">Incorporated internal notes & documents:</p>
                      <div className="flex flex-wrap gap-1.5">
                        {synthesis.rag_sources.map((s, idx) => (
                          <span key={idx} className="px-2 py-0.5 rounded bg-amber-500/20 text-[10px] text-amber-200 border border-amber-500/30">
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* TAB 3: MASTERY RADAR & SCHEDULE */}
        {activeTab === "radar" && (
          <div className="flex flex-col gap-6">
            {/* Overview Metric Cards */}
            {radar && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">Mastered Core</div>
                    <div className="text-2xl font-bold font-mono text-emerald-400 mt-1">{radar.mastered_count} Concepts</div>
                  </div>
                  <CheckCircle2 className="w-8 h-8 text-emerald-500/40" />
                </div>

                <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">Shaky / Active Review</div>
                    <div className="text-2xl font-bold font-mono text-amber-400 mt-1">{radar.shaky_count} Topics</div>
                  </div>
                  <AlertTriangle className="w-8 h-8 text-amber-500/40" />
                </div>

                <div className="bg-zinc-950/80 border border-zinc-800 rounded-2xl p-5 shadow-lg flex items-center justify-between">
                  <div>
                    <div className="text-[11px] font-mono text-zinc-400 uppercase tracking-widest">Overall Score</div>
                    <div className="text-2xl font-bold font-mono text-cyan-400 mt-1">{radar.overall_mastery}%</div>
                  </div>
                  <Target className="w-8 h-8 text-cyan-500/40" />
                </div>
              </div>
            )}

            {/* Mastery Topic Grid */}
            <div className="bg-zinc-950/80 rounded-2xl border border-zinc-800 p-6 shadow-xl">
              <h2 className="text-sm font-bold font-mono text-white mb-4 flex items-center gap-2 border-b border-zinc-800 pb-3">
                <Layers className="w-4 h-4 text-cyan-400" /> SM-2 SPACED REPETITION MASTERY RADAR
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {radar?.topics?.map((item) => (
                  <div key={item.topic} className="p-4 rounded-xl bg-zinc-900/60 border border-zinc-800/80 flex flex-col justify-between gap-3">
                    <div>
                      <div className="flex items-center justify-between mb-1.5">
                        <span className="text-xs font-mono font-bold text-white">{item.topic}</span>
                        <span className={`text-xs font-mono font-bold ${item.mastery_score >= 70 ? "text-emerald-400" : "text-amber-400"
                          }`}>
                          {item.mastery_score}%
                        </span>
                      </div>
                      <div className="w-full h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${item.mastery_score >= 70 ? "bg-emerald-500" : "bg-amber-500"
                            }`}
                          style={{ width: `${Math.min(100, Math.max(5, item.mastery_score))}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between text-[11px] font-mono text-zinc-400">
                      <span>Next Review: {item.next_review_date}</span>
                      <button
                        onClick={() => {
                          fetchDailyDrill(item.topic);
                          setActiveTab("drill");
                        }}
                        className="text-cyan-400 hover:text-cyan-300 flex items-center gap-1 cursor-pointer"
                      >
                        Drill Now <ArrowRight className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
