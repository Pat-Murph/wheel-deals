import { NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { getTierByPrice, VALID_SPIN_PRICES, DEFAULT_TIER } from "@/lib/payments";

const MAX_UNLOCKS_PER_DAY = 3;

// Date key in America/Los_Angeles (matches stats)
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
    const { merchantId, uid, spinPriceCents: rawPrice } = await req.json();
    const spinPriceCents = VALID_SPIN_PRICES.includes(Number(rawPrice)) ? Number(rawPrice) : DEFAULT_TIER.priceCents;
    const tier = getTierByPrice(spinPriceCents);

    if (!merchantId || !uid) {
      return NextResponse.json({ error: "Missing merchantId/uid" }, { status: 400 });
    }

    // ── Enforce 3 unlocks/day per merchant per user ──
    const todayKey = dateKeyLA();
    const todaySpins = await adminDb
      .collection("spins")
      .where("uid", "==", uid)
      .where("merchantId", "==", merchantId)
      .where("dateKey", "==", todayKey)
      .get();

    if (todaySpins.size >= MAX_UNLOCKS_PER_DAY) {
      return NextResponse.json(
        { error: `You've reached the limit of ${MAX_UNLOCKS_PER_DAY} unlocks per day for this merchant. Come back tomorrow!` },
        { status: 429 }
      );
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

    // Check if the connected account has completed onboarding and has transfers enabled
    try {
      const account = await stripe.accounts.retrieve(stripeAccountId);
      const transfersActive = account.capabilities?.transfers === "active";
      const chargesEnabled = account.charges_enabled;
      const payoutsEnabled = account.payouts_enabled;

      if (!transfersActive || !chargesEnabled) {
        console.error(
          `Merchant ${merchantId} Stripe account ${stripeAccountId} not ready:`,
          `transfers=${account.capabilities?.transfers}, charges_enabled=${chargesEnabled}, payouts_enabled=${payoutsEnabled}`
        );
        return NextResponse.json(
          {
            error:
              "This merchant hasn't finished setting up their payment account yet. Please try again later or contact the merchant.",
          },
          { status: 400 }
        );
      }
    } catch (acctErr: any) {
      console.error("Error checking Stripe account:", acctErr);
      return NextResponse.json(
        { error: "Unable to verify merchant payment account. Please try again." },
        { status: 500 }
      );
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
