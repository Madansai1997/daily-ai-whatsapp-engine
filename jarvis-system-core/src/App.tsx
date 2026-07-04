import React, { useState, useEffect } from "react";
import { ScreenId } from "./types";
import Header from "./components/Header";
import Footer from "./components/Footer";
import CoreInterface from "./components/CoreInterface";
import SecureChat from "./components/SecureChat";
import JobsBoard from "./components/JobsBoard";
import Insights from "./components/Insights";
import Bills from "./components/Bills";
import SystemTerminal from "./components/SystemTerminal";
import SearchOverlay from "./components/SearchOverlay";
import SettingsDrawer from "./components/SettingsDrawer";
import NotificationsDrawer from "./components/NotificationsDrawer";
import LockScreen from "./components/LockScreen";
import { authStatus, setUnauthHandler } from "./lib/auth";
import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid, Bot, Lock, Terminal as TerminalIcon, Briefcase, BarChart3, Wallet } from "lucide-react";

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>(ScreenId.Core);
  const [prevScreen, setPrevScreen] = useState<ScreenId>(ScreenId.Core);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);

  // Auth gate: "checking" until we know if a PIN is required; then locked/unlocked.
  const [authState, setAuthState] = useState<"checking" | "locked" | "open">("checking");

  useEffect(() => {
    setUnauthHandler(() => setAuthState("locked"));
    authStatus().then(({ required }) => setAuthState(required ? "locked" : "open"));
  }, []);

  // Keyboard shortcut Ctrl+K or Cmd+K to trigger search palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const handleNavigate = (targetScreen: ScreenId) => {
    setPrevScreen(activeScreen);
    setActiveScreen(targetScreen);
  };

  // Automated direction solver to adhere perfectly to spec's push/push_back/slide_up directives
  const getTransitionDirection = (from: ScreenId, to: ScreenId): "forward" | "backward" | "slide_up" => {
    if (to === ScreenId.AtsAnalysis) {
      return "slide_up";
    }
    if (from === ScreenId.AtsAnalysis && to === ScreenId.Jobs) {
      return "backward"; // push_back
    }

    // Nav order index to determine forward vs backward push
    const screenOrder = [ScreenId.Core, ScreenId.Assistant, ScreenId.Terminal, ScreenId.Jobs, ScreenId.Insights, ScreenId.Bills];
    const fromIndex = screenOrder.indexOf(from);
    const toIndex = screenOrder.indexOf(to);

    if (fromIndex !== -1 && toIndex !== -1) {
      return toIndex > fromIndex ? "forward" : "backward";
    }

    return "forward";
  };

  const direction = getTransitionDirection(prevScreen, activeScreen);

  // Transition animation variants
  const animationVariants = {
    initial: (dir: "forward" | "backward" | "slide_up") => {
      if (dir === "slide_up") return { y: "100%", opacity: 0 };
      return { x: dir === "forward" ? 60 : -60, opacity: 0 };
    },
    animate: { x: 0, y: 0, opacity: 1 },
    exit: (dir: "forward" | "backward" | "slide_up") => {
      if (dir === "slide_up") return { y: "100%", opacity: 0 };
      return { x: dir === "forward" ? -60 : 60, opacity: 0 };
    }
  };

  // Auth gate — nothing renders until unlocked (or the PIN lock is off).
  if (authState === "checking") {
    return <div className="fixed inset-0 bg-[#0a0e1a]" />;
  }
  if (authState === "locked") {
    return <LockScreen onUnlock={() => setAuthState("open")} />;
  }

  return (
    <div className="relative min-h-screen bg-[#0a0e1a] text-[#dfe2f3] bg-hud-cinematic selection:bg-[#22d3ee]/20 selection:text-[#8aebff] flex flex-col justify-between overflow-x-hidden">
      {/* Scanline atmospheric lighting overlay */}
      <div className="scanline"></div>
      
      {/* Dark tint backing to enhance grid line and card readability */}
      <div className="fixed inset-0 bg-[#0a0e1a]/45 pointer-events-none z-0"></div>

      {/* Unified HUD Header Navigation bar */}
      <Header 
        activeScreen={activeScreen} 
        onNavigate={handleNavigate}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
      />

      {/* Dynamic Main Stage Grid Area */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 sm:px-8 pt-24 pb-24 md:pb-8 relative z-10 cyber-grid flex flex-col justify-start">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={activeScreen === ScreenId.AtsAnalysis ? ScreenId.Jobs : activeScreen}
            custom={direction}
            variants={animationVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ duration: 0.35, ease: "easeInOut" }}
            className="w-full flex-1 flex flex-col justify-start"
          >
            {activeScreen === ScreenId.Core && (
              <CoreInterface onNavigate={handleNavigate} onOpenNotifications={() => setIsNotificationsOpen(true)} />
            )}
            {activeScreen === ScreenId.Assistant && (
              <SecureChat />
            )}
            {(activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis) && (
              <JobsBoard activeScreen={activeScreen} onNavigate={handleNavigate} />
            )}
            {activeScreen === ScreenId.Terminal && (
              <SystemTerminal />
            )}
            {activeScreen === ScreenId.Insights && (
              <Insights />
            )}
            {activeScreen === ScreenId.Bills && (
              <Bills />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation Bar */}
      <nav className="fixed bottom-0 left-0 w-full md:hidden bg-[#0f131f]/90 backdrop-blur-md border-t border-white/10 z-40 flex justify-around items-center h-16 pb-safe">
        <button
          onClick={() => handleNavigate(ScreenId.Core)}
          className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
            activeScreen === ScreenId.Core ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"
          }`}
        >
          <LayoutGrid className="w-5.5 h-5.5" />
          <span className="text-[10px] font-mono mt-1 font-bold">CORE</span>
        </button>
        <button
          onClick={() => handleNavigate(ScreenId.Assistant)}
          className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
            activeScreen === ScreenId.Assistant ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"
          }`}
        >
          <Bot className="w-5.5 h-5.5" />
          <span className="text-[10px] font-mono mt-1 font-bold">JARVIS</span>
        </button>

        <button
          onClick={() => handleNavigate(ScreenId.Terminal)}
          className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
            activeScreen === ScreenId.Terminal ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"
          }`}
        >
          <TerminalIcon className="w-5.5 h-5.5" />
          <span className="text-[10px] font-mono mt-1 font-bold">TERM</span>
        </button>
        <button
          onClick={() => handleNavigate(ScreenId.Jobs)}
          className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
            activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"
          }`}
        >
          <Briefcase className="w-5.5 h-5.5" />
          <span className="text-[10px] font-mono mt-1 font-bold">JOBS</span>
        </button>
        <button
          onClick={() => handleNavigate(ScreenId.Insights)}
          className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
            activeScreen === ScreenId.Insights ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"
          }`}
        >
          <BarChart3 className="w-5.5 h-5.5" />
          <span className="text-[10px] font-mono mt-1 font-bold">STATS</span>
        </button>
        <button
          onClick={() => handleNavigate(ScreenId.Bills)}
          className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${
            activeScreen === ScreenId.Bills ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"
          }`}
        >
          <Wallet className="w-5.5 h-5.5" />
          <span className="text-[10px] font-mono mt-1 font-bold">BILLS</span>
        </button>
      </nav>

      {/* Unified Footer details */}
      <Footer />

      {/* Command Search Overlay */}
      <AnimatePresence>
        {isSearchOpen && (
          <SearchOverlay 
            onClose={() => setIsSearchOpen(false)} 
            onNavigate={handleNavigate} 
          />
        )}
      </AnimatePresence>

      {/* Settings Drawer */}
      <AnimatePresence>
        {isSettingsOpen && (
          <SettingsDrawer 
            onClose={() => setIsSettingsOpen(false)} 
          />
        )}
      </AnimatePresence>

      {/* Notifications / Diagnostics Drawer */}
      <AnimatePresence>
        {isNotificationsOpen && (
          <NotificationsDrawer 
            onClose={() => setIsNotificationsOpen(false)} 
          />
        )}
      </AnimatePresence>
    </div>
  );
}
