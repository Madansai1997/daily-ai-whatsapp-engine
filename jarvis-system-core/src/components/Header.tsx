import React, { useState, useEffect } from "react";
import { ScreenId } from "../types";
import { Search, Bell, Settings } from "lucide-react";

interface HeaderProps {
  activeScreen: ScreenId;
  onNavigate: (screen: ScreenId) => void;
}

export default function Header({ activeScreen, onNavigate }: HeaderProps) {
  const [temperature, setTemperature] = useState(38);

  // Fluctuating temperature to simulate live system telemetry
  useEffect(() => {
    const interval = setInterval(() => {
      const offset = Math.random() > 0.5 ? 1 : -1;
      setTemperature((prev) => {
        const next = prev + offset;
        return next >= 36 && next <= 40 ? next : prev;
      });
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="fixed top-0 left-0 w-full z-50 bg-[#0f131f]/40 backdrop-blur-md border-b border-white/10 h-16">
      <div className="flex justify-between items-center w-full px-8 max-w-full mx-auto h-full">
        <div className="flex items-center gap-8">
          <h1 className="text-2xl font-bold tracking-tighter text-[#8aebff] font-mono glow-cyan">
            {temperature}°C
          </h1>
          <nav className="hidden md:flex items-center gap-8">
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(ScreenId.Core);
              }}
              className={`transition-colors duration-200 font-medium tracking-wide uppercase text-sm ${
                activeScreen === ScreenId.Core
                  ? "text-[#8aebff] font-bold border-b-2 border-[#8aebff] pb-1 nav-active-glow"
                  : "text-[#bbc9cd] hover:text-[#8aebff]"
              }`}
            >
              CORE
            </a>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(ScreenId.Assistant);
              }}
              className={`transition-colors duration-200 font-medium tracking-wide uppercase text-sm ${
                activeScreen === ScreenId.Assistant
                  ? "text-[#8aebff] font-bold border-b-2 border-[#8aebff] pb-1 nav-active-glow"
                  : "text-[#bbc9cd] hover:text-[#8aebff]"
              }`}
            >
              JARVIS
            </a>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(ScreenId.Chat);
              }}
              className={`transition-colors duration-200 font-medium tracking-wide uppercase text-sm ${
                activeScreen === ScreenId.Chat
                  ? "text-[#8aebff] font-bold border-b-2 border-[#8aebff] pb-1 nav-active-glow"
                  : "text-[#bbc9cd] hover:text-[#8aebff]"
              }`}
            >
              PRIVACHAT
            </a>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(ScreenId.Terminal);
              }}
              className={`transition-colors duration-200 font-medium tracking-wide uppercase text-sm ${
                activeScreen === ScreenId.Terminal
                  ? "text-[#8aebff] font-bold border-b-2 border-[#8aebff] pb-1 nav-active-glow"
                  : "text-[#bbc9cd] hover:text-[#8aebff]"
              }`}
            >
              TERMINAL
            </a>
            <a
              href="#"
              onClick={(e) => {
                e.preventDefault();
                onNavigate(ScreenId.Jobs);
              }}
              className={`transition-colors duration-200 font-medium tracking-wide uppercase text-sm ${
                activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis
                  ? "text-[#8aebff] font-bold border-b-2 border-[#8aebff] pb-1 nav-active-glow"
                  : "text-[#bbc9cd] hover:text-[#8aebff]"
              }`}
            >
              JOBS
            </a>
          </nav>
        </div>

        <div className="flex items-center gap-6">
          {/* Search bar simulation */}
          <div className="hidden sm:flex items-center gap-2 bg-[#1b1f2c]/50 px-4 py-1.5 border border-white/10 rounded-full transition-all hover:border-[#8aebff]/50">
            <Search className="w-4.5 h-4.5 text-[#8aebff]" />
            <span className="text-[13px] font-mono text-[#859397]">Search protocols...</span>
          </div>

          <button className="text-[#bbc9cd] hover:text-[#8aebff] transition-colors p-1" title="System Logs">
            <Bell className="w-5 h-5" />
          </button>
          <button className="text-[#bbc9cd] hover:text-[#8aebff] transition-colors p-1" title="Core Controls">
            <Settings className="w-5 h-5" />
          </button>

          {/* User profile picture */}
          <div className="w-8 h-8 rounded-full border border-[#8aebff]/30 bg-[#1b1f2c] overflow-hidden">
            <img
              alt="User Profile"
              className="w-full h-full object-cover"
              src="https://lh3.googleusercontent.com/aida-public/AB6AXuDNBP3GhXQ5gqyG1y9bnWrvfGSbYpizT8JXGWFRxIGWx4ShIcBdZxDlREByTy_ihjQ3n__If2sSVlBBr-MrbwItikPOoojPkwvvuNtrrYRsueQf2GuwnCHY_eTNdATCmmPWKJiEW_OdNR7ZthmJyC6k9JTrTFZUffTuVXp3VWLxbgwROjjbt4ML1ohKOpFmxa-jNETDLiJj0fZdHKGyLvtkhi6uclYfCbJRR94BlpFt9f5LQRVpXv4Iu3hQ2c9JrY7MXfM9s-w9ljaT"
            />
          </div>
        </div>
      </div>
    </header>
  );
}
