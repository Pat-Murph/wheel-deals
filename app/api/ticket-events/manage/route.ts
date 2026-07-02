export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/ticket-events/manage
 * Merchant management actions for ticket events.
 * 
 * Body: {
 *   eventId: string,
 *   uid: string,
 *   action: 'pause' | 'resume' | 'cancel',
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { eventId, uid, action } = body;

    if (!eventId || !uid || !action) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Get the event
    const eventRef = adminDb.collection("ticketEvents").doc(eventId);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const event = eventSnap.data() as any;

    // Verify ownership
    const merchantSnap = await adminDb.collection("merchants").doc(event.merchantId).get();
    const merchantData = merchantSnap.data() as any;
    if (merchantData?.ownerUid !== uid) {
      const staffSnap = await adminDb
        .collection("merchants")
        .doc(event.merchantId)
        .collection("staff")
        .doc(uid)
        .get();
      if (!staffSnap.exists || !staffSnap.data()?.active) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    switch (action) {
      case 'pause':
        if (event.status !== 'active') {
          return NextResponse.json({ error: "Can only pause active events" }, { status: 400 });
        }
        await eventRef.update({
          status: "paused",
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;

      case 'resume':
        if (event.status !== 'paused') {
          return NextResponse.json({ error: "Can only resume paused events" }, { status: 400 });
        }
        // Only resume if spin time is still in the future
        if (new Date(event.spinTime).getTime() <= Date.now()) {
          return NextResponse.json({ error: "Cannot resume — spin time has passed" }, { status: 400 });
        }
        await eventRef.update({
          status: "active",
          updatedAt: FieldValue.serverTimestamp(),
        });
        break;

      case 'cancel':
        if (event.status === 'completed' || event.status === 'spinning') {
          return NextResponse.json({ error: "Cannot cancel a completed or spinning event" }, { status: 400 });
        }
        await eventRef.update({
          status: "cancelled",
          updatedAt: FieldValue.serverTimestamp(),
        });
        // Note: In production, you'd want to refund entries here
        break;

      default:
        return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, action, eventId });
  } catch (e: any) {
    console.error("ticket-events/manage error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
