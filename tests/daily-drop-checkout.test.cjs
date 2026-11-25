const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

// ---- Minimal in-memory Firestore ----
function makeDb() {
  const docs = new Map();
  const inc = (n) => ({ __inc: n });
  function apply(prev, data, merge) {
    const out = merge || prev ? { ...(prev || {}) } : {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && '__inc' in v) out[k] = (Number(out[k]) || 0) + v.__inc;
      else if (v && typeof v === 'object' && v.__ts) out[k] = { toDate: () => new Date() };
      else out[k] = v;
    }
    return out;
  }
  function docRef(p) {
    return {
      path: p,
      id: p.split('/').pop(),
      collection: (name) => collection(`${p}/${name}`),
      get: async () => snap(p),
      set: async (data, opts) => { docs.set(p, apply(opts?.merge ? docs.get(p) : null, data, opts?.merge)); },
      update: async (data) => { if (!docs.has(p)) throw new Error('missing ' + p); docs.set(p, apply(docs.get(p), data, true)); },
    };
  }
  function snap(p) {
    const d = docs.get(p);
    return { exists: d !== undefined, id: p.split('/').pop(), data: () => (d ? { ...d } : undefined), ref: docRef(p) };
  }
  function collection(cp, filters = [], lim = Infinity) {
    const q = {
      doc: (id) => docRef(`${cp}/${id ?? Math.random().toString(36).slice(2)}`),
      where: (f, _op, v) => collection(cp, [...filters, [f, v]], lim),
      limit: (n) => collection(cp, filters, n),
      get: async () => {
        const hits = [...docs.keys()]
          .filter((k) => k.startsWith(cp + '/') && !k.slice(cp.length + 1).includes('/'))
          .filter((k) => filters.every(([f, v]) => docs.get(k)[f] === v))
          .slice(0, lim)
          .map(snap);
        return { empty: hits.length === 0, size: hits.length, docs: hits };
      },
    };
    return q;
  }
  const adminDb = {
    collection: (name) => collection(name),
    runTransaction: async (fn) => {
      const writes = [];
      const tx = {
        get: async (ref) => ref.get(),
        set: (ref, data, opts) => writes.push(() => ref.set(data, opts)),
        update: (ref, data) => writes.push(() => ref.update(data)),
      };
      const result = await fn(tx);
      for (const w of writes) await w();
      return result;
    },
  };
  return { docs, adminDb, FieldValue: { increment: inc, serverTimestamp: () => ({ __ts: true }) } };
}

