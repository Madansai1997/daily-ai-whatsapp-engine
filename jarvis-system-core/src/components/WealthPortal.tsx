import React, { useState, useEffect } from "react";
import {
  Briefcase,
  Search,
  Upload,
  CheckCircle2,
  Lock,
  Layers,
  FileText,
  Building2,
  MapPin,
  IndianRupee,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  TrendingUp,
  Download,
  X,
  RefreshCw,
  Trash2,
  ChevronRight,
  ExternalLink
} from "lucide-react";

interface ApplicationCard {
  id: number;
  title: string;
  company: string;
  location: string;
  salary: string;
  description: string;
  status: "interested" | "applied" | "interviewing" | "offer" | "accepted" | "rejected";
  job_key: string;
  url?: string;
  created_at: string;
  applied_at?: string;
}

export default function WealthPortal() {
  const [passcode, setPasscode] = useState("");
  const [isAuthed, setIsAuthed] = useState(false);
  const [authError, setAuthError] = useState("");

  const [cards, setCards] = useState<ApplicationCard[]>([]);
  const [loadingCards, setLoadingCards] = useState(false);

  const [scoutRole, setScoutRole] = useState("Wealth Manager");
  const [scoutLocation, setScoutLocation] = useState("India");
  const [isScouting, setIsScouting] = useState(false);

  const [hasResume, setHasResume] = useState(false);
  const [resumeFilename, setResumeFilename] = useState("");
  const [isUploading, setIsUploading] = useState(false);

  const [selectedCard, setSelectedCard] = useState<ApplicationCard | null>(null);
  const [atsAnalysis, setAtsAnalysis] = useState<any | null>(null);
  const [isAtsLoading, setIsAtsLoading] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");

  // Add Job Modal State
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newCompany, setNewCompany] = useState("");
  const [newLocation, setNewLocation] = useState("India");
  const [newSalary, setNewSalary] = useState("Competitive");
  const [newDescription, setNewDescription] = useState("");
  const [newUrl, setNewUrl] = useState("");

  // Slide-over Drawer State
  const [inspectCard, setInspectCard] = useState<ApplicationCard | null>(null);

  // Outreach & Interview Prep Kit State
  const [prepKitCard, setPrepKitCard] = useState<ApplicationCard | null>(null);
  const [prepData, setPrepData] = useState<any | null>(null);
  const [isPrepLoading, setIsPrepLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("wealth_client_authed");
    if (saved === "true") {
      setIsAuthed(true);
      loadPortalData();
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError("");
    try {
      const res = await fetch("/api/wealth/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passcode }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsAuthed(true);
        localStorage.setItem("wealth_client_authed", "true");
        loadPortalData();
      } else {
        setAuthError("Invalid Passcode. Please check and try again.");
      }
    } catch {
      setAuthError("Connection error. Please try again.");
    }
  };

  const loadPortalData = async () => {
    setLoadingCards(true);
    try {
      const res = await fetch("/api/wealth/applications");
      const data = await res.json();
      if (data.ok) {
        setCards(data.applications || []);
      }
      checkResumeStatus();
    } catch {
      /* fallback */
    } finally {
      setLoadingCards(false);
    }
  };

  const checkResumeStatus = async () => {
    try {
      const res = await fetch("/api/wealth/resume/status");
      const data = await res.json();
      if (data.ok && data.has_resume) {
        setHasResume(true);
        setResumeFilename(data.filename);
      }
    } catch {
      /* fallback */
    }
  };

  const handleResumeUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".docx")) {
      alert("Please upload a .docx resume file to ensure format preservation.");
      return;
    }
    setIsUploading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await fetch("/api/wealth/resume/upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.ok) {
        setHasResume(true);
        setResumeFilename(data.filename);
        alert("✅ Client Master .docx resume uploaded successfully!");
      } else {
        alert(`Upload error: ${data.error}`);
      }
    } catch {
      alert("Upload failed.");
    } finally {
      setIsUploading(false);
    }
  };

  const handleRunScout = async () => {
    setIsScouting(true);
    try {
      const res = await fetch("/api/wealth/scout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: scoutRole, location: scoutLocation }),
      });
      const data = await res.json();
      if (data.ok && data.jobs) {
        // Auto-add scouted jobs into 'interested' column
        for (const j of data.jobs.slice(0, 4)) {
          await fetch("/api/wealth/applications", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: j.title,
              company: j.company,
              location: j.location,
              salary: j.salary,
              description: j.description,
              url: j.url,
              status: "interested",
              job_key: j.job_key
            }),
          });
        }
        await loadPortalData();
      }
    } catch {
      /* fallback */
    } finally {
      setIsScouting(false);
    }
  };

  const handleUpdateStatus = async (appId: number, newStatus: string) => {
    try {
      await fetch(`/api/wealth/applications/${appId}/status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: newStatus }),
      });
      await loadPortalData();
    } catch {
      /* fallback */
    }
  };

  const handleDeleteCard = async (appId: number) => {
    if (!confirm("Are you sure you want to remove this card?")) return;
    try {
      await fetch(`/api/wealth/applications/${appId}`, { method: "DELETE" });
      await loadPortalData();
    } catch {
      /* fallback */
    }
  };

  const handleRunAts = async (card: ApplicationCard) => {
    setSelectedCard(card);
    setIsAtsLoading(true);
    setAtsAnalysis(null);
    try {
      const res = await fetch(`/api/wealth/applications/${card.id}/ats`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setAtsAnalysis(data.analysis);
      } else {
        alert(data.error || "ATS Alignment error");
      }
    } catch {
      alert("ATS Alignment failed.");
    } finally {
      setIsAtsLoading(false);
    }
  };

  const handleAutoApply = async (card: ApplicationCard) => {
    setIsApplying(true);
    try {
      const res = await fetch(`/api/wealth/applications/${card.id}/auto-apply`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        alert(`🚀 ${data.message}`);
        await loadPortalData();
        if (data.download_url) {
          window.open(data.download_url, "_blank");
        }
      } else {
        alert(data.error || "Auto-Apply failed");
      }
    } catch {
      alert("Auto-Apply failed.");
    } finally {
      setIsApplying(false);
    }
  };

  const handleAddJobSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle || !newCompany) {
      alert("Please fill in Title and Company");
      return;
    }
    try {
      const res = await fetch("/api/wealth/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle,
          company: newCompany,
          location: newLocation,
          salary: newSalary,
          description: newDescription,
          url: newUrl,
          status: "interested"
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setIsAddModalOpen(false);
        setNewTitle("");
        setNewCompany("");
        setNewDescription("");
        setNewUrl("");
        await loadPortalData();
      } else {
        alert(data.error || "Failed to add job card");
      }
    } catch {
      alert("Error adding job card");
    }
  };

  const handleGeneratePrepKit = async (card: ApplicationCard) => {
    setPrepKitCard(card);
    setIsPrepLoading(true);
    setPrepData(null);
    try {
      const res = await fetch(`/api/wealth/applications/${card.id}/prep`, { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setPrepData(data.prep);
      } else {
        alert(data.error || "Failed to generate prep kit");
      }
    } catch {
      alert("Error generating prep kit");
    } finally {
      setIsPrepLoading(false);
    }
  };

  const handleSaveJd = async () => {
    if (!inspectCard) return;
    try {
      const res = await fetch(`/api/wealth/applications/${inspectCard.id}/jd`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: inspectCard.description }),
      });
      const data = await res.json();
      if (data.ok) {
        alert("✅ Job description updated! Re-running ATS Alignment...");
        await loadPortalData();
        handleRunAts(inspectCard);
      } else {
        alert(data.error || "Error updating JD");
      }
    } catch {
      alert("Error saving JD");
    }
  };

  // PASSCODE LOCK SCREEN
  if (!isAuthed) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex items-center justify-center p-4">
        <div className="max-w-md w-full p-8 bg-zinc-900 border border-amber-500/30 rounded-2xl shadow-2xl space-y-6 text-center">
          <div className="w-16 h-16 bg-amber-500/10 border border-amber-500/30 rounded-2xl flex items-center justify-center mx-auto text-amber-400">
            <Building2 className="w-8 h-8" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-zinc-100 font-mono tracking-tight">Private Banking & Wealth Suite</h1>
            <p className="text-xs text-amber-400 font-semibold mt-1 uppercase tracking-wider">Client Management Portal</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4 text-left">
            <div>
              <label className="text-xs font-medium text-zinc-400 block mb-1.5">Enter Client Passcode:</label>
              <div className="relative">
                <input
                  type="password"
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  placeholder="••••••••••••"
                  className="w-full px-4 py-3 bg-zinc-950 border border-zinc-800 rounded-xl text-sm text-zinc-100 focus:outline-none focus:border-amber-500"
                />
                <Lock className="w-4 h-4 text-zinc-500 absolute right-3.5 top-3.5" />
              </div>
            </div>

            {authError && <p className="text-xs text-rose-400">{authError}</p>}

            <button
              type="submit"
              className="w-full py-3 bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-zinc-950 font-bold rounded-xl text-sm transition-all shadow-lg shadow-amber-500/20"
            >
              Unlock Wealth Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  const columns = [
    { key: "interested", title: "🎯 Interested", border: "border-amber-500/30" },
    { key: "applied", title: "⚡ Applied", border: "border-cyan-500/30" },
    { key: "interviewing", title: "🤝 Interviewing", border: "border-purple-500/30" },
    { key: "offer", title: "🏆 Offer", border: "border-emerald-500/30" },
    { key: "accepted", title: "✅ Accepted", border: "border-blue-500/30" },
  ];

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col font-sans">
      {/* HEADER */}
      <header className="p-4 bg-zinc-900/90 border-b border-amber-500/20 backdrop-blur-md flex flex-wrap items-center justify-between gap-4 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl text-amber-400">
            <Building2 className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-zinc-100 font-mono flex items-center gap-2">
              Wealth Management Opportunities <span className="text-xs font-semibold px-2 py-0.5 bg-amber-500/20 text-amber-400 rounded-full border border-amber-500/30">Client Portal</span>
            </h1>
            <p className="text-xs text-zinc-400">India Private Banking, HNW/UHNW Relationship Management & Asset Management Opportunities</p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* MANUAL ADD JOB */}
          <button
            onClick={() => setIsAddModalOpen(true)}
            className="px-3 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl transition-all shadow-md shadow-amber-500/10 flex items-center gap-1.5"
          >
            <Sparkles className="w-3.5 h-3.5" /> + Add Job
          </button>

          {/* RESUME STATUS / UPLOAD */}
          <div className="flex items-center gap-2 bg-zinc-950 border border-zinc-800 px-3 py-1.5 rounded-xl">
            <FileText className="w-4 h-4 text-amber-400" />
            <span className="text-xs text-zinc-300 font-mono">
              {hasResume ? resumeFilename : "No Resume Uploaded"}
            </span>
            <label className="cursor-pointer px-2.5 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs rounded-lg font-semibold transition-all">
              {isUploading ? "Uploading..." : "Upload .docx"}
              <input type="file" accept=".docx" onChange={handleResumeUpload} className="hidden" />
            </label>
          </div>

          <button
            onClick={() => {
              localStorage.removeItem("wealth_client_authed");
              setIsAuthed(false);
            }}
            className="px-3 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-zinc-700 text-xs text-zinc-400 rounded-xl"
          >
            Lock Portal
          </button>
        </div>
      </header>

      {/* SCOUT & FILTER BAR */}
      <div className="p-4 bg-zinc-900/40 border-b border-zinc-800/80 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs font-semibold text-amber-400 flex items-center gap-1.5 font-mono">
            <Search className="w-4 h-4" /> Live Wealth Scout:
          </span>
          <input
            type="text"
            value={scoutRole}
            onChange={(e) => setScoutRole(e.target.value)}
            placeholder="Role (e.g. Wealth Manager)"
            className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
          />
          <input
            type="text"
            value={scoutLocation}
            onChange={(e) => setScoutLocation(e.target.value)}
            placeholder="City / Region (e.g. Mumbai, Gurgaon, Dubai)"
            className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
          />
          <button
            onClick={handleRunScout}
            disabled={isScouting}
            className="px-4 py-1.5 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-lg transition-all flex items-center gap-1.5 shadow-md shadow-amber-500/10"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isScouting ? "Scouting..." : "Find Opportunities"}
          </button>
        </div>

        <div className="flex items-center gap-3">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search cards on board..."
            className="px-3 py-1.5 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 focus:outline-none focus:border-amber-500 w-48"
          />
          <div className="text-xs text-zinc-400 font-mono">
            Total: <span className="text-amber-400 font-bold">{cards.length}</span>
          </div>
        </div>
      </div>

      {/* KANBAN BOARD */}
      <div className="flex-1 p-6 overflow-x-auto">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 min-w-[1200px]">
          {columns.map((col) => {
            const colCards = cards.filter((c) => {
              if (c.status !== col.key) return false;
              if (!searchQuery.trim()) return true;
              const q = searchQuery.toLowerCase();
              return c.title.toLowerCase().includes(q) || c.company.toLowerCase().includes(q) || (c.location || "").toLowerCase().includes(q);
            });
            return (
              <div key={col.key} className={`bg-zinc-900/60 border ${col.border} rounded-2xl p-3 flex flex-col gap-3 min-h-[550px]`}>
                <div className="flex items-center justify-between px-2 py-1">
                  <h3 className="text-xs font-bold text-zinc-200 font-mono">{col.title}</h3>
                  <span className="text-xs px-2 py-0.5 bg-zinc-950 border border-zinc-800 text-zinc-400 rounded-full font-mono">
                    {colCards.length}
                  </span>
                </div>

                <div className="flex-1 space-y-3 overflow-y-auto pr-1">
                  {colCards.map((card) => (
                    <div key={card.id} className="p-3.5 bg-zinc-950 border border-zinc-800/90 rounded-xl space-y-2 hover:border-amber-500/40 transition-all shadow-md">
                      <div className="cursor-pointer" onClick={() => setInspectCard(card)}>
                        <h4 className="text-xs font-bold text-zinc-100 hover:text-amber-400 transition-colors flex items-center justify-between">
                          {card.title} <ChevronRight className="w-3.5 h-3.5 text-zinc-500" />
                        </h4>
                        <p className="text-xs font-medium text-amber-400 flex items-center gap-1 mt-0.5">
                          <Building2 className="w-3 h-3" /> {card.company}
                        </p>
                      </div>

                      <div className="flex items-center gap-3 text-[11px] text-zinc-400 font-mono">
                        <span className="flex items-center gap-1"><MapPin className="w-3 h-3 text-zinc-500" /> {card.location}</span>
                      </div>

                      {card.salary && (
                        <p className="text-[11px] text-emerald-400 font-mono font-semibold">{card.salary}</p>
                      )}

                      <p className="text-[11px] text-zinc-400 line-clamp-2 leading-relaxed">{card.description}</p>

                      {card.url && (
                        <div className="pt-1">
                          <a
                            href={card.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-cyan-400 hover:text-cyan-300 hover:underline"
                          >
                            <ExternalLink className="w-3 h-3" /> View Job Posting ↗
                          </a>
                        </div>
                      )}

                      {/* CARD ACTIONS */}
                      <div className="pt-2 border-t border-zinc-900 flex flex-wrap items-center justify-between gap-1.5">
                        <select
                          value={card.status}
                          onChange={(e) => handleUpdateStatus(card.id, e.target.value)}
                          className="px-2 py-1 bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-300 rounded focus:outline-none"
                        >
                          <option value="interested">Interested</option>
                          <option value="applied">Applied</option>
                          <option value="interviewing">Interviewing</option>
                          <option value="offer">Offer</option>
                          <option value="accepted">Accepted</option>
                        </select>

                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleGeneratePrepKit(card)}
                            className="px-2 py-1 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 text-[10px] rounded font-semibold transition-all"
                            title="Generate Outreach & STAR Interview Kit"
                          >
                            📋 Prep
                          </button>

                          <button
                            onClick={() => handleRunAts(card)}
                            className="px-2 py-1 bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-[10px] rounded font-semibold transition-all"
                            title="ATS Alignment Analysis"
                          >
                            🎯 ATS
                          </button>

                          <button
                            onClick={() => handleAutoApply(card)}
                            disabled={isApplying}
                            className="px-2 py-1 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-[10px] rounded font-semibold transition-all"
                            title="1-Tap Format Preserved .docx Tailoring"
                          >
                            ⚡ Tailor
                          </button>

                          <button
                            onClick={() => handleDeleteCard(card.id)}
                            className="p-1 text-zinc-500 hover:text-rose-400 rounded"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}

                  {colCards.length === 0 && (
                    <div className="h-32 flex items-center justify-center text-xs text-zinc-600 border border-dashed border-zinc-800/80 rounded-xl">
                      No cards
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ATS ALIGNMENT MODAL */}
      {selectedCard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-2xl w-full max-h-[85vh] bg-zinc-900 border border-amber-500/30 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
              <div>
                <h3 className="text-sm font-bold text-zinc-100">🎯 Wealth ATS Alignment Analysis</h3>
                <p className="text-xs text-amber-400">{selectedCard.title} @ {selectedCard.company}</p>
              </div>
              <button onClick={() => setSelectedCard(null)} className="p-1 text-zinc-400 hover:text-zinc-100 rounded-lg">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {isAtsLoading ? (
                <div className="py-12 text-center text-xs text-amber-400 animate-pulse">
                  Analyzing Wealth Management keyword match & STAR/XYZ bullet optimization...
                </div>
              ) : atsAnalysis ? (
                <div className="space-y-4">
                  {/* ATS SCORE */}
                  <div className="p-4 bg-zinc-950 border border-amber-500/30 rounded-xl flex items-center justify-between">
                    <div>
                      <span className="text-xs text-zinc-400 font-mono uppercase block">ATS Match Score</span>
                      <span className="text-2xl font-extrabold text-amber-400 font-mono">{atsAnalysis.ats_score}%</span>
                    </div>
                    <button
                      onClick={() => handleAutoApply(selectedCard)}
                      className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20"
                    >
                      Export Tailored .docx Resume
                    </button>
                  </div>

                  {/* KEYWORD MATRIX */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="p-3 bg-zinc-950 border border-emerald-500/30 rounded-xl space-y-1">
                      <h4 className="text-xs font-bold text-emerald-400 uppercase">Matched Keywords</h4>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {atsAnalysis.keyword_matrix?.present?.map((k: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 bg-emerald-500/10 text-emerald-300 rounded border border-emerald-500/30">{k}</span>
                        ))}
                      </div>
                    </div>
                    <div className="p-3 bg-zinc-950 border border-rose-500/30 rounded-xl space-y-1">
                      <h4 className="text-xs font-bold text-rose-400 uppercase">Missing Keywords</h4>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {atsAnalysis.keyword_matrix?.missing?.map((k: string, i: number) => (
                          <span key={i} className="text-[10px] px-2 py-0.5 bg-rose-500/10 text-rose-300 rounded border border-rose-500/30">{k}</span>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* STAR / XYZ BULLET REWRITES */}
                  <div className="space-y-2">
                    <h4 className="text-xs font-bold text-zinc-200 font-mono">STAR / XYZ Quantified Bullet Optimization</h4>
                    {atsAnalysis.star_xyz_breakdown?.map((b: any, idx: number) => (
                      <div key={idx} className="p-3 bg-zinc-950 border border-zinc-800 rounded-xl space-y-1.5 text-xs">
                        <p className="text-zinc-400 line-through">"{b.current_text}"</p>
                        <p className="text-amber-300 font-semibold">➔ "{b.optimized_text}"</p>
                        <p className="text-[11px] text-zinc-500 italic">{b.improvement_reason}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* MANUAL ADD JOB MODAL */}
      {isAddModalOpen && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-lg w-full bg-zinc-900 border border-amber-500/30 rounded-2xl p-6 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" /> Add New Wealth Job Card
              </h3>
              <button onClick={() => setIsAddModalOpen(false)} className="p-1 text-zinc-400 hover:text-zinc-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleAddJobSubmit} className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 block mb-1">Job Title *</label>
                <input
                  type="text"
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. Senior Wealth Manager"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Company *</label>
                <input
                  type="text"
                  value={newCompany}
                  onChange={(e) => setNewCompany(e.target.value)}
                  placeholder="e.g. Nuvama Wealth / Barclays"
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Location</label>
                  <input
                    type="text"
                    value={newLocation}
                    onChange={(e) => setNewLocation(e.target.value)}
                    placeholder="Mumbai / Dubai"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 block mb-1">Salary Range</label>
                  <input
                    type="text"
                    value={newSalary}
                    onChange={(e) => setNewSalary(e.target.value)}
                    placeholder="₹35,000,000 / yr"
                    className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Direct Job Posting URL</label>
                <input
                  type="url"
                  value={newUrl}
                  onChange={(e) => setNewUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 block mb-1">Job Description / Requirements</label>
                <textarea
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Paste description text here..."
                  rows={4}
                  className="w-full px-3 py-2 bg-zinc-950 border border-zinc-800 rounded-xl text-xs text-zinc-100 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-300 rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-zinc-950 font-bold text-xs rounded-xl shadow-lg shadow-amber-500/20"
                >
                  Save Card to Board
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* SLIDE-OVER INSPECTION DRAWER */}
      {inspectCard && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
          <div className="w-full max-w-xl bg-zinc-950 border-l border-amber-500/30 h-full p-6 flex flex-col space-y-4 shadow-2xl overflow-y-auto">
            <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-zinc-100">{inspectCard.title}</h3>
                <p className="text-xs text-amber-400 font-semibold">{inspectCard.company} — {inspectCard.location}</p>
              </div>
              <button onClick={() => setInspectCard(null)} className="p-1 text-zinc-400 hover:text-zinc-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs text-zinc-400 font-mono block mb-1">Job Description / Requirements:</label>
                <textarea
                  value={inspectCard.description}
                  onChange={(e) => setInspectCard({ ...inspectCard, description: e.target.value })}
                  rows={8}
                  className="w-full p-3 bg-zinc-900 border border-zinc-800 rounded-xl text-xs text-zinc-200 focus:outline-none focus:border-amber-500"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
                <button
                  onClick={handleSaveJd}
                  className="px-3 py-1.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 hover:bg-amber-500/30 text-xs rounded-xl font-semibold"
                >
                  💾 Save JD & Re-run ATS
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => { setInspectCard(null); handleGeneratePrepKit(inspectCard); }}
                    className="px-3 py-1.5 bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 hover:bg-cyan-500/20 text-xs rounded-xl font-semibold"
                  >
                    📋 Outreach & STAR Kit
                  </button>
                  <button
                    onClick={() => { setInspectCard(null); handleRunAts(inspectCard); }}
                    className="px-3 py-1.5 bg-purple-500/10 border border-purple-500/30 text-purple-300 hover:bg-purple-500/20 text-xs rounded-xl font-semibold"
                  >
                    🎯 ATS Alignment
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* OUTREACH & STAR INTERVIEW PREP KIT MODAL */}
      {prepKitCard && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="max-w-3xl w-full max-h-[85vh] bg-zinc-900 border border-cyan-500/30 rounded-2xl flex flex-col shadow-2xl overflow-hidden">
            <div className="p-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-950">
              <div>
                <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                  📋 Outreach & STAR Interview Kit
                </h3>
                <p className="text-xs text-cyan-400">{prepKitCard.title} @ {prepKitCard.company}</p>
              </div>
              <button onClick={() => setPrepKitCard(null)} className="p-1 text-zinc-400 hover:text-zinc-100">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-4">
              {isPrepLoading ? (
                <div className="py-12 text-center text-xs text-cyan-400 animate-pulse">
                  Generating tailored LinkedIn message, cold outreach email & 3 STAR interview prep stories...
                </div>
              ) : prepData ? (
                <div className="space-y-4 text-xs">
                  {/* LINKEDIN NOTE */}
                  <div className="p-4 bg-zinc-950 border border-cyan-500/30 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-cyan-400 uppercase">💼 Personalized LinkedIn Outreach Note (&lt;300 chars)</h4>
                      <button
                        onClick={() => { navigator.clipboard.writeText(prepData.outreach_linkedin); alert("Copied LinkedIn note to clipboard!"); }}
                        className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded text-[10px]"
                      >
                        Copy Note
                      </button>
                    </div>
                    <p className="text-zinc-200 bg-zinc-900 p-2.5 rounded-lg border border-zinc-800 font-mono text-[11px]">{prepData.outreach_linkedin}</p>
                  </div>

                  {/* COLD EMAIL TEMPLATE */}
                  <div className="p-4 bg-zinc-950 border border-purple-500/30 rounded-xl space-y-2">
                    <div className="flex items-center justify-between">
                      <h4 className="font-bold text-purple-400 uppercase">✉️ Cold Outreach Email Template</h4>
                      <button
                        onClick={() => { navigator.clipboard.writeText(prepData.outreach_email); alert("Copied email template to clipboard!"); }}
                        className="px-2 py-0.5 bg-zinc-900 border border-zinc-800 text-zinc-300 rounded text-[10px]"
                      >
                        Copy Email
                      </button>
                    </div>
                    <pre className="text-zinc-200 bg-zinc-900 p-3 rounded-lg border border-zinc-800 font-sans text-xs whitespace-pre-wrap leading-relaxed">{prepData.outreach_email}</pre>
                  </div>

                  {/* 3 STAR INTERVIEW PREP STORIES */}
                  <div className="space-y-3">
                    <h4 className="font-bold text-amber-400 uppercase">🌟 3 STAR Behavioral Interview Stories</h4>
                    {prepData.star_stories?.map((s: any, idx: number) => (
                      <div key={idx} className="p-4 bg-zinc-950 border border-amber-500/30 rounded-xl space-y-1.5">
                        <h5 className="font-bold text-zinc-100">Q{idx + 1}: "{s.question}"</h5>
                        <p className="text-zinc-400"><strong className="text-amber-400">Situation:</strong> {s.situation}</p>
                        <p className="text-zinc-400"><strong className="text-cyan-400">Task:</strong> {s.task}</p>
                        <p className="text-zinc-400"><strong className="text-purple-400">Action:</strong> {s.action}</p>
                        <p className="text-zinc-400"><strong className="text-emerald-400">Result:</strong> {s.result}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
