import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { authenticatedBoostOwner, merchantIdFrom, boostFailure, BoostRequestError } from "@/lib/boostAdmin";

const BOOST_PRICE_CENTS = 500; // $5.00 — WheelDeals keeps 100%

export async function POST(req: Request) {
  try {
    const uid = await authenticatedBoostOwner(req);
    const body = await req.json();
    const merchantId = merchantIdFrom(body.merchantId);
    const boostWheelPriceCents = body.boostWheelPriceCents ?? 135;
    if (typeof boostWheelPriceCents !== "number" || !Number.isSafeInteger(boostWheelPriceCents) || boostWheelPriceCents < 1) {
      throw new BoostRequestError("Choose a valid deal wheel.", 400);
    }

    const mSnap = await adminDb.collection("merchants").doc(merchantId).get();
    if (!mSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }
    if (mSnap.data()?.ownerUid !== uid) throw new BoostRequestError("Only the business owner can manage Boost.", 403);
    if (mSnap.data()?.boostActive) throw new BoostRequestError("Boost is already active. End it before starting a new one.", 409);

    // Always prefer the canonical app URL so Stripe redirects back to the
    // production app, not a Vercel preview/build URL.
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      req.headers.get("origin") ??
      req.headers.get("referer")?.replace(/\/[^/]*$/, "");
    if (!origin) {
      return NextResponse.json({ error: "Missing NEXT_PUBLIC_APP_URL" }, { status: 500 });
    }

    // WheelDeals keeps the full $5 — no transfer to merchant
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: BOOST_PRICE_CENTS,
            product_data: {
              name: "Wheel Deals Free Deal Boost — 10 Free Deals",
              description: `Unlock 10 free deals on your $${(boostWheelPriceCents / 100).toFixed(2)} wheel. Your listing gets a fire badge and orange border.`,
            },
          },
        },
      ],
      metadata: {
        merchantId,
        uid,
        boostWheelPriceCents: String(boostWheelPriceCents ?? 135),
        boostMode: mSnap.data()?.isMobile && body.boostMode === 'always' ? 'always' : 'checkin',
        type: "boost",
      },
      success_url: `${origin}/api/stripe/boost/verify?session_id={CHECKOUT_SESSION_ID}&merchantId=${encodeURIComponent(merchantId)}`,
      cancel_url: `${origin}/merchant?boost_cancelled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (error: unknown) {
    const failure = boostFailure(error);
    return NextResponse.json({ error: failure.error }, { status: failure.status });
  }
}
