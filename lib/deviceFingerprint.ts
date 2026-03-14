/**
 * Generates a stable device fingerprint from browser properties.
 * Persisted in localStorage so it survives page reloads.
 * Survives app reinstall only if the browser's localStorage is cleared —
 * combined with server-side Firestore tracking this gives strong 1-per-device enforcement.
 */

async function hashString(str: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(str);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

function collectSignals(): string {
  const nav = navigator;
  const signals = [
    nav.userAgent,
    nav.language,
    nav.languages?.join(",") ?? "",
    String(nav.hardwareConcurrency ?? ""),
    String((nav as any).deviceMemory ?? ""),
    String(screen.width),
    String(screen.height),
    String(screen.colorDepth),
    String(screen.pixelDepth),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(new Date().getTimezoneOffset()),
  ].join("|");
  return signals;
}

const LS_KEY = "wd_device_fp";

export async function getDeviceFingerprint(): Promise<string> {
  // Return cached fingerprint if available
  try {
    const cached = localStorage.getItem(LS_KEY);
    if (cached && cached.length === 32) return cached;
  } catch { /* ignore */ }

  const signals = collectSignals();
  const fp = await hashString(signals);

  try {
    localStorage.setItem(LS_KEY, fp);
  } catch { /* ignore */ }

  return fp;
}
