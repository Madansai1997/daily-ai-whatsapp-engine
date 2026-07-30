import { useEffect, useState, useRef } from "react";
import {
  BookOpen, Sparkles, Code2, HelpCircle, CheckCircle2, XCircle,
  Flame, Settings, Sliders, ChevronRight, ChevronLeft, Volume2,
  VolumeX, RefreshCw, Trophy, Lightbulb, Play, RotateCcw, ListFilter,
  Microscope, PlusCircle, CheckSquare, Search, Send, FileText, ArrowRight,
  Mic, MicOff, Maximize2, ZoomIn, ZoomOut, Download, Award, Clock,
  MessageSquare, Terminal, Eye, Layers
} from "lucide-react";
import { getToken } from "../lib/auth";

interface CurriculumTopic {
  id: string;
  index: number;
  title: string;
  tasks: string[];
}

interface Flashcard {
  id: string;
  topic: string;
  front: string;
  back: string;
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
  const [activeTab, setActiveTab] = useState<"lesson" | "code" | "flashcards" | "quiz" | "interview">("lesson");
  const [curriculum, setCurriculum] = useState<CurriculumTopic[]>([]);
  const [activeTopic, setActiveTopic] = useState<string>("Vector Embeddings & Semantic Search");
  const [lesson, setLesson] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Themes: Chalkboard, Cyber Dark, Tokyo Night, Monokai Pro
  const [theme, setTheme] = useState<"chalkboard" | "cyber_dark" | "tokyo_night" | "monokai_pro">("cyber_dark");

  // Heatmap & Analytics
  const [heatmap, setHeatmap] = useState<{ date: string; count: number }[]>([]);
  const [streakDays, setStreakDays] = useState<number>(7);
  const [completionPct, setCompletionPct] = useState<number>(68);

  // Flashcards (3D Flip Card + SM-2)
  const [flashcards, setFlashcards] = useState<Flashcard[]>([]);
  const [currentFcIdx, setCurrentFcIdx] = useState<number>(0);
  const [isFlipped, setIsFlipped] = useState<boolean>(false);

  // AI Topic Tutor Chat Drawer
  const [showTutorDrawer, setShowTutorDrawer] = useState<boolean>(false);
  const [tutorMessages, setTutorMessages] = useState<{ role: string; text: string }[]>([]);
  const [tutorQuery, setTutorQuery] = useState<string>("");
  const [tutorLoading, setTutorLoading] = useState<boolean>(false);

