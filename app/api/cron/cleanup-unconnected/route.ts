// app/api/cron/cleanup-unconnected/route.ts
// 1. Deactivates merchants who haven't connected Stripe within 90 days of onboarding.
// 2. Checks all merchants with a stripeAccountId and updates stripeChargesEnabled.
// Can be triggered by Vercel Cron or manually via GET/POST request.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { stripe } from "@/lib/stripeServer";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

async function runCleanup() {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  const merchantsRef = adminDb.collection("merchants");

  const snap = await merchantsRef.where("active", "==", true).get();

  const deactivated: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();
    // Skip merchants that already have Stripe connected
    if (data.stripeAccountId) continue;
    // Check createdAt — if older than 90 days, deactivate
    const createdAt = data.createdAt;
    if (!createdAt) continue;
    const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    if (isNaN(createdDate.getTime())) continue;
    if (createdDate < cutoff) {
      await merchantsRef.doc(doc.id).update({
        active: false,
        deactivatedReason: "stripe_not_connected_90d",
        deactivatedAt: new Date(),
      });
      deactivated.push(doc.id);
    }
  }
  return deactivated;
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
    } catch (err: any) {
      console.error(`Error checking Stripe account for ${doc.id}:`, err?.message);
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

    const deactivated = await runCleanup();
    const stripeStatus = await checkStripeStatuses();

    return NextResponse.json({
      ok: true,
      deactivatedCount: deactivated.length,
      deactivatedIds: deactivated,
      stripeStatusChecked: stripeStatus.checked,
      stripeStatusUpdated: stripeStatus.updated,
    });
  } catch (e: any) {
    console.error("Cleanup error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  return GET(req);
}
