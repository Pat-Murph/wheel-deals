import {
  collection,
  doc,
  getDocs,
  increment,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db } from "./firebase";
import { ensureAnonAuth } from "./auth";

export type SpinStatus = "issued" | "redeemed";

export type SpinDoc = {
  uid: string;
  merchantId: string;
  prizeLabel: string;
  code: string;
  status: SpinStatus;

  // YYYY-MM-DD (local day). Used for daily limit + reporting.
  dateKey: string;

  // created by server
  createdAt: any;

  // redemption fields
  redeemedAt?: any;

  // expires 7 days after issue
  expiresAt: Timestamp;
};

export function generateCode() {
  const part = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `WD-${part}`;
}

function todayKeyLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function expiresAtInDays(days: number) {
  const ms = Date.now() + days * 24 * 60 * 60 * 1000;
  return Timestamp.fromDate(new Date(ms));
}

/**
 * Per-merchant daily limit:
 * users/{uid}/merchantLimits/{merchantId}/days/{dateKey}
 *   { merchantId, dateKey, remaining }
 *
 * Also writes:
 * spins/{spinId} (issued)
 * merchantStats/{merchantId}/daily/{dateKey} { spinsCount }
 * userMerchantStats/{uid}_{merchantId}/daily/{dateKey} { spinsCount }
 */
export async function createSpin(params: {
  merchantId: string;
  prizeLabel: string;
  dailyLimit?: number; // default 3
}) {
  const user = await ensureAnonAuth();
  const uid = user.uid;

  const dateKey = todayKeyLocal();
  const dailyLimit = params.dailyLimit ?? 3;

  const code = generateCode();
  const expiresAt = expiresAtInDays(7);

  const limitRef = doc(
    db,
    "users",
    uid,
    "merchantLimits",
    params.merchantId,
    "days",
    dateKey
  );

  const spinRef = doc(collection(db, "spins")); // pre-generate id

  const merchantDailyRef = doc(db, "merchantStats", params.merchantId, "daily", dateKey);

  const userMerchantDailyRef = doc(
    db,
    "userMerchantStats",
    `${uid}_${params.merchantId}`,
    "daily",
    dateKey
  );

  const res = await runTransaction(db, async (tx) => {
    const limitSnap = await tx.get(limitRef);

    let remaining: number;

    if (!limitSnap.exists()) {
      // first spin today for this merchant => initialize at dailyLimit
      remaining = dailyLimit;

      tx.set(limitRef, {
        merchantId: params.merchantId,
        dateKey,
        remaining: dailyLimit,
        updatedAt: serverTimestamp(),
      });
    } else {
      const data = limitSnap.data() as any;
      remaining = Number(data.remaining ?? 0);
    }

    if (remaining <= 0) {
      throw new Error("Daily limit reached for this merchant.");
    }

    // decrement by 1
    tx.update(limitRef, {
      remaining: remaining - 1,
      updatedAt: serverTimestamp(),
    });

    // create issued spin
    tx.set(spinRef, {
      uid,
      merchantId: params.merchantId,
      prizeLabel: params.prizeLabel,
      code,
      status: "issued",
      dateKey,
      createdAt: serverTimestamp(),
      expiresAt,
    } satisfies SpinDoc);

    // payout-ready daily counts (issued spins)
    tx.set(
      merchantDailyRef,
      {
        merchantId: params.merchantId,
        dateKey,
        spinsCount: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      userMerchantDailyRef,
      {
        uid,
        merchantId: params.merchantId,
        dateKey,
        spinsCount: increment(1),
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    return { id: spinRef.id, code, remainingAfter: remaining - 1, expiresAt };
  });

  return res;
}

/**
 * Redeem a spin by code (one-time).
 * Returns:
 * - not_found
 * - already_redeemed
 * - expired
 * - ok
 */
export async function redeemSpinByCode(code: string) {
  const cleaned = (code || "").trim().toUpperCase();

  const q = query(collection(db, "spins"), where("code", "==", cleaned), limit(1));
  const snap = await getDocs(q);

  if (snap.empty) return { ok: false as const, reason: "not_found" as const };

  const d = snap.docs[0];
  const data = d.data() as any;

  if (data.status === "redeemed") {
    return { ok: false as const, reason: "already_redeemed" as const };
  }

  // Expiration check
  const exp: any = data.expiresAt;
  const expMs =
    exp?.toMillis?.() ?? (exp?.seconds ? exp.seconds * 1000 : null);

  if (expMs && Date.now() > expMs) {
    return { ok: false as const, reason: "expired" as const };
  }

  await updateDoc(doc(db, "spins", d.id), {
    status: "redeemed",
    redeemedAt: serverTimestamp(),
  });

  return {
    ok: true as const,
    prizeLabel: data.prizeLabel as string,
    merchantId: data.merchantId as string,
  };
}
