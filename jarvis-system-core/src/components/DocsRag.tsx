import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  FileText, Upload, Trash2, Send, MessageSquare, ClipboardCheck,
  ShieldCheck, Loader2, Quote, X, AlertTriangle, Sparkles, BookOpen,
  Volume2, Play, CheckCircle2, Award, HelpCircle, RefreshCw, Layers,
  Mic, Terminal, Database, Square
} from "lucide-react";
import { getToken } from "../lib/auth";

interface DocItem { id: number; filename: string; pages: number; chunks: number; char_count: number; created_at?: string; }
interface JobSource { id: number; job_key: string; title: string; company: string; }
interface Citation { n: number; page: number; snippet: string; }
interface ChatTurn { role: "user" | "jarvis"; text: string; citations?: Citation[]; verified?: boolean; }

interface QuizQuestion {
  question: string;
  options: string[];
  correct_idx: number;
  explanation: string;
}

interface AudioTurn {
  speaker: string;
  text: string;
}

function Panel({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass-panel rounded-xl border border-white/5 p-5 ${className}`}>
      <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-4">{icon} {title}</h3>
      {children}
    </div>
  );
}

export default function DocsRag() {
  // Source lists
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [jobs, setJobs] = useState<JobSource[]>([]);
  
  // Selection state
  const [selectedResume, setSelectedResume] = useState<boolean>(true);
  const [selectedJobRefs, setSelectedJobRefs] = useState<string[]>([]);
  const [selectedPdfIds, setSelectedPdfIds] = useState<number[]>([]);
  
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"chat" | "study" | "quiz" | "audio" | "voice_interview" | "python_sandbox" | "vault">("chat");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Chat tab state
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Study Guide tab state
  const [studyGuide, setStudyGuide] = useState<string>("");
  const [loadingGuide, setLoadingGuide] = useState(false);

  // Quiz tab state
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);
  const [loadingQuiz, setLoadingQuiz] = useState(false);
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [submittedQuiz, setSubmittedQuiz] = useState(false);

  // Audio Overview tab state
  const [audioScript, setAudioScript] = useState<AudioTurn[]>([]);
  const [loadingAudioScript, setLoadingAudioScript] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);

  // Voice Mock Interview state
  const [interviewQuestion, setInterviewQuestion] = useState("Tell me about a challenging data pipeline you built.");
  const [recording, setRecording] = useState(false);
  const [evaluatingAudio, setEvaluatingAudio] = useState(false);
  const [voiceEvaluation, setVoiceEvaluation] = useState<any | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  // Python Code Sandbox state
  const [pyPrompt, setPyPrompt] = useState("Calculate the mean, std dev, and 95th percentile of [12, 45, 67, 89, 23, 56, 78, 90, 34, 65]");
  const [executingPy, setExecutingPy] = useState(false);
  const [pyResult, setPyResult] = useState<any | null>(null);

  // Career Portfolio Vault state
  const [vaultQuery, setVaultQuery] = useState("");
  const [vaultSearching, setVaultSearching] = useState(false);
  const [vaultSearchResult, setVaultSearchResult] = useState<string | null>(null);
  const [vaultTitle, setVaultTitle] = useState("");
  const [vaultCategory, setVaultCategory] = useState("Code Repo");
  const [vaultContent, setVaultContent] = useState("");
  const [vaultAdding, setVaultAdding] = useState(false);

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream);
      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunksRef.current, { type: "audio/wav" });
        await evaluateAudio(audioBlob);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch {
      alert("Microphone access denied or unavailable.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorderRef.current && recording) {
      mediaRecorderRef.current.stop();
      setRecording(false);
    }
  };

  const evaluateAudio = async (blob: Blob) => {
    setEvaluatingAudio(true);
    try {
      const fd = new FormData();
      fd.append("file", blob, "answer.wav");
      fd.append("question", interviewQuestion);
      fd.append("job_ref", selectedJobRefs[0] || "default");
      const res = await fetch("/api/voice-interview/evaluate", { method: "POST", body: fd });
      const data = await res.json();
      if (data.evaluation) setVoiceEvaluation(data.evaluation);
    } catch {
      alert("Audio evaluation failed.");
    } finally {
      setEvaluatingAudio(false);
    }
  };

  const runPythonExec = async () => {
    if (!pyPrompt.trim() || executingPy) return;
    setExecutingPy(true);
    try {
      const res = await fetch("/api/notebook/python-exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: pyPrompt }),
      });
      setPyResult(await res.json());
    } catch {
      setPyResult({ response: "Error executing Python sandbox query." });
    } finally {
      setExecutingPy(false);
    }
  };

  const searchVault = async () => {
    if (!vaultQuery.trim() || vaultSearching) return;
    setVaultSearching(true);
    try {
      const res = await fetch("/api/vault/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: vaultQuery }),
      });
      const d = await res.json();
      setVaultSearchResult(d.answer || "No matching projects found.");
    } catch {
      setVaultSearchResult("Error querying vault.");
    } finally {
      setVaultSearching(false);
    }
  };

  const addVault = async () => {
    if (!vaultContent.trim() || vaultAdding) return;
    setVaultAdding(true);
    try {
      await fetch("/api/vault/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: vaultTitle || "Project", category: vaultCategory, content: vaultContent }),
      });
      alert("Project added to Career Vault!");
      setVaultTitle("");
      setVaultContent("");
    } catch {
      alert("Failed to add project.");
    } finally {
      setVaultAdding(false);
    }
  };

  const loadSources = useCallback(async () => {
    try {
      const d = await fetch("/api/pdf-rag/docs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      if (d?.documents) {
        setDocs(d.documents);
        if (d.documents.length > 0 && selectedPdfIds.length === 0) {
          setSelectedPdfIds([d.documents[0].id]);
        }
      }
    } catch { /* keep last */ }

    try {
      const j = await fetch("/applications", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      if (j?.applications) {
        setJobs(j.applications);
        if (j.applications.length > 0 && selectedJobRefs.length === 0) {
          const firstRef = j.applications[0].job_key || `app:${j.applications[0].id}`;
          setSelectedJobRefs([firstRef]);
        }
      }
    } catch { /* keep last */ }
  }, []);

  useEffect(() => { loadSources(); }, [loadSources]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, asking]);

  const getSourcePayload = () => ({
    resume: selectedResume,
    job_refs: selectedJobRefs,
    pdf_ids: selectedPdfIds,
  });

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setError("Only PDF files are supported."); return; }
    setUploading(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pdf-rag/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok || d.error) { setError(d.error || `Upload failed (${res.status}).`); }
      else {
        await loadSources();
        if (d.document?.id) {
          setSelectedPdfIds((prev) => [...prev, d.document.id]);
        }
      }
    } catch (e) { setError(`Upload failed: ${e instanceof Error ? e.message : e}`); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeDoc = async (id: number) => {
    if (!confirm("Remove this document and its index?")) return;
    try {
      await fetch(`/api/pdf-rag/${id}`, { method: "DELETE" });
      setSelectedPdfIds((prev) => prev.filter((p) => p !== id));
      await loadSources();
    } catch { /* */ }
  };

  const toggleJobSelect = (ref: string) => {
    setSelectedJobRefs((prev) =>
      prev.includes(ref) ? prev.filter((r) => r !== ref) : [...prev, ref]
    );
  };

  const togglePdfSelect = (id: number) => {
    setSelectedPdfIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  // Tab 1: Chat
  const ask = async () => {
    const q = question.trim();
    if (!q || asking) return;
    setQuestion("");
    setTurns((t) => [...t, { role: "user", text: q }]);
    setAsking(true);
    try {
      const res = await fetch("/api/notebook/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: q, sources: getSourcePayload() }),
      });
      const d = await res.json();
      setTurns((t) => [...t, { role: "jarvis", text: d.reply || "—" }]);
    } catch {
      setTurns((t) => [...t, { role: "jarvis", text: "Couldn't reach the notebook engine just now." }]);
    } finally { setAsking(false); }
  };

  // Tab 2: Study Guide
  const generateStudyGuide = async () => {
    setLoadingGuide(true);
    try {
      const res = await fetch("/api/notebook/study-guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: getSourcePayload() }),
      });
      const d = await res.json();
      setStudyGuide(d.study_guide || "Failed to generate study guide.");
    } catch {
      setStudyGuide("Error reaching the notebook engine.");
    } finally { setLoadingGuide(false); }
  };

  // Tab 3: Quiz
  const generateQuiz = async () => {
    setLoadingQuiz(true);
    setSubmittedQuiz(false);
    setUserAnswers({});
    try {
      const res = await fetch("/api/notebook/quiz", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: getSourcePayload() }),
      });
      const d = await res.json();
      setQuizQuestions(d.quiz || []);
    } catch {
      setQuizQuestions([]);
    } finally { setLoadingQuiz(false); }
  };

  // Tab 4: Audio Overview Script
  const generateAudioOverview = async () => {
    setLoadingAudioScript(true);
    try {
      const res = await fetch("/api/notebook/audio-overview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sources: getSourcePayload() }),
      });
      const d = await res.json();
      setAudioScript(d.script || []);
    } catch {
      setAudioScript([]);
    } finally { setLoadingAudioScript(false); }
  };

  // Audio Playback with Gemini TTS
  const playLineAudio = async (text: string, voice: string = "Charon", index: number) => {
    if (playingIndex !== null) return;
    setPlayingIndex(index);
    try {
      const res = await fetch("/api/notebook/speak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) throw new Error("Audio synthesis failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => setPlayingIndex(null);
      audio.onerror = () => setPlayingIndex(null);
      audio.play();
    } catch {
      setPlayingIndex(null);
    }
  };

  const activeSourcesCount = (selectedResume ? 1 : 0) + selectedJobRefs.length + selectedPdfIds.length;

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
            <span className="opacity-40 font-light text-xl">03 //</span> JARVIS NOTEBOOKS
          </h1>
          <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
            Multi-source intelligence · Study Guides · Practice Quizzes · Audio Overviews
          </p>
        </div>

        {/* NotebookLM Markdown Export Button */}
        {selectedPdfIds.length > 0 && (
          <button
            onClick={() => {
              const tok = getToken();
              const docId = selectedPdfIds[0];
              const path = `/api/pdf-rag/${docId}/notebooklm`;
              const url = tok ? `${path}?token=${encodeURIComponent(tok)}` : path;
              window.open(url, "_blank");
            }}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-mono font-bold bg-[#c084fc]/15 border border-[#c084fc]/40 text-[#c084fc] hover:bg-[#c084fc] hover:text-[#0a0e1a] transition-all cursor-pointer shadow-lg"
            title="Download full document pack formatted for Google NotebookLM"
          >
            <BookOpen className="w-4 h-4" /> NOTEBOOKLM SOURCE PACK
          </button>
        )}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Sidebar: Multi-Source Manager */}
        <div className="space-y-6">
          <Panel title="Active Sources" icon={<Layers className="w-4 h-4" />}>
            <div className="space-y-4">
              {/* 1. Master Resume Source */}
              <div
                onClick={() => setSelectedResume(!selectedResume)}
                className={`flex items-center justify-between rounded-lg border p-3 cursor-pointer transition-all ${
                  selectedResume ? "border-[#8aebff]/40 bg-[#8aebff]/10" : "border-white/5 bg-white/[0.02]"
                }`}
              >
                <div className="flex items-center gap-2">
                  <FileText className={`w-4 h-4 ${selectedResume ? "text-[#8aebff]" : "text-[#859397]"}`} />
                  <div>
                    <div className="text-[12px] font-mono text-[#dfe2f3] font-bold">Master Résumé</div>
                    <div className="text-[9px] font-mono text-[#859397]">Core Candidate Profile</div>
                  </div>
                </div>
                <input type="checkbox" checked={selectedResume} onChange={() => {}} className="accent-[#8aebff] pointer-events-none" />
              </div>

              {/* 2. Target Job Descriptions */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#859397] mb-2 font-bold">
                  Kanban Jobs ({selectedJobRefs.length} selected)
                </div>
                <div className="space-y-1.5 max-h-40 overflow-y-auto custom-scrollbar">
                  {jobs.length === 0 ? (
                    <p className="text-[11px] font-mono text-[#859397]">No tracked jobs yet.</p>
                  ) : (
                    jobs.map((j) => {
                      const ref = j.job_key || `app:${j.id}`;
                      const isSel = selectedJobRefs.includes(ref);
                      return (
                        <div
                          key={j.id}
                          onClick={() => toggleJobSelect(ref)}
                          className={`flex items-center justify-between rounded-md border p-2 cursor-pointer transition-all ${
                            isSel ? "border-[#a3e635]/40 bg-[#a3e635]/10" : "border-white/5 bg-white/[0.02]"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="text-[11px] font-mono text-[#dfe2f3] truncate font-semibold">{j.title}</div>
                            <div className="text-[9px] font-mono text-[#859397] truncate">{j.company}</div>
                          </div>
                          <input type="checkbox" checked={isSel} onChange={() => {}} className="accent-[#a3e635] pointer-events-none" />
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* 3. Uploaded PDFs */}
              <div>
                <div className="text-[10px] font-mono uppercase tracking-widest text-[#859397] mb-2 font-bold flex justify-between items-center">
                  <span>PDF Documents ({selectedPdfIds.length} selected)</span>
                </div>

                <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
                <button onClick={() => fileRef.current?.click()} disabled={uploading}
                  className="w-full mb-3 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-xs font-semibold font-mono border border-dashed border-[#8aebff]/30 bg-[#8aebff]/5 text-[#8aebff] hover:bg-[#8aebff]/10 transition-all cursor-pointer disabled:opacity-50">
                  {uploading ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> INDEXING…</> : <><Upload className="w-3.5 h-3.5" /> UPLOAD PDF</>}
                </button>

                {error && (
                  <div className="mb-3 flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab] bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg p-2">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{error}</span>
                  </div>
                )}

                <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar">
                  {docs.length === 0 ? (
                    <p className="text-[11px] font-mono text-[#859397] text-center py-2">No PDFs uploaded.</p>
                  ) : (
                    docs.map((d) => {
                      const isSel = selectedPdfIds.includes(d.id);
                      return (
                        <div
                          key={d.id}
                          onClick={() => togglePdfSelect(d.id)}
                          className={`group flex items-center justify-between rounded-md border p-2 cursor-pointer transition-all ${
                            isSel ? "border-[#c084fc]/40 bg-[#c084fc]/10" : "border-white/5 bg-white/[0.02]"
                          }`}
                        >
                          <div className="min-w-0 flex-1 pr-2">
                            <div className="text-[11px] font-mono text-[#dfe2f3] truncate" title={d.filename}>{d.filename}</div>
                            <div className="text-[9px] font-mono text-[#859397]">{d.pages} p · {d.chunks} chunks</div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); removeDoc(d.id); }}
                              className="p-1 rounded text-[#859397] hover:text-[#ffb4ab] opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                              title="Remove PDF"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                            <input type="checkbox" checked={isSel} onChange={() => {}} className="accent-[#c084fc] pointer-events-none" />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Status bar */}
              <div className="pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-[#8aebff]/80">
                <span>Active Context:</span>
                <span className="font-bold">{activeSourcesCount} source(s) linked</span>
              </div>
            </div>
          </Panel>
        </div>

        {/* Right Main Area: 4 Interactive Notebook Tabs */}
        <div className="lg:col-span-2">
          <div className="glass-panel rounded-xl border border-white/5 overflow-hidden flex flex-col" style={{ minHeight: 520 }}>
            {/* Navigation Tabs */}
            <div className="flex items-center border-b border-white/5 bg-black/20 overflow-x-auto">
              {[
                ["chat", "CHAT", <MessageSquare className="w-4 h-4" key="c" />],
                ["study", "STUDY GUIDE", <BookOpen className="w-4 h-4" key="s" />],
                ["quiz", "PRACTICE QUIZ", <Award className="w-4 h-4" key="q" />],
                ["audio", "AUDIO OVERVIEW", <Volume2 className="w-4 h-4" key="a" />],
                ["voice_interview", "MOCK INTERVIEW", <Mic className="w-4 h-4" key="vi" />],
                ["python_sandbox", "PYTHON SANDBOX", <Terminal className="w-4 h-4" key="ps" />],
                ["vault", "CAREER VAULT", <Database className="w-4 h-4" key="v" />],
              ].map(([id, label, icon]) => (
                <button
                  key={id}
                  onClick={() => setTab(id as any)}
                  className={`flex items-center gap-2 px-5 py-3 text-xs font-mono font-bold tracking-widest transition-all cursor-pointer whitespace-nowrap ${
                    tab === id
                      ? "text-[#8aebff] border-b-2 border-[#8aebff] bg-[#8aebff]/5"
                      : "text-[#859397] hover:text-[#dfe2f3]"
                  }`}
                >
                  {icon} {label}
                </button>
              ))}
            </div>

            {/* TAB 1: Multi-Source Chat */}
            {tab === "chat" && (
              <div className="flex flex-col flex-1">
                <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: 460 }}>
                  {turns.length === 0 && (
                    <div className="text-center py-12 space-y-3">
                      <Sparkles className="w-8 h-8 text-[#8aebff]/40 mx-auto" />
                      <p className="text-sm text-[#dfe2f3] font-mono">Ask anything across your {activeSourcesCount} active source(s).</p>
                      <p className="text-[11px] font-mono text-[#859397] max-w-md mx-auto">
                        Queries automatically pull from your Master Résumé, selected Job Specs, and uploaded PDFs.
                      </p>
                    </div>
                  )}
                  {turns.map((t, i) => (
                    <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                      <div className={`max-w-[85%] rounded-xl px-4 py-3 ${t.role === "user" ? "bg-[#8aebff]/10 border border-[#8aebff]/20" : "bg-white/[0.03] border border-white/5"}`}>
                        <p className="text-sm text-[#dfe2f3] whitespace-pre-wrap leading-relaxed">{t.text}</p>
                      </div>
                    </div>
                  ))}
                  {asking && (
                    <div className="flex justify-start">
                      <div className="rounded-xl px-4 py-2.5 bg-white/[0.03] border border-white/5 text-[#859397] text-sm flex items-center gap-2">
                        <Loader2 className="w-4 h-4 animate-spin text-[#8aebff]" /> Synthesizing across active sources…
                      </div>
                    </div>
                  )}
                </div>
                <div className="border-t border-white/5 p-3 flex items-center gap-2">
                  <input
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                    placeholder={`Ask across ${activeSourcesCount} active source(s)...`}
                    disabled={asking || activeSourcesCount === 0}
                    className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40"
                  />
                  <button
                    onClick={ask}
                    disabled={asking || !question.trim() || activeSourcesCount === 0}
                    className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-40"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}

            {/* TAB 2: AI Study Guide */}
            {tab === "study" && (
              <div className="p-5 flex flex-col flex-1 overflow-y-auto space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div>
                    <h3 className="text-sm font-bold font-mono text-[#dfe2f3]">Notebook Study Guide & Cheat Sheet</h3>
                    <p className="text-[11px] font-mono text-[#859397]">Synthesize key requirements, interview traps, and a 3-day roadmap from active sources.</p>
                  </div>
                  <button
                    onClick={generateStudyGuide}
                    disabled={loadingGuide || activeSourcesCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-40"
                  >
                    {loadingGuide ? <><Loader2 className="w-4 h-4 animate-spin" /> GENERATING…</> : <><Sparkles className="w-4 h-4" /> GENERATE STUDY GUIDE</>}
                  </button>
                </div>

                {studyGuide ? (
                  <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 font-mono text-xs text-[#dfe2f3] leading-relaxed whitespace-pre-wrap overflow-y-auto max-h-[420px]">
                    {studyGuide}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-16 gap-3 text-[#859397]">
                    <BookOpen className="w-10 h-10 text-[#8aebff]/30" />
                    <p className="text-xs font-mono">Click "Generate Study Guide" to create your interview preparation sheet.</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Interactive Practice Quiz */}
            {tab === "quiz" && (
              <div className="p-5 flex flex-col flex-1 overflow-y-auto space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div>
                    <h3 className="text-sm font-bold font-mono text-[#dfe2f3]">Interactive Practice Quiz</h3>
                    <p className="text-[11px] font-mono text-[#859397]">Test your technical skills and job knowledge against active sources.</p>
                  </div>
                  <button
                    onClick={generateQuiz}
                    disabled={loadingQuiz || activeSourcesCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-mono bg-[#a3e635] hover:bg-[#bef264] text-[#0a0e1a] cursor-pointer disabled:opacity-40"
                  >
                    {loadingQuiz ? <><Loader2 className="w-4 h-4 animate-spin" /> GENERATING…</> : <><Award className="w-4 h-4" /> GENERATE QUIZ</>}
                  </button>
                </div>

                {quizQuestions.length > 0 ? (
                  <div className="space-y-6 max-h-[420px] overflow-y-auto pr-1">
                    {quizQuestions.map((q, qIdx) => {
                      const userSel = userAnswers[qIdx];
                      const isCorrect = userSel === q.correct_idx;
                      return (
                        <div key={qIdx} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3 font-mono">
                          <div className="text-xs font-bold text-[#dfe2f3] flex items-start gap-2">
                            <span className="text-[#8aebff]">Q{qIdx + 1}.</span>
                            <span>{q.question}</span>
                          </div>

                          <div className="space-y-2 pl-4">
                            {q.options.map((opt, oIdx) => {
                              let optCls = "border-white/5 bg-white/[0.02] text-[#dfe2f3]";
                              if (userSel === oIdx) {
                                optCls = submittedQuiz
                                  ? oIdx === q.correct_idx ? "border-[#a3e635]/60 bg-[#a3e635]/20 text-[#a3e635]" : "border-[#ffb4ab]/60 bg-[#ffb4ab]/20 text-[#ffb4ab]"
                                  : "border-[#8aebff]/60 bg-[#8aebff]/20 text-[#8aebff]";
                              } else if (submittedQuiz && oIdx === q.correct_idx) {
                                optCls = "border-[#a3e635]/60 bg-[#a3e635]/10 text-[#a3e635]";
                              }

                              return (
                                <div
                                  key={oIdx}
                                  onClick={() => !submittedQuiz && setUserAnswers((prev) => ({ ...prev, [qIdx]: oIdx }))}
                                  className={`p-2.5 rounded-lg border text-xs cursor-pointer transition-all flex items-center justify-between ${optCls}`}
                                >
                                  <span>{opt}</span>
                                  {userSel === oIdx && <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />}
                                </div>
                              );
                            })}
                          </div>

                          {submittedQuiz && (
                            <div className={`p-3 rounded-lg border text-[11px] leading-relaxed ${isCorrect ? "bg-[#a3e635]/5 border-[#a3e635]/20 text-[#a3e635]" : "bg-[#ffb4ab]/5 border-[#ffb4ab]/20 text-[#ffb4ab]"}`}>
                              <span className="font-bold">{isCorrect ? "✓ Correct! " : "✗ Incorrect. "}</span>
                              {q.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}

                    {!submittedQuiz && (
                      <button
                        onClick={() => setSubmittedQuiz(true)}
                        className="w-full py-3 rounded-lg text-xs font-bold font-mono bg-[#8aebff] text-[#00363e] hover:bg-[#22d3ee] cursor-pointer"
                      >
                        SUBMIT ANSWERS & SCORE
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-16 gap-3 text-[#859397]">
                    <HelpCircle className="w-10 h-10 text-[#a3e635]/30" />
                    <p className="text-xs font-mono">Click "Generate Quiz" to build a 5-question test from active sources.</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 4: Audio Overview (Script + Gemini TTS Playback) */}
            {tab === "audio" && (
              <div className="p-5 flex flex-col flex-1 overflow-y-auto space-y-4">
                <div className="flex items-center justify-between border-b border-white/5 pb-3">
                  <div>
                    <h3 className="text-sm font-bold font-mono text-[#dfe2f3]">Audio Overview Briefing</h3>
                    <p className="text-[11px] font-mono text-[#859397]">Two-host dialogue podcast script powered by Gemini natural TTS.</p>
                  </div>
                  <button
                    onClick={generateAudioOverview}
                    disabled={loadingAudioScript || activeSourcesCount === 0}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-mono bg-[#c084fc] hover:bg-[#d8b4fe] text-[#3b0764] cursor-pointer disabled:opacity-40"
                  >
                    {loadingAudioScript ? <><Loader2 className="w-4 h-4 animate-spin" /> GENERATING…</> : <><Volume2 className="w-4 h-4" /> GENERATE AUDIO BRIEFING</>}
                  </button>
                </div>

                {audioScript.length > 0 ? (
                  <div className="space-y-4 max-h-[420px] overflow-y-auto pr-1 font-mono">
                    {audioScript.map((turn, idx) => {
                      const isJarvis = turn.speaker.toUpperCase().includes("JARVIS");
                      const isPlaying = playingIndex === idx;
                      return (
                        <div
                          key={idx}
                          className={`p-4 rounded-xl border flex flex-col gap-2 ${
                            isJarvis ? "bg-[#8aebff]/5 border-[#8aebff]/20" : "bg-[#c084fc]/5 border-[#c084fc]/20"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${isJarvis ? "text-[#8aebff]" : "text-[#c084fc]"}`}>
                              🎙️ {turn.speaker}
                            </span>
                            <button
                              onClick={() => playLineAudio(turn.text, isJarvis ? "Charon" : "Aoede", idx)}
                              disabled={isPlaying}
                              className="px-2.5 py-1 rounded bg-white/10 hover:bg-white/20 text-[10px] text-[#dfe2f3] flex items-center gap-1 cursor-pointer disabled:opacity-50"
                            >
                              {isPlaying ? <Loader2 className="w-3 h-3 animate-spin text-[#8aebff]" /> : <Play className="w-3 h-3 text-[#a3e635]" />}
                              <span>{isPlaying ? "SPEAKING…" : "PLAY VOICE"}</span>
                            </button>
                          </div>
                          <p className="text-xs text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">{turn.text}</p>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex-1 flex flex-col items-center justify-center text-center py-16 gap-3 text-[#859397]">
                    <Volume2 className="w-10 h-10 text-[#c084fc]/30" />
                    <p className="text-xs font-mono">Click "Generate Audio Briefing" to synthesize a podcast overview with voice playback.</p>
                  </div>
                )}
              </div>
            )}

            {/* TAB 5: Voice Mock Interview Room */}
            {tab === "voice_interview" && (
              <div className="p-5 flex flex-col flex-1 overflow-y-auto space-y-4 font-mono">
                <div className="border-b border-white/5 pb-3">
                  <h3 className="text-sm font-bold text-[#dfe2f3] flex items-center gap-2">
                    <Mic className="w-4 h-4 text-[#ffb4ab]" /> Voice Mock Interview Practice Room
                  </h3>
                  <p className="text-[11px] text-[#859397]">
                    Record your verbal answer. Gemini Audio evaluates STAR structure, speech pace, and filler words.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] uppercase font-bold text-[#8aebff]">Interview Question:</label>
                  <input
                    value={interviewQuestion}
                    onChange={(e) => setInterviewQuestion(e.target.value)}
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-2.5 text-xs text-[#dfe2f3]"
                  />

                  <div className="flex items-center gap-3">
                    {!recording ? (
                      <button
                        onClick={startRecording}
                        className="px-4 py-2 rounded-lg text-xs font-bold bg-[#ffb4ab] text-[#0a0e1a] hover:bg-[#ff8a7a] flex items-center gap-2 cursor-pointer"
                      >
                        <Mic className="w-4 h-4" /> START RECORDING
                      </button>
                    ) : (
                      <button
                        onClick={stopRecording}
                        className="px-4 py-2 rounded-lg text-xs font-bold bg-red-600 text-white animate-pulse flex items-center gap-2 cursor-pointer"
                      >
                        <Square className="w-4 h-4" /> STOP & SUBMIT FOR SCORING
                      </button>
                    )}
                  </div>

                  {evaluatingAudio && (
                    <div className="p-4 rounded-xl bg-white/[0.03] border border-white/5 text-xs text-[#8aebff] flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" /> Analyzing raw audio recording & speech metrics…
                    </div>
                  )}

                  {voiceEvaluation && (
                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-2xl font-extrabold text-[#5eead4]">{voiceEvaluation.star_score}% STAR SCORE</span>
                        <span className="px-2.5 py-1 rounded bg-[#8aebff]/10 text-[10px] text-[#8aebff] border border-[#8aebff]/20">
                          {voiceEvaluation.tone_rating}
                        </span>
                      </div>

                      <div className="text-xs text-[#dfe2f3] space-y-1">
                        <div><strong>Pacing:</strong> {voiceEvaluation.pacing_feedback}</div>
                        <div><strong>Filler Words Count:</strong> {voiceEvaluation.filler_words_count}</div>
                      </div>

                      {voiceEvaluation.strengths && (
                        <div className="text-[11px] text-[#5eead4] space-y-0.5">
                          <strong>Strengths:</strong>
                          {voiceEvaluation.strengths.map((s: string, idx: number) => (
                            <div key={idx}>✓ {s}</div>
                          ))}
                        </div>
                      )}

                      {voiceEvaluation.improvements && (
                        <div className="text-[11px] text-[#ffd6a3] space-y-0.5">
                          <strong>Improvement Areas:</strong>
                          {voiceEvaluation.improvements.map((imp: string, idx: number) => (
                            <div key={idx}>• {imp}</div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 6: Python Code Execution Sandbox */}
            {tab === "python_sandbox" && (
              <div className="p-5 flex flex-col flex-1 overflow-y-auto space-y-4 font-mono">
                <div className="border-b border-white/5 pb-3">
                  <h3 className="text-sm font-bold text-[#dfe2f3] flex items-center gap-2">
                    <Terminal className="w-4 h-4 text-[#5eead4]" /> Live Python Data Sandbox
                  </h3>
                  <p className="text-[11px] text-[#859397]">
                    Gemini Code Execution: writes and executes Python code dynamically to solve data queries.
                  </p>
                </div>

                <div className="space-y-3">
                  <textarea
                    rows={3}
                    value={pyPrompt}
                    onChange={(e) => setPyPrompt(e.target.value)}
                    placeholder="Enter mathematical or statistical query for Python execution..."
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-3 text-xs text-[#dfe2f3] resize-none"
                  />
                  <button
                    onClick={runPythonExec}
                    disabled={executingPy}
                    className="px-4 py-2 rounded-lg text-xs font-bold bg-[#5eead4] text-[#00363e] hover:bg-[#2dd4bf] cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {executingPy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />} EXECUTE PYTHON CODE
                  </button>

                  {pyResult && (
                    <div className="space-y-3">
                      {pyResult.code && (
                        <div className="p-3 bg-[#0a0e1a]/80 rounded-lg border border-white/10 text-[11px] text-[#8aebff]">
                          <div className="text-[9px] uppercase font-bold text-[#859397] mb-1">Executed Python Code:</div>
                          <pre className="whitespace-pre-wrap">{pyResult.code}</pre>
                        </div>
                      )}
                      {pyResult.output && (
                        <div className="p-3 bg-black/60 rounded-lg border border-[#a3e635]/30 text-[11px] text-[#a3e635]">
                          <div className="text-[9px] uppercase font-bold text-[#a3e635] mb-1">Console Output:</div>
                          <pre className="whitespace-pre-wrap">{pyResult.output}</pre>
                        </div>
                      )}
                      {pyResult.response && (
                        <div className="p-3 bg-white/[0.02] rounded-lg border border-white/5 text-xs text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">
                          {pyResult.response}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 7: Career Portfolio Vault */}
            {tab === "vault" && (
              <div className="p-5 flex flex-col flex-1 overflow-y-auto space-y-5 font-mono">
                <div className="border-b border-white/5 pb-3">
                  <h3 className="text-sm font-bold text-[#dfe2f3] flex items-center gap-2">
                    <Database className="w-4 h-4 text-[#ffd6a3]" /> Lifetime Career Portfolio Vault
                  </h3>
                  <p className="text-[11px] text-[#859397]">
                    Gemini 1M+ Token Context: Index past repositories, design docs & performance reviews.
                  </p>
                </div>

                {/* Add Item to Vault */}
                <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 space-y-3">
                  <h4 className="text-xs font-bold text-[#ffd6a3]">Add Project to Lifetime Vault</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      placeholder="Project Title (e.g. WASM Data Profiler)"
                      value={vaultTitle}
                      onChange={(e) => setVaultTitle(e.target.value)}
                      className="bg-[#0a0e1a]/60 border border-white/10 rounded p-2 text-xs text-[#dfe2f3]"
                    />
                    <select
                      value={vaultCategory}
                      onChange={(e) => setVaultCategory(e.target.value)}
                      className="bg-[#0a0e1a]/60 border border-white/10 rounded p-2 text-xs text-[#dfe2f3]"
                    >
                      <option value="Code Repo">Code Repo</option>
                      <option value="Architecture Spec">Architecture Spec</option>
                      <option value="Performance Review">Performance Review</option>
                    </select>
                  </div>
                  <textarea
                    rows={3}
                    placeholder="Paste project code, README, or design documentation..."
                    value={vaultContent}
                    onChange={(e) => setVaultContent(e.target.value)}
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded p-2.5 text-xs text-[#dfe2f3] resize-none"
                  />
                  <button
                    onClick={addVault}
                    disabled={vaultAdding || !vaultContent.trim()}
                    className="px-3 py-1.5 rounded text-xs font-bold bg-[#ffd6a3] text-[#0a0e1a] hover:bg-[#ffc078] cursor-pointer disabled:opacity-50"
                  >
                    ADD TO VAULT
                  </button>
                </div>

                {/* Search Vault */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-[#8aebff]">Search Vault for JD Skill Gaps</h4>
                  <div className="flex gap-2">
                    <input
                      placeholder="e.g. Apache Airflow pipeline or WASM data profiling..."
                      value={vaultQuery}
                      onChange={(e) => setVaultQuery(e.target.value)}
                      className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded p-2.5 text-xs text-[#dfe2f3]"
                    />
                    <button
                      onClick={searchVault}
                      disabled={vaultSearching || !vaultQuery.trim()}
                      className="px-4 py-2.5 rounded text-xs font-bold bg-[#8aebff] text-[#00363e] hover:bg-[#22d3ee] cursor-pointer disabled:opacity-50 flex items-center gap-1"
                    >
                      {vaultSearching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} SEARCH
                    </button>
                  </div>

                  {vaultSearchResult && (
                    <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">
                      {vaultSearchResult}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
