// app/api/cron/cleanup-unconnected/route.ts
// Checks active merchants with a stripeAccountId and updates stripeChargesEnabled.
// Merchants are no longer deactivated automatically for not connecting Stripe.
// Can be triggered by Vercel Cron or manually via GET/POST request.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { stripe } from "@/lib/stripeServer";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

async function checkStripeStatuses() {
  const merchantsRef = adminDb.collection("merchants");
  const snap = await merchantsRef.where("active", "==", true).get();

  let checked = 0;
  let updated = 0;

  for (const doc of snap.docs) {
    const data = doc.data();
    const stripeAccountId = data.stripeAccountId as string | undefined;
    if (!stripeAccountId) continue;
    checked++;
    try {
      const account = await stripe.accounts.retrieve(stripeAccountId);
      const chargesEnabled = account.charges_enabled === true;
      const transfersActive = account.capabilities?.transfers === "active";
      const isReady = chargesEnabled && transfersActive;
      if (data.stripeChargesEnabled !== isReady) {
        await doc.ref.set({ stripeChargesEnabled: isReady }, { merge: true });
        updated++;
      }
    } catch (error: unknown) {
      console.error(`Error checking Stripe account for ${doc.id}:`, errorMessage(error));
    }
  }
  return { checked, updated };
}

export async function GET(req: Request) {
  try {
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const stripeStatus = await checkStripeStatuses();

    return NextResponse.json({
      ok: true,
      automaticMerchantDeactivation: false,
      deactivatedCount: 0,
      deactivatedIds: [],
      stripeStatusChecked: stripeStatus.checked,
      stripeStatusUpdated: stripeStatus.updated,
    });
  } catch (error: unknown) {
    console.error("Stripe status sync error:", error);
    return NextResponse.json(
      { ok: false, error: errorMessage(error) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
