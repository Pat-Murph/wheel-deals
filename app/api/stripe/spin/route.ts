import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { SPIN_PRICE_CENTS, PLATFORM_FEE_CENTS } from "@/lib/payments";

export async function POST(req: Request) {
  try {
    const { merchantId, uid } = await req.json();

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

    const origin = req.headers.get("origin") ?? process.env.NEXT_PUBLIC_APP_URL;
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
            unit_amount: SPIN_PRICE_CENTS,
            product_data: { name: "Wheel Deals Spin" },
          },
        },
      ],

      // Session-level metadata (verify can read this)
      metadata: { merchantId, uid },

      payment_intent_data: {
        application_fee_amount: PLATFORM_FEE_CENTS,
        transfer_data: { destination: stripeAccountId },
        metadata: { merchantId, uid },
      },

      // ✅ keep merchant in URL so the app stays on the right wheel after redirect
      success_url: `${origin}/wheel?merchantId=${encodeURIComponent(merchantId)}&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/wheel?merchantId=${encodeURIComponent(merchantId)}&cancelled=1`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err: any) {
    console.error("Stripe spin error:", err);
    return NextResponse.json({ error: err?.message ?? "Server error" }, { status: 500 });
  }
}
