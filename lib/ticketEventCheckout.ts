import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";
import { stripe } from "@/lib/stripeServer";

/**
 * Shared Daily Drop checkout bookkeeping.
 *
 * Every Checkout Session reserves spots up front. A reservation document keyed
 * by the Stripe session id makes confirmation and release idempotent, so the
 * embedded in-app flow, the hosted browser fallback and repeated verification
 * attempts can never create duplicate deals or release spots twice.
 */

export const TICKET_EVENT_CHECKOUT_TYPE = "ticket_event_entry";

export type TicketEventConfirmResult =
  | { ok: true; eventId: string; merchantId: string; uid: string; spots: number; alreadyConfirmed: boolean }
  | { ok: false; status: number; error: string; eventId?: string; merchantId?: string; refunded?: boolean };

function reservationRef(sessionId: string) {
  return adminDb.collection("ticketEventReservations").doc(sessionId);
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^cs_[A-Za-z0-9_]+$/.test(value) && value.length <= 255;
}

export function isValidCheckoutSessionId(value: unknown): value is string {
  return validSessionId(value);
}

export async function recordTicketEventReservation(input: {
  sessionId: string;
  eventId: string;
  merchantId: string;
  uid: string;
  spots: number;
  amountCents: number;
  cancelToken?: string;
}) {
  await reservationRef(input.sessionId).set({
    ...input,
    status: "pending",
    createdAt: FieldValue.serverTimestamp(),
  });
}

/** Releases reserved spots for an unpaid session exactly once. */
export async function releaseTicketEventReservation(sessionId: string, reason: string) {
  const ref = reservationRef(sessionId);
  return adminDb.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const reservation = snap.data() as any;
    if (reservation.status !== "pending") return false;
    const eventRef = adminDb.collection("ticketEvents").doc(String(reservation.eventId));
    tx.update(eventRef, {
      spotsTaken: FieldValue.increment(-Number(reservation.spots || 0)),
      updatedAt: FieldValue.serverTimestamp(),
    });
    tx.update(ref, { status: "released", releaseReason: reason, releasedAt: FieldValue.serverTimestamp() });
    return true;
  });
}

/**
 * Verifies a Daily Drop Checkout Session with Stripe and creates the paid
 * entry once. Payments that complete after the drop time are refunded and
 * their spots released, so a customer is never charged for a closed drop.
 */
export async function confirmTicketEventSession(
  sessionId: string,
  options: { allowDuringUnlock?: boolean } = {},
): Promise<TicketEventConfirmResult> {
  if (!validSessionId(sessionId)) return { ok: false, status: 400, error: "Missing or invalid checkout session" };

  const session = await stripe.checkout.sessions.retrieve(sessionId);
  const metadata = (session.metadata ?? {}) as Record<string, string>;
  const eventId = metadata.eventId ?? "";
  const merchantId = metadata.merchantId ?? "";
  const uid = metadata.uid ?? "";
  const spots = Math.min(4, Math.max(1, Math.floor(Number(metadata.spotCount || "1"))));

  if (metadata.type !== TICKET_EVENT_CHECKOUT_TYPE || !eventId || !merchantId || !uid) {
    return { ok: false, status: 400, error: "This checkout is not a Daily Drop purchase" };
  }

  if (session.payment_status !== "paid") {
    if (session.status === "expired") await releaseTicketEventReservation(sessionId, "checkout_expired");
    return { ok: false, status: 402, error: "Payment is not complete yet", eventId, merchantId };
  }

  const eventRef = adminDb.collection("ticketEvents").doc(eventId);
  const entryRef = eventRef.collection("entries").doc(sessionId);
  const resRef = reservationRef(sessionId);

  const outcome = await adminDb.runTransaction(async (tx) => {
    const [eventSnap, entrySnap, resSnap] = await Promise.all([tx.get(eventRef), tx.get(entryRef), tx.get(resRef)]);
    if (entrySnap.exists) return { kind: "already" as const };

    // Legacy hosted sessions created before reservations existed are also
    // de-duplicated by looking for an entry carrying the same session id.
    const legacy = await eventRef.collection("entries").where("sessionId", "==", sessionId).limit(1).get();
    if (!legacy.empty) return { kind: "already" as const };

    if (!eventSnap.exists) return { kind: "late" as const, holdsSpots: false };
    const event = eventSnap.data() as any;
    const reservation = resSnap.exists ? (resSnap.data() as any) : null;
    const holdsSpots = !reservation || reservation.status === "pending";
    const expectedCents = Number(event.spotPriceCents || 0) * spots;
    if (!expectedCents || session.amount_total !== expectedCents || String(event.merchantId) !== merchantId) {
      return { kind: "mismatch" as const };
    }

    // At drop time the server reconciles checkouts that were paid before the
    // drop but never confirmed by the app (for example, the app was closed).
    const closed = options.allowDuringUnlock
      ? !["active", "spinning"].includes(String(event.status))
      : event.status !== "active" || new Date(event.spinTime).getTime() <= Date.now();
    if (closed) {
      if (holdsSpots) {
        tx.update(eventRef, { spotsTaken: FieldValue.increment(-spots), updatedAt: FieldValue.serverTimestamp() });
      }
      tx.set(resRef, { eventId, merchantId, uid, spots, status: "refunded", refundedAt: FieldValue.serverTimestamp() }, { merge: true });
      return { kind: "late" as const, holdsSpots };
    }

    // A released reservation (checkout was closed, then paid anyway) must take
    // its spots back before it can join the drop.
    if (!holdsSpots) {
      if (Number(event.totalSpots) - Number(event.spotsTaken) < spots) {
        tx.set(resRef, { status: "refunded", refundedAt: FieldValue.serverTimestamp() }, { merge: true });
        return { kind: "late" as const, holdsSpots: false };
      }
      tx.update(eventRef, { spotsTaken: FieldValue.increment(spots), updatedAt: FieldValue.serverTimestamp() });
    }

    tx.set(entryRef, {
      eventId,
      merchantId,
      uid,
      spotCount: spots,
      sessionId,
      deviceFingerprint: metadata.deviceFingerprint || "",
      purchasedAt: FieldValue.serverTimestamp(),
      status: "confirmed",
    });
    tx.set(resRef, { eventId, merchantId, uid, spots, status: "confirmed", confirmedAt: FieldValue.serverTimestamp() }, { merge: true });
    return { kind: "confirmed" as const };
  });

  if (outcome.kind === "already") return { ok: true, eventId, merchantId, uid, spots, alreadyConfirmed: true };
  if (outcome.kind === "confirmed") return { ok: true, eventId, merchantId, uid, spots, alreadyConfirmed: false };
  if (outcome.kind === "mismatch") return { ok: false, status: 400, error: "Payment amount did not match this Daily Drop", eventId, merchantId };

  // Late or full: refund the customer automatically, including the platform
  // fee and the merchant transfer. Idempotency keeps retries from double refunding.
  let refunded = false;
  const paymentIntent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id;
  if (paymentIntent) {
    try {
      await stripe.refunds.create(
        { payment_intent: paymentIntent, reverse_transfer: true, refund_application_fee: true },
        { idempotencyKey: `daily-drop-late-${sessionId}` },
      );
      refunded = true;
    } catch (error) {
      console.error("Daily Drop late payment refund failed:", error);
    }
  }
  return {
    ok: false,
    status: 409,
    error: refunded
      ? "This Daily Drop closed before your payment finished, so your payment was refunded."
      : "This Daily Drop closed before your payment finished. Please contact support for a refund.",
    eventId,
    merchantId,
    refunded,
  };
}

