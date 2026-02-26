// lib/spins.ts
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  setDoc,
  getDoc,
} from "firebase/firestore";
import { db } from "./firebase";
import { ensureCustomerAnonAuth } from "./auth";

export type SpinStatus = "issued" | "redeemed";

export type SpinDoc = {
  uid: string;
  merchantId: string;
  prizeLabel: string;
  code: string;
  status: SpinStatus;

  dateKey: string;

  createdAt: any;
  redeemedAt?: any;

  expiresAt: Timestamp;
};

function todayKeyLocal() {
  const d = new Date();
  return d.toISOString().slice(0, 10);
}

function expiresAtInDays(days: number) {
  return Timestamp.fromDate(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

function generateCode() {
  return `WD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Customer-paid spin creation
 * SAFE Firestore transaction:
 * - all reads first
 * - all writes second
 */
export async function createSpin(params: {
  merchantId: string;
  prizeLabel: string;
  dailyLimit?: number;
}) {
  const user = await ensureCustomerAnonAuth();
  const uid = user.uid;

  const dateKey = todayKeyLocal();
  const dailyLimit = params.dailyLimit ?? 8;

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

  const spinRef = doc(collection(db, "spins"));

  const txResult = await runTransaction(db, async (tx) => {
    // ✅ READS FIRST
    const limitSnap = await tx.get(limitRef);

    let remaining: number;

    if (!limitSnap.exists()) {
      remaining = dailyLimit;
    } else {
      remaining = Number(limitSnap.data()?.remaining ?? 0);
    }

    if (remaining <= 0) {
      throw new Error("Daily limit reached for this merchant.");
    }

    // ✅ WRITES SECOND
    tx.set(
      limitRef,
      {
        merchantId: params.merchantId,
        dateKey,
        remaining: remaining - 1,
        updatedAt: serverTimestamp(),
      },
      { merge: true }
    );

    tx.set(
      spinRef,
      {
        uid,
        merchantId: params.merchantId,
        prizeLabel: params.prizeLabel,
        code,
        status: "issued",
        dateKey,
        createdAt: serverTimestamp(),
        expiresAt,
      } satisfies SpinDoc
    );

    return {
      spinId: spinRef.id,
      code,
      remainingAfter: remaining - 1,
    };
  });

  // Stats update OUTSIDE transaction (never block issuing the code)
  incrementMerchantStats(params.merchantId, dateKey).catch((e) => {
    console.warn("incrementMerchantStats failed (non-blocking):", e);
  });

  return txResult;
}

/**
 * Merchant stats (non-transactional)
 * NOTE: This path MUST match what your dashboard reads:
 * merchantStats/{merchantId}/daily/{dateKey}
 */
async function incrementMerchantStats(merchantId: string, dateKey: string) {
  const ref = doc(db, "merchantStats", merchantId, "daily", dateKey);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, {
      merchantId,
      dateKey,
      spinsCount: 1,
      revenueCents: 70,
      updatedAt: serverTimestamp(),
    });
  } else {
    const data = snap.data() as any;
    await updateDoc(ref, {
      spinsCount: Number(data.spinsCount ?? 0) + 1,
      revenueCents: Number(data.revenueCents ?? 0) + 70,
      updatedAt: serverTimestamp(),
    });
  }
}

/**
 * Redeem a spin by code (merchant-only via rules)
 */
export async function redeemSpinByCode(code: string) {
  const cleaned = code.trim().toUpperCase();

  const q = query(collection(db, "spins"), where("code", "==", cleaned), limit(1));

  const snap = await getDocs(q);
  if (snap.empty) return { ok: false as const, reason: "not_found" as const };

  const docSnap = snap.docs[0];
  const data = docSnap.data() as any;

  if (data.status === "redeemed") {
    return { ok: false as const, reason: "already_redeemed" as const };
  }

  const expMs = data.expiresAt?.toMillis?.();
  if (expMs && Date.now() > expMs) {
    return { ok: false as const, reason: "expired" as const };
  }

  await updateDoc(doc(db, "spins", docSnap.id), {
    status: "redeemed",
    redeemedAt: serverTimestamp(),
  });

  return {
    ok: true as const,
    prizeLabel: data.prizeLabel,
    merchantId: data.merchantId,
  };
}
