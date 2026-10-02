import React, { useState, useRef, useEffect } from 'react';
import { Flame, Sparkles, CheckCircle2, Clock, Trash2, RefreshCw, Feather, Wind } from 'lucide-react';
import { sounds } from '../utils/soundEffects';

interface StructuredDump {
  topThree: string[];
  canWait: string[];
  letGo: string[];
  groundingAffirmation: string;
}

export const BrainDump: React.FC = () => {
  const [rawText, setRawText] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isBurning, setIsBurning] = useState(false);
  const [hasBurned, setHasBurned] = useState(false);
  const [structured, setStructured] = useState<StructuredDump | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationRef = useRef<number | null>(null);

  // Realistic Fire & Ash Disintegration Physics Simulation
  useEffect(() => {
    if (!isBurning) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = canvas.offsetWidth || 500;
    canvas.height = canvas.offsetHeight || 280;

    interface Particle {
      x: number;
      y: number;
      vx: number;
      vy: number;
      size: number;
      life: number;
      maxLife: number;
      color: string;
      isAsh: boolean;
    }

    const particles: Particle[] = [];
    const flameColors = ['#ff2200', '#ff6600', '#ffaa00', '#ffe600', '#ffffff'];
    const ashColors = ['#222222', '#3e3e3e', '#666666', '#888888'];

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Spawn new flames & embers from the bottom/center
      for (let i = 0; i < 9; i++) {
        const isAshParticle = Math.random() > 0.45;
        particles.push({
          x: Math.random() * canvas.width,
          y: canvas.height - Math.random() * 30,
          vx: (Math.random() - 0.5) * 2.5 + (isAshParticle ? 1.5 : 0), // Ash drifts with wind
          vy: -Math.random() * 4.5 - 1.5,
          size: isAshParticle ? Math.random() * 4 + 2 : Math.random() * 6 + 3,
          life: 0,
          maxLife: isAshParticle ? Math.random() * 60 + 50 : Math.random() * 40 + 25,
          color: isAshParticle
            ? ashColors[Math.floor(Math.random() * ashColors.length)]
            : flameColors[Math.floor(Math.random() * flameColors.length)],
          isAsh: isAshParticle
        });
      }

      // Update and draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life++;

        const progress = p.life / p.maxLife;
        const opacity = Math.max(0, 1 - progress);

        ctx.beginPath();
        ctx.arc(p.x, p.y, Math.max(0.5, p.size * (1 - progress * 0.4)), 0, Math.PI * 2);

        if (p.isAsh) {
          ctx.fillStyle = `rgba(120, 113, 108, ${opacity * 0.75})`;
        } else {
          ctx.fillStyle = p.color;
          ctx.shadowBlur = 12;
          ctx.shadowColor = '#ff6600';
        }

        ctx.fill();
        ctx.shadowBlur = 0;

        if (p.life >= p.maxLife || p.y < -20) {
          particles.splice(i, 1);
        }
      }

      animationRef.current = requestAnimationFrame(render);
    };

    render();

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [isBurning]);

  // Flame Shredder Burn Action
  const handleBurn = () => {
    if (!rawText.trim() || isBurning) return;
    setIsBurning(true);

    // Deep realistic fire crackle audio & rhythmic haptic pulse
    sounds.playFireBurn();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([70, 50, 90, 60, 140]);
    }

    setTimeout(() => {
      setRawText('');
      setIsBurning(false);
      setHasBurned(true);
      setStructured(null);
    }, 1800);
  };

  // Structured Action De-clutter
  const handleDeClutter = () => {
    if (!rawText.trim() || isProcessing) return;
    setIsProcessing(true);

    sounds.playCelebrationChime();
    setTimeout(() => {
      const lines = rawText
        .split(/[\n,;.]+/)
        .map((s) => s.trim())
        .filter((s) => s.length > 2);

      const topThree = lines.slice(0, 3);
      if (topThree.length === 0) topThree.push("Breathe deeply & take 1 small step");

      const canWait = lines.slice(3, 7);
      const letGo = lines.slice(7);

      setStructured({
        topThree,
        canWait,
        letGo,
        groundingAffirmation: "You don't have to carry the whole mountain today. Just step on the first stone."
      });

      setIsProcessing(false);
      setHasBurned(false);
    }, 600);
  };

  const handleReset = () => {
    setRawText('');
    setStructured(null);
    setHasBurned(false);
    setIsBurning(false);
  };

  return (
    <div className="space-y-6 animate-fadeIn pb-12">
      {/* Header */}
      <div className="glass-card rounded-3xl p-6 sm:p-8 relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-orange-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-orange-500/15 border border-orange-500/30 text-orange-300 text-xs font-mono mb-2">
              <Flame className="w-3.5 h-3.5 text-orange-400" /> THE FLAME SHREDDER & DE-CLUTTER
            </div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              Unload & Release
            </h2>
            <p className="text-xs sm:text-sm text-slate-300 mt-1 max-w-lg font-sans leading-relaxed">
              When heavy thoughts, annoying chores, or worries pile up: type them freely. Burn them to ashes forever with 0 traces, or distill them into 3 quiet steps.
            </p>
          </div>
        </div>
      </div>

      {/* Burned Confirmation Card */}
      {hasBurned && (
        <div className="glass-card rounded-3xl p-8 sm:p-12 border border-orange-500/40 text-center space-y-3 animate-scaleUp bg-gradient-to-b from-orange-950/40 via-slate-900/90 to-slate-950">
          <div className="w-16 h-16 rounded-full bg-orange-500/20 border border-orange-500/40 flex items-center justify-center mx-auto text-orange-300 shadow-xl">
            <Wind className="w-8 h-8 animate-pulse" />
          </div>
          <h3 className="text-2xl font-serif font-bold text-white">
            Burned to Ash. Gone Forever.
          </h3>
          <p className="text-xs sm:text-sm font-serif italic text-orange-200 max-w-md mx-auto leading-relaxed">
            "Your mind is not a storage unit for stress. It has turned to smoke, scattered into ashes, and blown away. Breathe easy."
          </p>
          <div className="pt-3">
            <button
              onClick={handleReset}
              className="px-6 py-2.5 rounded-xl text-xs font-mono font-bold bg-white/10 hover:bg-white/20 text-slate-200 cursor-pointer transition-all border border-white/15"
            >
              Write Something Else ✍️
            </button>
          </div>
        </div>
      )}

      {/* Input Stage */}
      {!structured && !hasBurned && (
        <div className={`glass-card rounded-3xl p-6 sm:p-8 space-y-4 relative overflow-hidden transition-all duration-700 ${isBurning ? 'border-orange-500 shadow-2xl shadow-orange-500/30' : ''}`}>
          {/* Live Canvas Fire & Embers Overlay during burn */}
          {isBurning && (
            <div className="absolute inset-0 z-20 pointer-events-none bg-gradient-to-t from-orange-950/80 via-red-950/60 to-transparent flex items-center justify-center animate-fadeIn">
              <canvas
                ref={canvasRef}
                className="w-full h-full absolute inset-0"
              />
              <div className="relative z-30 text-center space-y-1 animate-pulse">
                <Flame className="w-12 h-12 text-amber-300 mx-auto animate-bounce" />
                <span className="text-sm font-serif font-bold text-amber-200 uppercase tracking-widest block drop-shadow-md">
                  Incinerating to Ashes...
                </span>
              </div>
            </div>
          )}

          <label className="block text-xs font-mono font-semibold text-slate-300 uppercase tracking-wider">
            Dump whatever is on your mind (100% private, never saved):
          </label>

          <textarea
            value={rawText}
            onChange={(e) => setRawText(e.target.value)}
            disabled={isBurning}
            placeholder="Type anything heavy, frustrating, work tasks, or racing thoughts... You can burn it to ash or clear the chaos."
            rows={5}
            className={`w-full bg-slate-900/90 border border-white/10 rounded-2xl p-4 text-xs sm:text-sm text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-orange-400/50 transition-all font-sans leading-relaxed resize-none ${
              isBurning ? 'text-orange-300 bg-red-950/40 border-orange-500 blur-[0.5px]' : ''
            }`}
          />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
            <span className="text-[11px] font-mono text-slate-500">
              {rawText.length > 0 ? `${rawText.length} characters written` : 'Type freely with zero filter'}
            </span>

            <div className="flex items-center gap-2">
              {/* Burn & Shred Button */}
              <button
                onClick={handleBurn}
                disabled={isBurning || !rawText.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold bg-gradient-to-r from-orange-500/30 to-red-500/30 border border-orange-500/50 text-orange-300 hover:bg-orange-500/40 disabled:opacity-40 transition-all cursor-pointer shadow-md"
              >
                <Flame className={`w-4 h-4 text-orange-400 ${isBurning ? 'animate-bounce' : ''}`} />
                <span>{isBurning ? 'Burning...' : 'Burn & Shred 🔥'}</span>
              </button>

              {/* Distill 3 Steps Button */}
              <button
                onClick={handleDeClutter}
                disabled={isProcessing || isBurning || !rawText.trim()}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-xs font-mono font-bold bg-sky-500/20 border border-sky-500/40 text-sky-300 hover:bg-sky-500/30 disabled:opacity-40 transition-all cursor-pointer shadow-md"
              >
                {isProcessing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                <span>3 Calm Steps ✨</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Structured Output View */}
      {structured && !hasBurned && (
        <div className="space-y-6 animate-scaleUp">
          <div className="p-4 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-xs font-serif italic text-sky-200 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Feather className="w-4 h-4 text-sky-400 shrink-0" />
              <span>"{structured.groundingAffirmation}"</span>
            </div>
            <button
              onClick={handleReset}
              className="text-[11px] font-mono text-slate-400 hover:text-white shrink-0 underline cursor-pointer"
            >
              Dump Again
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-card rounded-2xl p-5 border border-emerald-500/30 bg-emerald-950/20">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-emerald-400 mb-3 border-b border-emerald-500/20 pb-2">
                <CheckCircle2 className="w-4 h-4" /> 1. MUST DO TODAY (Max 3):
              </div>
              <ul className="space-y-2">
                {structured.topThree.map((item, idx) => (
                  <li key={idx} className="p-2.5 rounded-xl bg-slate-900/80 border border-emerald-500/20 text-xs font-sans text-slate-200 flex items-start gap-2">
                    <span className="text-emerald-400 font-mono font-bold text-[11px]">{idx + 1}.</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="glass-card rounded-2xl p-5 border border-amber-500/30 bg-amber-950/20">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-amber-400 mb-3 border-b border-amber-500/20 pb-2">
                <Clock className="w-4 h-4" /> 2. CAN WAIT (Parked):
              </div>
              {structured.canWait.length > 0 ? (
                <ul className="space-y-2">
                  {structured.canWait.map((item, idx) => (
                    <li key={idx} className="p-2 rounded-xl bg-slate-900/60 border border-white/5 text-xs font-sans text-slate-300">
                      • {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 italic">No secondary noise left.</p>
              )}
            </div>

            <div className="glass-card rounded-2xl p-5 border border-white/10">
              <div className="flex items-center gap-2 text-xs font-mono font-bold text-slate-400 mb-3 border-b border-white/10 pb-2">
                <Trash2 className="w-4 h-4" /> 3. LET GO (Mental Fluff):
              </div>
              {structured.letGo.length > 0 ? (
                <ul className="space-y-1.5">
                  {structured.letGo.map((item, idx) => (
                    <li key={idx} className="text-[11px] font-sans text-slate-400 line-through opacity-70">
                      {item}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-slate-500 italic">Clean head. Nothing to discard.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
