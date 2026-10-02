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

        <div className="text-sm sm:text-base font-serif text-slate-200 leading-relaxed space-y-4 py-3 border-t border-b border-white/10 font-normal">
          <p className="text-amber-200 font-semibold text-base sm:text-lg">
            Hey Shalini, wishing you a very, very happy 28th.
          </p>
          <p>
            I still remember the day we met where it was completely random, and we spent the whole time trying to figure out which mutual friend we had in common (though honestly, to this day, I still don't think we found one!). But from the moment I came over to your place that day, it just felt like home. I didn’t have to put on any guards or pretend; I could just be myself around you.
          </p>
          <p>
            Looking back, we had the best dynamic duo of you talking a mile a minute while I just listened. I cherish every single memory we've made: from you calling me your <span className="text-amber-300 font-semibold">"Monkey Moron"</span>, <span className="text-amber-300 font-semibold">"Princess Madona"</span> to <span className="text-amber-300 font-semibold">"Hero"</span> and me getting used to calling you <span className="text-amber-300 font-semibold">"Pandi"</span> to <span className="text-amber-300 font-semibold">"Heroine"</span>, to the late-night rides, the non-stop laughs, the banter, the angry phases, the quiet moments, the food, the tough times we navigated, and all those games of badminton. I’ve genuinely loved every moment we spent together, and I have zero complaints.
          </p>
          <p>
            Things have shifted and been a bit heavy lately, but my respect and feelings for you haven't changed one bit. Whenever it comes to you, my walls always drop. You became my absolute go-to person for sharing everything—the good, the heavy, and everything in between. To be completely honest, you hold a place in my heart that goes far beyond just an ordinary friend—I genuinely love who you are. But more than anything, I want you to know that <span className="text-amber-200 font-medium">whatever phase of life you’re in—whether it’s light, messy, quiet, or tough—I will always be right there with you, and I’ve loved being a part of every single phase of your journey.</span>
          </p>
          <p>
            Right now, more than anything, I hope you give yourself permission to just exhale. You don't have to carry everything or figure it all out today. I hope you find moments of absolute quiet, ease, and peace, because that's what you need the most right now. Knowing how much you love Krishna, I truly pray that He keeps you wrapped in that kind of steady grace and guides you through whatever comes next.
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

        <div className="mt-6 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-mono text-slate-400">
            <Heart className="w-3.5 h-3.5 text-rose-400 fill-rose-400" />
            <span>Always in your corner</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl text-xs font-mono font-bold bg-amber-400/20 border border-amber-400/40 text-amber-300 hover:bg-amber-400/30 cursor-pointer transition-colors shadow-md"
          >
            Enter Haven ✨
          </button>
        </div>
      </div>
    </div>
  );
};
