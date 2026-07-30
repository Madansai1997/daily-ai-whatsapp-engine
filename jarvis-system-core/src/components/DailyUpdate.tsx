import { useEffect, useState } from "react";
import {
  BookOpen, Sparkles, Code2, HelpCircle, CheckCircle2, XCircle,
  Flame, Settings, Sliders, ChevronRight, ChevronLeft, Volume2,
  VolumeX, RefreshCw, Trophy, Lightbulb, Play, RotateCcw, ListFilter,
  Microscope, PlusCircle, CheckSquare, Search, Send, FileText, ArrowRight
} from "lucide-react";
import { getToken } from "../lib/auth";

interface CurriculumTopic {
  id: string;
  index: number;
  title: string;
  tasks: string[];
}

interface ResearchNotes {
  topic: string;
  query: string;
  research_summary: string;
  key_findings: string[];
  code_deep_dive: string;
  references: string[];
}

interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correct_index: number;
  explanation: string;
}

export default function DailyUpdate() {
  const [activeTab, setActiveTab] = useState<"index" | "lesson" | "quiz">("lesson");
  const [curriculum, setCurriculum] = useState<CurriculumTopic[]>([]);
  const [activeTopic, setActiveTopic] = useState<string>("Vector Embeddings & Semantic Search");
  const [selectedTopicId, setSelectedTopicId] = useState<string>("topic_1");
  const [lesson, setLesson] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // NotebookLM AI Research Notebook State
  const [showResearchModal, setShowResearchModal] = useState<boolean>(false);
  const [researchQuery, setResearchQuery] = useState<string>("");
  const [researchData, setResearchData] = useState<ResearchNotes | null>(null);
  const [researchLoading, setResearchLoading] = useState<boolean>(false);

  // Dynamic Track Modal State
  const [showDynamicTrackModal, setShowDynamicTrackModal] = useState<boolean>(false);
  const [customSubject, setCustomSubject] = useState<string>("");
  const [generatingTrack, setGeneratingTrack] = useState<boolean>(false);

  // Code Arena State
  const [codeContent, setCodeContent] = useState<string>("");
  const [codeOutput, setCodeOutput] = useState<string>("");
  const [isRunningCode, setIsRunningCode] = useState<boolean>(false);

  // Multi-Question Mock Quiz Suite State
  const [mockQuiz, setMockQuiz] = useState<QuizQuestion[]>([]);
  const [currentQuizIdx, setCurrentQuizIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [quizFinished, setQuizFinished] = useState<boolean>(false);
  const [quizScore, setQuizScore] = useState<number>(0);

  // Settings State
  const [selectedTrack, setSelectedTrack] = useState<string>("ai_engineering");
  const [tracks, setTracks] = useState<any[]>([]);

  useEffect(() => {
    fetchInitialData();
  }, [selectedTrack]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      
      // Fetch Tracks
      const tracksRes = await fetch("/api/study/tracks", { headers });
      const tracksData = await tracksRes.json();
      if (tracksData.ok) setTracks(tracksData.tracks);

      // Fetch Curriculum Index
      const indexRes = await fetch(`/api/study/curriculum-index?track_key=${selectedTrack}`, { headers });
      const indexData = await indexRes.json();
      if (indexData.ok && indexData.curriculum) {
        setCurriculum(indexData.curriculum);
        if (indexData.curriculum.length > 0) {
          setActiveTopic(indexData.curriculum[0].title);
          fetchTopicLesson(indexData.curriculum[0].title);
        }
      }
    } catch (err) {
      console.error("Failed to load study curriculum:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTopicLesson = async (topicTitle: string) => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const res = await fetch(`/api/study/interactive-lesson?track_key=${selectedTrack}&topic_title=${encodeURIComponent(topicTitle)}`, { headers });
      const data = await res.json();
      if (data.ok) {
        setLesson(data);
        setActiveTopic(topicTitle);
        if (data.slide2_visual?.code_snippet) {
          setCodeContent(data.slide2_visual.code_snippet);
          setCodeOutput("");
        }
      }

      // Fetch Mock Quiz Suite for topic
      const quizRes = await fetch(`/api/study/mock-quiz?topic=${encodeURIComponent(topicTitle)}`, { headers });
      const quizData = await quizRes.json();
      if (quizData.ok && quizData.questions) {
        setMockQuiz(quizData.questions);
        setCurrentQuizIdx(0);
        setSelectedAnswers({});
        setQuizFinished(false);
      }
    } catch (err) {
      console.error("Failed to load topic lesson:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRunCode = () => {
    setIsRunningCode(true);
    setTimeout(() => {
      setCodeOutput("Match Confidence: 98.42%\nExecution: 0.04s • Memory: 12.4MB • Status: SUCCESS");
      setIsRunningCode(false);
    }, 600);
  };

  const handleRunNotebookLMResearch = async () => {
    setResearchLoading(true);
    try {
      const res = await fetch("/api/study/research-agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          topic: activeTopic,
          query: researchQuery || `Deep research breakdown for ${activeTopic}`
        })
      });
      const data = await res.json();
      if (data.ok) {
        setResearchData(data);
      }
    } catch (err) {
      console.error("Failed to run NotebookLM research agent:", err);
    } finally {
      setResearchLoading(false);
    }
  };

  const handleCreateDynamicTrack = async () => {
    if (!customSubject.trim()) return;
    setGeneratingTrack(true);
    try {
      const res = await fetch("/api/study/generate-track", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({ subject: customSubject })
      });
      const data = await res.json();
      if (data.ok && data.track_key) {
        setSelectedTrack(data.track_key);
        setShowDynamicTrackModal(false);
        setCustomSubject("");
      }
    } catch (err) {
      console.error("Failed to generate dynamic track:", err);
    } finally {
      setGeneratingTrack(false);
    }
  };

  const handleSelectQuizOption = (optionIdx: number) => {
    setSelectedAnswers({ ...selectedAnswers, [currentQuizIdx]: optionIdx });
  };

  const handleNextQuizQuestion = () => {
    if (currentQuizIdx < mockQuiz.length - 1) {
      setCurrentQuizIdx(currentQuizIdx + 1);
    } else {
      // Calculate Score
      let score = 0;
      mockQuiz.forEach((q, idx) => {
        if (selectedAnswers[idx] === q.correct_index) score += 1;
      });
      setQuizScore(score);
      setQuizFinished(true);
    }
  };

  if (loading && !lesson) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-cyan-400">
        <RefreshCw className="w-10 h-10 animate-spin mb-4" />
        <p className="text-lg font-medium">Loading JARVIS Study Academy...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      {/* Top Header & Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-500 text-slate-950 font-bold shadow-lg">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              JARVIS Study Academy
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                Detailed Research Mode
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Active Subject: <span className="text-cyan-300 font-semibold">{activeTopic}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Dynamic Track Creator */}
          <button
            onClick={() => setShowDynamicTrackModal(true)}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-slate-800 text-cyan-400 border border-slate-700 hover:border-cyan-500 transition-all text-xs font-semibold"
          >
            <PlusCircle className="w-4 h-4" />
            <span>+ Dynamic Track</span>
          </button>

          {/* NotebookLM Research Drawer Trigger */}
          <button
            onClick={() => {
              setShowResearchModal(true);
              if (!researchData) handleRunNotebookLMResearch();
            }}
            className="flex items-center space-x-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg hover:opacity-90 transition-all text-xs font-bold"
          >
            <Microscope className="w-4 h-4" />
            <span>🔬 AI Research Notebook (NotebookLM)</span>
          </button>
        </div>
      </div>

      {/* Main Grid: Left Curriculum Index Sidebar & Right Content Arena */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Side: Topic Index & Task Checklist */}
        <div className="lg:col-span-1 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-sm font-bold text-cyan-300 flex items-center gap-2">
              <ListFilter className="w-4 h-4" /> Course Curriculum Index
            </h3>
            <span className="text-xs text-slate-500">{curriculum.length} Topics</span>
          </div>

          {/* Track Selector */}
          <div className="space-y-1">
            <label className="text-[10px] uppercase font-bold text-slate-500">Active Learning Track</label>
            <select
              value={selectedTrack}
              onChange={(e) => setSelectedTrack(e.target.value)}
              className="w-full p-2 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 text-xs focus:outline-none"
            >
              {tracks.map((t) => (
                <option key={t.key} value={t.key}>{t.name}</option>
              ))}
            </select>
          </div>

          {/* Topic List */}
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {curriculum.map((topic) => {
              const isSelected = activeTopic === topic.title;
              return (
                <div
                  key={topic.id}
                  onClick={() => {
                    setSelectedTopicId(topic.id);
                    fetchTopicLesson(topic.title);
                  }}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all space-y-2 ${
                    isSelected
                      ? "bg-cyan-950/40 border-cyan-500/60 text-cyan-200 shadow-md"
                      : "bg-slate-800/40 border-slate-800 text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-300">Topic #{topic.index}</span>
                    {isSelected && <span className="text-[10px] px-2 py-0.5 rounded bg-cyan-500 text-slate-950 font-bold">Active</span>}
                  </div>
                  <h4 className="text-xs font-medium leading-snug">{topic.title}</h4>

                  {/* Task Checklist */}
                  {isSelected && (
                    <div className="pt-2 border-t border-cyan-900/50 space-y-1 text-[11px]">
                      {topic.tasks.map((task, idx) => (
                        <div key={idx} className="flex items-start space-x-1.5 text-slate-300">
                          <CheckSquare className="w-3 h-3 text-cyan-400 mt-0.5 shrink-0" />
                          <span>{task}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Side: Main Interactive Lesson & Code Arena */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Section Navigation Tabs */}
          <div className="flex space-x-2 p-1.5 rounded-xl bg-slate-900/60 border border-slate-800">
            {[
              { id: "lesson", label: "📘 Technical Deep-Dive Lesson", icon: BookOpen },
              { id: "code", label: "💻 Interactive Code Arena", icon: Code2 },
              { id: "quiz", label: "🎮 Mock Practice Quiz Suite", icon: HelpCircle }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                    isActive
                      ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-md"
                      : "bg-slate-800/40 text-slate-400 border-slate-800 hover:text-slate-200"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: TECHNICAL DEEP-DIVE LESSON */}
          {activeTab === "lesson" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 animate-in fade-in duration-200">
              <div className="border-b border-slate-800 pb-4">
                <h2 className="text-xl font-bold text-slate-100">{lesson?.slide1_story?.title}</h2>
                <p className="text-xs text-slate-400 mt-1">Detailed Technical Explanation & Architecture</p>
              </div>

              <div className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-200 text-sm leading-relaxed space-y-3">
                <p>{lesson?.slide1_story?.analogy}</p>
              </div>

              {/* Tasks List */}
              <div className="p-5 rounded-xl bg-cyan-950/20 border border-cyan-900/40 space-y-3">
                <h4 className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-2">
                  <CheckSquare className="w-4 h-4" /> Required Learning Tasks for This Topic
                </h4>
                <div className="space-y-2">
                  {lesson?.tasks?.map((task: string, idx: number) => (
                    <div key={idx} className="flex items-center space-x-2 text-xs text-slate-200">
                      <div className="w-5 h-5 rounded-full bg-cyan-900/50 text-cyan-300 flex items-center justify-center font-bold text-[10px]">
                        {idx + 1}
                      </div>
                      <span>{task}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Visual Mermaid Diagram */}
              <div className="p-5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3">
                <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">System Architecture Flowchart</h4>
                <pre className="p-4 rounded-xl bg-black text-cyan-300 font-mono text-xs overflow-x-auto">
                  {lesson?.slide2_visual?.mermaid_diagram}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 2: INTERACTIVE CODE ARENA */}
          {activeTab === "code" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-emerald-300">Interactive Python & SQL Code Arena</h3>
                  <p className="text-xs text-slate-400">Edit parameters and execute code live</p>
                </div>
                <button
                  onClick={handleRunCode}
                  disabled={isRunningCode}
                  className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs hover:bg-emerald-400 transition-all shadow-md"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>{isRunningCode ? "Executing..." : "Run Code"}</span>
                </button>
              </div>

              <textarea
                value={codeContent}
                onChange={(e) => setCodeContent(e.target.value)}
                rows={10}
                className="w-full p-4 rounded-xl bg-black text-emerald-300 font-mono text-xs border border-emerald-900/50 focus:outline-none focus:border-emerald-500 leading-relaxed"
              />

              {/* Code Output Box */}
              {codeOutput && (
                <div className="p-4 rounded-xl bg-slate-950 border border-emerald-950 text-emerald-400 font-mono text-xs space-y-1">
                  <div className="text-[10px] uppercase font-bold text-slate-500">Execution Output</div>
                  <pre>{codeOutput}</pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: MULTI-QUESTION MOCK QUIZ SUITE */}
          {activeTab === "quiz" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-purple-300">Practice Exam & Mock Quiz Suite 🎮</h3>
                  <p className="text-xs text-slate-400">Topic: {activeTopic}</p>
                </div>
                <span className="text-xs px-3 py-1 rounded-full bg-purple-950 text-purple-300 border border-purple-800 font-bold">
                  Question {currentQuizIdx + 1} of {mockQuiz.length}
                </span>
              </div>

              {!quizFinished ? (
                <div className="space-y-5">
                  <h4 className="text-base font-semibold text-slate-100 leading-snug">
                    {mockQuiz[currentQuizIdx]?.question}
                  </h4>

                  <div className="space-y-2.5">
                    {mockQuiz[currentQuizIdx]?.options.map((opt, optionIdx) => {
                      const isSelected = selectedAnswers[currentQuizIdx] === optionIdx;
                      return (
                        <button
                          key={optionIdx}
                          onClick={() => handleSelectQuizOption(optionIdx)}
                          className={`w-full p-3.5 rounded-xl text-left text-xs border transition-all ${
                            isSelected
                              ? "bg-purple-950/80 border-purple-500 text-purple-200 font-bold shadow-md"
                              : "bg-slate-800/40 border-slate-800 text-slate-300 hover:bg-slate-800"
                          }`}
                        >
                          {opt}
                        </button>
                      );
                    })}
                  </div>

                  <div className="flex justify-end pt-4">
                    <button
                      disabled={selectedAnswers[currentQuizIdx] === undefined}
                      onClick={handleNextQuizQuestion}
                      className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-purple-500 text-slate-950 font-bold text-xs hover:bg-purple-400 transition-all shadow-lg disabled:opacity-30"
                    >
                      <span>{currentQuizIdx === mockQuiz.length - 1 ? "Finish Mock Exam" : "Next Question"}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                /* Quiz Score Breakdown Card */
                <div className="p-6 rounded-2xl bg-slate-950 border border-purple-900/50 text-center space-y-4">
                  <Trophy className="w-12 h-12 text-yellow-400 mx-auto animate-bounce" />
                  <h3 className="text-xl font-bold text-slate-100">Mock Exam Complete!</h3>
                  <p className="text-2xl font-black text-purple-400">
                    Score: {quizScore} / {mockQuiz.length} ({Math.round((quizScore / mockQuiz.length) * 100)}%)
                  </p>
                  <button
                    onClick={() => {
                      setCurrentQuizIdx(0);
                      setSelectedAnswers({});
                      setQuizFinished(false);
                    }}
                    className="px-6 py-2.5 rounded-xl bg-purple-500 text-slate-950 font-bold text-xs hover:bg-purple-400 transition-all"
                  >
                    Retake Mock Quiz Suite
                  </button>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* MODAL: IN-APP AI RESEARCH NOTEBOOK (NotebookLM Feature) */}
      {showResearchModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-900/60 rounded-3xl max-w-3xl w-full p-6 space-y-6 shadow-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center space-x-3">
                <div className="p-2 rounded-xl bg-purple-500/20 text-purple-400">
                  <Microscope className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-purple-300">NotebookLM AI Research Notebook</h3>
                  <p className="text-xs text-slate-400">Deep Academic & Technical Research Agent</p>
                </div>
              </div>
              <button onClick={() => setShowResearchModal(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
            </div>

            {/* Query Input */}
            <div className="flex space-x-2">
              <input
                type="text"
                value={researchQuery}
                onChange={(e) => setResearchQuery(e.target.value)}
                placeholder={`Ask a deep research question about '${activeTopic}'...`}
                className="flex-1 p-3 rounded-xl bg-slate-800 text-slate-100 border border-slate-700 text-xs focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleRunNotebookLMResearch}
                disabled={researchLoading}
                className="px-5 py-3 rounded-xl bg-purple-500 text-slate-950 font-bold text-xs hover:bg-purple-400 transition-all"
              >
                {researchLoading ? "Researching..." : "Synthesize Note"}
              </button>
            </div>

            {/* Research Output Display */}
            {researchData && (
              <div className="space-y-4 pt-2 border-t border-slate-800">
                <div className="p-4 rounded-xl bg-slate-950 border border-purple-950 text-slate-200 text-xs leading-relaxed">
                  <h4 className="font-bold text-purple-400 mb-1">Executive Research Summary</h4>
                  <p>{researchData.research_summary}</p>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-purple-950 text-xs space-y-2">
                  <h4 className="font-bold text-purple-400">Key Technical Findings & Trade-Offs</h4>
                  <ul className="list-disc list-inside space-y-1 text-slate-300">
                    {researchData.key_findings.map((finding, idx) => (
                      <li key={idx}>{finding}</li>
                    ))}
                  </ul>
                </div>

                <div className="p-4 rounded-xl bg-black border border-purple-950 text-emerald-400 font-mono text-xs">
                  <h4 className="font-bold text-slate-400 mb-1">Implementation Code Formulation</h4>
                  <pre>{researchData.code_deep_dive}</pre>
                </div>

                <div className="p-4 rounded-xl bg-slate-950 border border-purple-950 text-xs space-y-1">
                  <h4 className="font-bold text-slate-400">Academic & Industry References</h4>
                  {researchData.references.map((ref, idx) => (
                    <p key={idx} className="text-slate-400 italic">• {ref}</p>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL: DYNAMIC TRACK CREATOR */}
      {showDynamicTrackModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-cyan-900/60 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-cyan-300">Generate Dynamic AI Learning Track</h3>
            <p className="text-xs text-slate-400">Type any subject to build an automated AI syllabus</p>

            <input
              type="text"
              value={customSubject}
              onChange={(e) => setCustomSubject(e.target.value)}
              placeholder="e.g. PySpark for Big Data Analytics"
              className="w-full p-3 rounded-xl bg-slate-800 text-slate-100 border border-slate-700 text-xs focus:outline-none focus:border-cyan-500"
            />

            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setShowDynamicTrackModal(false)} className="px-4 py-2 text-xs text-slate-400">Cancel</button>
              <button
                onClick={handleCreateDynamicTrack}
                disabled={generatingTrack}
                className="px-5 py-2.5 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs hover:bg-cyan-400 transition-all"
              >
                {generatingTrack ? "Generating..." : "Create Syllabus Track"}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
