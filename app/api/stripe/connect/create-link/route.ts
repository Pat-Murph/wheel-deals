// app/api/stripe/connect/create-link/route.ts
export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";

export async function POST(req: Request) {
  try {
    const { merchantId, ownerUid } = await req.json();

    if (!merchantId || !ownerUid) {
      return NextResponse.json(
        { error: "Missing merchantId/ownerUid" },
        { status: 400 }
      );
    }

    // ✅ Admin Firestore (adminDb is not a function)
    const mRef = adminDb.collection("merchants").doc(merchantId);
    const mSnap = await mRef.get();

    if (!mSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const merchant = mSnap.data() as any;

    // Ownership check (prevents random users from hijacking merchants)
    if (merchant?.ownerUid !== ownerUid) {
      return NextResponse.json({ error: "Not authorized" }, { status: 403 });
    }

    let stripeAccountId = merchant?.stripeAccountId as string | undefined;

    // Create Stripe connected account once
    if (!stripeAccountId) {
      const acct = await stripe.accounts.create({
        type: "express",
        capabilities: {
          card_payments: { requested: true },
          transfers: { requested: true },
        },
        metadata: { merchantId, ownerUid },
      });

      stripeAccountId = acct.id;

      // Save on merchant doc (safe even if field doesn't exist yet)
      await mRef.set({ stripeAccountId }, { merge: true });
    }

    // Always prefer the canonical app URL so Stripe redirects back to production
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get("origin");
    if (!origin) {
      return NextResponse.json(
        { error: "Missing NEXT_PUBLIC_APP_URL" },
        { status: 500 }
      );
    }

    // Check current Stripe status and update stripeChargesEnabled
    try {
      const account = await stripe.accounts.retrieve(stripeAccountId);
      const isReady = account.charges_enabled === true && account.capabilities?.transfers === "active";
      await mRef.set({ stripeChargesEnabled: isReady }, { merge: true });
    } catch (e) {
      // Non-fatal: just log and continue
      console.error("Error checking Stripe account status:", e);
    }

    const link = await stripe.accountLinks.create({
      account: stripeAccountId,
      refresh_url: `${origin}/merchant?stripe=refresh`,
      return_url: `${origin}/merchant?stripe=return`,
      type: "account_onboarding",
    });

    return NextResponse.json({ url: link.url });
  } catch (e: any) {
    console.error(e);
    return NextResponse.json(
      { error: e?.message ?? "Server error" },
      { status: 500 }
    );
  }
}
