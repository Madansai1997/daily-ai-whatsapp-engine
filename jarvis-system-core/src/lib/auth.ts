/* JARVIS PIN-lock auth. The token lives in memory ONLY (never localStorage/cookie),
 * so a refresh or reopen always re-prompts for the PIN ("lock every visit"). */

import { demoResponse } from "./demoFixtures";

let token: string | null = null;
let demo = false; // demo session → serve sample fixtures locally, never touch real data
let onUnauth: (() => void) | null = null;

export function setUnauthHandler(fn: () => void) {
  onUnauth = fn;
}

export function isDemo(): boolean {
  return demo;
}

export async function authStatus(): Promise<{ required: boolean; demo_available?: boolean }> {
  try {
    const res = await window.fetch("/auth/status");
    return await res.json();
  } catch {
    return { required: false };
  }
}

export async function login(pin: string): Promise<{ ok: boolean; error?: string; demo?: boolean }> {
  try {
    const res = await window.fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      token = data.token || "";
      demo = !!data.demo; // empty token + demo flag → read-only demo session
      return { ok: true, demo };
    }
    return { ok: false, error: data.error || "Incorrect PIN." };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

/** Keyless "Explore the demo" login — the guest never needs the demo PIN. */
export async function loginDemo(): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await window.fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ demo: true }),
    });
    const data = await res.json();
    if (res.ok && data.ok && data.demo) {
      token = data.token || "";
      demo = true;
      return { ok: true };
    }
    return { ok: false, error: data.error || "Demo unavailable." };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

export function logout() {
  token = null;
  demo = false;
  if (onUnauth) onUnauth();
}

/**
 * Wrap window.fetch once so every request across the app carries the in-memory
 * token, and any 401 (expired/invalid session) trips the re-lock. Installed at
 * startup — no need to touch individual fetch calls.
 */
export function installFetchInterceptor() {
  const orig = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
    // Demo session: resolve data requests from bundled fixtures instead of the network,
    // so the empty demo token never triggers a 401 and no real data is ever fetched.
    if (demo) {
      const method = (init.method || (input instanceof Request ? input.method : "GET") || "GET").toString();
      const canned = demoResponse(url, method);
      if (canned) return canned;
    }
    const headers = new Headers(init.headers || {});
    if (token) {
      headers.set("X-Jarvis-Token", token);
      headers.set("Authorization", `Bearer ${token}`);
    }
    const res = await orig(input, { ...init, headers });
    if (res.status === 401) {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      if (!url.includes("/auth/")) {
        token = null;
        if (onUnauth) onUnauth();
      }
    }
    return res;
  };
}

export function getToken(): string | null {
  return token;
}
