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
 * 
 * KEY BEHAVIOR: Everyone who entered gets the SAME prize result for that day.
 * Each entry gets a unique redemption code, but the prize is shared.
 * 
 * Body: { eventId: string, uid?: string }
 * 
 * Can be called by:
 * - Client-side when countdown reaches 0 (first caller wins the race)
 * - Cron job as a fallback
 */
export async function POST(req: Request) {
  try {
    const { eventId, uid } = await req.json();

    if (!eventId) {
      return NextResponse.json({ error: "Missing eventId" }, { status: 400 });
    }

    const eventRef = adminDb.collection("ticketEvents").doc(eventId);

    // Check if event already completed — if so, just return existing results
    const existingSnap = await eventRef.get();
    if (!existingSnap.exists) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }
    const existingData = existingSnap.data() as any;

    if (existingData.status === "completed" && existingData.results) {
      // Event already spun — return existing results (filtered by uid if provided)
      const results = uid
        ? existingData.results.filter((r: any) => r.uid === uid)
        : existingData.results;
      return NextResponse.json({ ok: true, results, alreadyCompleted: true });
    }

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
        validFrom: event.validFrom,
        validTo: event.validTo,
        eventDate: event.eventDate,
        recurring: event.recurring,
        recurrencePattern: event.recurrencePattern,
        recurrenceDays: event.recurrenceDays,
        merchantName: event.merchantName,
        totalSpots: event.totalSpots,
      };
    });

    if (result.alreadySpun) {
      // If it's completed, try to fetch results
      const refetchSnap = await eventRef.get();
      const refetchData = refetchSnap.data() as any;
      if (refetchData?.results) {
        const results = uid
          ? refetchData.results.filter((r: any) => r.uid === uid)
          : refetchData.results;
        return NextResponse.json({ ok: true, results, alreadyCompleted: true });
      }
      return NextResponse.json({ ok: true, message: "Event already processing", status: result.status });
    }

    // Get the merchant's wheel items
    const merchantSnap = await adminDb.collection("merchants").doc(result.merchantId).get();
    const merchantData = merchantSnap.data() as any;
    let wheelItems: Array<{ label: string; weight: number }> = [];
    if (Array.isArray(merchantData?.wheels) && merchantData.wheels.length > 0) {
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

    // ===== ONE SHARED PRIZE FOR EVERYONE =====
    // Pick a single prize that ALL entrants win
    const totalWeight = wheelItems.reduce((sum, item) => sum + item.weight, 0);
    let rand = Math.random() * totalWeight;
    let sharedPrize = wheelItems[wheelItems.length - 1].label;
    for (const item of wheelItems) {
      rand -= item.weight;
      if (rand <= 0) {
        sharedPrize = item.label;
        break;
      }
    }

    // Determine expiry based on validTo or 30 days
    const expiresAt = result.validTo
      ? new Date(result.validTo + "T23:59:59")
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Generate results — each entry gets the SAME prize but unique code
    const results: any[] = [];
    const dayKey = dateKeyLA();
    const batch = adminDb.batch();
    let totalSpinsCount = 0;

    for (const entryDoc of entriesSnap.docs) {
      const entry = entryDoc.data();
      const spotCount = entry.spotCount || 1;

      // Each spot gets its own code (for redemption tracking) but same prize
      for (let i = 0; i < spotCount; i++) {
        const code = makeCode(8);

        // Create a spin record
        const spinRef = adminDb.collection("spins").doc();
        batch.set(spinRef, {
          merchantId: result.merchantId,
          uid: entry.uid,
          prizeLabel: sharedPrize,
          status: "issued",
          code,
          type: "ticket_event",
          eventId,
          entryId: entryDoc.id,
          spotIndex: i,
          spinPriceCents: result.spotPriceCents,
          revenueCents: Math.round(result.spotPriceCents * 0.70),
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
          prize: sharedPrize,
          code,
          expiresAt: expiresAt.toISOString(),
          spinId: spinRef.id,
          validFrom: result.validFrom,
          validTo: result.validTo,
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

    // Mark event as completed with results + shared prize info
    batch.update(eventRef, {
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      sharedPrize,
      results,
      updatedAt: FieldValue.serverTimestamp(),
    });

    await batch.commit();

    // If recurring, create the next event instance
    const eventSnap2 = await eventRef.get();
    const eventData2 = eventSnap2.data() as any;
    if (eventData2.recurring && eventData2.recurrencePattern) {
      await createNextRecurringEvent(eventData2, eventId);
    }

    // Return results filtered by uid if provided
    const filteredResults = uid
      ? results.filter((r: any) => r.uid === uid)
      : results;

    return NextResponse.json({
      ok: true,
      sharedPrize,
      resultsCount: results.length,
      results: filteredResults,
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
 * Carries forward validFrom/validTo offsets and links to series.
 */
async function createNextRecurringEvent(prevEvent: any, prevEventId: string) {
  const prevDate = new Date(prevEvent.eventDate + "T00:00:00");
  const prevSpinTime = new Date(prevEvent.spinTime);
  
  const spinHour = prevSpinTime.getHours();
  const spinMinute = prevSpinTime.getMinutes();

  let nextDate: Date;
  let dayOffset = 0;

  switch (prevEvent.recurrencePattern) {
    case 'daily':
      dayOffset = 1;
      break;
    case 'weekly':
      dayOffset = 7;
      break;
    case 'biweekly':
      dayOffset = 14;
      break;
    case 'monthly':
      nextDate = new Date(prevDate);
      nextDate.setMonth(nextDate.getMonth() + 1);
      dayOffset = Math.round((nextDate.getTime() - prevDate.getTime()) / (24 * 60 * 60 * 1000));
      break;
    default:
      return;
  }

  nextDate = new Date(prevDate);
  nextDate.setDate(nextDate.getDate() + dayOffset);

  // Set the spin time for the next event
  const nextSpinTime = new Date(nextDate);
  nextSpinTime.setHours(spinHour, spinMinute, 0, 0);

  // Don't create if next date is in the past
  if (nextSpinTime.getTime() <= Date.now()) return;

  const nextEventDate = nextDate.toISOString().split("T")[0];

  // Calculate valid dates offset (same relative offset from event date)
  let nextValidFrom = nextEventDate;
  let nextValidTo = nextEventDate;
  if (prevEvent.validFrom && prevEvent.eventDate) {
    const prevEventDateMs = new Date(prevEvent.eventDate + "T00:00:00").getTime();
    const prevValidFromMs = new Date(prevEvent.validFrom + "T00:00:00").getTime();
    const prevValidToMs = prevEvent.validTo
      ? new Date(prevEvent.validTo + "T00:00:00").getTime()
      : prevValidFromMs;
    const fromOffset = Math.round((prevValidFromMs - prevEventDateMs) / (24 * 60 * 60 * 1000));
    const toOffset = Math.round((prevValidToMs - prevEventDateMs) / (24 * 60 * 60 * 1000));
    const nextFromDate = new Date(nextDate);
    nextFromDate.setDate(nextFromDate.getDate() + fromOffset);
    nextValidFrom = nextFromDate.toISOString().split("T")[0];
    const nextToDate = new Date(nextDate);
    nextToDate.setDate(nextToDate.getDate() + toOffset);
    nextValidTo = nextToDate.toISOString().split("T")[0];
  }

  const eventRef = adminDb.collection("ticketEvents").doc();
  await eventRef.set({
    merchantId: prevEvent.merchantId,
    merchantName: prevEvent.merchantName,
    totalSpots: prevEvent.totalSpots,
    spotsTaken: 0,
    spinTime: nextSpinTime.toISOString(),
    eventDate: nextEventDate,
    validFrom: nextValidFrom,
    validTo: nextValidTo,
    spotPriceCents: prevEvent.spotPriceCents,
    recurring: true,
    recurrencePattern: prevEvent.recurrencePattern,
    recurrenceDays: prevEvent.recurrenceDays || null,
    status: "active",
    seriesId: prevEvent.seriesId || prevEventId, // link to original series
    parentEventId: prevEventId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
