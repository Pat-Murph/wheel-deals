import { NextRequest, NextResponse } from "next/server";
export const dynamic = "force-dynamic";
import { stripe } from "@/lib/stripeServer";
import { adminDb } from "@/lib/firebaseAdmin";
import { STANDARD_BOOST_UNLOCKS } from "@/lib/boostAdmin";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const sessionId = searchParams.get("session_id");
  const merchantId = searchParams.get("merchantId");
  const origin = process.env.NEXT_PUBLIC_APP_URL ?? req.headers.get("origin") ?? "";
  if (!sessionId || !merchantId) return NextResponse.redirect(`${origin}/merchant?boost_error=missing_params`);

  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") return NextResponse.redirect(`${origin}/merchant?boost_error=not_paid`);
    if (session.metadata?.type !== "boost" || session.metadata.merchantId !== merchantId) {
      return NextResponse.redirect(`${origin}/merchant?boost_error=invalid_boost_session`);
    }
    const merchantRef = adminDb.collection("merchants").doc(merchantId);
    const receiptRef = adminDb.collection("boostPayments").doc(session.id);
    const outcome = await adminDb.runTransaction(async (tx) => {
      const [merchantSnapshot, receiptSnapshot] = await Promise.all([tx.get(merchantRef), tx.get(receiptRef)]);
      if (!merchantSnapshot.exists) throw new Error("Business not found");
      if (merchantSnapshot.data()?.ownerUid !== session.metadata?.uid) throw new Error("Business owner mismatch");
      if (receiptSnapshot.exists) return "already_processed";
      if (merchantSnapshot.data()?.boostPaidSessionId === session.id) return "already_processed";
      const endedAt = merchantSnapshot.data()?.boostEndedAt;
      // Pre-update paid sessions have no receipt yet. A confirmation link from
      // before the manual End action must not undo that action.
      if (typeof endedAt === "string" && session.created * 1000 <= Date.parse(endedAt)) {
        tx.set(receiptRef, { merchantId, sessionId: session.id, skippedAfterEnd: true });
        return "ended_campaign";
      }
      if (merchantSnapshot.data()?.boostActive) return "already_active";
      tx.update(merchantRef, {
        boostActive: true,
        boostFreeSpinsRemaining: STANDARD_BOOST_UNLOCKS,
        boostUnlocksGranted: STANDARD_BOOST_UNLOCKS,
        boostWheelPriceCents: Number(session.metadata?.boostWheelPriceCents ?? 135),
        boostMode: session.metadata?.boostMode === "always" ? "always" : "checkin",
        boostPurchasedAt: new Date().toISOString(),
        boostPaidSessionId: session.id,
      });
      tx.set(receiptRef, { merchantId, sessionId: session.id, activatedAt: new Date().toISOString() });
      return "activated";
    });
    if (outcome !== "activated") return NextResponse.redirect(`${origin}/merchant?boost_notice=${outcome}`);
    return NextResponse.redirect(`${origin}/merchant?boost_success=1`);
  } catch (error: unknown) {
    console.error("Boost verify error:", error);
    return NextResponse.redirect(`${origin}/merchant?boost_error=verification_failed`);
  }
}
