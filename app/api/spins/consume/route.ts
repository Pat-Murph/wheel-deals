// app/api/spins/consume/route.ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { getTierByPrice } from "@/lib/payments";

// No confusing characters: 0/O, 1/I
function makeCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

// ✅ Date key in America/Los_Angeles (matches your local-day stats expectation)
function dateKeyLA(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);

  const yyyy = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${yyyy}-${mm}-${dd}`;
}

export async function POST(req: Request) {
  try {
    const { sessionId, merchantId, uid, prizeLabel } = await req.json();

    if (!sessionId || !merchantId || !uid || !prizeLabel) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId/merchantId/uid/prizeLabel" },
        { status: 400 }
      );
    }

    const paidRef = adminDb.collection("paidSpins").doc(sessionId);
    const spinsCol = adminDb.collection("spins");

    const result = await adminDb.runTransaction(async (tx) => {
      const paidSnap = await tx.get(paidRef);
      if (!paidSnap.exists) throw new Error("Entitlement not found");

      const paid = paidSnap.data() as any;

      if (paid.used) throw new Error("Entitlement already used");
      if (paid.merchantId !== merchantId) throw new Error("Merchant mismatch");
      if (paid.uid !== uid) throw new Error("User mismatch");

      // ✅ Determine merchant payout based on actual unlock price stored in paidSpins
      const amountTotal: number = Number(paid.amountTotal ?? 135);
      const tier = getTierByPrice(amountTotal);
      const revenueCents = tier.merchantPayoutCents;

      // Create unlock record
      const spinRef = spinsCol.doc(); // auto id
      const code = makeCode(8);

      // Fast redemption lookup by code
      const codeRef = adminDb.collection("redemptionCodes").doc(code);

      // ✅ Update merchant daily stats (unlocks + revenue)
      const dayKey = dateKeyLA(new Date());
      const dailyStatsRef = adminDb
        .collection("merchantStats")
        .doc(merchantId)
        .collection("daily")
        .doc(dayKey);

      // Mark entitlement used + link spinId
      tx.update(paidRef, {
        used: true,
        usedAt: FieldValue.serverTimestamp(),
        spinId: spinRef.id,
      });

      // Write unlock record
      // expiresAt: 30 days from now (required by Firestore rules for redemption)
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

      tx.set(spinRef, {
        merchantId,
        uid,
        prizeLabel,
        status: "issued",
        code,
        type: "paid",
        shareRewardEligible: true,
        sessionId,
        spinPriceCents: amountTotal,
        revenueCents,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt,
        dateKey: dayKey,
      });

      // Write code index
      tx.set(codeRef, {
        merchantId,
        spinId: spinRef.id,
        status: "issued",
        createdAt: FieldValue.serverTimestamp(),
      });

      // ✅ Increment daily stats with accurate revenue per unlock tier
      tx.set(
        dailyStatsRef,
        {
          dateKey: dayKey,
          spinsCount: FieldValue.increment(1),
          revenueCents: FieldValue.increment(revenueCents),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );

      return { spinId: spinRef.id, code, expiresAt: expiresAt.toISOString(), type: "paid" };
    });

    return NextResponse.json({ ok: true, ...result }, { status: 200 });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
