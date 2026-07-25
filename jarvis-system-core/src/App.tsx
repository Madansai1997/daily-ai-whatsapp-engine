import React, { useState, useEffect } from "react";
import { ScreenId } from "./types";
import Header from "./components/Header";
import Footer from "./components/Footer";
import HomeCockpit from "./components/HomeCockpit";
import SecureChat from "./components/SecureChat";
import JobsBoard from "./components/JobsBoard";
import Insights from "./components/Insights";
import DocsRag from "./components/DocsRag";
import DataAnalyst from "./components/DataAnalyst";
import Bills from "./components/Bills";
import Help from "./components/Help";
import Discover from "./components/Discover";
import SystemTerminal from "./components/SystemTerminal";
import SearchOverlay from "./components/SearchOverlay";
import SettingsDrawer from "./components/SettingsDrawer";
import NotificationsDrawer from "./components/NotificationsDrawer";
import LockScreen from "./components/LockScreen";
import VoiceDock from "./components/VoiceDock";
import { useVoiceAgent } from "./lib/voiceAgent";
import { authStatus, setUnauthHandler, isDemo } from "./lib/auth";
import ProjectBelieverModal from "./components/ProjectBelieverModal";
import { AnimatePresence, motion } from "motion/react";
import { LayoutGrid, Bot, Lock, Briefcase, BarChart3, Wallet, Compass, FileText, Table2 } from "lucide-react";

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>(ScreenId.Core);
  const [prevScreen, setPrevScreen] = useState<ScreenId>(ScreenId.Core);
  // Navigation intent: lets one screen (e.g. Home cockpit) deep-link into a specific tool/modal
  // on another (e.g. open the Jobs review modal). Consumed + cleared by the target screen.
  const [navIntent, setNavIntent] = useState<string | null>(null);

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [isBelieverOpen, setIsBelieverOpen] = useState(false);

  // Global hotkey: Cmd + Shift + B / Ctrl + Shift + B -> Project Believer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && (e.key === "B" || e.key === "b")) {
        e.preventDefault();
        setIsBelieverOpen((prev) => !prev);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);


  // Auth gate: "checking" until we know if a PIN is required; then locked/unlocked.
  const [authState, setAuthState] = useState<"checking" | "locked" | "open">("checking");
  const [demoMode, setDemoMode] = useState(false);

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

  const navigate = (targetScreen: ScreenId, intent?: string) => {
    setPrevScreen(activeScreen);
    setActiveScreen(targetScreen);
    setNavIntent(intent ?? null);
  };

  // App-wide voice agent — voice commands ("open jobs", "stop") drive real navigation.
  const voice = useVoiceAgent({ onNavigate: navigate });

  const handleNavigate = (targetScreen: ScreenId, intent?: string) => {
    voice.notifyManualNavigate(); // hush any in-flight speech when you move by hand
    navigate(targetScreen, intent);
  };

  // Automated direction solver to adhere perfectly to spec's push/push_back/slide_up directives
  const getTransitionDirection = (from: ScreenId, to: ScreenId): "forward" | "backward" | "slide_up" => {
    if (to === ScreenId.AtsAnalysis) {
      return "slide_up";
    }
    if (from === ScreenId.AtsAnalysis && to === ScreenId.Jobs) {
      return "backward"; // push_back
    }

    // Nav order index to determine forward vs backward push (matches the header order)
    const screenOrder = [ScreenId.Core, ScreenId.Jobs, ScreenId.Insights, ScreenId.Docs, ScreenId.Analyst, ScreenId.Bills, ScreenId.Assistant, ScreenId.Discover, ScreenId.Terminal, ScreenId.Help];
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
    return <LockScreen onUnlock={() => { setDemoMode(isDemo()); setAuthState("open"); }} />;
  }

  return (
    <div className="relative min-h-screen bg-[#0a0e1a] text-[#dfe2f3] bg-hud-cinematic selection:bg-[#22d3ee]/20 selection:text-[#8aebff] flex flex-col justify-between overflow-x-hidden">
      {/* Scanline atmospheric lighting overlay */}
      <div className="scanline"></div>
      
      {/* Dark tint backing to enhance grid line and card readability */}
      <div className="fixed inset-0 bg-[#0a0e1a]/45 pointer-events-none z-0"></div>

      {/* Demo-mode banner — sample data, read-only */}
      {demoMode && (
        <div className="fixed top-0 left-0 w-full z-[60] bg-[#8aebff]/10 border-b border-[#8aebff]/25 backdrop-blur-sm text-center py-1.5 px-4">
          <span className="text-[11px] font-mono text-[#8aebff] tracking-wider">
            ● DEMO MODE — sample data, read-only. Nothing here is real.
          </span>
        </div>
      )}

      {/* Unified HUD Header Navigation bar */}
      <Header 
        activeScreen={activeScreen} 
        onNavigate={handleNavigate}
        onOpenSearch={() => setIsSearchOpen(true)}
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenNotifications={() => setIsNotificationsOpen(true)}
        demoMode={demoMode}
      />

      {/* Dynamic Main Stage Grid Area */}
      <main className={`flex-1 w-full max-w-[1440px] mx-auto px-6 sm:px-8 ${demoMode ? "pt-[124px]" : "pt-24"} pb-24 md:pb-8 relative z-10 cyber-grid flex flex-col justify-start`}>
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
              <HomeCockpit onNavigate={handleNavigate} voice={voice} />
            )}
            {activeScreen === ScreenId.Assistant && (
              <SecureChat />
            )}
            {(activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis) && (
              <JobsBoard activeScreen={activeScreen} onNavigate={handleNavigate} intent={navIntent} onIntentHandled={() => setNavIntent(null)} />
            )}
            {activeScreen === ScreenId.Terminal && (
              <SystemTerminal />
            )}
            {activeScreen === ScreenId.Insights && (
              <Insights />
            )}
            {activeScreen === ScreenId.Docs && (
              <DocsRag />
            )}
            {activeScreen === ScreenId.Analyst && (
              <DataAnalyst />
            )}
            {activeScreen === ScreenId.Bills && (
              <Bills />
            )}
            {(activeScreen === ScreenId.Discover || activeScreen === ScreenId.Trends || activeScreen === ScreenId.Daily) && (
              <Discover initial={activeScreen === ScreenId.Trends ? "trends" : navIntent === "influencers" ? "influencers" : "daily"} />
            )}
            {activeScreen === ScreenId.Help && (
              <Help onNavigate={handleNavigate} />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Mobile Bottom Navigation Bar — same order as the header */}
      <nav className="fixed bottom-0 left-0 w-full md:hidden bg-[#0f131f]/90 backdrop-blur-md border-t border-white/10 z-40 flex justify-around items-center h-16 pb-safe">
        {[
          { screen: ScreenId.Core, label: "HOME", Icon: LayoutGrid, active: activeScreen === ScreenId.Core },
          { screen: ScreenId.Jobs, label: "JOBS", Icon: Briefcase, active: activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis },
          { screen: ScreenId.Insights, label: "STATS", Icon: BarChart3, active: activeScreen === ScreenId.Insights },
          { screen: ScreenId.Docs, label: "DOCS", Icon: FileText, active: activeScreen === ScreenId.Docs },
          { screen: ScreenId.Analyst, label: "DATA", Icon: Table2, active: activeScreen === ScreenId.Analyst },
          { screen: ScreenId.Bills, label: "BILLS", Icon: Wallet, active: activeScreen === ScreenId.Bills },
          { screen: ScreenId.Assistant, label: "JARVIS", Icon: Bot, active: activeScreen === ScreenId.Assistant },
          { screen: ScreenId.Discover, label: "DISCOVER", Icon: Compass, active: activeScreen === ScreenId.Discover || activeScreen === ScreenId.Trends || activeScreen === ScreenId.Daily },
        ].map(({ screen, label, Icon, active }) => (
          <button
            key={label}
            onClick={() => handleNavigate(screen)}
            className={`flex flex-col items-center justify-center flex-1 h-full cursor-pointer transition-colors ${active ? "text-[#8aebff] nav-active-glow" : "text-[#bbc9cd]"}`}
          >
            <Icon className="w-5.5 h-5.5" />
            <span className="text-[10px] font-mono mt-1 font-bold">{label}</span>
          </button>
        ))}
      </nav>

      {/* App-wide voice conversation control */}
      <VoiceDock agent={voice} />

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

      {/* Secret Project Believer Encrypted Diary Modal */}
      <ProjectBelieverModal
        isOpen={isBelieverOpen}
        onClose={() => setIsBelieverOpen(false)}
      />
    </div>
  );
}

