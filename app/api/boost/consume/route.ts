import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { randomBytes } from "crypto";

function generateCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

export async function POST(req: NextRequest) {
  try {
    const { merchantId, uid, prizeLabel, finalize } = await req.json();

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    const ref = adminDb.collection("merchants").doc(merchantId);

    // ── Step 1: entitlement grant (no prizeLabel yet) ──────────────────────
    if (!finalize) {
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
        return NextResponse.json({ error: "No free spins remaining" }, { status: 403 });
      }

      return NextResponse.json(result);
    }

    // ── Step 2: finalize (after spin animation completes) ──────────────────
    const code = generateCode();
    const spinId = "boost-" + randomBytes(6).toString("hex");

    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Merchant not found");

      const data = snap.data()!;
      const remaining = Number(data.boostFreeSpinsRemaining ?? 0);
      const boostActive = Boolean(data.boostActive);

      if (!boostActive || remaining <= 0) {
        throw new Error("No free spins remaining");
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
