export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

// No confusing characters: 0/O, 1/I
function makeCode(len = 8) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function dateKeyLA(d = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const yyyy = parts.find((p) => p.type === "year")?.value ?? "1970";
  const mm = parts.find((p) => p.type === "month")?.value ?? "01";
  const dd = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * POST /api/ticket-events/spin
 * Triggered when spin time arrives. Resolves all entries for the event.
 * Each entry gets a random prize from the merchant's wheel.
 * 
 * Body: { eventId: string }
 * 
 * Can be called by:
 * - Client-side when countdown reaches 0 (first caller wins the race)
 * - Cron job as a fallback
 */
export async function POST(req: Request) {
  try {
    const { eventId } = await req.json();

    if (!eventId) {
      return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
    }

    const eventRef = adminDb.collection("ticketEvents").doc(eventId);

    // Use transaction to ensure only one spin execution
    const result = await adminDb.runTransaction(async (tx) => {
      const eventSnap = await tx.get(eventRef);
      if (!eventSnap.exists) throw new Error("Event not found");

      const event = eventSnap.data() as any;

      // Only spin if status is 'active' (prevents double-spin)
      if (event.status !== "active") {
        return { alreadySpun: true, status: event.status };
      }

      // Mark as spinning
      tx.update(eventRef, {
        status: "spinning",
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        alreadySpun: false,
        merchantId: event.merchantId,
        spotPriceCents: event.spotPriceCents,
      };
    });

    if (result.alreadySpun) {
      return NextResponse.json({ ok: true, message: "Event already processed", status: result.status });
    }

    // Get the merchant's wheel items (prefer multi-wheel 'wheels' array, fall back to legacy 'wheel')
    const merchantSnap = await adminDb.collection("merchants").doc(result.merchantId).get();
    const merchantData = merchantSnap.data() as any;
    let wheelItems: Array<{ label: string; weight: number }> = [];
    if (Array.isArray(merchantData?.wheels) && merchantData.wheels.length > 0) {
      // Use the first wheel that matches the event price, or first wheel
      const matchingWheel = merchantData.wheels.find((w: any) => w.spinPriceCents === result.spotPriceCents)
        || merchantData.wheels[0];
      wheelItems = Array.isArray(matchingWheel?.items)
        ? matchingWheel.items.filter((i: any) => i.label && i.weight > 0)
        : [];
    }
    if (wheelItems.length === 0 && Array.isArray(merchantData?.wheel)) {
      wheelItems = merchantData.wheel.filter((i: any) => i.label && i.weight > 0);
    }

    if (wheelItems.length === 0) {
      // No wheel configured — mark as completed with error
      await eventRef.update({
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        error: "No wheel prizes configured",
      });
      return NextResponse.json({ error: "No wheel prizes configured" }, { status: 400 });
    }

    // Get all entries
    const entriesSnap = await adminDb
      .collection("ticketEvents")
      .doc(eventId)
      .collection("entries")
      .where("status", "==", "confirmed")
      .get();

    // Weighted random prize selection
    const totalWeight = wheelItems.reduce((sum, item) => sum + item.weight, 0);
    function pickPrize(): string {
      let rand = Math.random() * totalWeight;
      for (const item of wheelItems) {
        rand -= item.weight;
        if (rand <= 0) return item.label;
      }
      return wheelItems[wheelItems.length - 1].label;
    }

    // Generate results for each entry (each spot gets its own spin)
    const results: any[] = [];
    const dayKey = dateKeyLA();
    const batch = adminDb.batch();
    let totalSpinsCount = 0;

    for (const entryDoc of entriesSnap.docs) {
      const entry = entryDoc.data();
      const spotCount = entry.spotCount || 1;

      for (let i = 0; i < spotCount; i++) {
        const prizeLabel = pickPrize();
        const code = makeCode(8);
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

        // Create a spin record (same shape as regular spins for redemption compatibility)
        const spinRef = adminDb.collection("spins").doc();
        batch.set(spinRef, {
          merchantId: result.merchantId,
          uid: entry.uid,
          prizeLabel,
          status: "issued",
          code,
          type: "ticket_event",
          eventId,
          entryId: entryDoc.id,
          spotIndex: i,
          spinPriceCents: result.spotPriceCents,
          revenueCents: Math.round(result.spotPriceCents * 0.70), // 70% to merchant
          createdAt: FieldValue.serverTimestamp(),
          expiresAt,
          dateKey: dayKey,
        });

        // Code index for fast lookup
        const codeRef = adminDb.collection("redemptionCodes").doc(code);
        batch.set(codeRef, {
          merchantId: result.merchantId,
          spinId: spinRef.id,
          status: "issued",
          createdAt: FieldValue.serverTimestamp(),
        });

        results.push({
          entryId: entryDoc.id,
          uid: entry.uid,
          spotIndex: i,
          prize: prizeLabel,
          prizeLabel,
          code,
          expiresAt: expiresAt.toISOString(),
          spinId: spinRef.id,
        });

        totalSpinsCount++;
      }

      // Update entry status
      batch.update(entryDoc.ref, {
        status: "spun",
        spunAt: FieldValue.serverTimestamp(),
      });
    }

    // Update merchant daily stats
    if (totalSpinsCount > 0) {
      const dailyStatsRef = adminDb
        .collection("merchantStats")
        .doc(result.merchantId)
        .collection("daily")
        .doc(dayKey);

      batch.set(
        dailyStatsRef,
        {
          dateKey: dayKey,
          spinsCount: FieldValue.increment(totalSpinsCount),
          revenueCents: FieldValue.increment(Math.round(result.spotPriceCents * 0.70 * totalSpinsCount)),
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    }

    // Mark event as completed with results
    batch.update(eventRef, {
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      results,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // If recurring, create the next event instance
    const eventSnap = await eventRef.get();
    const eventData = eventSnap.data() as any;
    if (eventData.recurring && eventData.recurrencePattern) {
      await createNextRecurringEvent(eventData);
    }

    return NextResponse.json({
      ok: true,
      resultsCount: results.length,
      results,
    });
  } catch (e: any) {
    console.error("ticket-events/spin error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Spin failed" },
      { status: 500 }
    );
  }
}

/**
 * Creates the next instance of a recurring event.
 */
async function createNextRecurringEvent(prevEvent: any) {
  const prevDate = new Date(prevEvent.eventDate + "T00:00:00");
  const prevSpinTime = new Date(prevEvent.spinTime);
  
  // Calculate the time-of-day offset from the event date
  const spinHour = prevSpinTime.getHours();
  const spinMinute = prevSpinTime.getMinutes();

  let nextDate: Date;

  switch (prevEvent.recurrencePattern) {
    case 'daily':
      nextDate = new Date(prevDate);
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case 'weekly':
      nextDate = new Date(prevDate);
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case 'biweekly':
      nextDate = new Date(prevDate);
      nextDate.setDate(nextDate.getDate() + 14);
      break;
    case 'monthly':
      nextDate = new Date(prevDate);
      nextDate.setMonth(nextDate.getMonth() + 1);
      break;
    default:
      return; // Unknown pattern
  }

  // Set the spin time for the next event
  const nextSpinTime = new Date(nextDate);
  nextSpinTime.setHours(spinHour, spinMinute, 0, 0);

  // Don't create if next date is in the past
  if (nextSpinTime.getTime() <= Date.now()) return;

  const nextEventDate = nextDate.toISOString().split("T")[0];

  const eventRef = adminDb.collection("ticketEvents").doc();
  await eventRef.set({
    merchantId: prevEvent.merchantId,
    merchantName: prevEvent.merchantName,
    totalSpots: prevEvent.totalSpots,
    spotsTaken: 0,
    spinTime: nextSpinTime.toISOString(),
    eventDate: nextEventDate,
    spotPriceCents: prevEvent.spotPriceCents,
    recurring: true,
    recurrencePattern: prevEvent.recurrencePattern,
    recurrenceDays: prevEvent.recurrenceDays || null,
    status: "active",
    parentEventId: prevEvent.merchantId, // link to original series
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
