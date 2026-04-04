import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";

const BOOST_PRICE_CENTS = 500; // $5.00 — WheelDeals keeps 100%
const FREE_SPINS_GRANTED = 10;

export async function POST(req: Request) {
  try {
    const { merchantId, uid, boostWheelPriceCents, boostMode } = await req.json();

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    const mSnap = await adminDb.collection("merchants").doc(merchantId).get();
    if (!mSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

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
              description: `Unlock 10 free deals on your $${(boostWheelPriceCents / 100).toFixed(2)} wheel. Your listing gets a fire badge and proximity-first placement.`,
            },
          },
        },
      ],
      metadata: {
        merchantId,
        uid,
        boostWheelPriceCents: String(boostWheelPriceCents ?? 135),
        boostMode: boostMode === 'always' ? 'always' : 'checkin',
        type: "boost",
      },
      success_url: `${origin}/api/stripe/boost/verify?session_id={CHECKOUT_SESSION_ID}&merchantId=${encodeURIComponent(merchantId)}`,
      cancel_url: `${origin}/merchant?boost_cancelled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe boost error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
