import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { X, Bell, RefreshCw, Trash2, Play, CheckCircle, Loader2 } from "lucide-react";

interface NotificationsDrawerProps {
  onClose: () => void;
}

interface LogEntry {
  id: number;
  job_name: string;
  status: string;
  message: string;
  created_at: string;
}

export default function NotificationsDrawer({ onClose }: NotificationsDrawerProps) {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [runningJob, setRunningJob] = useState<string | null>(null);
  const [jobFeedback, setJobFeedback] = useState<Record<string, string>>({});

  const loadLogs = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/job-logs?limit=40");
      if (res.ok) {
        const data = await res.json();
        setLogs(data);
      }
    } catch (err) {
      console.error("Failed to fetch job logs:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadLogs();
  }, []);

  const handleClearLogs = async () => {
    if (!confirm("Are you sure you want to clear all system logs?")) return;
    try {
      const res = await fetch("/api/job-logs/clear", { method: "POST" });
      if (res.ok) {
        setLogs([]);
      }
    } catch (err) {
      console.error("Failed to clear logs:", err);
    }
  };

  const handleRunJob = async (jobName: string) => {
    setRunningJob(jobName);
    setJobFeedback((prev) => ({ ...prev, [jobName]: "" }));
    try {
      const res = await fetch("/api/run-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_name: jobName }),
      });
      const data = await res.json();
      if (res.ok) {
        setJobFeedback((prev) => ({ ...prev, [jobName]: data.message || "Execution started successfully." }));
        // Refresh logs after a brief delay
        setTimeout(loadLogs, 1500);
      } else {
        setJobFeedback((prev) => ({ ...prev, [jobName]: data.error || "Execution failed." }));
      }
    } catch (err) {
      console.error("Job run failed:", err);
      setJobFeedback((prev) => ({ ...prev, [jobName]: "Connection error." }));
    } finally {
      setRunningJob(null);
      // Clear job feedback after a while
      setTimeout(() => {
        setJobFeedback((prev) => ({ ...prev, [jobName]: "" }));
      }, 5000);
    }
  };

  // Helper formatting for log status colors
  const getStatusColor = (status: string) => {
    const s = status.toLowerCase();
    if (s.includes("ok") || s.includes("success") || s.includes("done")) return "text-[#5eead4] bg-[#5eead4]/10 border-[#5eead4]/20";
    if (s.includes("fail") || s.includes("error") || s.includes("crash")) return "text-[#ffb4ab] bg-[#ffb4ab]/10 border-[#ffb4ab]/20";
    return "text-[#ffd6a3] bg-[#ffd6a3]/10 border-[#ffd6a3]/20";
  };

  const operations = [
    { id: "morning-digest", name: "Morning digest briefing", desc: "Builds digest of today's topics and sends WhatsApp summary." },
    { id: "job-scout", name: "Job Scout crawler", desc: "Crawls external Job boards, ranks fits, and forwards matches." },
    { id: "learn-patterns", name: "Re-learn patterns", desc: "Regenerates speech and message pattern style indexes." },
    { id: "reminders-due", name: "Check due reminders", desc: "Fires pending user reminders/automations whose time has arrived." },
    { id: "inbox-check", name: "Check Email inbox", desc: "Hourly tick to sync inbox and triage messages." },
    { id: "weekly-report", name: "Weekly progress report", desc: "Builds and sends the weekly performance summary." }
  ];

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 z-[100] bg-black/40 backdrop-blur-xs" 
        onClick={onClose}
      />

      {/* Drawer */}
      <motion.div
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "tween", duration: 0.3 }}
        className="fixed top-0 right-0 h-screen w-full max-w-lg z-[101] bg-[#0f131f]/95 border-l border-[#3c494c] shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col justify-between font-sans text-sm text-[#dfe2f3]"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#ffb4ab] animate-pulse"></span>
            <h3 className="text-base font-bold font-mono tracking-wider uppercase text-[#ffb4ab]">
              System Activities & Logs
            </h3>
          </div>
          <div className="flex items-center gap-2">
            <button 
              onClick={loadLogs} 
              className="p-1.5 hover:bg-white/5 rounded transition-colors text-[#bbc9cd] hover:text-white"
              title="Refresh logs"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            <button 
              onClick={handleClearLogs} 
              disabled={logs.length === 0}
              className="p-1.5 hover:bg-[#ffb4ab]/10 rounded transition-colors text-[#bbc9cd] hover:text-[#ffb4ab] disabled:opacity-50"
              title="Clear logs"
            >
              <Trash2 className="w-4 h-4" />
            </button>
            <div className="w-[1px] h-5 bg-white/10 mx-1"></div>
            <button 
              onClick={onClose}
              className="p-1 hover:bg-white/5 rounded transition-colors text-[#bbc9cd] hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content Tabs (Operations & Logs combined) */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {/* Operations Section */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold tracking-widest text-[#8aebff] uppercase font-mono border-b border-white/5 pb-1">
              Core Operations
            </h4>
            <div className="grid grid-cols-1 gap-2.5">
              {operations.map((op) => (
                <div key={op.id} className="bg-[#1b1f2c]/40 border border-white/5 p-3 rounded-lg flex items-center justify-between gap-4">
                  <div className="flex-1">
                    <span className="font-semibold text-xs font-mono block text-[#dfe2f3]">
                      {op.name}
                    </span>
                    <span className="text-[11px] text-[#859397] block leading-normal mt-0.5">
                      {op.desc}
                    </span>
                    {jobFeedback[op.id] && (
                      <span className="text-[10px] font-mono text-[#5eead4] block mt-1">
                        ● {jobFeedback[op.id]}
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => handleRunJob(op.id)}
                    disabled={runningJob !== null}
                    className="p-2 bg-[#8aebff]/10 border border-[#8aebff]/30 rounded hover:bg-[#8aebff] hover:text-[#00363e] text-[#8aebff] transition-all cursor-pointer disabled:opacity-30"
                  >
                    {runningJob === op.id ? (
                      <Loader2 className="w-4.5 h-4.5 animate-spin" />
                    ) : (
                      <Play className="w-4.5 h-4.5 fill-current" />
                    )}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Activity Logs Section */}
          <div className="space-y-3">
            <h4 className="text-xs font-bold tracking-widest text-[#8aebff] uppercase font-mono border-b border-white/5 pb-1 flex justify-between items-center">
              <span>Telemetry Logs</span>
              {logs.length > 0 && <span className="text-[10px] text-[#859397] lowercase font-normal">showing {logs.length} events</span>}
            </h4>
            
            {loading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#859397]">
                <Loader2 className="w-7 h-7 animate-spin text-[#8aebff]" />
                <p className="font-mono text-xs">Syncing activity ledger...</p>
              </div>
            ) : logs.length > 0 ? (
              <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                {logs.map((log) => (
                  <div key={log.id} className="bg-[#1b1f2c]/20 border border-white/5 p-2.5 rounded font-mono text-[11px] space-y-1.5">
                    <div className="flex justify-between items-center">
                      <span className="font-bold text-[#8aebff]">{log.job_name}</span>
                      <span className={`text-[9px] uppercase px-1.5 py-0.5 rounded border font-bold ${getStatusColor(log.status)}`}>
                        {log.status}
                      </span>
                    </div>
                    <p className="text-[#bbc9cd] text-[11px] leading-relaxed">{log.message}</p>
                    <div className="text-right text-[9px] text-[#859397]">{log.created_at}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center text-[#859397]">
                <CheckCircle className="w-8 h-8 text-[#5eead4]/40 mb-2" />
                <p className="font-mono text-xs">No recent anomalies or task logs registered.</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 border-t border-white/10 bg-[#0a0e1a] text-center text-[10px] font-mono text-[#859397]">
          JARVIS Core Live Diagnostics
        </div>
      </motion.div>
    </>
  );
}
