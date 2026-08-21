import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { VALID_SPIN_PRICES } from "@/lib/payments";
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

    // Safety: verify amount matches a valid unlock price tier
    const amountTotal = session.amount_total ?? 0;
    if (!VALID_SPIN_PRICES.includes(amountTotal)) {
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

    // A checkout session may only unlock one deal. Re-verification is allowed
    // while its entitlement is unused, but a completed session must never make
    // a new wheel unlock ready after the customer navigates away and returns.
    const paidRef = adminDb.collection("paidSpins").doc(sessionId);
    let alreadyUsed = false;

    await adminDb.runTransaction(async (tx) => {
      const existing = await tx.get(paidRef);

      if (existing.exists) {
        if ((existing.data() as any)?.used === true) {
          alreadyUsed = true;
          return;
        }
        tx.set(
          paidRef,
          {
            merchantId,
            uid,
            amountTotal: session.amount_total ?? 0,
            currency: session.currency,
            verifiedAt: FieldValue.serverTimestamp(),
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

    if (alreadyUsed) {
      return NextResponse.json(
        { ok: false, error: "This paid unlock was already used. Please start a new unlock if you would like another deal." },
        { status: 409 }
      );
    }

    return NextResponse.json({ ok: true, merchantId, uid, spinPriceCents: amountTotal });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
