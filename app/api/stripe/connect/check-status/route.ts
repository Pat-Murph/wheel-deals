// app/api/stripe/connect/check-status/route.ts
// Called when a merchant returns from Stripe onboarding to update stripeChargesEnabled
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const { merchantId } = await req.json();

    if (!merchantId) {
      return NextResponse.json({ error: "Missing merchantId" }, { status: 400 });
    }

    const mRef = adminDb.collection("merchants").doc(merchantId);
    const mSnap = await mRef.get();

    if (!mSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const data = mSnap.data() as any;
    const stripeAccountId = data.stripeAccountId as string | undefined;

    if (!stripeAccountId) {
      return NextResponse.json({ chargesEnabled: false, message: "No Stripe account" });
    }

    const account = await stripe.accounts.retrieve(stripeAccountId);
    const chargesEnabled = account.charges_enabled === true;
    const transfersActive = account.capabilities?.transfers === "active";
    const isReady = chargesEnabled && transfersActive;

    await mRef.set({ stripeChargesEnabled: isReady }, { merge: true });

    return NextResponse.json({
      chargesEnabled: isReady,
      details: {
        charges_enabled: chargesEnabled,
        transfers: account.capabilities?.transfers,
        payouts_enabled: account.payouts_enabled,
      },
    });
  } catch (e: any) {
    console.error("check-status error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
