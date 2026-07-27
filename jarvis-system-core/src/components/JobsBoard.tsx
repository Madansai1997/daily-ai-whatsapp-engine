import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
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
  MoreHorizontal,
  SlidersHorizontal,
  Eye,
  Newspaper,
  Radio,
  Upload,
  ClipboardCheck,
  Gauge,
  UserCheck,
  Sparkles,
  Search,
  Target,
  Plus,
  Mail,
  Send,
  Clock,
  CalendarClock,
  StickyNote,
  Pin,
  Users,
  Megaphone,
  Volume2,
  Square,
  Wrench,
  BookOpen,
  Globe,
  ExternalLink,
} from "lucide-react";
import { getToken } from "../lib/auth";

interface JobsBoardProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId, intent?: string) => void;
  intent?: string | null;
  onIntentHandled?: () => void;
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
  reviewed?: number;
  apply_method?: string;
  ats_score?: number | null;
  ats_scored_at?: string | null;
  recruiter_score?: number | null;
  recruiter_scored_at?: string | null;
  news_count?: number;
  applied_at?: string | null;
  updated_at?: string | null;
  ghost_job_risk?: string | null;
  ghost_job_reasons?: string | null;
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
  domain_mismatch?: { mismatched: boolean; reason: string };
  ghost_job_risk?: string | null;
  ghost_job_reasons?: string[] | null;
}

interface AtsErrorResult {
  error: string;
}

interface RecruiterReview {
  role_fit_score: number;
  verdict: string;
  six_second_test: {
    role_clear: boolean;
    skills_clear: boolean;
    impact_clear: boolean;
    note: string;
  };
  strengths: string[];
  red_flags: string[];
  learning_roadmap: {
    skill: string;
    importance: "high" | "medium" | "low";
    reason: string;
    est_time: string;
  }[];
}

