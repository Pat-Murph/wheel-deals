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
import { getDb } from "./firebase";
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
  const dailyLimit = params.dailyLimit ?? 3;

  const code = generateCode();
  const expiresAt = expiresAtInDays(7);

  const limitRef = doc(
    getDb(),
    "users",
    uid,
    "merchantLimits",
    params.merchantId,
    "days",
    dateKey
  );

  const spinRef = doc(collection(getDb(), "spins"));

  const txResult = await runTransaction(getDb(), async (tx) => {
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
  const ref = doc(getDb(), "merchantStats", merchantId, "daily", dateKey);
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
 * Redeem a spin by code (merchant-only via rules).
 * Uses a Firestore transaction to guarantee atomic one-time-use:
 * no race condition can allow the same code to be redeemed twice.
 */
export async function redeemSpinByCode(code: string) {
  const cleaned = code.trim().toUpperCase();

  // First find the spin document by code
  const q = query(collection(getDb(), "spins"), where("code", "==", cleaned), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return { ok: false as const, reason: "not_found" as const };

  const spinDocRef = doc(getDb(), "spins", snap.docs[0].id);

  // Run inside a transaction so two simultaneous redemption attempts
  // cannot both pass the status check — only the first write wins.
  type TxResult =
    | { ok: true; prizeLabel: string; merchantId: string }
    | { ok: false; reason: "already_redeemed" | "expired" | "not_found" };

  const result: TxResult = await runTransaction(getDb(), async (tx) => {
    const spinSnap = await tx.get(spinDocRef);

    if (!spinSnap.exists()) {
      return { ok: false, reason: "not_found" } as const;
    }

    const data = spinSnap.data() as any;

    // ✅ Hard block: already redeemed
    if (data.status === "redeemed") {
      return { ok: false, reason: "already_redeemed" } as const;
    }

    // ✅ Hard block: expired
    const expMs = data.expiresAt?.toMillis?.();
    if (expMs && Date.now() > expMs) {
      return { ok: false, reason: "expired" } as const;
    }

    // ✅ Atomically mark as redeemed — Firestore rules also enforce
    // status must be "issued" → "redeemed" and no other fields change.
    tx.update(spinDocRef, {
      status: "redeemed",
      redeemedAt: serverTimestamp(),
    });

    return {
      ok: true,
      prizeLabel: data.prizeLabel as string,
      merchantId: data.merchantId as string,
    } as const;
  });

  return result;
}
