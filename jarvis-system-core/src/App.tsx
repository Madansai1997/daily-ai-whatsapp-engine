import React, { useState } from "react";
import { ScreenId } from "./types";
import Header from "./components/Header";
import Footer from "./components/Footer";
import CoreInterface from "./components/CoreInterface";
import SecureChat from "./components/SecureChat";
import PrivaChat from "./components/PrivaChat";
import JobsBoard from "./components/JobsBoard";
import SystemTerminal from "./components/SystemTerminal";
import { AnimatePresence, motion } from "motion/react";

export default function App() {
  const [activeScreen, setActiveScreen] = useState<ScreenId>(ScreenId.Core);
  const [prevScreen, setPrevScreen] = useState<ScreenId>(ScreenId.Core);

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
    const screenOrder = [ScreenId.Core, ScreenId.Assistant, ScreenId.Chat, ScreenId.Terminal, ScreenId.Jobs];
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

  return (
    <div className="relative min-h-screen bg-[#0a0e1a] text-[#dfe2f3] bg-hud-cinematic selection:bg-[#22d3ee]/20 selection:text-[#8aebff] flex flex-col justify-between overflow-x-hidden">
      {/* Scanline atmospheric lighting overlay */}
      <div className="scanline"></div>
      
      {/* Dark tint backing to enhance grid line and card readability */}
      <div className="fixed inset-0 bg-[#0a0e1a]/45 pointer-events-none z-0"></div>

      {/* Unified HUD Header Navigation bar */}
      <Header activeScreen={activeScreen} onNavigate={handleNavigate} />

      {/* Dynamic Main Stage Grid Area */}
      <main className="flex-1 w-full max-w-[1440px] mx-auto px-6 sm:px-8 pt-24 pb-8 relative z-10 cyber-grid flex flex-col justify-start">
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
              <CoreInterface onNavigate={handleNavigate} />
            )}
            {activeScreen === ScreenId.Assistant && (
              <SecureChat />
            )}
            {activeScreen === ScreenId.Chat && (
              <PrivaChat />
            )}
            {(activeScreen === ScreenId.Jobs || activeScreen === ScreenId.AtsAnalysis) && (
              <JobsBoard activeScreen={activeScreen} onNavigate={handleNavigate} />
            )}
            {activeScreen === ScreenId.Terminal && (
              <SystemTerminal />
            )}
          </motion.div>
        </AnimatePresence>
      </main>

      {/* Unified Footer details */}
      <Footer />
    </div>
  );
}
