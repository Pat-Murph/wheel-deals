// lib/merchantStats.ts
import {
  doc,
  getDoc,
  collection,
  getDocs,
  query,
  where,
  documentId, // ✅ FIX: use documentId() instead of FieldPath.documentId()
} from "firebase/firestore";
import { getDb } from "./firebase";

export async function findMerchantIdForUser(uid: string) {
  const userRef = doc(getDb(), "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return (data.merchantId as string) ?? null;
}

export async function getMerchantName(merchantId: string) {
  const ref = doc(getDb(), "merchants", merchantId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return (data.name as string) ?? null;
}

export function todayKeyLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function lastNDaysKeysLocal(n: number) {
  const out: string[] = [];
  const base = new Date();
  for (let i = 0; i < n; i++) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
  }
  return out;
}

export function ytdKeysLocal() {
  const out: string[] = [];
  const now = new Date();

  const start = new Date(now.getFullYear(), 0, 1);
  const d = new Date(start);

  while (d <= now) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
    d.setDate(d.getDate() + 1);
  }

  return out;
}

export async function getMerchantDaily(merchantId: string, dateKey: string) {
  const ref = doc(getDb(), "merchantStats", merchantId, "daily", dateKey);
  const snap = await getDoc(ref);

  if (!snap.exists()) return { dateKey, spinsCount: 0, revenueCents: 0 };

  const data = snap.data() as any;
  return {
    dateKey,
    spinsCount: Number(data.spinsCount ?? 0),
    revenueCents: Number(data.revenueCents ?? 0),
  };
}

/** month is 0-based (0=Jan ... 11=Dec) */
export function monthKeysLocal(year: number, month: number) {
  const out: string[] = [];
  const d = new Date(year, month, 1);
  while (d.getMonth() === month) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    out.push(`${yyyy}-${mm}-${dd}`);
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export type MerchantDailyStat = {
  dateKey: string;
  spinsCount: number;
  revenueCents: number;
};

/**
 * ✅ Fetch all existing daily docs for a month in ONE query.
 * Returns a map keyed by dateKey.
 */
export async function getMerchantMonthDailyMap(
  merchantId: string,
  year: number,
  month: number
): Promise<{ keys: string[]; map: Record<string, MerchantDailyStat> }> {
  const keys = monthKeysLocal(year, month);
  if (!keys.length) return { keys: [], map: {} };

  const startKey = keys[0];
  const endKey = keys[keys.length - 1];

  const dailyCol = collection(getDb(), "merchantStats", merchantId, "daily");

  const qy = query(
    dailyCol,
    where(documentId(), ">=", startKey), // ✅ FIX
    where(documentId(), "<=", endKey)    // ✅ FIX
  );

  const snap = await getDocs(qy);

  const map: Record<string, MerchantDailyStat> = {};
  snap.forEach((docSnap) => {
    const data = docSnap.data() as any;
    const dateKey = docSnap.id;

    map[dateKey] = {
      dateKey,
      spinsCount: Number(data.spinsCount ?? 0),
      revenueCents: Number(data.revenueCents ?? 0),
    };
  });

  return { keys, map };
}
