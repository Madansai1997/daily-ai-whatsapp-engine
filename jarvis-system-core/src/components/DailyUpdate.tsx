import { useEffect, useState } from "react";
import {
  BookOpen, Sparkles, Code2, HelpCircle, CheckCircle2, XCircle,
  Flame, Settings, Sliders, ChevronRight, ChevronLeft, Volume2,
  VolumeX, RefreshCw, Trophy, Lightbulb, Play, RotateCcw
} from "lucide-react";
import { getToken } from "../lib/auth";

interface LessonData {
  ok: boolean;
  track_key: string;
  topic: string;
  streak: number;
  slide1_story: {
    title: string;
    analogy: string;
  };
  slide2_visual: {
    title: string;
    mermaid_diagram: string;
    handwritten_code_title: string;
    code_snippet: string;
  };
  slide3_quiz: {
    question: string;
    options: string[];
    correct_index: number;
    explanation: string;
  };
}

interface TrackInfo {
  key: string;
  name: string;
  description: string;
  total: number;
}

export default function DailyUpdate() {
  const [activeSlide, setActiveSlide] = useState<number>(1);
  const [lesson, setLesson] = useState<LessonData | null>(null);
  const [tracks, setTracks] = useState<TrackInfo[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Settings State
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [topicsPerDay, setTopicsPerDay] = useState<number>(1);
  const [selectedTrack, setSelectedTrack] = useState<string>("ai_engineering");
  const [theme, setTheme] = useState<string>("chalkboard");
  const [audioEnabled, setAudioEnabled] = useState<boolean>(true);
  const [isPlayingAudio, setIsPlayingAudio] = useState<boolean>(false);

  // Quiz State
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);
  const [isCorrect, setIsCorrect] = useState<boolean | null>(null);
  const [streak, setStreak] = useState<number>(5);

  useEffect(() => {
    fetchLessonAndSettings();
  }, [selectedTrack]);

  const fetchLessonAndSettings = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      
      // Fetch Tracks
      const tracksRes = await fetch("/api/study/tracks", { headers });
      const tracksData = await tracksRes.json();
      if (tracksData.ok && tracksData.tracks) {
        setTracks(tracksData.tracks);
      }

      // Fetch Settings
      const settingsRes = await fetch("/api/study/settings", { headers });
      const settingsData = await settingsRes.json();
      if (settingsData.ok && settingsData.settings) {
        setTopicsPerDay(settingsData.settings.topics_per_day);
        setSelectedTrack(settingsData.settings.active_track);
        setTheme(settingsData.settings.theme);
        setAudioEnabled(settingsData.settings.audio_enabled);
      }

      // Fetch Interactive Lesson
      const lessonRes = await fetch(`/api/study/interactive-lesson?track_key=${selectedTrack}`, { headers });
      const lessonData = await lessonRes.json();
      if (lessonData.ok) {
        setLesson(lessonData);
        setStreak(lessonData.streak || 5);
      }
    } catch (err) {
      console.error("Failed to load study data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSettings = async () => {
    try {
      await fetch("/api/study/settings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          topics_per_day: topicsPerDay,
          active_track: selectedTrack,
          theme,
          audio_enabled: audioEnabled
        })
      });
      setShowSettings(false);
      fetchLessonAndSettings();
    } catch (err) {
      console.error("Failed to update settings:", err);
    }
  };

  const handleQuizSubmit = async (optionIdx: number) => {
    if (quizSubmitted || !lesson) return;
    setSelectedOption(optionIdx);
    setQuizSubmitted(true);

    const correct = optionIdx === lesson.slide3_quiz.correct_index;
    setIsCorrect(correct);

    if (correct) {
      setStreak((prev) => prev + 1);
    }

    try {
      await fetch("/api/study/quiz/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${getToken()}`
        },
        body: JSON.stringify({
          topic: lesson.topic,
          selected_option: lesson.slide3_quiz.options[optionIdx],
          correct_index: lesson.slide3_quiz.correct_index,
          chosen_index: optionIdx
        })
      });
    } catch (err) {
      console.error("Failed to record quiz score:", err);
    }
  };

  const handleAudioToggle = () => {
    setIsPlayingAudio(!isPlayingAudio);
    if (!isPlayingAudio) {
      const utterance = new SpeechSynthesisUtterance(
        `Today's topic is ${lesson?.topic}. ${lesson?.slide1_story.title}. ${lesson?.slide1_story.analogy}`
      );
      utterance.onend = () => setIsPlayingAudio(false);
      window.speechSynthesis.speak(utterance);
    } else {
      window.speechSynthesis.cancel();
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-cyan-400">
        <RefreshCw className="w-10 h-10 animate-spin mb-4" />
        <p className="text-lg font-medium">Preparing JARVIS Interactive Academy...</p>
      </div>
    );
  }

  // Theme styling configurations
  const themeStyles = {
    chalkboard: "bg-[#121820] text-emerald-100 border-emerald-900/40 font-sans",
    notebook: "bg-[#fdfcf7] text-slate-800 border-amber-200 font-sans shadow-xl",
    dark_cyber: "bg-[#0b0f19] text-cyan-100 border-cyan-900/40 font-mono shadow-2xl"
  }[theme] || "bg-[#121820] text-emerald-100 border-emerald-900/40";

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      {/* Import Handwritten Fonts */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Architects+Daughter&family=Caveat:wght@600&family=Inter:wght@400;600;700&display=swap');
        .font-handwritten { font-family: 'Caveat', cursive; }
        .font-chalk { font-family: 'Architects Daughter', cursive; }
      `}</style>

      {/* Top Header & Control Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/80 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-500 text-slate-950 font-bold shadow-lg">
            <Sparkles className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              JARVIS Academy <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">ELI15 Mode</span>
            </h1>
            <p className="text-xs text-slate-400">Interactive Bite-Sized Learning • Topic: <span className="text-cyan-300 font-semibold">{lesson?.topic}</span></p>
          </div>
        </div>

        <div className="flex items-center space-x-3">
          {/* Streak Counter */}
          <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-orange-950/40 border border-orange-800/50 text-orange-400 text-sm font-semibold">
            <Flame className="w-4 h-4 fill-orange-500 text-orange-500 animate-pulse" />
            <span>{streak} Day Streak!</span>
          </div>

          {/* Audio Digest Button */}
          <button
            onClick={handleAudioToggle}
            className={`p-2.5 rounded-xl border transition-all ${
              isPlayingAudio
                ? "bg-cyan-500 text-slate-950 border-cyan-400 animate-pulse"
                : "bg-slate-800 text-slate-300 border-slate-700 hover:border-cyan-500"
            }`}
            title="Listen to Audio Summary"
          >
            {isPlayingAudio ? <Volume2 className="w-5 h-5" /> : <VolumeX className="w-5 h-5" />}
          </button>

          {/* Settings Toggle */}
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:border-slate-500 hover:text-white transition-all text-sm font-medium"
          >
            <Settings className="w-4 h-4" />
            <span>Settings</span>
          </button>
        </div>
      </div>

      {/* Practical Settings Drawer */}
      {showSettings && (
        <div className="p-6 rounded-2xl bg-slate-900 border border-cyan-900/50 space-y-6 shadow-2xl animate-in fade-in duration-200">
          <div className="flex items-center justify-between border-b border-slate-800 pb-3">
            <h3 className="text-lg font-semibold text-cyan-300 flex items-center gap-2">
              <Sliders className="w-5 h-5" /> Practical Study Settings
            </h3>
            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-white text-sm">Close</button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Learning Track Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Learning Track</label>
              <select
                value={selectedTrack}
                onChange={(e) => setSelectedTrack(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 focus:border-cyan-500 focus:outline-none text-sm"
              >
                {tracks.map((t) => (
                  <option key={t.key} value={t.key}>{t.name}</option>
                ))}
              </select>
            </div>

            {/* Topics Per Day */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Topics Per Day</label>
              <div className="flex space-x-2">
                {[1, 2].map((num) => (
                  <button
                    key={num}
                    onClick={() => setTopicsPerDay(num)}
                    className={`flex-1 py-2 rounded-xl text-sm font-semibold border transition-all ${
                      topicsPerDay === num
                        ? "bg-cyan-500 text-slate-950 border-cyan-400"
                        : "bg-slate-800 text-slate-400 border-slate-700 hover:border-slate-600"
                    }`}
                  >
                    {num} {num === 1 ? "Topic / Day" : "Topics / Day"}
                  </button>
                ))}
              </div>
            </div>

            {/* Visual Theme Selector */}
            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Visual Aesthetic Theme</label>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
                className="w-full p-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 focus:border-cyan-500 focus:outline-none text-sm"
              >
                <option value="chalkboard">🎨 Chalkboard Dark</option>
                <option value="notebook">📝 Handwritten Notebook</option>
                <option value="dark_cyber">🌙 Dark Cyber</option>
              </select>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveSettings}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-bold text-sm shadow-md hover:opacity-90 transition-all"
            >
              Save & Apply Settings
            </button>
          </div>
        </div>
      )}

      {/* 3-Slide Interactive Deck Navigation */}
      <div className="flex items-center justify-between p-2 rounded-xl bg-slate-900/60 border border-slate-800">
        <button
          disabled={activeSlide === 1}
          onClick={() => setActiveSlide((prev) => prev - 1)}
          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeSlide === 1 ? "opacity-30 cursor-not-allowed" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
          <span>Previous</span>
        </button>

        <div className="flex space-x-2">
          {[
            { id: 1, label: "1. ELI15 Story & Analogy", icon: Lightbulb },
            { id: 2, label: "2. Visual Diagram & Code", icon: Code2 },
            { id: 3, label: "3. Interactive Quiz Game", icon: HelpCircle }
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeSlide === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveSlide(tab.id)}
                className={`flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-semibold border transition-all ${
                  isActive
                    ? "bg-cyan-500/20 text-cyan-300 border-cyan-500/50 shadow-md"
                    : "bg-slate-800/40 text-slate-400 border-slate-800 hover:text-slate-200"
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        <button
          disabled={activeSlide === 3}
          onClick={() => setActiveSlide((prev) => prev + 1)}
          className={`flex items-center space-x-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
            activeSlide === 3 ? "opacity-30 cursor-not-allowed" : "bg-slate-800 text-slate-200 hover:bg-slate-700"
          }`}
        >
          <span>Next</span>
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Main Interactive Slide Arena */}
      <div className={`p-8 rounded-3xl border min-h-[420px] transition-all ${themeStyles}`}>
        {/* SLIDE 1: ELI15 Story & Analogy */}
        {activeSlide === 1 && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <Lightbulb className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-2xl font-bold font-chalk tracking-wide text-amber-300">
                  {lesson?.slide1_story.title}
                </h2>
                <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                  15-Year-Old Explanation Level
                </p>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-black/30 border border-amber-900/30 backdrop-blur-sm space-y-4">
              <p className="text-lg leading-relaxed text-slate-200 font-handwritten text-2xl">
                "{lesson?.slide1_story.analogy}"
              </p>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setActiveSlide(2)}
                className="flex items-center space-x-2 px-6 py-3 rounded-xl bg-amber-500 text-slate-950 font-bold text-sm hover:bg-amber-400 transition-all shadow-lg"
              >
                <span>See the Code & Visual Diagram</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* SLIDE 2: Visual Diagram & Handwritten Code */}
        {activeSlide === 2 && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                <Code2 className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-2xl font-bold font-chalk text-cyan-300">
                  {lesson?.slide2_visual.title}
                </h2>
                <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                  Visual Flowchart & Handwritten Code
                </p>
              </div>
            </div>

            {/* Visual Mermaid Flowchart Container */}
            <div className="p-6 rounded-2xl bg-black/40 border border-cyan-900/40 space-y-3">
              <h4 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">Visual Concept Flow</h4>
              <div className="p-4 rounded-xl bg-slate-950/80 border border-cyan-950 text-cyan-300 font-mono text-sm overflow-x-auto">
                <pre>{lesson?.slide2_visual.mermaid_diagram}</pre>
              </div>
            </div>

            {/* Handwritten Annotated Code Snippet */}
            <div className="p-6 rounded-2xl bg-black/40 border border-emerald-900/40 space-y-3">
              <h4 className="text-lg font-bold font-handwritten text-emerald-400 text-xl">
                {lesson?.slide2_visual.handwritten_code_title}
              </h4>
              <div className="p-4 rounded-xl bg-slate-950/90 border border-emerald-950 text-emerald-300 font-mono text-sm leading-relaxed overflow-x-auto">
                <pre>{lesson?.slide2_visual.code_snippet}</pre>
              </div>
            </div>

            <div className="flex justify-end pt-4">
              <button
                onClick={() => setActiveSlide(3)}
                className="flex items-center space-x-2 px-6 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold text-sm hover:bg-cyan-400 transition-all shadow-lg"
              >
                <span>Take Today's Micro-Quiz</span>
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* SLIDE 3: Interactive Quiz Game */}
        {activeSlide === 3 && (
          <div className="space-y-6 animate-in fade-in duration-300">
            <div className="flex items-center space-x-3">
              <div className="p-3 rounded-2xl bg-purple-500/20 text-purple-400 border border-purple-500/30">
                <HelpCircle className="w-8 h-8" />
              </div>
              <div>
                <h2 className="text-2xl font-bold font-chalk text-purple-300">
                  Today's Micro-Quiz Challenge 🎮
                </h2>
                <p className="text-xs text-slate-400 uppercase tracking-widest font-semibold mt-0.5">
                  Test Your Knowledge • Earn Streak Points
                </p>
              </div>
            </div>

            <div className="p-6 rounded-2xl bg-black/30 border border-purple-900/30 space-y-4">
              <h3 className="text-lg font-semibold text-slate-100">
                {lesson?.slide3_quiz.question}
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2">
                {lesson?.slide3_quiz.options.map((option, idx) => {
                  const isSelected = selectedOption === idx;
                  const isCorrectOption = idx === lesson.slide3_quiz.correct_index;

                  let btnStyle = "bg-slate-900/80 text-slate-200 border-slate-800 hover:border-purple-500/50";
                  if (quizSubmitted) {
                    if (isCorrectOption) {
                      btnStyle = "bg-emerald-950/80 text-emerald-300 border-emerald-500 font-bold shadow-lg";
                    } else if (isSelected && !isCorrectOption) {
                      btnStyle = "bg-rose-950/80 text-rose-300 border-rose-500 font-bold";
                    }
                  }

                  return (
                    <button
                      key={idx}
                      disabled={quizSubmitted}
                      onClick={() => handleQuizSubmit(idx)}
                      className={`p-4 rounded-xl text-left text-sm border transition-all flex items-center justify-between ${btnStyle}`}
                    >
                      <span>{option}</span>
                      {quizSubmitted && isCorrectOption && <CheckCircle2 className="w-5 h-5 text-emerald-400" />}
                      {quizSubmitted && isSelected && !isCorrectOption && <XCircle className="w-5 h-5 text-rose-400" />}
                    </button>
                  );
                })}
              </div>

              {/* Quiz Feedback & Explanation Box */}
              {quizSubmitted && (
                <div className={`p-4 rounded-xl border mt-4 animate-in fade-in duration-200 ${
                  isCorrect ? "bg-emerald-950/40 border-emerald-800/60 text-emerald-200" : "bg-rose-950/40 border-rose-800/60 text-rose-200"
                }`}>
                  <div className="flex items-center space-x-2 font-bold mb-1">
                    {isCorrect ? <Trophy className="w-5 h-5 text-yellow-400" /> : <Lightbulb className="w-5 h-5 text-rose-400" />}
                    <span>{isCorrect ? "🎉 Correct Answer! Streak +1 Day!" : "💡 Close Try! Here is why:"}</span>
                  </div>
                  <p className="text-xs leading-relaxed opacity-90">{lesson?.slide3_quiz.explanation}</p>
                </div>
              )}
            </div>

            <div className="flex justify-between items-center pt-2">
              <button
                onClick={() => {
                  setSelectedOption(null);
                  setQuizSubmitted(false);
                  setIsCorrect(null);
                }}
                className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-800 text-slate-300 border border-slate-700 hover:bg-slate-700 text-xs font-semibold"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Quiz</span>
              </button>

              <button
                onClick={() => setActiveSlide(1)}
                className="flex items-center space-x-2 px-6 py-2.5 rounded-xl bg-purple-500 text-slate-950 font-bold text-sm hover:bg-purple-400 transition-all shadow-lg"
              >
                <span>Review Story Again</span>
                <RotateCcw className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
