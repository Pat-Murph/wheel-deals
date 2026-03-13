import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";

const FREE_SPINS_GRANTED = 10;

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");
  const merchantId = searchParams.get("merchantId");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get("origin") ?? "";

  if (!sessionId || !merchantId) {
    return NextResponse.redirect(`${origin}/merchant?boost_error=missing_params`);
  }

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return NextResponse.redirect(`${origin}/merchant?boost_error=not_paid`);
    }

    const boostWheelPriceCents = Number(session.metadata?.boostWheelPriceCents ?? 135);

    // Write boost fields to the merchant document
    await adminDb.collection("merchants").doc(merchantId).update({
      boostActive: true,
      boostFreeSpinsRemaining: FREE_SPINS_GRANTED,
      boostWheelPriceCents: boostWheelPriceCents,
      boostPurchasedAt: new Date().toISOString(),
    });

    return NextResponse.redirect(`${origin}/merchant?boost_success=1`);
  } catch (err: any) {
    console.error("Boost verify error:", err);
    return NextResponse.redirect(`${origin}/merchant?boost_error=${encodeURIComponent(err?.message ?? "server_error")}`);
  }
}
