import React, { useState, useEffect } from "react";
import { ScreenId } from "../types";
import { Search, Bell, Settings, HelpCircle, Terminal as TerminalIcon, RefreshCw } from "lucide-react";

interface HeaderProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
  onOpenSearch: () => void;
  onOpenSettings: () => void;
  onOpenNotifications: () => void;
}

interface Weather {
  location: string;
  temp_c: number;
  condition: string;
  emoji: string;
  windspeed: number;
}

export default function Header({
  activeScreen,
  onNavigate,
  onOpenSearch,
  onOpenSettings,
  onOpenNotifications
}: HeaderProps) {
  const [weather, setWeather] = useState<Weather | null>(null);
  const [memPct, setMemPct] = useState<number | null>(null);
  const [unread, setUnread] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Force the installed PWA / cached tab to pull the latest deployed build without a reinstall:
  // drop the service worker + every cache, then hard-reload so fresh HTML + hashed assets load.
  const forceRefresh = async () => {
    setRefreshing(true);
    try {
      if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
      }
      if ("caches" in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch { /* ignore — reload anyway */ }
    window.location.reload();
  };

  // Pull real weather (Hyderabad) + memory usage + unread notification count.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [mRes, nRes] = await Promise.all([
          fetch("/api/system-metrics", { cache: "no-store" }),
          fetch("/api/notifications/unread-count", { cache: "no-store" }),
        ]);
        if (cancelled) return;
        if (mRes.ok) {
          const data = await mRes.json();
          if (data?.weather && typeof data.weather.temp_c === "number") setWeather(data.weather);
          if (typeof data?.memory?.pct === "number") setMemPct(data.memory.pct);
        }
        if (nRes.ok) {
          const nd = await nRes.json();
          if (typeof nd?.unread === "number") setUnread(nd.unread);
        }
      } catch {
        /* leave neutral */
      }
    };
    load();
    const timer = setInterval(() => { if (!document.hidden) load(); }, 30000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, []);

  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-[#0f131f]/40 backdrop-blur-md border-b border-white/10 h-16">
      <div className="flex justify-between items-center w-full px-8 max-w-full mx-auto h-full">
        <div className="flex items-center gap-8">
          {/* Real Hyderabad weather + live memory usage */}
          <div className="flex items-center gap-4">
            <div
              className="flex items-center gap-1.5"
              title={weather ? `${weather.condition} · ${weather.location} · wind ${weather.windspeed} km/h` : "Fetching weather…"}
            >
              <span className="text-xl leading-none">{weather?.emoji || "🌡️"}</span>
              <div className="leading-tight">
                <span className="block text-lg font-bold tracking-tight text-[#8aebff] font-mono glow-cyan">
                  {weather ? `${weather.temp_c}°C` : "—"}
                </span>
                <span className="block text-[9px] font-mono text-[#859397] uppercase tracking-wider -mt-0.5">
                  {weather ? weather.condition : "Hyderabad"}
                </span>
              </div>
            </div>
            <div className="hidden sm:block w-[1px] h-8 bg-[#3c494c]"></div>
            <div
              className="hidden sm:block leading-tight"
              title="Engine memory usage (RSS vs 512MB cap)"
            >
              <span
                className={`block text-lg font-bold tracking-tight font-mono ${
                  memPct !== null && memPct >= 85 ? "text-[#ffb4ab]" : "text-[#dfe2f3]"
                }`}
              >
                {memPct !== null ? `${memPct}%` : "—"}
              </span>
              <span className="block text-[9px] font-mono text-[#859397] uppercase tracking-wider -mt-0.5">
                Memory
              </span>
            </div>
          </div>
          {/* Ordered by daily use: Home first, power tools last */}
          <nav className="hidden md:flex items-center gap-5 lg:gap-6">
            {[
              { screen: ScreenId.Core, label: "HOME", active: activeScreen === ScreenId.Core },
              { screen: ScreenId.Jobs, label: "JOBS", active: activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis },
              { screen: ScreenId.Insights, label: "INSIGHTS", active: activeScreen === ScreenId.Insights },
              { screen: ScreenId.Docs, label: "DOCS", active: activeScreen === ScreenId.Docs },
              { screen: ScreenId.Analyst, label: "DATA", active: activeScreen === ScreenId.Analyst },
              { screen: ScreenId.Bills, label: "BILLS", active: activeScreen === ScreenId.Bills },
              { screen: ScreenId.Assistant, label: "JARVIS", active: activeScreen === ScreenId.Assistant },
              { screen: ScreenId.Discover, label: "DISCOVER", active: activeScreen === ScreenId.Discover || activeScreen === ScreenId.Trends || activeScreen === ScreenId.Daily },
              // TERMINAL and HELP live in the always-visible header icons (right side), not nav tabs.
            ].map((item) => (
              <a
                key={item.label}
                href="#"
                onClick={(e) => { e.preventDefault(); onNavigate(item.screen); }}
                className={`transition-colors duration-200 font-medium tracking-wide uppercase text-sm ${
                  item.active
                    ? "text-[#8aebff] font-bold border-b-2 border-[#8aebff] pb-1 nav-active-glow"
                    : "text-[#bbc9cd] hover:text-[#8aebff]"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>
        </div>

        <div className="flex items-center gap-6">
          {/* Search bar simulation */}
          <button 
            onClick={onOpenSearch}
            className="hidden sm:flex items-center gap-2 bg-[#1b1f2c]/50 px-4 py-1.5 border border-white/10 rounded-full transition-all hover:border-[#8aebff]/50 hover:bg-[#1b1f2c]/80 text-[#859397] hover:text-white cursor-pointer"
          >
            <Search className="w-4.5 h-4.5 text-[#8aebff]" />
            <span className="text-[13px] font-mono">Search protocols...</span>
          </button>

          <button
            onClick={() => { setUnread(0); onOpenNotifications(); }}
            className="relative text-[#bbc9cd] hover:text-[#8aebff] transition-colors p-1 cursor-pointer"
            title="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unread > 0 && (
              <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 flex items-center justify-center rounded-full bg-[#ffb4ab] text-[#0a0e1a] text-[9px] font-bold font-mono shadow-[0_0_8px_rgba(255,180,171,0.6)]">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </button>
          <button
            onClick={forceRefresh}
            disabled={refreshing}
            className="text-[#bbc9cd] hover:text-[#8aebff] transition-colors p-1 cursor-pointer disabled:opacity-60"
            title="Update to latest — pulls the newest deployed version (no reinstall needed)"
          >
            <RefreshCw className={`w-5 h-5 ${refreshing ? "animate-spin" : ""}`} />
          </button>
          <button
            onClick={() => onNavigate(ScreenId.Terminal)}
            className={`transition-colors p-1 cursor-pointer ${
              activeScreen === ScreenId.Terminal ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd] hover:text-[#8aebff]"
            }`}
            title="Terminal — PDF upload, local files, system info"
          >
            <TerminalIcon className="w-5 h-5" />
          </button>
          <button
            onClick={() => onNavigate(ScreenId.Help)}
            className={`transition-colors p-1 cursor-pointer ${
              activeScreen === ScreenId.Help ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd] hover:text-[#8aebff]"
            }`}
            title="Help & Guide — what everything does and how to use it"
          >
            <HelpCircle className="w-5 h-5" />
          </button>
          <button
            onClick={onOpenSettings}
            className="text-[#bbc9cd] hover:text-[#8aebff] transition-colors p-1 cursor-pointer"
            title="Core Controls"
          >
            <Settings className="w-5 h-5" />
          </button>

          {/* User profile avatar — real initials, no external image */}
          <div
            title="Madan Sai Daram"
            className="w-8 h-8 rounded-full border border-[#8aebff]/30 bg-[#1b1f2c] flex items-center justify-center text-[#8aebff] font-mono font-bold text-sm select-none glow-cyan"
          >
            M
          </div>
        </div>
      </div>
    </header>
  );
}
