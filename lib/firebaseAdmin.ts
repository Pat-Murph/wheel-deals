// lib/firebaseAdmin.ts
import { getApps, initializeApp, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import fs from "fs";

let _app: App | null = null;
let _db: Firestore | null = null;

function loadServiceAccount(): object {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");

  // If it looks like a file path (not JSON)
  if (!raw.trim().startsWith("{")) {
    const file = raw.trim();
    if (!fs.existsSync(file)) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON looks like a file path but was not found: ${file}`
      );
    }
    return JSON.parse(fs.readFileSync(file, "utf8"));
  }

  return JSON.parse(raw);
}

function getAdminApp(): App {
  if (!_app) {
    const apps = getApps();
    if (apps.length > 0) {
      _app = apps[0];
    } else {
      _app = initializeApp({ credential: cert(loadServiceAccount() as any) });
    }
  }
  return _app;
}

export function getAdminDb(): Firestore {
  if (!_db) {
    getAdminApp();
    _db = getFirestore();
  }
  return _db;
}

// Lazy proxy — only initializes when a property is accessed at runtime
export const adminDb = new Proxy({} as Firestore, {
  get(_target, prop) {
    return (getAdminDb() as any)[prop];
  },
});
