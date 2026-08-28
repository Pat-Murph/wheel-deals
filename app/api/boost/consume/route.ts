import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

const TWENTY_FOUR_HOURS_MS = 24 * 60 * 60 * 1000;
const RESERVATION_MS = 15 * 60 * 1000;

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function asDate(value: any): Date | null {
  if (!value) return null;
  if (typeof value.toDate === "function") return value.toDate();
  if (value instanceof Date) return value;
  if (typeof value === "number" || typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  return null;
}

// Firestore Timestamp objects are recreated on each read, so compare a stable
// string value rather than object identity when checking a boost activation.
function boostCycleKey(value: any): string {
  const date = asDate(value);
  return date ? `boost-${date.getTime()}` : `boost-${String(value ?? "unknown")}`;
}

function usageBlockMessage(usage: any, cycleId: string, now: Date): string | null {
  if (!usage) return null;
  const lastCycleId = usage.boostCycleId ?? "";
  const lastUsedAt = asDate(usage.usedAt);

  if (lastCycleId === cycleId) {
    return "You already claimed your free deal for this boost cycle. Come back when the merchant activates a new boost!";
  }
  if (lastUsedAt && now.getTime() - lastUsedAt.getTime() < TWENTY_FOUR_HOURS_MS) {
    return "Please wait 24 hours between free deal claims. Try again later!";
  }
  return null;
}

async function isMerchantAccount(uid: string): Promise<boolean> {
  const [merchantByOwner, userDoc] = await Promise.all([
    adminDb.collection("merchants").where("ownerUid", "==", uid).limit(1).get(),
    adminDb.collection("users").doc(uid).get(),
  ]);
  return !merchantByOwner.empty || Boolean(userDoc.exists && (userDoc.data() as any)?.merchantId);
}

/**
 * Free boost rules:
 * - One completed free unlock per device and user per merchant boost cycle.
 * - A customer is eligible again only after a new merchant boost activation AND 24 hours.
 * - A server-side reservation is created before the wheel begins, preventing a customer from
 *   leaving and reopening the wheel to obtain repeated free unlock attempts.
 */
export async function POST(req: NextRequest) {
  try {
    const { merchantId, uid, prizeLabel, finalize, deviceFingerprint, sessionId } = await req.json();

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }
    if (!deviceFingerprint) {
      return NextResponse.json(
        { error: "Unable to verify your device. Please enable cookies and try again." },
        { status: 400 }
      );
    }
    if (await isMerchantAccount(uid)) {
      return NextResponse.json(
        { error: "Business owner accounts cannot claim free deals. Please use a customer account." },
        { status: 403 }
      );
    }

    const merchantRef = adminDb.collection("merchants").doc(merchantId);
    const deviceUsageRef = merchantRef.collection("boostDeviceUsage").doc(deviceFingerprint);
    const userUsageRef = merchantRef.collection("boostUserUsage").doc(uid);
    const reservationRef = merchantRef.collection("boostReservations").doc(deviceFingerprint);
    const now = new Date();

    // Step 1: reserve one specific free-unlock session. Revisiting the same wheel
    // returns the existing reservation rather than granting another attempt.
    if (!finalize) {
      const result = await adminDb.runTransaction(async (tx) => {
        const [merchantSnap, deviceUsageSnap, userUsageSnap, reservationSnap] = await Promise.all([
          tx.get(merchantRef),
          tx.get(deviceUsageRef),
          tx.get(userUsageRef),
          tx.get(reservationRef),
        ]);

        if (!merchantSnap.exists) throw new Error("Merchant not found");
        const merchant = merchantSnap.data()!;
        const remaining = Number(merchant.boostFreeSpinsRemaining ?? 0);
        if (!merchant.boostActive || remaining <= 0) {
          return { allowed: false, error: "No free deals remaining for this merchant" };
        }

        const cycleId = boostCycleKey(merchant.boostPurchasedAt);
        const deviceMessage = usageBlockMessage(deviceUsageSnap.data(), cycleId, now);
        if (deviceMessage) return { allowed: false, error: deviceMessage };
        const userMessage = usageBlockMessage(userUsageSnap.data(), cycleId, now);
        if (userMessage) return { allowed: false, error: userMessage };

        const reservation = reservationSnap.data();
        const reservationExpiry = asDate(reservation?.expiresAt);
        if (reservation && reservationExpiry && reservationExpiry > now) {
          if (reservation.uid === uid && reservation.boostCycleId === cycleId && reservation.sessionId) {
            return {
              allowed: true,
              sessionId: reservation.sessionId,
              remaining,
              reservationExpiresAt: reservationExpiry.toISOString(),
            };
          }
          return {
            allowed: false,
            error: "A free deal is already being prepared on this device. Please finish that unlock before starting another.",
          };
        }

        const reservationSessionId = `free-boost-${randomBytes(16).toString("hex")}`;
        const expiresAt = new Date(now.getTime() + RESERVATION_MS);
        tx.set(reservationRef, {
          uid,
          sessionId: reservationSessionId,
          boostCycleId: cycleId,
          reservedAt: FieldValue.serverTimestamp(),
          expiresAt,
        });

        return {
          allowed: true,
          sessionId: reservationSessionId,
          remaining,
          reservationExpiresAt: expiresAt.toISOString(),
        };
      });

      if (!result.allowed) {
        return NextResponse.json({ error: result.error }, { status: 429 });
      }
      return NextResponse.json(result);
    }

    // Step 2: atomically turn the reserved session into the one valid deal code.
    if (!sessionId) {
      return NextResponse.json({ error: "Missing free unlock session" }, { status: 400 });
    }

    const code = generateCode();
    const spinId = `boost-${randomBytes(6).toString("hex")}`;
    const result = await adminDb.runTransaction(async (tx) => {
      const [merchantSnap, deviceUsageSnap, userUsageSnap, reservationSnap] = await Promise.all([
        tx.get(merchantRef),
        tx.get(deviceUsageRef),
        tx.get(userUsageRef),
        tx.get(reservationRef),
      ]);

      if (!merchantSnap.exists) throw new Error("Merchant not found");
      const merchant = merchantSnap.data()!;
      const remaining = Number(merchant.boostFreeSpinsRemaining ?? 0);
      if (!merchant.boostActive || remaining <= 0) throw new Error("No free deals remaining");

      const cycleId = boostCycleKey(merchant.boostPurchasedAt);
      const deviceMessage = usageBlockMessage(deviceUsageSnap.data(), cycleId, now);
      if (deviceMessage) throw new Error(deviceMessage);
      const userMessage = usageBlockMessage(userUsageSnap.data(), cycleId, now);
      if (userMessage) throw new Error(userMessage);

      const reservation = reservationSnap.data();
      const reservationExpiry = asDate(reservation?.expiresAt);
      if (
        !reservation ||
        reservation.uid !== uid ||
        reservation.sessionId !== sessionId ||
        reservation.boostCycleId !== cycleId ||
        !reservationExpiry ||
        reservationExpiry <= now
      ) {
        throw new Error("Your free unlock session expired. Please return to the wheel and claim it again.");
      }

      tx.set(deviceUsageRef, {
        uid,
        usedAt: FieldValue.serverTimestamp(),
        boostCycleId: cycleId,
      });
      tx.set(userUsageRef, {
        uid,
        usedAt: FieldValue.serverTimestamp(),
        boostCycleId: cycleId,
      });

      const newRemaining = remaining - 1;
      tx.update(merchantRef, {
        boostFreeSpinsRemaining: newRemaining,
        ...(newRemaining <= 0 ? { boostActive: false } : {}),
      });
      tx.delete(reservationRef);

      const expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      tx.set(adminDb.collection("spins").doc(spinId), {
        merchantId,
        uid,
        deviceFingerprint,
        prizeLabel: prizeLabel ?? "Unknown",
        code,
        redeemed: false,
        status: "issued",
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        type: "free-boost",
        shareRewardEligible: true,
        boostCycleId: cycleId,
      });

      return { allowed: true, remaining: newRemaining, code, spinId, expiresAt: expiresAt.toISOString(), type: "free-boost" };
    });

    return NextResponse.json(result);
  } catch (err: any) {
    console.error("Boost consume error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
