// app/api/stripe/connect/check-status/route.ts
// Called when a merchant returns from Stripe onboarding to update stripeChargesEnabled
// Also triggers referral qualification when Stripe is first connected
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// Las Vegas metro area cities (case-insensitive matching)
const LAS_VEGAS_CITIES = [
  "las vegas", "henderson", "north las vegas", "summerlin",
  "boulder city", "paradise", "spring valley", "enterprise",
  "sunrise manor", "whitney", "winchester",
];

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

    // ── Referral qualification: when Stripe first becomes active ────────────
    if (isReady && !data.stripeChargesEnabled && data.referrerEmail) {
      // First time Stripe is connected AND there's a referrer
      if (!data.referralQualified) {
        const referrerEmail = (data.referrerEmail as string).trim().toLowerCase();
        const merchantCity = (data.city || "").trim().toLowerCase();
        const merchantState = (data.state || "").trim().toLowerCase();

        // Determine payout amount based on location
        const isLasVegas = LAS_VEGAS_CITIES.includes(merchantCity) ||
          (merchantState === "nv" || merchantState === "nevada");
        const payoutAmount = isLasVegas ? 10000 : 5000; // cents

        // Create a referral record
        const referralRef = adminDb.collection("referrals").doc();
        await referralRef.set({
          referrerEmail,
          merchantId,
          merchantName: data.name || "Unknown",
          merchantCity: data.city || "",
          merchantState: data.state || "",
          isLasVegas,
          payoutAmountCents: payoutAmount,
          status: "qualified",
          qualifiedAt: FieldValue.serverTimestamp(),
          createdAt: FieldValue.serverTimestamp(),
        });

        // Mark merchant as referral-qualified to prevent duplicates
        await mRef.update({
          referralQualified: true,
          referralQualifiedAt: FieldValue.serverTimestamp(),
        });
      }
    }

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
