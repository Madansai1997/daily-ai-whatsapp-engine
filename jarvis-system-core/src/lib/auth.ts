/* JARVIS PIN-lock auth. The token lives in memory ONLY (never localStorage/cookie),
 * so a refresh or reopen always re-prompts for the PIN ("lock every visit"). */

let token: string | null = null;
let onUnauth: (() => void) | null = null;

export function setUnauthHandler(fn: () => void) {
  onUnauth = fn;
}

export async function authStatus(): Promise<{ required: boolean }> {
  try {
    const res = await window.fetch("/auth/status");
    return await res.json();
  } catch {
    return { required: false };
  }
}

export async function login(pin: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await window.fetch("/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pin }),
    });
    const data = await res.json();
    if (res.ok && data.ok) {
      token = data.token || "";
      return { ok: true };
    }
    return { ok: false, error: data.error || "Incorrect PIN." };
  } catch {
    return { ok: false, error: "Couldn't reach the server." };
  }
}

export function logout() {
  token = null;
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
    const headers = new Headers(init.headers || {});
    if (token) headers.set("X-Jarvis-Token", token);
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
