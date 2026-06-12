// app/api/cron/check-stripe-status/route.ts
// Periodically checks all merchants with a stripeAccountId and updates stripeChargesEnabled.
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { stripe } from "@/lib/stripeServer";

export async function GET() {
  try {
    const snap = await adminDb
      .collection("merchants")
      .where("active", "==", true)
      .get();

    let updated = 0;
    let checked = 0;

    for (const doc of snap.docs) {
      const data = doc.data();
      const stripeAccountId = data.stripeAccountId as string | undefined;

      // Skip merchants without a Stripe account
      if (!stripeAccountId) continue;

      checked++;

      try {
        const account = await stripe.accounts.retrieve(stripeAccountId);
        const chargesEnabled = account.charges_enabled === true;
        const transfersActive = account.capabilities?.transfers === "active";
        const isReady = chargesEnabled && transfersActive;

        // Only update if the stored value differs
        if (data.stripeChargesEnabled !== isReady) {
          await doc.ref.set({ stripeChargesEnabled: isReady }, { merge: true });
          updated++;
        }
      } catch (err: any) {
        console.error(`Error checking Stripe account for ${doc.id}:`, err?.message);
      }
    }

    return NextResponse.json({
      success: true,
      checked,
      updated,
      message: `Checked ${checked} merchants, updated ${updated} Stripe statuses.`,
    });
  } catch (e: any) {
    console.error("check-stripe-status cron error:", e);
    return NextResponse.json({ error: e?.message ?? "Server error" }, { status: 500 });
  }
}
// trigger deploy
