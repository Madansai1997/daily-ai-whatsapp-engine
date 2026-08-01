import React, { useState, useEffect, useCallback, useMemo } from "react";
import { ScreenId } from "../types";
import { motion, AnimatePresence } from "motion/react";
import {
  Sparkles, RefreshCw, FileText, Download, X, CheckCircle2, AlertCircle,
  Trash2, SlidersHorizontal, Eye, Target, Plus, Mail, Send, Clock,
  CalendarClock, Users, Globe, ExternalLink, ShieldCheck, Play, ArrowRight,
  UserCheck, AlertTriangle, Layers, Award
} from "lucide-react";
import { getToken } from "../lib/auth";

interface JobsBoardProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId, intent?: string) => void;
  intent?: string | null;
  onIntentHandled?: () => void;
}

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
  notes?: string;
  applied_at?: string | null;
  updated_at?: string | null;
}

interface DrawerData {
  application: Application;
  ats_analysis: any;
  stale_info: {
    days_inactive: number;
    requires_action: boolean;
    followup_needed: boolean;
    stale_score: number;
  };
  referrals: any[];
  outreach_notes: string;
}

export default function JobsBoard({ onNavigate }: JobsBoardProps) {
  const [applications, setApplications] = useState<Application[]>([]);
  const [scoutedJobs, setScoutedJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);

  // Quick Filters State
  const [filterActiveOnly, setFilterActiveOnly] = useState<boolean>(false);
  const [filterRequiresAction, setFilterRequiresAction] = useState<boolean>(false);
  const [filterHighMatch, setFilterHighMatch] = useState<boolean>(false);

  // Slide-Over Inspection Drawer State
  const [selectedAppId, setSelectedAppId] = useState<number | null>(null);
  const [drawerData, setDrawerData] = useState<DrawerData | null>(null);
  const [drawerLoading, setDrawerLoading] = useState<boolean>(false);
  const [drawerTab, setDrawerTab] = useState<"overview" | "ats" | "outreach" | "interview">("overview");

  // New Application Modal State
  const [showAddModal, setShowAddModal] = useState<boolean>(false);
  const [newTitle, setNewTitle] = useState<string>("");
  const [newCompany, setNewCompany] = useState<string>("");
  const [newLocation, setNewLocation] = useState<string>("");
  const [newDescription, setNewDescription] = useState<string>("");

  useEffect(() => {
    fetchJobsAndApplications();
  }, []);

  const fetchJobsAndApplications = async () => {
    setLoading(true);
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };

      // Fetch Applications
      const appRes = await fetch("/api/applications", { headers });
      const appData = await appRes.json();
      if (appData.ok && appData.applications) {
        setApplications(appData.applications);
      }

      // Fetch Scouted Jobs
      const scoutRes = await fetch("/api/jobs/scout", { headers });
      const scoutData = await scoutRes.json();
      if (scoutData.ok && scoutData.jobs) {
        setScoutedJobs(scoutData.jobs);
      }
    } catch (err) {
      console.error("Failed to load jobs data:", err);
    } finally {
      setLoading(false);
    }
  };

  const fetchDrawerData = async (appId: number) => {
    setSelectedAppId(appId);
    setDrawerLoading(true);
    setDrawerTab("overview");
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const res = await fetch(`/api/applications/${appId}/drawer`, { headers });
      const data = await res.json();
      if (data.ok) {
        setDrawerData(data);
      }
    } catch (err) {
      console.error("Failed to fetch drawer data:", err);
    } fontally: {
      setDrawerLoading(false);
    }
  };

  const handleUpdateStatus = async (appId: number, newStatus: string) => {
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`
      };
      await fetch(`/api/applications/${appId}/status`, {
        method: "POST",
        headers,
        body: JSON.stringify({ status: newStatus })
      });
      fetchJobsAndApplications();
      if (selectedAppId === appId) fetchDrawerData(appId);
    } catch (err) {
      console.error("Failed to update status:", err);
    }
  };

  const handleCleanStaleCards = async () => {
    try {
      setRefreshing(true);
      const headers = { Authorization: `Bearer ${getToken()}` };
      await fetch("/api/applications/clean-stale?days=30", { method: "POST", headers });
      fetchJobsAndApplications();
    } catch (err) {
      console.error("Failed to clean stale cards:", err);
    } finally {
      setRefreshing(false);
    }
  };

  const handleSendFollowUp = async (appId: number) => {
    try {
      const headers = { Authorization: `Bearer ${getToken()}` };
      const res = await fetch(`/api/applications/${appId}/followup`, { method: "POST", headers });
      const data = await res.json();
      if (data.ok) {
        alert(data.message);
      }
    } catch (err) {
      console.error("Failed to send follow up:", err);
    }
  };

  const handleRunATS = async (appId: number) => {
    try {
      setDrawerLoading(true);
      const headers = { Authorization: `Bearer ${getToken()}` };
      const res = await fetch(`/api/applications/${appId}/ats`, { method: "POST", headers });
      const data = await res.json();
      if (data.ok) {
        fetchDrawerData(appId);
      } else {
        alert(data.error || "ATS Analysis failed");
      }
    } catch (err) {
      console.error("ATS trigger error:", err);
    } finally {
      setDrawerLoading(false);
    }
  };

  const handleAddApplication = async () => {
    if (!newTitle.trim() || !newCompany.trim()) return;
    try {
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${getToken()}`
      };
      await fetch("/api/applications", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: newTitle,
          company: newCompany,
          location: newLocation,
          description: newDescription,
          status: "interested"
        })
      });
      setShowAddModal(false);
      setNewTitle("");
      setNewCompany("");
      setNewLocation("");
      setNewDescription("");
      fetchJobsAndApplications();
    } catch (err) {
      console.error("Failed to add application:", err);
    }
  };

  // Filter Applications
  const filteredApps = useMemo(() => {
    return applications.filter((app) => {
      if (filterActiveOnly && ["rejected", "accepted"].includes(app.status)) return false;
      if (filterHighMatch && (app.ats_score || 0) < 80) return false;
      return true;
    });
  }, [applications, filterActiveOnly, filterHighMatch]);

  const columns = [
    { status: "interested", title: "Interested", color: "border-cyan-500/40 text-cyan-400 bg-cyan-950/20" },
    { status: "applied", title: "Applied", color: "border-blue-500/40 text-blue-400 bg-blue-950/20" },
    { status: "interviewing", title: "Interviewing", color: "border-purple-500/40 text-purple-400 bg-purple-950/20" },
    { status: "offer", title: "Offer", color: "border-emerald-500/40 text-emerald-400 bg-emerald-950/20" },
    { status: "rejected", title: "Rejected", color: "border-rose-500/40 text-rose-400 bg-rose-950/20" },
  ];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-cyan-400">
        <RefreshCw className="w-10 h-10 animate-spin mb-4" />
        <p className="text-lg font-medium">Loading Kanban Command Center...</p>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 space-y-6">
      
      {/* Top Header & Filter Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-slate-900/90 border border-slate-800 backdrop-blur-md">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 rounded-xl bg-gradient-to-tr from-cyan-500 to-emerald-500 text-slate-950 font-bold shadow-lg">
            <Target className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-100 flex items-center gap-2">
              Jobs Kanban Board
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800">
                {filteredApps.length} Active Cards
              </span>
            </h1>
            <p className="text-xs text-slate-400">AI Application Pipeline & Automated Recruiter Cadence</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Filters */}
          <button
            onClick={() => setFilterActiveOnly(!filterActiveOnly)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
              filterActiveOnly ? "bg-cyan-500 text-slate-950 border-cyan-400" : "bg-slate-800 text-slate-300 border-slate-700"
            }`}
          >
            Active Only
          </button>
          <button
            onClick={() => setFilterHighMatch(!filterHighMatch)}
            className={`px-3 py-1.5 rounded-xl border text-xs font-semibold transition-all ${
              filterHighMatch ? "bg-emerald-500 text-slate-950 border-emerald-400" : "bg-slate-800 text-slate-300 border-slate-700"
            }`}
          >
            High Match (80%+)
          </button>

          {/* Clean Stale Cards Action */}
          <button
            onClick={handleCleanStaleCards}
            disabled={refreshing}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-rose-950/60 text-rose-300 border border-rose-800 hover:bg-rose-900 text-xs font-semibold transition-all"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Clean Stale Cards</span>
          </button>

          {/* Add Job Application */}
          <button
            onClick={() => setShowAddModal(true)}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-emerald-500 text-slate-950 font-bold text-xs shadow-lg hover:opacity-90 transition-all"
          >
            <Plus className="w-4 h-4" />
            <span>+ Add Job Card</span>
          </button>
        </div>
      </div>

      {/* Main Kanban Board (5 Clean Columns) */}
      <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
        {columns.map((col) => {
          const colCards = filteredApps.filter((a) => a.status === col.status);
          return (
            <div key={col.status} className="p-3 rounded-2xl bg-slate-900/60 border border-slate-800/80 space-y-3 min-h-[500px]">
              {/* Column Header */}
              <div className={`p-2.5 rounded-xl border flex items-center justify-between font-bold text-xs ${col.color}`}>
                <span>{col.title}</span>
                <span className="px-2 py-0.5 rounded-full bg-black/40 text-xs">{colCards.length}</span>
              </div>

              {/* Column Minimalist Cards */}
              <div className="space-y-2.5">
                {colCards.map((app) => {
                  const matchScore = app.ats_score || 78;
                  const matchColor = matchScore >= 80 ? "bg-emerald-950 text-emerald-400 border-emerald-800" : matchScore >= 60 ? "bg-amber-950 text-amber-400 border-amber-800" : "bg-slate-800 text-slate-400 border-slate-700";

                  return (
                    <motion.div
                      key={app.id}
                      onClick={() => fetchDrawerData(app.id)}
                      whileHover={{ scale: 1.02 }}
                      className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 hover:border-cyan-500/50 cursor-pointer transition-all space-y-2 shadow-md"
                    >
                      {/* Line 1: Job Title */}
                      <h4 className="text-xs font-bold text-slate-100 truncate">{app.title}</h4>

                      {/* Line 2: Company • Location */}
                      <p className="text-[11px] text-slate-400 truncate">
                        {app.company} {app.location && `• ${app.location}`}
                      </p>

                      {/* Line 3 & 4: Match Badge & Single Contextual Action Button */}
                      <div className="flex items-center justify-between pt-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full border font-bold ${matchColor}`}>
                          {matchScore}% Match
                        </span>

                        {col.status === "interested" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUpdateStatus(app.id, "applied");
                            }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 transition-all flex items-center gap-1"
                          >
                            1-Tap Apply ⚡
                          </button>
                        )}

                        {col.status === "applied" && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSendFollowUp(app.id);
                            }}
                            className="text-[10px] px-2 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 hover:text-white transition-all"
                          >
                            Follow Up
                          </button>
                        )}

                        {col.status === "interviewing" && (
                          <span className="text-[10px] text-purple-400 font-bold">Interviewing</span>
                        )}
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* UNIFIED SLIDE-OVER INSPECTION DRAWER */}
      <AnimatePresence>
        {selectedAppId && drawerData && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex justify-end">
            <motion.div
              initial={{ x: "100%" }}
              animate={{ x: 0 }}
              exit={{ x: "100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 200 }}
              className="w-full max-w-2xl bg-slate-900 border-l border-slate-800 h-full p-6 space-y-6 shadow-2xl overflow-y-auto"
            >
              {/* Drawer Header */}
              <div className="flex items-center justify-between border-b border-slate-800 pb-4">
                <div>
                  <h2 className="text-lg font-bold text-slate-100">{drawerData.application.title}</h2>
                  <p className="text-xs text-slate-400">{drawerData.application.company} • {drawerData.application.location}</p>
                </div>
                <button onClick={() => setSelectedAppId(null)} className="p-2 rounded-xl bg-slate-800 text-slate-400 hover:text-white">
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* 4 Focused Tabs Navigation */}
              <div className="flex space-x-1 p-1 rounded-xl bg-slate-950 border border-slate-800">
                {[
                  { id: "overview", label: "Overview & JD" },
                  { id: "ats", label: "ATS & Resume" },
                  { id: "outreach", label: "Outreach & Referrals" },
                  { id: "interview", label: "Interview & Cadence" }
                ].map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setDrawerTab(tab.id as any)}
                    className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                      drawerTab === tab.id ? "bg-cyan-500 text-slate-950 font-bold shadow-md" : "text-slate-400 hover:text-slate-200"
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* TAB 1: OVERVIEW & JD */}
              {drawerTab === "overview" && (
                <div className="space-y-4 text-xs text-slate-300">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <h4 className="font-bold text-cyan-400 uppercase tracking-wider">Job Description</h4>
                    <p className="whitespace-pre-wrap leading-relaxed text-slate-300">
                      {drawerData.application.description || "No job description text available."}
                    </p>
                  </div>
                </div>
              )}

              {/* TAB 2: ATS & TAILORED RESUME */}
              {drawerTab === "ats" && (
                <div className="space-y-4 text-xs text-slate-300">
                  {/* Score & Warning Banner */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between">
                    <div>
                      <span className="text-[10px] uppercase font-bold text-slate-500">ATS Match Score</span>
                      <h3 className="text-2xl font-black text-emerald-400">{drawerData.ats_analysis.ats_score || drawerData.application.ats_score || 78}%</h3>
                    </div>
                    <button
                      onClick={() => handleRunATS(drawerData.application.id)}
                      className="px-4 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs hover:bg-cyan-400"
                    >
                      Run ATS Analysis ⚡
                    </button>
                  </div>

                  {(drawerData.ats_analysis.ats_score < 60) && (
                    <div className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 flex items-center space-x-2">
                      <AlertTriangle className="w-4 h-4 shrink-0" />
                      <span>Warning: ATS Score below 60%. Review missing keywords before applying.</span>
                    </div>
                  )}

                  {/* Honest Bridge Strategy */}
                  <div className="p-4 rounded-xl bg-slate-950 border border-cyan-900/40 space-y-2">
                    <h4 className="font-bold text-cyan-300">Honest Bridge Strategy (Missing Skill Reframing)</h4>
                    <p className="text-slate-400">Highlight transferable genuine experience during interviews without fabricating tools.</p>
                  </div>

                  {/* Resume Download Buttons */}
                  <div className="flex space-x-2 pt-2">
                    <button className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2">
                      <FileText className="w-4 h-4" /> Download .TXT Resume
                    </button>
                    <button className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2">
                      <Download className="w-4 h-4" /> Download .DOCX Resume
                    </button>
                  </div>
                </div>
              )}

              {/* TAB 3: OUTREACH & REFERRALS */}
              {drawerTab === "outreach" && (
                <div className="space-y-4 text-xs text-slate-300">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <h4 className="font-bold text-cyan-400">Pre-Drafted Recruiter Email Pitch</h4>
                    <pre className="p-3 rounded-xl bg-black text-slate-300 font-mono text-[11px] whitespace-pre-wrap">
                      {drawerData.outreach_notes || `Subject: Application for ${drawerData.application.title} - Madan Sai Daram\n\nHi Hiring Team,\n\nI recently applied for the ${drawerData.application.title} role at ${drawerData.application.company}. With expertise in SQL, Python, and production data pipelines, I'd love to connect on next steps.`}
                    </pre>
                  </div>

                  {/* Referrals & Alumni Network Matcher */}
                  <div className="p-4 rounded-xl bg-purple-950/20 border border-purple-900/40 space-y-2">
                    <h4 className="font-bold text-purple-300 flex items-center gap-2">
                      <Users className="w-4 h-4" /> Referrals & Alumni Network Matches ({drawerData.referrals.length})
                    </h4>
                    {drawerData.referrals.length > 0 ? (
                      drawerData.referrals.map((ref: any, idx: number) => (
                        <div key={idx} className="p-2.5 rounded-lg bg-slate-950 border border-purple-900 text-xs flex justify-between items-center">
                          <div>
                            <p className="font-bold text-slate-200">{ref.name}</p>
                            <p className="text-[10px] text-slate-400">{ref.role} • {ref.company}</p>
                          </div>
                          <button className="px-3 py-1 rounded bg-purple-500 text-slate-950 font-bold text-[10px]">Request Referral</button>
                        </div>
                      ))
                    ) : (
                      <p className="text-slate-500 text-xs">No direct networking contacts found for {drawerData.application.company}.</p>
                    )}
                  </div>
                </div>
              )}

              {/* TAB 4: INTERVIEW & CADENCE STUDIO */}
              {drawerTab === "interview" && (
                <div className="space-y-4 text-xs text-slate-300">
                  <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                    <h4 className="font-bold text-emerald-400">Cadence & Stale Score Analytics</h4>
                    <p>Days Inactive: <strong className="text-slate-100">{drawerData.stale_info.days_inactive} days</strong></p>
                    {drawerData.stale_info.followup_needed && (
                      <div className="p-2.5 rounded-lg bg-amber-950/60 border border-amber-800 text-amber-300">
                        ⚠️ Action Required: Card has been inactive. Send follow-up email.
                      </div>
                    )}
                  </div>

                  <button
                    onClick={() => handleSendFollowUp(drawerData.application.id)}
                    className="w-full py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs hover:bg-cyan-400 shadow-lg flex items-center justify-center gap-2"
                  >
                    <Send className="w-4 h-4" /> Send Follow-Up via Gmail ⚡
                  </button>
                </div>
              )}

            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* MODAL: ADD APPLICATION */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-3xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <h3 className="text-lg font-bold text-slate-100">Add New Job Application Card</h3>
            <input
              type="text"
              placeholder="Job Title"
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-800 text-slate-100 border border-slate-700 text-xs"
            />
            <input
              type="text"
              placeholder="Company Name"
              value={newCompany}
              onChange={(e) => setNewCompany(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-800 text-slate-100 border border-slate-700 text-xs"
            />
            <input
              type="text"
              placeholder="Location (e.g. Remote / Bengaluru)"
              value={newLocation}
              onChange={(e) => setNewLocation(e.target.value)}
              className="w-full p-3 rounded-xl bg-slate-800 text-slate-100 border border-slate-700 text-xs"
            />
            <textarea
              placeholder="Job Description Text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={4}
              className="w-full p-3 rounded-xl bg-slate-800 text-slate-100 border border-slate-700 text-xs"
            />
            <div className="flex justify-end space-x-2 pt-2">
              <button onClick={() => setShowAddModal(false)} className="px-4 py-2 text-xs text-slate-400">Cancel</button>
              <button onClick={handleAddApplication} className="px-5 py-2 rounded-xl bg-cyan-500 text-slate-950 font-bold text-xs">Add Card</button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