function loadCheckout(db, stripe) {
  const exports = {};
  const code = ts.transpileModule(read('lib/ticketEventCheckout.ts'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const mocks = {
    '@/lib/firebaseAdmin': { adminDb: db.adminDb },
    'firebase-admin/firestore': { FieldValue: db.FieldValue },
    '@/lib/stripeServer': { stripe },
  };
  vm.runInNewContext(code, { exports, require: (n) => { assert.ok(n in mocks, n); return mocks[n]; }, console, Date, Promise });
  return exports;
}

function fixture({ paid = true, amount = 1000, spinInMs = 3600_000, status = 'active', reservation = 'pending' } = {}) {
  const db = makeDb();
  db.docs.set('ticketEvents/ev1', {
    merchantId: 'm1', status, spinTime: new Date(Date.now() + spinInMs).toISOString(),
    spotPriceCents: 500, totalSpots: 20, spotsTaken: 2,
  });
  if (reservation) db.docs.set('ticketEventReservations/cs_test_1', { eventId: 'ev1', merchantId: 'm1', uid: 'u1', spots: 2, status: reservation });
  const calls = [];
  const stripe = {
    checkout: { sessions: { retrieve: async (id) => ({
      id, payment_status: paid ? 'paid' : 'unpaid', status: paid ? 'complete' : 'open', amount_total: amount,
      payment_intent: 'pi_1',
      metadata: { type: 'ticket_event_entry', eventId: 'ev1', merchantId: 'm1', uid: 'u1', spotCount: '2' },
    }) } },
    refunds: { create: async (args, opts) => { calls.push(['refund', args, opts]); return { id: 're_1' }; } },
  };
  return { db, stripe, calls, lib: loadCheckout(db, stripe) };
}

test('paid in-app Daily Drop checkout creates exactly one entry, even if verified repeatedly', async () => {
  const { db, lib } = fixture();
  const first = await lib.confirmTicketEventSession('cs_test_1');
  const second = await lib.confirmTicketEventSession('cs_test_1');
  assert.equal(first.ok, true);
  assert.equal(first.alreadyConfirmed, false);
  assert.equal(second.alreadyConfirmed, true);
  const entries = [...db.docs.keys()].filter((k) => k.startsWith('ticketEvents/ev1/entries/'));
  assert.deepEqual(entries, ['ticketEvents/ev1/entries/cs_test_1']);
  assert.equal(db.docs.get('ticketEvents/ev1').spotsTaken, 2, 'reserved spots are not double counted');
  assert.equal(db.docs.get('ticketEventReservations/cs_test_1').status, 'confirmed');
});

test('unpaid sessions never create entries and wrong amounts are rejected', async () => {
  const unpaid = fixture({ paid: false });
  assert.equal((await unpaid.lib.confirmTicketEventSession('cs_test_1')).status, 402);
  const wrong = fixture({ amount: 1 });
  assert.equal((await wrong.lib.confirmTicketEventSession('cs_test_1')).ok, false);
  for (const f of [unpaid, wrong]) {
    assert.equal([...f.db.docs.keys()].some((k) => k.includes('/entries/')), false);
  }
  assert.equal((await unpaid.lib.confirmTicketEventSession('not-a-session')).status, 400);
});

test('closing checkout releases reserved spots exactly once', async () => {
  const { db, lib } = fixture({ paid: false });
  assert.equal(await lib.releaseTicketEventReservation('cs_test_1', 'checkout_closed'), true);
  assert.equal(await lib.releaseTicketEventReservation('cs_test_1', 'checkout_closed'), false);
  assert.equal(db.docs.get('ticketEvents/ev1').spotsTaken, 0);
});

test('payment finishing after the drop closes is refunded and its spots released', async () => {
  const { db, lib, calls } = fixture({ spinInMs: -1000 });
  const result = await lib.confirmTicketEventSession('cs_test_1');
  assert.equal(result.ok, false);
  assert.equal(result.refunded, true);
  assert.equal(calls[0][1].reverse_transfer, true);
  assert.equal(calls[0][1].refund_application_fee, true);
  assert.match(calls[0][2].idempotencyKey, /cs_test_1/);
  assert.equal(db.docs.get('ticketEvents/ev1').spotsTaken, 0);
});

test('at drop time, paid checkouts the app never confirmed are still included', async () => {
  const { db, lib } = fixture({ spinInMs: -1000, status: 'spinning' });
  assert.equal(await lib.reconcilePendingTicketEventReservations('ev1'), 1);
  assert.ok(db.docs.has('ticketEvents/ev1/entries/cs_test_1'));
});

test('public Daily Drop data never exposes other customers redemption codes', () => {
  const { lib } = fixture();
  const event = { id: 'ev1', results: [{ uid: 'u1', code: 'MINE' }, { uid: 'u2', code: 'THEIRS' }] };
  assert.deepEqual(lib.publicTicketEvent(event, 'u1').results.map((r) => r.code), ['MINE']);
  assert.equal(lib.publicTicketEvent(event, null).results.length, 0);
  const spin = read('app/api/ticket-events/spin/route.ts');
  assert.equal(/:\s*(existingData\.results|refetchData\.results|results);/.test(spin), false);
});

test('Daily Drop uses the same in-app embedded Checkout as paid unlocks', () => {
  const enter = read('app/api/ticket-events/enter/route.ts');
  assert.match(enter, /ui_mode: "embedded"/);
  assert.match(enter, /redirect_on_completion: "never"/);
  assert.match(enter, /recordTicketEventReservation/);
  assert.doesNotMatch(enter, /&uid=\$\{uid\}&spots=/, 'success URL no longer trusts uid/spots from the query string');
  const client = read('components/WheelDealsClient.tsx');
  assert.match(client, /checkoutMode: preferEmbeddedCheckout \? 'embedded' : 'hosted'/);
  assert.match(client, /<EmbeddedCheckoutModal[\s\S]*onComplete=\{completeTicketCheckout\}/);
});

test('Daily Drop deals use the secure Download Deal QR instead of Copy Code', () => {
  const client = read('components/WheelDealsClient.tsx');
  assert.doesNotMatch(client, /Copy Code/);
  assert.doesNotMatch(client, /api\.qrserver\.com/);
  assert.match(client, /downloadTicketDealQr\(r\)/);
  assert.match(client, /async function downloadDealQr\(/);
  assert.match(client, /fetch\("\/api\/share\/beast", \{\s*method: "POST"/);
});

test('Discover places Daily Drops by distance instead of pinning them to the top', () => {
  const discover = read('app/discover/page.tsx');
  assert.doesNotMatch(discover, /TICKET EVENT CARDS/);
  assert.match(discover, /sortedItems\.map\(\(m\) => \{[\s\S]{0,400}renderDailyDropCard\(dailyDrop, m\)/);
  assert.match(discover, /function renderDailyDropCard[\s\S]*fmtMiles\(m\.distanceMiles\)\} away/);
});
