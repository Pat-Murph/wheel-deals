export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10" as any,
});

/**
 * GET /api/ticket-events/verify?session_id=...&eventId=...&uid=...&spots=...
 * Called after successful Stripe payment. Creates the entry record and redirects.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const sessionId = url.searchParams.get("session_id");
    const eventId = url.searchParams.get("eventId");
    const uid = url.searchParams.get("uid");
    const spots = Number(url.searchParams.get("spots") || "1");

    if (!sessionId || !eventId || !uid) {
      return NextResponse.redirect(new URL("/discover", req.url));
    }

    // Verify the Stripe session
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      // Payment not completed — revert spots
      const eventRef = adminDb.collection("ticketEvents").doc(eventId);
      await eventRef.update({
        spotsTaken: FieldValue.increment(-spots),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.redirect(
        new URL(`/wheel?merchantId=${session.metadata?.merchantId || ""}&event_error=payment_failed`, req.url)
      );
    }

    // Check if entry already exists for this session (idempotency)
    const existingEntry = await adminDb
      .collection("ticketEvents")
      .doc(eventId)
      .collection("entries")
      .where("sessionId", "==", sessionId)
      .get();

    if (!existingEntry.empty) {
      // Already processed — just redirect
      const merchantId = session.metadata?.merchantId || "";
      return NextResponse.redirect(
        new URL(`/wheel?merchantId=${merchantId}&event_success=1&eventId=${eventId}`, req.url)
      );
    }

    // Create the entry record
    const entryRef = adminDb
      .collection("ticketEvents")
      .doc(eventId)
      .collection("entries")
      .doc();

    await entryRef.set({
      eventId,
      merchantId: session.metadata?.merchantId || "",
      uid,
      spotCount: spots,
      sessionId,
      deviceFingerprint: session.metadata?.deviceFingerprint || "",
      purchasedAt: FieldValue.serverTimestamp(),
      status: "confirmed",
    });

    const merchantId = session.metadata?.merchantId || "";
    return NextResponse.redirect(
      new URL(`/wheel?merchantId=${merchantId}&event_success=1&eventId=${eventId}`, req.url)
    );
  } catch (e: any) {
    console.error("ticket-events/verify error:", e);
    return NextResponse.redirect(new URL("/discover", req.url));
  }
}
