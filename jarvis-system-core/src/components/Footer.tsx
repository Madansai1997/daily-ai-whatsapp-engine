import React from "react";

export default function Footer() {
  return (
    <footer className="bg-[#0f131f]/90 backdrop-blur-sm border-t border-white/10 z-10 w-full">
      <div className="w-full py-4 px-8 flex flex-col md:flex-row justify-between items-center gap-4 max-w-full mx-auto">
        <div className="flex items-center gap-4">
          <span className="text-[#8aebff] font-mono text-xs tracking-wider nav-active-glow">
            AETHERIS ARCHIVE
          </span>
          <span className="text-[#859397] font-mono text-xs">
            © 2024 ENCRYPTED PROTOCOL.
          </span>
        </div>
        <div className="flex items-center gap-6">
          <a
            className="text-[#859397] font-mono text-xs hover:text-[#dfe2f3] transition-all opacity-70 hover:opacity-100"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            Privacy
          </a>
          <a
            className="text-[#859397] font-mono text-xs hover:text-[#dfe2f3] transition-all opacity-70 hover:opacity-100"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            Terms
          </a>
          <a
            className="text-[#859397] font-mono text-xs hover:text-[#dfe2f3] transition-all opacity-70 hover:opacity-100"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            License
          </a>
        </div>
      </div>
    </footer>
  );
}
