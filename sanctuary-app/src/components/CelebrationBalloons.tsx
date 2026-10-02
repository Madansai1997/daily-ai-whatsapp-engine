import React from 'react';

export const CelebrationBalloons: React.FC = () => {
  const balloons = [
    { id: 1, left: '4%', size: 'w-12 h-16 sm:w-16 sm:h-20', color: 'from-amber-300 via-amber-400 to-amber-600', delay: '0s', duration: '15s', drift: 'translate-x-2' },
    { id: 2, left: '16%', size: 'w-10 h-14 sm:w-13 sm:h-17', color: 'from-rose-300 via-rose-400 to-pink-600', delay: '3.5s', duration: '18s', drift: '-translate-x-3' },
    { id: 3, left: '28%', size: 'w-14 h-18 sm:w-18 sm:h-24', color: 'from-yellow-200 via-amber-300 to-orange-400', delay: '7s', duration: '20s', drift: 'translate-x-4' },
    { id: 4, left: '44%', size: 'w-11 h-15 sm:w-14 sm:h-19', color: 'from-sky-300 via-sky-400 to-blue-500', delay: '2s', duration: '16s', drift: '-translate-x-2' },
    { id: 5, left: '60%', size: 'w-13 h-17 sm:w-16 sm:h-21', color: 'from-purple-300 via-purple-400 to-indigo-500', delay: '5.5s', duration: '19s', drift: 'translate-x-3' },
    { id: 6, left: '74%', size: 'w-10 h-14 sm:w-13 sm:h-18', color: 'from-rose-300 via-pink-400 to-rose-600', delay: '1s', duration: '14s', drift: '-translate-x-4' },
    { id: 7, left: '88%', size: 'w-14 h-18 sm:w-17 sm:h-22', color: 'from-amber-300 via-orange-400 to-amber-600', delay: '8s', duration: '21s', drift: 'translate-x-2' },
    { id: 8, left: '95%', size: 'w-9 h-12 sm:w-12 sm:h-15', color: 'from-teal-300 via-emerald-400 to-teal-600', delay: '4s', duration: '17s', drift: '-translate-x-1' },
  ];

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {/* Celebration Festive Floating Balloons */}
      {balloons.map((b) => (
        <div
          key={b.id}
          className={`absolute bottom-[-120px] flex flex-col items-center animate-floatBalloon opacity-70 hover:opacity-100 transition-opacity ${b.drift}`}
          style={{
            left: b.left,
            animationDelay: b.delay,
            animationDuration: b.duration,
          }}
        >
          {/* Balloon Bulb with 3D Gloss Highlight */}
          <div className={`${b.size} rounded-[50%_50%_50%_50%/55%_55%_45%_45%] bg-gradient-to-br ${b.color} shadow-xl shadow-black/40 relative overflow-hidden flex items-center justify-center border border-white/30`}>
            {/* Gloss shine highlight */}
            <div className="absolute top-2 left-2.5 w-3.5 h-6 bg-white/50 rounded-full blur-[1px] transform -rotate-25" />
            <div className="absolute bottom-1 w-2.5 h-1.5 bg-black/25 rounded-full" />
          </div>

          {/* Balloon Tie Knot */}
          <div className="w-2 h-1.5 bg-amber-800/90 rounded-sm mt-[-1px] shadow-sm" />

          {/* Balloon Curving String */}
          <div className="w-[1.5px] h-20 sm:h-28 bg-gradient-to-b from-slate-300/60 via-slate-400/40 to-transparent" />
        </div>
      ))}

      {/* Celebratory Golden & Rose Sparkle Lights */}
      <div className="absolute top-12 left-12 w-2.5 h-2.5 rounded-full bg-amber-300 animate-ping opacity-80" />
      <div className="absolute top-1/4 right-20 w-3 h-3 rounded-full bg-rose-300 animate-pulse opacity-70" />
      <div className="absolute top-2/3 left-16 w-3 h-3 rounded-full bg-sky-300 animate-ping opacity-60" />
      <div className="absolute top-1/2 right-1/3 w-2.5 h-2.5 rounded-full bg-amber-400 animate-pulse opacity-80" />
      <div className="absolute bottom-24 right-12 w-3.5 h-3.5 rounded-full bg-yellow-300 animate-ping opacity-75" />
    </div>
  );
};