interface JobPrep {
  job_ref: string;
  outreach_linkedin: string;
  outreach_email: string;
  star_stories: {
    question: string;
    situation: string;
    task: string;
    action: string;
    result: string;
  }[];
  created_at?: string;
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

const scoreToGrade = (score: number | null | undefined): string => {
  if (score == null || typeof score !== "number") return "—";
  if (score >= 90) return "A";
  if (score >= 80) return "B";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
};

/* Apply-method tag — email-apply jobs can auto-send; link jobs you submit on the board yourself. */
const ApplyTag = ({ method }: { method?: string }) =>
  method === "email" ? (
    <span title="Email-apply — your tailored résumé + note can be auto-sent" className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#a3e635]/10 border border-[#a3e635]/30 text-[#a3e635] whitespace-nowrap inline-flex items-center gap-1">
      <Mail className="w-3 h-3" /> Email-apply
    </span>
  ) : (
    <span title="Apply on the job site — résumé & cover prepped, you submit on their page" className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[#859397] whitespace-nowrap inline-flex items-center gap-1">
      <ArrowUpRight className="w-3 h-3" /> Apply on site
    </span>
  );

// Tiny markdown renderer — enough for LLM briefs & notes (## headings, - bullets, **bold**).
function renderMarkdown(md: string): React.ReactNode {
  const lines = (md || "").split("\n");
  const bold = (t: string) =>
    t.split(/(\*\*[^*]+\*\*)/g).map((seg, i) =>
      seg.startsWith("**") && seg.endsWith("**")
        ? <b key={i} className="text-[#dfe2f3]">{seg.slice(2, -2)}</b>
        : <React.Fragment key={i}>{seg}</React.Fragment>);
  return lines.map((ln, i) => {
    const t = ln.trim();
    if (!t) return <div key={i} className="h-2" />;
    if (t.startsWith("## ")) return <h4 key={i} className="text-sm font-bold font-mono text-[#8aebff] uppercase tracking-wide mt-3 mb-1">{t.slice(3)}</h4>;
    if (t.startsWith("# ")) return <h3 key={i} className="text-base font-bold text-[#dfe2f3] mt-3 mb-1">{t.slice(2)}</h3>;
    if (/^[-*]\s+/.test(t)) return <div key={i} className="flex gap-2 text-[13px] text-[#bbc9cd] pl-1"><span className="text-[#5eead4]">•</span><span>{bold(t.replace(/^[-*]\s+/, ""))}</span></div>;
    return <p key={i} className="text-[13px] text-[#bbc9cd] leading-relaxed">{bold(t)}</p>;
  });
}

// Whole days since an ISO timestamp (normalizes naive UTC); null if unparseable.
function daysSince(ts?: string | null): number | null {
  if (!ts) return null;
  let s = ts.trim();
  if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(s) && !/([zZ]|[+-]\d{2}:?\d{2})$/.test(s)) {
    s = s.replace(" ", "T") + "Z";
  }
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

export default function JobsBoard({ activeScreen, onNavigate, intent, onIntentHandled }: JobsBoardProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<"keyword" | "star" | "recruiter" | "prep" | "error">("keyword");
  const [atsResult, setAtsResult] = useState<AtsResult | null>(null);
  const [atsLoadingId, setAtsLoadingId] = useState<number | null>(null);
  const [docLoading, setDocLoading] = useState(false);
  // Recruiter feedback — separate on-demand LLM call, lazy-loaded when its tab opens.
  const [recruiterReview, setRecruiterReview] = useState<RecruiterReview | null>(null);
  const [recruiterLoading, setRecruiterLoading] = useState(false);
  const [recruiterError, setRecruiterError] = useState<string | null>(null);

  // Outreach & STAR Prep — separate on-demand LLM call, lazy-loaded when its tab opens.
  const [jobPrep, setJobPrep] = useState<JobPrep | null>(null);
  const [prepLoading, setPrepLoading] = useState(false);
  const [prepError, setPrepError] = useState<string | null>(null);

  // Gemini Live Search Dossier
  const [dossierData, setDossierData] = useState<any | null>(null);
  const [dossierLoading, setDossierLoading] = useState(false);
  const [dossierError, setDossierError] = useState<string | null>(null);

  // Gemini Multimodal Vision Job Scanner
  const [scanningImage, setScanningImage] = useState(false);
  const imageFileRef = useRef<HTMLInputElement>(null);

  const openDossierTab = async (jobRef: string) => {
    setActiveTab("dossier");
    setDossierLoading(true);
    setDossierError(null);
    try {
      const tok = getToken();
      const res = await fetch(`/ats/${encodeURIComponent(jobRef)}/dossier`, {
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
      });
      const data = await res.json();
      if (data.dossier) {
        setDossierData(data);
      } else {
        const genRes = await fetch(`/ats/${encodeURIComponent(jobRef)}/dossier`, {
          method: "POST",
          headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        });
        const genData = await genRes.json();
        if (genData.dossier) {
          setDossierData(genData);
        } else {
          setDossierError(genData.error || "Failed to generate Live Search dossier.");
        }
      }
    } catch {
      setDossierError("Error reaching the dossier engine.");
    } finally {
      setDossierLoading(false);
    }
  };

  const handleImageScan = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      alert("Please upload an image file (PNG/JPG/WebP).");
      return;
    }
    setScanningImage(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const tok = getToken();
      const res = await fetch("/api/jobs/upload-image", {
        method: "POST",
        headers: tok ? { Authorization: `Bearer ${tok}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (data.ok) {
        alert(`Successfully scanned job: ${data.title} @ ${data.company}`);
        loadApplications();
      } else {
        alert(`Image scan failed: ${data.error || "Unknown error"}`);
      }
    } catch {
      alert("Error uploading image for scanning.");
    } finally {
      setScanningImage(false);
      if (imageFileRef.current) imageFileRef.current.value = "";
    }
  };

  // ATS Deep Scout state & handlers
  const [atsSearchOpen, setAtsSearchOpen] = useState(false);
  const [atsRole, setAtsRole] = useState("Data Analyst");
  const [atsExperience, setAtsExperience] = useState("2+ years");
  const [atsLocation, setAtsLocation] = useState("India");
  const [atsResults, setAtsResults] = useState<any[]>([]);
  const [atsSearching, setAtsSearching] = useState(false);
  const [atsError, setAtsError] = useState("");
  const [atsHasSearched, setAtsHasSearched] = useState(false);

  const searchAtsJobs = async () => {
    setAtsSearching(true);
    setAtsHasSearched(true);
    setAtsError("");
    setAtsResults([]);
    try {
      const tok = getToken();
      const res = await fetch("/api/job-scout/ats-search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { "X-Jarvis-Token": tok, Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify({ role: atsRole, experience: atsExperience, location: atsLocation }),
      });
      const data = await res.json();
      if (!res.ok || data.error) throw new Error(data.error || "Failed to search ATS jobs");
      setAtsResults(data.jobs || []);
    } catch (e: any) {
      setAtsError(e.message || String(e));
    } finally {
      setAtsSearching(false);
    }
  };

  const importAtsJob = async (job: any) => {
    try {
      const payload = {
        title: job.title,
        company: job.company,
        location: job.location,
        url: job.url,
        source: "ATS Deep Scout",
        status: "interested",
        description: `Source ATS: ${job.ats}\nRequired Experience: ${job.experience}`,
        notes: `Imported via direct careers page search.`,
      };
      const tok = getToken();
      const res = await fetch("/applications/add-manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(tok ? { Authorization: `Bearer ${tok}` } : {}),
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || "Import failed");
      }
      alert(`Imported ${job.title} @ ${job.company} successfully!`);
      await loadApplications();
    } catch (e: any) {
      alert(`Failed to import: ${e.message}`);
    }
  };

  // Résumé modal
  const [resumeOpen, setResumeOpen] = useState(false);
  const [resumeContent, setResumeContent] = useState("");
  const [resumeLoading, setResumeLoading] = useState(false);
  const [resumeSaving, setResumeSaving] = useState(false);
  const [resumeUploading, setResumeUploading] = useState(false);
  const resumeFileRef = useRef<HTMLInputElement>(null);
  const auditResumeFileRef = useRef<HTMLInputElement>(null);
  const [activeAtsAppId, setActiveAtsAppId] = useState<number | null>(null);
  const [auditApplying, setAuditApplying] = useState(false);
  const [autoFixing, setAutoFixing] = useState(false);
  const [autoFixMsg, setAutoFixMsg] = useState("");
  const [deletingResume, setDeletingResume] = useState(false);
  const [selectedAuditKeywords, setSelectedAuditKeywords] = useState<string[]>([]);
  const [selectedGrammar, setSelectedGrammar] = useState<any[]>([]);

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
    description: "",
    notes: "",
  };
  const [manual, setManual] = useState({ ...emptyManual });

  // Email → board sync: pending confirmations + on-demand scan
  const [pending, setPending] = useState<any[]>([]);
  const [pendingBusy, setPendingBusy] = useState<number | null>(null);
  const [scanning, setScanning] = useState(false);
  const [searchingJobs, setSearchingJobs] = useState(false);
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

  // Job Scout review queue (per-job review popup)
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQueue, setReviewQueue] = useState<any[]>([]);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewCount, setReviewCount] = useState(0);
  const [reviewBusyId, setReviewBusyId] = useState<number | null>(null);
  const [reviewExpanded, setReviewExpanded] = useState<number | null>(null);
  const [reviewStage, setReviewStage] = useState<Record<number, string>>({});
  const [reviewAts, setReviewAts] = useState<Record<string, AtsResult | "loading">>({});
  const [reviewMsg, setReviewMsg] = useState("");

  // Recruiter follow-ups (stale 'applied' cards → drafted follow-up → 1-tap Gmail send)
  const [followOpen, setFollowOpen] = useState(false);
  const [followCands, setFollowCands] = useState<any[]>([]);
  const [followCount, setFollowCount] = useState(0);
  const [followLoading, setFollowLoading] = useState(false);
  const [followDraft, setFollowDraft] = useState<any | null>(null); // {id, subject, body, recipient, card}
  const [followBusyId, setFollowBusyId] = useState<number | null>(null);
  const [followSending, setFollowSending] = useState(false);
  const [followMsg, setFollowMsg] = useState("");

  // Per-company email timeline (Gmail search by company/domain)
  const [emailsOpen, setEmailsOpen] = useState(false);
  const [emailsFor, setEmailsFor] = useState<{ id: number; title: string; company: string } | null>(null);
  const [emailThreads, setEmailThreads] = useState<any[]>([]);
  const [emailsLoading, setEmailsLoading] = useState(false);

  // Interview prep dock (upcoming calendar interviews → on-demand LLM brief)
  const [prepOpen, setPrepOpen] = useState(false);
  const [interviews, setInterviews] = useState<any[]>([]);
  const [interviewsLoading, setInterviewsLoading] = useState(false);
  const [prepBrief, setPrepBrief] = useState<{ ev: any; markdown: string } | null>(null);
  const [prepBusyId, setPrepBusyId] = useState<string | null>(null);

  // Workspace notes (DB-backed markdown scratchpad)
  const [notesOpen, setNotesOpen] = useState(false);
  const [notes, setNotes] = useState<any[]>([]);
  const [notesLoading, setNotesLoading] = useState(false);
  const [activeNote, setActiveNote] = useState<any | null>(null);
  const [noteDraft, setNoteDraft] = useState({ title: "", body: "" });
  const [notesSaving, setNotesSaving] = useState(false);

  // Networking CRM (contacts + follow-up cadence)
  const emptyContact = { name: "", role: "", company: "", email: "", linkedin: "", relationship: "recruiter", follow_up_days: 14, notes: "" };
  const [networkOpen, setNetworkOpen] = useState(false);
  const [contacts, setContacts] = useState<any[]>([]);
  const [contactRels, setContactRels] = useState<string[]>(["recruiter", "referrer", "hiring_manager", "peer", "mentor", "other"]);
  const [contactsLoading, setContactsLoading] = useState(false);
  const [activeContact, setActiveContact] = useState<any | null>(null); // null=list, {id:null}=new, obj=edit
  const [contactDraft, setContactDraft] = useState({ ...emptyContact });
  const [contactSaving, setContactSaving] = useState(false);
  // People Watch — watch a contact's free feeds → networking nudges
  const [contactFeeds, setContactFeeds] = useState<any[]>([]);
  const [feedForm, setFeedForm] = useState({ platform: "rss", handle: "", name: "" });
  const [feedBusy, setFeedBusy] = useState(false);
  const [feedErr, setFeedErr] = useState("");
  const [nudges, setNudges] = useState<any[]>([]);

  // Voice daily standup (LLM briefing + browser TTS, optional Gemini natural voice)
  const [standupOpen, setStandupOpen] = useState(false);
  const [standupLoading, setStandupLoading] = useState(false);
  const [standupText, setStandupText] = useState("");
  const [speaking, setSpeaking] = useState(false);
  const [ttsAvailable, setTtsAvailable] = useState(false);
  const [naturalVoice, setNaturalVoice] = useState<boolean>(() => {
    try { return localStorage.getItem("jarvis_natural_voice") === "1"; } catch { return false; }
  });
  const [voices, setVoices] = useState<{ name: string; style: string }[]>([]);
  const [voice, setVoice] = useState<string>(() => {
    try { return localStorage.getItem("jarvis_tts_voice") || ""; } catch { return ""; }
  });
  const [previewing, setPreviewing] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Toolbar overflow — collapses the agent tools into one dropdown
  const [toolsOpen, setToolsOpen] = useState(false);

  // Board-level organization (all client-side over already-loaded data — no new backend calls).
  const [query, setQuery] = useState("");
  const [atsMin, setAtsMin] = useState(0);
  const [methodFilter, setMethodFilter] = useState<"" | "email" | "link">("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [focusMode, setFocusMode] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [collapsedCols, setCollapsedCols] = useState<Record<string, boolean>>({ accepted: true, rejected: true });
  const [expandedCols, setExpandedCols] = useState<Record<string, boolean>>({});
  // Per-card overflow (⋯) menu — positioned fixed so it escapes the card's overflow-hidden.
  const [cardMenu, setCardMenu] = useState<{ id: number; x: number; y: number } | null>(null);
  // Company intel (news + interview brief) lazy-loaded when a card's ⋯ menu opens.
  const [cardIntel, setCardIntel] = useState<{ news: any[]; brief: any | null; loading: boolean } | null>(null);
  const COLUMN_CAP = 8;

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

  const loadReviewCount = useCallback(async () => {
    try {
      const res = await fetch("/api/job-scout/review-queue/count");
      const data = await res.json();
      setReviewCount(Number(data?.count) || 0);
    } catch {
      setReviewCount(0);
    }
  }, []);

  // Load the fresh-match queue that feeds the NEW column (called on mount + after decisions).
  const loadReviewQueue = useCallback(async () => {
    setReviewLoading(true);
    try {
      const res = await fetch("/api/job-scout/review-queue");
      const data = await res.json();
      const q = Array.isArray(data?.cards)
        ? data.cards
        : Array.isArray(data?.queue)
        ? data.queue
        : [];
      setReviewQueue(q);
      setStatuses(Array.isArray(data?.statuses) ? data.statuses : statuses);
      const stageMap: Record<number, string> = {};
      q.forEach((c: any) => (stageMap[c.id] = "applied"));
      setReviewStage(stageMap);
    } catch {
      setReviewQueue([]);
    } finally {
      setReviewLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadFollowCount = useCallback(async () => {
    try {
      const res = await fetch("/api/followups");
      const data = await res.json();
      setFollowCount(Array.isArray(data?.candidates) ? data.candidates.length : 0);
    } catch {
      setFollowCount(0);
    }
  }, []);

  useEffect(() => {
    loadApplications();
    loadPending();
    loadReviewCount();
    loadReviewQueue();
    loadFollowCount();
  }, [loadApplications, loadPending, loadReviewCount, loadReviewQueue, loadFollowCount]);

  // When a card's ⋯ menu opens, lazy-load its company intel (news + interview brief).
  useEffect(() => {
    if (!cardMenu) { setCardIntel(null); return; }
    const card = applications.find((a) => a.id === cardMenu.id);
    if (!card || (!(card.news_count && card.news_count > 0) && card.status !== "interviewing")) {
      setCardIntel(null);
      return;
    }
    let alive = true;
    setCardIntel({ news: [], brief: null, loading: true });
    fetch(`/api/applications/${cardMenu.id}/intel`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (alive) setCardIntel(d ? { news: d.news || [], brief: d.brief || null, loading: false } : null); })
      .catch(() => { if (alive) setCardIntel(null); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardMenu?.id]);

  // Deep-link: when arriving from the Home cockpit with an intent, open the matching tool.
  useEffect(() => {
    if (!intent) return;
    const map: Record<string, () => void> = {
      review: loadReviewQueue, followups: openFollowups, interviews: openPrep,
      network: openNetwork, notes: openNotes, add: openAdd, standup: openStandup,
    };
    map[intent]?.();
    onIntentHandled?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intent]);

  /* ---- Recruiter follow-ups ---- */

  const openFollowups = async () => {
    setFollowOpen(true);
    setFollowLoading(true);
    setFollowDraft(null);
    setFollowMsg("");
    try {
      const res = await fetch("/api/followups");
      const data = await res.json();
      setFollowCands(Array.isArray(data?.candidates) ? data.candidates : []);
    } catch {
      setFollowCands([]);
    } finally {
      setFollowLoading(false);
    }
  };

  const draftFollowup = async (cand: any) => {
    setFollowBusyId(cand.id);
    setFollowMsg("");
    try {
      const res = await fetch(`/api/followups/${cand.id}/draft`, { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFollowDraft({ id: cand.id, subject: data.subject, body: data.body, recipient: data.recipient, card: data.card });
    } catch (e) {
      setFollowMsg(`Draft failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setFollowBusyId(null);
    }
  };

  const sendFollowup = async () => {
    if (!followDraft) return;
    setFollowSending(true);
    setFollowMsg("");
    try {
      const res = await fetch("/api/followups/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: followDraft.recipient, subject: followDraft.subject, body: followDraft.body, app_id: followDraft.id }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setFollowMsg(data.message || "Sent.");
      setFollowDraft(null);
      await Promise.all([openFollowups(), loadFollowCount()]);
    } catch (e) {
      setFollowMsg(`${e instanceof Error ? e.message : e}`);
    } finally {
      setFollowSending(false);
    }
  };

  /* ---- Per-company email timeline ---- */

  const openEmails = async (card: any) => {
    setEmailsOpen(true);
    setEmailsFor({ id: card.id, title: card.title, company: card.company });
    setEmailThreads([]);
    setEmailsLoading(true);
    try {
      const res = await fetch(`/api/applications/${card.id}/emails`);
      const data = await res.json();
      setEmailThreads(Array.isArray(data?.threads) ? data.threads : []);
    } catch {
      setEmailThreads([]);
    } finally {
      setEmailsLoading(false);
    }
  };

  /* ---- Interview prep dock ---- */

  const openPrep = async () => {
    setPrepOpen(true);
    setPrepBrief(null);
    setInterviewsLoading(true);
    try {
      const res = await fetch("/api/interviews");
      const data = await res.json();
      setInterviews(Array.isArray(data?.interviews) ? data.interviews : []);
    } catch {
      setInterviews([]);
    } finally {
      setInterviewsLoading(false);
    }
  };

  const buildPrep = async (ev: any) => {
    setPrepBusyId(ev.id);
    try {
      const res = await fetch("/api/interviews/prep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ev),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      setPrepBrief({ ev, markdown: data.markdown });
    } catch (e) {
      setPrepBrief({ ev, markdown: `_Prep failed: ${e instanceof Error ? e.message : e}_` });
    } finally {
      setPrepBusyId(null);
    }
  };

  /* ---- Workspace notes ---- */

  const openNotes = async () => {
    setNotesOpen(true);
    setActiveNote(null);
    setNotesLoading(true);
    try {
      const res = await fetch("/api/notes");
      const data = await res.json();
      setNotes(Array.isArray(data?.notes) ? data.notes : []);
    } catch {
      setNotes([]);
    } finally {
      setNotesLoading(false);
    }
  };

  const selectNote = (n: any) => {
    setActiveNote(n);
    setNoteDraft({ title: n.title || "", body: n.body || "" });
  };

  const newNote = () => {
    setActiveNote({ id: null });
    setNoteDraft({ title: "", body: "" });
  };

  const saveNote = async () => {
    setNotesSaving(true);
    try {
      const isNew = !activeNote?.id;
      const url = isNew ? "/api/notes" : `/api/notes/${activeNote.id}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: noteDraft.title, body: noteDraft.body }),
      });
      const data = await res.json();
      if (data?.note) setActiveNote(data.note);
      const list = await fetch("/api/notes").then((r) => r.json());
      setNotes(Array.isArray(list?.notes) ? list.notes : []);
    } catch { /* ignore */ } finally {
      setNotesSaving(false);
    }
  };

  const togglePinNote = async (n: any) => {
    try {
      await fetch(`/api/notes/${n.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pinned: n.pinned ? 0 : 1 }),
      });
      const list = await fetch("/api/notes").then((r) => r.json());
      setNotes(Array.isArray(list?.notes) ? list.notes : []);
    } catch { /* ignore */ }
  };

  const deleteNote = async (n: any) => {
    if (!confirm(`Delete note "${n.title}"?`)) return;
    try {
      await fetch(`/api/notes/${n.id}/delete`, { method: "POST" });
      if (activeNote?.id === n.id) setActiveNote(null);
      const list = await fetch("/api/notes").then((r) => r.json());
      setNotes(Array.isArray(list?.notes) ? list.notes : []);
    } catch { /* ignore */ }
  };

  /* ---- Networking CRM ---- */

  const loadContacts = async () => {
    const data = await fetch("/api/contacts").then((r) => r.json());
    setContacts(Array.isArray(data?.contacts) ? data.contacts : []);
    if (Array.isArray(data?.relationships)) setContactRels(data.relationships);
  };

  const loadNudges = async () => {
    try { const d = await fetch("/api/contacts/nudges", { cache: "no-store" }).then((r) => r.json()); setNudges(Array.isArray(d) ? d : []); } catch { setNudges([]); }
  };

  const openNetwork = async () => {
    setNetworkOpen(true);
    setActiveContact(null);
    setContactsLoading(true);
    try { await loadContacts(); await loadNudges(); } catch { setContacts([]); } finally { setContactsLoading(false); }
  };

  const loadContactFeeds = async (cid: number) => {
    try { const d = await fetch(`/api/contacts/${cid}/feeds`, { cache: "no-store" }).then((r) => r.json()); setContactFeeds(Array.isArray(d) ? d : []); } catch { setContactFeeds([]); }
  };

  const editContact = (c: any) => {
    setActiveContact(c);
    setContactDraft({ name: c.name || "", role: c.role || "", company: c.company || "", email: c.email || "", linkedin: c.linkedin || "", relationship: c.relationship || "recruiter", follow_up_days: c.follow_up_days || 14, notes: c.notes || "" });
    setContactFeeds([]); setFeedForm({ platform: "rss", handle: "", name: "" }); setFeedErr("");
    if (c.id) loadContactFeeds(c.id);
  };
  const newContact = () => { setActiveContact({ id: null }); setContactDraft({ ...emptyContact }); setContactFeeds([]); };

  const addContactFeed = async () => {
    if (!activeContact?.id || !feedForm.handle.trim()) { setFeedErr("Feed URL / channel required."); return; }
    setFeedBusy(true); setFeedErr("");
    try {
      const res = await fetch(`/api/contacts/${activeContact.id}/feeds`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(feedForm) });
      const d = await res.json();
      if (!res.ok || !d?.ok) throw new Error(d?.result || "Failed to add feed");
      setFeedForm({ platform: "rss", handle: "", name: "" });
      await loadContactFeeds(activeContact.id);
    } catch (e) { setFeedErr(e instanceof Error ? e.message : String(e)); } finally { setFeedBusy(false); }
  };
  const deleteContactFeed = async (fid: number) => {
    try { await fetch(`/api/contacts/feeds/${fid}/delete`, { method: "POST" }); if (activeContact?.id) await loadContactFeeds(activeContact.id); } catch { /* ignore */ }
  };
  const dismissNudge = async (postId: string) => {
    try { await fetch(`/api/contacts/nudges/${encodeURIComponent(postId)}/dismiss`, { method: "POST" }); await loadNudges(); } catch { /* ignore */ }
  };

  const saveContact = async () => {
    setContactSaving(true);
    try {
      const isNew = !activeContact?.id;
      const url = isNew ? "/api/contacts" : `/api/contacts/${activeContact.id}`;
      await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(contactDraft) });
      await loadContacts();
      setActiveContact(null);
    } catch { /* ignore */ } finally { setContactSaving(false); }
  };

  const markContacted = async (c: any) => {
    try { await fetch(`/api/contacts/${c.id}/contacted`, { method: "POST" }); await loadContacts(); } catch { /* ignore */ }
  };
  const deleteContact = async (c: any) => {
    if (!confirm(`Delete ${c.name}?`)) return;
    try { await fetch(`/api/contacts/${c.id}/delete`, { method: "POST" }); if (activeContact?.id === c.id) setActiveContact(null); await loadContacts(); } catch { /* ignore */ }
  };

  /* ---- Voice daily standup ---- */

  const browserSpeak = (text: string) => {
    try {
      const synth = window.speechSynthesis;
      if (!synth) return;
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.02; u.pitch = 1.0;
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      setSpeaking(true);
      synth.speak(u);
    } catch { setSpeaking(false); }
  };

  const stopPlayback = () => {
    try { window.speechSynthesis?.cancel(); } catch { /* */ }
    if (audioRef.current) { try { audioRef.current.pause(); } catch { /* */ } audioRef.current = null; }
    setSpeaking(false);
  };

  // Play WAV bytes from /api/tts; returns true if it played, false to fall back.
  const playGeminiAudio = async (text: string, v: string, onEnd?: () => void): Promise<boolean> => {
    try {
      const res = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text, voice: v || undefined }) });
      if (res.status !== 200) return false;
      const url = URL.createObjectURL(await res.blob());
      const audio = new Audio(url);
      audioRef.current = audio;
      audio.onended = () => { URL.revokeObjectURL(url); audioRef.current = null; onEnd?.(); };
      audio.onerror = () => { URL.revokeObjectURL(url); onEnd?.(); };
      await audio.play();
      return true;
    } catch { return false; }
  };

  // Natural (Gemini) voice when enabled+available; browser voice otherwise or on any failure.
  const playStandup = async (text: string) => {
    if (!text) return;
    stopPlayback();
    if (naturalVoice && ttsAvailable) {
      setSpeaking(true);
      const ok = await playGeminiAudio(text, voice, () => setSpeaking(false));
      if (ok) return;
      // fell through → browser voice
    }
    browserSpeak(text);
  };

  const previewVoice = async (v: string) => {
    stopPlayback();
    setPreviewing(true);
    const line = "Good morning, Madan. This is how I'll sound reading your standup.";
    const ok = await playGeminiAudio(line, v, () => setPreviewing(false));
    if (!ok) { setPreviewing(false); browserSpeak(line); }
  };

  const chooseVoice = (v: string) => {
    setVoice(v);
    try { localStorage.setItem("jarvis_tts_voice", v); } catch { /* */ }
  };

  const toggleNaturalVoice = () => {
    const next = !naturalVoice;
    setNaturalVoice(next);
    try { localStorage.setItem("jarvis_natural_voice", next ? "1" : "0"); } catch { /* */ }
  };

  const loadTtsMeta = async () => {
    try {
      const d = await fetch("/api/tts/available").then((r) => r.json());
      setTtsAvailable(!!d?.available);
      if (Array.isArray(d?.voices)) setVoices(d.voices);
      if (!voice && d?.default) chooseVoice(d.default);
    } catch { /* ignore */ }
  };

  const openStandup = async () => {
    setStandupOpen(true);
    setStandupText("");
    setStandupLoading(true);
    try {
      const [data] = await Promise.all([
        fetch("/api/standup").then((r) => r.json()),
        voices.length ? Promise.resolve(null) : loadTtsMeta(),
      ]);
      const text = data?.ok ? data.text : (data?.error || "Couldn't assemble the standup.");
      setStandupText(text);
      if (data?.ok && text) playStandup(text);
    } catch (e) {
      setStandupText(`Standup failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setStandupLoading(false);
    }
  };
  const closeStandup = () => { stopPlayback(); setStandupOpen(false); };

  /* ---- Job Scout review queue ---- */

  const loadReviewAts = async (item: any) => {
    const ref = item.job_key || `app:${item.id}`;
    if (reviewAts[ref]) return; // already loaded/loading
    setReviewAts((m) => ({ ...m, [ref]: "loading" }));
    try {
      const res = await fetch(`/ats/${encodeURIComponent(ref)}`);
      if (!res.ok) throw new Error();
      const data = await res.json();
      setReviewAts((m) => ({ ...m, [ref]: data as AtsResult }));
    } catch {
      setReviewAts((m) => {
        const next = { ...m };
        delete next[ref];
        return next;
      });
    }
  };

  const toggleReviewRow = (item: any) => {
    const next = reviewExpanded === item.id ? null : item.id;
    setReviewExpanded(next);
    if (next !== null && !item.ats_pending) loadReviewAts(item);
  };

  // Phase 2 — inline Assess on a NEW card: expand to show ATS keyword gaps at the apply/skip moment.
  // Uses the cached analysis if present, else runs it once (no full-screen modal), all in place.
  const assessInline = async (item: any) => {
    const ref = item.job_key || `app:${item.id}`;
    if (reviewExpanded === item.id) { setReviewExpanded(null); return; }
    setReviewExpanded(item.id);
    if (reviewAts[ref] && reviewAts[ref] !== "loading") return; // already have it
    setReviewAts((m) => ({ ...m, [ref]: "loading" }));
    const fail = (msg?: string) => {
      setReviewAts((m) => { const n = { ...m }; delete n[ref]; return n; });
      if (msg) setReviewMsg(msg);
      setReviewExpanded((e) => (e === item.id ? null : e));
    };
    try {
      // Cached analysis?
      let res = await fetch(`/ats/${encodeURIComponent(ref)}`);
      if (res.ok) { const cached = (await res.json()) as AtsResult; setReviewAts((m) => ({ ...m, [ref]: cached })); return; }
      // Not analysed yet → run it inline (no navigation).
      res = await fetch(`/applications/${item.id}/ats`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data: any = await res.json().catch(() => ({}));
      if (data?.needs_jd) return fail("No job description on that card — open it to paste the posting, then Assess.");
      if (!res.ok || "error" in data) return fail("Couldn't assess this one — try again.");
      setReviewAts((m) => ({ ...m, [ref]: data as AtsResult }));
      loadApplications(); // refresh the score badge
    } catch (e) {
      fail(`Assess failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const decideReview = async (item: any, action: "apply" | "skip" | "save") => {
    setReviewBusyId(item.id);
    setReviewMsg("");
    try {
      const res = await fetch(`/api/job-scout/review/${item.id}/decide`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, status: reviewStage[item.id] || "applied" }),
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      // Drop the decided card from the NEW lane; the board reflects where it went.
      setReviewQueue((q) => q.filter((c) => c.id !== item.id));
      if (action === "apply" && data?.message) setReviewMsg(data.message);
      await Promise.all([loadApplications(), loadReviewCount()]);
    } catch (e) {
      setReviewMsg(`⚠️ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setReviewBusyId(null);
    }
  };

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

  // Console "Find jobs now" — live search that drops the top matches into the NEW triage lane.
  const searchNow = async () => {
    setSearchingJobs(true);
    setToolsOpen(false);
    setReviewMsg("🔎 Searching live listings…");
    try {
      const res = await fetch("/api/job-scout/search-now", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
      });
      const data = await res.json();
      if (!res.ok || !data?.ok) throw new Error(data?.error || `HTTP ${res.status}`);
      await Promise.all([loadReviewQueue(), loadReviewCount(), loadApplications()]);
      setReviewMsg(
        data.added
          ? `🎯 Live search added ${data.added} new to triage (scanned ${data.found}).`
          : `Live search found ${data.found} — nothing new (already on your board or no match).`
      );
    } catch (e) {
      setReviewMsg(`⚠️ Search failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSearchingJobs(false);
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
      setActiveAtsAppId(id);
      // New analysis → clear any recruiter feedback and prep from the previous job.
      setRecruiterReview(null);
      setRecruiterError(null);
      setJobPrep(null);
      setPrepError(null);
      if (data?.domain_mismatch?.mismatched) {
        setActiveTab("error");
      } else {
        setActiveTab("keyword");
      }
      onNavigate(ScreenId.AtsAnalysis);
      loadApplications(); // refresh so the score badge shows on the card behind the modal
    } catch (e) {
      alert(`ATS analysis failed: ${e instanceof Error ? e.message : e}`);
    } finally {
      setAtsLoadingId(null);
    }
  };

  /* ---- Recruiter feedback (separate on-demand call, lazy-loaded on its tab) ---- */
  const openRecruiterTab = () => {
    setActiveTab("recruiter");
    if (recruiterReview || recruiterLoading || activeAtsAppId == null) return;
    // Try the cached review first; if none, run a fresh one.
    void loadRecruiterReview(activeAtsAppId, false);
  };

  const loadRecruiterReview = async (id: number, force: boolean) => {
    setRecruiterLoading(true);
    setRecruiterError(null);
    try {
      if (!force && atsResult) {
        const cached = await fetch(`/ats/${encodeURIComponent(atsResult.job_ref)}/recruiter-review`);
        if (cached.ok) {
          setRecruiterReview((await cached.json()) as RecruiterReview);
          return;
        }
      }
      const res = await fetch(`/applications/${id}/recruiter-review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data: any = await res.json();
      if (!res.ok || "error" in data || data?.needs_jd) {
        setRecruiterError(
          data?.message || data?.error || `Recruiter review failed (HTTP ${res.status})`
        );
        return;
      }
      setRecruiterReview(data as RecruiterReview);
    } catch (e) {
      setRecruiterError(e instanceof Error ? e.message : String(e));
    } finally {
      setRecruiterLoading(false);
    }
  };

  /* ---- Outreach & STAR Prep (separate on-demand call, lazy-loaded on its tab) ---- */
  const openPrepTab = () => {
    setActiveTab("prep");
    if (jobPrep || prepLoading || activeAtsAppId == null) return;
    // Try the cached prep first; if none, run a fresh one.
    void loadJobPrep(activeAtsAppId, false);
  };

  const loadJobPrep = async (id: number, force: boolean) => {
    setPrepLoading(true);
    setPrepError(null);
    try {
      if (!force && atsResult) {
        const cached = await fetch(`/ats/${encodeURIComponent(atsResult.job_ref)}/prep`);
        if (cached.ok) {
          setJobPrep((await cached.json()) as JobPrep);
          return;
        }
      }
      const res = await fetch(`/applications/${id}/prep`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data: any = await res.json();
      if (!res.ok || "error" in data || data?.needs_jd) {
        setPrepError(
          data?.message || data?.error || `Outreach & STAR Prep generation failed (HTTP ${res.status})`
        );
        return;
      }
      setJobPrep(data as JobPrep);
    } catch (e) {
      setPrepError(e instanceof Error ? e.message : String(e));
    } finally {
      setPrepLoading(false);
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
      if (file.name.toLowerCase().endsWith(".docx")) {
        setHasDocx(true);
      }
      if (auditOpen) {
        setTimeout(() => {
          runAudit();
        }, 100);
      }
      if (activeScreen === ScreenId.AtsAnalysis && activeAtsAppId !== null) {
        setTimeout(() => {
          if (activeAtsAppId !== null) {
            runAts(activeAtsAppId);
          }
        }, 150);
      }
    } catch (e) {
      alert(`Could not read that file: ${e instanceof Error ? e.message : e}`);
    } finally {
      setResumeUploading(false);
      if (resumeFileRef.current) resumeFileRef.current.value = "";
      if (auditResumeFileRef.current) auditResumeFileRef.current.value = "";
    }
  };

  const downloadMasterDocx = () => {
    const tok = getToken();
    const url = tok ? `/resume/download?token=${encodeURIComponent(tok)}` : "/resume/download";
    window.open(url, "_blank");
  };

  const applyAuditSuggestions = async () => {
    setAuditApplying(true);
    try {
      const res = await fetch("/resume/apply-audit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          additions: selectedAuditKeywords,
          rewrites: selectedGrammar
        }),
      });
      const data = await res.json();
      if (!res.ok || data?.ok === false) {
        throw new Error(data?.error || `HTTP ${res.status}`);
      }
      
      const grammarChanges = Array.isArray(data.applied) && data.applied.length > 0
        ? data.applied.map((c: any, idx: number) => `${idx + 1}. "${c.original}"\n   → "${c.suggestion}"`).join("\n\n")
        : "None";

      const keywordsChanges = data.added_count > 0
        ? `Added ${data.added_count} keyword(s) to the Skills section: ${selectedAuditKeywords.join(", ")}`
        : "None";

      alert(`Successfully updated your master Word document!\n\n` +
            `🔹 Grammar & Wording Fixes applied: ${data.applied_count} of ${data.total}\n` +
            `${grammarChanges}\n\n` +
            `🔹 Skills section updates:\n${keywordsChanges}\n\n` +
            `Re-auditing master resume...`);
      setSelectedAuditKeywords([]);
      setSelectedGrammar([]);
      await openAudit();
    } catch (e) {
      alert(`Could not apply suggestions: ${e instanceof Error ? e.message : e}`);
    } finally {
      setAuditApplying(false);
    }
  };

  /* ---- Manually add a job applied elsewhere ---- */
  const openAdd = () => {
    setManual({ ...emptyManual });
    setAddError("");
    setAddOpen(true);
  };

  const saveManual = async (andAnalyze = false) => {
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
      if (andAnalyze && data?.id) {
        await runAts(data.id, manual.description);
      }
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
    setSelectedAuditKeywords([]);
    setSelectedGrammar([]);
    try {
      const res = await fetch("/resume/audit");
      const data = await res.json();
      const auditData = data?.audit || null;
      setAudit(auditData);
      
      if (auditData?.grammar) {
        const dateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|20\d\d|\d{1,2}[\/\-]\d{2,4})\b/i;
        const nonDate = auditData.grammar.filter((g: any) =>
          !dateRegex.test(g.original || "") && !dateRegex.test(g.suggestion || "")
        );
        setSelectedGrammar(nonDate);
      }
      
      const docxRes = await fetch("/resume/docx-status");
      const docxData = await docxRes.json();
      setHasDocx(!!docxData?.has_docx);
    } catch {
      setAudit(null);
    } finally {
      setAuditFetching(false);
    }
  };

  const autoFixResume = async () => {
    setAutoFixing(true);
    setAuditError("");
    setAutoFixMsg("");
    try {
      const res = await fetch("/resume/auto-fix", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      if (data.audit) setAudit(data.audit);
      const parts: string[] = [];
      if (Array.isArray(data.changes) && data.changes.length) parts.push(data.changes.join(" "));
      else parts.push("Formatting already clean — nothing to auto-fix.");
      if (data.unquantified_bullets > 0) parts.push(`${data.unquantified_bullets} bullet(s) still need real numbers — only you can add those.`);
      setAutoFixMsg(parts.join(" "));
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setAutoFixing(false);
    }
  };

  const deleteResume = async () => {
    if (!window.confirm(
      "Delete your stored master résumé?\n\nThis wipes the saved text, the original .docx and the cached audit so you can upload a fresh version. Your tracked applications and per-job ATS analyses are NOT affected.\n\nContinue?"
    )) return;
    setDeletingResume(true);
    setAuditError("");
    setAutoFixMsg("");
    try {
      const res = await fetch("/resume/delete", { method: "POST" });
      const data = await res.json();
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setAudit(null);
      setHasDocx(false);
      setResumeContent("");
    } catch (e) {
      setAuditError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeletingResume(false);
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
      
      if (data.audit?.grammar) {
        const dateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|20\d\d|\d{1,2}[\/\-]\d{2,4})\b/i;
        const nonDate = data.audit.grammar.filter((g: any) =>
          !dateRegex.test(g.original || "") && !dateRegex.test(g.suggestion || "")
        );
        setSelectedGrammar(nonDate);
      }
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
      if (data?.download) {
        const tok = getToken();
        const dUrl = tok ? `${data.download}?token=${encodeURIComponent(tok)}` : data.download;
        window.open(dUrl, "_blank"); // download the edited .docx
      }
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

  // Phase 3 — the one next step for a card, by stage (the board drives itself).
  // The SINGLE primary action shown on a card's face, by stage. Everything else lives in the ⋯ menu.
  // (Folds in the old nextStep + the stale-applied follow-up + the interviewing prep cue, and wires
  // the previously-dead "Respond to offer" to the email drafter — one action, no duplicates.)
  const primaryAction = (card: Application): { label: string; tint: string; onClick?: () => void } | null => {
    switch (card.status) {
      case "interested":
        return { label: "Assess & apply", tint: "#8aebff", onClick: () => runAts(card.id) };
      case "applied": {
        const d = daysSince(card.applied_at || card.updated_at) ?? 0;
        return { label: d >= 7 ? `Follow up · ${d}d` : "Follow up", tint: "#ffd6a3", onClick: openFollowups };
      }
      case "interviewing":
        return { label: "Prep interview", tint: "#5eead4", onClick: openPrep };
      case "offer":
        return { label: "Respond to offer", tint: "#ffd6a3", onClick: () => openEmails(card) };
      default:
        return null; // accepted / rejected — closed, no face action
    }
  };

  // Focus view = only cards that want action today.
  const needsAction = (card: Application) => primaryAction(card) !== null;

  // Facet list for the source filter (over already-loaded data).
  const sourceFacets = useMemo(
    () => Array.from(new Set(applications.map((a) => a.source).filter(Boolean))) as string[],
    [applications]
  );
  const activeFilterCount =
    (query ? 1 : 0) + (atsMin > 0 ? 1 : 0) + (methodFilter ? 1 : 0) + (sourceFilter ? 1 : 0) + (focusMode ? 1 : 0);

  const matchesFilters = (a: Application): boolean => {
    if (query) {
      const q = query.toLowerCase();
      if (!`${a.title} ${a.company} ${a.location || ""}`.toLowerCase().includes(q)) return false;
    }
    if (atsMin > 0 && !(typeof a.ats_score === "number" && a.ats_score >= atsMin)) return false;
    if (methodFilter) {
      const m = a.apply_method === "email" ? "email" : "link";
      if (m !== methodFilter) return false;
    }
    if (sourceFilter && a.source !== sourceFilter) return false;
    if (focusMode && !needsAction(a)) return false;
    return true;
  };

  const columns: RealColumn[] = statuses.map((status) => {
    const cfg = STATUS_CONFIG[status] || {
      accentClass: "text-[#8aebff] border-[#8aebff]/20 bg-[#8aebff]/5",
    };
    // Analysed cards rise to the top, highest ATS score first; un-analysed keep their
    // existing (most-recently-updated) order at the bottom.
    const cards = applications
      // reviewed=0 are fresh scout matches — they live in the NEW column, not the normal lanes.
      .filter((a) => a.status === status && a.reviewed !== 0 && matchesFilters(a))
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
            {reviewCount > 0 && (
              <button
                onClick={() => {
                  loadReviewQueue();
                  loadReviewCount();
                  const col = document.getElementById("new-triage-column");
                  if (col) {
                    col.scrollIntoView({ behavior: "smooth", inline: "center" });
                  }
                }}
                className="flex items-center gap-2 px-4 py-2 bg-[#a3e635]/15 border border-[#a3e635]/50 rounded-lg text-xs font-semibold text-[#a3e635] hover:bg-[#a3e635]/25 hover:border-[#a3e635]/80 transition-all cursor-pointer shadow-[0_0_12px_rgba(163,230,53,0.2)] hover:shadow-[0_0_20px_rgba(163,230,53,0.4)]"
                title="Click to view & triage fresh Job Scout matches"
              >
                <Sparkles className="w-4 h-4 animate-pulse" />
                {reviewCount} NEW
              </button>
            )}
            <button
              onClick={openAdd}
              className="flex items-center gap-2 px-5 py-2 bg-[#8aebff]/10 border border-[#8aebff]/30 rounded-lg text-xs font-semibold hover:bg-[#8aebff]/20 transition-all text-[#8aebff] cursor-pointer"
              title="Track a job you applied to elsewhere (LinkedIn, Naukri, careers page…)"
            >
              <Plus className="w-4 h-4" />
              ADD JOB
            </button>

            {/* SCAN SCREENSHOT BUTTON */}
            <input
              ref={imageFileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleImageScan(file);
              }}
            />
            <button
              onClick={() => imageFileRef.current?.click()}
              disabled={scanningImage}
              className="flex items-center gap-2 px-4 py-2 bg-[#c084fc]/10 border border-[#c084fc]/30 rounded-lg text-xs font-semibold hover:bg-[#c084fc]/20 transition-all text-[#c084fc] cursor-pointer disabled:opacity-50"
              title="Upload a screenshot of a job posting or flyer to automatically create a card"
            >
              {scanningImage ? (
                <><RefreshCw className="w-4 h-4 animate-spin" /> SCANNING…</>
              ) : (
                <><Upload className="w-4 h-4" /> SCAN SCREENSHOT</>
              )}
            </button>

            {/* Tools dropdown — collapses scan/follow-ups/interviews/standup/network/notes/résumé */}
            <div className="relative">
              <button
                onClick={() => setToolsOpen((v) => !v)}
                className={`relative flex items-center gap-2 px-5 py-2 border rounded-lg text-xs font-semibold transition-all cursor-pointer ${toolsOpen ? "bg-white/10 border-[#8aebff]/40 text-[#8aebff]" : "bg-white/5 border-white/10 text-[#bbc9cd] hover:bg-white/10"}`}
                title="Tools — scan, follow-ups, interviews, standup, network, notes, résumé"
              >
                <Wrench className="w-4 h-4" />
                TOOLS
                <ChevronDown className={`w-3.5 h-3.5 transition-transform ${toolsOpen ? "rotate-180" : ""}`} />
                {followCount > 0 && !toolsOpen && (
                  <span className="absolute -top-1 -right-1 min-w-[16px] h-4 px-1 rounded-full bg-[#ffd6a3] text-[#0a0e1a] text-[9px] font-bold flex items-center justify-center">{followCount}</span>
                )}
              </button>
              {toolsOpen && (
                <>
                  <div className="fixed inset-0 z-40" onClick={() => setToolsOpen(false)} />
                  <div className="absolute right-0 top-full mt-2 w-60 z-50 glass-panel rounded-xl border border-white/10 shadow-2xl p-1.5">
                    {/* Ordered by the job-search lifecycle: Discover → Prepare → Track → Follow-up → Interview */}
                    {([
                      { label: "Discover", items: [
                        { fn: searchNow, icon: Search, label: searchingJobs ? "Searching…" : "Find jobs now", tint: "#8aebff", spin: searchingJobs },
                        { fn: () => { setAtsSearchOpen(true); setToolsOpen(false); }, icon: Globe, label: "ATS Deep Scout", tint: "#c084fc" },
                      ] },
                      { label: "Prepare", items: [
                        { fn: openResume, icon: FileText, label: "Résumé", tint: "#8aebff" },
                        { fn: openAudit, icon: ClipboardCheck, label: "Résumé audit", tint: "#a3e635" },
                      ] },
                      { label: "Track", items: [
                        { fn: scanNow, icon: Mail, label: scanning ? "Scanning…" : "Scan emails", tint: "#a3e635", spin: scanning },
                      ] },
                      { label: "Follow up", items: [
                        { fn: openFollowups, icon: Clock, label: "Follow-ups", tint: "#ffd6a3", badge: followCount || undefined },
                        { fn: openNetwork, icon: Users, label: "Network", tint: "#ffd6a3" },
                      ] },
                      { label: "Interview", items: [
                        { fn: openPrep, icon: CalendarClock, label: "Interviews", tint: "#5eead4" },
                      ] },
                      { label: "Workspace", items: [
                        { fn: openNotes, icon: StickyNote, label: "Notes", tint: "#c084fc" },
                        { fn: openStandup, icon: Megaphone, label: "Standup", tint: "#8aebff" },
                      ] },
                    ] as { label: string; items: { fn: () => void; icon: React.ElementType; label: string; tint: string; spin?: boolean; badge?: number }[] }[]).map((group, gi) => (
                      <div key={group.label}>
                        {gi > 0 && <div className="my-1 border-t border-white/5" />}
                        <div className="px-2 pt-1 pb-0.5 text-[9px] font-mono uppercase tracking-widest text-[#5c6a6d]">{group.label}</div>
                        {group.items.map((it) => (
                          <button key={it.label} onClick={() => { setToolsOpen(false); it.fn(); }}
                            className="w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-xs font-semibold text-[#bbc9cd] hover:bg-white/5 transition-all cursor-pointer">
                            <it.icon className={`w-4 h-4 shrink-0 ${it.spin ? "animate-pulse" : ""}`} style={{ color: it.tint }} />
                            <span className="flex-1 text-left">{it.label}</span>
                            {it.badge ? <span className="text-[10px] px-1.5 rounded-full bg-[#ffd6a3]/15 text-[#ffd6a3]">{it.badge}</span> : null}
                          </button>
                        ))}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

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

      {/* Board controls — search / focus / filters (all client-side, no backend calls) */}
      <section className="max-w-full mx-auto flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[180px] max-w-xs">
          <Search className="w-3.5 h-3.5 text-[#859397] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search title / company…"
            className="w-full bg-white/5 border border-white/10 rounded-lg pl-9 pr-3 py-2 text-xs font-mono text-[#dfe2f3] placeholder:text-[#859397]/60 focus:outline-none focus:border-[#8aebff]/40"
          />
          {query && (
            <button onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-[#859397] hover:text-[#dfe2f3] cursor-pointer"><X className="w-3.5 h-3.5" /></button>
          )}
        </div>

        <button
          onClick={() => setFocusMode((v) => !v)}
          title="Show only cards that need action today"
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-semibold border transition-all cursor-pointer ${focusMode ? "bg-[#a3e635]/15 border-[#a3e635]/40 text-[#a3e635]" : "bg-white/5 border-white/10 text-[#bbc9cd] hover:bg-white/10"}`}
        >
          <Eye className="w-3.5 h-3.5" /> FOCUS
        </button>

        <div className="relative">
          <button
            onClick={() => setFiltersOpen((v) => !v)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-mono font-semibold border transition-all cursor-pointer ${filtersOpen || activeFilterCount > 0 ? "bg-[#8aebff]/10 border-[#8aebff]/40 text-[#8aebff]" : "bg-white/5 border-white/10 text-[#bbc9cd] hover:bg-white/10"}`}
          >
            <SlidersHorizontal className="w-3.5 h-3.5" /> FILTERS
            {activeFilterCount > 0 && (
              <span className="min-w-[16px] h-4 px-1 rounded-full bg-[#8aebff] text-[#0a0e1a] text-[9px] font-bold flex items-center justify-center">{activeFilterCount}</span>
            )}
          </button>
          {filtersOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setFiltersOpen(false)} />
              <div className="absolute left-0 top-full mt-2 w-64 z-50 glass-panel rounded-xl border border-white/10 shadow-2xl p-4 space-y-4">
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[#859397] flex items-center justify-between">
                    Min ATS <span className="text-[#8aebff]">{atsMin || "any"}</span>
                  </label>
                  <input type="range" min={0} max={90} step={5} value={atsMin} onChange={(e) => setAtsMin(Number(e.target.value))} className="w-full mt-1.5 accent-[#8aebff]" />
                </div>
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-[#859397] block mb-1.5">Apply method</label>
                  <div className="flex gap-1.5">
                    {([["", "All"], ["email", "Email"], ["link", "On site"]] as const).map(([v, l]) => (
                      <button key={v} onClick={() => setMethodFilter(v as "" | "email" | "link")} className={`flex-1 px-2 py-1 rounded text-[10px] font-mono border cursor-pointer transition-all ${methodFilter === v ? "bg-[#8aebff]/15 border-[#8aebff]/40 text-[#8aebff]" : "border-white/10 text-[#859397] hover:text-[#dfe2f3]"}`}>{l}</button>
                    ))}
                  </div>
                </div>
                {sourceFacets.length > 0 && (
                  <div>
                    <label className="text-[10px] font-mono uppercase tracking-wider text-[#859397] block mb-1.5">Source</label>
                    <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)} className="w-full bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 cursor-pointer">
                      <option value="" className="bg-[#0a0e1a]">All sources</option>
                      {sourceFacets.map((s) => <option key={s} value={s} className="bg-[#0a0e1a]">{s}</option>)}
                    </select>
                  </div>
                )}
                {activeFilterCount > 0 && (
                  <button onClick={() => { setQuery(""); setAtsMin(0); setMethodFilter(""); setSourceFilter(""); setFocusMode(false); }} className="w-full text-[10px] font-mono text-[#ffb4ab] hover:underline cursor-pointer">Clear all filters</button>
                )}
              </div>
            </>
          )}
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
        ) : columns.every((c) => c.cards.length === 0) && reviewQueue.length === 0 ? (
          <div className="flex flex-col items-center justify-center min-h-[400px] gap-3 text-center">
            <FileText className="w-10 h-10 text-[#8aebff]/40" />
            <p className="font-mono text-sm text-[#dfe2f3]">No applications tracked yet.</p>
            <p className="font-mono text-xs text-[#859397] max-w-sm">
              Once the career node ingests roles, they will populate the kanban board here.
            </p>
          </div>
        ) : (
          <div className="flex gap-6 min-w-[1200px] px-2">
            {/* NEW — triage lane: fresh scout matches land here (daily + on-demand). Save / Apply / Skip. */}
            {(reviewQueue.length > 0 || reviewMsg) && (
              <div id="new-triage-column" className="flex-shrink-0 w-80 glass-column flex flex-col rounded-xl min-h-[500px] border border-[#a3e635]/25">
                <div className="p-4 border-b border-white/5 flex justify-between items-center bg-[#a3e635]/5">
                  <span className="text-xs font-bold font-mono text-[#a3e635] tracking-widest flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" /> NEW · TRIAGE
                  </span>
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded border text-[#a3e635] border-[#a3e635]/30">
                    {pad2(reviewQueue.length)}
                  </span>
                </div>
                {reviewMsg && (
                  <div className="px-4 pt-3 text-[10px] font-mono text-[#8aebff] leading-relaxed">{reviewMsg}</div>
                )}
                <div className="p-4 space-y-4 flex-1">
                  {reviewQueue.length === 0 && (
                    <p className="text-[10px] font-mono text-[#859397]/60 uppercase tracking-widest text-center py-6">No fresh matches</p>
                  )}
                  {reviewQueue.map((item) => {
                    const busy = reviewBusyId === item.id;
                    return (
                      <div key={item.id} className="glass-card p-4 rounded-xl space-y-3">
                        <div className="flex justify-between items-start gap-2">
                          <h3 className="text-sm font-bold text-[#dfe2f3] leading-snug">
                            {item.url ? (
                              <a href={item.url} target="_blank" rel="noreferrer" className="hover:underline hover:text-[#8aebff]">{item.title}</a>
                            ) : item.title}
                          </h3>
                          {typeof item.match_score === "number" && (
                            <span title="Job Scout match score (0-100)" className="shrink-0 text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ color: atsColor(item.match_score).text, borderColor: atsColor(item.match_score).border }}>{item.match_score}</span>
                          )}
                        </div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-[11px] font-mono text-[#859397]">{item.company}{item.location ? ` • ${item.location}` : ""}</p>
                          {item.source ? (
                            <span title={`Source: ${item.source}`} className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-[#8aebff]/10 border border-[#8aebff]/25 text-[#8aebff] whitespace-nowrap">{item.source}</span>
                          ) : null}
                          <ApplyTag method={item.apply_method} />
                          {typeof item.ats_score === "number" ? (
                            <span title="ATS — keyword match with the JD" className="text-[10px] font-mono px-1.5 py-0.5 rounded border" style={{ color: atsColor(item.ats_score).text, borderColor: atsColor(item.ats_score).border }}>ATS {item.ats_score}</span>
                          ) : null}
                        </div>
                        {item.why ? <p className="text-[11px] text-[#bbc9cd] leading-relaxed line-clamp-3">{item.why}</p> : null}
                        {/* Phase 2 — inline Assess: keyword gaps at the decision moment */}
                        {(() => {
                          const ref = item.job_key || `app:${item.id}`;
                          const ats = reviewAts[ref];
                          const expanded = reviewExpanded === item.id;
                          return (
                            <div>
                              <button onClick={() => assessInline(item)} className="text-[10px] font-mono text-[#8aebff] hover:underline inline-flex items-center gap-1 cursor-pointer">
                                <Target className="w-3 h-3" /> {expanded ? "Hide fit" : "Assess fit"}
                              </button>
                              {expanded && (
                                <div className="mt-2 rounded-lg bg-[#0a0e1a]/50 border border-white/10 p-2.5 space-y-2">
                                  {!ats || ats === "loading" ? (
                                    <p className="text-[10px] font-mono text-[#859397]">Analysing keyword match…</p>
                                  ) : (
                                    <>
                                      <div className="flex items-center gap-2">
                                        <span className="text-[9px] font-mono uppercase tracking-wider text-[#859397]">ATS match</span>
                                        <span className="text-[11px] font-mono font-bold" style={{ color: atsColor(ats.ats_score).text }}>{ats.ats_score}</span>
                                      </div>
                                      {(ats.keyword_matrix?.missing?.length ?? 0) > 0 && (
                                        <div>
                                          <span className="text-[9px] font-mono uppercase tracking-wider text-[#ffb4ab]">Missing</span>
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {ats.keyword_matrix.missing.slice(0, 10).map((k, i) => (
                                              <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#ffb4ab]/10 border border-[#ffb4ab]/20 text-[#ffb4ab]">{k}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                      {(ats.keyword_matrix?.present?.length ?? 0) > 0 && (
                                        <div>
                                          <span className="text-[9px] font-mono uppercase tracking-wider text-[#a3e635]">You have</span>
                                          <div className="flex flex-wrap gap-1 mt-1">
                                            {ats.keyword_matrix.present.slice(0, 8).map((k, i) => (
                                              <span key={i} className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#a3e635]/10 border border-[#a3e635]/20 text-[#a3e635]">{k}</span>
                                            ))}
                                          </div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })()}
                        <div className="flex items-center gap-2">
                          <button disabled={busy} onClick={() => decideReview(item, "save")} title="Keep as an Interested card"
                            className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 cursor-pointer disabled:opacity-50">Save</button>
                          <button disabled={busy} onClick={() => decideReview(item, "apply")} title="Move to Applied + prep tailored résumé/cover"
                            className="flex-1 px-2 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#0a0e1a] bg-[#a3e635] hover:bg-[#b6f24d] cursor-pointer disabled:opacity-50">Apply</button>
                          <button disabled={busy} onClick={() => decideReview(item, "skip")} title="Discard this match"
                            className="px-2 py-1.5 rounded-lg text-[11px] font-bold font-mono text-[#859397] border border-white/10 hover:text-[#ffb4ab] hover:border-[#ffb4ab]/30 cursor-pointer disabled:opacity-50">Skip</button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
            {columns.map((col) => {
              const canCollapse = col.status === "accepted" || col.status === "rejected";
              // Collapsed terminal lane → thin vertical strip that expands on click.
              if (canCollapse && collapsedCols[col.status]) {
                return (
                  <button
                    key={col.status}
                    onClick={() => setCollapsedCols((m) => ({ ...m, [col.status]: false }))}
                    title={`Expand ${col.title}`}
                    className={`flex-shrink-0 w-12 glass-column rounded-xl min-h-[500px] flex flex-col items-center gap-3 pt-4 cursor-pointer hover:bg-white/5 transition-colors ${col.grayscale ? "grayscale" : ""} ${col.opacityClass || ""}`}
                  >
                    <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${col.accentClass}`}>{col.count}</span>
                    <span className="text-[10px] font-bold font-mono text-[#859397] tracking-widest [writing-mode:vertical-rl] rotate-180">{col.title}</span>
                  </button>
                );
              }
              const cap = expandedCols[col.status] ? col.cards.length : COLUMN_CAP;
              const shown = col.cards.slice(0, cap);
              const hidden = col.cards.length - shown.length;
              return (
                <div
                  key={col.status}
                  className={`flex-shrink-0 w-80 glass-column flex flex-col rounded-xl min-h-[500px] ${
                    col.opacityClass || ""
                  } ${col.grayscale ? "grayscale" : ""}`}
                >
                  {/* Column Header */}
                  <div className="p-4 border-b border-white/5 flex justify-between items-center bg-white/5">
                    <span className="text-xs font-bold font-mono text-[#859397] tracking-widest flex items-center gap-1.5">
                      {canCollapse && (
                        <button onClick={() => setCollapsedCols((m) => ({ ...m, [col.status]: true }))} title="Collapse lane" className="text-[#859397] hover:text-[#dfe2f3] cursor-pointer -ml-1">
                          <ChevronDown className="w-3.5 h-3.5 rotate-90" />
                        </button>
                      )}
                      {col.title}
                    </span>
                    <span className={`text-xs font-mono px-2.5 py-0.5 rounded border ${col.accentClass}`}>
                      {col.count}
                    </span>
                  </div>

                  {/* Column Cards Container */}
                  <div className="p-4 space-y-3 flex-1">
                    {col.cards.length === 0 ? (
                      <p className="text-[10px] font-mono text-[#859397]/60 uppercase tracking-widest text-center py-6">
                        Empty
                      </p>
                    ) : (
                      <>
                        {shown.map((card) => {
                          const isAction = card.status === "offer";
                          const pa = primaryAction(card);
                          return (
                            <div
                              key={card.id}
                              className={`glass-card p-4 rounded-xl group relative ${isAction ? "border-[#ffd6a3]/40 shadow-lg" : ""}`}
                            >
                              {/* Row 1 — title · ATS · overflow */}
                              <div className="flex justify-between items-start gap-2 mb-1.5">
                                <h3 className="text-sm font-bold text-[#dfe2f3] group-hover:text-[#8aebff] transition-colors leading-snug min-w-0">
                                  {card.url ? (
                                    <a href={card.url} target="_blank" rel="noreferrer" className="hover:underline">{card.title}</a>
                                  ) : card.title}
                                </h3>
                                <div className="flex items-center gap-1 shrink-0">
                                  {typeof card.ats_score === "number" && (() => {
                                    const c = atsColor(card.ats_score);
                                    const grade = scoreToGrade(card.ats_score);
                                    return (
                                      <span
                                        title={`ATS — keyword match with the job description${card.ats_scored_at ? `, as of ${new Date(card.ats_scored_at).toLocaleDateString()}` : ""}`}
                                        className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono border cursor-help"
                                        style={{ color: c.text, borderColor: `${c.border}55`, backgroundColor: `${c.bg}1a` }}
                                      >
                                        <Gauge className="w-3 h-3" />
                                        <span>ATS {card.ats_score} ({grade})</span>
                                      </span>
                                    );
                                  })()}
                                  {(card.ghost_job_risk === "medium" || card.ghost_job_risk === "high") && (
                                    <span title={`Ghost Job Risk: ${card.ghost_job_risk.toUpperCase()}`} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono border border-red-500/30 text-[#ffb4ab] bg-red-950/20 cursor-help">
                                      👻 GHOST
                                    </span>
                                  )}
                                  {(card.news_count ?? 0) > 0 && (
                                    <span title={`${card.news_count} company news signal(s) — open ⋯`} className="flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-bold font-mono border border-[#a3e635]/40 text-[#a3e635] bg-[#a3e635]/10 cursor-help">
                                      <Newspaper className="w-3 h-3" />{card.news_count}
                                    </span>
                                  )}
                                  <button
                                    onClick={(e) => {
                                      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                      setCardMenu(cardMenu?.id === card.id ? null : { id: card.id, x: r.right, y: r.bottom });
                                    }}
                                    aria-label={`More actions for ${card.title}`}
                                    className="p-1 rounded text-[#859397] hover:text-[#8aebff] hover:bg-white/5 transition-all cursor-pointer"
                                  >
                                    <MoreHorizontal className="w-4 h-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Row 2 — company • location */}
                              <p className="text-[11px] font-mono text-[#859397] mb-2.5 truncate">
                                {card.company}{card.location ? ` • ${card.location}` : ""}
                              </p>

                              {/* Row 3 — the single stage-appropriate action */}
                              {pa && (
                                <button
                                  onClick={pa.onClick}
                                  disabled={!pa.onClick || atsLoadingId === card.id}
                                  title="Suggested next step"
                                  className="inline-flex items-center gap-1 text-[10px] font-mono font-bold px-2.5 py-1 rounded-md border transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-default"
                                  style={{ color: pa.tint, borderColor: `${pa.tint}55`, background: `${pa.tint}14` }}
                                >
                                  <ArrowUpRight className="w-3 h-3" />
                                  {atsLoadingId === card.id && card.status === "interested" ? "Analyzing…" : pa.label}
                                </button>
                              )}
                            </div>
                          );
                        })}
                        {hidden > 0 && (
                          <button onClick={() => setExpandedCols((m) => ({ ...m, [col.status]: true }))} className="w-full text-center text-[10px] font-mono text-[#8aebff]/80 hover:text-[#8aebff] py-2 cursor-pointer">
                            show {hidden} more ↓
                          </button>
                        )}
                        {expandedCols[col.status] && col.cards.length > COLUMN_CAP && (
                          <button onClick={() => setExpandedCols((m) => ({ ...m, [col.status]: false }))} className="w-full text-center text-[10px] font-mono text-[#859397] hover:text-[#dfe2f3] py-1 cursor-pointer">
                            show less ↑
                          </button>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Per-card overflow (⋯) menu — fixed-positioned so the card's clipping doesn't crop it */}
        {cardMenu && (() => {
          const card = applications.find((a) => a.id === cardMenu.id);
          if (!card) return null;
          const rc = typeof card.recruiter_score === "number" ? atsColor(card.recruiter_score) : null;
          return (
            <>
              <div className="fixed inset-0 z-[60]" onClick={() => setCardMenu(null)} />
              <div className="fixed z-[61] w-52 glass-panel rounded-xl border border-white/10 shadow-2xl p-1.5" style={{ top: cardMenu.y + 6, left: Math.max(8, cardMenu.x - 208) }}>
                {(rc || card.source || card.apply_method) && (
                  <div className="px-2 py-1.5 flex flex-wrap items-center gap-1.5 border-b border-white/5 mb-1">
                    {rc && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded border inline-flex items-center gap-0.5" style={{ color: rc.text, borderColor: `${rc.border}55` }}><UserCheck className="w-3 h-3" />REC {card.recruiter_score}</span>}
                    {card.source && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-[#8aebff]/10 border border-[#8aebff]/25 text-[#8aebff]">{card.source}</span>}
                    <ApplyTag method={card.apply_method} />
                  </div>
                )}
                {cardIntel && (cardIntel.loading || cardIntel.news.length > 0 || cardIntel.brief) && (
                  <div className="px-2.5 py-2 border-b border-white/5 mb-1 space-y-2 max-h-56 overflow-y-auto">
                    {cardIntel.loading && <p className="text-[10px] font-mono text-[#859397]">Loading intel…</p>}
                    {cardIntel.brief && (
                      <div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[#5eead4] flex items-center gap-1"><Target className="w-3 h-3" /> Interview brief</span>
                        <p className="text-[10px] text-[#bbc9cd] leading-relaxed mt-1 line-clamp-5 whitespace-pre-wrap">{cardIntel.brief.brief}</p>
                      </div>
                    )}
                    {cardIntel.news.length > 0 && (
                      <div>
                        <span className="text-[9px] font-mono uppercase tracking-wider text-[#a3e635] flex items-center gap-1"><Newspaper className="w-3 h-3" /> Company news</span>
                        {cardIntel.news.slice(0, 5).map((n: any, i: number) => (
                          <a key={i} href={n.url || "#"} target="_blank" rel="noreferrer" className="block text-[10px] text-[#dfe2f3] hover:text-[#a3e635] leading-snug mt-1 truncate" title={n.why || n.title}>• {n.title}</a>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button onClick={() => { setCardMenu(null); runAts(card.id); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] font-mono text-[#8aebff] hover:bg-white/5 cursor-pointer transition-colors">
                  <Gauge className="w-3.5 h-3.5" /> ATS analysis
                </button>
                <button onClick={() => { setCardMenu(null); openEmails(card); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] font-mono text-[#a3e635] hover:bg-white/5 cursor-pointer transition-colors">
                  <Mail className="w-3.5 h-3.5" /> Emails
                </button>
                <div className="px-2.5 py-1.5">
                  <label className="text-[9px] font-mono uppercase tracking-wider text-[#859397] block mb-1">Move to</label>
                  <select
                    value={card.status}
                    onChange={(e) => { changeStatus(card.id, e.target.value); setCardMenu(null); }}
                    className="w-full appearance-none bg-white/5 border border-white/10 rounded text-[10px] font-mono text-[#bbc9cd] px-2 py-1 uppercase tracking-wider cursor-pointer hover:border-[#8aebff]/30 focus:outline-none focus:border-[#8aebff]/50"
                  >
                    {statuses.map((s) => <option key={s} value={s} className="bg-[#0a0e1a] text-[#dfe2f3]">{s.toUpperCase()}</option>)}
                  </select>
                </div>
                <button onClick={() => { setCardMenu(null); if (confirm(`Remove "${card.title}" from tracking?`)) removeCard(card.id); }} className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded text-[11px] font-mono text-[#ffb4ab] hover:bg-[#ffb4ab]/5 cursor-pointer transition-colors border-t border-white/5 mt-1">
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              </div>
            </>
          );
        })()}
      </section>

      {/* Slide-Up ATS Analysis Modal Overlay */}
      <AnimatePresence>
        {reviewOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div
              initial={{ y: "100%", opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: "100%", opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 180 }}
              className="w-full max-w-3xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#c084fc]/25 max-h-[90vh] flex flex-col"
            >
              <div className="p-6 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono flex items-center gap-2">
                    <Sparkles className="w-5 h-5 text-[#c084fc]" /> Review New Matches
                  </h2>
                  <p className="text-xs font-mono text-[#859397] mt-1">
                    {reviewQueue.length} fresh {reviewQueue.length === 1 ? "match" : "matches"} · apply, skip, or move to a stage
                  </p>
                </div>
                <button
                  onClick={() => setReviewOpen(false)}
                  aria-label="Close review"
                  className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#c084fc] rounded-full border border-white/5 cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {reviewMsg && (
                <div className="px-6 py-2 text-xs font-mono text-[#a3e635] bg-[#a3e635]/5 border-b border-[#a3e635]/10">
                  {reviewMsg}
                </div>
              )}

              <div className="overflow-y-auto p-4 space-y-3">
                {reviewLoading ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">Loading matches…</div>
                ) : reviewQueue.length === 0 ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">🎉 All caught up — no matches to review.</div>
                ) : (
                  reviewQueue.map((item) => {
                    const ref = item.job_key || `app:${item.id}`;
                    const ats = reviewAts[ref];
                    const expanded = reviewExpanded === item.id;
                    const busy = reviewBusyId === item.id;
                    return (
                      <div key={item.id} className="bg-[#161e2e]/60 border border-white/10 rounded-xl overflow-hidden">
                        <div className="p-4 flex items-start justify-between gap-3 cursor-pointer" onClick={() => toggleReviewRow(item)}>
                          <div className="min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-semibold text-[#dfe2f3] truncate">{item.title}</span>
                              <span className="text-xs text-[#859397]">{item.company}</span>
                              {item.location && <span className="text-[10px] font-mono text-[#859397]">· {item.location}</span>}
                            </div>
                            {item.why && <p className="text-xs text-[#bbc9cd] mt-1">{item.why}</p>}
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {typeof item.match_score === "number" && (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#8aebff]/10 text-[#8aebff] border border-[#8aebff]/20">FIT {item.match_score}</span>
                            )}
                            {item.ats_score != null ? (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-[#a3e635]/10 text-[#a3e635] border border-[#a3e635]/20">ATS {item.ats_score}</span>
                            ) : (
                              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-white/5 text-[#859397] border border-white/10">ATS —</span>
                            )}
                            <ChevronDown className={`w-4 h-4 text-[#859397] transition-transform ${expanded ? "rotate-180" : ""}`} />
                          </div>
                        </div>

                        {expanded && (
                          <div className="px-4 pb-4 border-t border-white/5 pt-3 space-y-3">
                            {item.flags && <div className="text-[10px] font-mono text-[#c084fc]">{item.flags}</div>}
                            {item.url && (
                              <a href={item.url} target="_blank" rel="noreferrer" className="text-xs text-[#8aebff] inline-flex items-center gap-1 hover:underline">
                                Open posting <ArrowUpRight className="w-3 h-3" />
                              </a>
                            )}
                            {item.ats_pending ? (
                              <div className="text-xs text-[#859397] font-mono">No ATS analysis yet — the apply desk scores strong matches automatically.</div>
                            ) : ats === "loading" || !ats ? (
                              <div className="text-xs text-[#859397] font-mono">Loading ATS…</div>
                            ) : (
                              <div className="space-y-1">
                                <div className="text-[10px] font-mono text-[#859397] uppercase tracking-widest">Keyword match</div>
                                <div className="flex flex-wrap gap-1.5">
                                  {ats.keyword_matrix.required.map((kw) => {
                                    const present = ats.keyword_matrix.present.includes(kw);
                                    return (
                                      <span key={kw} className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${present ? "bg-[#a3e635]/10 text-[#a3e635] border-[#a3e635]/20" : "bg-[#ffb4ab]/10 text-[#ffb4ab] border-[#ffb4ab]/20"}`}>
                                        {present ? "✓" : "✗"} {kw}
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="px-4 py-3 bg-[#0e1420]/60 border-t border-white/5 flex items-center justify-end gap-2">
                          <button
                            disabled={busy}
                            onClick={() => decideReview(item, "skip")}
                            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-white/5 border border-white/10 text-[#859397] hover:text-[#ffb4ab] hover:border-[#ffb4ab]/30 transition-all cursor-pointer disabled:opacity-50"
                          >
                            Skip
                          </button>
                          <select
                            value={reviewStage[item.id] || "applied"}
                            onChange={(e) => setReviewStage((m) => ({ ...m, [item.id]: e.target.value }))}
                            className="bg-[#1b1f2c] border border-[#3c494c] rounded-lg px-2 py-1.5 text-xs text-white font-mono focus:border-[#c084fc] outline-none cursor-pointer"
                          >
                            {statuses.map((s) => <option key={s} value={s} className="bg-[#0a0e1a]">{s}</option>)}
                          </select>
                          <button
                            disabled={busy}
                            onClick={() => decideReview(item, "apply")}
                            className="px-4 py-1.5 text-xs font-bold rounded-lg bg-[#c084fc]/15 border border-[#c084fc]/40 text-[#c084fc] hover:bg-[#c084fc]/25 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                          >
                            {busy ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />} Apply
                          </button>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </motion.div>
          </div>
        )}

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
                        className={atsResult.domain_mismatch?.mismatched ? "text-[#ffb4ab]/10" : "text-[#8aebff]/10"}
                        cx="88"
                        cy="88"
                        fill="transparent"
                        r="76"
                        stroke="currentColor"
                        strokeWidth="3"
                      ></circle>
                      <circle
                        className={atsResult.domain_mismatch?.mismatched ? "text-[#ffb4ab]" : "text-[#8aebff] glow-cyan"}
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
                      <span className={`text-4xl font-extrabold font-mono leading-none ${atsResult.domain_mismatch?.mismatched ? "text-[#ffb4ab]" : "text-[#dfe2f3] glow-cyan"}`}>
                        {score}
                      </span>
                      <span className="text-[10px] font-mono text-[#859397] uppercase tracking-widest mt-1">
                        / 100 • FIT {scoreToGrade(score)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Ghost job warning banner */}
                {(atsResult.ghost_job_risk === "medium" || atsResult.ghost_job_risk === "high") && (
                  <div className="p-4 rounded-xl border border-red-500/20 bg-red-950/10 text-red-200 flex items-start gap-3">
                    <span className="text-xl">👻</span>
                    <div className="space-y-1">
                      <h4 className="text-xs font-bold font-mono uppercase tracking-wider text-red-400">Potential Ghost Job Warning</h4>
                      <p className="text-[11px] leading-relaxed">
                        This job posting shows signs of being inactive, outdated, or generic. Proceed with caution.
                      </p>
                      {atsResult.ghost_job_reasons && atsResult.ghost_job_reasons.length > 0 && (
                        <ul className="list-disc pl-4 space-y-0.5 text-[10px] text-red-300/80 font-mono">
                          {atsResult.ghost_job_reasons.map((reason, i) => (
                            <li key={i}>{reason}</li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}

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
                  <button
                    onClick={openRecruiterTab}
                    className={`px-6 py-2.5 border-b-2 font-semibold transition-all cursor-pointer ${
                      activeTab === "recruiter"
                        ? "border-[#8aebff] text-[#8aebff]"
                        : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                    }`}
                  >
                    RECRUITER READ
                  </button>
                  <button
                    onClick={openPrepTab}
                    className={`px-6 py-2.5 border-b-2 font-semibold transition-all cursor-pointer ${
                      activeTab === "prep"
                        ? "border-[#8aebff] text-[#8aebff]"
                        : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                    }`}
                  >
                    OUTREACH & PREP
                  </button>
                  <button
                    onClick={() => openDossierTab(atsResult.job_ref)}
                    className={`px-6 py-2.5 border-b-2 font-semibold transition-all cursor-pointer ${
                      activeTab === "dossier"
                        ? "border-[#c084fc] text-[#c084fc]"
                        : "border-transparent text-[#859397] hover:text-[#dfe2f3]"
                    }`}
                  >
                    LIVE DOSSIER 🌐
                  </button>
                  {atsResult.domain_mismatch?.mismatched && (
                    <button
                      onClick={() => setActiveTab("error")}
                      className={`px-6 py-2.5 border-b-2 font-semibold transition-all cursor-pointer ${
                        activeTab === "error"
                          ? "border-[#ffb4ab] text-[#ffb4ab]"
                          : "border-transparent text-[#ffb4ab]/60 hover:text-[#ffb4ab]"
                      }`}
                    >
                      ALIGNMENT ALERT 🚨
                    </button>
                  )}
                </div>

                {activeTab === "keyword" && (
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
                )}

                {activeTab === "star" && (
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

                {activeTab === "recruiter" && (
                  <div className="space-y-4 font-mono text-xs">
                    {recruiterLoading && (
                      <div className="flex items-center gap-2 text-[#8aebff] py-6 justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Reading your résumé like a recruiter…</span>
                      </div>
                    )}
                    {!recruiterLoading && recruiterError && (
                      <div className="p-4 rounded-lg bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 text-[#ffb4ab] space-y-3">
                        <p>{recruiterError}</p>
                        {activeAtsAppId != null && (
                          <button
                            onClick={() => loadRecruiterReview(activeAtsAppId, true)}
                            className="px-3 py-1.5 rounded border border-[#ffb4ab]/40 hover:bg-[#ffb4ab]/10 transition-all cursor-pointer"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                    {!recruiterLoading && !recruiterError && recruiterReview && (
                      <>
                        {/* Verdict + fit score */}
                        <div className="p-4 bg-white/5 rounded-lg border border-white/5 flex items-start gap-4">
                          <div className="flex flex-col items-center flex-shrink-0">
                            <span className="text-3xl font-extrabold text-[#8aebff] leading-none">
                              {recruiterReview.role_fit_score}
                            </span>
                            <span className="text-[9px] text-[#859397] uppercase tracking-widest mt-1">
                              Fit
                            </span>
                          </div>
                          <p className="text-[#dfe2f3] leading-relaxed self-center">
                            {recruiterReview.verdict}
                          </p>
                        </div>

                        {/* Six-second test */}
                        <div className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-2">
                          <span className="text-[10px] uppercase tracking-wider text-[#859397]">
                            6-Second Test
                          </span>
                          <div className="flex flex-wrap gap-3 pt-1">
                            {([
                              ["Role clear", recruiterReview.six_second_test?.role_clear],
                              ["Skills clear", recruiterReview.six_second_test?.skills_clear],
                              ["Impact clear", recruiterReview.six_second_test?.impact_clear],
                            ] as [string, boolean][]).map(([label, ok]) => (
                              <div key={label} className="flex items-center gap-1.5">
                                {ok ? (
                                  <CheckCircle2 className="w-4 h-4 text-[#8aebff]" />
                                ) : (
                                  <AlertCircle className="w-4 h-4 text-[#ffb4ab]" />
                                )}
                                <span className={ok ? "text-[#dfe2f3]" : "text-[#ffb4ab]"}>{label}</span>
                              </div>
                            ))}
                          </div>
                          {recruiterReview.six_second_test?.note && (
                            <p className="text-[10px] text-[#859397] italic pt-1 leading-relaxed">
                              {recruiterReview.six_second_test.note}
                            </p>
                          )}
                        </div>

                        {/* Strengths */}
                        {recruiterReview.strengths?.length > 0 && (
                          <div className="p-4 bg-[#8aebff]/5 rounded-lg border border-[#8aebff]/15 space-y-2">
                            <span className="text-[10px] uppercase tracking-wider text-[#8aebff]">
                              What stands out
                            </span>
                            <ul className="space-y-1.5">
                              {recruiterReview.strengths.map((s, i) => (
                                <li key={i} className="flex items-start gap-2 text-[#dfe2f3] leading-relaxed">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-[#8aebff] mt-0.5 flex-shrink-0" />
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Red flags */}
                        {recruiterReview.red_flags?.length > 0 && (
                          <div className="p-4 bg-[#ffd6a3]/5 rounded-lg border border-[#ffd6a3]/15 space-y-2">
                            <span className="text-[10px] uppercase tracking-wider text-[#ffd6a3]">
                              What makes a recruiter hesitate
                            </span>
                            <ul className="space-y-1.5">
                              {recruiterReview.red_flags.map((s, i) => (
                                <li key={i} className="flex items-start gap-2 text-[#dfe2f3] leading-relaxed">
                                  <AlertCircle className="w-3.5 h-3.5 text-[#ffd6a3] mt-0.5 flex-shrink-0" />
                                  {s}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        {/* Learning roadmap */}
                        {recruiterReview.learning_roadmap?.length > 0 && (
                          <div className="space-y-2">
                            <span className="text-[10px] uppercase tracking-wider text-[#859397]">
                              Skills to close the gap
                            </span>
                            {recruiterReview.learning_roadmap.map((r, i) => (
                              <div
                                key={i}
                                className="p-3 bg-white/5 rounded-lg border border-white/5 flex items-start justify-between gap-3"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-[#dfe2f3] font-semibold">{r.skill}</span>
                                    <span
                                      className={`text-[9px] px-1.5 py-0.5 rounded uppercase border ${
                                        r.importance === "high"
                                          ? "text-[#ffb4ab] border-[#ffb4ab]/30 bg-[#ffb4ab]/10"
                                          : r.importance === "medium"
                                          ? "text-[#ffd6a3] border-[#ffd6a3]/30 bg-[#ffd6a3]/10"
                                          : "text-[#859397] border-white/10 bg-white/5"
                                      }`}
                                    >
                                      {r.importance}
                                    </span>
                                  </div>
                                  <p className="text-[10px] text-[#859397] leading-relaxed">{r.reason}</p>
                                </div>
                                <span className="text-[10px] text-[#8aebff] whitespace-nowrap flex-shrink-0">
                                  {r.est_time}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}

                        <p className="text-[10px] text-[#859397] italic pt-1 leading-relaxed">
                          Coaching only — this reads your résumé as a recruiter would. It never
                          suggests fabricating experience.
                        </p>
                      </>
                    )}
                  </div>
                )}

                {activeTab === "prep" && (
                  <div className="space-y-4 font-mono text-xs">
                    {prepLoading && (
                      <div className="flex items-center gap-2 text-[#8aebff] py-6 justify-center">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Generating custom outreach templates & STAR stories…</span>
                      </div>
                    )}
                    {!prepLoading && prepError && (
                      <div className="p-4 rounded-lg bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 text-[#ffb4ab] space-y-3">
                        <p>{prepError}</p>
                        {activeAtsAppId != null && (
                          <button
                            onClick={() => loadJobPrep(activeAtsAppId, true)}
                            className="px-3 py-1.5 rounded border border-[#ffb4ab]/40 hover:bg-[#ffb4ab]/10 transition-all cursor-pointer"
                          >
                            Retry
                          </button>
                        )}
                      </div>
                    )}
                    {!prepLoading && !prepError && jobPrep && (
                      <>
                        {/* LinkedIn Outreach */}
                        <div className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] uppercase tracking-wider text-[#8aebff] font-bold">
                              LinkedIn Connection Request (300 Chars Limit)
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(jobPrep.outreach_linkedin);
                                alert("Copied LinkedIn outreach to clipboard!");
                              }}
                              className="px-2 py-1 rounded bg-[#8aebff]/10 hover:bg-[#8aebff]/20 text-[#8aebff] text-[10px] border border-[#8aebff]/30 cursor-pointer"
                            >
                              Copy Message
                            </button>
                          </div>
                          <div className="p-3 bg-[#0a0e1a]/60 rounded-lg border border-white/5 text-[#dfe2f3] whitespace-pre-wrap leading-relaxed">
                            {jobPrep.outreach_linkedin}
                          </div>
                          <p className="text-[9px] text-[#859397] text-right">
                            {jobPrep.outreach_linkedin.length} / 300 characters
                          </p>
                        </div>

                        {/* Cold Email Outreach */}
                        <div className="p-4 bg-white/5 rounded-lg border border-white/5 space-y-2">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] uppercase tracking-wider text-[#8aebff] font-bold">
                              Cold Email Outreach Template
                            </span>
                            <button
                              onClick={() => {
                                navigator.clipboard.writeText(jobPrep.outreach_email);
                                alert("Copied email outreach to clipboard!");
                              }}
                              className="px-2 py-1 rounded bg-[#8aebff]/10 hover:bg-[#8aebff]/20 text-[#8aebff] text-[10px] border border-[#8aebff]/30 cursor-pointer"
                            >
                              Copy Email
                            </button>
                          </div>
                          <div className="p-3 bg-[#0a0e1a]/60 rounded-lg border border-white/5 text-[#dfe2f3] whitespace-pre-wrap leading-relaxed max-h-60 overflow-y-auto font-sans">
                            {jobPrep.outreach_email}
                          </div>
                        </div>

                        {/* STAR Interview Stories */}
                        <div className="space-y-3">
                          <span className="text-[10px] uppercase tracking-wider text-[#859397] font-bold">
                            Tailored STAR Interview Prep (3 Q&As)
                          </span>
                          {jobPrep.star_stories.map((story, i) => (
                            <div key={i} className="p-4 bg-[#8aebff]/5 rounded-lg border border-[#8aebff]/15 space-y-3">
                              <h4 className="font-bold text-[#8aebff] leading-relaxed text-xs">
                                Q{i + 1}: {story.question}
                              </h4>
                              <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-1 text-[11px] font-sans">
                                <div className="p-2 bg-[#0a0e1a]/40 rounded border border-white/5">
                                  <span className="text-[9px] font-mono font-bold uppercase text-[#ffd6a3] block mb-1">Situation</span>
                                  <span className="text-[#dfe2f3]">{story.situation}</span>
                                </div>
                                <div className="p-2 bg-[#0a0e1a]/40 rounded border border-white/5">
                                  <span className="text-[9px] font-mono font-bold uppercase text-[#ffd6a3] block mb-1">Task</span>
                                  <span className="text-[#dfe2f3]">{story.task}</span>
                                </div>
                                <div className="p-2 bg-[#0a0e1a]/40 rounded border border-white/5">
                                  <span className="text-[9px] font-mono font-bold uppercase text-[#ffd6a3] block mb-1">Action</span>
                                  <span className="text-[#dfe2f3]">{story.action}</span>
                                </div>
                                <div className="p-2 bg-[#0a0e1a]/40 rounded border border-white/5">
                                  <span className="text-[9px] font-mono font-bold uppercase text-[#a3e635] block mb-1">Result</span>
                                  <span className="text-[#dfe2f3]">{story.result}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Regenerate Button */}
                        <div className="flex justify-end pt-2">
                          <button
                            onClick={() => loadJobPrep(activeAtsAppId!, true)}
                            className="px-3 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-[#dfe2f3] font-bold border border-white/10 cursor-pointer flex items-center gap-1.5"
                          >
                            <RefreshCw className="w-3.5 h-3.5" /> Regenerate Prep Kit
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {activeTab === "dossier" && (
                  <div className="space-y-4 p-4 font-mono">
                    <div className="flex items-center justify-between border-b border-white/5 pb-3">
                      <div>
                        <h3 className="text-sm font-bold text-[#dfe2f3] flex items-center gap-2">
                          <Globe className="w-4 h-4 text-[#c084fc]" /> Pre-Interview Intelligence Dossier
                        </h3>
                        <p className="text-[11px] text-[#859397]">
                          Live Google Search Grounding: recent news, Glassdoor/Reddit questions & executive notes.
                        </p>
                      </div>
                      <button
                        onClick={() => openDossierTab(atsResult.job_ref)}
                        disabled={dossierLoading}
                        className="px-3 py-1.5 rounded text-xs font-bold bg-[#c084fc]/20 border border-[#c084fc]/40 text-[#c084fc] hover:bg-[#c084fc] hover:text-[#0a0e1a] cursor-pointer disabled:opacity-50"
                      >
                        {dossierLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : "REFRESH LIVE SCAN"}
                      </button>
                    </div>

                    {dossierLoading ? (
                      <div className="py-12 text-center text-xs text-[#859397] space-y-2">
                        <RefreshCw className="w-6 h-6 animate-spin text-[#c084fc] mx-auto" />
                        <p>Scanning Google Web, Glassdoor, and Reddit for real-time intelligence...</p>
                      </div>
                    ) : dossierError ? (
                      <div className="p-3 rounded bg-red-950/20 border border-red-500/20 text-red-200 text-xs">
                        {dossierError}
                      </div>
                    ) : dossierData ? (
                      <div className="space-y-4 max-h-[380px] overflow-y-auto pr-1">
                        <div className="p-4 rounded-xl bg-white/[0.02] border border-white/5 text-xs text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">
                          {dossierData.dossier}
                        </div>

                        {dossierData.citations && dossierData.citations.length > 0 && (
                          <div className="space-y-2 border-t border-white/5 pt-3">
                            <h4 className="text-[10px] uppercase font-bold text-[#c084fc]">Google Search Verified Sources:</h4>
                            <div className="flex flex-wrap gap-2">
                              {dossierData.citations.map((c: any, idx: number) => (
                                <a
                                  key={idx}
                                  href={c.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1 rounded bg-[#c084fc]/10 border border-[#c084fc]/20 text-[10px] text-[#c084fc] hover:bg-[#c084fc]/20 flex items-center gap-1"
                                >
                                  <ArrowUpRight className="w-3 h-3" /> {c.title}
                                </a>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="py-8 text-center text-xs text-[#859397]">
                        Click "REFRESH LIVE SCAN" to generate real-time company news & interview dossiers.
                      </div>
                    )}
                  </div>
                )}

                {activeTab === "error" && atsResult.domain_mismatch && (
                  <div className="p-5 rounded-xl bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 text-[#ffb4ab] space-y-3 font-mono text-xs">
                    <div className="flex items-center gap-2 border-b border-[#ffb4ab]/20 pb-2">
                      <AlertCircle className="w-5 h-5 flex-shrink-0" />
                      <span className="font-bold uppercase tracking-wide text-sm">Domain Alignment Violation</span>
                    </div>
                    <p className="text-xs text-[#dfe2f3]/90 leading-relaxed">
                      {atsResult.domain_mismatch.reason}
                    </p>
                    <div className="p-3 bg-[#0a0e1a]/50 rounded-lg border border-white/5 text-[10px] text-[#859397] leading-relaxed">
                      💡 **Security Guardrail Active**: Auto-apply and resume tailoring have been disabled for this job because attempting to rewrite Data Analyst projects to match Cybersecurity requirements would result in fabricated skill descriptions.
                    </div>
                  </div>
                )}
              </div>

              {/* Modal footer actions */}
              <div className="p-6 bg-white/5 border-t border-white/5 flex flex-col sm:flex-row gap-3">
                <button
                  disabled={atsResult.domain_mismatch?.mismatched}
                  onClick={() => openApply(atsResult.job_ref, atsResult.keyword_matrix.missing)}
                  className="flex-1 bg-[#a3e635]/10 border border-[#a3e635]/40 text-[#a3e635] hover:bg-[#a3e635] hover:text-[#0a0e1a] py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#a3e635]/10 disabled:hover:text-[#a3e635]"
                  title={atsResult.domain_mismatch?.mismatched ? "Apply disabled due to domain mismatch" : "Apply the changes to your uploaded .docx, keeping its exact format"}
                >
                  <ClipboardCheck className="w-4.5 h-4.5" /> APPLY TO MY .DOCX
                </button>
                <button
                  onClick={() => openInGoogleDoc(atsResult.job_ref)}
                  disabled={docLoading || atsResult.domain_mismatch?.mismatched}
                  className="flex-1 bg-[#8aebff]/10 border border-[#8aebff]/40 text-[#8aebff] hover:bg-[#8aebff] hover:text-[#00363e] py-3 rounded-lg text-sm font-bold flex items-center justify-center gap-2 transition-all cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-[#8aebff]/10 disabled:hover:text-[#8aebff]"
                  title={atsResult.domain_mismatch?.mismatched ? "Google Doc creation disabled due to domain mismatch" : "Create a Google Doc with your résumé + the changes to make"}
                >
                  {docLoading ? (
                    <><RefreshCw className="w-4.5 h-4.5 animate-spin" /> CREATING DOC…</>
                  ) : (
                    <><FileText className="w-4.5 h-4.5" /> OPEN IN GOOGLE DOCS</>
                  )}
                </button>
                <button
                  onClick={() => {
                    const tok = getToken();
                    const path = `/ats/${encodeURIComponent(atsResult.job_ref)}/download`;
                    const url = tok ? `${path}?token=${encodeURIComponent(tok)}` : path;
                    window.open(url, "_blank");
                  }}
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
                    disabled={resumeLoading || resumeUploading}
                    value={resumeContent}
                    onChange={(e) => setResumeContent(e.target.value)}
                    placeholder="Paste your master résumé text here — or use “Upload PDF / DOC” below to import a file…"
                    className="w-full min-h-[320px] bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-4 font-mono text-xs text-[#dfe2f3] leading-relaxed focus:outline-none focus:border-[#8aebff]/40 resize-y disabled:opacity-50"
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
                  disabled={resumeSaving || resumeLoading || resumeUploading}
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

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                    Job Description
                  </label>
                  <textarea
                    value={manual.description || ""}
                    onChange={(e) => setManual((m) => ({ ...m, description: e.target.value }))}
                    placeholder="Paste the job posting description here (required for 'Add & Analyze')..."
                    className="w-full h-24 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 resize-y"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397] block mb-1.5">
                    Notes
                  </label>
                  <textarea
                    value={manual.notes || ""}
                    onChange={(e) => setManual((m) => ({ ...m, notes: e.target.value }))}
                    placeholder="Add personal notes or tracking remarks..."
                    className="w-full h-20 bg-[#0a0e1a]/60 border border-white/10 rounded-lg px-3 py-2.5 font-mono text-sm text-[#dfe2f3] focus:outline-none focus:border-[#8aebff]/40 resize-y"
                  />
                </div>

                {addError && <p className="text-xs font-mono text-[#ffb4ab]">{addError}</p>}
              </div>

              <div className="p-6 pt-0 flex flex-wrap justify-end gap-3">
                <button
                  onClick={() => setAddOpen(false)}
                  className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#bbc9cd] bg-white/5 border border-white/10 hover:bg-white/10 transition-all cursor-pointer"
                >
                  CANCEL
                </button>
                <button
                  onClick={() => saveManual(false)}
                  disabled={addSaving}
                  className="px-5 py-2.5 rounded-lg text-xs font-bold font-mono bg-white/10 hover:bg-white/20 text-[#dfe2f3] border border-white/10 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {addSaving ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> ADDING…</>
                  ) : (
                    <><Plus className="w-3.5 h-3.5" /> ADD ONLY</>
                  )}
                </button>
                <button
                  onClick={() => saveManual(true)}
                  disabled={addSaving}
                  className="px-6 py-2.5 rounded-lg text-xs font-bold font-mono bg-[#8aebff] hover:bg-[#22d3ee] text-[#00363e] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                >
                  {addSaving ? (
                    <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> ANALYZING…</>
                  ) : (
                    <><Sparkles className="w-3.5 h-3.5" /> ADD & ANALYZE</>
                  )}
                </button>
              </div>

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ATS Deep Scout direct careers scanner */}
      <AnimatePresence>
        {atsSearchOpen && (
          <div className="fixed inset-0 z-[120] flex items-start justify-center pt-[8vh] px-4 bg-[#0a0e1a]/80 backdrop-blur-md overflow-y-auto">
            <div className="absolute inset-0" onClick={() => setAtsSearchOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 24, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 12, scale: 0.98 }}
              className="relative w-full max-w-2xl mb-16 bg-[#0f131f] border border-[#3c494c] rounded-2xl shadow-2xl flex flex-col max-h-[84vh]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6 border-b border-white/10 flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-bold font-mono tracking-wide text-[#c084fc] flex items-center gap-2">
                    <Globe className="w-5 h-5 animate-pulse" /> ATS DEEP SCOUT
                  </h3>
                  <p className="text-[11px] font-mono text-[#859397] mt-1">
                    Crawl company career portals directly (Greenhouse, Lever, Workday, Ashby) for exact role & experience.
                  </p>
                </div>
                <button
                  onClick={() => setAtsSearchOpen(false)}
                  className="w-9 h-9 rounded-full border border-white/10 flex items-center justify-center text-[#859397] hover:text-white hover:border-white/30 transition-all cursor-pointer"
                >
                  <X className="w-4.5 h-4.5" />
                </button>
              </div>

              <div className="p-6 space-y-4 overflow-y-auto flex-1 font-mono text-xs">
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="text-[10px] uppercase text-[#859397] block mb-1">Target Role</label>
                    <input
                      value={atsRole}
                      onChange={(e) => setAtsRole(e.target.value)}
                      placeholder="e.g. Data Analyst"
                      className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-2.5 text-xs text-[#dfe2f3]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-[#859397] block mb-1">Experience Level</label>
                    <input
                      value={atsExperience}
                      onChange={(e) => setAtsExperience(e.target.value)}
                      placeholder="e.g. 2+ years"
                      className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-2.5 text-xs text-[#dfe2f3]"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] uppercase text-[#859397] block mb-1">Target Location</label>
                    <input
                      value={atsLocation}
                      onChange={(e) => setAtsLocation(e.target.value)}
                      placeholder="e.g. India"
                      className="w-full bg-[#0a0e1a]/60 border border-white/10 rounded-lg p-2.5 text-xs text-[#dfe2f3]"
                    />
                  </div>
                </div>

                <div className="flex justify-end pt-1">
                  <button
                    onClick={searchAtsJobs}
                    disabled={atsSearching || !atsRole.trim()}
                    className="px-5 py-2.5 rounded-lg text-xs font-bold bg-[#c084fc] text-[#0a0e1a] hover:bg-[#a855f7] cursor-pointer disabled:opacity-50 flex items-center gap-1.5"
                  >
                    {atsSearching ? (
                      <><RefreshCw className="w-4 h-4 animate-spin" /> SEARCHING PORTALS…</>
                    ) : (
                      <><Search className="w-4 h-4" /> RUN ATS DEEP SCOUT</>
                    )}
                  </button>
                </div>

                {atsError && (
                  <div className="p-3 rounded bg-red-950/20 border border-red-500/20 text-red-200">
                    {atsError}
                  </div>
                )}

                <div className="space-y-3 pt-2">
                  {atsResults.length > 0 && (
                    <div className="text-[10px] uppercase tracking-wider text-[#c084fc] font-bold">
                      Direct Application Listings Found:
                    </div>
                  )}

                  {atsResults.map((job, idx) => (
                    <div key={idx} className="p-4 rounded-xl bg-white/[0.02] border border-white/5 hover:border-white/10 transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-bold text-[#dfe2f3]">{job.title}</span>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-[#c084fc]/15 border border-[#c084fc]/30 text-[#c084fc]">
                            {job.ats}
                          </span>
                        </div>
                        <p className="text-xs text-[#859397]">
                          {job.company} • {job.location}
                        </p>
                        <p className="text-[10px] text-[#a3e635]">
                          Experience: {job.experience}
                        </p>
                      </div>

                      <div className="flex items-center gap-2 self-end sm:self-center">
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1.5 rounded bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-[#dfe2f3] flex items-center gap-1"
                        >
                          <ExternalLink className="w-3.5 h-3.5" /> Apply
                        </a>
                        <button
                          onClick={() => importAtsJob(job)}
                          className="px-3 py-1.5 rounded bg-[#a3e635]/15 hover:bg-[#a3e635] hover:text-[#0a0e1a] border border-[#a3e635]/30 text-[#a3e635] text-xs font-bold cursor-pointer transition-all"
                        >
                          + Track
                        </button>
                      </div>
                    </div>
                  ))}

                  {atsResults.length === 0 && !atsSearching && !atsError && (
                    atsHasSearched ? (
                      <div className="py-10 text-center text-xs text-[#859397] space-y-2 bg-white/[0.01] border border-white/5 rounded-xl p-6">
                        <Globe className="w-8 h-8 text-[#c084fc]/50 mx-auto mb-1 animate-pulse" />
                        <p className="font-bold text-[#dfe2f3]">No direct ATS job postings found for "{atsRole}".</p>
                        <p className="text-[11px] text-[#859397]">Try broadening your target role title, experience level, or location keywords.</p>
                      </div>
                    ) : (
                      <div className="py-12 text-center text-xs text-[#859397] space-y-1">
                        <Globe className="w-8 h-8 text-white/10 mx-auto mb-2" />
                        <p>Enter the search criteria and click "RUN ATS DEEP SCOUT".</p>
                        <p className="text-[10px] text-[#859397]/60">Gemini searches directly through hosted Workday, Lever, Ashby, and Greenhouse portals.</p>
                      </div>
                    )
                  )}
                </div>
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
                    
                    <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
                      <input
                        ref={auditResumeFileRef}
                        type="file"
                        accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) uploadResumeFile(f);
                        }}
                      />
                      <button
                        onClick={() => auditResumeFileRef.current?.click()}
                        disabled={resumeUploading || auditRunning}
                        className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                      >
                        {resumeUploading ? (
                          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> READING…</>
                        ) : (
                          <><Upload className="w-3.5 h-3.5" /> UPLOAD CV</>
                        )}
                      </button>

                      {hasDocx && (
                        <button
                          onClick={downloadMasterDocx}
                          className="px-5 py-2.5 rounded-lg text-xs font-semibold font-mono text-[#22d3ee] bg-[#22d3ee]/10 border border-[#22d3ee]/30 hover:bg-[#22d3ee]/20 transition-all cursor-pointer flex items-center gap-2"
                        >
                          <Download className="w-3.5 h-3.5" /> DOWNLOAD DOCX
                        </button>
                      )}

                      <button
                        onClick={runAudit}
                        disabled={auditRunning || resumeUploading}
                        className="px-6 py-2.5 rounded-lg text-sm font-bold bg-[#a3e635] hover:bg-[#bef264] text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                      >
                        {auditRunning ? <><RefreshCw className="w-4 h-4 animate-spin" /> AUDITING…</> : <><Sparkles className="w-4 h-4" /> RUN AUDIT</>}
                      </button>
                    </div>
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

                    {/* Score breakdown — deterministic, so fixing an item raises this and keeps it up */}
                    {Array.isArray(audit.breakdown) && audit.breakdown.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2">Where your score comes from</h4>
                        <div className="space-y-1.5">
                          {audit.breakdown.map((b: { criterion: string; score: number; max: number }) => {
                            const pct = b.max ? Math.round((b.score / b.max) * 100) : 0;
                            const tone = pct >= 85 ? "#5eead4" : pct >= 50 ? "#ffd6a3" : "#ffb4ab";
                            return (
                              <div key={b.criterion} className="flex items-center gap-2">
                                <span className="w-36 shrink-0 text-xs text-[#dfe2f3] truncate" title={b.criterion}>{b.criterion}</span>
                                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, background: tone }} />
                                </div>
                                <span className="w-12 shrink-0 text-right text-[10px] font-mono" style={{ color: tone }}>{b.score}/{b.max}</span>
                              </div>
                            );
                          })}
                        </div>
                        <p className="text-[10px] font-mono text-[#859397] mt-2">Rule-based score — fix an item and it goes up and stays up (no more bouncing).</p>
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
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2 flex items-center justify-between">
                          <span>Grammar & wording corrections (click to toggle)</span>
                          {selectedGrammar.length > 0 && (
                            <span className="text-[#5eead4] text-[10px] lowercase font-normal">({selectedGrammar.length} selected)</span>
                          )}
                        </h4>
                        <div className="space-y-2">
                          {audit.grammar.map((g: any, i: number) => {
                            const dateRegex = /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|20\d\d|\d{1,2}[\/\-]\d{2,4})\b/i;
                            const isDate = dateRegex.test(g.original || "") || dateRegex.test(g.suggestion || "");
                            
                            const isChecked = selectedGrammar.some((item: any) =>
                              item.original === g.original && item.suggestion === g.suggestion
                            );
                            
                            const handleToggle = () => {
                              if (isChecked) {
                                setSelectedGrammar(prev => prev.filter(x => !(x.original === g.original && x.suggestion === g.suggestion)));
                              } else {
                                if (isDate) {
                                  const confirmChange = window.confirm(
                                    `⚠️ DATE CHANGE CONFIRMATION:\n\n` +
                                    `Are you sure you want to change this date range in your resume?\n\n` +
                                    `From: "${g.original}"\n` +
                                    `To: "${g.suggestion}"`
                                  );
                                  if (!confirmChange) return;
                                }
                                setSelectedGrammar(prev => [...prev, g]);
                              }
                            };

                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={handleToggle}
                                className={`w-full text-left p-2 rounded text-[12px] font-mono border transition-all cursor-pointer block ${
                                  isChecked
                                    ? "bg-[#5eead4]/5 border-[#5eead4]/30 text-[#dfe2f3]"
                                    : "bg-transparent border-white/5 text-[#859397] hover:bg-white/5"
                                }`}
                              >
                                <div className="flex items-start gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isChecked}
                                    onChange={() => {}}
                                    className="mt-0.5 pointer-events-none accent-[#5eead4]"
                                  />
                                  <div className="flex-1">
                                    <span className="line-through opacity-75">{g.original}</span>{" "}
                                    <span className="text-[#5eead4]">→ {g.suggestion}</span>
                                    {g.type && <span className="text-[9px] text-[#859397] ml-2 bg-white/5 px-1 py-0.5 rounded">({g.type})</span>}
                                    {isDate && <span className="text-[9px] text-[#f43f5e] ml-2 font-bold bg-[#f43f5e]/10 px-1 py-0.5 rounded">📅 Date Range</span>}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Keywords to add */}
                    {Array.isArray(audit.keywords_to_add) && audit.keywords_to_add.length > 0 && (
                      <div>
                        <h4 className="text-xs font-bold font-mono uppercase tracking-widest text-[#859397] mb-2 flex items-center justify-between">
                          <span>Keywords to consider adding (click to select for injection)</span>
                          {selectedAuditKeywords.length > 0 && (
                            <span className="text-[#a3e635] text-[10px] lowercase font-normal">({selectedAuditKeywords.length} selected)</span>
                          )}
                        </h4>
                        <div className="flex flex-wrap gap-1.5">
                          {audit.keywords_to_add.map((k: string, i: number) => {
                            const isSelected = selectedAuditKeywords.includes(k);
                            return (
                              <button
                                key={i}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    setSelectedAuditKeywords(prev => prev.filter(x => x !== k));
                                  } else {
                                    setSelectedAuditKeywords(prev => [...prev, k]);
                                  }
                                }}
                                className={`text-[11px] font-mono px-2.5 py-1 rounded transition-all cursor-pointer border ${
                                  isSelected
                                    ? "bg-[#a3e635]/25 border-[#a3e635] text-[#a3e635] shadow-[0_0_8px_rgba(163,230,53,0.2)]"
                                    : "bg-[#8aebff]/10 border-[#8aebff]/20 text-[#8aebff] hover:bg-[#8aebff]/20"
                                }`}
                              >
                                {k}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {auditError && <p className="text-xs font-mono text-[#ffb4ab]">{auditError}</p>}
                  </>
                )}
              </div>

              {/* Footer */}
              {audit && !auditFetching && (
                <div className="p-4 border-t border-white/5 flex items-center justify-between flex-wrap gap-3">
                  <div className="flex gap-2 items-center">
                    <input
                      ref={auditResumeFileRef}
                      type="file"
                      accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadResumeFile(f);
                      }}
                    />
                    <button
                      onClick={() => auditResumeFileRef.current?.click()}
                      disabled={resumeUploading || auditRunning}
                      className="px-4 py-2 rounded-lg text-xs font-semibold font-mono text-[#8aebff] bg-[#8aebff]/10 border border-[#8aebff]/30 hover:bg-[#8aebff]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                    >
                      {resumeUploading ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> READING…</>
                      ) : (
                        <><Upload className="w-3.5 h-3.5" /> UPLOAD CV</>
                      )}
                    </button>

                    {hasDocx && (
                      <button
                        onClick={downloadMasterDocx}
                        className="px-4 py-2 rounded-lg text-xs font-semibold font-mono text-[#22d3ee] bg-[#22d3ee]/10 border border-[#22d3ee]/30 hover:bg-[#22d3ee]/20 transition-all cursor-pointer flex items-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5" /> DOWNLOAD DOCX
                      </button>
                    )}

                    {hasDocx && audit.grammar && audit.grammar.length > 0 && (
                      <button
                        onClick={applyAuditSuggestions}
                        disabled={auditApplying || auditRunning || resumeUploading}
                        className="px-4 py-2 rounded-lg text-xs font-semibold font-mono text-[#a3e635] bg-[#a3e635]/10 border border-[#a3e635]/30 hover:bg-[#a3e635]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                        title="Apply all suggested grammar & wording changes directly to your master Word document"
                      >
                        {auditApplying ? (
                          <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> APPLYING…</>
                        ) : (
                          <><CheckCircle2 className="w-3.5 h-3.5" /> APPLY AI SUGGESTIONS</>
                        )}
                      </button>
                    )}

                    {/* Always-visible one-tap fix for the deterministic points */}
                    <button
                      onClick={autoFixResume}
                      disabled={autoFixing || auditRunning || resumeUploading}
                      className="px-4 py-2 rounded-lg text-xs font-bold font-mono text-[#0a0e1a] bg-[#a3e635] hover:bg-[#bef264] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                      title="Auto-apply the fixable ATS items: single-column layout + a SUMMARY heading, then re-score"
                    >
                      {autoFixing ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> AUTO-FIXING…</>
                      ) : (
                        <><Sparkles className="w-3.5 h-3.5" /> AUTO-FIX</>
                      )}
                    </button>

                    <button
                      onClick={deleteResume}
                      disabled={deletingResume || auditRunning || resumeUploading || autoFixing}
                      className="px-4 py-2 rounded-lg text-xs font-semibold font-mono text-[#ffb4ab] bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 hover:bg-[#ffb4ab]/20 transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                      title="Delete the stored master résumé (text + .docx + cached audit) so you can upload a fresh version. Applications and per-job ATS analyses are kept."
                    >
                      {deletingResume ? (
                        <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> DELETING…</>
                      ) : (
                        <><Trash2 className="w-3.5 h-3.5" /> DELETE RÉSUMÉ</>
                      )}
                    </button>
                  </div>

                  <button
                    onClick={runAudit}
                    disabled={auditRunning || resumeUploading}
                    className="px-5 py-2 rounded-lg text-xs font-bold bg-[#a3e635]/10 border border-[#a3e635]/30 text-[#a3e635] hover:bg-[#a3e635] hover:text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-50 flex items-center gap-2"
                  >
                    {auditRunning ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> RE-AUDITING…</> : <><RefreshCw className="w-3.5 h-3.5" /> RE-RUN AUDIT</>}
                  </button>
                  {autoFixMsg && (
                    <div className="w-full text-[11px] font-mono text-[#a3e635] bg-[#a3e635]/5 border border-[#a3e635]/15 rounded-lg px-3 py-2">
                      ✨ {autoFixMsg}
                    </div>
                  )}
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
                      onClick={() => {
                        const tok = getToken();
                        const url = tok ? `${applyResult.download}?token=${encodeURIComponent(tok)}` : applyResult.download;
                        window.open(url, "_blank");
                      }}
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

      {/* ── Recruiter follow-ups modal ── */}
      <AnimatePresence>
        {followOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="w-full max-w-2xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#ffd6a3]/25 max-h-[90vh] flex flex-col">
              <div className="p-6 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono flex items-center gap-2">
                    <Clock className="w-5 h-5 text-[#ffd6a3]" /> Follow-ups
                  </h2>
                  <p className="text-xs font-mono text-[#859397] mt-1">Applied &gt; 7 days ago, no reply yet · draft a gracious nudge</p>
                </div>
                <button onClick={() => setFollowOpen(false)} aria-label="Close" className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#ffd6a3] rounded-full border border-white/5 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              {followMsg && <div className="px-6 py-2 text-xs font-mono text-[#a3e635] bg-[#a3e635]/5 border-b border-[#a3e635]/10">{followMsg}</div>}
              <div className="overflow-y-auto p-4 space-y-3">
                {followLoading ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">Loading…</div>
                ) : followDraft ? (
                  <div className="space-y-3">
                    <div className="text-xs font-mono text-[#859397]">Follow-up for <b className="text-[#dfe2f3]">{followDraft.card?.title}</b>{followDraft.card?.company ? ` — ${followDraft.card.company}` : ""}</div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">To</label>
                      <input value={followDraft.recipient || ""} onChange={(e) => setFollowDraft({ ...followDraft, recipient: e.target.value })}
                        placeholder="No apply address found — paste the recruiter's email"
                        className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] font-mono focus:outline-none focus:border-[#ffd6a3]/40" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">Subject</label>
                      <input value={followDraft.subject} onChange={(e) => setFollowDraft({ ...followDraft, subject: e.target.value })}
                        className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] focus:outline-none focus:border-[#ffd6a3]/40" />
                    </div>
                    <div>
                      <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">Body</label>
                      <textarea value={followDraft.body} onChange={(e) => setFollowDraft({ ...followDraft, body: e.target.value })} rows={9}
                        className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] leading-relaxed focus:outline-none focus:border-[#ffd6a3]/40" />
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={sendFollowup} disabled={followSending || !followDraft.recipient}
                        title={!followDraft.recipient ? "Add a recipient to send" : "Send via Gmail"}
                        className="flex-1 py-2.5 rounded-lg text-sm font-bold bg-[#ffd6a3] hover:bg-[#ffe0b8] text-[#0a0e1a] transition-all cursor-pointer disabled:opacity-40 flex items-center justify-center gap-2">
                        {followSending ? <><RefreshCw className="w-4 h-4 animate-spin" /> SENDING…</> : <><Send className="w-4 h-4" /> SEND</>}
                      </button>
                      <button onClick={() => navigator.clipboard?.writeText(`${followDraft.subject}\n\n${followDraft.body}`)}
                        className="px-4 py-2.5 rounded-lg text-sm font-bold bg-white/5 border border-white/10 text-[#bbc9cd] hover:bg-white/10 cursor-pointer">Copy</button>
                      <button onClick={() => setFollowDraft(null)} className="px-4 py-2.5 rounded-lg text-sm font-bold bg-white/5 border border-white/10 text-[#859397] hover:bg-white/10 cursor-pointer">Back</button>
                    </div>
                  </div>
                ) : followCands.length === 0 ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">🎉 Nothing stale — every applied card is fresh or has moved.</div>
                ) : (
                  followCands.map((c) => (
                    <div key={c.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#dfe2f3] truncate flex items-center gap-2">
                          {c.title}
                          {c.ready && <span className="shrink-0 text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-[#5eead4]/15 text-[#5eead4] border border-[#5eead4]/25 uppercase tracking-wider">Draft ready</span>}
                        </div>
                        <div className="text-[11px] font-mono text-[#859397] truncate">{c.company}{c.location ? ` • ${c.location}` : ""}</div>
                        <div className="text-[10px] font-mono mt-1 flex items-center gap-2">
                          <span className="text-[#ffd6a3]">{c.days_since_applied}d silent</span>
                          <span className={c.recipient ? "text-[#5eead4]" : "text-[#859397]"}>{c.recipient ? `✉ ${c.recipient}` : "no apply email"}</span>
                        </div>
                      </div>
                      <button onClick={() => draftFollowup(c)} disabled={followBusyId === c.id}
                        className={`shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold font-mono border cursor-pointer disabled:opacity-50 ${c.ready ? "bg-[#5eead4]/10 border-[#5eead4]/30 text-[#5eead4] hover:bg-[#5eead4]/20" : "bg-[#ffd6a3]/10 border-[#ffd6a3]/30 text-[#ffd6a3] hover:bg-[#ffd6a3]/20"}`}>
                        {followBusyId === c.id ? "OPENING…" : c.ready ? "REVIEW & SEND" : "DRAFT FOLLOW-UP"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Per-company email timeline modal ── */}
      <AnimatePresence>
        {emailsOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="w-full max-w-2xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#a3e635]/25 max-h-[85vh] flex flex-col">
              <div className="p-6 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-extrabold text-[#dfe2f3] tracking-wide font-mono flex items-center gap-2">
                    <Mail className="w-5 h-5 text-[#a3e635]" /> {emailsFor?.company || "Company"} — email
                  </h2>
                  <p className="text-xs font-mono text-[#859397] mt-1">{emailsFor?.title}</p>
                </div>
                <button onClick={() => setEmailsOpen(false)} aria-label="Close" className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#a3e635] rounded-full border border-white/5 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto p-4 space-y-2">
                {emailsLoading ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">Searching your inbox…</div>
                ) : emailThreads.length === 0 ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">No email found for this company.<div className="text-[11px] mt-1 opacity-70">Needs a connected Gmail account and matching correspondence.</div></div>
                ) : (
                  emailThreads.map((t) => (
                    <div key={t.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-[#dfe2f3] truncate flex items-center gap-2">
                          {t.unread && <span className="w-2 h-2 rounded-full bg-[#8aebff] shrink-0" />}{t.subject}
                        </span>
                        <span className="text-[10px] font-mono text-[#859397] shrink-0">{t.date ? new Date(t.date).toLocaleDateString() : ""}</span>
                      </div>
                      <div className="text-[11px] font-mono text-[#859397] mt-0.5">{t.from}</div>
                      <div className="text-[12px] text-[#bbc9cd] mt-1 line-clamp-2">{t.snippet}</div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Interview prep dock modal ── */}
      <AnimatePresence>
        {prepOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="w-full max-w-2xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#5eead4]/25 max-h-[90vh] flex flex-col">
              <div className="p-6 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <div>
                  <h2 className="text-xl font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono flex items-center gap-2">
                    <CalendarClock className="w-5 h-5 text-[#5eead4]" /> Interview Prep
                  </h2>
                  <p className="text-xs font-mono text-[#859397] mt-1">Upcoming interviews from your calendar</p>
                </div>
                <button onClick={() => setPrepOpen(false)} aria-label="Close" className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#5eead4] rounded-full border border-white/5 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              <div className="overflow-y-auto p-4 space-y-3">
                {interviewsLoading ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">Reading your calendar…</div>
                ) : prepBrief ? (
                  <div className="space-y-3">
                    <button onClick={() => setPrepBrief(null)} className="text-[11px] font-mono text-[#5eead4] hover:underline cursor-pointer">← back to interviews</button>
                    <div className="text-sm font-bold text-[#dfe2f3]">{prepBrief.ev.summary}</div>
                    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 space-y-1">{renderMarkdown(prepBrief.markdown)}</div>
                  </div>
                ) : interviews.length === 0 ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-10">No upcoming interviews detected.<div className="text-[11px] mt-1 opacity-70">Add interview events to your calendar (or use words like "interview"/"screen" in the title).</div></div>
                ) : (
                  interviews.map((ev) => (
                    <div key={ev.id} className="rounded-lg border border-white/5 bg-white/[0.02] p-4 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-[#dfe2f3] truncate">{ev.summary}</div>
                        <div className="text-[11px] font-mono text-[#859397] mt-0.5">
                          {ev.start ? new Date(ev.start).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : ""}
                          {ev.company ? ` · ${ev.company}` : ""}
                        </div>
                      </div>
                      <button onClick={() => buildPrep(ev)} disabled={prepBusyId === ev.id}
                        className="shrink-0 px-3 py-2 rounded-lg text-[11px] font-bold font-mono bg-[#5eead4]/10 border border-[#5eead4]/30 text-[#5eead4] hover:bg-[#5eead4]/20 cursor-pointer disabled:opacity-50">
                        {prepBusyId === ev.id ? "PREPPING…" : "BUILD BRIEF"}
                      </button>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Workspace notes modal ── */}
      <AnimatePresence>
        {notesOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="w-full max-w-4xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#c084fc]/25 h-[80vh] flex flex-col">
              <div className="p-5 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <h2 className="text-lg font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono flex items-center gap-2">
                  <StickyNote className="w-5 h-5 text-[#c084fc]" /> Workspace Notes
                </h2>
                <button onClick={() => setNotesOpen(false)} aria-label="Close" className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#c084fc] rounded-full border border-white/5 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              <div className="flex-1 flex min-h-0">
                {/* list */}
                <div className="w-64 shrink-0 border-r border-white/5 flex flex-col">
                  <button onClick={newNote} className="m-3 px-3 py-2 rounded-lg text-[11px] font-bold font-mono bg-[#c084fc]/10 border border-[#c084fc]/30 text-[#c084fc] hover:bg-[#c084fc]/20 cursor-pointer flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" /> NEW NOTE</button>
                  <div className="overflow-y-auto px-3 pb-3 space-y-1">
                    {notesLoading ? <div className="text-center text-[#859397] font-mono text-xs py-6">Loading…</div> :
                      notes.length === 0 ? <div className="text-center text-[#859397] font-mono text-xs py-6">No notes yet.</div> :
                        notes.map((n) => (
                          <div key={n.id} onClick={() => selectNote(n)}
                            className={`group rounded-lg px-3 py-2 cursor-pointer border ${activeNote?.id === n.id ? "bg-[#c084fc]/10 border-[#c084fc]/30" : "border-transparent hover:bg-white/5"}`}>
                            <div className="flex items-center gap-1">
                              {n.pinned ? <Pin className="w-3 h-3 text-[#c084fc] shrink-0" /> : null}
                              <span className="text-sm text-[#dfe2f3] truncate flex-1">{n.title}</span>
                            </div>
                            <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={(e) => { e.stopPropagation(); togglePinNote(n); }} className="text-[9px] font-mono text-[#859397] hover:text-[#c084fc] cursor-pointer">{n.pinned ? "unpin" : "pin"}</button>
                              <button onClick={(e) => { e.stopPropagation(); deleteNote(n); }} className="text-[9px] font-mono text-[#859397] hover:text-[#ffb4ab] cursor-pointer">delete</button>
                            </div>
                          </div>
                        ))}
                  </div>
                </div>
                {/* editor */}
                <div className="flex-1 flex flex-col min-w-0 p-4">
                  {!activeNote ? (
                    <div className="flex-1 flex items-center justify-center text-[#859397] font-mono text-sm">Select a note or create a new one.</div>
                  ) : (
                    <>
                      <input value={noteDraft.title} onChange={(e) => setNoteDraft({ ...noteDraft, title: e.target.value })} placeholder="Title"
                        className="bg-transparent text-lg font-bold text-[#dfe2f3] focus:outline-none border-b border-white/5 pb-2 mb-3" />
                      <textarea value={noteDraft.body} onChange={(e) => setNoteDraft({ ...noteDraft, body: e.target.value })} placeholder="Markdown supported — ## headings, - bullets, **bold**…"
                        className="flex-1 bg-white/[0.02] border border-white/5 rounded-lg p-3 text-sm text-[#dfe2f3] leading-relaxed font-mono resize-none focus:outline-none focus:border-[#c084fc]/30" />
                      <div className="flex items-center gap-2 mt-3">
                        <button onClick={saveNote} disabled={notesSaving} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#c084fc] hover:bg-[#d0a0ff] text-[#0a0e1a] cursor-pointer disabled:opacity-50 flex items-center gap-2">
                          {notesSaving ? <><RefreshCw className="w-4 h-4 animate-spin" /> SAVING…</> : "SAVE"}
                        </button>
                        <span className="text-[10px] font-mono text-[#859397]">{activeNote?.updated_at ? `edited ${new Date(activeNote.updated_at).toLocaleString()}` : "unsaved"}</span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Networking CRM modal ── */}
      <AnimatePresence>
        {networkOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="w-full max-w-4xl glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#ffd6a3]/25 h-[82vh] flex flex-col">
              <div className="p-5 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <div>
                  <h2 className="text-lg font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono flex items-center gap-2">
                    <Users className="w-5 h-5 text-[#ffd6a3]" /> Networking
                  </h2>
                  <p className="text-xs font-mono text-[#859397] mt-1">Recruiters, referrers & contacts · follow-up cadence</p>
                </div>
                <button onClick={() => setNetworkOpen(false)} aria-label="Close" className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#ffd6a3] rounded-full border border-white/5 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              {nudges.length > 0 && (
                <div className="px-5 py-2.5 border-b border-[#a3e635]/15 bg-[#a3e635]/5 max-h-32 overflow-y-auto">
                  <div className="flex items-center gap-1.5 mb-1.5"><Sparkles className="w-3.5 h-3.5 text-[#a3e635]" /><span className="text-[10px] font-mono uppercase tracking-widest text-[#a3e635]">{nudges.length} networking nudge{nudges.length > 1 ? "s" : ""} · your contacts just posted</span></div>
                  <div className="space-y-1">
                    {nudges.slice(0, 6).map((n) => (
                      <div key={n.post_id} className="flex items-center gap-2 text-[11px] font-mono group">
                        <span className="text-[#ffd6a3] shrink-0">{n.contact_name}:</span>
                        <a href={n.url || "#"} target="_blank" rel="noreferrer" className="text-[#dfe2f3] hover:text-[#a3e635] truncate flex-1" title={n.relevance_note || n.title}>{n.title}</a>
                        <button onClick={() => dismissNudge(n.post_id)} title="Dismiss" className="text-[#859397] hover:text-[#ffb4ab] opacity-0 group-hover:opacity-100 shrink-0 cursor-pointer"><X className="w-3 h-3" /></button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex-1 flex min-h-0">
                {/* list */}
                <div className="w-72 shrink-0 border-r border-white/5 flex flex-col">
                  <button onClick={newContact} className="m-3 px-3 py-2 rounded-lg text-[11px] font-bold font-mono bg-[#ffd6a3]/10 border border-[#ffd6a3]/30 text-[#ffd6a3] hover:bg-[#ffd6a3]/20 cursor-pointer flex items-center justify-center gap-1"><Plus className="w-3.5 h-3.5" /> ADD CONTACT</button>
                  <div className="overflow-y-auto px-3 pb-3 space-y-1">
                    {contactsLoading ? <div className="text-center text-[#859397] font-mono text-xs py-6">Loading…</div> :
                      contacts.length === 0 ? <div className="text-center text-[#859397] font-mono text-xs py-6">No contacts yet.</div> :
                        contacts.map((c) => (
                          <div key={c.id} onClick={() => editContact(c)}
                            className={`group rounded-lg px-3 py-2 cursor-pointer border ${activeContact?.id === c.id ? "bg-[#ffd6a3]/10 border-[#ffd6a3]/30" : "border-transparent hover:bg-white/5"}`}>
                            <div className="flex items-center gap-1.5">
                              {c.due && <span className="w-2 h-2 rounded-full bg-[#ffd6a3] shrink-0" title="Follow-up due" />}
                              <span className="text-sm text-[#dfe2f3] truncate flex-1">{c.name}</span>
                            </div>
                            <div className="text-[10px] font-mono text-[#859397] truncate">{c.role}{c.company ? ` · ${c.company}` : ""}</div>
                            <div className="text-[9px] font-mono mt-0.5 flex items-center gap-2">
                              <span className="text-[#ffd6a3]/80 uppercase">{(c.relationship || "").replace("_", " ")}</span>
                              <span className={c.due ? "text-[#ffd6a3]" : "text-[#859397]"}>{c.days_since_contact === null ? "never contacted" : `${c.days_since_contact}d ago`}</span>
                            </div>
                          </div>
                        ))}
                  </div>
                </div>
                {/* editor */}
                <div className="flex-1 flex flex-col min-w-0 p-4 overflow-y-auto">
                  {!activeContact ? (
                    <div className="flex-1 flex items-center justify-center text-[#859397] font-mono text-sm">Select a contact or add one.</div>
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3">
                        {[["name", "Name"], ["role", "Role"], ["company", "Company"], ["email", "Email"]].map(([k, label]) => (
                          <div key={k}>
                            <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">{label}</label>
                            <input value={(contactDraft as any)[k]} onChange={(e) => setContactDraft({ ...contactDraft, [k]: e.target.value })}
                              className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] focus:outline-none focus:border-[#ffd6a3]/40" />
                          </div>
                        ))}
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">LinkedIn / URL</label>
                        <input value={contactDraft.linkedin} onChange={(e) => setContactDraft({ ...contactDraft, linkedin: e.target.value })}
                          className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] focus:outline-none focus:border-[#ffd6a3]/40" />
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">Relationship</label>
                          <select value={contactDraft.relationship} onChange={(e) => setContactDraft({ ...contactDraft, relationship: e.target.value })}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#bbc9cd] focus:outline-none focus:border-[#ffd6a3]/40">
                            {contactRels.map((r) => <option key={r} value={r} className="bg-[#0a0e1a]">{r.replace("_", " ")}</option>)}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">Follow-up every (days)</label>
                          <input type="number" value={contactDraft.follow_up_days} onChange={(e) => setContactDraft({ ...contactDraft, follow_up_days: Number(e.target.value) })}
                            className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] focus:outline-none focus:border-[#ffd6a3]/40" />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-mono uppercase tracking-widest text-[#859397]">Notes</label>
                        <textarea value={contactDraft.notes} onChange={(e) => setContactDraft({ ...contactDraft, notes: e.target.value })} rows={3}
                          className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] resize-none focus:outline-none focus:border-[#ffd6a3]/40" />
                      </div>

                      {/* People Watch — watch this contact's free feeds (RSS/YouTube; no LinkedIn) */}
                      {activeContact?.id && (
                        <div className="pt-1 border-t border-white/5">
                          <label className="text-[10px] font-mono uppercase tracking-widest text-[#a3e635] flex items-center gap-1"><Radio className="w-3 h-3" /> Watch feeds</label>
                          <p className="text-[9px] font-mono text-[#859397] mt-0.5 mb-2">Get a nudge when they post. RSS / blog / Substack / YouTube only — no LinkedIn.</p>
                          {contactFeeds.length > 0 && (
                            <div className="space-y-1 mb-2">
                              {contactFeeds.map((f) => (
                                <div key={f.id} className="flex items-center gap-2 text-[11px] font-mono bg-white/5 rounded px-2 py-1">
                                  <span className="text-[#8aebff] uppercase text-[9px] shrink-0">{f.platform}</span>
                                  <span className="text-[#bbc9cd] truncate flex-1">{f.name || f.handle}</span>
                                  <button onClick={() => deleteContactFeed(f.id)} className="text-[#859397] hover:text-[#ffb4ab] cursor-pointer shrink-0"><Trash2 className="w-3 h-3" /></button>
                                </div>
                              ))}
                            </div>
                          )}
                          <div className="flex items-center gap-1.5">
                            <select value={feedForm.platform} onChange={(e) => setFeedForm({ ...feedForm, platform: e.target.value })} className="bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-[#bbc9cd] focus:outline-none focus:border-[#a3e635]/40 cursor-pointer">
                              <option value="rss" className="bg-[#0a0e1a]">RSS</option>
                              <option value="youtube" className="bg-[#0a0e1a]">YouTube</option>
                            </select>
                            <input value={feedForm.handle} onChange={(e) => setFeedForm({ ...feedForm, handle: e.target.value })} placeholder={feedForm.platform === "youtube" ? "@handle or channel ID" : "feed URL"}
                              className="flex-1 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-[11px] font-mono text-[#dfe2f3] placeholder:text-[#859397]/50 focus:outline-none focus:border-[#a3e635]/40" />
                            <button onClick={addContactFeed} disabled={feedBusy} className="px-2.5 py-1.5 rounded text-[11px] font-bold font-mono bg-[#a3e635]/10 border border-[#a3e635]/30 text-[#a3e635] hover:bg-[#a3e635]/20 cursor-pointer disabled:opacity-50 shrink-0">{feedBusy ? "…" : "WATCH"}</button>
                          </div>
                          {feedErr && <p className="text-[10px] font-mono text-[#ffb4ab] mt-1">{feedErr}</p>}
                        </div>
                      )}

                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={saveContact} disabled={contactSaving} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#ffd6a3] hover:bg-[#ffe0b8] text-[#0a0e1a] cursor-pointer disabled:opacity-50">{contactSaving ? "SAVING…" : "SAVE"}</button>
                        {activeContact?.id && <button onClick={() => markContacted(activeContact)} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#5eead4]/10 border border-[#5eead4]/30 text-[#5eead4] hover:bg-[#5eead4]/20 cursor-pointer">Mark contacted today</button>}
                        {activeContact?.id && <button onClick={() => deleteContact(activeContact)} className="ml-auto px-3 py-2 rounded-lg text-sm text-[#859397] hover:text-[#ffb4ab] cursor-pointer">Delete</button>}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Voice daily standup modal ── */}
      <AnimatePresence>
        {standupOpen && (
          <div className="fixed inset-0 bg-[#0a0e1a]/80 backdrop-blur-md z-50 flex items-center justify-center p-4">
            <motion.div initial={{ y: 30, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 30, opacity: 0 }}
              className="w-full max-w-lg glass-panel rounded-2xl overflow-hidden shadow-2xl border border-[#8aebff]/25 flex flex-col">
              <div className="p-5 border-b border-[#3c494c]/50 bg-[#161e2e]/80 flex justify-between items-center">
                <h2 className="text-lg font-extrabold text-[#dfe2f3] tracking-wide uppercase font-mono flex items-center gap-2">
                  <Megaphone className="w-5 h-5 text-[#8aebff]" /> Daily Standup
                </h2>
                <button onClick={closeStandup} aria-label="Close" className="p-2 hover:bg-white/5 text-[#bbc9cd] hover:text-[#8aebff] rounded-full border border-white/5 cursor-pointer"><X className="w-5 h-5" /></button>
              </div>
              <div className="p-6">
                {standupLoading ? (
                  <div className="text-center text-[#859397] font-mono text-sm py-8 flex items-center justify-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Assembling your briefing…</div>
                ) : (
                  <>
                    <p className="text-[15px] text-[#dfe2f3] leading-relaxed whitespace-pre-wrap">{standupText}</p>
                    <div className="flex items-center gap-2 mt-5 flex-wrap">
                      {speaking ? (
                        <button onClick={stopPlayback} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#ffb4ab]/10 border border-[#ffb4ab]/30 text-[#ffb4ab] hover:bg-[#ffb4ab]/20 cursor-pointer flex items-center gap-2"><Square className="w-4 h-4" /> Stop</button>
                      ) : (
                        <button onClick={() => playStandup(standupText)} disabled={!standupText} className="px-4 py-2 rounded-lg text-sm font-bold bg-[#8aebff]/10 border border-[#8aebff]/30 text-[#8aebff] hover:bg-[#8aebff]/20 cursor-pointer disabled:opacity-40 flex items-center gap-2"><Volume2 className="w-4 h-4" /> Play again</button>
                      )}
                      <button onClick={openStandup} className="px-4 py-2 rounded-lg text-sm font-bold bg-white/5 border border-white/10 text-[#bbc9cd] hover:bg-white/10 cursor-pointer flex items-center gap-2"><RefreshCw className="w-4 h-4" /> Refresh</button>
                      {ttsAvailable && (
                        <button onClick={toggleNaturalVoice} title="Use Gemini's natural voice (free tier) instead of the browser voice"
                          className={`ml-auto px-3 py-2 rounded-lg text-[11px] font-mono border cursor-pointer transition-all ${naturalVoice ? "bg-[#c084fc]/15 border-[#c084fc]/40 text-[#c084fc]" : "bg-white/5 border-white/10 text-[#859397] hover:text-[#c084fc]"}`}>
                          {naturalVoice ? "✓ Natural voice" : "Natural voice"}
                        </button>
                      )}
                    </div>
                    {naturalVoice && ttsAvailable && (
                      <div className="mt-3 rounded-lg border border-[#c084fc]/20 bg-[#c084fc]/[0.04] p-3">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-mono uppercase tracking-widest text-[#859397] shrink-0">Voice</span>
                          <select value={voice} onChange={(e) => chooseVoice(e.target.value)}
                            className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded px-2 py-1.5 text-xs text-[#dfe2f3] font-mono cursor-pointer focus:outline-none focus:border-[#c084fc]/40">
                            {voices.map((v) => (
                              <option key={v.name} value={v.name} className="bg-[#0a0e1a]">{v.name} — {v.style}</option>
                            ))}
                          </select>
                          <button onClick={() => previewVoice(voice)} disabled={previewing}
                            className="shrink-0 px-3 py-1.5 rounded text-[11px] font-bold font-mono bg-[#c084fc]/10 border border-[#c084fc]/30 text-[#c084fc] hover:bg-[#c084fc]/20 cursor-pointer disabled:opacity-50 flex items-center gap-1">
                            <Volume2 className="w-3.5 h-3.5" /> {previewing ? "…" : "Preview"}
                          </button>
                        </div>
                        <p className="text-[10px] font-mono text-[#859397] mt-2">{voices.length} Gemini voices · falls back to the browser voice if the free quota is unavailable.</p>
                      </div>
                    )}
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
