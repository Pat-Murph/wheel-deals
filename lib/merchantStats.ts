import { doc, getDoc } from "firebase/firestore";
import { db } from "./firebase";

// ✅ Keep the name your page imports/calls
export async function findMerchantIdForUser(uid: string) {
  const merchantId = "3ZpM9h6FwdSgktZyN54J"; // Demo Pizza

  const staffRef = doc(db, "merchants", merchantId, "staff", uid);
  const snap = await getDoc(staffRef);

  if (!snap.exists()) return null;

  const data = snap.data() as any;
  if (data.active !== true) return null;

  return merchantId;
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

export async function getMerchantDaily(merchantId: string, dateKey: string) {
  const ref = doc(db, "merchantStats", merchantId, "daily", dateKey);
  const snap = await getDoc(ref);
  if (!snap.exists()) return { dateKey, spinsCount: 0 };
  const data = snap.data() as any;
  return { dateKey, spinsCount: Number(data.spinsCount ?? 0) };
}
