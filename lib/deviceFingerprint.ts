/**
 * Generates a stable device fingerprint from browser properties.
 * Uses multiple persistence layers to survive sign-out, localStorage clear, etc.
 * 
 * Persistence layers (checked in order):
 * 1. localStorage (fastest)
 * 2. sessionStorage (survives page reload within session)
 * 3. IndexedDB (survives localStorage clear)
 * 4. Recomputed from hardware signals (fallback)
 * 
 * The fingerprint is deterministic from hardware signals, so even if all storage
 * is cleared, the same device will produce the same fingerprint.
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
    String(screen.availWidth ?? ""),
    String(screen.availHeight ?? ""),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    String(new Date().getTimezoneOffset()),
    nav.platform ?? "",
    String((nav as any).maxTouchPoints ?? ""),
    // WebGL renderer (very stable per device)
    getWebGLRenderer(),
  ].join("|");
  return signals;
}

function getWebGLRenderer(): string {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
    if (!gl) return "";
    const debugInfo = (gl as WebGLRenderingContext).getExtension("WEBGL_debug_renderer_info");
    if (!debugInfo) return "";
    return (gl as WebGLRenderingContext).getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) ?? "";
  } catch {
    return "";
  }
}

const LS_KEY = "wd_device_fp";
const SS_KEY = "wd_device_fp_s";
const IDB_STORE = "wd_fp_store";
const IDB_KEY = "device_fp";

/**
 * Try to read from IndexedDB
 */
async function readFromIDB(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("WheelDealsFingerprint", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, "readonly");
          const store = tx.objectStore(IDB_STORE);
          const getReq = store.get(IDB_KEY);
          getReq.onsuccess = () => {
            const val = getReq.result;
            resolve(val && typeof val === "string" && val.length === 32 ? val : null);
          };
          getReq.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
      // Timeout after 500ms
      setTimeout(() => resolve(null), 500);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Write to IndexedDB
 */
async function writeToIDB(fp: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open("WheelDealsFingerprint", 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) {
          db.createObjectStore(IDB_STORE);
        }
      };
      req.onsuccess = () => {
        try {
          const db = req.result;
          const tx = db.transaction(IDB_STORE, "readwrite");
          const store = tx.objectStore(IDB_STORE);
          store.put(fp, IDB_KEY);
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        } catch {
          resolve();
        }
      };
      req.onerror = () => resolve();
      setTimeout(() => resolve(), 500);
    } catch {
      resolve();
    }
  });
}

export async function getDeviceFingerprint(): Promise<string> {
  // Layer 1: localStorage (fastest)
  try {
    const cached = localStorage.getItem(LS_KEY);
    if (cached && cached.length === 32) return cached;
  } catch { /* ignore */ }

  // Layer 2: sessionStorage
  try {
    const cached = sessionStorage.getItem(SS_KEY);
    if (cached && cached.length === 32) {
      // Re-persist to localStorage
      try { localStorage.setItem(LS_KEY, cached); } catch {}
      return cached;
    }
  } catch { /* ignore */ }

  // Layer 3: IndexedDB (survives localStorage clear)
  const idbFp = await readFromIDB();
  if (idbFp) {
    // Re-persist to localStorage and sessionStorage
    try { localStorage.setItem(LS_KEY, idbFp); } catch {}
    try { sessionStorage.setItem(SS_KEY, idbFp); } catch {}
    return idbFp;
  }

  // Layer 4: Recompute from hardware signals
  const signals = collectSignals();
  const fp = await hashString(signals);

  // Persist to all layers
  try { localStorage.setItem(LS_KEY, fp); } catch {}
  try { sessionStorage.setItem(SS_KEY, fp); } catch {}
  await writeToIDB(fp);

  return fp;
}

/**
 * Also track free deal claims in localStorage as a client-side gate.
 * This provides immediate feedback without a server round-trip and
 * acts as an additional anti-abuse layer.
 */
const CLAIM_KEY_PREFIX = "wd_boost_claimed_";

export function hasClaimedBoostLocally(merchantId: string, boostCycleId: string): boolean {
  try {
    const key = CLAIM_KEY_PREFIX + merchantId;
    const data = localStorage.getItem(key);
    if (!data) return false;
    const parsed = JSON.parse(data);
    return parsed.cycleId === boostCycleId;
  } catch {
    return false;
  }
}

export function markBoostClaimedLocally(merchantId: string, boostCycleId: string): void {
  try {
    const key = CLAIM_KEY_PREFIX + merchantId;
    localStorage.setItem(key, JSON.stringify({
      cycleId: boostCycleId,
      claimedAt: Date.now(),
    }));
  } catch { /* ignore */ }
}
