import React, { useState, useEffect } from 'react';
import { Sparkles, Heart, CheckCircle2, ChevronRight, Mail, ArrowRight, Flame, HelpCircle, PartyPopper } from 'lucide-react';
import confetti from 'canvas-confetti';
import { sounds } from '../utils/soundEffects';

interface BirthdayExperienceProps {
  onComplete: () => void;
}

interface QuestionOption {
  id: number;
  title: string;
  desc: string;
  meaning: string;
}

interface Question {
  id: number;
  question: string;
  subtitle: string;
  category: string;
  options: QuestionOption[];
}

const STAGE1_QUESTIONS: Question[] = [
  {
    id: 1,
    question: "Best place we have spent together?",
    subtitle: "A special corner of the world that holds our favorite memories.",
    category: "✨ Shared Memories",
    options: [
      {
        id: 1,
        title: "a) Balcony",
        desc: "High up, cool air, overlooking the world below.",
        meaning: "Where hours felt like minutes—talking about everything and nothing under the open night sky."
      },
      {
        id: 2,
        title: "b) Terrace",
        desc: "Under the stars with the open night breeze.",
        meaning: "Our quiet world above all the city noise, where you can let your guard down completely."
      },
      {
        id: 3,
        title: "c) In car",
        desc: "Headlights on, random music playing, headlights cutting the dark.",
        meaning: "Our little moving bubble of privacy—spontaneous drives, honest talks, and escaping anywhere together."
      }
    ]
  },
  {
    id: 2,
    question: "What is the thing you like the most with me?",
    subtitle: "The little rituals that make our bond uniquely ours.",
    category: "💫 Our Connection",
    options: [
      {
        id: 1,
        title: "a) Calling me Princess Madona",
        desc: "That signature teasing nickname.",
        meaning: "Because no matter how tough you act or how much you handle, you'll always have someone to pamper and look out for you."
      },
      {
        id: 2,
        title: "b) Go on a night ride",
        desc: "Empty streets, cold wind on your face, and the road ahead.",
        meaning: "Zero traffic, zero rush, wind on your face, and the ultimate way to hit the reset button."
      },
      {
        id: 3,
        title: "c) Sitting on that broken Sofa and spending time with me",
        desc: "The coziest, most unglamorous spot in the room.",
        meaning: "Proof that we don't need fancy places—just a broken sofa and each other's genuine presence is home."
      }
    ]
  },
  {
    id: 3,
    question: "When your mind is buzzing with 100 thoughts, what is your true reset button?",
    subtitle: "Acknowledging what your heart and body crave to recharge.",
    category: "🌿 Where the Mind Rests",
    options: [
      {
        id: 1,
        title: "a) Stepping outside into the open air",
        desc: "Feeling the breeze, looking at the sky, and letting the world slow down.",
        meaning: "Even 5 minutes under the open sky helps you reconnect with your center and breathe easy."
      },
      {
        id: 2,
        title: "b) Absolute, peaceful silence",
        desc: "A warm cup in hand, zero notifications, and a quiet corner to decompress.",
        meaning: "You give so much energy to everyone around you; absolute silence is where your soul heals."
      },
      {
        id: 3,
        title: "c) Total comfort with zero expectations",
        desc: "Doing something purely for yourself with zero productivity guilt.",
        meaning: "You don't always have to be 'productive'. Giving yourself permission to rest is your superpower."
      }
    ]
  },
  {
    id: 4,
    question: "Looking ahead into your 28th chapter, what is the one gift you promise yourself?",
    subtitle: "Setting your gentle, empowering intention for this year.",
    category: "🌸 Your 28th Chapter",
    options: [
      {
        id: 1,
        title: "a) Deep, undisturbed peace of mind",
        desc: "Lighter shoulders, better sleep, and trusting your own natural rhythm.",
        meaning: "You carry enough already. This year belongs to lighter days, deep peace, and relaxed breaths."
      },
      {
        id: 2,
        title: "b) More spontaneous moments of joy & fresh air",
        desc: "Golden sunsets, walks, laughter, and doing things just because they make you smile.",
        meaning: "Prioritizing your own happiness without needing a reason or an excuse to enjoy life."
      },
      {
        id: 3,
        title: "c) Unapologetic self-kindness",
        desc: "Treating yourself with the exact same boundless patience you give to others.",
        meaning: "You are deserving of the exact same gentleness, grace, and care you so effortlessly give to the world."
      }
    ]
  }
];

