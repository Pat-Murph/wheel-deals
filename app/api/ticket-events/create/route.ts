export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * POST /api/ticket-events/create
 * Creates a new ticket event for a "tickets and events" category merchant.
 * 
 * Body: {
 *   merchantId: string,
 *   uid: string,
 *   totalSpots: number (1-500),
 *   spinTime: string (ISO datetime),
 *   eventDate: string (YYYY-MM-DD),
 *   spotPriceCents: number,
 *   recurring?: boolean,
 *   recurrencePattern?: 'daily' | 'weekly' | 'biweekly' | 'monthly',
 *   recurrenceDays?: number[],
 * }
 */
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const {
      merchantId,
      uid,
      totalSpots,
      spinTime,
      eventDate,
      spotPriceCents,
      recurring = false,
      recurrencePattern,
      recurrenceDays,
    } = body;

    // Validate required fields
    if (!merchantId || !uid || !totalSpots || !spinTime || !eventDate || !spotPriceCents) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Validate totalSpots range
    if (totalSpots < 1 || totalSpots > 500) {
      return NextResponse.json(
        { error: "Total spots must be between 1 and 500" },
        { status: 400 }
      );
    }

    // Validate spinTime is in the future
    const spinDate = new Date(spinTime);
    if (isNaN(spinDate.getTime()) || spinDate.getTime() <= Date.now()) {
      return NextResponse.json(
        { error: "Spin time must be in the future" },
        { status: 400 }
      );
    }

    // Verify merchant exists and user is owner/staff
    const merchantSnap = await adminDb.collection("merchants").doc(merchantId).get();
    if (!merchantSnap.exists) {
      return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
    }

    const merchantData = merchantSnap.data() as any;
    
    // Verify ownership
    if (merchantData.ownerUid !== uid) {
      // Check staff
      const staffSnap = await adminDb
        .collection("merchants")
        .doc(merchantId)
        .collection("staff")
        .doc(uid)
        .get();
      if (!staffSnap.exists || !staffSnap.data()?.active) {
        return NextResponse.json({ error: "Not authorized" }, { status: 403 });
      }
    }

    // Verify category is "tickets and events"
    const category = (merchantData.category || "").toLowerCase().trim();
    if (category !== "tickets and events") {
      return NextResponse.json(
        { error: "Ticket events are only available for Tickets & Events category merchants" },
        { status: 400 }
      );
    }

    // Check for existing active event on same date
    const existingSnap = await adminDb
      .collection("ticketEvents")
      .where("merchantId", "==", merchantId)
      .where("eventDate", "==", eventDate)
      .where("status", "in", ["active", "spinning"])
      .get();

    if (!existingSnap.empty) {
      return NextResponse.json(
        { error: "You already have an active event for this date" },
        { status: 400 }
      );
    }

    // Create the ticket event
    const eventRef = adminDb.collection("ticketEvents").doc();
    const eventData = {
      merchantId,
      merchantName: merchantData.name || "Unknown",
      totalSpots: Number(totalSpots),
      spotsTaken: 0,
      spinTime: spinDate.toISOString(),
      eventDate,
      spotPriceCents: Number(spotPriceCents),
      recurring: !!recurring,
      recurrencePattern: recurring ? (recurrencePattern || 'weekly') : null,
      recurrenceDays: recurring && recurrenceDays ? recurrenceDays : null,
      status: "active",
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    };

    await eventRef.set(eventData);

    return NextResponse.json({
      ok: true,
      eventId: eventRef.id,
      event: { id: eventRef.id, ...eventData },
    });
  } catch (e: any) {
    console.error("ticket-events/create error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
