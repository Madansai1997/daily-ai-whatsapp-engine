import React, { useState } from 'react';
import { Header } from './components/Header';
import { BottomNav } from './components/BottomNav';
import type { TabType } from './components/BottomNav';
import { BirthdayExperience } from './components/BirthdayExperience';
import { MindUnfurl } from './components/MindUnfurl';
import { AmbientGlow } from './components/AmbientGlow';
import { SecretCompass } from './components/SecretCompass';
import { BrainDump } from './components/BrainDump';
import { ZenPond } from './components/ZenPond';
import { CelebrationBalloons } from './components/CelebrationBalloons';

export const App: React.FC = () => {
  const [showBirthdayExperience, setShowBirthdayExperience] = useState<boolean>(true);
  const [activeTab, setActiveTab] = useState<TabType>('unfurl');

  const handleCompleteBirthdayExperience = () => {
    setShowBirthdayExperience(false);
  };

  return (
    <div className="min-h-screen bg-[#0d1322] text-slate-100 flex flex-col selection:bg-amber-500/30 selection:text-amber-200 relative overflow-x-hidden">
      {/* Dynamic Celebration Floating Balloons & Golden Bokeh Lights */}
      <CelebrationBalloons />

      {/* Warm Celebratory Ambient Lighting Orbs */}
      <div className="fixed top-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-br from-amber-500/15 via-rose-500/10 to-transparent blur-[140px] pointer-events-none" />
      <div className="fixed bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-gradient-to-tl from-sky-500/15 via-purple-500/10 to-transparent blur-[140px] pointer-events-none" />
      <div className="fixed top-[40%] left-[30%] w-[400px] h-[400px] rounded-full bg-amber-400/8 blur-[160px] pointer-events-none" />

      {/* Header */}
      <Header />

      {/* Main Container */}
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 sm:px-8 pt-6 pb-28 relative z-10">
        {showBirthdayExperience ? (
          <BirthdayExperience onComplete={handleCompleteBirthdayExperience} />
        ) : (
          <>
            {activeTab === 'unfurl' && <MindUnfurl />}
            {activeTab === 'glow' && <AmbientGlow />}
            {activeTab === 'compass' && <SecretCompass />}
            {activeTab === 'dump' && <BrainDump />}
            {activeTab === 'pond' && <ZenPond />}
          </>
        )}
      </main>

      {/* Floating Bottom Navigation */}
      {!showBirthdayExperience && (
        <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
      )}
    </div>
  );
};

export default App;
