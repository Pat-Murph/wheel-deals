const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function server() {
  const records = new Map([
    ['merchants/company', { ownerUid: 'company-uid', foundingNumber: 8, isMobile: true }],
    ['merchants/shop', { ownerUid: 'shop-owner', foundingNumber: 25 }],
    ['merchants/paid', { ownerUid: 'paid-owner', foundingNumber: 301 }],
    ['spins/issued', { merchantId: 'company', status: 'issued', code: 'KEEP-ME' }],
  ]);
  const users = {
    company: { uid: 'company-uid', email: 'pat@wheeldealsapp.com' },
    shop: { uid: 'shop-owner', email: 'other@example.com' },
    paid: { uid: 'paid-owner', email: 'paid@example.com' },
    // A supplied email/token field cannot grant the canonical UID's privileges.
    spoof: { uid: 'shop-owner', email: 'pat@wheeldealsapp.com' },
  };
  const account = { uid: 'company-uid', disabled: false };
  const snapshot = (key) => ({ exists: records.has(key), data: () => records.get(key) });
  const doc = (key) => ({ key, get: async () => snapshot(key) });
  const adminDb = {
    collection: (name) => ({ doc: (id) => doc(`${name}/${id}`) }),
    runTransaction: async (fn) => fn({
      get: async (ref) => snapshot(ref.key),
      update: (ref, value) => records.set(ref.key, { ...records.get(ref.key), ...value }),
      set: (ref, value) => records.set(ref.key, value),
    }),
  };
  const sessions = {
    payment1: { id: 'payment1', created: 1700000000, payment_status: 'paid', metadata: { type: 'boost', merchantId: 'paid', uid: 'paid-owner', boostWheelPriceCents: '135', boostMode: 'checkin' } },
    payment2: { id: 'payment2', created: Math.floor(Date.now() / 1000), payment_status: 'paid', metadata: { type: 'boost', merchantId: 'paid', uid: 'paid-owner' } },
    companyLegacy: { id: 'companyLegacy', created: 1700000000, payment_status: 'paid', metadata: { type: 'boost', merchantId: 'company', uid: 'company-uid' } },
    unpaid: { id: 'unpaid', payment_status: 'unpaid', metadata: { type: 'boost', merchantId: 'paid', uid: 'paid-owner' } },
  };
  const checkoutCalls = [];
  const modules = {};
  const load = (filename) => {
    if (modules[filename]) return modules[filename];
    const exports = {};
    modules[filename] = exports;
    const requireMock = (name) => {
      if (name === 'next/server') return { NextResponse: {
        json: (body, options = {}) => ({ body, status: options.status ?? 200 }),
        redirect: (url) => ({ status: 307, url }),
      } };
      if (name === '@/lib/firebaseAdmin') return {
        adminDb,
        getAdminAuth: () => ({
          verifyIdToken: async (token, revocationCheck) => {
            assert.equal(revocationCheck, true);
            if (!users[token]) throw new Error('invalid token');
            return users[token];
          },
          getUserByEmail: async (email) => { assert.equal(email, 'pat@wheeldealsapp.com'); return account; },
        }),
      };
      if (name === '@/lib/boostAdmin') return load('lib/boostAdmin.ts');
      if (name === '@/lib/stripeServer') return { stripe: { checkout: { sessions: {
        retrieve: async (id) => sessions[id],
        create: async (options) => { checkoutCalls.push(options); return { url: 'https://checkout.stripe.com/test' }; },
      } } } };
      throw new Error(`Unknown module ${name}`);
    };
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', filename), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: requireMock, Date, Number, Error, console, URL, process: { env: { NEXT_PUBLIC_APP_URL: 'https://example.test' } } });
    return exports;
  };
  const request = (body, token = 'company', url = 'https://example.test/api/boost/activate-free') => ({
    json: async () => body, url, headers: new Headers(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  const activate = (merchantId, count, token = 'company', extra = {}) => load('app/api/boost/activate-free/route.ts').POST(request({ merchantId, boostUnlockCount: count, boostMode: 'always', boostWheelPriceCents: 135, ...extra }, token));
  const end = (merchantId, token = 'company') => load('app/api/boost/end/route.ts').POST(request({ merchantId }, token));
  const capability = (merchantId, token) => load('app/api/boost/activate-free/route.ts').GET(request({}, token, `https://example.test/api/boost/activate-free?merchantId=${merchantId}`));
  const verify = (id, merchantId = 'paid') => load('app/api/stripe/boost/verify/route.ts').GET(request({}, '', `https://example.test/api/stripe/boost/verify?session_id=${id}&merchantId=${merchantId}`));
  return { records, activate, end, capability, verify, account, load, request, checkoutCalls };
}

test('canonical company UID gets 500 or another arbitrary positive whole quantity with existing 25-mile mode', async () => {
  const api = server();
  assert.equal((await api.capability('company', 'company')).body.customQuantityAllowed, true);
  const first = await api.activate('company', 500);
  assert.equal(first.status, 200);
  assert.equal(first.body.boostFreeSpinsRemaining, 500);
  assert.equal(first.body.boostUnlocksGranted, 500);
  assert.equal(first.body.boostMode, 'always');
  assert.equal((await api.activate('company', 1234)).status, 409); // cannot overwrite active allocation
  await api.end('company');
  assert.equal((await api.activate('company', 1234)).body.boostFreeSpinsRemaining, 1234);
});

test('ordinary merchants stay at ten and cannot spoof the company privilege or another owner', async () => {
  const api = server();
  assert.equal((await api.capability('shop', 'shop')).body.customQuantityAllowed, false);
  assert.equal((await api.capability('company', 'shop')).status, 403);
  assert.equal((await api.activate('shop', 500, 'spoof', { email: 'pat@wheeldealsapp.com', uid: 'company-uid' })).status, 403);
  assert.equal((await api.activate('company', 10, 'shop')).status, 403);
  assert.equal((await api.activate('shop', undefined, 'shop')).body.boostFreeSpinsRemaining, 10);
  assert.equal(api.records.get('merchants/shop').boostMode, 'checkin');
  assert.equal((await api.activate('paid', 10, 'paid')).status, 403);
});

test('invalid quantities, missing/invalid auth, and disabled company account cannot grant a custom allocation', async () => {
  const api = server();
  for (const count of [0, -1, 1.2, '500', null, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal((await api.activate('company', count)).status, 400);
  }
  assert.equal((await api.activate('company', 500, '')).status, 401);
  assert.equal((await api.activate('company', 500, 'invalid')).status, 401);
  assert.equal((await api.activate('missing', 500)).status, 404);
  api.account.disabled = true;
  assert.equal((await api.activate('company', 500)).status, 403);
});

test('any owner can end their own Boost, but not someone else’s; existing codes and remaining count are retained', async () => {
  const api = server();
  await api.activate('company', 500);
  await api.activate('shop', 10, 'shop');
  assert.equal((await api.end('company', 'shop')).status, 403);
  assert.equal((await api.end('shop', '')).status, 401);
  assert.equal((await api.end('shop', 'shop')).status, 200);
  assert.equal(api.records.get('merchants/shop').boostActive, false);
  assert.equal(api.records.get('merchants/shop').boostFreeSpinsRemaining, 10);
  assert.equal((await api.end('shop', 'shop')).body.ended, false);
  assert.equal((await api.end('company')).status, 200);
  assert.equal(api.records.get('spins/issued').code, 'KEEP-ME');
  assert.equal(api.records.get('spins/issued').status, 'issued');
});

test('revisiting a paid Boost confirmation never reactivates an ended Boost or refills it', async () => {
  const api = server();
  assert.match((await api.verify('payment1', 'shop')).url, /invalid_boost_session/);
  assert.match((await api.verify('unpaid')).url, /not_paid/);
  await api.verify('payment1');
  assert.equal(api.records.get('merchants/paid').boostFreeSpinsRemaining, 10);
  await api.end('paid', 'paid');
  await api.verify('payment1');
  assert.equal(api.records.get('merchants/paid').boostActive, false);
  assert.equal(api.records.get('merchants/paid').boostFreeSpinsRemaining, 10);
});

test('a pre-update paid confirmation cannot override a newer manual End action', async () => {
  const api = server();
  Object.assign(api.records.get('merchants/paid'), { boostActive: false, boostEndedAt: new Date().toISOString() });
  assert.match((await api.verify('payment1')).url, /boost_notice=ended_campaign/);
  assert.equal(api.records.get('merchants/paid').boostActive, false);
  assert.equal(api.records.get('boostPayments/payment1').skippedAfterEnd, true);
});

test('old company payment after End and free reactivation cannot overwrite the new 500-unlock campaign', async () => {
  const api = server();
  await api.activate('company', 10);
  await api.end('company');
  const endedAt = api.records.get('merchants/company').boostEndedAt;
  await api.activate('company', 500);
  assert.equal(api.records.get('merchants/company').boostEndedAt, endedAt);
  assert.match((await api.verify('companyLegacy', 'company')).url, /boost_notice=ended_campaign/);
  assert.equal(api.records.get('merchants/company').boostFreeSpinsRemaining, 500);
  assert.equal(api.records.get('merchants/company').boostMode, 'always');
});

test('a distinct paid confirmation cannot refill or replace an active paid Boost', async () => {
  const api = server();
  await api.verify('payment1');
  api.records.get('merchants/paid').boostFreeSpinsRemaining = 7;
  assert.match((await api.verify('payment2')).url, /boost_notice=already_active/);
  assert.equal(api.records.get('merchants/paid').boostFreeSpinsRemaining, 7);
  assert.equal(api.records.get('merchants/paid').boostPaidSessionId, 'payment1');
});

test('paid checkout also requires real ownership and grants only the fixed ordinary allocation', async () => {
  const api = server();
  const checkout = api.load('app/api/stripe/boost/route.ts');
  assert.equal((await checkout.POST(api.request({ merchantId: 'paid' }, ''))).status, 401);
  assert.equal((await checkout.POST(api.request({ merchantId: 'paid', uid: 'paid-owner' }, 'shop'))).status, 403);
  const result = await checkout.POST(api.request({ merchantId: 'paid', boostUnlockCount: 500 }, 'paid'));
  assert.equal(result.status, 200);
  assert.equal(api.checkoutCalls[0].metadata.uid, 'paid-owner');
  assert.match(api.checkoutCalls[0].line_items[0].price_data.product_data.name, /10 Free Deals/);
});
