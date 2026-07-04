export const dynamic = "force-dynamic";
import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebaseAdmin";

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

      const event = { id: eventSnap.id, ...eventSnap.data() };

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
          // Only include completed events or events past their spin time
          if (evData.status === "completed" || new Date(evData.spinTime).getTime() <= Date.now()) {
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

    const events = allEventsSnap.docs.map((d) => ({
      id: d.id,
      ...d.data(),
    }));

    return NextResponse.json({ ok: true, events });
  } catch (e: any) {
    console.error("ticket-events/status error:", e);
    return NextResponse.json(
      { error: e?.message ?? "Internal error" },
      { status: 500 }
    );
  }
}
