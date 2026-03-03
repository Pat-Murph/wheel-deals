import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { SPIN_PRICE_CENTS } from "@/lib/payments";
import { FieldValue } from "firebase-admin/firestore";

export async function POST(req: Request) {
  try {
    const { sessionId } = await req.json();

    if (!sessionId) {
      return NextResponse.json(
        { ok: false, error: "Missing sessionId" },
        { status: 400 }
      );
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ["payment_intent"],
    });

    if (!session) {
      return NextResponse.json(
        { ok: false, error: "Session not found" },
        { status: 404 }
      );
    }

    // Must be paid
    if (session.payment_status !== "paid") {
      return NextResponse.json(
        { ok: false, error: "Not paid" },
        { status: 400 }
      );
    }

    // Safety: verify amount matches spin price
    if ((session.amount_total ?? 0) !== SPIN_PRICE_CENTS) {
      return NextResponse.json(
        { ok: false, error: "Wrong amount" },
        { status: 400 }
      );
    }

    // ✅ Metadata may be on session or payment_intent
    const pi = session.payment_intent as any | null;

    const merchantId =
      session.metadata?.merchantId ?? pi?.metadata?.merchantId ?? null;
    const uid = session.metadata?.uid ?? pi?.metadata?.uid ?? null;

    if (!merchantId || !uid) {
      return NextResponse.json(
        { ok: false, error: "Missing metadata" },
        { status: 400 }
      );
    }

    // (Optional) verify merchant exists (prevents junk writes)
    const mSnap = await adminDb.collection("merchants").doc(merchantId).get();
    if (!mSnap.exists) {
      return NextResponse.json(
        { ok: false, error: "Merchant not found" },
        { status: 404 }
      );
    }

    // ✅ Idempotent entitlement creation without rewriting createdAt on re-verify
    const paidRef = adminDb.collection("paidSpins").doc(sessionId);

    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(paidRef);

      if (existing.exists) {
        tx.set(
          paidRef,
          {
            // keep canonical fields updated if you want
            merchantId,
            uid,
            amountTotal: session.amount_total ?? 0,
            currency: session.currency,
            verifiedAt: FieldValue.serverTimestamp(),
            // do NOT force used=false here; preserve reality
          },
          { merge: true }
        );
        return;
      }

      tx.set(paidRef, {
        merchantId,
        uid,
        amountTotal: session.amount_total ?? 0,
        currency: session.currency,
        used: false,
        createdAt: FieldValue.serverTimestamp(),
        verifiedAt: FieldValue.serverTimestamp(),
      });
    });

    return NextResponse.json({ ok: true, merchantId, uid });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
