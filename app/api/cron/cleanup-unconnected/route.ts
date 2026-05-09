// app/api/cron/cleanup-unconnected/route.ts
// Deactivates merchants who haven't connected Stripe within 90 days of onboarding.
// Can be triggered by Vercel Cron or manually via GET/POST request.
export const dynamic = "force-dynamic";

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

const NINETY_DAYS_MS = 90 * 24 * 60 * 60 * 1000;

async function runCleanup() {
  const cutoff = new Date(Date.now() - NINETY_DAYS_MS);
  const merchantsRef = adminDb.collection("merchants");

  // Query all active merchants that do NOT have a stripeAccountId
  // Firestore doesn't support "field does not exist" queries directly,
  // so we query all active merchants and filter in code.
  const snap = await merchantsRef.where("active", "==", true).get();

  const deactivated: string[] = [];

  for (const doc of snap.docs) {
    const data = doc.data();

    // Skip merchants that already have Stripe connected
    if (data.stripeAccountId) continue;

    // Check createdAt — if older than 90 days, deactivate
    const createdAt = data.createdAt;
    if (!createdAt) continue; // no createdAt means legacy merchant, skip

    const createdDate = createdAt.toDate ? createdAt.toDate() : new Date(createdAt);
    if (isNaN(createdDate.getTime())) continue;

    if (createdDate < cutoff) {
      // Deactivate: set active=false so they no longer appear on Discover
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

export async function GET(req: Request) {
  try {
    // Optional: verify cron secret for security
    const authHeader = req.headers.get("authorization");
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deactivated = await runCleanup();
    return NextResponse.json({
      ok: true,
      deactivatedCount: deactivated.length,
      deactivatedIds: deactivated,
    });
  } catch (e: any) {
    console.error("Cleanup error:", e);
    return NextResponse.json(
      { ok: false, error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}

// Also support POST for flexibility
export async function POST(req: Request) {
  return GET(req);
}
