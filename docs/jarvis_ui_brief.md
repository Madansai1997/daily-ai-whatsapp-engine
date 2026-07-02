# JARVIS UI — Functional Brief (for a Stitch redesign)

Paste this into Google Stitch as context, then add your new design direction. This describes
WHAT each screen does (the functional requirements) — not how it currently looks — so Stitch
is free to redesign the visuals while keeping every capability.

## The app
JARVIS is a single-user personal AI assistant. One web page (`/chat`) with a top header
(logo + horizontal tab bar + a live status indicator) and a tabbed body. Used on phone and
desktop. Five tabs: **JARVIS**, **PrivaChat**, **Terminal**, **Jobs**.

## Screen 1 — JARVIS (AI chat)
- A conversation view: user messages vs. assistant messages, visually distinct.
- Bottom input bar: text field ("Message JARVIS…"), a microphone (voice input) button, a
  voice-output on/off toggle, and a Send button.
- The assistant can speak replies aloud (voice toggle state matters).
- Header shows a small "online" status pulse.

## Screen 2 — Jobs (application tracker + résumé ATS) — the flagship
- **Kanban board** of job applications. Columns by status: Interested, Applied, Interviewing,
  Offer, Accepted, Rejected — each column shows a count.
- **Job card:** job title, company · location, a status selector (moves it between columns),
  an "open posting" link, a "🎯 ATS analysis" action, and a remove action.
- **Toolbar:** "Applications (n)" label, a "Résumé" button (opens résumé editor), a refresh.
- A small **notification badge** on the Jobs tab shows count of new/un-viewed ATS analyses.

### Modal A — ATS Alignment Analysis (opens from a card's 🎯 action)
- Header: title, target job (title/company/location), and a large **match score X/100**.
- **Tab 1 — Keyword Matrix:** table of keywords the job requires, each marked present or
  missing (missing = an honest gap, shown in a warning color).
- **Tab 2 — STAR/XYZ Plan:** a list of résumé bullets, each showing a "Current" line and an
  "Optimized" line (a before→after delta), with a short note on what was weak.
- A prominent **"Download Optimized Text File"** button.

### Modal B — Master Résumé editor (opens from the "Résumé" button)
- A large plain-text textarea to paste/edit the résumé, and a Save button.

## Screen 3 — Terminal
- A scrolling command/output log (technical/monospace feel).
- Input row: a prompt symbol, a text field, a file-upload (PDF) action, and a "secure mode"
  lock action.

## Screen 4 — PrivaChat
- An embedded private chat panel. Shows an unread-count badge on its tab, and a small
  on/off toggle to disconnect it.

## Interaction notes for the designer
- Mobile-first; the kanban board scrolls horizontally on small screens.
- Modals overlay the current tab; everything is one page (no full navigations).
- The status badge and ATS badge are the two "notification" affordances.

## What stays the same (functional contracts — do NOT drop)
Every tab, every card action (status change, ATS, remove), both modals, the two badges, and the
download button must exist in the redesign. The visual language is fully open to change.
