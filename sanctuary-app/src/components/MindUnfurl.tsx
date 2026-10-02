import React, { useState, useEffect } from 'react';
import { Sparkles, Heart, Compass, Feather, Sun, CheckCircle2, X } from 'lucide-react';
import confetti from 'canvas-confetti';
import { UNFURL_PIECES } from '../data/unfurlPieces';
import type { UnfurlPiece } from '../data/unfurlPieces';

const STORAGE_KEY = 'sanctuary_unfurl_unlocked_ids';

export const MindUnfurl: React.FC = () => {
  const [unlockedIds, setUnlockedIds] = useState<number[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? JSON.parse(saved) : [1]; // Start with #1 unlocked
    } catch {
      return [1];
    }
  });

  const [activePiece, setActivePiece] = useState<UnfurlPiece | null>(null);
  const [filterTheme, setFilterTheme] = useState<string>('all');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(unlockedIds));
    } catch {
      /* ignore */
    }
  }, [unlockedIds]);

  const handleOpenPiece = (piece: UnfurlPiece) => {
    setActivePiece(piece);
    if (!unlockedIds.includes(piece.id)) {
      setUnlockedIds((prev) => [...prev, piece.id]);
      try {
        confetti({
          particleCount: 35,
          spread: 60,
          origin: { y: 0.7 },
          colors: ['#fbbf24', '#f43f5e', '#38bdf8', '#10b981', '#fb923c']
        });
      } catch {
        /* ignore */
      }
    }
  };

  const filteredPieces = filterTheme === 'all'
    ? UNFURL_PIECES
    : UNFURL_PIECES.filter((p) => p.theme === filterTheme);

  const getThemeIcon = (theme: UnfurlPiece['theme']) => {
    switch (theme) {
      case 'calm': return <Feather className="w-3.5 h-3.5 text-sky-400" />;
      case 'outdoor': return <Compass className="w-3.5 h-3.5 text-emerald-400" />;
      case 'growth': return <Sun className="w-3.5 h-3.5 text-amber-400" />;
      case 'friendship': return <Heart className="w-3.5 h-3.5 text-rose-400" />;
      case 'gratitude': return <Sparkles className="w-3.5 h-3.5 text-purple-400" />;
    }
  };

  const getThemeBadgeColor = (theme: UnfurlPiece['theme']) => {
    switch (theme) {
      case 'calm': return 'bg-sky-500/15 border-sky-500/30 text-sky-300';
      case 'outdoor': return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-300';
      case 'growth': return 'bg-amber-500/15 border-amber-500/30 text-amber-300';
      case 'friendship': return 'bg-rose-500/15 border-rose-500/30 text-rose-300';
      case 'gratitude': return 'bg-purple-500/15 border-purple-500/30 text-purple-300';
    }
  };

  const progressPercent = Math.round((unlockedIds.length / UNFURL_PIECES.length) * 100);

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header Card */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-64 h-64 bg-rose-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono mb-2">
              <Sparkles className="w-3.5 h-3.5 animate-pulse" /> 28TH BIRTHDAY CENTERPIECE
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              The 28-Piece Mind Unfurl
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-xl font-sans leading-relaxed">
              Twenty-eight minimalist thoughts and quiet permissions. Unfold them at your absolute own pace—three today, none tomorrow, a few on a park bench next week.
            </p>
          </div>

          {/* Progress Tracker */}
          <div className="glass-pill rounded-2xl p-4 sm:min-w-[170px] text-right shrink-0">
            <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wider">Unfurled</div>
            <div className="text-2xl font-serif font-bold text-amber-400 mt-0.5">
              {unlockedIds.length} <span className="text-sm font-sans font-normal text-slate-400">/ 28</span>
            </div>
            <div className="w-full bg-slate-800/80 rounded-full h-1.5 mt-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-amber-400 via-rose-400 to-sky-400 rounded-full transition-all duration-500"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            <div className="text-[10px] font-mono text-slate-400 mt-1">Zero rush • Always saved</div>
          </div>
        </div>

        {/* Filter Pills */}
        <div className="flex items-center gap-1.5 mt-6 overflow-x-auto pb-1 relative z-10">
          {[
            { id: 'all', label: 'All 28 Pieces' },
            { id: 'calm', label: '🌿 Calm & Breath' },
            { id: 'outdoor', label: '🌤️ Outdoor' },
            { id: 'growth', label: '✨ Growth' },
            { id: 'friendship', label: '💌 Connection' },
            { id: 'gratitude', label: '🙏 Gratitude' },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterTheme(tab.id)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all cursor-pointer ${
                filterTheme === tab.id
                  ? 'bg-amber-400/20 text-amber-300 border border-amber-400/40 shadow-sm'
                  : 'bg-white/5 text-slate-400 hover:text-slate-200 border border-transparent hover:border-white/10'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Grid of 28 Floating Pieces */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 sm:gap-4">
        {filteredPieces.map((piece) => {
          const isUnlocked = unlockedIds.includes(piece.id);

          return (
            <button
              key={piece.id}
              onClick={() => handleOpenPiece(piece)}
              className={`glass-card rounded-2xl p-4 sm:p-5 text-left transition-all duration-300 cursor-pointer flex flex-col justify-between group relative overflow-hidden ${
                isUnlocked
                  ? 'glass-card-hover border-white/15'
                  : 'opacity-70 hover:opacity-100 border-white/5 hover:border-amber-400/30'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-3">
                <span className="text-xs font-mono text-slate-400 font-semibold">
                  #{piece.id.toString().padStart(2, '0')}
                </span>

                <div className="flex items-center gap-1.5">
                  <div className={`p-1 rounded-full ${getThemeBadgeColor(piece.theme)}`}>
                    {getThemeIcon(piece.theme)}
                  </div>
                  {isUnlocked && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-amber-400" />
                  )}
                </div>
              </div>

              <div className="space-y-1 my-auto">
                <h3 className={`text-sm sm:text-base font-serif font-bold leading-snug transition-colors ${
                  isUnlocked ? 'text-white group-hover:text-amber-300' : 'text-slate-300 group-hover:text-white'
                }`}>
                  {piece.title}
                </h3>
                <p className="text-[11px] text-slate-400 font-sans line-clamp-2 leading-relaxed">
                  {piece.preview}
                </p>
              </div>

              <div className="mt-4 pt-2 border-t border-white/5 flex items-center justify-between text-[10px] font-mono text-slate-500">
                <span>{piece.theme}</span>
                <span className="text-amber-400/80 group-hover:translate-x-0.5 transition-transform">
                  {isUnlocked ? 'Read Again →' : 'Tap to Unfurl ✨'}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Reading Modal */}
      {activePiece && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-fadeIn">
          <div className="glass-card rounded-3xl max-w-lg w-full p-6 sm:p-8 relative border border-amber-400/30 shadow-2xl animate-scaleUp">
            <button
              onClick={() => setActivePiece(null)}
              className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-2 mb-3">
              <span className={`px-2.5 py-0.5 rounded-full text-[11px] font-mono border flex items-center gap-1.5 ${getThemeBadgeColor(activePiece.theme)}`}>
                {getThemeIcon(activePiece.theme)} Piece #{activePiece.id}
              </span>
              <span className="text-xs font-mono text-slate-400">{activePiece.chapter}</span>
            </div>

            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight mb-4">
              {activePiece.title}
            </h2>

            <div className="text-sm sm:text-base text-slate-200 font-sans leading-relaxed space-y-4 py-2 border-t border-b border-white/10">
              <p>{activePiece.body}</p>
            </div>

            {activePiece.prompt && (
              <div className="mt-4 p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-xs font-serif italic text-amber-200 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
                <span>{activePiece.prompt}</span>
              </div>
            )}

            <div className="mt-6 flex items-center justify-between">
              <span className="text-[11px] font-mono text-slate-400">
                Piece {activePiece.id} of 28
              </span>
              <button
                onClick={() => {
                  const nextId = activePiece.id < 28 ? activePiece.id + 1 : 1;
                  const nextPiece = UNFURL_PIECES.find((p) => p.id === nextId);
                  if (nextPiece) handleOpenPiece(nextPiece);
                }}
                className="px-4 py-2 rounded-xl text-xs font-mono font-semibold bg-amber-400/20 border border-amber-400/40 text-amber-300 hover:bg-amber-400/30 cursor-pointer transition-colors"
              >
                Next Piece →
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