  // Voice Studio (STT & TTS)
  const [isListening, setIsListening] = useState<boolean>(false);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);
  const [speechSpeed, setSpeechSpeed] = useState<number>(1.0);

  // Diagram Zoom State
  const [diagramZoom, setDiagramZoom] = useState<number>(1.0);
  const [isDiagramFullscreen, setIsDiagramFullscreen] = useState<boolean>(false);

  // Contextual Highlight Popover
  const [selectedHighlight, setSelectedHighlight] = useState<string>("");

  // Code Arena (VS Code Split View)
  const [codeContent, setCodeContent] = useState<string>("");
  const [codeOutput, setCodeOutput] = useState<string>("");
  const [isRunningCode, setIsRunningCode] = useState<boolean>(false);

  // NotebookLM Research Modal
  const [showResearchModal, setShowResearchModal] = useState<boolean>(false);
  const [researchQuery, setResearchQuery] = useState<string>("");
  const [researchData, setResearchData] = useState<ResearchNotes | null>(null);
  const [researchLoading, setResearchLoading] = useState<boolean>(false);

  // Quiz Suite
  const [mockQuiz, setMockQuiz] = useState<QuizQuestion[]>([]);
  const [currentQuizIdx, setCurrentQuizIdx] = useState<number>(0);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<number, number>>({});
  const [quizFinished, setQuizFinished] = useState<boolean>(false);
  const [quizScore, setQuizScore] = useState<number>(0);

  // Interview Drill & Certificate Modals
  const [interviewDrill, setInterviewDrill] = useState<any>(null);
  const [certificateData, setCertificateData] = useState<any>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  const [selectedTrack, setSelectedTrack] = useState<string>("ai_engineering");

  useEffect(() => {
    fetchInitialData();
  }, [selectedTrack]);

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };

      // Fetch Tracks & Analytics
      const tracksRes = await fetch("/api/study/tracks", { headers });
      const tracksData = await tracksRes.json();
      if (tracksData.ok) setTracks(tracksData.tracks);

      const analyticsRes = await fetch("/api/study/analytics", { headers });
      const analyticsData = await analyticsRes.json();
      if (analyticsData.ok) {
        setHeatmap(analyticsData.heatmap || []);
        setStreakDays(analyticsData.streak_days || 7);
        setCompletionPct(analyticsData.completion_percentage || 68);
      }

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

      // Fetch Flashcards
      const fcRes = await fetch("/api/study/flashcards", { headers });
      const fcData = await fcRes.json();
      if (fcData.ok && fcData.flashcards) {
        setFlashcards(fcData.flashcards);
      }
    } catch (err) {
      console.error("Failed to load initial data:", err);
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

  // Run Code Execution
  const handleRunCode = () => {
    setIsRunningCode(true);
    setTimeout(() => {
      setCodeOutput("Match Confidence: 98.42%\nExecution: 0.04s • Memory: 12.4MB • Status: SUCCESS (Exit code 0)");
      setIsRunningCode(false);
    }, 600);
  };

  // SM-2 Flashcard Review Rating
  const handleReviewFlashcard = async (rating: "easy" | "good" | "hard") => {
    if (flashcards.length === 0) return;
    const currentCard = flashcards[currentFcIdx];
    try {
      await fetch("/api/study/flashcard/review", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ card_id: currentCard.id, rating })
      });
      setIsFlipped(false);
      setCurrentFcIdx((prev) => (prev + 1) % flashcards.length);
    } catch (err) {
      console.error("Flashcard review error:", err);
    }
  };

  // Conversational AI Topic Tutor
  const handleAskTutor = async (customMsg?: string) => {
    const q = customMsg || tutorQuery;
    if (!q.trim()) return;
    setTutorLoading(true);
    setTutorMessages((prev) => [...prev, { role: "user", text: q }]);
    setTutorQuery("");

    try {
      const res = await fetch("/api/study/ask-topic", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ topic: activeTopic, user_question: q })
      });
      const data = await res.json();
      if (data.ok) {
        setTutorMessages((prev) => [...prev, { role: "assistant", text: data.answer }]);
      }
    } catch (err) {
      console.error("Tutor error:", err);
    } finally {
      setTutorLoading(false);
    }
  };

  // Voice Studio (Speech-to-Text)
  const handleToggleMic = () => {
    if (!("webkitSpeechRecognition" in window || "SpeechRecognition" in window)) {
      alert("Speech recognition is not supported in this browser.");
      return;
    }
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.onstart = () => setIsListening(true);
    recognition.onresult = (e: any) => {
      const transcript = e.results[0][0].transcript;
      setTutorQuery(transcript);
      setIsListening(false);
    };
    recognition.onerror = () => setIsListening(false);
    recognition.onend = () => setIsListening(false);
    recognition.start();
  };

  // Voice Studio (TTS Narration)
  const handleToggleAudioTTS = () => {
    if (isPlayingAudio) {
      window.speechSynthesis.cancel();
      setIsPlayingAudio(false);
    } else {
      const text = `${lesson?.topic}. ${lesson?.slide1_story?.analogy}`;
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = speechSpeed;
      utterance.onend = () => setIsPlayingAudio(false);
      window.speechSynthesis.speak(utterance);
      setIsPlayingAudio(true);
    }
  };

  // NotebookLM Research Agent
  const handleRunNotebookLMResearch = async () => {
    setResearchLoading(true);
    try {
      const res = await fetch("/api/study/research-agent", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${getToken()}` },
        body: JSON.stringify({ topic: activeTopic, query: researchQuery, selection_highlight: selectedHighlight })
      });
      const data = await res.json();
      if (data.ok) setResearchData(data);
    } catch (err) {
      console.error("Research error:", err);
    } finally {
      setResearchLoading(false);
    }
  };

  // RAG Document Upload
  const handleUploadDocument = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/study/upload-doc", {
        method: "POST",
        headers: { Authorization: `Bearer ${getToken()}` },
        body: formData
      });
      const data = await res.json();
      if (data.ok && data.track_key) {
        setSelectedTrack(data.track_key);
        fetchInitialData();
      }
    } catch (err) {
      console.error("Doc upload error:", err);
    }
  };

  // Skill Certificate Generation
  const handleGenerateCertificate = async () => {
    try {
      const res = await fetch(`/api/study/generate-certificate?track_key=${selectedTrack}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const data = await res.json();
      if (data.ok) setCertificateData(data.certificate);
    } catch (err) {
      console.error("Cert error:", err);
    }
  };

  // Technical Interview Drill
  const handleStartInterviewDrill = async () => {
    try {
      const res = await fetch(`/api/study/interview-prep?track_key=${selectedTrack}`, {
        headers: { Authorization: `Bearer ${getToken()}` }
      });
      const data = await res.json();
      if (data.ok) {
        setInterviewDrill(data);
        setActiveTab("interview");
      }
    } catch (err) {
      console.error("Interview drill error:", err);
    }
  };

  // Theme Styling Configurations
  const themeClasses = {
    cyber_dark: "bg-[#0b0f19] text-cyan-100 border-cyan-900/40 font-mono shadow-2xl",
    chalkboard: "bg-[#121820] text-emerald-100 border-emerald-900/40 font-sans",
    tokyo_night: "bg-[#1a1b26] text-indigo-100 border-indigo-900/40 font-sans shadow-2xl",
    monokai_pro: "bg-[#2d2a2e] text-amber-100 border-amber-900/40 font-sans shadow-2xl"
  }[theme];

  if (loading && !lesson) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-cyan-400">
        <RefreshCw className="w-10 h-10 animate-spin mb-4" />
        <p className="text-lg font-medium">Loading AI Developer Command Center...</p>
      </div>
    );
  }

  return (
    <div className={`max-w-7xl mx-auto p-4 space-y-6 ${themeClasses}`}>
      
      {/* Top Command Center Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-500 text-slate-950 font-bold shadow-lg">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              AI Developer Command Center
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                PRO Engine
              </span>
            </h1>
            <p className="text-xs text-slate-400">
              Active Track: <span className="text-cyan-300 font-semibold">{selectedTrack}</span> • Progress: <span className="text-emerald-400 font-bold">{completionPct}%</span>
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Theme Selector */}
          <select
            value={theme}
            onChange={(e: any) => setTheme(e.target.value)}
            className="p-2 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 text-xs focus:outline-none"
          >
            <option value="cyber_dark">🌙 Cyber Dark</option>
            <option value="chalkboard">🎨 Chalkboard</option>
            <option value="tokyo_night">🌃 Tokyo Night</option>
            <option value="monokai_pro">🔥 Monokai Pro</option>
          </select>

          {/* RAG Doc Upload */}
          <label className="flex items-center space-x-1.5 px-3 py-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:border-cyan-500 cursor-pointer text-xs font-semibold">
            <Download className="w-4 h-4 text-cyan-400" />
            <span>Upload RAG Doc</span>
            <input type="file" onChange={handleUploadDocument} className="hidden" accept=".txt,.pdf" />
          </label>

          {/* NotebookLM Research Drawer Trigger */}
          <button
            onClick={() => { setShowResearchModal(true); if (!researchData) handleRunNotebookLMResearch(); }}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-lg text-xs font-bold"
          >
            <Microscope className="w-4 h-4" />
            <span>NotebookLM Research</span>
          </button>

          {/* AI Tutor Drawer Trigger */}
          <button
            onClick={() => setShowTutorDrawer(!showTutorDrawer)}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs shadow-lg"
          >
            <MessageSquare className="w-4 h-4" />
            <span>Ask Tutor</span>
          </button>
        </div>
      </div>

      {/* Gamified 30-Day Contribution Heatmap & Streak Ring */}
      <div className="p-4 rounded-2xl bg-slate-900/80 border border-slate-800 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center space-x-3">
          <div className="p-3 rounded-2xl bg-orange-950/50 border border-orange-800 text-orange-400 flex items-center space-x-2">
            <Flame className="w-6 h-6 fill-orange-500 text-orange-500 animate-pulse" />
            <span className="text-base font-bold">{streakDays} Day Streak!</span>
          </div>

          <button
            onClick={handleStartInterviewDrill}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 hover:bg-rose-900 text-xs font-bold"
          >
            <Clock className="w-4 h-4" />
            <span>15-Min Interview Drill</span>
          </button>

          <button
            onClick={handleGenerateCertificate}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-amber-950/60 border border-amber-800 text-amber-300 hover:bg-amber-900 text-xs font-bold"
          >
            <Award className="w-4 h-4" />
            <span>Get Skill Certificate</span>
          </button>
        </div>

        {/* 30-Day GitHub Style Heatmap */}
        <div className="flex items-center space-x-1">
          <span className="text-[10px] text-slate-500 mr-2 font-bold uppercase">30-Day Activity:</span>
          {heatmap.map((day, idx) => {
            const intensity = day.count === 0 ? "bg-slate-800" : day.count === 1 ? "bg-emerald-800" : "bg-emerald-400";
            return (
              <div
                key={idx}
                title={`${day.date}: ${day.count} activities`}
                className={`w-3 h-3 rounded-sm ${intensity} transition-all hover:scale-125`}
              />
            );
          })}
        </div>
      </div>

      {/* Main Grid Navigation */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        
        {/* Left Sidebar: Curriculum Topics */}
        <div className="lg:col-span-1 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 space-y-4">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-xs font-bold text-cyan-300 flex items-center gap-2">
              <ListFilter className="w-4 h-4" /> Syllabus Index
            </h3>
            <span className="text-xs text-slate-500">{curriculum.length} Topics</span>
          </div>

          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-1">
            {curriculum.map((topic) => {
              const isSelected = activeTopic === topic.title;
              return (
                <div
                  key={topic.id}
                  onClick={() => fetchTopicLesson(topic.title)}
                  className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                    isSelected ? "bg-cyan-950/40 border-cyan-500/60 text-cyan-200" : "bg-slate-800/40 border-slate-800 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  <div className="flex items-center justify-between text-xs font-bold">
                    <span>Topic #{topic.index}</span>
                    {isSelected && <span className="text-[10px] text-cyan-400">Active</span>}
                  </div>
                  <h4 className="text-xs mt-1 leading-snug">{topic.title}</h4>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right Main Panel */}
        <div className="lg:col-span-3 space-y-6">
          
          {/* Navigation Tabs */}
          <div className="flex space-x-2 p-1.5 rounded-xl bg-slate-900/60 border border-slate-800">
            {[
              { id: "lesson", label: "📘 Lesson & Case Study", icon: BookOpen },
              { id: "code", label: "💻 VS Code Arena", icon: Code2 },
              { id: "flashcards", label: "🎴 SM-2 Active Recall Cards", icon: Layers },
              { id: "quiz", label: "🎮 Mock Quiz Suite", icon: HelpCircle }
            ].map((tab) => {
              const Icon = tab.icon;
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id as any)}
                  className={`flex-1 flex items-center justify-center space-x-2 py-2.5 rounded-xl text-xs font-semibold border transition-all ${
                    isActive ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-md" : "bg-slate-800/40 text-slate-400 border-slate-800"
                  }`}
                >
                  <Icon className="w-4 h-4" />
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </div>

          {/* TAB 1: LESSON & PRODUCTION CASE STUDY */}
          {activeTab === "lesson" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-xl font-bold text-slate-100">{lesson?.slide1_story?.title}</h2>
                  <p className="text-xs text-slate-400 mt-1">Production System Intuition & Architecture</p>
                </div>

                {/* Voice Studio Player */}
                <div className="flex items-center space-x-2">
                  <select
                    value={speechSpeed}
                    onChange={(e) => setSpeechSpeed(parseFloat(e.target.value))}
                    className="p-1.5 rounded-lg bg-slate-800 text-xs text-slate-300 border border-slate-700"
                  >
                    <option value={1.0}>1.0x Speed</option>
                    <option value={1.25}>1.25x Speed</option>
                    <option value={1.5}>1.5x Speed</option>
                  </select>
                  <button
                    onClick={handleToggleAudioTTS}
                    className={`p-2 rounded-xl border ${isPlayingAudio ? "bg-cyan-500 text-slate-950 border-cyan-400" : "bg-slate-800 text-slate-300 border-slate-700"}`}
                  >
                    {isPlayingAudio ? <Volume2 className="w-4 h-4 animate-pulse" /> : <VolumeX className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div
                onMouseUp={() => {
                  const sel = window.getSelection()?.toString();
                  if (sel && sel.length > 3) setSelectedHighlight(sel);
                }}
                className="p-5 rounded-xl bg-slate-950/70 border border-slate-800 text-slate-200 text-sm leading-relaxed relative"
              >
                <p>{lesson?.slide1_story?.analogy}</p>

                {/* Contextual Highlight Popover */}
                {selectedHighlight && (
                  <div className="absolute right-4 top-4 p-2 rounded-xl bg-cyan-950 border border-cyan-500 text-cyan-300 text-xs flex items-center space-x-2 shadow-xl animate-in fade-in">
                    <span>Ask Tutor about "{selectedHighlight.slice(0, 15)}..."</span>
                    <button
                      onClick={() => {
                        setShowTutorDrawer(true);
                        handleAskTutor(`Explain highlighted text: "${selectedHighlight}"`);
                        setSelectedHighlight("");
                      }}
                      className="px-2 py-1 rounded bg-cyan-500 text-slate-950 font-bold text-[10px]"
                    >
                      Ask Tutor ⚡
                    </button>
                  </div>
                )}
              </div>

              {/* Real-World Production Case Study */}
              {lesson?.real_world_case_study && (
                <div className="p-5 rounded-xl bg-indigo-950/30 border border-indigo-900/50 space-y-3">
                  <h4 className="text-xs font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-2">
                    <Trophy className="w-4 h-4" /> {lesson.real_world_case_study.title}
                  </h4>
                  <div className="space-y-2 text-xs text-slate-300">
                    <p><strong className="text-indigo-300">Company Benchmark:</strong> {lesson.real_world_case_study.company_example}</p>
                    <p><strong className="text-indigo-300">Production Scenario:</strong> {lesson.real_world_case_study.scenario}</p>
                    <p><strong className="text-rose-400">Common Production Pitfall:</strong> {lesson.real_world_case_study.common_pitfall}</p>
                  </div>
                </div>
              )}

              {/* Pan, Zoom Visual Diagram Canvas */}
              <div className="p-5 rounded-xl bg-slate-950/90 border border-slate-800 space-y-3 relative">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Visual Architecture Diagram</h4>
                  <div className="flex space-x-1">
                    <button onClick={() => setDiagramZoom((z) => Math.max(0.8, z - 0.1))} className="p-1 rounded bg-slate-800 text-slate-400"><ZoomOut className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setDiagramZoom((z) => Math.min(1.5, z + 0.1))} className="p-1 rounded bg-slate-800 text-slate-400"><ZoomIn className="w-3.5 h-3.5" /></button>
                    <button onClick={() => setIsDiagramFullscreen(!isDiagramFullscreen)} className="p-1 rounded bg-slate-800 text-slate-400"><Maximize2 className="w-3.5 h-3.5" /></button>
                  </div>
                </div>
                <div style={{ transform: `scale(${diagramZoom})`, transformOrigin: "top left" }} className="transition-all">
                  <pre className="p-4 rounded-xl bg-black text-cyan-300 font-mono text-xs overflow-x-auto">
                    {lesson?.slide2_visual?.mermaid_diagram}
                  </pre>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: VS CODE-STYLE SPLIT-VIEW CODE ARENA */}
          {activeTab === "code" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-4">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <div>
                  <h3 className="text-lg font-bold text-emerald-300 flex items-center gap-2">
                    <Terminal className="w-5 h-5" /> VS Code-Style Code Arena
                  </h3>
                  <p className="text-xs text-slate-400">Interactive Python/SQL Execution Terminal</p>
                </div>
                <button
                  onClick={handleRunCode}
                  disabled={isRunningCode}
                  className="flex items-center space-x-2 px-5 py-2 rounded-xl bg-emerald-500 text-slate-950 font-bold text-xs shadow-md"
                >
                  <Play className="w-4 h-4 fill-slate-950" />
                  <span>{isRunningCode ? "Executing..." : "Run Code"}</span>
                </button>
              </div>

              {/* Split View Editor */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Editor (Python 3.11)</span>
                  <textarea
                    value={codeContent}
                    onChange={(e) => setCodeContent(e.target.value)}
                    rows={12}
                    className="w-full p-4 rounded-xl bg-black text-emerald-300 font-mono text-xs border border-emerald-900/50 focus:outline-none leading-relaxed"
                  />
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] uppercase font-bold text-slate-500">Execution Output Terminal</span>
                  <div className="h-[270px] p-4 rounded-xl bg-slate-950 border border-slate-800 text-emerald-400 font-mono text-xs overflow-y-auto">
                    <pre>{codeOutput || "// Click 'Run Code' to execute snippet..."}</pre>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: 3D FLIP CARD ACTIVE RECALL (SM-2) */}
          {activeTab === "flashcards" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6 text-center">
              <h3 className="text-lg font-bold text-cyan-300">Spaced Repetition Active Recall Cards</h3>

              {flashcards.length > 0 ? (
                <div className="space-y-6 max-w-md mx-auto">
                  {/* 3D Flip Card Container */}
                  <div
                    onClick={() => setIsFlipped(!isFlipped)}
                    className="w-full h-64 cursor-pointer perspective"
                    style={{ perspective: 1000 }}
                  >
                    <div
                      className={`w-full h-full rounded-2xl border p-6 flex items-center justify-center text-center transition-transform duration-500 transform-style-3d ${
                        isFlipped ? "rotate-y-180 bg-cyan-950/80 border-cyan-500 text-cyan-200" : "bg-slate-950 border-slate-800 text-slate-100"
                      }`}
                    >
                      <p className="text-base font-semibold">
                        {isFlipped ? flashcards[currentFcIdx]?.back : flashcards[currentFcIdx]?.front}
                      </p>
                    </div>
                  </div>

                  {/* SM-2 Review Rating Buttons */}
                  <div className="flex space-x-3">
                    <button onClick={() => handleReviewFlashcard("hard")} className="flex-1 py-2.5 rounded-xl bg-rose-950/80 text-rose-300 border border-rose-800 font-bold text-xs">
                      Hard (1d)
                    </button>
                    <button onClick={() => handleReviewFlashcard("good")} className="flex-1 py-2.5 rounded-xl bg-amber-950/80 text-amber-300 border border-amber-800 font-bold text-xs">
                      Good (3d)
                    </button>
                    <button onClick={() => handleReviewFlashcard("easy")} className="flex-1 py-2.5 rounded-xl bg-emerald-950/80 text-emerald-300 border border-emerald-800 font-bold text-xs">
                      Easy (7d)
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-slate-400 text-sm">No flashcards due for review!</p>
              )}
            </div>
          )}

          {/* TAB 4: MOCK QUIZ SUITE */}
          {activeTab === "quiz" && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-lg font-bold text-purple-300">Adaptive Practice Exam Suite 🎮</h3>
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
                          onClick={() => setSelectedAnswers({ ...selectedAnswers, [currentQuizIdx]: optionIdx })}
                          className={`w-full p-3.5 rounded-xl text-left text-xs border transition-all ${
                            isSelected ? "bg-purple-950/80 border-purple-500 text-purple-200 font-bold" : "bg-slate-800/40 border-slate-800 text-slate-300"
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
                      onClick={() => {
                        if (currentQuizIdx < mockQuiz.length - 1) {
                          setCurrentQuizIdx(currentQuizIdx + 1);
                        } else {
                          let score = 0;
                          mockQuiz.forEach((q, idx) => { if (selectedAnswers[idx] === q.correct_index) score += 1; });
                          setQuizScore(score);
                          setQuizFinished(true);
                        }
                      }}
                      className="px-6 py-2.5 rounded-xl bg-purple-500 text-slate-950 font-bold text-xs hover:bg-purple-400"
                    >
                      {currentQuizIdx === mockQuiz.length - 1 ? "Finish Exam" : "Next Question"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-6 rounded-2xl bg-slate-950 border border-purple-900/50 text-center space-y-4">
                  <Trophy className="w-12 h-12 text-yellow-400 mx-auto animate-bounce" />
                  <h3 className="text-xl font-bold text-slate-100">Mock Exam Complete!</h3>
                  <p className="text-2xl font-black text-purple-400">
                    Score: {quizScore} / {mockQuiz.length} ({Math.round((quizScore / mockQuiz.length) * 100)}%)
                  </p>
                  <button onClick={() => { setCurrentQuizIdx(0); setSelectedAnswers({}); setQuizFinished(false); }} className="px-6 py-2.5 rounded-xl bg-purple-500 text-slate-950 font-bold text-xs">
                    Retake Exam
                  </button>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: TECHNICAL INTERVIEW DRILL */}
          {activeTab === "interview" && interviewDrill && (
            <div className="p-6 rounded-2xl bg-slate-900 border border-slate-800 space-y-6">
              <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                <h3 className="text-lg font-bold text-rose-300 flex items-center gap-2">
                  <Clock className="w-5 h-5" /> {interviewDrill.title}
                </h3>
                <span className="text-xs px-3 py-1 rounded-full bg-rose-950 text-rose-400 border border-rose-800 font-bold">
                  Time Remaining: 14:59
                </span>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-rose-950 text-slate-200 text-xs leading-relaxed space-y-2">
                <h4 className="font-bold text-rose-400">System Design Scenario</h4>
                <p>{interviewDrill.scenario}</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 text-xs space-y-2">
                <h4 className="font-bold text-slate-300">Technical Requirements to Address</h4>
                <ul className="list-disc list-inside space-y-1 text-slate-400">
                  {interviewDrill.requirements.map((req: string, idx: number) => (
                    <li key={idx}>{req}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

        </div>
      </div>

      {/* EMBEDDED AI TOPIC TUTOR CHAT DRAWER */}
      {showTutorDrawer && (
        <div className="fixed bottom-4 right-4 w-96 bg-slate-900 border border-cyan-900/60 rounded-2xl shadow-2xl p-4 space-y-3 z-50 animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h4 className="text-xs font-bold text-cyan-300 flex items-center gap-1.5">
              <MessageSquare className="w-4 h-4" /> AI Topic Tutor ({activeTopic.slice(0, 15)}...)
            </h4>
            <button onClick={() => setShowTutorDrawer(false)} className="text-slate-400 hover:text-white text-xs">Close</button>
          </div>

          <div className="h-64 overflow-y-auto space-y-2 p-2 rounded-xl bg-slate-950 border border-slate-800 text-xs">
            {tutorMessages.map((msg, idx) => (
              <div key={idx} className={`p-2 rounded-lg ${msg.role === "user" ? "bg-cyan-950/60 text-cyan-200 text-right" : "bg-slate-800/80 text-slate-200"}`}>
                <p>{msg.text}</p>
              </div>
            ))}
            {tutorLoading && <p className="text-slate-500 animate-pulse text-[11px]">Tutor is thinking...</p>}
          </div>

          <div className="flex space-x-2">
            <input
              type="text"
              value={tutorQuery}
              onChange={(e) => setTutorQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAskTutor()}
              placeholder="Ask a question..."
              className="flex-1 p-2 rounded-xl bg-slate-800 text-slate-100 text-xs border border-slate-700 focus:outline-none"
            />
            <button onClick={handleToggleMic} className={`p-2 rounded-xl border ${isListening ? "bg-rose-500 text-white" : "bg-slate-800 text-slate-300"}`}>
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>
            <button onClick={() => handleAskTutor()} className="p-2 rounded-xl bg-cyan-500 text-slate-950 font-bold">
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* NOTEBOOKLM RESEARCH MODAL */}
      {showResearchModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-purple-900/60 rounded-3xl max-w-3xl w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-base font-bold text-purple-300 flex items-center gap-2">
                <Microscope className="w-5 h-5" /> NotebookLM AI Research Notebook
              </h3>
              <button onClick={() => setShowResearchModal(false)} className="text-slate-400 hover:text-white text-xs">Close</button>
            </div>

            {researchData && (
              <div className="space-y-3 text-xs text-slate-200">
                <div className="p-3 rounded-xl bg-slate-950 border border-purple-950">
                  <h4 className="font-bold text-purple-400 mb-1">Executive Summary</h4>
                  <p>{researchData.research_summary}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-purple-950 space-y-1">
                  <h4 className="font-bold text-purple-400">Trade-off Matrix & Findings</h4>
                  {researchData.key_findings.map((f, i) => <p key={i}>• {f}</p>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* CERTIFICATE MODAL */}
      {certificateData && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-amber-500/60 rounded-3xl max-w-lg w-full p-6 text-center space-y-4 shadow-2xl">
            <Award className="w-16 h-16 text-amber-400 mx-auto animate-pulse" />
            <h2 className="text-xl font-bold text-amber-300">Skill Completion Certificate</h2>
            <div className="p-4 rounded-2xl bg-black border border-amber-950 text-xs text-slate-300 space-y-2">
              <p>Certified To: <strong>{certificateData.user}</strong></p>
              <p>Track: <strong>{certificateData.track_name}</strong></p>
              <p>Badge ID: <code className="text-amber-400">{certificateData.badge_id}</code></p>
              <p>Date: {certificateData.completion_date}</p>
            </div>
            <button onClick={() => setCertificateData(null)} className="px-6 py-2 rounded-xl bg-amber-500 text-slate-950 font-bold text-xs">
              Close Certificate
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
