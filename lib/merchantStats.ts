// lib/merchantStats.ts
import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

export async function findMerchantIdForUser(uid: string) {
  const userRef = doc(db, "users", uid);
  const snap = await getDoc(userRef);
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return (data.merchantId as string) ?? null;
}

export async function getMerchantName(merchantId: string) {
  const ref = doc(db, "merchants", merchantId);
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

/**
 * Year-to-date (Jan 1 -> today) date keys in local time, formatted YYYY-MM-DD.
 */
export function ytdKeysLocal() {
  const out: string[] = [];
  const now = new Date();

  const start = new Date(now.getFullYear(), 0, 1); // Jan 1 local
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
  const ref = doc(db, "merchantStats", merchantId, "daily", dateKey);
  const snap = await getDoc(ref);

  if (!snap.exists()) return { dateKey, spinsCount: 0, revenueCents: 0 };

  const data = snap.data() as any;
  return {
    dateKey,
    spinsCount: Number(data.spinsCount ?? 0),
    revenueCents: Number(data.revenueCents ?? 0),
  };
}
