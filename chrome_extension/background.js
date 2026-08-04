// JARVIS Extension Background Service Worker

const DEFAULT_SERVER = "https://daily-ai-whatsapp-engine.onrender.com";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ serverUrl: DEFAULT_SERVER });
  console.log("⚡ JARVIS Career Copilot Extension Installed!");
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "GET_PROFILE") {
    chrome.storage.local.get(["serverUrl"], async (data) => {
      let baseUrl = (data.serverUrl || DEFAULT_SERVER).trim().replace(/\/$/, "");
      if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
        baseUrl = "https://" + baseUrl;
      }
      try {
        const res = await fetch(`${baseUrl}/api/extension/profile`);
        const json = await res.json();
        sendResponse(json);
      } catch (e) {
        console.error("GET_PROFILE fetch error:", e);
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true; // Keep async channel open
  }

  if (request.type === "ANSWER_QUESTION") {
    chrome.storage.local.get(["serverUrl"], async (data) => {
      const baseUrl = data.serverUrl || DEFAULT_SERVER;
      try {
        const res = await fetch(`${baseUrl}/api/extension/answer-question`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload)
        });
        const json = await res.json();
        sendResponse(json);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  }

  if (request.type === "AUTOFILL_SCHEMA") {
    chrome.storage.local.get(["serverUrl"], async (data) => {
      let baseUrl = (data.serverUrl || DEFAULT_SERVER).trim().replace(/\/$/, "");
      if (!baseUrl.startsWith("http://") && !baseUrl.startsWith("https://")) {
        baseUrl = "https://" + baseUrl;
      }
      try {
        const res = await fetch(`${baseUrl}/api/extension/autofill-schema`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload)
        });
        const json = await res.json();
        sendResponse(json);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  }

  if (request.type === "SAVE_JOB") {
    chrome.storage.local.get(["serverUrl"], async (data) => {
      const baseUrl = data.serverUrl || DEFAULT_SERVER;
      try {
        const res = await fetch(`${baseUrl}/api/extension/save-active-job`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload)
        });
        const json = await res.json();
        sendResponse(json);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  }

  if (request.type === "MARK_APPLIED") {
    chrome.storage.local.get(["serverUrl"], async (data) => {
      const baseUrl = data.serverUrl || DEFAULT_SERVER;
      try {
        const res = await fetch(`${baseUrl}/api/extension/mark-applied`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request.payload)
        });
        const json = await res.json();
        sendResponse(json);
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    });
    return true;
  }
});
