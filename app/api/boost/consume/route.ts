import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Free deal limit logic:
 * - 1 free deal per customer per boost activation cycle
 * - Customer can get another free deal ONLY when BOTH conditions are met:
 *   1. Merchant has REACTIVATED boost (new boostPurchasedAt timestamp)
 *   2. At least 24 hours have passed since the customer's last free deal from this merchant
 *
 * We store usage in: merchants/{merchantId}/boostUserUsage/{uid}
 *   - usedAt: timestamp of last free deal claim
 *   - boostCycleId: the boostPurchasedAt value when the deal was claimed
 *
 * And: merchants/{merchantId}/boostDeviceUsage/{fingerprint}
 *   - same fields for device-level tracking
 */

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  try {
    const { merchantId, uid, prizeLabel, finalize, deviceFingerprint } = await req.json();

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    const ref = adminDb.collection("merchants").doc(merchantId);

    // ── Step 1: entitlement grant (no prizeLabel yet) ──────────────────────
    if (!finalize) {
      // ── Block merchant accounts from claiming free deals ────────────────
      const merchantAccountCheck = await adminDb
        .collection("merchants")
        .where("uid", "==", uid)
        .limit(1)
        .get();
      if (!merchantAccountCheck.empty) {
        return NextResponse.json(
          { error: "Business owner accounts cannot claim free deals. Please use a customer account." },
          { status: 403 }
        );
      }

      // Read merchant data to get current boost cycle ID
      const merchantSnap = await ref.get();
      if (!merchantSnap.exists) {
        return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
      }
      const merchantData = merchantSnap.data()!;
      const currentBoostCycleId = merchantData.boostPurchasedAt ?? "unknown";

      // ── 1-per-activation-cycle + 24h cooldown enforcement ──────────────
      // Check UID usage
      const userUsageRef = adminDb
        .collection("merchants")
        .doc(merchantId)
        .collection("boostUserUsage")
        .doc(uid);
      const userUsageSnap = await userUsageRef.get();
      if (userUsageSnap.exists) {
        const usageData = userUsageSnap.data()!;
        const lastCycleId = usageData.boostCycleId ?? "";
        const lastUsedAt = usageData.usedAt?.toDate?.() ?? new Date(usageData.usedAt ?? 0);
        const hoursSinceLast = Date.now() - lastUsedAt.getTime();

        // Block if same activation cycle OR less than 24 hours
        if (lastCycleId === currentBoostCycleId) {
          return NextResponse.json(
            { error: "You already claimed your free deal for this boost cycle. Come back when the merchant activates a new boost!" },
            { status: 429 }
          );
        }
        if (hoursSinceLast < TWENTY_FOUR_HOURS_MS) {
          return NextResponse.json(
            { error: "Please wait 24 hours between free deal claims. Try again later!" },
            { status: 429 }
          );
        }
      }

      // Check device fingerprint usage
      if (deviceFingerprint) {
        const usageRef = adminDb
          .collection("merchants")
          .doc(merchantId)
          .collection("boostDeviceUsage")
          .doc(deviceFingerprint);
        const usageSnap = await usageRef.get();

        if (usageSnap.exists) {
          const usageData = usageSnap.data()!;
          const lastCycleId = usageData.boostCycleId ?? "";
          const lastUsedAt = usageData.usedAt?.toDate?.() ?? new Date(usageData.usedAt ?? 0);
          const hoursSinceLast = Date.now() - lastUsedAt.getTime();

          if (lastCycleId === currentBoostCycleId) {
            return NextResponse.json(
              { error: "You already claimed your free deal for this boost cycle. Come back when the merchant activates a new boost!" },
              { status: 429 }
            );
          }
          if (hoursSinceLast < TWENTY_FOUR_HOURS_MS) {
            return NextResponse.json(
              { error: "Please wait 24 hours between free deal claims. Try again later!" },
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

        // Don't decrement yet — decrement on finalize to avoid wasting unlocks
        return { allowed: true, remaining, sessionId: "free-boost-" + Date.now() };
      });

      if (!result.allowed) {
        return NextResponse.json({ error: "No free deals remaining for this merchant" }, { status: 403 });
      }

      return NextResponse.json(result);
    }

    // ── Step 2: finalize (after unlock animation completes) ──────────────────
    // Re-check merchant account block on finalize too
    const merchantAccountCheck2 = await adminDb
      .collection("merchants")
      .where("uid", "==", uid)
      .limit(1)
      .get();
    if (!merchantAccountCheck2.empty) {
      return NextResponse.json(
        { error: "Business owner accounts cannot claim free deals." },
        { status: 403 }
      );
    }

    const code = generateCode();
    const spinId = "boost-" + randomBytes(6).toString("hex");

    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Merchant not found");

      const data = snap.data()!;
      const remaining = Number(data.boostFreeSpinsRemaining ?? 0);
      const boostActive = Boolean(data.boostActive);
      const currentBoostCycleId = data.boostPurchasedAt ?? "unknown";

      if (!boostActive || remaining <= 0) {
        throw new Error("No free deals remaining");
      }

      // Double-check UID usage inside transaction
      const userUsageRef = adminDb
        .collection("merchants")
        .doc(merchantId)
        .collection("boostUserUsage")
        .doc(uid);
      const userUsageSnap = await tx.get(userUsageRef);
      if (userUsageSnap.exists) {
        const usageData = userUsageSnap.data()!;
        const lastCycleId = usageData.boostCycleId ?? "";
        const lastUsedAt = usageData.usedAt?.toDate?.() ?? new Date(usageData.usedAt ?? 0);
        const hoursSinceLast = Date.now() - lastUsedAt.getTime();

        if (lastCycleId === currentBoostCycleId) {
          throw new Error("You already claimed your free deal for this boost cycle.");
        }
        if (hoursSinceLast < TWENTY_FOUR_HOURS_MS) {
          throw new Error("Please wait 24 hours between free deal claims.");
        }
      }
      // Mark UID as used for this cycle
      tx.set(userUsageRef, {
        uid,
        usedAt: FieldValue.serverTimestamp(),
        boostCycleId: currentBoostCycleId,
      });

      // Double-check device fingerprint inside transaction
      if (deviceFingerprint) {
        const usageRef = adminDb
          .collection("merchants")
          .doc(merchantId)
          .collection("boostDeviceUsage")
          .doc(deviceFingerprint);
        const usageSnap = await tx.get(usageRef);
        if (usageSnap.exists) {
          const usageData = usageSnap.data()!;
          const lastCycleId = usageData.boostCycleId ?? "";
          const lastUsedAt = usageData.usedAt?.toDate?.() ?? new Date(usageData.usedAt ?? 0);
          const hoursSinceLast = Date.now() - lastUsedAt.getTime();

          if (lastCycleId === currentBoostCycleId) {
            throw new Error("You already claimed your free deal for this boost cycle.");
          }
          if (hoursSinceLast < TWENTY_FOUR_HOURS_MS) {
            throw new Error("Please wait 24 hours between free deal claims.");
          }
        }
        // Mark device as used for this cycle
        tx.set(usageRef, {
          uid,
          usedAt: FieldValue.serverTimestamp(),
          boostCycleId: currentBoostCycleId,
        });
      }

      const newRemaining = remaining - 1;
      const updates: Record<string, any> = {
        boostFreeSpinsRemaining: newRemaining,
      };
      if (newRemaining <= 0) {
        updates.boostActive = false;
      }
      tx.update(ref, updates);

      // Write unlock record
      const spinRef = adminDb.collection("spins").doc(spinId);
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      tx.set(spinRef, {
        merchantId,
        uid,
        deviceFingerprint: deviceFingerprint ?? null,
        prizeLabel: prizeLabel ?? "Unknown",
        code,
        redeemed: false,
        status: "issued",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        type: "free-boost",
        boostCycleId: currentBoostCycleId,
      });

      return { allowed: true, remaining: newRemaining, code, spinId, expiresAt: expiresAt.toISOString() };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Boost consume error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
