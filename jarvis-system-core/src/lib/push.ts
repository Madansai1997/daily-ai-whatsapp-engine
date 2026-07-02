/* Web Push helpers — subscribe this browser/device to JARVIS notifications. */

function urlB64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushPermission(): NotificationPermission | "unsupported" {
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission;
}

export function pushSupported(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function enablePush(): Promise<{ ok: boolean; message: string }> {
  if (!pushSupported()) {
    return { ok: false, message: "This browser doesn't support push notifications." };
  }
  const permission = await Notification.requestPermission();
  if (permission !== "granted") {
    return { ok: false, message: "Notification permission was denied." };
  }

  const keyRes = await fetch("/api/push/vapid-public-key");
  const keyData = await keyRes.json();
  if (!keyData.enabled || !keyData.key) {
    return { ok: false, message: "Push isn't configured on the server yet." };
  }

  const reg = await navigator.serviceWorker.register("/console/sw.js", { scope: "/console/" });
  await navigator.serviceWorker.ready;

  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlB64ToUint8Array(keyData.key),
    });
  }

  const res = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub),
  });
  if (!res.ok) return { ok: false, message: "Couldn't save the subscription." };
  return { ok: true, message: "Notifications enabled on this device." };
}

export async function sendTestPush(): Promise<void> {
  await fetch("/api/push/test", { method: "POST" });
}