/**
 * Confirms every paid-but-unconfirmed checkout for a Daily Drop right before
 * deals are unlocked, so nobody who paid is left out. Unpaid open checkouts
 * are left alone; if they are paid later they are refunded as late payments.
 */
export async function reconcilePendingTicketEventReservations(eventId: string) {
  const pending = await adminDb
    .collection("ticketEventReservations")
    .where("eventId", "==", eventId)
    .where("status", "==", "pending")
    .get();
  let confirmed = 0;
  for (const doc of pending.docs) {
    try {
      const result = await confirmTicketEventSession(doc.id, { allowDuringUnlock: true });
      if (result.ok && !result.alreadyConfirmed) confirmed += 1;
    } catch (error) {
      console.error("Daily Drop reservation reconcile failed:", doc.id, error);
    }
  }
  return confirmed;
}

/**
 * Public Daily Drop data must never include other customers' redemption codes.
 * Results are reduced to the requesting customer's own deals, or removed.
 */
export function publicTicketEvent<T extends Record<string, any>>(event: T, uid?: string | null): T {
  const results = Array.isArray(event?.results) ? event.results : [];
  return {
    ...event,
    results: uid ? results.filter((r: any) => r?.uid === uid) : [],
  };
}

/** Finds the checkout session for a hosted-checkout cancel link. */
export async function sessionIdForCancelToken(token: string) {
  if (!/^[a-f0-9-]{36}$/i.test(token)) return null;
  const snap = await adminDb
    .collection("ticketEventReservations")
    .where("cancelToken", "==", token)
    .limit(1)
    .get();
  return snap.empty ? null : snap.docs[0].id;
}

const STALE_RESERVATION_MS = 32 * 60 * 1000;

/**
 * Abandoned checkouts expire at Stripe after about 31 minutes. Re-checking
 * older pending reservations frees their spots (or confirms them if they were
 * actually paid), so a closed app never holds spots indefinitely.
 */
export async function sweepStaleTicketEventReservations(eventId: string) {
  const pending = await adminDb
    .collection("ticketEventReservations")
    .where("eventId", "==", eventId)
    .where("status", "==", "pending")
    .get();
  const cutoff = Date.now() - STALE_RESERVATION_MS;
  for (const doc of pending.docs) {
    const created = (doc.data() as any).createdAt?.toDate?.()?.getTime?.() ?? 0;
    if (created > cutoff) continue;
    try {
      await confirmTicketEventSession(doc.id);
    } catch (error) {
      console.error("Daily Drop stale reservation check failed:", doc.id, error);
    }
  }
}
