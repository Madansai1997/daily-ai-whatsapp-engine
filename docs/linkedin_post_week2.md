# LinkedIn Post — Career Copilot JARVIS (Advanced Updates)

> **Honesty Check**: Every engineering claim below is backed by live code in the repo.
> Use this post to share your progress as a Data Analyst leveling up into AI/Software Engineering.

---

## LinkedIn Post Draft

Building a standard AI chatbot is easy. Building a browser-native Python execution sandbox that parses Excel sheets 10–40x faster, automates your CRM via Gmail, and alerts you in real-time when it deploys—all on 100% free-tier infra—is where the real engineering begins.

I've been building **JARVIS**—my multi-agent AI career copilot. Over the last two weeks, I took the project a step further by focusing on client-side compute, robust WASM parsing, and real-time app notifications.

Here is the breakdown of the latest infrastructure additions:

### 🐍 In-Browser Python Sandbox (Pyodide WASM)
Instead of executing user data queries on a costly, vulnerable server instance, JARVIS executes code directly in the user's browser sandbox using Pyodide WebAssembly.
*   **Rust-Backed Parsing**: Excel parsing in WebAssembly is notoriously slow. I optimized this by integrating `python-calamine` (a Rust-backed Excel reader) with an automatic `openpyxl` fallback, reducing file ingestion latency by up to 40x.
*   **Relationship Discovery**: When multiple sheets are uploaded, the engine automatically analyzes column overlap and cardinality to suggest candidate join keys and detect data quality issues.
*   **IndexedDB Turn Persistence**: Analysis history (Python code, results, charts, and executive briefs) is saved locally in IndexedDB transactions, surviving page refreshes with zero server-side storage cost.

### 📬 Auto-Updating Kanban CRM
I built an email tracking pipeline that acts as a background updater for my application tracker.
*   **Gmail Scans**: Twice daily, it scans my inbox for update emails from active companies (interviews, follow-ups, rejections).
*   **Confidence Gates**: High-confidence matches automatically move cards on my Kanban board. Ambiguous or low-confidence matches are parked in a "Needs your confirmation" queue to prevent silent state corruption.

### 🚀 Zero-Downtime Deployment Webhooks
Vite cache-busts production bundles with hashed filenames. If the app is open when a deploy happens, the user runs outdated code until they refresh.
*   I built a Render deploy webhook endpoint in the FastAPI backend that receives real-time build statuses.
*   When a deploy succeeds, JARVIS triggers a browser notification and shows a system modal inside the app: *"The deployment has completed successfully, sir. Refresh the console to apply updates."*
*   Clicking the button unregisters the service worker, flushes browser caches, and hard-reloads the page to boot up the new production code immediately.

---

### The Engineering Takeaway
If you want to keep your hosting bills at $0, move as much compute to the edge (the client's browser) as possible. Sandboxed WASM, IndexedDB persistence, and smart webhooks allow a free-tier 512MB Render server to run a heavyweight analytical and scheduling workspace without ever hitting an OOM (Out of Memory) limit.

📂 Open-source code: <repo link>
🚀 Live console (read-only demo): <demo link>

#AIEngineering #WebAssembly #Python #FastAPI #React #BuildInPublic #SoftwareEngineering
