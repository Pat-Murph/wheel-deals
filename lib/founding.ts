/**
 * lib/founding.ts
 *
 * Founding Merchant Program — first 1,000 merchants
 * ─────────────────────────────────────────────────
 * Terms:
 *   - First 1,000 merchants to create an account are "Founding Merchants"
 *   - They receive 20% of Wheel Deals net profit, distributed quarterly
 *   - Distribution starts on the 1st anniversary of Wheel Deals launch
 *   - Program lasts 5 years (20 quarterly distributions total)
 *   - Each merchant's share is weighted by their cumulative revenue generated
 *
 * Firestore structure:
 *   /platform/founding
 *     totalFoundingMerchants: number   (auto-incremented, capped at 1000)
 *     launchDate: Timestamp            (set manually when you go live)
 *
 *   /merchants/{merchantId}
 *     foundingMerchant: boolean        (true if in first 1000)
 *     foundingNumber: number           (1–1000, their spot in line)
 *     foundingJoinedAt: Timestamp
 *
 *   /profitShareDistributions/{quarterKey}   (e.g. "2027-Q1")
 *     quarterKey: string
 *     totalNetProfitCents: number
 *     sharePercent: 20
 *     totalShareCents: number          (= totalNetProfitCents * 0.20)
 *     totalRevenueWeightCents: number  (sum of all founding merchant revenue)
 *     status: "pending" | "distributed"
 *     createdAt: Timestamp
 *     distributedAt?: Timestamp
 *
 *   /profitShareDistributions/{quarterKey}/allocations/{merchantId}
 *     merchantId: string
 *     foundingNumber: number
 *     revenueWeightCents: number       (their cumulative revenue for the period)
 *     shareCents: number               (their calculated payout)
 *     status: "pending" | "paid"
 */

import {
  doc,
  getDoc,
  runTransaction,
  collection,
  query,
  where,
  getDocs,
  orderBy,
  limit,
  serverTimestamp,
  increment,
} from "firebase/firestore";
import { db } from "./firebase";

export const FOUNDING_MERCHANT_LIMIT = 1000;
function getPlatformDoc() { return doc(db, "platform", "founding"); }

/**
 * Get the current founding merchant count (for the countdown banner).
 * Returns { total, remaining, isFull }
 */
export async function getFoundingMerchantCount(): Promise<{
  total: number;
  remaining: number;
  isFull: boolean;
}> {
  try {
    const snap = await getDoc(getPlatformDoc());
    const total = (snap.data()?.totalFoundingMerchants as number) ?? 0;
    const remaining = Math.max(0, FOUNDING_MERCHANT_LIMIT - total);
    return { total, remaining, isFull: total >= FOUNDING_MERCHANT_LIMIT };
  } catch {
    // If doc doesn't exist yet, no founding merchants have joined
    return { total: 0, remaining: FOUNDING_MERCHANT_LIMIT, isFull: false };
  }
}

/**
 * Called during merchant onboarding (server-side or client-side).
 * Atomically claims a founding merchant spot if available.
 * Returns the founding number (1–1000) or null if spots are full.
 */
export async function claimFoundingSpot(merchantId: string): Promise<number | null> {
  try {
    let foundingNumber: number | null = null;

    await runTransaction(db, async (tx) => {
      const platformSnap = await tx.get(getPlatformDoc());
      const current = (platformSnap.data()?.totalFoundingMerchants as number) ?? 0;

      if (current >= FOUNDING_MERCHANT_LIMIT) {
        // Spots are full — no founding status
        return;
      }

      const newTotal = current + 1;
      foundingNumber = newTotal;

      // Increment the global counter
      tx.set(
        getPlatformDoc(),
        {
          totalFoundingMerchants: newTotal,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Mark the merchant as a founding member
      const merchantRef = doc(db, "merchants", merchantId);
      tx.update(merchantRef, {
        foundingMerchant: true,
        foundingNumber: newTotal,
        foundingJoinedAt: serverTimestamp(),
      });
    });

    return foundingNumber;
  } catch (e) {
    console.error("claimFoundingSpot error:", e);
    return null;
  }
}

/**
 * Check if a specific merchant is a founding merchant.
 */
export async function isFoundingMerchant(merchantId: string): Promise<{
  isFounder: boolean;
  foundingNumber?: number;
}> {
  try {
    const snap = await getDoc(doc(db, "merchants", merchantId));
    if (!snap.exists()) return { isFounder: false };
    const data = snap.data() as any;
    return {
      isFounder: !!data.foundingMerchant,
      foundingNumber: data.foundingNumber,
    };
  } catch {
    return { isFounder: false };
  }
}
