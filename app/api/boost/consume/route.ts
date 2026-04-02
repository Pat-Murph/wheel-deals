import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Returns the UTC date string for "today" (YYYY-MM-DD).
 * Used as the key for per-day rate limiting.
 */
function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function POST(req: NextRequest) {
  try {
    const { merchantId, uid, prizeLabel, finalize, deviceFingerprint } = await req.json();

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    const ref = adminDb.collection("merchants").doc(merchantId);

    // ── Step 1: entitlement grant (no prizeLabel yet) ──────────────────────
    if (!finalize) {
      // ── Device fingerprint rate-limit check ──────────────────────────────
      // We track per-device usage in a sub-collection:
      //   merchants/{merchantId}/boostDeviceUsage/{fingerprint}
      //   { lastUsedDate: "YYYY-MM-DD", count: N }
      //
      // If the device has already used a free boost today for this merchant, block it.
      if (deviceFingerprint) {
        const usageRef = adminDb
          .collection("merchants")
          .doc(merchantId)
          .collection("boostDeviceUsage")
          .doc(deviceFingerprint);

        const usageSnap = await usageRef.get();
        const today = todayUTC();

        if (usageSnap.exists) {
          const usageData = usageSnap.data()!;
          if (usageData.lastUsedDate === today) {
            return NextResponse.json(
              { error: "You have already used your free deal today. Come back tomorrow!" },
              { status: 429 }
            );
          }
        }
      }

      const result = await adminDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) throw new Error("Merchant not found");

        const data = snap.data()!;
        const remaining = Number(data.boostFreeSpinsRemaining ?? 0);
        const boostActive = Boolean(data.boostActive);

        if (!boostActive || remaining <= 0) {
          return { allowed: false, remaining: 0 };
        }

        // Don't decrement yet — decrement on finalize to avoid wasting spins
        return { allowed: true, remaining, sessionId: "free-boost-" + Date.now() };
      });

      if (!result.allowed) {
        return NextResponse.json({ error: "No free deals remaining for this merchant" }, { status: 403 });
      }

      return NextResponse.json(result);
    }

    // ── Step 2: finalize (after spin animation completes) ──────────────────
    const code = generateCode();
    const spinId = "boost-" + randomBytes(6).toString("hex");
    const today = todayUTC();

    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Merchant not found");

      const data = snap.data()!;
      const remaining = Number(data.boostFreeSpinsRemaining ?? 0);
      const boostActive = Boolean(data.boostActive);

      if (!boostActive || remaining <= 0) {
        throw new Error("No free deals remaining");
      }

      // Double-check device fingerprint inside transaction (re-read for consistency)
      if (deviceFingerprint) {
        const usageRef = adminDb
          .collection("merchants")
          .doc(merchantId)
          .collection("boostDeviceUsage")
          .doc(deviceFingerprint);
        const usageSnap = await tx.get(usageRef);
        if (usageSnap.exists && usageSnap.data()!.lastUsedDate === today) {
          throw new Error("You have already used your free deal today. Come back tomorrow!");
        }
        // Mark device as used today
        tx.set(usageRef, { lastUsedDate: today, uid, updatedAt: FieldValue.serverTimestamp() });
      }

      const newRemaining = remaining - 1;
      const updates: Record<string, any> = {
        boostFreeSpinsRemaining: newRemaining,
      };
      if (newRemaining <= 0) {
        updates.boostActive = false;
      }
      tx.update(ref, updates);

      // Write spin record
      const spinRef = adminDb.collection("spins").doc(spinId);
      tx.set(spinRef, {
        merchantId,
        uid,
        deviceFingerprint: deviceFingerprint ?? null,
        prizeLabel: prizeLabel ?? "Unknown",
        code,
        redeemed: false,
        createdAt: FieldValue.serverTimestamp(),
        type: "free-boost",
      });

      return { allowed: true, remaining: newRemaining, code, spinId };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Boost consume error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
