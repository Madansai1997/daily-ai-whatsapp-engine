/**
 * Shared types and configurations for JARVIS Core
 */

export enum ScreenId {
  Core = "core",
  Assistant = "assistant",
  Jobs = "jobs",
  Terminal = "terminal",
  AtsAnalysis = "ats_analysis",
  Insights = "insights",
  Bills = "bills",
  Trends = "trends",
  Daily = "daily",
  Discover = "discover",
  Help = "help"
}

export interface ChatMessage {
  id: string;
  sender: "JARVIS" | "User_Admin";
  time: string;
  content: string;
  codeBlock?: {
    title: string;
    lines: string[];
  };
}

export interface JobCard {
  id: string;
  title: string;
  company: string;
  location: string;
  atsScore: number;
  remote?: boolean;
  round?: string;
  actionRequired?: boolean;
  isClosed?: boolean;
}

export interface JobColumn {
  id: string;
  title: string;
  count: string;
  accentClass: string;
  opacityClass?: string;
  grayscale?: boolean;
  cards: JobCard[];
}

export interface SystemLog {
  id: string;
  time: string;
  tag: "SEC_INIT" | "WARN_RES" | "SYS_UP" | "DB_SYNC" | string;
  content: string;
  colorClass: string;
}
