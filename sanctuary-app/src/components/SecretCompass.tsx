import React, { useState } from 'react';
import { Compass, Dices, MapPin, Trees, CheckCircle2, Lock } from 'lucide-react';
import confetti from 'canvas-confetti';

interface MicroMission {
  id: number;
  icon: string;
  title: string;
  duration: string;
  description: string;
  tip: string;
}

const MICRO_MISSIONS: MicroMission[] = [
  {
    id: 1,
    icon: '🌿',
    title: 'The Blooming Canopy Quest',
    duration: '3 mins',
    description: 'Turn in the direction of the wind and walk until you spot the prettiest tree or green leaf.',
    tip: 'Look closely at the leaf veins for 10 seconds. Nature never rushes.'
  },
  {
    id: 2,
    icon: '☕',
    title: 'The Quietest Bench',
    duration: '5 mins',
    description: 'Find a bench or curb in the shade, sit down, and listen for 3 distinct natural sounds.',
    tip: 'No phone checking while sitting. Just letting your thoughts drift.'
  },
  {
    id: 3,
    icon: '🌤️',
    title: 'The 60-Second Sunbath',
    duration: '2 mins',
    description: 'Find a patch of sunlight on your face, close your eyes, and take 3 deep, slow breaths.',
    tip: 'Feel the temperature on your eyelids. Instant serotonin boost.'
  },
  {
    id: 4,
    icon: '🐕',
    title: 'The Street Vibe Patrol',
    duration: '4 mins',
    description: 'Walk around one single block and spot either a happy dog, a cool door color, or a cozy bakery smell.',
    tip: 'Small everyday details are where the real magic hides.'
  },
  {
    id: 5,
    icon: '🕊️',
    title: 'The Slow-Motion Stroll',
    duration: '3 mins',
    description: 'Walk at half your normal speed for 100 paces. Let everyone else rush past.',
    tip: 'Walking slow is the ultimate rebellion against a frantic world.'
  }
];

interface GeocacheNote {
  id: number;
  placeName: string;
  hint: string;
  unlocked: boolean;
  message: string;
}

