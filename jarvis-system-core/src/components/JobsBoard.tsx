import React, { useState, useEffect, useCallback, useRef } from "react";
import { ScreenId } from "../types";
import { motion, AnimatePresence } from "motion/react";
import {
  ArrowUpRight,
  ShieldCheck,
  RefreshCw,
  FileText,
  Download,
  X,
  CheckCircle2,
  AlertCircle,
  Trash2,
  ChevronDown,
  Upload,
  ClipboardCheck,
  Gauge,
  Sparkles,
  Plus,
  Mail,
} from "lucide-react";

interface JobsBoardProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
}

/* ---- Inline types describing the real backend payloads ---- */

interface Application {
  id: number;
  job_key: string;
  title: string;
  company: string;
  location: string;
  url?: string;
  source?: string;
  description?: string;
  status: string;
  ats_score?: number | null;
  ats_scored_at?: string | null;
}

interface ApplicationsResponse {
  applications: Application[];
  statuses: string[];
}

interface RealColumn {
  status: string;
  title: string;
  count: string;
  accentClass: string;
  opacityClass?: string;
  grayscale?: boolean;
  cards: Application[];
}

interface KeywordMatrix {
  required: string[];
  present: string[];
  missing: string[];
}

interface StarXyzItem {
  section_name: string;
  current_text: string;
  optimized_text: string;
  issue: string;
}

interface AtsResult {
  job_ref: string;
  job_title: string;
  company: string;
  location: string;
  ats_score: number;
  keyword_matrix: KeywordMatrix;
  star_xyz_breakdown: StarXyzItem[];
}

interface AtsErrorResult {
  error: string;
}

/* ---- Visual config per status (preserves original HUD styling) ---- */

const STATUS_CONFIG: Record<
  string,
  { accentClass: string; opacityClass?: string; grayscale?: boolean }
> = {
  interested: { accentClass: "text-[#8aebff] border-[#8aebff]/20 bg-[#8aebff]/5" },
  applied: { accentClass: "text-[#8aebff] border-[#8aebff]/20 bg-[#8aebff]/5" },
  interviewing: { accentClass: "text-[#8aebff] border-[#8aebff]/40 bg-[#8aebff]/10" },
  offer: { accentClass: "text-[#ffd6a3] border-[#ffd6a3]/40 bg-[#ffd6a3]/10" },
  accepted: {
    accentClass: "text-[#bbc9cd] border-white/10 bg-white/5",
    opacityClass: "opacity-60",
  },
  rejected: {
    accentClass: "text-[#ffb4ab] border-[#ffb4ab]/20 bg-[#ffb4ab]/5",
    opacityClass: "opacity-40",
    grayscale: true,
  },
};

const pad2 = (n: number) => String(n).padStart(2, "0");

/* ATS score badge colour — green high, amber mid, red low. */
const atsColor = (score: number) =>
  score >= 75
    ? { text: "#5eead4", border: "#5eead4", bg: "#5eead4" }
    : score >= 50
    ? { text: "#ffd6a3", border: "#ffd6a3", bg: "#ffd6a3" }
    : { text: "#ffb4ab", border: "#ffb4ab", bg: "#ffb4ab" };

