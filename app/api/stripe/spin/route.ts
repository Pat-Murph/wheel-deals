import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { getTierByPrice, VALID_SPIN_PRICES, DEFAULT_TIER } from "@/lib/payments";

export async function POST(req: Request) {
  try {
    const { merchantId, uid, spinPriceCents: rawPrice } = await req.json();
    const spinPriceCents = VALID_SPIN_PRICES.includes(Number(rawPrice)) ? Number(rawPrice) : DEFAULT_TIER.priceCents;
    const tier = getTierByPrice(spinPriceCents);

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    const mSnap = await adminDb.collection("merchants").doc(merchantId).get();
    if (!mSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const merchant = mSnap.data() as any;
    const stripeAccountId = merchant?.stripeAccountId as string | undefined;

    if (!stripeAccountId) {
      return NextResponse.json({ error: "Merchant has not connected Stripe yet" }, { status: 400 });
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

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: tier.priceCents,
            product_data: { name: `Wheel Deals Unlock (${tier.label})` },
          },
        },
      ],

      // Session-level metadata (verify can read this)
      metadata: { merchantId, uid },

      payment_intent_data: {
        application_fee_amount: tier.platformFeeCents,
        transfer_data: { destination: stripeAccountId },
        metadata: { merchantId, uid, spinPriceCents: String(tier.priceCents) },
      },

      // ✅ Redirect directly back to the wheel page with session_id so it can verify and unlock.
      success_url: `${origin}/wheel?merchantId=${encodeURIComponent(merchantId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/wheel?merchantId=${encodeURIComponent(merchantId)}&cancelled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe unlock error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
