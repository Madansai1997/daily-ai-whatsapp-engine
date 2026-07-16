import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  FileText, Upload, Trash2, Send, MessageSquare, ClipboardCheck,
  ShieldCheck, Loader2, Quote, X, AlertTriangle,
} from "lucide-react";

interface DocItem { id: number; filename: string; pages: number; chunks: number; char_count: number; created_at?: string; }
interface Citation { n: number; page: number; snippet: string; }
interface AskResult { answer: string; citations: Citation[]; verified: boolean; grounded: boolean; }
interface ChatTurn { role: "user" | "jarvis"; text: string; citations?: Citation[]; verified?: boolean; }
interface AssessRow { criterion: string; met: boolean; evidence: string; page: number | null; }
interface AssessResult { results: AssessRow[]; score: number; met: number; total: number; }

const CYAN = "#8aebff", GREEN = "#5eead4", RED = "#ffb4ab", MUTED = "#859397";

function Panel({ title, icon, children, className = "" }: { title: string; icon?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <div className={`glass-panel rounded-xl border border-white/5 p-5 ${className}`}>
      <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] flex items-center gap-2 mb-4">{icon} {title}</h3>
      {children}
    </div>
  );
}

export default function DocsRag() {
  const [docs, setDocs] = useState<DocItem[]>([]);
  const [active, setActive] = useState<DocItem | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"chat" | "assess">("chat");
  const fileRef = useRef<HTMLInputElement | null>(null);

  // Chat state (per selected doc)
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // Assess state
  const [criteria, setCriteria] = useState("");
  const [assessing, setAssessing] = useState(false);
  const [assessment, setAssessment] = useState<AssessResult | null>(null);

  const loadDocs = useCallback(async () => {
    try {
      const d = await fetch("/api/pdf-rag/docs", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null));
      if (d?.documents) {
        setDocs(d.documents);
        setActive((cur) => cur && d.documents.find((x: DocItem) => x.id === cur.id) ? cur : d.documents[0] || null);
      }
    } catch { /* keep last */ }
  }, []);

  useEffect(() => { loadDocs(); }, [loadDocs]);
  useEffect(() => { setTurns([]); setAssessment(null); setError(""); }, [active?.id]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [turns, asking]);

  const upload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".pdf")) { setError("Only PDF files are supported."); return; }
    setUploading(true); setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pdf-rag/upload", { method: "POST", body: fd });
      const d = await res.json();
      if (!res.ok || d.error) { setError(d.error || `Upload failed (${res.status}).`); }
      else { await loadDocs(); setActive(d.document); setTab("chat"); }
    } catch (e) { setError(`Upload failed: ${e instanceof Error ? e.message : e}`); }
    finally { setUploading(false); if (fileRef.current) fileRef.current.value = ""; }
  };

  const removeDoc = async (id: number) => {
    if (!confirm("Remove this document and its index?")) return;
    try { await fetch(`/api/pdf-rag/${id}`, { method: "DELETE" }); await loadDocs(); } catch { /* */ }
  };

  const ask = async () => {
    const q = question.trim();
    if (!q || !active || asking) return;
    setQuestion("");
    setTurns((t) => [...t, { role: "user", text: q }]);
    setAsking(true);
    try {
      const res = await fetch(`/api/pdf-rag/${active.id}/ask`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ question: q }),
      });
      const d: AskResult = await res.json();
      setTurns((t) => [...t, { role: "jarvis", text: d.answer || "—", citations: d.citations || [], verified: d.verified }]);
    } catch {
      setTurns((t) => [...t, { role: "jarvis", text: "Couldn't reach the document engine just now." }]);
    } finally { setAsking(false); }
  };

  const runAssess = async () => {
    if (!active || assessing) return;
    const list = criteria.split("\n").map((c) => c.trim()).filter(Boolean);
    if (list.length === 0) { setError("Add at least one criterion (one per line)."); return; }
    setAssessing(true); setError(""); setAssessment(null);
    try {
      const res = await fetch(`/api/pdf-rag/${active.id}/assess`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ criteria: list }),
      });
      setAssessment(await res.json());
    } catch { setError("Assessment failed — try again."); }
    finally { setAssessing(false); }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -15 }} transition={{ duration: 0.4 }} className="space-y-6">
      {/* Header */}
      <section className="pt-4">
        <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
          <span className="opacity-40 font-light text-xl">06 //</span> DOCUMENT RAG
        </h1>
        <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
          Upload a PDF · ask it questions · answers cited to the source page
        </p>
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: upload + doc list */}
        <div className="space-y-6">
          <Panel title="Documents" icon={<FileText className="w-4 h-4" />}>
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-xs font-semibold font-mono border border-dashed border-[#8aebff]/30 bg-[#8aebff]/5 text-[#8aebff] hover:bg-[#8aebff]/10 transition-all cursor-pointer disabled:opacity-50">
              {uploading ? <><Loader2 className="w-4 h-4 animate-spin" /> INDEXING…</> : <><Upload className="w-4 h-4" /> UPLOAD PDF</>}
            </button>
            {error && (
              <div className="mt-3 flex items-start gap-2 text-[11px] font-mono text-[#ffb4ab] bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg p-2.5">
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> <span>{error}</span>
              </div>
            )}
            <div className="mt-4 space-y-2">
              {docs.length === 0 ? (
                <p className="text-[11px] font-mono text-[#859397] text-center py-4">No documents yet. Upload a PDF to start.</p>
              ) : docs.map((d) => (
                <div key={d.id}
                  onClick={() => setActive(d)}
                  className={`group flex items-center gap-2 rounded-lg border p-2.5 cursor-pointer transition-all ${active?.id === d.id ? "border-[#8aebff]/40 bg-[#8aebff]/10" : "border-white/5 bg-white/[0.02] hover:border-white/10"}`}>
                  <FileText className={`w-4 h-4 shrink-0 ${active?.id === d.id ? "text-[#8aebff]" : "text-[#859397]"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12px] font-mono text-[#dfe2f3] truncate" title={d.filename}>{d.filename}</div>
                    <div className="text-[9px] font-mono text-[#859397]">{d.pages} pages · {d.chunks} passages</div>
                  </div>
                  <button onClick={(e) => { e.stopPropagation(); removeDoc(d.id); }} title="Remove"
                    className="p-1 rounded text-[#859397] hover:text-[#ffb4ab] opacity-0 group-hover:opacity-100 transition-all cursor-pointer">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Right: chat / assess */}
        <div className="lg:col-span-2">
          {!active ? (
            <Panel title="Ask the document" icon={<MessageSquare className="w-4 h-4" />}>
              <div className="flex flex-col items-center justify-center h-[300px] text-center gap-3">
                <FileText className="w-10 h-10 text-[#8aebff]/30" />
                <p className="text-sm text-[#bbc9cd]">Upload a PDF, then ask it anything.</p>
                <p className="text-[11px] font-mono text-[#859397] max-w-sm">Answers are generated only from the document and cited to the page — unsupported claims are dropped by a self-check pass.</p>
              </div>
            </Panel>
          ) : (
            <div className="glass-panel rounded-xl border border-white/5 overflow-hidden flex flex-col" style={{ minHeight: 460 }}>
              {/* Tabs */}
              <div className="flex items-center border-b border-white/5">
                {([["chat", "CHAT", <MessageSquare className="w-4 h-4" key="c" />], ["assess", "ASSESS", <ClipboardCheck className="w-4 h-4" key="a" />]] as const).map(([id, label, icon]) => (
                  <button key={id} onClick={() => setTab(id)}
                    className={`flex items-center gap-2 px-5 py-3 text-xs font-mono font-bold tracking-widest transition-all cursor-pointer ${tab === id ? "text-[#8aebff] border-b-2 border-[#8aebff] bg-[#8aebff]/5" : "text-[#859397] hover:text-[#bbc9cd]"}`}>
                    {icon} {label}
                  </button>
                ))}
                <div className="ml-auto pr-4 text-[10px] font-mono text-[#859397] truncate max-w-[40%]" title={active.filename}>{active.filename}</div>
              </div>

              {tab === "chat" ? (
                <div className="flex flex-col flex-1">
                  <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4" style={{ maxHeight: 460 }}>
                    {turns.length === 0 && (
                      <p className="text-[11px] font-mono text-[#859397] text-center py-8">Ask a question — e.g. “What is this document about?” or “What are the key figures?”</p>
                    )}
                    {turns.map((t, i) => (
                      <div key={i} className={t.role === "user" ? "flex justify-end" : "flex justify-start"}>
                        <div className={`max-w-[85%] rounded-xl px-4 py-2.5 ${t.role === "user" ? "bg-[#8aebff]/10 border border-[#8aebff]/20" : "bg-white/[0.03] border border-white/5"}`}>
                          <p className="text-sm text-[#dfe2f3] whitespace-pre-wrap leading-relaxed">{t.text}</p>
                          {t.role === "jarvis" && t.citations && t.citations.length > 0 && (
                            <div className="mt-3 space-y-1.5 border-t border-white/5 pt-2">
                              <div className="flex items-center gap-1.5 text-[9px] font-mono uppercase tracking-widest text-[#5eead4]">
                                <ShieldCheck className="w-3 h-3" /> {t.verified ? "Verified sources" : "Sources"}
                              </div>
                              {t.citations.map((c) => (
                                <div key={c.n} className="flex items-start gap-2 text-[11px] font-mono">
                                  <span className="shrink-0 px-1.5 py-0.5 rounded bg-[#8aebff]/15 text-[#8aebff]">[{c.n}] p.{c.page}</span>
                                  <span className="text-[#bbc9cd] leading-snug"><Quote className="w-3 h-3 inline mr-1 opacity-40" />{c.snippet}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                    {asking && (
                      <div className="flex justify-start"><div className="rounded-xl px-4 py-2.5 bg-white/[0.03] border border-white/5 text-[#859397] text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Reading the document…</div></div>
                    )}
                  </div>
                  <div className="border-t border-white/5 p-3 flex items-center gap-2">
                    <input value={question} onChange={(e) => setQuestion(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") ask(); }}
                      placeholder="Ask this document…" disabled={asking}
                      className="flex-1 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40" />
                    <button onClick={ask} disabled={asking || !question.trim()}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-40">
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-5 space-y-4 flex-1 overflow-y-auto" style={{ maxHeight: 460 }}>
                  <p className="text-[11px] font-mono text-[#859397]">Enter criteria to check the document against — one per line (e.g. a JD's requirements, a checklist, a rubric).</p>
                  <textarea value={criteria} onChange={(e) => setCriteria(e.target.value)} rows={4}
                    placeholder={"Mentions SQL experience\nHas a quantified achievement\nIncludes cloud tools"}
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 resize-none" />
                  <button onClick={runAssess} disabled={assessing}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] cursor-pointer disabled:opacity-50">
                    {assessing ? <><Loader2 className="w-4 h-4 animate-spin" /> ASSESSING…</> : <><ClipboardCheck className="w-4 h-4" /> RUN ASSESSMENT</>}
                  </button>
                  {assessment && (
                    <div className="space-y-3 pt-2">
                      <div className="flex items-center gap-3">
                        <div className="text-3xl font-bold font-mono" style={{ color: assessment.score >= 67 ? GREEN : assessment.score >= 34 ? "#ffd6a3" : RED }}>{assessment.score}%</div>
                        <div className="text-[11px] font-mono text-[#859397]">{assessment.met}/{assessment.total} criteria met</div>
                      </div>
                      <div className="space-y-2">
                        {assessment.results.map((r, i) => (
                          <div key={i} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                            <div className="flex items-start gap-2">
                              <span className="shrink-0 mt-0.5" style={{ color: r.met ? GREEN : RED }}>{r.met ? "✓" : "✗"}</span>
                              <div className="min-w-0 flex-1">
                                <div className="text-[13px] font-mono text-[#dfe2f3]">{r.criterion}{r.page ? <span className="text-[9px] text-[#859397] ml-2">p.{r.page}</span> : null}</div>
                                {r.evidence && <div className="text-[11px] text-[#bbc9cd] mt-1 leading-snug">{r.evidence}</div>}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
