// lib/firebaseAdmin.ts
import { getApps, initializeApp, cert } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import fs from "fs";

function loadServiceAccount(): any {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT_JSON");

  // If they put a file path like: secrets/firebase-adminsdk.json
  if (raw.trim().startsWith("{") === false) {
    const file = raw.trim();
    if (!fs.existsSync(file)) {
      throw new Error(
        `FIREBASE_SERVICE_ACCOUNT_JSON looks like a file path but was not found: ${file}`
      );
    }
    const txt = fs.readFileSync(file, "utf8");
    return JSON.parse(txt);
  }

  // Otherwise treat it as raw JSON string
  return JSON.parse(raw);
}

function getAdminDb() {
  if (!getApps().length) {
    const svc = loadServiceAccount();
    initializeApp({ credential: cert(svc) });
  }
  return getFirestore();
}

export const adminDb = getAdminDb();