export const SecretCompass: React.FC = () => {
  const [currentMission, setCurrentMission] = useState<MicroMission>(MICRO_MISSIONS[0]);
  const [isRolling, setIsRolling] = useState(false);
  const [geocaches, setGeocaches] = useState<GeocacheNote[]>([
    {
      id: 1,
      placeName: 'The Shaded Park Bench',
      hint: 'Near a canopy of trees where birds gather',
      unlocked: true,
      message: 'Take a deep breath here. You are carrying so much, but you are doing wonderfully. Sit as long as you want.'
    },
    {
      id: 2,
      placeName: 'The Morning Coffee Corner',
      hint: 'Where the smell of roasted espresso beans meets the morning air',
      unlocked: false,
      message: 'Hope you got your favorite iced drink today. Take that first sip with your eyes closed.'
    },
    {
      id: 3,
      placeName: 'The Sunset Overlook / High Ground',
      hint: 'Where the evening sky turns peach and orange',
      unlocked: false,
      message: 'Look at the horizon. Whatever happened today is officially over. Tomorrow is a clean, open page.'
    }
  ]);

  const [activeGeocache, setActiveGeocache] = useState<GeocacheNote | null>(null);

  const handleRollDice = () => {
    setIsRolling(true);
    setTimeout(() => {
      const nextIndex = Math.floor(Math.random() * MICRO_MISSIONS.length);
      setCurrentMission(MICRO_MISSIONS[nextIndex]);
      setIsRolling(false);
      try {
        confetti({
          particleCount: 20,
          spread: 40,
          origin: { y: 0.8 },
          colors: ['#10b981', '#38bdf8', '#fbbf24']
        });
      } catch {
        /* ignore */
      }
    }, 400);
  };

  const handleUnlockGeocache = (id: number) => {
    setGeocaches((prev) =>
      prev.map((g) => (g.id === id ? { ...g, unlocked: true } : g))
    );
    const item = geocaches.find((g) => g.id === id);
    if (item) setActiveGeocache({ ...item, unlocked: true });
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-mono mb-2">
              <Compass className="w-3.5 h-3.5 animate-spin" /> POCKET OUTDOOR ESCAPE
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              The Secret Compass
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-lg font-sans leading-relaxed">
              Designed for your love of walking and quiet spaces. Roll the walk dice for instant micro-missions or discover hidden notes dropped around town.
            </p>
          </div>

          <div className="glass-pill rounded-2xl p-3 px-4 shrink-0 text-right self-start sm:self-auto">
            <div className="text-[10px] font-mono text-slate-400 uppercase">Current Vibe</div>
            <div className="text-sm font-bold font-mono text-emerald-300 flex items-center gap-1.5 mt-0.5">
              <Trees className="w-4 h-4" /> 22°C • Soft Breeze
            </div>
          </div>
        </div>
      </div>

      {/* Feature 1: The Micro-Walk Dice */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 border border-emerald-500/20 relative">
        <div className="flex items-center justify-between gap-4 mb-4 border-b border-white/10 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-emerald-500/15 text-emerald-400">
              <Dices className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base sm:text-lg font-serif font-bold text-white">
                The Micro-Walk Dice
              </h3>
              <p className="text-xs text-slate-400 font-sans">
                When your brain is fried, tap to get a 2-minute spontaneous outdoor mission.
              </p>
            </div>
          </div>

          <button
            onClick={handleRollDice}
            disabled={isRolling}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/30 transition-all cursor-pointer shadow-md shrink-0"
          >
            <Dices className={`w-4 h-4 ${isRolling ? 'animate-spin' : ''}`} />
            Roll Dice 🎲
          </button>
        </div>

        <div className="bg-slate-900/80 rounded-2xl p-5 border border-white/10 relative overflow-hidden">
          <div className="flex items-start justify-between gap-3">
            <div className="text-3xl">{currentMission.icon}</div>
            <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-[10px] font-mono text-emerald-300">
              ⏱️ {currentMission.duration}
            </span>
          </div>

          <h4 className="text-lg font-serif font-bold text-white mt-3">
            {currentMission.title}
          </h4>
          <p className="text-xs sm:text-sm text-slate-200 mt-1 leading-relaxed">
            {currentMission.description}
          </p>

          <div className="mt-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/20 text-xs font-serif italic text-emerald-200">
            💡 {currentMission.tip}
          </div>
        </div>
      </div>

      {/* Feature 2: Secret Geocache Notes */}
      <div className="glass-card rounded-3xl p-6 sm:p-8">
        <div className="flex items-center gap-2.5 mb-4">
          <div className="p-2 rounded-xl bg-amber-500/15 text-amber-400">
            <MapPin className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base sm:text-lg font-serif font-bold text-white">
              Secret Geocache Notes
            </h3>
            <p className="text-xs text-slate-400 font-sans">
              Notes dropped around town that unlock when you visit or feel like exploring.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mt-4">
          {geocaches.map((geo) => (
            <div
              key={geo.id}
              className={`p-4 rounded-2xl border transition-all ${
                geo.unlocked
                  ? 'bg-slate-900/80 border-amber-500/30 shadow-lg'
                  : 'bg-white/5 border-white/10 opacity-75'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-slate-400">Spot #{geo.id}</span>
                {geo.unlocked ? (
                  <CheckCircle2 className="w-4 h-4 text-amber-400" />
                ) : (
                  <Lock className="w-3.5 h-3.5 text-slate-500" />
                )}
              </div>

              <h4 className="text-sm font-serif font-bold text-white">{geo.placeName}</h4>
              <p className="text-[11px] text-slate-400 mt-1 font-sans">{geo.hint}</p>

              <div className="mt-4 pt-2 border-t border-white/5">
                {geo.unlocked ? (
                  <button
                    onClick={() => setActiveGeocache(geo)}
                    className="text-xs font-mono font-semibold text-amber-400 hover:text-amber-300 cursor-pointer"
                  >
                    Read Secret Note →
                  </button>
                ) : (
                  <button
                    onClick={() => handleUnlockGeocache(geo.id)}
                    className="text-xs font-mono text-slate-400 hover:text-white cursor-pointer"
                  >
                    Tap to Unlock ✨
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Geocache Note Modal */}
      {activeGeocache && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="glass-card rounded-3xl max-w-md w-full p-6 sm:p-8 relative border border-amber-500/40 animate-scaleUp">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono mb-3">
              <MapPin className="w-3.5 h-3.5" /> {activeGeocache.placeName}
            </div>

            <h3 className="text-xl font-serif font-bold text-white mb-3">
              A Quiet Note For You
            </h3>

            <p className="text-sm text-slate-200 font-serif italic leading-relaxed py-3 border-t border-b border-white/10">
              "{activeGeocache.message}"
            </p>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setActiveGeocache(null)}
                className="px-4 py-2 rounded-xl text-xs font-mono font-semibold bg-white/10 hover:bg-white/15 text-white cursor-pointer"
              >
                Close & Breathe
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
