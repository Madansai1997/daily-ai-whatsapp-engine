import React, { useState, useEffect } from "react";
import { motion } from "motion/react";
import { X, Save, Check, Loader2, Key, Info, HelpCircle } from "lucide-react";

interface SettingsDrawerProps {
  onClose: () => void;
}

export default function SettingsDrawer({ onClose }: SettingsDrawerProps) {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saved">("idle");

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      try {
        const res = await fetch("/api/settings");
        if (res.ok) {
          const data = await res.json();
          setSettings(data);
        }
      } catch (err) {
        console.error("Failed to load settings:", err);
      } finally {
        setLoading(false);
      }
    }
    loadSettings();
  }, []);

  const handleChange = (key: string, value: string) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaveStatus("idle");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(settings),
      });
      if (res.ok) {
        setSaveStatus("saved");
        setTimeout(() => setSaveStatus("idle"), 2500);
      }
    } catch (err) {
      console.error("Failed to save settings:", err);
    } finally {
      setSaving(false);
    }
  };

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
        className="fixed top-0 right-0 h-screen w-full max-w-md z-[101] bg-[#0f131f]/95 border-l border-[#3c494c] shadow-[0_0_30px_rgba(0,0,0,0.5)] flex flex-col justify-between font-sans text-sm text-[#dfe2f3]"
      >
        {/* Header */}
        <div className="flex justify-between items-center px-6 py-4 border-b border-white/10">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#8aebff] animate-pulse"></span>
            <h3 className="text-base font-bold font-mono tracking-wider uppercase text-[#8aebff]">
              Core Controls
            </h3>
          </div>
          <button 
            onClick={onClose}
            className="p-1 hover:bg-white/5 rounded transition-colors text-[#bbc9cd] hover:text-white"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 space-y-6">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-48 gap-2 text-[#859397]">
              <Loader2 className="w-8 h-8 animate-spin text-[#8aebff]" />
              <p className="font-mono text-xs">Querying configuration database...</p>
            </div>
          ) : (
            <>
              {/* LLM & Model Selection */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold tracking-widest text-[#8aebff] uppercase font-mono">
                  1. Artificial Intelligence
                </h4>
                <div className="space-y-2">
                  <label className="text-xs text-[#859397] block">Active Reasoning Model</label>
                  <select
                    value={settings.gemini_model || "gemini-2.5-flash"}
                    onChange={(e) => handleChange("gemini-model", e.target.value)}
                    className="w-full bg-[#1b1f2c] border border-[#3c494c] rounded px-3 py-2 text-white font-mono text-xs focus:border-[#8aebff] outline-none"
                  >
                    <option value="gemini-2.5-flash">Gemini 2.5 Flash (Default)</option>
                    <option value="gemini-2.5-pro">Gemini 2.5 Pro (Precision)</option>
                    <option value="groq/llama-3.3-70b-versatile">Llama 3.3 70B (Fast)</option>
                  </select>
                  <p className="text-[11px] text-[#859397] leading-relaxed">
                    Default model for WhatsApp chat responses and resume ATS alignments. Environment override: <span className="font-mono text-white/70">{settings._env_gemini_model}</span>
                  </p>
                </div>
              </div>

              {/* WhatsApp Automation */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold tracking-widest text-[#8aebff] uppercase font-mono">
                  2. Telegram / WhatsApp Automation
                </h4>
                <div className="flex justify-between items-center bg-[#1b1f2c]/50 p-3 rounded border border-white/5">
                  <div>
                    <span className="font-mono text-xs font-bold block">WhatsApp Auto-Reply</span>
                    <span className="text-[11px] text-[#859397]">Auto-respond to message threads</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.whatsapp_auto_reply === "true"}
                      onChange={(e) => handleChange("whatsapp_auto_reply", e.target.checked ? "true" : "false")}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#3c494c] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5eead4]"></div>
                  </label>
                </div>
              </div>

              {/* Job Scout Auto-Run */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold tracking-widest text-[#8aebff] uppercase font-mono">
                  3. Job Scout Crawler
                </h4>
                <div className="space-y-2">
                  <label className="text-xs text-[#859397] block">Auto-Search Firing Frequency</label>
                  <select
                    value={settings.job_scout_interval || "24"}
                    onChange={(e) => handleChange("job_scout_interval", e.target.value)}
                    className="w-full bg-[#1b1f2c] border border-[#3c494c] rounded px-3 py-2 text-white font-mono text-xs focus:border-[#8aebff] outline-none"
                  >
                    <option value="6">Every 6 Hours</option>
                    <option value="12">Every 12 Hours</option>
                    <option value="24">Every 24 Hours (Daily digest)</option>
                    <option value="48">Every 48 Hours</option>
                    <option value="off">Off (Manual trigger only)</option>
                  </select>
                </div>
              </div>

              {/* Text-to-Speech & Sound options */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold tracking-widest text-[#8aebff] uppercase font-mono">
                  4. Telemetry Speech & Alerts
                </h4>
                <div className="flex justify-between items-center bg-[#1b1f2c]/50 p-3 rounded border border-white/5">
                  <div>
                    <span className="font-mono text-xs font-bold block">Voice Narrations (TTS)</span>
                    <span className="text-[11px] text-[#859397]">Audio feedback on replies</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={settings.tts_audio_enabled === "true"}
                      onChange={(e) => handleChange("tts_audio_enabled", e.target.checked ? "true" : "false")}
                      className="sr-only peer"
                    />
                    <div className="w-9 h-5 bg-[#3c494c] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#5eead4]"></div>
                  </label>
                </div>
              </div>

              {/* Environment Information (Read Only) */}
              <div className="space-y-3 pt-4 border-t border-white/5">
                <h4 className="text-xs font-bold tracking-widest text-[#859397] uppercase font-mono flex items-center gap-1.5">
                  <Info className="w-3.5 h-3.5" /> Environment Status
                </h4>
                <div className="bg-[#0a0e1a] rounded p-3 border border-white/5 font-mono text-[11px] space-y-2 text-[#859397]">
                  <div className="flex justify-between">
                    <span>Safe Mode:</span>
                    <span className={settings._env_safe_mode === "yes" ? "text-[#ffd6a3]" : "text-[#5eead4]"}>
                      {settings._env_safe_mode === "yes" ? "ENABLED (Temp DB)" : "DISABLED (Live DB)"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Gemini Key:</span>
                    <span className={settings._env_has_gemini_key === "yes" ? "text-[#5eead4]" : "text-[#ff6b6b]"}>
                      {settings._env_has_gemini_key === "yes" ? "CONFIGURED" : "MISSING"}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span>Groq Key:</span>
                    <span className={settings._env_has_groq_key === "yes" ? "text-[#5eead4]" : "text-[#ff6b6b]"}>
                      {settings._env_has_groq_key === "yes" ? "CONFIGURED" : "MISSING"}
                    </span>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer with Save Action */}
        <div className="px-6 py-4 border-t border-white/10 bg-[#0a0e1a] flex justify-between items-center gap-4">
          <div className="text-xs font-mono text-[#859397]">
            {saveStatus === "saved" && (
              <span className="text-[#5eead4] flex items-center gap-1">
                <Check className="w-4.5 h-4.5" /> CHANGES SYNCED
              </span>
            )}
          </div>
          <button
            onClick={handleSave}
            disabled={saving || loading}
            className="flex items-center justify-center gap-2 bg-[#8aebff] hover:bg-[#8aebff]/80 text-[#00363e] font-mono font-bold px-4 py-2 rounded cursor-pointer disabled:opacity-50 transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>SAVING...</span>
              </>
            ) : (
              <>
                <Save className="w-4 h-4" />
                <span>SAVE CHANGES</span>
              </>
            )}
          </button>
        </div>
      </motion.div>
    </>
  );
}