export const BirthdayExperience: React.FC<BirthdayExperienceProps> = ({ onComplete }) => {
  const [stage, setStage] = useState<'welcome' | 'stage1' | 'stage2' | 'stage3' | 'countdown' | 'reveal'>('welcome');

  // Stage 1 (Questions Flow)
  const [currentQIndex, setCurrentQIndex] = useState<number>(0);
  const [selectedChoices, setSelectedChoices] = useState<{ [qId: number]: number }>({});
  const [showMeaning, setShowMeaning] = useState<boolean>(false);

  // Stage 2 (Candles Blow Flow - 5 Birthday Candles)
  const [extinguishedCandles, setExtinguishedCandles] = useState<number[]>([]);
  const candleAffirmations = [
    "Candle 1: For your quiet strength on the heaviest days...",
    "Candle 2: For your endless patience and deep kindness...",
    "Candle 3: For the grace you carry without ever boasting...",
    "Candle 4: For your love of open skies, walks, and simple beauty...",
    "Candle 5: For the light you bring effortlessly wherever you go."
  ];

  // Stage 3 (Challenging Grounding Word Puzzle: R E S I L I E N T)
  const targetWord = ['R', 'E', 'S', 'I', 'L', 'I', 'E', 'N', 'T'];
  const [scrambledTiles] = useState<{ id: number; letter: string }[]>([
    { id: 1, letter: 'I' },
    { id: 2, letter: 'E' },
    { id: 3, letter: 'R' },
    { id: 4, letter: 'L' },
    { id: 5, letter: 'S' },
    { id: 6, letter: 'T' },
    { id: 7, letter: 'I' },
    { id: 8, letter: 'N' },
    { id: 9, letter: 'E' },
  ]);
  const [selectedWord, setSelectedWord] = useState<{ id: number; letter: string }[]>([]);
  const [isWordSolved, setIsWordSolved] = useState(false);
  const [hintLevel, setHintLevel] = useState<number>(0);

  // Countdown timer
  const [countdown, setCountdown] = useState<number>(3);

  // Handle Stage 1 Option Selection
  const handleSelectOption = (optId: number) => {
    setSelectedChoices((prev) => ({ ...prev, [STAGE1_QUESTIONS[currentQIndex].id]: optId }));
    setShowMeaning(true);
    
    // Play subtle soft chime & haptics
    sounds.playCelebrationChime();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(35);
    }
  };

  const handleNextQuestion = () => {
    setShowMeaning(false);
    if (currentQIndex < STAGE1_QUESTIONS.length - 1) {
      setCurrentQIndex(currentQIndex + 1);
    } else {
      setStage('stage2');
    }
  };

  // Handle Blow Candle
  const handleBlowCandle = (candleId: number) => {
    if (extinguishedCandles.includes(candleId)) return;

    sounds.playCandleBlow();
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate([40, 20]);
    }

    const nextList = [...extinguishedCandles, candleId];
    setExtinguishedCandles(nextList);

    // Small celebratory confetti puff
    try {
      confetti({
        particleCount: 20,
        spread: 45,
        origin: { y: 0.65 },
        colors: ['#fbbf24', '#f59e0b', '#fb923c']
      });
    } catch {
      /* ignore */
    }

    if (nextList.length === 5) {
      sounds.playCelebrationChime();
      setTimeout(() => {
        setStage('stage3');
      }, 1500);
    }
  };

  // Handle Letter Tap in Puzzle
  const handleTapTile = (tile: { id: number; letter: string }) => {
    if (isWordSolved || selectedWord.some((w) => w.id === tile.id)) return;

    const newSelected = [...selectedWord, tile];
    setSelectedWord(newSelected);

    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      navigator.vibrate(25);
    }

    // Check if word is complete (9 letters)
    if (newSelected.length === targetWord.length) {
      const assembledStr = newSelected.map((t) => t.letter).join('');
      if (assembledStr === 'RESILIENT') {
        setIsWordSolved(true);
        sounds.playCelebrationChime();
        try {
          confetti({
            particleCount: 60,
            spread: 80,
            origin: { y: 0.5 },
            colors: ['#fbbf24', '#f43f5e', '#38bdf8', '#10b981']
          });
        } catch {
          /* ignore */
        }
        setTimeout(() => {
          setStage('countdown');
        }, 1600);
      } else {
        // Incorrect: Reset after 600ms
        setTimeout(() => {
          setSelectedWord([]);
        }, 600);
      }
    }
  };

  const handleRemoveSelectedLetter = (index: number) => {
    if (isWordSolved) return;
    const updated = [...selectedWord];
    updated.splice(index, 1);
    setSelectedWord(updated);
  };

  // Countdown timer effect
  useEffect(() => {
    if (stage === 'countdown') {
      if (countdown > 1) {
        const timer = setTimeout(() => setCountdown(countdown - 1), 1000);
        return () => clearTimeout(timer);
      } else {
        const timer = setTimeout(() => {
          setStage('reveal');
          sounds.playCelebrationChime();
          try {
            confetti({
              particleCount: 100,
              spread: 100,
              origin: { y: 0.45 },
              colors: ['#fbbf24', '#f43f5e', '#38bdf8', '#10b981', '#fb923c']
            });
          } catch {
            /* ignore */
          }
        }, 1000);
        return () => clearTimeout(timer);
      }
    }
  }, [stage, countdown]);

  const currentQ = STAGE1_QUESTIONS[currentQIndex];

  return (
    <div className="min-h-[85vh] flex items-center justify-center p-4">
      {/* 1. WELCOME CELEBRATION SCREEN */}
      {stage === 'welcome' && (
        <div className="glass-card rounded-3xl max-w-lg w-full p-8 sm:p-12 text-center space-y-6 animate-scaleUp border border-amber-400/40 relative overflow-hidden shadow-2xl bg-gradient-to-b from-[#141b2d]/90 to-[#0e1424]/95">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/15 rounded-full blur-3xl pointer-events-none" />
          <div className="absolute bottom-0 left-0 w-64 h-64 bg-rose-500/15 rounded-full blur-3xl pointer-events-none" />

          {/* Birthday Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-gradient-to-r from-amber-500/20 to-rose-500/20 border border-amber-400/40 text-amber-300 text-xs font-mono shadow-md">
            <PartyPopper className="w-4 h-4 text-amber-300 animate-bounce" />
            <span>OCTOBER 3RD • 28TH CELEBRATION 🎈</span>
          </div>

          <h1 className="text-3xl sm:text-4xl font-serif font-bold text-white tracking-tight leading-tight">
            Happy 28th Birthday,<br />
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-rose-300 to-sky-300">
              Shalini ✨
            </span>
          </h1>

          <p className="text-sm text-slate-200 font-sans leading-relaxed">
            Welcome to your personal birthday haven. Before you open your official letter, enjoy a few calm, interactive moments to clear your mind, blow out your candles, and take things slow.
          </p>

          <div className="pt-3">
            <button
              onClick={() => setStage('stage1')}
              className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-xs font-mono font-bold bg-gradient-to-r from-amber-400 via-rose-400 to-amber-400 text-slate-950 hover:scale-105 active:scale-95 cursor-pointer shadow-xl shadow-amber-500/30 transition-all flex items-center justify-center gap-2 mx-auto font-sans"
            >
              <span>Begin Your Birthday Journey 🎈</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* 2. STAGE 1: 4-QUESTION GENTLE CHECK-IN */}
      {stage === 'stage1' && (
        <div className="glass-card rounded-3xl max-w-xl w-full p-6 sm:p-10 space-y-6 animate-fadeIn border border-white/15 relative">
          {/* Header Progress */}
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <span className="text-xs font-mono text-amber-300 font-bold">
              Question {currentQIndex + 1} of {STAGE1_QUESTIONS.length}
            </span>
            <span className="px-3 py-1 rounded-full bg-sky-500/15 border border-sky-500/30 text-[10px] font-mono text-sky-300">
              {currentQ.category}
            </span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-white leading-snug">
              {currentQ.question}
            </h2>
            <p className="text-xs text-slate-300 font-sans">
              {currentQ.subtitle}
            </p>
          </div>

          {/* Options */}
          <div className="space-y-3 pt-2">
            {currentQ.options.map((opt) => {
              const isSelected = selectedChoices[currentQ.id] === opt.id;
              return (
                <button
                  key={opt.id}
                  onClick={() => handleSelectOption(opt.id)}
                  className={`w-full p-4 rounded-2xl border text-left transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    isSelected
                      ? 'bg-gradient-to-r from-amber-500/20 via-rose-500/15 to-sky-500/20 border-amber-400/80 shadow-lg shadow-amber-500/15 scale-[1.01]'
                      : 'bg-slate-900/70 border-white/10 hover:border-white/25 hover:bg-slate-900/90'
                  }`}
                >
                  <div>
                    <h4 className={`text-sm font-serif font-bold ${isSelected ? 'text-amber-200' : 'text-white'}`}>
                      {opt.title}
                    </h4>
                    <p className="text-xs text-slate-300 mt-0.5">{opt.desc}</p>
                  </div>
                  {isSelected && (
                    <CheckCircle2 className="w-5 h-5 text-amber-300 shrink-0 mt-0.5" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Meaning / Memory Revelation Box & Next Question Action */}
          {showMeaning && (
            <div className="mt-4 p-4 rounded-2xl bg-gradient-to-r from-amber-500/15 to-rose-500/15 border border-amber-400/40 space-y-3 animate-scaleUp shadow-xl">
              <div className="flex items-center gap-2 text-xs font-mono text-amber-300 font-semibold">
                <Sparkles className="w-4 h-4 text-amber-400 animate-pulse" />
                <span>WHAT THIS MEANS ✨</span>
              </div>
              <p className="text-xs sm:text-sm font-serif italic text-slate-200 leading-relaxed">
                "{currentQ.options.find((o) => o.id === selectedChoices[currentQ.id])?.meaning}"
              </p>

              <div className="pt-2 flex justify-end">
                <button
                  onClick={handleNextQuestion}
                  className="px-6 py-2.5 rounded-xl text-xs font-mono font-bold bg-gradient-to-r from-amber-400 to-rose-400 text-slate-950 hover:scale-105 active:scale-95 cursor-pointer shadow-md flex items-center gap-2"
                >
                  <span>{currentQIndex < STAGE1_QUESTIONS.length - 1 ? 'Next Question' : 'Proceed to Candles 🎂'}</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3. STAGE 2: 28TH BIRTHDAY CANDLES BLOW (Audio + Flame Haptics) */}
      {stage === 'stage2' && (
        <div className="glass-card rounded-3xl max-w-xl w-full p-6 sm:p-10 space-y-6 animate-fadeIn border border-amber-400/30 text-center relative shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <span className="text-[11px] font-mono text-slate-400">Step 2 of 3</span>
            <span className="px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-[10px] font-mono text-amber-300 flex items-center gap-1.5">
              <Flame className="w-3.5 h-3.5 text-amber-400" /> Birthday Candle Wishes ({extinguishedCandles.length}/5)
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-white">
              Blow Out Your 5 Birthday Candles
            </h2>
            <p className="text-xs text-slate-300 font-sans">
              Tap each glowing candle to blow out the flame and unlock a heartfelt wish.
            </p>
          </div>

          {/* Interactive Birthday Candles Row */}
          <div className="py-6 flex justify-center gap-3 sm:gap-6 items-end min-h-[160px]">
            {[1, 2, 3, 4, 5].map((candleId) => {
              const isExtinguished = extinguishedCandles.includes(candleId);

              return (
                <button
                  key={candleId}
                  onClick={() => handleBlowCandle(candleId)}
                  disabled={isExtinguished}
                  className="flex flex-col items-center cursor-pointer group transition-all hover:scale-110 active:scale-95"
                >
                  {/* Animated Flame */}
                  {!isExtinguished ? (
                    <div className="relative mb-1 flex flex-col items-center">
                      {/* Glow halo */}
                      <div className="w-8 h-8 rounded-full bg-amber-400/30 blur-md absolute top-[-6px]" />
                      {/* Realistic flickering teardrop flame */}
                      <div className="w-4 h-6 sm:w-5 sm:h-7 rounded-[50%_50%_50%_50%/60%_60%_40%_40%] bg-gradient-to-t from-orange-500 via-amber-400 to-yellow-200 animate-flame shadow-lg shadow-amber-500/50" />
                      {/* Wick */}
                      <div className="w-[1.5px] h-2 bg-slate-900" />
                    </div>
                  ) : (
                    <div className="h-9 flex items-center justify-center mb-1">
                      {/* Gentle smoke wisps */}
                      <div className="text-[10px] font-mono text-slate-400 animate-fadeIn opacity-60">
                        💨
                      </div>
                    </div>
                  )}

                  {/* Candle Wax Pillar */}
                  <div className={`w-6 sm:w-8 h-16 sm:h-20 rounded-t-lg rounded-b-md border shadow-lg transition-colors ${
                    isExtinguished
                      ? 'bg-slate-800 border-white/10 opacity-50'
                      : 'bg-gradient-to-b from-amber-300 via-rose-300 to-amber-500 border-amber-200/60 shadow-amber-500/20'
                  }`}>
                    <div className="w-full h-2 bg-white/30 rounded-t-lg" />
                  </div>

                  <span className="text-[10px] font-mono text-slate-400 mt-2">
                    #{candleId}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Subtitle Affirmation for latest blown candle */}
          <div className="min-h-[45px] p-3 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-xs sm:text-sm font-serif italic text-amber-200">
            {extinguishedCandles.length > 0 ? (
              <p className="animate-fadeIn">
                "{candleAffirmations[extinguishedCandles[extinguishedCandles.length - 1] - 1]}"
              </p>
            ) : (
              <p className="text-slate-400 font-sans not-italic text-xs">
                💨 Tap any candle to blow it out (Audio & Haptics active)
              </p>
            )}
          </div>
        </div>
      )}

      {/* 4. STAGE 3: THE ANCHOR CIPHER (Hard Puzzle with Hints: RESILIENT) */}
      {stage === 'stage3' && (
        <div className="glass-card rounded-3xl max-w-xl w-full p-6 sm:p-10 space-y-6 animate-fadeIn border border-emerald-400/30 text-center relative shadow-2xl">
          <div className="flex items-center justify-between border-b border-white/10 pb-3">
            <span className="text-[11px] font-mono text-slate-400">Step 3 of 3</span>
            <span className="px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500/30 text-[10px] font-mono text-emerald-300">
              🌿 The Inner Strength Cipher
            </span>
          </div>

          <div className="space-y-1">
            <h2 className="text-xl sm:text-2xl font-serif font-bold text-white">
              Assemble the 9-Letter Strength
            </h2>
            <p className="text-xs text-slate-300 font-sans">
              Spell the 9-letter word describing your quiet power to bend with any storm and rise back stronger.
            </p>
          </div>

          {/* Selected Letter Slots (9 letters for RESILIENT) */}
          <div className="flex justify-center flex-wrap gap-1.5 sm:gap-2 py-3">
            {targetWord.map((_, idx) => {
              const selectedItem = selectedWord[idx];
              return (
                <button
                  key={idx}
                  onClick={() => selectedItem && handleRemoveSelectedLetter(idx)}
                  className={`w-9 h-12 sm:w-11 sm:h-14 rounded-xl border-2 flex items-center justify-center font-serif text-lg sm:text-xl font-bold transition-all ${
                    selectedItem
                      ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300 shadow-md cursor-pointer hover:bg-rose-500/20 hover:border-rose-400'
                      : 'bg-slate-900/60 border-dashed border-white/20 text-transparent'
                  }`}
                  title={selectedItem ? 'Tap to remove letter' : ''}
                >
                  {selectedItem ? selectedItem.letter : '_'}
                </button>
              );
            })}
          </div>

          {/* Scrambled Available Letter Tiles */}
          <div className="flex justify-center flex-wrap gap-2 pt-1">
            {scrambledTiles.map((tile) => {
              const isUsed = selectedWord.some((w) => w.id === tile.id);
              return (
                <button
                  key={tile.id}
                  onClick={() => handleTapTile(tile)}
                  disabled={isUsed || isWordSolved}
                  className={`w-10 h-11 sm:w-12 sm:h-13 rounded-xl border font-serif text-base sm:text-lg font-bold transition-all ${
                    isUsed
                      ? 'opacity-25 border-transparent bg-slate-950 text-slate-600 cursor-not-allowed'
                      : 'bg-slate-900 border-white/20 hover:border-emerald-400 text-slate-100 hover:bg-slate-800 cursor-pointer shadow-md hover:scale-105'
                  }`}
                >
                  {tile.letter}
                </button>
              );
            })}
          </div>

          {/* Progressive Hints Button */}
          <div className="pt-2">
            {hintLevel === 0 && (
              <button
                onClick={() => setHintLevel(1)}
                className="inline-flex items-center gap-1.5 text-xs font-mono text-amber-300/90 hover:text-amber-300 underline cursor-pointer"
              >
                <HelpCircle className="w-3.5 h-3.5" /> Need a clue? (Hint 1)
              </button>
            )}

            {hintLevel >= 1 && (
              <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-xs font-mono text-amber-200 space-y-1">
                <p>💡 <b>Clue 1:</b> The deep inner strength that survives hard days and rises back stronger.</p>
                {hintLevel === 1 && (
                  <button
                    onClick={() => setHintLevel(2)}
                    className="text-[11px] underline text-amber-300 block pt-1 cursor-pointer"
                  >
                    Still tricky? (Hint 2)
                  </button>
                )}
                {hintLevel >= 2 && (
                  <p className="text-emerald-300 pt-1">
                    ✨ <b>Clue 2:</b> Starts with <b>R</b>, ends with <b>T</b> (R _ _ _ _ _ _ _ T).
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 5. COUNTDOWN GATE */}
      {stage === 'countdown' && (
        <div className="glass-card rounded-3xl max-w-md w-full p-10 text-center space-y-6 animate-scaleUp border border-amber-400/50 shadow-2xl">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-mono">
            <Sparkles className="w-3.5 h-3.5 animate-spin" /> THE FINAL BIRTHDAY GATE
          </div>

          <h2 className="text-lg font-serif font-bold text-white">
            Unlocking your letter in...
          </h2>

          <div className="text-6xl sm:text-7xl font-serif font-bold text-transparent bg-clip-text bg-gradient-to-r from-amber-300 via-rose-300 to-amber-400 animate-pulse py-3">
            {countdown}
          </div>

          <p className="text-xs font-mono text-slate-300">
            A quiet haven with zero pressure.
          </p>
        </div>
      )}

      {/* 6. GRAND FINALE: THE OFFICIAL BIRTHDAY LETTER */}
      {stage === 'reveal' && (
        <div className="glass-card rounded-3xl max-w-xl w-full p-6 sm:p-10 space-y-6 animate-scaleUp border border-amber-400/50 relative shadow-2xl overflow-y-auto max-h-[88vh] bg-gradient-to-b from-[#162035]/95 to-[#0e1424]/95">
          {/* Header Tag */}
          <div className="flex items-center justify-between border-b border-white/10 pb-4">
            <div className="flex items-center gap-2 text-xs font-mono text-amber-300 font-bold">
              <Mail className="w-4 h-4 text-amber-400" />
              <span>THE OFFICIAL 28TH BIRTHDAY LETTER 🎈</span>
            </div>
            <span className="text-[10px] font-mono text-slate-400">OCTOBER 3, 2026</span>
          </div>

          {/* Letter Heading */}
          <div>
            <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight">
              Happy 28th Birthday, Shalini.
            </h2>
            <p className="text-xs font-serif italic text-amber-300/90 mt-1">
              "To quiet courage, lighter shoulders, and open skies."
            </p>
          </div>

          {/* Letter Content */}
          <div className="text-sm sm:text-base font-serif text-slate-200 leading-relaxed space-y-4 py-3 border-t border-b border-white/10 font-normal">
            <p className="text-amber-200 font-semibold text-base sm:text-lg">
              Hey Shalini, wishing you a very, very happy 28th.
            </p>
            <p>
              I still remember the day we met—it was completely random, and we spent the whole time trying to figure out which mutual friend we had in common (though honestly, to this day, I still don't think we found one!). But from the moment I came over to your place that day, it just felt like home. I didn’t have to put on any guards or pretend; I could just be myself around you.
            </p>
            <p>
              Looking back, we had the best dynamic—you talking a mile a minute while I just listened. I cherish every single memory we've made: from you calling me your <span className="text-amber-300 font-semibold">"Monkey Moron"</span>, <span className="text-amber-300 font-semibold">"Princess Madona"</span> to <span className="text-amber-300 font-semibold">"Hero"</span> and me getting used to calling you <span className="text-amber-300 font-semibold">"Pandi"</span> to <span className="text-amber-300 font-semibold">"Heroine"</span>, to the late-night rides, the non-stop laughs, the banter, the angry phases, the quiet moments, the food, the tough times we navigated, and all those games of badminton. I’ve genuinely loved every moment we spent together, and I have zero complaints.
            </p>
            <p>
              Things have shifted and been a bit heavy lately, but my respect and feelings for you haven't changed one bit. Whenever it comes to you, my walls always drop. You became my absolute go-to person for sharing everything—the good, the heavy, and everything in between. To be completely honest, you hold a place in my heart that goes far beyond just an ordinary friend—I genuinely love who you are. But more than anything, I want you to know that <span className="text-amber-200 font-medium">whatever phase of life you’re in—whether it’s light, messy, quiet, or tough—I will always be right there with you, and I’ve loved being a part of every single phase of your journey.</span>
            </p>
            <p>
              Right now, more than anything, I hope you give yourself permission to just exhale. You don't have to carry everything or figure it all out today. I hope you find moments of absolute quiet, ease, and peace—because that's what you need the most right now. Knowing how much you love Krishna, I truly pray that He keeps you wrapped in that kind of steady grace and guides you through whatever comes next.
            </p>
            <p>
              No matter what happens in our lives or what situations come up, please know that I'm always with you. You can count on me at any point, and I'm always just a message or a call away.
            </p>
            <p>
              Thank you for bringing so many wonderful moments into my life. You'll always be in my corner, and I'm always rooting for you to live life exactly the way you want to.
            </p>
            <p className="text-amber-300 font-semibold pt-1 text-base">
              Happy birthday ✨
            </p>
          </div>

          {/* Bottom Action into Sanctuary */}
          <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
              <Heart className="w-4 h-4 text-rose-400 fill-rose-400" />
              <span>Always in your corner</span>
            </div>

            <button
              onClick={onComplete}
              className="w-full sm:w-auto px-6 py-3 rounded-xl text-xs font-mono font-bold bg-gradient-to-r from-amber-400 via-rose-400 to-amber-400 text-slate-950 hover:opacity-90 transition-all cursor-pointer shadow-lg flex items-center justify-center gap-2"
            >
              <span>Enter Haven 🌿</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
