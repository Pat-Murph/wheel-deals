// A random installation ID avoids false matches between iPhones with identical
// Safari/hardware properties. This is a browser-profile identifier, not a
// permanent hardware identifier: clearing all site/app data creates a new one.
// The authenticated customer UID is independently checked by the Boost API.
const LS_KEY = "wd_device_fp_v2";
const SS_KEY = "wd_device_fp_v2_s";
const DB_NAME = "WheelDealsFingerprint";
const IDB_STORE = "wd_fp_store";
const IDB_KEY = "device_fp_v2";
const ID_PATTERN = /^v2_[0-9a-f]{32}$/;

function validId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}

async function readFromIDB(): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      const timer = setTimeout(() => resolve(null), 1500);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const getReq = db.transaction(IDB_STORE, "readonly").objectStore(IDB_STORE).get(IDB_KEY);
          getReq.onsuccess = () => {
            clearTimeout(timer);
            resolve(validId(getReq.result) ? getReq.result : null);
            db.close();
          };
          getReq.onerror = () => { clearTimeout(timer); resolve(null); db.close(); };
        } catch {
          clearTimeout(timer);
          resolve(null);
          db.close();
        }
      };
      req.onerror = () => { clearTimeout(timer); resolve(null); };
    } catch {
      resolve(null);
    }
  });
}

async function writeToIDB(id: string): Promise<void> {
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, 1);
      const timer = setTimeout(resolve, 1500);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
      };
      req.onsuccess = () => {
        const db = req.result;
        try {
          const tx = db.transaction(IDB_STORE, "readwrite");
          tx.objectStore(IDB_STORE).put(id, IDB_KEY);
          tx.oncomplete = () => { clearTimeout(timer); resolve(); db.close(); };
          tx.onerror = () => { clearTimeout(timer); resolve(); db.close(); };
        } catch {
          clearTimeout(timer);
          resolve();
          db.close();
        }
      };
      req.onerror = () => { clearTimeout(timer); resolve(); };
    } catch {
      resolve();
    }
  });
}

function newInstallationId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return "v2_" + Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

let pendingId: Promise<string> | null = null;

async function loadInstallationId(): Promise<string> {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (validId(saved)) return saved;
  } catch { /* Safari may block storage. */ }

  try {
    const saved = sessionStorage.getItem(SS_KEY);
    if (validId(saved)) {
      try { localStorage.setItem(LS_KEY, saved); } catch { /* ignore */ }
      return saved;
    }
  } catch { /* ignore */ }

  const stored = await readFromIDB();
  const id = stored ?? newInstallationId();
  try { localStorage.setItem(LS_KEY, id); } catch { /* ignore */ }
  try { sessionStorage.setItem(SS_KEY, id); } catch { /* ignore */ }
  if (!stored) await writeToIDB(id);
  return id;
}

export function getDeviceFingerprint(): Promise<string> {
  if (!pendingId) {
    pendingId = loadInstallationId().catch((error: unknown) => {
      pendingId = null;
      throw error;
    });
  }
  return pendingId;
}

// Fast client feedback only; the authenticated server is authoritative.
const CLAIM_KEY_PREFIX = "wd_boost_claimed_";

export function hasClaimedBoostLocally(merchantId: string, boostCycleId: string): boolean {
  try {
    const data = localStorage.getItem(CLAIM_KEY_PREFIX + merchantId);
    if (!data) return false;
    const parsed = JSON.parse(data);
    return parsed.cycleId === boostCycleId;
  } catch {
    return false;
  }
}

export function markBoostClaimedLocally(merchantId: string, boostCycleId: string): void {
  try {
    localStorage.setItem(CLAIM_KEY_PREFIX + merchantId, JSON.stringify({
      cycleId: boostCycleId,
      claimedAt: Date.now(),
    }));
  } catch { /* ignore */ }
}
