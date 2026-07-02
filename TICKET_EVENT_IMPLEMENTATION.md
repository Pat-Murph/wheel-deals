# Ticket Event Feature Implementation Notes

## Files Created/Modified

### New API Endpoints
- `/app/api/ticket-events/create/route.ts` — Merchant creates event
- `/app/api/ticket-events/enter/route.ts` — Customer buys spots (Stripe Checkout)
- `/app/api/ticket-events/verify/route.ts` — After Stripe payment, creates entry record
- `/app/api/ticket-events/spin/route.ts` — Resolves all entries at spin time
- `/app/api/ticket-events/status/route.ts` — Get event status (for discover + wheel pages)
- `/app/api/ticket-events/manage/route.ts` — Merchant pause/resume/cancel

### New Shared Types
- `/lib/ticketEvents.ts` — TicketEvent, TicketEventEntry, TicketEventResult types + helpers

### Modified Files
- `/app/merchant/page.tsx` — Added TicketEventSection component (only shows for "tickets and events" category)
- `/app/discover/page.tsx` — Added ticket event cards with countdown + spots remaining
- `/app/wheel/page.tsx` — Now passes `initialEventId` prop
- `/components/WheelDealsClient.tsx` — NEEDS: ticket event entry UI (buy spots, countdown, status)

## Remaining Work (Phase 5-7)
1. **WheelDealsClient.tsx** — Add ticket event mode:
   - Accept `initialEventId` prop
   - Show event status (spots left, countdown, user's spots)
   - "Buy Spots" button (1-4 selector)
   - After spin time: show results
   - Before spin time: show countdown, no wheel spinning allowed
   
2. **Auto-spin trigger** — When countdown reaches 0:
   - Client calls `/api/ticket-events/spin`
   - Show results to user
   - Event auto-pauses

3. **Firestore Rules** — Need to add rules for `ticketEvents` collection:
   - Public read (for discover page countdown)
   - Merchant write (create/update via API with admin SDK, so rules not needed for server-side)
   - Actually all writes go through Admin SDK, so only read rules needed

4. **Deploy** — Build, commit, push, deploy via Vercel CLI

## Key Architecture Decisions
- Ticket events use their own Firestore collection `ticketEvents` (not subcollection of merchants)
- Entries stored as subcollection: `ticketEvents/{eventId}/entries/{entryId}`
- Spin results create standard `spins` documents (compatible with existing redeem flow)
- Payment goes through merchant's Stripe Connect account (same as regular spins)
- Platform fee: 30% (same as regular spins)
- Recurring events: after spin completes, auto-creates next instance
- Max 4 spots per user per event
- Event auto-pauses after spin time passes
