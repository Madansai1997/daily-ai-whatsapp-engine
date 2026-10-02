import React from 'react';
import { X, Feather, Heart } from 'lucide-react';

interface LetterModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const LetterModal: React.FC<LetterModalProps> = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-md animate-fadeIn">
      <div className="glass-card rounded-3xl max-w-lg w-full p-6 sm:p-9 relative border border-amber-400/30 shadow-2xl animate-scaleUp overflow-y-auto max-h-[90vh]">
        <button
          onClick={onClose}
          className="absolute top-5 right-5 p-2 rounded-full bg-white/5 hover:bg-white/10 text-slate-400 hover:text-white transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-300 text-xs font-mono mb-4">
          <Feather className="w-3.5 h-3.5" /> OCTOBER 3RD • THE HANDWRITTEN NOTE
        </div>

        <h2 className="text-2xl sm:text-3xl font-serif font-bold text-white tracking-tight mb-4">
          Happy 28th Birthday.
        </h2>

        <div className="text-sm sm:text-base font-serif italic text-slate-200 leading-relaxed space-y-4 py-3 border-t border-b border-white/10">
          <p>
            I know life has had a lot of noise, responsibilities, and weight lately. 
          </p>
          <p>
            This year, I don't want you to feel the need to rush, prove anything to anyone, or carry everything all at once. Give yourself total permission to just breathe, take things slow, and walk at your own natural pace.
          </p>
          <p>
            This app is a quiet corner built just for you. There are no deadlines, no expectations, and no need to reply to anything. Open it whenever you're sitting outside, need a quiet minute, or just want to clear your head.
          </p>
          <p className="text-amber-300 font-semibold pt-2">
            Here’s to a calm, grounded, and gentle 28th year.
          </p>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
            <span>Always in your corner</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-mono font-bold bg-amber-400/20 border border-amber-400/40 text-amber-300 hover:bg-amber-400/30 cursor-pointer transition-colors shadow-md"
          >
            Enter Sanctuary ✨
          </button>
        </div>
      </div>
    </div>
  );
};
