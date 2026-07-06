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
  ats_score?: number | null;
  ats_scored_at?: string | null;
  applied_at?: string | null;
  updated_at?: string | null;
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

  const [activeTab, setActiveTab] = useState<"keyword" | "star" | "error">("keyword");
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
  const auditResumeFileRef = useRef<HTMLInputElement>(null);
  const [activeAtsAppId, setActiveAtsAppId] = useState<number | null>(null);
  const [auditApplying, setAuditApplying] = useState(false);
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
    loadFollowCount();
  }, [loadApplications, loadPending, loadReviewCount, loadFollowCount]);

  // Deep-link: when arriving from the Home cockpit with an intent, open the matching tool.
  useEffect(() => {
    if (!intent) return;
    const map: Record<string, () => void> = {
      review: openReview, followups: openFollowups, interviews: openPrep,
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

  const openNetwork = async () => {
    setNetworkOpen(true);
    setActiveContact(null);
    setContactsLoading(true);
    try { await loadContacts(); } catch { setContacts([]); } finally { setContactsLoading(false); }
  };

  const editContact = (c: any) => {
    setActiveContact(c);
    setContactDraft({ name: c.name || "", role: c.role || "", company: c.company || "", email: c.email || "", linkedin: c.linkedin || "", relationship: c.relationship || "recruiter", follow_up_days: c.follow_up_days || 14, notes: c.notes || "" });
  };
  const newContact = () => { setActiveContact({ id: null }); setContactDraft({ ...emptyContact }); };

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

  const openReview = async () => {
    setReviewOpen(true);
    setReviewLoading(true);
    setReviewMsg("");
    try {
      const res = await fetch("/api/job-scout/review-queue");
      const data = await res.json();
      const q = Array.isArray(data?.queue) ? data.queue : [];
      setReviewQueue(q);
      setStatuses(Array.isArray(data?.statuses) ? data.statuses : statuses);
      // Default every card's stage selector to "applied".
      const stageMap: Record<number, string> = {};
      q.forEach((c: any) => (stageMap[c.id] = "applied"));
      setReviewStage(stageMap);
    } catch {
      setReviewQueue([]);
    } finally {
      setReviewLoading(false);
    }
  };

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

  const decideReview = async (item: any, action: "apply" | "skip") => {
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
      // Drop the decided card from the queue.
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
            {reviewCount > 0 && (
              <button
                onClick={openReview}
                className="flex items-center gap-2 px-5 py-2 bg-[#c084fc]/10 border border-[#c084fc]/40 rounded-lg text-xs font-semibold hover:bg-[#c084fc]/20 transition-all text-[#c084fc] cursor-pointer animate-pulse"
                title="Review fresh Job Scout matches — ATS score, apply or skip, move to a stage"
              >
                <Sparkles className="w-4 h-4" />
                REVIEW ({reviewCount})
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
                    {/* Ordered by the job-search lifecycle: Prepare → Track → Follow-up → Interview */}
                    {([
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

                          {/* Status selector + tags + inline next-step cues */}
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
                            {/* Guided cue: stale in "applied" → nudge a follow-up */}
                            {card.status === "applied" && (daysSince(card.applied_at || card.updated_at) ?? 0) >= 7 && (
                              <button
                                onClick={openFollowups}
                                title={`No reply in ${daysSince(card.applied_at || card.updated_at)} days — draft a follow-up`}
                                className="text-[10px] font-bold font-mono text-[#ffd6a3] px-2.5 py-0.5 bg-[#ffd6a3]/10 rounded border border-[#ffd6a3]/30 hover:bg-[#ffd6a3]/20 transition-all cursor-pointer flex items-center gap-1"
                              >
                                <Clock className="w-3 h-3" /> Follow up →
                              </button>
                            )}
                            {/* Guided cue: interviewing → jump to prep */}
                            {card.status === "interviewing" && (
                              <button
                                onClick={openPrep}
                                title="Build your interview prep brief"
                                className="text-[10px] font-bold font-mono text-[#5eead4] px-2.5 py-0.5 bg-[#5eead4]/10 rounded border border-[#5eead4]/30 hover:bg-[#5eead4]/20 transition-all cursor-pointer flex items-center gap-1"
                              >
                                <CalendarClock className="w-3 h-3" /> Prep →
                              </button>
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

                            <button
                              onClick={() => openEmails(card)}
                              title={`Recent email with ${card.company || "this company"}`}
                              className="px-2.5 py-1 rounded text-[10px] font-bold font-mono text-[#a3e635] border border-[#a3e635]/30 hover:bg-[#a3e635]/10 transition-all cursor-pointer flex items-center gap-1"
                            >
                              <Mail className="w-3 h-3" /> EMAILS
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
                  </div>

                  <button
                    onClick={runAudit}
                    disabled={auditRunning || resumeUploading}
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
                        <textarea value={contactDraft.notes} onChange={(e) => setContactDraft({ ...contactDraft, notes: e.target.value })} rows={4}
                          className="w-full mt-1 bg-white/5 border border-white/10 rounded px-3 py-2 text-sm text-[#dfe2f3] resize-none focus:outline-none focus:border-[#ffd6a3]/40" />
                      </div>
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
