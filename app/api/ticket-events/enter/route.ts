export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import Stripe from "stripe";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2024-04-10" as any,
});

/**
 * POST /api/ticket-events/enter
 * Customer purchases 1-4 spots in a ticket event.
 * Creates a Stripe Checkout session and returns the URL.
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
    const { eventId, uid, spotCount = 1, deviceFingerprint } = body;

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
    
    // Use a transaction to atomically check availability and reserve spots
    const result = await adminDb.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new Error("Event not found");

      const event = eventSnap.data() as any;

      // Check event is still active
      if (event.status !== "active") {
        throw new Error("This event is no longer accepting entries");
      }

      // Check spin time hasn't passed
      const spinTime = new Date(event.spinTime);
      if (spinTime.getTime() <= Date.now()) {
        throw new Error("Entry period has ended — the spin is about to happen!");
      }

      // Check available spots
      const available = event.totalSpots - event.spotsTaken;
      if (available <= 0) {
        throw new Error("This event is sold out!");
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

      const existingSpots = existingEntries.docs.reduce(
        (sum, d) => sum + (d.data().spotCount || 1), 0
      );

      if (existingSpots + spots > 4) {
        const remaining = 4 - existingSpots;
        if (remaining <= 0) {
          throw new Error("You already have the maximum 4 spots for this event");
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
    // Platform fee: 30% (same as regular spins)
    const platformFeeCents = Math.round(totalCents * 0.30);

    // Create Stripe Checkout session
    const origin = new URL(req.url).origin;
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: `${result.merchantName} — ${spots} Ticket${spots > 1 ? 's' : ''}`,
              description: `${spots} spot${spots > 1 ? 's' : ''} in the ticket event wheel spin`,
            },
            unit_amount: result.spotPriceCents,
          },
          quantity: spots,
        },
      ],
      payment_intent_data: {
        application_fee_amount: platformFeeCents,
        transfer_data: { destination: stripeAccountId },
      },
      metadata: {
        type: "ticket_event_entry",
        eventId,
        merchantId: result.merchantId,
        uid,
        spotCount: String(spots),
        deviceFingerprint: deviceFingerprint || "",
      },
      success_url: `${origin}/api/ticket-events/verify?session_id={CHECKOUT_SESSION_ID}&eventId=${eventId}&uid=${uid}&spots=${spots}`,
      cancel_url: `${origin}/wheel?merchantId=${result.merchantId}&event_cancelled=1`,
    });

    return NextResponse.json({ ok: true, checkoutUrl: session.url });
  } catch (e: any) {
    console.error("ticket-events/enter error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Could not process entry" },
      { status: 500 }
    );
  }
}
