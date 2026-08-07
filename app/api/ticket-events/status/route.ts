export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";
import { FieldValue } from "firebase-admin/firestore";

/**
 * GET /api/ticket-events/status?merchantId=...
 * Returns active ticket events for a merchant.
 * Used by discover page and wheel page to show countdown + spots.
 * 
 * GET /api/ticket-events/status?eventId=...
 * Returns a specific event's status.
 * 
 * GET /api/ticket-events/status?eventId=...&uid=...
 * Also returns user's entry count for the event.
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const merchantId = url.searchParams.get("merchantId");
    const eventId = url.searchParams.get("eventId");
    const uid = url.searchParams.get("uid");

    if (eventId) {
      // Get specific event
      const eventSnap = await adminDb.collection("ticketEvents").doc(eventId).get();
      if (!eventSnap.exists) {
        return NextResponse.json({ error: "Event not found" }, { status: 404 });
      }

      const eventData = eventSnap.data() as any;

      // Auto-complete expired events that are still "active" (e.g., 0 entries so spin was never triggered)
      if (eventData.status === "active" && eventData.spinTime) {
        const spinTimeMs = new Date(eventData.spinTime).getTime();
        // Give 2 minutes grace period after spin time
        if (Date.now() > spinTimeMs + 2 * 60 * 1000) {
          await autoCompleteExpiredEvent(eventSnap.id, eventData);
          // Re-read after auto-complete
          const refreshed = await adminDb.collection("ticketEvents").doc(eventId).get();
          const event = { id: refreshed.id, ...refreshed.data() };
          let userSpots = 0;
          if (uid) {
            const entriesSnap = await adminDb
              .collection("ticketEvents")
              .doc(eventId)
              .collection("entries")
              .where("uid", "==", uid)
              .get();
            userSpots = entriesSnap.docs.reduce(
              (sum, d) => sum + (d.data().spotCount || 1), 0
            );
          }
          return NextResponse.json({ ok: true, event, userSpots });
        }
      }

      const event = { id: eventSnap.id, ...eventData };

      // Get user's entries if uid provided
      let userSpots = 0;
      if (uid) {
        const entriesSnap = await adminDb
          .collection("ticketEvents")
          .doc(eventId)
          .collection("entries")
          .where("uid", "==", uid)
          .get();
        userSpots = entriesSnap.docs.reduce(
          (sum, d) => sum + (d.data().spotCount || 1), 0
        );
      }

      return NextResponse.json({ ok: true, event, userSpots });
    }

    if (merchantId) {
      // Get all active events for this merchant
      const eventsSnap = await adminDb
        .collection("ticketEvents")
        .where("merchantId", "==", merchantId)
        .where("status", "==", "active")
        .get();

      const events = eventsSnap.docs.map((d) => ({
        id: d.id,
        ...d.data(),
      }));

      return NextResponse.json({ ok: true, events });
    }

    // If uid + mode=my-events, return all events (active or completed) where user has entries
    const mode = url.searchParams.get("mode");
    if (uid && mode === "my-events") {
      // Find all entries for this user across all events
      const entriesSnap = await adminDb
        .collectionGroup("entries")
        .where("uid", "==", uid)
        .get();

      if (entriesSnap.empty) {
        return NextResponse.json({ ok: true, events: [] });
      }

      // Get unique event IDs from entries
      const eventIds = [...new Set(entriesSnap.docs.map(d => d.ref.parent.parent?.id).filter(Boolean))] as string[];

      // Fetch those events
      const myEvents = [];
      for (const eid of eventIds) {
        const evSnap = await adminDb.collection("ticketEvents").doc(eid).get();
        if (evSnap.exists) {
          const evData = evSnap.data() as any;
          // Include all events where user has entries (active, completed, or past spin time)
          if (evData.status === "completed" || evData.status === "active" || new Date(evData.spinTime).getTime() <= Date.now()) {
            // Get user's spot count
            const userEntries = entriesSnap.docs.filter(d => d.ref.parent.parent?.id === eid);
            const userSpots = userEntries.reduce((sum, d) => sum + (d.data().spotCount || 1), 0);
            // Results are stored on the event doc, filtered by uid
            const allResults = evData.results || [];
            const userResults = allResults.filter((r: any) => r.uid === uid);
            myEvents.push({
              id: evSnap.id,
              ...evData,
              userSpots,
              results: userResults,
            });
          }
        }
      }

      return NextResponse.json({ ok: true, events: myEvents });
    }

    // Get ALL active events (for discover page)
    const allEventsSnap = await adminDb
      .collection("ticketEvents")
      .where("status", "==", "active")
      .get();

    // Auto-complete any expired active events (spin time passed, no one triggered spin)
    const now = Date.now();
    const expiredEvents = allEventsSnap.docs.filter((d) => {
      const data = d.data() as any;
      if (!data.spinTime) return false;
      const spinTimeMs = new Date(data.spinTime).getTime();
      return now > spinTimeMs + 2 * 60 * 1000; // 2 min grace
    });
    for (const expDoc of expiredEvents) {
      await autoCompleteExpiredEvent(expDoc.id, expDoc.data() as any);
    }

    // Re-fetch active events after auto-completing expired ones
    const freshEventsSnap = expiredEvents.length > 0
      ? await adminDb.collection("ticketEvents").where("status", "==", "active").get()
      : allEventsSnap;

    // Also get recently completed events (within 7 days) so customers can still access their deal
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const completedEventsSnap = await adminDb
      .collection("ticketEvents")
      .where("status", "==", "completed")
      .get();

    const recentlyCompleted = completedEventsSnap.docs
      .filter((d) => {
        const data = d.data() as any;
        const completedAt = data.completedAt?.toDate?.() ?? new Date(data.completedAt ?? 0);
        return completedAt >= sevenDaysAgo;
      })
      .map((d) => ({ id: d.id, ...d.data() }));

    const events = freshEventsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    return NextResponse.json({ ok: true, events, recentlyCompleted });
  } catch (e: any) {
    console.error("ticket-events/status error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}

/**
 * Auto-completes an expired event that was never triggered (e.g., 0 entries).
 * If the event is recurring, creates the next instance.
 */
