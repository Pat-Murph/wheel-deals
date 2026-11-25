export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripeServer";
import {
  confirmTicketEventSession,
  isValidCheckoutSessionId,
  releaseTicketEventReservation,
  sessionIdForCancelToken,
} from "@/lib/ticketEventCheckout";

/**
 * POST /api/ticket-events/verify  { sessionId }
 * In-app (embedded) Checkout confirmation, matching paid unlocks. Payment
 * details always come from Stripe, never the client; confirmation is idempotent.
 *
 * POST /api/ticket-events/verify  { sessionId, action: "release" }
 * Called when the customer closes in-app checkout. Spots are released only if
 * Stripe still reports the session as unpaid, and the session is expired so it
 * can no longer be paid.
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const sessionId = body?.sessionId;
    if (!isValidCheckoutSessionId(sessionId)) {
      return NextResponse.json({ ok: false, error: "Missing or invalid checkout session" }, { status: 400 });
    }
    if (body?.action === "release") {
      const session = await stripe.checkout.sessions.retrieve(sessionId);
      if (session.status === "open") await stripe.checkout.sessions.expire(sessionId).catch(() => null);
      const result = await confirmTicketEventSession(sessionId);
      if (result.ok) return NextResponse.json({ ...result, paid: true });
      if (result.status === 402) {
        await releaseTicketEventReservation(sessionId, "checkout_closed");
        return NextResponse.json({ ok: true, paid: false, released: true });
      }
      return NextResponse.json({ ok: false, error: result.error, refunded: result.refunded }, { status: result.status });
    }
    const result = await confirmTicketEventSession(sessionId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error, refunded: result.refunded }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (e: any) {
    console.error("ticket-events/verify POST error:", e);
    return NextResponse.json({ ok: false, error: "Could not confirm this payment yet" }, { status: 500 });
  }
}

/**
 * GET /api/ticket-events/verify?session_id=...   (success)
 * GET /api/ticket-events/verify?cancel_token=... (customer cancelled)
 * Hosted Checkout fallback for ordinary web browser visitors. Older hosted
 * sessions (with eventId/uid/spots in the URL) are handled the same way because
 * everything is read from the Stripe session metadata.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const cancelToken = url.searchParams.get("cancel_token");
  const cancelled = Boolean(cancelToken);
  try {
    const sessionId = cancelToken
      ? await sessionIdForCancelToken(cancelToken)
      : url.searchParams.get("session_id");
    if (!isValidCheckoutSessionId(sessionId)) {
      return NextResponse.redirect(new URL("/discover", req.url));
    }
    if (cancelled) await stripe.checkout.sessions.expire(sessionId).catch(() => null);
    const result = await confirmTicketEventSession(sessionId);
    if (result.ok) {
      return NextResponse.redirect(
        new URL(`/wheel?merchantId=${encodeURIComponent(result.merchantId)}&eventId=${encodeURIComponent(result.eventId)}&event_success=1`, req.url),
      );
    }
    if (result.status === 402 && cancelled) {
      await releaseTicketEventReservation(sessionId, "checkout_cancelled");
    }
    const target = result.merchantId && result.eventId
      ? `/wheel?merchantId=${encodeURIComponent(result.merchantId)}&eventId=${encodeURIComponent(result.eventId)}&${cancelled ? "event_cancelled=1" : "event_error=payment_failed"}`
      : "/discover";
    return NextResponse.redirect(new URL(target, req.url));
  } catch (e: any) {
    console.error("ticket-events/verify error:", e);
    return NextResponse.redirect(new URL("/discover", req.url));
  }
}
