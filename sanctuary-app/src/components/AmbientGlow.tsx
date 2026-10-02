import React, { useState, useEffect, useRef } from 'react';
import { Sparkles, Sun, Moon, Sunset, Heart, Smartphone, Bell } from 'lucide-react';
import { sounds } from '../utils/soundEffects';

export const AmbientGlow: React.FC = () => {
  const [isPressing, setIsPressing] = useState(false);
  const [pressProgress, setPressProgress] = useState(0);
  const [hasSentFlare, setHasSentFlare] = useState(false);
  const [timeVibe, setTimeVibe] = useState<'dawn' | 'day' | 'golden' | 'night'>('golden');
  const [showInstallGuide, setShowInstallGuide] = useState(false);
  const [warmthActive, setWarmthActive] = useState(false);
  const [warmthMsg, setWarmthMsg] = useState('Always in your corner 💛');

  const progressIntervalRef = useRef<number | null>(null);

  const BACKEND_URL = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? ''
    : 'https://daily-ai-whatsapp-engine.onrender.com';

  // Fetch live warmth status from Madan
  const checkSanctuaryStatus = async () => {
    try {
      const res = await fetch(`${BACKEND_URL}/api/sanctuary/status`);
      if (res.ok) {
        const data = await res.json();
        if (data.warmth_active) {
          setWarmthActive(true);
          if (data.warmth_message) setWarmthMsg(data.warmth_message);
        }
      }
    } catch {
      // Offline / standalone fallback
    }
  };

  useEffect(() => {
    const hour = new Date().getHours();
    if (hour >= 5 && hour < 9) setTimeVibe('dawn');
    else if (hour >= 9 && hour < 16) setTimeVibe('day');
    else if (hour >= 16 && hour < 19) setTimeVibe('golden');
    else setTimeVibe('night');

    checkSanctuaryStatus();
    const interval = setInterval(checkSanctuaryStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleStartPress = () => {
    if (hasSentFlare) return;
    setIsPressing(true);
    setPressProgress(0);

    // Audio pulse
    sounds.playHeartbeat();

    const startTime = Date.now();
    progressIntervalRef.current = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const progress = Math.min(100, (elapsed / 1000) * 100);
      setPressProgress(progress);
      if (progress >= 100) {
        handleTriggerFlare();
      }
    }, 20);
  };

  const handleEndPress = () => {
    setIsPressing(false);
    setPressProgress(0);
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
  };

  const handleTriggerFlare = async () => {
    if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    setIsPressing(false);
    setPressProgress(100);
    setHasSentFlare(true);

    // Heartbeat Audio & Synced Haptics
    sounds.playHeartbeat();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([60, 40, 60, 40, 100]);
    }

    // Dispatch pulse to backend to ping Madan's phone
    try {
      await fetch(`${BACKEND_URL}/api/sanctuary/pulse`, { method: 'POST' });
    } catch {
      // Offline / standalone fallback
    }

    setTimeout(() => {
      setHasSentFlare(false);
      setPressProgress(0);
    }, 7000);
  };

  const getVibeStyles = () => {
    switch (timeVibe) {
      case 'dawn':
        return {
          bgGradient: 'from-amber-500/20 via-rose-500/20 to-sky-500/20',
          orbGradient: 'from-amber-300 via-rose-300 to-sky-300',
          glowShadow: 'shadow-amber-400/30',
          title: 'Dewy Morning Vibe',
          icon: <Sun className="w-4 h-4 text-amber-300" />,
          quote: 'The world is quiet. Take this morning softly.'
        };
      case 'day':
        return {
          bgGradient: 'from-sky-500/20 via-cyan-500/20 to-emerald-500/20',
          orbGradient: 'from-sky-300 via-cyan-300 to-emerald-300',
          glowShadow: 'shadow-sky-400/30',
          title: 'Midday Sunlight',
          icon: <Sun className="w-4 h-4 text-sky-300" />,
          quote: 'Remember to look up from the screen and take a deep breath.'
        };
      case 'golden':
        return {
          bgGradient: 'from-amber-600/25 via-rose-500/25 to-purple-600/25',
          orbGradient: 'from-amber-400 via-rose-400 to-purple-400',
          glowShadow: 'shadow-amber-500/40',
          title: 'Golden Hour Glow',
          icon: <Sunset className="w-4 h-4 text-amber-400" />,
          quote: 'Soft light, crisp breeze. The day’s heavy lifting is almost done.'
        };
      case 'night':
        return {
          bgGradient: 'from-indigo-600/25 via-purple-600/25 to-slate-900/40',
          orbGradient: 'from-indigo-400 via-purple-400 to-sky-400',
          glowShadow: 'shadow-indigo-500/30',
          title: 'Midnight Indigo',
          icon: <Moon className="w-4 h-4 text-indigo-300" />,
          quote: 'You survived today. Let your thoughts unwind and rest.'
        };
    }
  };

  const vibe = getVibeStyles();

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        <div className={`absolute inset-0 bg-gradient-to-br ${vibe.bgGradient} blur-3xl opacity-40 pointer-events-none`} />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/15 text-slate-200 text-xs font-mono mb-2">
              {vibe.icon} {vibe.title}
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              The Ambient Glow
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-lg font-sans leading-relaxed">
              Your 1-second silent anchor. When you press this, a silent notification is sent to Madan with zero words required. You are never alone in this.
            </p>
          </div>

          {/* Quick Install to Homescreen Button */}
          <button
            onClick={() => setShowInstallGuide(true)}
            className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-amber-400/20 hover:bg-amber-400/30 border border-amber-400/40 text-amber-300 text-xs font-mono font-bold transition-all cursor-pointer shadow-md shrink-0 self-start sm:self-auto"
          >
            <Smartphone className="w-4 h-4" />
            <span>Install on Home Screen</span>
          </button>
        </div>
      </div>

      {/* Main Interactive Orb Stage */}
      <div className="glass-card rounded-3xl p-8 sm:p-12 flex flex-col items-center justify-center text-center relative overflow-hidden min-h-[380px]">
        <p className="text-xs sm:text-sm font-serif italic text-slate-300 max-w-md mb-8">
          "{vibe.quote}"
        </p>

        {/* The Glowing Interactive Orb */}
        <div className="relative flex items-center justify-center">
          <div
            className={`absolute rounded-full transition-all duration-700 pointer-events-none ${hasSentFlare
              ? 'w-72 h-72 bg-gradient-to-r ' + vibe.bgGradient + ' animate-ping opacity-70'
              : isPressing
                ? 'w-64 h-64 bg-white/10 animate-pulse'
                : 'w-48 h-48 bg-white/5'
              }`}
          />

          <button
            onMouseDown={handleStartPress}
            onMouseUp={handleEndPress}
            onTouchStart={handleStartPress}
            onTouchEnd={handleEndPress}
            className={`w-36 h-36 sm:w-44 sm:h-44 rounded-full relative z-10 flex flex-col items-center justify-center transition-all duration-300 cursor-pointer shadow-2xl ${vibe.glowShadow
              } ${hasSentFlare
                ? 'bg-gradient-to-br from-emerald-400 to-teal-500 scale-105 ring-4 ring-emerald-400/50'
                : isPressing
                  ? 'bg-gradient-to-br ' + vibe.orbGradient + ' scale-95 ring-4 ring-white/40'
                  : 'bg-gradient-to-br ' + vibe.orbGradient + ' hover:scale-105'
              }`}
          >
            {hasSentFlare ? (
              <div className="space-y-1 animate-scaleUp">
                <Heart className="w-8 h-8 text-white mx-auto fill-white animate-pulse" />
                <span className="text-[11px] font-mono font-bold text-white uppercase tracking-wider block">
                  Pulse Synced 🔔
                </span>
              </div>
            ) : isPressing ? (
              <div className="space-y-1">
                <div className="text-xl font-bold font-mono text-slate-900">
                  {Math.round(pressProgress)}%
                </div>
                <span className="text-[10px] font-mono text-slate-800 font-semibold uppercase">
                  Hold for 1s
                </span>
              </div>
            ) : (
              <div className="space-y-1 text-slate-900">
                <Sparkles className="w-7 h-7 mx-auto animate-pulse" />
                <span className="text-xs font-serif font-bold uppercase tracking-wider block">
                  Hold 1 Sec
                </span>
              </div>
            )}
          </button>
        </div>

        {/* Status & Connection Feedback */}
        <div className="mt-8 space-y-3">
          {warmthActive && !hasSentFlare && (
            <div className="p-3.5 rounded-2xl bg-amber-500/20 border border-amber-400/50 text-xs font-serif text-amber-200 animate-scaleUp flex items-center justify-center gap-2 shadow-lg">
              <Heart className="w-4 h-4 text-rose-400 fill-rose-400 animate-pulse" />
              <span>Madan received your pulse & sent warmth back • "{warmthMsg}"</span>
            </div>
          )}

          {hasSentFlare ? (
            <div className="space-y-2 animate-fadeIn">
              <div className="inline-flex items-center gap-2 px-4 py-2 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-200 text-xs font-mono shadow-lg">
                <Bell className="w-4 h-4 text-amber-300 animate-bounce" />
                <span>Notification sent to Madan's phone • Pulse synced</span>
              </div>
              <p className="text-xs font-serif italic text-slate-300">
                "You are never carrying this alone. Breathe."
              </p>
            </div>
          ) : (
            <p className="text-xs font-mono text-slate-400">
              {isPressing ? 'Holding... feeling heartbeat haptics' : 'Press & hold the glowing orb for 1s to send an instant silent signal to Madan.'}
            </p>
          )}
        </div>
      </div>

      {/* Home Screen Installation Guide Modal */}
      {showInstallGuide && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="glass-card rounded-3xl max-w-md w-full p-6 sm:p-8 relative border border-amber-400/30 shadow-2xl animate-scaleUp">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono mb-3">
              <Smartphone className="w-3.5 h-3.5" /> MOBILE HOMESCREEN SETUP
            </div>

            <h3 className="text-xl font-serif font-bold text-white mb-2">
              Add Haven to Your Home Screen
            </h3>
            <p className="text-xs text-slate-300 mb-4 font-sans leading-relaxed">
              Install this app directly onto your iPhone or Android so you can open your Glow and Zen Pond with a single tap like a native app.
            </p>

            <div className="space-y-3 bg-slate-900/80 p-4 rounded-2xl border border-white/10 text-xs font-sans text-slate-200">
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-300 font-mono font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">1</span>
                <span>On iPhone (Safari): Tap the <b>Share Button</b> at the bottom. On Android (Chrome): Tap the <b>three dots (⋮)</b> in top right.</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-300 font-mono font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">2</span>
                <span>Scroll down and tap <b>"Add to Home Screen"</b> (or "Install App").</span>
              </div>
              <div className="flex items-start gap-2.5">
                <span className="w-5 h-5 rounded-full bg-amber-400/20 text-amber-300 font-mono font-bold flex items-center justify-center text-[10px] shrink-0 mt-0.5">3</span>
                <span>Tap <b>Add</b>. The golden Haven icon will appear on your phone screen!</span>
              </div>
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setShowInstallGuide(false)}
                className="px-5 py-2 rounded-xl text-xs font-mono font-bold bg-amber-400/20 border border-amber-400/40 text-amber-300 hover:bg-amber-400/30 cursor-pointer"
              >
                Got It ✨
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
