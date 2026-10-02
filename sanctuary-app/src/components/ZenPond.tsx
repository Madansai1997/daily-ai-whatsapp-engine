import React, { useState, useRef, useEffect } from 'react';
import { Sparkles, Waves, Volume2, Trophy, Gift, Video, Coffee, Compass, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { sounds } from '../utils/soundEffects';

interface Pebble {
  id: number;
  name: string;
  type: string;
  shape: string;
  texture: string;
  shadow: string;
  note?: string;
}

const REAL_PEBBLES: Pebble[] = [
  {
    id: 1,
    name: 'Proud of Myself 💫',
    type: 'Smooth River Basalt',
    shape: 'rounded-[45%_55%_50%_50%]',
    texture: 'bg-gradient-to-br from-[#3d3835] via-[#262321] to-[#141211] border-t border-[#6e645e]/40',
    shadow: 'shadow-[#1a1715]/80',
    note: 'Showing up for yourself even when things were tough.'
  },
  {
    id: 2,
    name: 'Brain Overload 🌀',
    type: 'Blue Slate Quartz',
    shape: 'rounded-[52%_48%_45%_55%]',
    texture: 'bg-gradient-to-br from-[#3b4c60] via-[#232f3e] to-[#121922] border-t border-[#6885a8]/40',
    shadow: 'shadow-[#141e2b]/80',
    note: 'Too many tabs open in your head; dropping the chaos into the pond.'
  },
  {
    id: 3,
    name: 'Small Victory 🌟',
    type: 'Mountain Jade Mineral',
    shape: 'rounded-[50%_48%_55%_45%]',
    texture: 'bg-gradient-to-br from-[#2d4d3c] via-[#1a3326] to-[#0c1c14] border-t border-[#548a6d]/40',
    shadow: 'shadow-[#0e2118]/80',
    note: 'Acknowledged a win, finished a chore, or took a brave step.'
  },
  {
    id: 4,
    name: 'Night Escape 🌙',
    type: 'Speckled Granite Stone',
    shape: 'rounded-[48%_52%_52%_48%]',
    texture: 'bg-gradient-to-br from-[#595551] via-[#383533] to-[#1f1d1c] border-t border-[#8a837e]/40',
    shadow: 'shadow-[#262423]/80',
    note: 'Car ride breeze, terrace stars, or driving with favorite music.'
  },
  {
    id: 5,
    name: "Madan's Fault 😤",
    type: 'Volcanic Rose Pebble',
    shape: 'rounded-[55%_45%_48%_52%]',
    texture: 'bg-gradient-to-br from-[#6b2d38] via-[#451822] to-[#240b12] border-t border-[#b3576b]/50',
    shadow: 'shadow-[#380e18]/90',
    note: 'Throw it as hard as you want! Madan accepts 100% of the blame 😄'
  },
];

const STORAGE_KEY = 'sanctuary_zen_stones_count';

export const ZenPond: React.FC = () => {
  const [stoneCount, setStoneCount] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? parseInt(saved, 10) : 5;
    } catch {
      return 5;
    }
  });

  const [recentMoment, setRecentMoment] = useState<{ name: string; note?: string } | null>(null);
  const [activeMilestoneModal, setActiveMilestoneModal] = useState<{
    count: number;
    title: string;
    subtitle: string;
    reward: string;
    icon: React.ReactNode;
  } | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, stoneCount.toString());
    } catch {
      /* ignore */
    }
  }, [stoneCount]);

  // Canvas Water Physics Simulation
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let ripples: Array<{ x: number; y: number; r: number; opacity: number; speed: number }> = [];
    let animationFrameId: number;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Deep, clear blue-green pond water gradient
      const bgGrad = ctx.createRadialGradient(
        canvas.width / 2, canvas.height / 2, 20,
        canvas.width / 2, canvas.height / 2, canvas.width / 2
      );
      bgGrad.addColorStop(0, 'rgba(12, 74, 110, 0.45)');
      bgGrad.addColorStop(0.5, 'rgba(15, 23, 42, 0.7)');
      bgGrad.addColorStop(1, 'rgba(8, 12, 20, 0.95)');

      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Render & update active water ripples
      ripples.forEach((rip, index) => {
        // Outer refraction ring
        ctx.beginPath();
        ctx.arc(rip.x, rip.y, rip.r, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(186, 230, 253, ${rip.opacity * 0.85})`;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Second trailing ring
        if (rip.r > 16) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.r - 14, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(251, 191, 36, ${rip.opacity * 0.4})`;
          ctx.lineWidth = 1.2;
          ctx.stroke();
        }

        // Third inner ripple
        if (rip.r > 32) {
          ctx.beginPath();
          ctx.arc(rip.x, rip.y, rip.r - 28, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(56, 189, 248, ${rip.opacity * 0.25})`;
          ctx.lineWidth = 1;
          ctx.stroke();
        }

        rip.r += rip.speed;
        rip.opacity -= 0.011;

        if (rip.opacity <= 0) {
          ripples.splice(index, 1);
        }
      });

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    const handleCanvasClick = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // Play splash audio & haptics
      sounds.playWaterSplash();
      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
        navigator.vibrate([30, 30]);
      }

      ripples.push({ x, y, r: 6, opacity: 1, speed: 1.6 });
    };

    canvas.addEventListener('click', handleCanvasClick);

    return () => {
      cancelAnimationFrame(animationFrameId);
      canvas.removeEventListener('click', handleCanvasClick);
    };
  }, []);

  const handleDropStone = (pebble: Pebble) => {
    const newCount = stoneCount + 1;
    setStoneCount(newCount);
    setRecentMoment({ name: pebble.name, note: pebble.note });

    // Audio splash & haptics
    sounds.playWaterSplash();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([40, 50, 25]);
    }

    // Trigger visual ripple on canvas
    const canvas = canvasRef.current;
    if (canvas) {
      const event = new MouseEvent('click', {
        clientX: canvas.getBoundingClientRect().left + canvas.width / 2 + (Math.random() * 40 - 20),
        clientY: canvas.getBoundingClientRect().top + canvas.height / 2 + (Math.random() * 40 - 20)
      });
      canvas.dispatchEvent(event);
    }

    // Check for Milestone Unlocks
    if (newCount === 7) {
      triggerMilestoneCelebration(7, "7 Pebbles of Peace 🌿", "1 Week of Daily Grounding", "Madan will send a special private video celebration clip to your phone!", <Video className="w-8 h-8 text-amber-300" />);
    } else if (newCount === 14) {
      triggerMilestoneCelebration(14, "14 Pebbles of Peace ☕", "2 Weeks of Grounding", "A spontaneous coffee / favorite snack treat on Madan—redeemed whenever you want!", <Coffee className="w-8 h-8 text-rose-300" />);
    } else if (newCount === 28) {
      triggerMilestoneCelebration(28, "28th Birthday Golden Anchor 🌟", "28 Pebbles for 28 Years", "The Grand Milestone: A dedicated, relaxing celebration day with Madan with zero rush.", <Compass className="w-8 h-8 text-yellow-300" />);
    }
  };

  const triggerMilestoneCelebration = (count: number, title: string, subtitle: string, reward: string, icon: React.ReactNode) => {
    sounds.playCelebrationChime();
    try {
      confetti({
        particleCount: 80,
        spread: 90,
        origin: { y: 0.55 },
        colors: ['#fbbf24', '#f43f5e', '#38bdf8', '#10b981']
      });
    } catch {
      /* ignore */
    }
    setActiveMilestoneModal({ count, title, subtitle, reward, icon });
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-teal-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-teal-500/15 border border-teal-500/30 text-teal-300 text-xs font-mono mb-2">
              <Waves className="w-3.5 h-3.5" /> ZERO-FRICTION JOURNALING
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              The Zen Stone Pond
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-lg font-sans leading-relaxed">
              No long paragraphs or daily homework. Whenever something happens, drop a real river pebble into the water to hear the splash, feel the ripple, and celebrate milestones together.
            </p>
          </div>

          <div className="glass-pill rounded-2xl p-4 shrink-0 text-right self-start sm:self-auto">
            <div className="text-[10px] font-mono text-slate-400 uppercase">Stacked River Stones</div>
            <div className="text-2xl font-serif font-bold text-teal-300 mt-0.5">
              {stoneCount} <span className="text-xs font-sans text-slate-400 font-normal">pebbles</span>
            </div>
            <div className="text-[10px] font-mono text-amber-300/90 mt-1 flex items-center justify-end gap-1">
              <Trophy className="w-3 h-3 text-amber-400" />
              <span>Next Milestone: {stoneCount < 7 ? '7 🌿' : stoneCount < 14 ? '14 ☕' : '28 🌟'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Interactive Water Pond Canvas */}
      <div className="glass-card rounded-3xl p-6 relative overflow-hidden flex flex-col items-center border border-teal-500/30 shadow-2xl">
        <div className="w-full max-w-lg h-[280px] sm:h-[320px] rounded-3xl overflow-hidden relative border border-sky-400/30 shadow-2xl shadow-black/60">
          <canvas
            ref={canvasRef}
            width={460}
            height={320}
            className="w-full h-full cursor-pointer"
          />

          {/* Realistic Stacked Cairn in Center */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none space-y-2">
            <div className="flex flex-col items-center space-y-[-6px]">
              {/* Stack of 3 realistic stones */}
              <div className="w-7 h-4 rounded-full bg-gradient-to-br from-[#595551] to-[#262423] border-t border-white/30 shadow-lg" />
              <div className="w-11 h-6 rounded-full bg-gradient-to-br from-[#3b4c60] to-[#141e2b] border-t border-white/25 shadow-xl" />
              <div className="w-16 h-8 rounded-full bg-gradient-to-br from-[#3d3835] to-[#141211] border-t border-white/20 shadow-2xl" />
            </div>

            <span className="text-[11px] font-mono text-sky-200 bg-slate-950/80 px-3.5 py-1 rounded-full border border-sky-400/30 shadow-md backdrop-blur-md flex items-center gap-1.5">
              <Volume2 className="w-3.5 h-3.5 text-amber-400" /> Tap water or drop a stone below (Audio & Haptics ON)
            </span>
          </div>
        </div>

        {/* Recent Moment Feedback */}
        {recentMoment && (
          <div className="mt-4 px-4 py-2 rounded-2xl bg-teal-500/15 border border-teal-500/30 text-xs font-mono text-teal-200 animate-fadeIn text-center space-y-0.5 shadow-lg max-w-md">
            <div className="flex items-center justify-center gap-2 font-bold text-teal-300">
              <Sparkles className="w-3.5 h-3.5 text-teal-400" />
              Anchored: <span>{recentMoment.name}</span>
            </div>
            {recentMoment.note && (
              <p className="text-[11px] text-slate-300 font-sans italic">
                "{recentMoment.note}"
              </p>
            )}
          </div>
        )}
      </div>

      {/* Realistic Organic Pebbles Tray */}
      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <h3 className="text-xs font-mono font-bold text-slate-300 uppercase tracking-wider mb-4 flex items-center justify-between">
          <span>Choose a stone to throw into the water:</span>
          <span className="text-[10px] text-amber-400/80 font-normal">Real Audio Splash + Haptics</span>
        </h3>

        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 sm:gap-4">
          {REAL_PEBBLES.map((pebble) => (
            <button
              key={pebble.id}
              onClick={() => handleDropStone(pebble)}
              className="glass-card-hover p-4 sm:p-5 rounded-2xl border border-white/10 bg-slate-900/90 text-center cursor-pointer transition-all hover:scale-105 active:scale-95 group flex flex-col items-center justify-between min-h-[145px]"
            >
              {/* Organic 3D Textured Stone Visual */}
              <div className="relative my-auto flex items-center justify-center">
                <div className={`w-14 h-9 sm:w-16 sm:h-10 ${pebble.shape} ${pebble.texture} ${pebble.shadow} shadow-2xl relative transition-transform group-hover:rotate-6 flex items-center justify-center`}>
                  {/* Subtle stone mineral sheen */}
                  <div className="w-4 h-2 bg-white/25 rounded-full blur-[1px] transform -rotate-12" />
                </div>
              </div>

              <div className="mt-2 space-y-0.5">
                <span className="text-xs font-serif font-bold text-slate-200 block group-hover:text-amber-300 transition-colors">
                  {pebble.name}
                </span>
                <span className="text-[10px] font-mono text-slate-400 block">
                  {pebble.type}
                </span>
              </div>

              <span className="text-[10px] font-mono text-teal-400 mt-2 block opacity-0 group-hover:opacity-100 transition-opacity">
                Throw in water ↓
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Milestone Celebration Modal */}
      {activeMilestoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
          <div className="glass-card rounded-3xl max-w-md w-full p-6 sm:p-8 relative border border-amber-400/50 shadow-2xl animate-scaleUp text-center space-y-4">
            <button
              onClick={() => setActiveMilestoneModal(null)}
              className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-slate-300 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="w-16 h-16 rounded-3xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center mx-auto shadow-xl">
              {activeMilestoneModal.icon}
            </div>

            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-mono">
              <Gift className="w-3.5 h-3.5" /> MILESTONE UNLOCKED!
            </div>

            <h3 className="text-2xl font-serif font-bold text-white">
              {activeMilestoneModal.title}
            </h3>

            <p className="text-xs font-mono text-amber-300/90 uppercase tracking-wider">
              {activeMilestoneModal.subtitle}
            </p>

            <div className="p-4 rounded-2xl bg-slate-900/80 border border-white/10 text-xs font-serif text-slate-200 leading-relaxed italic">
              "{activeMilestoneModal.reward}"
            </div>

            <button
              onClick={() => setActiveMilestoneModal(null)}
              className="w-full py-3 rounded-xl text-xs font-mono font-bold bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950 hover:scale-105 active:scale-95 cursor-pointer shadow-lg"
            >
              Celebrate & Keep Going ✨
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
