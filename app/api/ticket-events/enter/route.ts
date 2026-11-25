export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { stripe } from "@/lib/stripeServer";
import { randomUUID } from "node:crypto";
import { recordTicketEventReservation, sweepStaleTicketEventReservations, TICKET_EVENT_CHECKOUT_TYPE } from "@/lib/ticketEventCheckout";

/**
 * POST /api/ticket-events/enter
 * Customer purchases 1-4 spots in a ticket event.
 * Creates an embedded (in-app) Stripe Checkout session, or a hosted
 * browser fallback, and reserves the spots until payment is confirmed.
 * 
 * Body: {
 *   eventId: string,
 *   uid: string,
 *   spotCount: number (1-4),
 *   deviceFingerprint?: string,
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { eventId, uid, spotCount = 1, deviceFingerprint, checkoutMode } = body;

    if (!eventId || !uid) {
      return NextResponse.json(
        { error: "Missing eventId or uid" },
        { status: 400 }
      );
    }

    // Validate spot count
    const spots = Math.min(4, Math.max(1, Math.floor(Number(spotCount))));

    // Get the event
    const eventRef = adminDb.collection("ticketEvents").doc(eventId);
    // Free spots held by abandoned checkouts before checking availability.
    await sweepStaleTicketEventReservations(eventId).catch((error) => {
      console.error("Daily Drop reservation sweep failed:", error);
    });
    
    // Use a transaction to atomically check availability and reserve spots
    const result = await adminDb.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new Error("Event not found");

      const event = eventSnap.data() as any;

      // Check event is still active
      if (event.status !== "active") {
        throw new Error("This Daily Drop is no longer open");
      }

      // Check spin time hasn't passed
      const spinTime = new Date(event.spinTime);
      if (spinTime.getTime() <= Date.now()) {
        throw new Error("This Daily Drop is closed — deals are unlocking now!");
      }

      // Check available spots
      const available = event.totalSpots - event.spotsTaken;
      if (available <= 0) {
        throw new Error("All spots for this Daily Drop are taken.");
      }
      if (spots > available) {
        throw new Error(`Only ${available} spot${available === 1 ? '' : 's'} remaining`);
      }

      // Check if user already has entries for this event (max 4 total)
      const existingEntries = await adminDb
        .collection("ticketEvents")
        .doc(eventId)
        .collection("entries")
        .where("uid", "==", uid)
        .get();

      // Open (unpaid) checkouts also hold spots, so they count toward the limit.
      const pendingReservations = await adminDb
        .collection("ticketEventReservations")
        .where("eventId", "==", eventId)
        .where("uid", "==", uid)
        .where("status", "==", "pending")
        .get();
      const existingSpots = existingEntries.docs.reduce(
        (sum, d) => sum + (d.data().spotCount || 1), 0
      ) + pendingReservations.docs.reduce(
        (sum, d) => sum + (Number(d.data().spots) || 0), 0
      );

      if (existingSpots + spots > 4) {
        const remaining = 4 - existingSpots;
        if (remaining <= 0) {
          throw new Error("You already have the maximum 4 spots for this Daily Drop (including any checkout still open)");
        }
        throw new Error(`You can only buy ${remaining} more spot${remaining === 1 ? '' : 's'} for this event`);
      }

      // Reserve the spots (increment spotsTaken)
      tx.update(eventRef, {
        spotsTaken: FieldValue.increment(spots),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        merchantId: event.merchantId,
        spotPriceCents: event.spotPriceCents,
        merchantName: event.merchantName || "Ticket Event",
        stripeAccountId: null, // We'll look this up
      };
    });

    // Get merchant's Stripe account for the payment
    const merchantSnap = await adminDb.collection("merchants").doc(result.merchantId).get();
    const merchantData = merchantSnap.data() as any;
    const stripeAccountId = merchantData?.stripeAccountId;

    if (!stripeAccountId) {
      // Revert the spot reservation since we can't process payment
      await eventRef.update({
        spotsTaken: FieldValue.increment(-spots),
        updatedAt: FieldValue.serverTimestamp(),
      });
      return NextResponse.json(
        { error: "Merchant payment not set up" },
        { status: 400 }
      );
    }

    // Calculate total
    const totalCents = result.spotPriceCents * spots;
    // Platform fee: 30% (same as regular unlocks)
    const platformFeeCents = Math.round(totalCents * 0.30);
    const metadata = {
      type: TICKET_EVENT_CHECKOUT_TYPE,
      eventId,
      merchantId: result.merchantId,
      uid,
      spotCount: String(spots),
      deviceFingerprint: typeof deviceFingerprint === "string" ? deviceFingerprint.slice(0, 200) : "",
    };
    const commonSession = {
      mode: "payment" as const,
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${result.merchantName} — Daily Drop (${spots} deal${spots > 1 ? "s" : ""})`,
              description: `${spots} deal unlock${spots > 1 ? "s" : ""} for the Daily Drop`,
            },
            unit_amount: result.spotPriceCents,
          },
          quantity: spots,
        },
      ],
      // Stripe's minimum lifetime; abandoned reservations free up afterwards.
      expires_at: Math.floor(Date.now() / 1000) + 31 * 60,
      metadata,
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: stripeAccountId },
        metadata,
      },
    };
    const origin =
      process.env.NEXT_PUBLIC_APP_URL ??
      req.headers.get("origin") ??
      new URL(req.url).origin;
    const publishableKey =
      process.env.STRIPE_PUBLISHABLE_KEY ??
      process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY;
    const cancelToken = randomUUID();
    let session;
    try {
      if (checkoutMode === "embedded" && publishableKey) {
        // Same in-app experience as paid unlocks: Checkout stays inside the app
        // and the client confirms the entry through /api/ticket-events/verify.
        session = await stripe.checkout.sessions.create({
          ...commonSession,
          ui_mode: "embedded",
          redirect_on_completion: "never",
        });
      } else {
        session = await stripe.checkout.sessions.create({
          ...commonSession,
          success_url: `${origin}/api/ticket-events/verify?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${origin}/api/ticket-events/verify?cancel_token=${cancelToken}`,
        });
      }
    } catch (checkoutError) {
      await eventRef.update({
        spotsTaken: FieldValue.increment(-spots),
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw checkoutError;
    }
    await recordTicketEventReservation({
      sessionId: session.id,
      eventId,
      merchantId: result.merchantId,
      uid,
      spots,
      amountCents: totalCents,
      cancelToken,
    });
    if (session.client_secret && publishableKey && checkoutMode === "embedded") {
      return NextResponse.json({
        ok: true,
        clientSecret: session.client_secret,
        sessionId: session.id,
        publishableKey,
      });
    }
    return NextResponse.json({ ok: true, checkoutUrl: session.url, sessionId: session.id });
  } catch (e: any) {
    console.error("ticket-events/enter error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Could not process entry" },
      { status: 500 }
    );
  }
}
