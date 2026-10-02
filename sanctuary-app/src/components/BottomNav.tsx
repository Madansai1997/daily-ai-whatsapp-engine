import React from 'react';
import { Sparkles, Sun, Compass, Brain, Waves } from 'lucide-react';

export type TabType = 'unfurl' | 'glow' | 'compass' | 'dump' | 'pond';

interface BottomNavProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({ activeTab, onSelectTab }) => {
  const tabs = [
    { id: 'unfurl' as TabType, label: 'Unfurl', icon: Sparkles, color: 'text-amber-400' },
    { id: 'glow' as TabType, label: 'Glow', icon: Sun, color: 'text-rose-400' },
    { id: 'compass' as TabType, label: 'Compass', icon: Compass, color: 'text-emerald-400' },
    { id: 'dump' as TabType, label: 'Unload', icon: Brain, color: 'text-sky-400' },
    { id: 'pond' as TabType, label: 'Pond', icon: Waves, color: 'text-teal-400' },
  ];

  return (
    <nav className="fixed bottom-3 sm:bottom-6 inset-x-0 z-40 px-4 flex justify-center pointer-events-none">
      <div className="glass-card rounded-3xl p-1.5 sm:p-2 border border-white/15 shadow-2xl flex items-center gap-1 sm:gap-2 pointer-events-auto backdrop-blur-2xl bg-[#0a0e17]/90 max-w-md w-full justify-between">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;

          return (
            <button
              key={tab.id}
              onClick={() => onSelectTab(tab.id)}
              className={`flex-1 py-2 px-1 sm:px-2 rounded-2xl flex flex-col items-center justify-center gap-1 transition-all duration-300 cursor-pointer ${
                isActive
                  ? 'bg-white/10 shadow-inner border border-white/15'
                  : 'hover:bg-white/5 opacity-60 hover:opacity-100'
              }`}
            >
              <Icon className={`w-4 h-4 sm:w-5 sm:h-5 ${isActive ? tab.color : 'text-slate-400'}`} />
              <span className={`text-[10px] font-mono tracking-tight font-medium ${
                isActive ? 'text-white' : 'text-slate-400'
              }`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
