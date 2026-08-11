import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Free deal limit logic (tightened):
 * - 1 free deal per device per boost activation cycle
 * - Device fingerprint is the PRIMARY enforcement (UID changes on sign-out)
 * - Also tracks by UID as secondary check
 * - Also checks users/{uid} doc to block merchant accounts
 * - Customer can get another free deal ONLY when BOTH conditions are met:
 *   1. Merchant has REACTIVATED boost (new boostPurchasedAt timestamp)
 *   2. At least 24 hours have passed since the last free deal from this device/user
 *
 * Storage:
 *   merchants/{merchantId}/boostDeviceUsage/{fingerprint} — PRIMARY (survives sign-out)
 *   merchants/{merchantId}/boostUserUsage/{uid} — SECONDARY
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
      // Check both ownerUid field on merchants AND users/{uid}.merchantId link
      const [merchantByOwner, userDoc] = await Promise.all([
        adminDb.collection("merchants").where("ownerUid", "==", uid).limit(1).get(),
        adminDb.collection("users").doc(uid).get(),
      ]);
      if (!merchantByOwner.empty || (userDoc.exists && (userDoc.data() as any)?.merchantId)) {
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

      // ── DEVICE FINGERPRINT CHECK (PRIMARY — required) ──────────────────
      // Device fingerprint is mandatory for free deal claims
      if (!deviceFingerprint) {
        return NextResponse.json(
          { error: "Unable to verify your device. Please enable cookies and try again." },
          { status: 400 }
        );
      }

      const deviceUsageRef = adminDb
        .collection("merchants")
        .doc(merchantId)
        .collection("boostDeviceUsage")
        .doc(deviceFingerprint);
      const deviceUsageSnap = await deviceUsageRef.get();

      if (deviceUsageSnap.exists) {
        const usageData = deviceUsageSnap.data()!;
        const lastCycleId = usageData.boostCycleId ?? "";
        const lastUsedAt = usageData.usedAt?.toDate?.() ?? new Date(usageData.usedAt ?? 0);
        const msSinceLast = Date.now() - lastUsedAt.getTime();

        if (lastCycleId === currentBoostCycleId) {
          return NextResponse.json(
            { error: "You already claimed your free deal for this boost cycle. Come back when the merchant activates a new boost!" },
            { status: 429 }
          );
        }
        if (msSinceLast < TWENTY_FOUR_HOURS_MS) {
          return NextResponse.json(
            { error: "Please wait 24 hours between free deal claims. Try again later!" },
            { status: 429 }
          );
        }
      }

      // ── UID CHECK (SECONDARY) ──────────────────────────────────────────
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
        const msSinceLast = Date.now() - lastUsedAt.getTime();

        if (lastCycleId === currentBoostCycleId) {
          return NextResponse.json(
            { error: "You already claimed your free deal for this boost cycle. Come back when the merchant activates a new boost!" },
            { status: 429 }
          );
        }
        if (msSinceLast < TWENTY_FOUR_HOURS_MS) {
          return NextResponse.json(
            { error: "Please wait 24 hours between free deal claims. Try again later!" },
            { status: 429 }
          );
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
    const [merchantByOwner2, userDoc2] = await Promise.all([
      adminDb.collection("merchants").where("ownerUid", "==", uid).limit(1).get(),
      adminDb.collection("users").doc(uid).get(),
    ]);
    if (!merchantByOwner2.empty || (userDoc2.exists && (userDoc2.data() as any)?.merchantId)) {
      return NextResponse.json(
        { error: "Business owner accounts cannot claim free deals." },
        { status: 403 }
      );
    }

    // Device fingerprint required for finalize too
    if (!deviceFingerprint) {
      return NextResponse.json(
        { error: "Unable to verify your device." },
        { status: 400 }
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

      // Double-check device usage inside transaction
      const deviceUsageRef = adminDb
        .collection("merchants")
        .doc(merchantId)
        .collection("boostDeviceUsage")
        .doc(deviceFingerprint);
      const deviceUsageSnap = await tx.get(deviceUsageRef);
      if (deviceUsageSnap.exists) {
        const usageData = deviceUsageSnap.data()!;
        const lastCycleId = usageData.boostCycleId ?? "";
        const lastUsedAt = usageData.usedAt?.toDate?.() ?? new Date(usageData.usedAt ?? 0);
        const msSinceLast = Date.now() - lastUsedAt.getTime();

        if (lastCycleId === currentBoostCycleId) {
          throw new Error("You already claimed your free deal for this boost cycle.");
        }
        if (msSinceLast < TWENTY_FOUR_HOURS_MS) {
          throw new Error("Please wait 24 hours between free deal claims.");
        }
      }
      // Mark device as used for this cycle
      tx.set(deviceUsageRef, {
        uid,
        usedAt: FieldValue.serverTimestamp(),
        boostCycleId: currentBoostCycleId,
      });

      // Also mark UID usage
      const userUsageRef = adminDb
        .collection("merchants")
        .doc(merchantId)
        .collection("boostUserUsage")
        .doc(uid);
      tx.set(userUsageRef, {
        uid,
        usedAt: FieldValue.serverTimestamp(),
        boostCycleId: currentBoostCycleId,
      });

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