async function autoCompleteExpiredEvent(eventId: string, eventData: any) {
  const eventRef = adminDb.collection("ticketEvents").doc(eventId);

  // Double-check it's still active (avoid race conditions)
  const snap = await eventRef.get();
  const current = snap.data() as any;
  if (!current || current.status !== "active") return;

  // Get any entries that exist
  const entriesSnap = await adminDb
    .collection("ticketEvents")
    .doc(eventId)
    .collection("entries")
    .where("status", "==", "confirmed")
    .get();

  if (entriesSnap.empty) {
    // No entries — just mark as completed with no results
    await eventRef.update({
      status: "completed",
      completedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      sharedPrize: null,
      results: [],
      autoCompleted: true, // flag that it was auto-completed (no participants)
    });
  } else {
    // Has entries but spin was never triggered — trigger it now via internal call
    // This handles the case where entries exist but the client never called spin
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
        ? `https://${process.env.VERCEL_URL}`
        : "http://localhost:3000";
      await fetch(`${baseUrl}/api/ticket-events/spin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ eventId }),
      });
    } catch (err) {
      console.error("Auto-spin failed for event", eventId, err);
      // Fallback: just mark completed
      await eventRef.update({
        status: "completed",
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        autoCompleted: true,
      });
    }
  }

  // If recurring, create next event (only for 0-entry case; spin route handles its own recurring)
  if (entriesSnap.empty && eventData.recurring && eventData.recurrencePattern) {
    await createNextRecurringEvent(eventData, eventId);
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

  // Check if a next event already exists for this series + date (avoid duplicates)
  const seriesId = prevEvent.seriesId || prevEventId;
  const existingNext = await adminDb
    .collection("ticketEvents")
    .where("seriesId", "==", seriesId)
    .where("eventDate", "==", nextEventDate)
    .limit(1)
    .get();
  if (!existingNext.empty) return; // Already created

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
    seriesId: seriesId,
    parentEventId: prevEventId,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}
