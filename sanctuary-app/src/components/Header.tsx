import React from 'react';
import { Sparkles } from 'lucide-react';

export const Header: React.FC = () => {
  return (
    <header className="sticky top-0 z-40 backdrop-blur-xl bg-[#080b11]/80 border-b border-white/10 px-4 sm:px-8 py-3.5 transition-all">
      <div className="max-w-5xl mx-auto flex items-center justify-between gap-3">
        {/* Brand / Title */}
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-2xl bg-gradient-to-br from-amber-400 via-rose-400 to-sky-400 p-[1px] shadow-lg shadow-amber-500/10">
            <div className="w-full h-full bg-[#0d121c] rounded-2xl flex items-center justify-center text-amber-300">
              <Sparkles className="w-4 h-4 animate-pulse" />
            </div>
          </div>

          <div>
            <h1 className="text-base font-serif font-bold text-white tracking-tight flex items-center gap-2">
              Haven
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-300 border border-amber-400/30">
                OCT 3 • 28TH
              </span>
            </h1>
            <p className="text-[10px] text-slate-400 font-mono">A Private Space For You</p>
          </div>
        </div>
      </div>
    </header>
  );
};