export default function JobsBoard({ activeScreen, onNavigate }: JobsBoardProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"keyword" | "star">("keyword");
  const [atsResult, setAtsResult] = useState<AtsResult | null>(null);
  const [atsLoadingId, setAtsLoadingId] = useState<number | null>(null);
  const [docLoading, setDocLoading] = useState(false);

  // Résumé modal
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeContent, setResumeContent] = useState("");
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeSaving, setResumeSaving] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const resumeFileRef = useRef<HTMLInputElement>(null);

  // Apply-to-.docx (format-preserving) flow
  const [applyOpen, setApplyOpen] = useState(false);
  const [applyRef, setApplyRef] = useState<string>("");
  const [applyMissing, setApplyMissing] = useState<string[]>([]);
  const [hasDocx, setHasDocx] = useState<boolean | null>(null);
  const [selectedAdd, setSelectedAdd] = useState<string[]>([]);
  const [applying, setApplying] = useState(false);
  const [applyResult, setApplyResult] = useState<any | null>(null);
  const [applyError, setApplyError] = useState("");

  // Manually add a job applied elsewhere (LinkedIn / Naukri / careers page)
  const [addOpen, setAddOpen] = useState(false);
  const [addSaving, setAddSaving] = useState(false);
  const [addError, setAddError] = useState("");
  const emptyManual = {
    title: "",
    company: "",
    location: "",
    url: "",
    source: "",
    status: "applied",
  };
  const [manual, setManual] = useState({ ...emptyManual });

  // Email → board sync: pending confirmations + on-demand scan
  const [pending, setPending] = useState<any[]>([]);
  const [pendingBusy, setPendingBusy] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanResult, setScanResult] = useState<any | null>(null);

  // Paste-a-JD flow for cards with no job description (Naukri quick-apply / email / chat adds)
  const [jdOpen, setJdOpen] = useState(false);
  const [jdForId, setJdForId] = useState<number | null>(null);
  const [jdForTitle, setJdForTitle] = useState("");
  const [jdText, setJdText] = useState("");
  const [jdBusy, setJdBusy] = useState(false);
  const [jdError, setJdError] = useState("");

  // Standalone résumé audit (job-agnostic)
  const [auditOpen, setAuditOpen] = useState(false);
  const [audit, setAudit] = useState<any | null>(null);
  const [auditFetching, setAuditFetching] = useState(false);
  const [auditRunning, setAuditRunning] = useState(false);
  const [auditError, setAuditError] = useState("");

  /* ---- Data loading ---- */

  const loadApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/applications");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: ApplicationsResponse = await res.json();
      setApplications(Array.isArray(data.applications) ? data.applications : []);
      setStatuses(
        Array.isArray(data.statuses) && data.statuses.length
          ? data.statuses
          : ["interested", "applied", "interviewing", "offer", "accepted", "rejected"]
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load applications");
      setApplications([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPending = useCallback(async () => {
    try {
      const res = await fetch("/applications/pending");
      const data = await res.json();
      setPending(Array.isArray(data?.pending) ? data.pending : []);
    } catch {
      setPending([]);
    }
  }, []);

  useEffect(() => {
    loadApplications();
    loadPending();
  }, [loadApplications, loadPending]);

  /* ---- Email → board sync ---- */

  const scanNow = async () => {
    setScanning(true);
    setScanResult(null);
    try {
      // Synchronous scan — waits for the result so we can show exactly what happened.
      const res = await fetch("/applications/scan", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setScanResult(data);
      setScanOpen(true);
      await Promise.all([loadApplications(), loadPending()]);
    } catch (e) {
      setScanResult({ error: e instanceof Error ? e.message : String(e) });
      setScanOpen(true);
    } finally {
      setScanning(false);
    }
  };

  const confirmPending = async (id: number) => {
    setPendingBusy(id);
    try {
      await fetch(`/applications/pending/${id}/confirm`, { method: "POST" });
      await Promise.all([loadApplications(), loadPending()]);
    } catch (e) {
      alert(`Couldn't confirm: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPendingBusy(null);
    }
  };

  const dismissPending = async (id: number) => {
    setPendingBusy(id);
    try {
      await fetch(`/applications/pending/${id}/dismiss`, { method: "POST" });
      await loadPending();
    } catch (e) {
      alert(`Couldn't dismiss: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPendingBusy(null);
    }
  };

  /* ---- Mutations ---- */

  const changeStatus = async (id: number, status: string) => {
    try {
      const res = await fetch("/applications/update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, status }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await loadApplications();
    } catch (e) {
      alert(`Could not update status: ${e instanceof Error ? e.message : e}`);
    }
  };

  const removeCard = async (id: number) => {
    try {
      const res = await fetch("/applications/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      await loadApplications();
    } catch (e) {
      alert(`Could not remove application: ${e instanceof Error ? e.message : e}`);
    }
  };

  /* ---- ATS analysis ---- */

  const runAts = async (id: number, jd?: string) => {
    setAtsLoadingId(id);
    try {
      const res = await fetch(`/applications/${id}/ats`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jd ? { job_description: jd } : {}),
      });
      const data: any = await res.json();
      // No job description on this card → ask the user to paste the posting.
      if (data?.needs_jd) {
        setJdForId(id);
        setJdForTitle(
          `${data.title || "this role"}${data.company ? ` — ${data.company}` : ""}`
        );
        setJdText("");
        setJdError("");
        setJdOpen(true);
        return;
      }
      if (!res.ok || "error" in data) {
        alert((("error" in data && data.error) as string) || `ATS analysis failed (HTTP ${res.status})`);
        return;
      }
      setAtsResult(data as AtsResult);
      setActiveTab("keyword");
      onNavigate(ScreenId.AtsAnalysis);
      loadApplications(); // refresh so the score badge shows on the card behind the modal
    } catch (e) {
      alert(`ATS analysis failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setAtsLoadingId(null);
    }
  };

  const submitJd = async () => {
    if (!jdText.trim()) {
      setJdError("Paste the job description first.");
      return;
    }
    if (jdForId == null) return;
    setJdBusy(true);
    setJdError("");
    const id = jdForId;
    const jd = jdText.trim();
    try {
      setJdOpen(false);
      await runAts(id, jd); // saves the JD onto the card, then analyses against it
    } finally {
      setJdBusy(false);
    }
  };

  /* ---- Résumé ---- */

  const openResume = async () => {
    setResumeOpen(true);
    setResumeLoading(true);
    try {
      const res = await fetch("/resume");
      const data = await res.json();
      setResumeContent(typeof data?.content === "string" ? data.content : "");
    } catch {
      setResumeContent("");
    } finally {
      setResumeLoading(false);
    }
  };

  const saveResume = async () => {
    setResumeSaving(true);
    try {
      const res = await fetch("/resume/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: resumeContent }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      setResumeOpen(false);
    } catch (e) {
      alert(`Could not save résumé: ${e instanceof Error ? e.message : e}`);
    } finally {
      setResumeSaving(false);
    }
  };

  const uploadResumeFile = async (file: File) => {
    setResumeUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/resume/upload-file", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      // Populate the editor with the extracted text (already saved server-side).
      setResumeContent(typeof data?.content === "string" ? data.content : "");
    } catch (e) {
      alert(`Could not read that file: ${e instanceof Error ? e.message : e}`);
    } finally {
      setResumeUploading(false);
      if (resumeFileRef.current) resumeFileRef.current.value = "";
    }
  };

  /* ---- Manually add a job applied elsewhere ---- */
  const openAdd = () => {
    setManual({ ...emptyManual });
    setAddError("");
    setAddOpen(true);
  };

  const saveManual = async () => {
    if (!manual.title.trim()) {
      setAddError("Job title is required.");
      return;
    }
    setAddSaving(true);
    setAddError("");
    try {
      const res = await fetch("/applications/add-manual", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(manual),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.result || data?.error || `HTTP ${res.status}`);
      }
      setAddOpen(false);
      await loadApplications();
    } catch (e) {
      setAddError(e instanceof Error ? e.message : String(e));
    } finally {
      setAddSaving(false);
    }
  };

  /* ---- Résumé Audit (general, no JD) ---- */
  const openAudit = async () => {
    setAuditOpen(true);
    setAuditError("");
    setAuditFetching(true);
    try {
      const res = await fetch("/resume/audit");
      const data = await res.json();
      setAudit(data?.audit || null);
    } catch {
      setAudit(null);
    } finally {
      setAuditFetching(false);
    }
  };

  const runAudit = async () => {
    setAuditRunning(true);
    setAuditError("");
    try {
      const res = await fetch("/resume/audit", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setAudit(data.audit);
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setAuditRunning(false);
    }
  };

  /* ---- Apply changes to my .docx (keeps format) ---- */
  const openApply = async (jobRef: string, missing: string[]) => {
    setApplyRef(jobRef);
    setApplyMissing(missing || []);
    setSelectedAdd([]);
    setApplyResult(null);
    setApplyError("");
    setApplyOpen(true);
    setHasDocx(null);
    try {
      const res = await fetch("/resume/docx-status");
      const data = await res.json();
      setHasDocx(!!data?.has_docx);
    } catch {
      setHasDocx(false);
    }
  };

  const toggleAdd = (kw: string) =>
    setSelectedAdd((prev) => (prev.includes(kw) ? prev.filter((k) => k !== kw) : [...prev, kw]));

  const runApply = async () => {
    setApplying(true);
    setApplyError("");
    try {
      const res = await fetch(`/ats/${encodeURIComponent(applyRef)}/apply-to-docx`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additions: selectedAdd }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setApplyResult(data);
      if (data?.download) window.open(data.download, "_blank"); // download the edited .docx
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : String(e));
    } finally {
      setApplying(false);
    }
  };

  const openInGoogleDoc = async (jobRef: string) => {
    setDocLoading(true);
    try {
      const res = await fetch(`/ats/${encodeURIComponent(jobRef)}/google-doc`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      if (data?.url) window.open(data.url, "_blank");
    } catch (e) {
      alert(`Couldn't create the Google Doc: ${e instanceof Error ? e.message : e}`);
    } finally {
      setDocLoading(false);
    }
  };

  const closeModal = () => {
    onNavigate(ScreenId.Jobs);
  };

  /* ---- Derived: kanban columns grouped by status ---- */

  const columns: RealColumn[] = statuses.map((status) => {
    const cfg = STATUS_CONFIG[status] || {
      accentClass: "text-[#8aebff] border-[#8aebff]/20 bg-[#8aebff]/5",
    };
    // Analysed cards rise to the top, highest ATS score first; un-analysed keep their
    // existing (most-recently-updated) order at the bottom.
    const cards = applications
      .filter((a) => a.status === status)
      .map((a, i) => ({ a, i }))
      .sort((x, y) => {
        const sx = typeof x.a.ats_score === "number" ? x.a.ats_score : -1;
        const sy = typeof y.a.ats_score === "number" ? y.a.ats_score : -1;
        if (sx !== sy) return sy - sx;
        return x.i - y.i;
      })
      .map((w) => w.a);
    return {
      status,
      title: status.toUpperCase(),
      count: pad2(cards.length),
      accentClass: cfg.accentClass,
      opacityClass: cfg.opacityClass,
      grayscale: cfg.grayscale,
      cards,
    };
  });

  const gaugeCircumference = 477; // matches original r=76 dashed circle
  const score = atsResult?.ats_score ?? 0;
  const gaugeOffset = gaugeCircumference * (1 - Math.max(0, Math.min(100, score)) / 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 15 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -15 }}
      transition={{ duration: 0.4 }}
      className="space-y-6"
    >
      {/* Toolbar / Section title */}
      <section className="pt-4 max-w-full mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-[#dfe2f3] flex items-center gap-4 font-mono">
              <span className="opacity-40 font-light text-xl">01 //</span> APPLICATIONS
              <span className="text-sm font-semibold bg-[#8aebff]/10 text-[#8aebff] px-3.5 py-1 rounded-full border border-[#8aebff]/20">
                {pad2(applications.length)} ACTIVE
              </span>
            </h1>
            <p className="text-xs font-mono text-[#859397] uppercase tracking-widest mt-1 opacity-80">
              Neural Career Node Synchronization: {loading ? "In Progress" : "Complete"}
            </p>
          </div>

          <div className="flex items-center gap-3 font-mono">
            <button
              onClick={scanNow}
              disabled={scanning}
              className="flex items-center gap-2 px-5 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-semibold hover:bg-white/10 hover:border-[#a3e635]/30 transition-all text-[#a3e635] cursor-pointer disabled:opacity-50"
              title="Read your email now and update the board (application confirmations, interviews, offers, rejections)"
            >
              <Mail className={`w-4 h-4 ${scanning ? "animate-pulse" : ""}`} />
              {scanning ? "SCANNING…" : "SCAN EMAILS"}
            </button>
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-5 py-2 bg-[#8aebff]/10 border border-[#8aebff]/30 rounded-lg text-xs font-semibold hover:bg-[#8aebff]/20 transition-all text-[#8aebff] cursor-pointer"
              title="Track a job you applied to elsewhere (LinkedIn, Naukri, careers page…)"
            >
              <Plus className="w-4 h-4" />
              ADD JOB
            </button>
            <button
              onClick={openResume}
              className="flex items-center gap-2 px-5 py-2 bg-white/5 border border-white/10 rounded-lg text-xs font-semibold hover:bg-white/10 hover:border-[#8aebff]/30 transition-all text-[#8aebff] cursor-pointer"
            >
              <FileText className="w-4 h-4" />
              RÉSUMÉ
            </button>
            <button
              onClick={openAudit}
              className="flex items-center gap-2 px-5 py-2 bg-[#a3e635]/10 border border-[#a3e635]/30 rounded-lg text-xs font-semibold hover:bg-[#a3e635]/20 transition-all text-[#a3e635] cursor-pointer"
              title="General résumé health check — not tied to any job"
            >
              <ClipboardCheck className="w-4 h-4" />
              RÉSUMÉ AUDIT
            </button>
            <button
              onClick={loadApplications}
              aria-label="Refresh applications"
              className="flex items-center justify-center w-10 h-10 bg-white/5 border border-white/10 rounded-lg text-[#859397] hover:text-[#8aebff] transition-all cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>
      </section>

      {/* Error banner */}
      {error && (
        <div className="font-mono text-xs text-[#ffb4ab] bg-[#ffb4ab]/5 border border-[#ffb4ab]/20 rounded-lg px-4 py-3">
          Failed to sync career node: {error}
        </div>
      )}

      {/* Needs-your-confirmation strip — low-confidence email→board suggestions */}
      {pending.length > 0 && (
        <section className="rounded-xl border border-[#ffd6a3]/25 bg-[#ffd6a3]/[0.04] p-4">
          <h3 className="text-xs font-bold font-mono uppercase tracking-widest text-[#ffd6a3] flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4" /> Needs your confirmation
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#ffd6a3]/10 border border-[#ffd6a3]/20">
              {pad2(pending.length)}
            </span>
          </h3>
          <p className="text-[11px] font-mono text-[#859397] mb-3">
            JARVIS read an email it couldn't confidently match. Confirm to update the board, or dismiss.
          </p>
          <div className="space-y-2.5">
            {pending.map((p) => (
              <div
                key={p.id}
                className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg bg-[#0a0e1a]/40 border border-white/5"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-[#dfe2f3] font-semibold truncate">
                    {p.kind === "add" ? "Add" : "Move"} <span className="text-[#8aebff]">{p.title}</span>
                    {p.company ? <span className="text-[#859397] font-normal"> · {p.company}</span> : null}
                    {" "}→ <span className="uppercase text-[#ffd6a3]">{p.to_status}</span>
                  </p>
                  {p.reason && (
                    <p className="text-[11px] font-mono text-[#859397] truncate mt-0.5">{p.reason}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    onClick={() => confirmPending(p.id)}
                    disabled={pendingBusy === p.id}
                    className="px-3 py-1.5 rounded text-[11px] font-bold font-mono bg-[#a3e635]/10 border border-[#a3e635]/30 text-[#a3e635] hover:bg-[#a3e635] hover:text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {pendingBusy === p.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                    CONFIRM
                  </button>
                  <button
                    onClick={() => dismissPending(p.id)}
                    disabled={pendingBusy === p.id}
                    className="px-3 py-1.5 rounded text-[11px] font-bold font-mono bg-white/5 border border-white/10 text-[#859397] hover:text-[#ffb4ab] hover:border-[#ffb4ab]/30 transition-all cursor-pointer disabled:opacity-50"
                  >
                    DISMISS
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Kanban Board Layout */}
      <section className="overflow-x-auto pb-6 scrollbar-hide">
        {loading ? (
          <div className="flex items-center justify-center min-h-[400px] font-mono text-xs text-[#859397] uppercase tracking-widest">
            <RefreshCw className="w-4 h-4 animate-spin mr-3" /> Synchronizing applications…
          </div>
        ) : columns.every((c) => c.cards.length === 0) ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center">
            <FileText className="w-10 h-10 text-[#8aebff]/40" />
            <p className="font-mono text-sm text-[#dfe2f3]">No applications tracked yet.</p>
            <p className="font-mono text-xs text-[#859397] max-w-sm">
              Once the career node ingests roles, they will populate the kanban board here.
            </p>
          </div>
        ) : (
          <div className="flex gap-6 min-w-[1200px] px-2">
            {columns.map((col) => (
              <div
                key={col.status}
                className={`flex-shrink-0 w-80 glass-column flex flex-col rounded-xl min-h-[500px] ${
                  col.opacityClass || ""
                } ${col.grayscale ? "grayscale" : ""}`}
              >
                {/* Column Header */}
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                  <span className="text-xs font-bold font-mono text-[#859397] tracking-widest">
                    {col.title}
                  </span>
                  <span className={`text-xs font-mono px-2.5 py-0.5 rounded border ${col.accentClass}`}>
                    {col.count}
                  </span>
                </div>

                {/* Column Cards Container */}
                <div className="p-4 space-y-4 flex-1">
                  {col.cards.length === 0 ? (
                    <p className="text-[10px] font-mono text-[#859397]/60 uppercase tracking-widest text-center py-6">
                      Empty
                    </p>
                  ) : (
                    col.cards.map((card) => {
                      const isAction = card.status === "offer";
                      const isClosed = card.status === "accepted";
                      return (
                        <div
                          key={card.id}
                          className={`glass-card p-5 rounded-xl group relative overflow-hidden ${
                            isAction ? "border-[#ffd6a3]/40 shadow-lg" : ""
                          }`}
                        >
                          <div className="flex justify-between items-start mb-2">
                            <h3 className="text-base font-bold text-[#dfe2f3] group-hover:text-[#8aebff] transition-colors leading-snug">
                              {card.url ? (
                                <a
                                  href={card.url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="hover:underline"
                                >
                                  {card.title}
                                </a>
                              ) : (
                                card.title
                              )}
                            </h3>
                            <div className="flex items-center gap-2 shrink-0">
                              {typeof card.ats_score === "number" && (() => {
                                const c = atsColor(card.ats_score);
                                return (
                                  <span
                                    title={`ATS match score${card.ats_scored_at ? ` — as of ${new Date(card.ats_scored_at).toLocaleDateString()}` : ""}`}
                                    className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-bold font-mono border cursor-help"
                                    style={{ color: c.text, borderColor: `${c.border}55`, backgroundColor: `${c.bg}1a` }}
                                  >
                                    <Gauge className="w-3 h-3" />
                                    {card.ats_score}
                                  </span>
                                );
                              })()}
                              {isAction ? (
                                <ShieldCheck className="w-4 h-4 text-[#ffd6a3] group-hover:scale-110 transition-transform" />
                              ) : (
                                <ArrowUpRight className="w-4 h-4 text-[#8aebff]/40 group-hover:text-[#8aebff] group-hover:translate-x-0.5 transition-all" />
                              )}
                            </div>
                          </div>

                          <p className="text-xs font-mono text-[#859397] mb-4">
                            {card.company}
                            {card.location ? ` • ${card.location}` : ""}
                            {card.source ? ` • ${card.source}` : ""}
                          </p>

                          {/* Status selector + tags */}
                          <div className="flex items-center flex-wrap gap-2 mb-4">
                            {isClosed && (
                              <span className="text-[10px] font-bold font-mono text-[#859397] uppercase tracking-wider">
                                Closed
                              </span>
                            )}
                            {isAction && (
                              <span className="text-[10px] font-bold font-mono text-[#ffd6a3] px-2.5 py-0.5 bg-[#ffd6a3]/10 rounded border border-[#ffd6a3]/20 uppercase">
                                Action Required
                              </span>
                            )}
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <button
                              onClick={() => runAts(card.id)}
                              disabled={atsLoadingId === card.id}
                              className="ats-chip px-2.5 py-1 rounded text-[10px] font-bold font-mono text-[#8aebff] border border-[#8aebff]/30 hover:bg-[#8aebff]/10 transition-all cursor-pointer disabled:opacity-50"
                            >
                              {atsLoadingId === card.id ? "ANALYZING…" : "ATS ANALYSIS"}
                            </button>

                            <div className="relative inline-flex items-center">
                              <select
                                value={card.status}
                                onChange={(e) => changeStatus(card.id, e.target.value)}
                                aria-label={`Change status for ${card.title}`}
                                className="appearance-none bg-white/5 border border-white/10 rounded text-[10px] font-mono text-[#bbc9cd] pl-2.5 pr-6 py-1 uppercase tracking-wider cursor-pointer hover:border-[#8aebff]/30 focus:outline-none focus:border-[#8aebff]/50"
                              >
                                {statuses.map((s) => (
                                  <option key={s} value={s} className="bg-[#0a0e1a] text-[#dfe2f3]">
                                    {s.toUpperCase()}
                                  </option>
                                ))}
                              </select>
                              <ChevronDown className="w-3 h-3 text-[#859397] absolute right-1.5 pointer-events-none" />
                            </div>

                            <button
                              onClick={() => {
                                if (confirm(`Remove "${card.title}" from tracking?`)) {
                                  removeCard(card.id);
                                }
                              }}
                              aria-label={`Remove ${card.title}`}
                              className="ml-auto p-1.5 rounded text-[#859397] hover:text-[#ffb4ab] hover:bg-[#ffb4ab]/5 transition-all cursor-pointer"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Slide-Up ATS Analysis Modal Overlay */}
      <AnimatePresence>
        {activeScreen === ScreenId.AtsAnalysis && atsResult && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 180 }}
              className="w-full max-w-3xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#8aebff]/20 max-h-[90vh] flex flex-col"
            >
              {/* Modal header */}
              <div className="p-6 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono">
                    ATS Alignment Analysis
                  </h2>
                  <div className="flex items-center gap-3 mt-1 text-xs flex-wrap">
                    <span className="text-[#859397] font-mono">TARGET:</span>
                    <span className="text-[#dfe2f3] font-semibold">{atsResult.job_title}</span>
                    <span className="px-2 py-0.5 bg-[#8aebff]/10 rounded text-[10px] font-mono text-[#8aebff] border border-[#8aebff]/20 uppercase">
                      {atsResult.company}
                    </span>
                    {atsResult.location && (
                      <span className="text-[10px] font-mono text-[#859397]">
                        {atsResult.location}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right font-mono hidden sm:block">
                    <span className="text-[9px] text-[#859397] block">JOB_REF</span>
                    <span className="text-[11px] text-[#8aebff] font-semibold">
                      {atsResult.job_ref}
                    </span>
                  </div>
                  <button
                    onClick={closeModal}
                    aria-label="Close modal"
                    className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#8aebff] transition-all rounded-full border border-white/5 cursor-pointer flex items-center justify-center"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>

              {/* Modal Core Content */}
              <div className="p-6 space-y-6 overflow-y-auto">
                {/* Large circular match gauge */}
                <div className="flex flex-col items-center py-6 border-b border-white/5">
                  <div className="relative w-44 h-44 flex items-center justify-center">
                    <svg className="w-full h-full -rotate-90">
                      <circle
                        className="text-[#8aebff]/10"
                        cx="88"
                        cy="88"
                        fill="transparent"
                        r="76"
                        stroke="currentColor"
                        strokeWidth="3"
                      ></circle>
                      <circle
                        className="text-[#8aebff] glow-cyan"
                        cx="88"
                        cy="88"
                        fill="transparent"
                        r="76"
                        stroke="currentColor"
                        strokeDasharray={gaugeCircumference}
                        strokeDashoffset={gaugeOffset}
                        strokeLinecap="butt"
                        strokeWidth="6"
                      ></circle>
                    </svg>
                    <div className="absolute flex flex-col items-center">
                      <span className="text-4xl font-extrabold text-[#dfe2f3] font-mono glow-cyan leading-none">
                        {score}
                      </span>
                      <span className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mt-1">
                        / 100 MATCH
                      </span>
                    </div>
                  </div>
                </div>

                {/* Tab buttons */}
                <div className="flex border-b border-[#3c494c]/40 font-mono text-xs">
                  <button
                    onClick={() => setActiveTab("keyword")}
                    className={`px-6 py-2.5 border-b-2 font-semibold transition-all cursor-pointer ${
                      activeTab === "keyword"
                        ? "border-[#8aebff] text-[#8aebff]"
                        : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                    }`}
                  >
                    KEYWORD MATRIX
                  </button>
                  <button
                    onClick={() => setActiveTab("star")}
                    className={`px-6 py-2.5 border-b-2 font-semibold transition-all cursor-pointer ${
                      activeTab === "star"
                        ? "border-[#8aebff] text-[#8aebff]"
                        : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                    }`}
                  >
                    STAR/XYZ PLAN
                  </button>
                </div>

                {activeTab === "keyword" ? (
                  <div className="space-y-4 font-mono text-xs">
                    <div className="flex items-center justify-between text-[#859397] uppercase tracking-wider border-b border-white/5 pb-2">
                      <span>CORE COMPETENCY</span>
                      <span>STATUS</span>
                    </div>

                    <div className="space-y-3">
                      {atsResult.keyword_matrix.required.length === 0 ? (
                        <p className="text-[#859397] py-2">No required keywords detected.</p>
                      ) : (
                        atsResult.keyword_matrix.required.map((kw) => {
                          const isPresent = atsResult.keyword_matrix.present.includes(kw);
                          return (
                            <div
                              key={kw}
                              className="flex items-center justify-between py-1 border-b border-white/5"
                            >
                              <span className="text-[#dfe2f3]">{kw}</span>
                              {isPresent ? (
                                <div className="flex items-center gap-1.5 text-[#8aebff]">
                                  <CheckCircle2 className="w-4 h-4" />
                                  <span className="font-semibold">Present</span>
                                </div>
                              ) : (
                                <div className="flex items-center gap-1.5 text-[#ffb4ab]">
                                  <AlertCircle className="w-4 h-4" />
                                  <span className="font-semibold">Missing</span>
                                </div>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>

                    <p className="text-[10px] text-[#859397] leading-relaxed pt-2 italic">
                      Note: Missing keywords are reported as an honest gap analysis — they reflect
                      terms absent from your master résumé, not suggestions to fabricate experience.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-3 font-mono text-xs">
                    {atsResult.star_xyz_breakdown.length === 0 ? (
                      <p className="text-[#859397] py-2">No STAR/XYZ suggestions available.</p>
                    ) : (
                      atsResult.star_xyz_breakdown.map((item, idx) => (
                        <div
                          key={`${item.section_name}-${idx}`}
                          className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-2"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-semibold text-[#8aebff] uppercase tracking-wide">
                              {item.section_name}
                            </span>
                            {item.issue && (
                              <span className="text-[9px] text-[#ffd6a3] px-2 py-0.5 bg-[#ffd6a3]/10 rounded border border-[#ffd6a3]/20 uppercase">
                                {item.issue}
                              </span>
                            )}
                          </div>
                          {item.current_text && (
                            <p className="text-[#859397] line-through/0">
                              <span className="text-[9px] uppercase tracking-wider text-[#859397]/60 block mb-0.5">
                                Current
                              </span>
                              {item.current_text}
                            </p>
                          )}
                          <p className="text-[#dfe2f3] bg-[#8aebff]/5 border border-[#8aebff]/20 rounded p-2 leading-relaxed">
                            <span className="text-[9px] uppercase tracking-wider text-[#8aebff] block mb-0.5">
                              Optimized
                            </span>
                            {item.optimized_text}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>

              {/* Modal footer actions */}
              <div className="p-6 bg-white/5 border-t border-white/5 flex flex-col sm:flex-row gap-3">
                <button
                  onClick={() => openApply(atsResult.job_ref, atsResult.keyword_matrix.missing)}
                  className="flex-1 bg-[#a3e635]/10 border border-[#a3e635]/40 text-[#a3e635] hover:bg-[#a3e635] hover:text-[#0a0e1a] py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer"
                  title="Apply the changes to your uploaded .docx, keeping its exact format"
                >
                  <ClipboardCheck className="w-4.5 h-4.5" /> APPLY TO MY .DOCX
                </button>
                <button
                  onClick={() => openInGoogleDoc(atsResult.job_ref)}
                  disabled={docLoading}
                  className="flex-1 bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-50"
                  title="Create a Google Doc with your résumé + the changes to make"
                >
                  {docLoading ? (
                    <><RefreshCw className="w-4.5 h-4.5 animate-spin" /> CREATING DOC…</>
                  ) : (
                    <><FileText className="w-4.5 h-4.5" /> OPEN IN GOOGLE DOCS</>
                  )}
                </button>
                <button
                  onClick={() =>
                    window.open(
                      `/ats/${encodeURIComponent(atsResult.job_ref)}/download`,
                      "_blank"
                    )
                  }
                  className="flex-1 bg-[#22d3ee] hover:bg-[#8aebff] text-[#00363e] py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer shadow-lg hover:scale-[1.01]"
                >
                  <Download className="w-4.5 h-4.5" />
                  DOWNLOAD TEXT FILE
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Résumé modal */}
      <AnimatePresence>
        {resumeOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ y: 30, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 30, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 180 }}
              className="w-full max-w-2xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#8aebff]/20 flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-start">
                <div>
                  <h2 className="text-xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono">
                    Master Résumé
                  </h2>
                  <p className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mt-1">
                    Template used for all ATS analysis
                  </p>
                </div>
                <button
                  onClick={() => setResumeOpen(false)}
                  aria-label="Close résumé modal"
                  className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#8aebff] transition-all rounded-full border border-white/5 cursor-pointer flex items-center justify-center"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 flex-1 overflow-y-auto">
                {resumeLoading ? (
                  <div className="flex items-center justify-center py-16 font-mono text-xs text-[#859397]">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading résumé…
                  </div>
                ) : (
                  <textarea
                    value={resumeContent}
                    onChange={(e) => setResumeContent(e.target.value)}
                    placeholder="Paste your master résumé text here — or use “Upload PDF / DOC” below to import a file…"
                    className="w-full min-h-[320px] bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-4 font-mono text-xs text-[#dfe2f3] leading-relaxed focus:outline-none focus:border-[#8aebff]/40 resize-y"
                  />
                )}
              </div>

              <div className="p-6 bg-white/5 border-t border-white/5 flex justify-between items-center gap-3">
                {/* Upload a PDF / DOCX / TXT — extracted server-side and loaded into the editor */}
                <input
                  ref={resumeFileRef}
                  type="file"
                  accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) uploadResumeFile(f);
                  }}
                />
                <button
                  onClick={() => resumeFileRef.current?.click()}
                  disabled={resumeUploading || resumeLoading}
                  className="px-4 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  title="Upload a PDF, DOCX, or TXT résumé"
                >
                  {resumeUploading ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> READING…</>
                  ) : (
                    <><Upload className="w-3.5 h-3.5" /> UPLOAD PDF / DOC</>
                  )}
                </button>
                <div className="flex gap-3">
                <button
                  onClick={() => setResumeOpen(false)}
                  className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 transition-all cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  onClick={saveResume}
                  disabled={resumeSaving || resumeLoading}
                  className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#22d3ee] hover:bg-[#8aebff] text-[#00363e] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {resumeSaving ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" /> SAVING…
                    </>
                  ) : (
                    "SAVE RÉSUMÉ"
                  )}
                </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Manually add a job applied elsewhere */}
      <AnimatePresence>
        {addOpen && (
          <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[8vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setAddOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="relative w-full max-w-lg mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold font-mono tracking-wide text-[#8aebff] flex items-center gap-2">
                    <Plus className="w-5 h-5" /> ADD A JOB
                  </h3>
                  <p className="text-[11px] font-mono text-[#859397] mt-1">
                    Track a role you applied to elsewhere — LinkedIn, Naukri, a company careers page.
                  </p>
                </div>
                <button
                  onClick={() => setAddOpen(false)}
                  aria-label="Close add-job modal"
                  className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white hover:border-white/30 transition-all cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                    Job Title <span className="text-[#ffb4ab]">*</span>
                  </label>
                  <input
                    value={manual.title}
                    onChange={(e) => setManual((m) => ({ ...m, title: e.target.value }))}
                    autoFocus
                    placeholder="e.g. Senior Data Analyst"
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                      Company
                    </label>
                    <input
                      value={manual.company}
                      onChange={(e) => setManual((m) => ({ ...m, company: e.target.value }))}
                      placeholder="e.g. Acme Corp"
                      className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                      Location
                    </label>
                    <input
                      value={manual.location}
                      onChange={(e) => setManual((m) => ({ ...m, location: e.target.value }))}
                      placeholder="e.g. Hyderabad / Remote"
                      className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                    Job URL
                  </label>
                  <input
                    value={manual.url}
                    onChange={(e) => setManual((m) => ({ ...m, url: e.target.value }))}
                    placeholder="https://…"
                    className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                      Applied via
                    </label>
                    <input
                      value={manual.source}
                      onChange={(e) => setManual((m) => ({ ...m, source: e.target.value }))}
                      placeholder="e.g. LinkedIn, Naukri"
                      className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                      Status
                    </label>
                    <div className="relative">
                      <select
                        value={manual.status}
                        onChange={(e) => setManual((m) => ({ ...m, status: e.target.value }))}
                        className="w-full appearance-none bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 pr-8 py-2.5 font-mono text-sm text-[#dfe2f3] uppercase focus:outline-none focus:border-[#8aebff]/40 cursor-pointer"
                      >
                        {(statuses.length ? statuses : ["interested", "applied", "interviewing", "offer", "accepted", "rejected"]).map((s) => (
                          <option key={s} value={s} className="bg-[#0a0e1a] text-[#dfe2f3]">
                            {s.toUpperCase()}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className="w-4 h-4 text-[#859397] absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                    </div>
                  </div>
                </div>

                {addError && <p className="text-xs font-mono text-[#ffb4ab]">{addError}</p>}
              </div>

              <div className="p-6 pt-0 flex justify-end gap-3">
                <button
                  onClick={() => setAddOpen(false)}
                  className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 transition-all cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  onClick={saveManual}
                  disabled={addSaving}
                  className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {addSaving ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> ADDING…</>
                  ) : (
                    <><Plus className="w-3.5 h-3.5" /> ADD TO BOARD</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Scan result popup */}
      <AnimatePresence>
        {scanOpen && scanResult && (
          <div className="fixed inset-0 z-[140] flex items-center justify-center px-4 bg-[#0a0e1a]/80 backdrop-blur-md">
            <div className="absolute inset-0" onClick={() => setScanOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.96 }}
              className="relative w-full max-w-md bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl p-6 text-center"
            >
              <button
                onClick={() => setScanOpen(false)}
                aria-label="Close scan result"
                className="absolute top-4 right-4 w-8 h-8 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white transition-all cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>

              {(() => {
                const r = scanResult || {};
                const moved = r.moved || 0;
                const added = r.added || 0;
                const pend = r.pending || 0;
                const scanned = r.scanned || 0;
                const total = moved + added + pend;

                if (r.error) {
                  return (
                    <>
                      <AlertCircle className="w-12 h-12 text-[#ffb4ab] mx-auto mb-3" />
                      <h3 className="text-lg font-bold font-mono text-[#ffb4ab]">Couldn't scan your email</h3>
                      <p className="text-sm text-[#bbc9cd] mt-2">{String(r.error)}</p>
                      <p className="text-[11px] font-mono text-[#859397] mt-3">
                        Your Gmail connection may need re-authorising. Nothing on your board was changed.
                      </p>
                    </>
                  );
                }

                if (total === 0) {
                  return (
                    <>
                      <Mail className="w-12 h-12 text-[#8aebff] mx-auto mb-3" />
                      <h3 className="text-lg font-bold font-mono text-[#dfe2f3]">No new job updates</h3>
                      <p className="text-sm text-[#bbc9cd] mt-2">
                        {scanned > 0
                          ? `I read ${scanned} recent email${scanned === 1 ? "" : "s"} — none were about your job applications. Your board is up to date.`
                          : "No new emails to scan since last time. Your board is up to date."}
                      </p>
                    </>
                  );
                }

                return (
                  <>
                    <CheckCircle2 className="w-12 h-12 text-[#a3e635] mx-auto mb-3" />
                    <h3 className="text-lg font-bold font-mono text-[#dfe2f3]">Board updated</h3>
                    <p className="text-[11px] font-mono text-[#859397] mt-1">
                      Read {scanned} recent email{scanned === 1 ? "" : "s"}.
                    </p>
                    <div className="mt-4 space-y-2 text-left">
                      {moved > 0 && (
                        <div className="flex items-center gap-2 text-sm text-[#dfe2f3]">
                          <span className="text-[#a3e635]">📨</span> Moved <b>{moved}</b> application{moved === 1 ? "" : "s"} forward
                        </div>
                      )}
                      {added > 0 && (
                        <div className="flex items-center gap-2 text-sm text-[#dfe2f3]">
                          <span className="text-[#8aebff]">➕</span> Added <b>{added}</b> new card{added === 1 ? "" : "s"} from your email
                        </div>
                      )}
                      {pend > 0 && (
                        <div className="flex items-center gap-2 text-sm text-[#dfe2f3]">
                          <span className="text-[#ffd6a3]">🔎</span> <b>{pend}</b> need{pend === 1 ? "s" : ""} your confirmation below
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}

              <button
                onClick={() => setScanOpen(false)}
                className="mt-6 w-full py-2.5 rounded-lg text-sm font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] transition-all cursor-pointer"
              >
                GOT IT
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Paste-a-JD modal — for cards with no job description */}
      <AnimatePresence>
        {jdOpen && (
          <div className="fixed inset-0 z-[135] flex items-start justify-center pt-[8vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setJdOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="relative w-full max-w-lg mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold font-mono tracking-wide text-[#8aebff] flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5" /> PASTE THE JOB DESCRIPTION
                  </h3>
                  <p className="text-[11px] font-mono text-[#859397] mt-1">
                    {jdForTitle} has no description saved — quick-apply / email / manual cards don't include one.
                    Paste the posting and I'll score your résumé against it (saved to this card for next time).
                  </p>
                </div>
                <button
                  onClick={() => setJdOpen(false)}
                  aria-label="Close paste-JD modal"
                  className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white hover:border-white/30 transition-all cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-4">
                <textarea
                  value={jdText}
                  onChange={(e) => setJdText(e.target.value)}
                  autoFocus
                  placeholder="Paste the full job description here — responsibilities, requirements, skills…"
                  className="w-full min-h-[240px] bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-4 font-mono text-xs text-[#dfe2f3] leading-relaxed focus:outline-none focus:border-[#8aebff]/40 resize-y"
                />
                {jdError && <p className="text-xs font-mono text-[#ffb4ab]">{jdError}</p>}
                <p className="text-[10px] font-mono text-[#859397]">
                  No posting handy? Close this and use <span className="text-[#a3e635]">RÉSUMÉ AUDIT</span> for a general, job-agnostic check.
                </p>
              </div>

              <div className="p-6 pt-0 flex justify-end gap-3">
                <button
                  onClick={() => setJdOpen(false)}
                  className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 transition-all cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  onClick={submitJd}
                  disabled={jdBusy}
                  className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {jdBusy ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> ANALYZING…</>
                  ) : (
                    <><Gauge className="w-3.5 h-3.5" /> SCORE MY RÉSUMÉ</>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Résumé Audit modal (general, job-agnostic) */}
      <AnimatePresence>
        {auditOpen && (
          <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[6vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setAuditOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="relative w-full max-w-3xl mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl flex flex-col"
            >
              {/* Header */}
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold font-mono tracking-wide text-[#a3e635] flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5" /> RÉSUMÉ AUDIT
                  </h3>
                  <p className="text-[11px] font-mono text-[#859397] mt-1">
                    General health check — why your résumé is / isn't getting calls. Not tied to any job.
                  </p>
                </div>
                <button onClick={() => setAuditOpen(false)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white hover:border-white/30 transition-all cursor-pointer">
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-6">
                {auditFetching ? (
                  <div className="flex items-center justify-center py-16 font-mono text-xs text-[#859397]">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Loading…
                  </div>
                ) : !audit ? (
                  <div className="flex flex-col items-center text-center py-10 gap-4">
                    <Gauge className="w-12 h-12 text-[#a3e635]/40" />
                    <p className="text-sm text-[#bbc9cd] max-w-md">
                      Run a full audit of your saved master résumé. JARVIS reviews it like a senior recruiter +
                      ATS specialist — structure, gaps, missing sections, impact, grammar, keywords, and the top
                      changes to get more interview calls.
                    </p>
                    {auditError && <p className="text-xs font-mono text-[#ffb4ab]">{auditError}</p>}
                    <button
                      onClick={runAudit}
                      disabled={auditRunning}
                      className="px-6 py-2.5 rounded-lg text-sm font-bold bg-[#a3e635] hover:bg-[#bef264] text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                    >
                      {auditRunning ? <><RefreshCw className="w-4 h-4 animate-spin" /> AUDITING…</> : <><Sparkles className="w-4 h-4" /> RUN AUDIT</>}
                    </button>
                  </div>
                ) : (
                  <>
                    {/* Scores */}
                    <div className="grid grid-cols-2 gap-4">
                      {[
                        { label: "Overall Score", val: audit.overall_score },
                        { label: "ATS Parse Score", val: audit.ats_parse_score },
                      ].map((s) => {
                        const v = Number(s.val) || 0;
                        const c = v >= 80 ? "#5eead4" : v >= 60 ? "#ffd6a3" : "#ffb4ab";
                        return (
                          <div key={s.label} className="p-4 rounded-xl bg-[#1b1f2c]/50 border border-white/5 text-center">
                            <div className="text-4xl font-bold font-mono" style={{ color: c }}>{v}<span className="text-lg text-[#859397]">/100</span></div>
                            <div className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mt-1">{s.label}</div>
                          </div>
                        );
                      })}
                    </div>

                    {/* Verdict */}
                    {audit.verdict && (
                      <div className="p-4 rounded-xl bg-[#8aebff]/5 border border-[#8aebff]/20">
                        <p className="text-sm text-[#dfe2f3] leading-relaxed">{audit.verdict}</p>
                      </div>
                    )}

                    {/* Top priorities */}
                    {Array.isArray(audit.top_priorities) && audit.top_priorities.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#a3e635] mb-2">🎯 Top priorities — do these first</h4>
                        <ol className="space-y-1.5">
                          {audit.top_priorities.map((p: string, i: number) => (
                            <li key={i} className="flex gap-2 text-sm text-[#dfe2f3]">
                              <span className="text-[#a3e635] font-bold font-mono">{i + 1}.</span>
                              <span>{p}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}

                    {/* Section checklist */}
                    {Array.isArray(audit.sections) && audit.sections.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2">Section check</h4>
                        <div className="flex flex-wrap gap-2">
                          {audit.sections.map((sec: any, i: number) => {
                            const st = (sec.status || "").toLowerCase();
                            const cls = st === "present" ? "text-[#5eead4] border-[#5eead4]/30 bg-[#5eead4]/10"
                              : st === "missing" ? "text-[#ffb4ab] border-[#ffb4ab]/30 bg-[#ffb4ab]/10"
                              : "text-[#ffd6a3] border-[#ffd6a3]/30 bg-[#ffd6a3]/10";
                            return (
                              <span key={i} title={sec.note} className={`text-[11px] font-mono px-2 py-1 rounded border ${cls}`}>
                                {sec.name}: {sec.status}
                              </span>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Issues */}
                    {Array.isArray(audit.issues) && audit.issues.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2">Issues & fixes</h4>
                        <div className="space-y-2">
                          {audit.issues.map((it: any, i: number) => {
                            const sev = (it.severity || "").toLowerCase();
                            const c = sev === "high" ? "#ffb4ab" : sev === "medium" ? "#ffd6a3" : "#8aebff";
                            return (
                              <div key={i} className="p-3 rounded-lg bg-[#1b1f2c]/40 border border-white/5">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className="text-[9px] font-bold font-mono uppercase px-1.5 py-0.5 rounded" style={{ color: c, backgroundColor: `${c}1a` }}>{it.severity}</span>
                                  <span className="text-[10px] font-mono text-[#859397] uppercase">{it.category}</span>
                                </div>
                                <p className="text-[13px] text-[#dfe2f3]">{it.problem}</p>
                                {it.fix && <p className="text-[12px] text-[#5eead4] mt-1">→ {it.fix}</p>}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Missing */}
                    {Array.isArray(audit.missing) && audit.missing.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#ffb4ab] mb-2">Missing entirely</h4>
                        <ul className="list-disc list-inside space-y-1 text-sm text-[#dfe2f3]">
                          {audit.missing.map((m: string, i: number) => <li key={i}>{m}</li>)}
                        </ul>
                      </div>
                    )}

                    {/* Quantification */}
                    {audit.quantification && (
                      <div className="p-3 rounded-lg bg-[#1b1f2c]/40 border border-white/5">
                        <span className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397]">Impact / quantification</span>
                        <p className="text-[13px] text-[#dfe2f3] mt-1">
                          {audit.quantification.bullets_with_metrics ?? "?"} of {audit.quantification.total_bullets ?? "?"} bullets have metrics. {audit.quantification.note}
                        </p>
                      </div>
                    )}

                    {/* Grammar */}
                    {Array.isArray(audit.grammar) && audit.grammar.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2">Grammar & wording</h4>
                        <div className="space-y-2">
                          {audit.grammar.map((g: any, i: number) => (
                            <div key={i} className="text-[12px] font-mono">
                              <span className="text-[#ffb4ab] line-through">{g.original}</span>{" "}
                              <span className="text-[#5eead4]">→ {g.suggestion}</span>
                              {g.type && <span className="text-[9px] text-[#859397] ml-2">({g.type})</span>}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Keywords to add */}
                    {Array.isArray(audit.keywords_to_add) && audit.keywords_to_add.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2">Keywords to consider adding (only if genuine)</h4>
                        <div className="flex flex-wrap gap-1.5">
                          {audit.keywords_to_add.map((k: string, i: number) => (
                            <span key={i} className="text-[11px] font-mono px-2 py-0.5 rounded bg-[#8aebff]/10 border border-[#8aebff]/20 text-[#8aebff]">{k}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {auditError && <p className="text-xs font-mono text-[#ffb4ab]">{auditError}</p>}
                  </>
                )}
              </div>

              {/* Footer */}
              {audit && !auditFetching && (
                <div className="p-4 border-t border-white/5 flex items-center justify-between">
                  <span className="text-[10px] font-mono text-[#859397]">
                    {audit.created_at ? `Last run: ${new Date(audit.created_at).toLocaleString()}` : ""}
                  </span>
                  <button
                    onClick={runAudit}
                    disabled={auditRunning}
                    className="px-5 py-2 rounded-lg text-xs font-bold bg-[#a3e635]/10 border border-[#a3e635]/30 text-[#a3e635] hover:bg-[#a3e635] hover:text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {auditRunning ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> RE-AUDITING…</> : <><RefreshCw className="w-3.5 h-3.5" /> RE-RUN AUDIT</>}
                  </button>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Apply-to-.docx modal (format-preserving, Option A) */}
      <AnimatePresence>
        {applyOpen && (
          <div className="fixed inset-0 z-[130] flex items-start justify-center pt-[10vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setApplyOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 20, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              className="relative w-full max-w-lg mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl"
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold font-mono tracking-wide text-[#a3e635] flex items-center gap-2">
                    <ClipboardCheck className="w-5 h-5" /> APPLY TO MY .DOCX
                  </h3>
                  <p className="text-[11px] font-mono text-[#859397] mt-1">
                    Edits your uploaded .docx in place — keeps your exact fonts & layout.
                  </p>
                </div>
                <button onClick={() => setApplyOpen(false)} className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white transition-all cursor-pointer">
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-5">
                {hasDocx === null ? (
                  <div className="flex items-center justify-center py-10 font-mono text-xs text-[#859397]">
                    <RefreshCw className="w-4 h-4 animate-spin mr-2" /> Checking…
                  </div>
                ) : hasDocx === false ? (
                  <div className="text-center py-6 space-y-3">
                    <AlertCircle className="w-10 h-10 text-[#ffd6a3] mx-auto" />
                    <p className="text-sm text-[#dfe2f3]">No <span className="font-mono">.docx</span> on file to edit.</p>
                    <p className="text-xs text-[#859397]">
                      Open <span className="text-[#8aebff]">Résumé → Upload PDF / DOC</span> and upload your résumé as a
                      <span className="font-mono"> .docx</span> (PDFs can't be edited in place), then try again.
                    </p>
                  </div>
                ) : applyResult ? (
                  <div className="text-center py-4 space-y-3">
                    <CheckCircle2 className="w-10 h-10 text-[#5eead4] mx-auto" />
                    <p className="text-sm text-[#dfe2f3]">
                      Applied <b>{applyResult.rewrites_applied}</b> of {applyResult.rewrites_total} rewrites
                      {applyResult.rewrites_missed > 0 && <span className="text-[#ffd6a3]"> ({applyResult.rewrites_missed} couldn't be located)</span>}
                      {applyResult.additions_applied > 0 && <>, plus {applyResult.additions_applied} addition(s)</>}.
                    </p>
                    <p className="text-xs text-[#859397]">
                      Your edited <span className="font-mono">.docx</span> has downloaded. Open it in Word, or drag it
                      into Google Drive to review it as a Google Doc — your format is preserved.
                    </p>
                    <button
                      onClick={() => window.open(applyResult.download, "_blank")}
                      className="mt-1 px-5 py-2 rounded-lg text-xs font-bold bg-[#a3e635]/10 border border-[#a3e635]/30 text-[#a3e635] hover:bg-[#a3e635] hover:text-[#0a0e1a] transition-all cursor-pointer inline-flex items-center gap-2"
                    >
                      <Download className="w-3.5 h-3.5" /> DOWNLOAD AGAIN
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="p-3 rounded-lg bg-[#8aebff]/5 border border-[#8aebff]/20 text-[13px] text-[#dfe2f3]">
                      ✍️ Your bullet <b>rewrites</b> will be applied automatically (format kept).
                    </div>
                    {applyMissing.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2">
                          Additions — tick only what you genuinely have/learned
                        </h4>
                        <div className="flex flex-wrap gap-2">
                          {applyMissing.map((kw) => {
                            const on = selectedAdd.includes(kw);
                            return (
                              <button
                                key={kw}
                                onClick={() => toggleAdd(kw)}
                                className={`text-[11px] font-mono px-2.5 py-1 rounded border transition-all cursor-pointer ${
                                  on ? "bg-[#a3e635] text-[#0a0e1a] border-[#a3e635]" : "bg-white/5 text-[#bbc9cd] border-white/10 hover:border-[#a3e635]/40"
                                }`}
                              >
                                {on ? "✓ " : "+ "}{kw}
                              </button>
                            );
                          })}
                        </div>
                        <p className="text-[10px] text-[#859397] mt-2">
                          Selected keywords get added to a Skills line. Add nothing you can't back up in an interview.
                        </p>
                      </div>
                    )}
                    {applyError && <p className="text-xs font-mono text-[#ffb4ab]">{applyError}</p>}
                    <button
                      onClick={runApply}
                      disabled={applying}
                      className="w-full py-3 rounded-lg text-sm font-bold bg-[#a3e635] hover:bg-[#bef264] text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2"
                    >
                      {applying ? <><RefreshCw className="w-4 h-4 animate-spin" /> EDITING YOUR .DOCX…</> : <><ClipboardCheck className="w-4 h-4" /> APPLY & DOWNLOAD</>}
                    </button>
                  </>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
