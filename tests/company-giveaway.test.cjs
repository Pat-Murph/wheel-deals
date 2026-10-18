const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name]; }, console, process: { env: { NEXT_PUBLIC_APP_URL: 'https://example.test', STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture' } }, ...globals });
  return exports;
}
const policy = load('lib/companyGiveaway.ts');

test('free-only policy matches the exact verified company owner, never user-controlled name, email, flags or a customer UID', () => {
  assert.equal(policy.isCompanyGiveaway({ ownerUid: policy.WHEEL_DEALS_COMPANY_OWNER_UID }), true);
  for (const merchant of [null, undefined, {}, { ownerUid: 'other' }, { name: 'Wheel Deals', email: 'pat@wheeldealsapp.com', companyGiveawayOnly: true }, { uid: policy.WHEEL_DEALS_COMPANY_OWNER_UID }]) {
    assert.equal(policy.isCompanyGiveaway(merchant), false);
  }
});

function checkout(merchant, count = 0) {
  const calls = [];
  const mRef = { get: async () => ({ exists: !!merchant, data: () => merchant }), set: async (data) => calls.push(['write', data]) };
  const query = { where: () => query, get: async () => ({ size: count }) };
  const adminDb = { collection: (name) => name === 'merchants' ? { doc: () => mRef } : query };
  const stripe = {
    accounts: { retrieve: async (id) => { calls.push(['account', id]); return { capabilities: { transfers: 'active' }, charges_enabled: true, payouts_enabled: true }; } },
    checkout: { sessions: { create: async (args) => { calls.push(['checkout', args]); return { id: 'cs_fixture', url: 'https://checkout.example.test', client_secret: 'fixture_client_secret' }; } } },
  };
  const route = load('app/api/stripe/spin/route.ts', {
    'next/server': { NextResponse: { json: (body, options) => ({ body, status: options?.status ?? 200 }) } },
    '@/lib/stripeServer': { stripe }, '@/lib/firebaseAdmin': { adminDb }, '@/lib/companyGiveaway': policy,
    '@/lib/payments': { getTierByPrice: (priceCents) => ({ priceCents, label: 'Standard', platformFeeCents: 35 }), VALID_SPIN_PRICES: [135, 200, 300, 500], DEFAULT_TIER: { priceCents: 135 } },
  });
  const post = (extra = {}) => route.POST({ json: async () => ({ merchantId: 'fixture', uid: 'customer', spinPriceCents: 135, ...extra }), headers: { get: () => null } });
  return { post, calls };
}

test('company never creates Stripe checkout for any tier or mode, connected now or in the future; posted flags cannot override policy', async () => {
  for (const connected of [false, true]) for (const checkoutMode of ['hosted', 'embedded']) for (const spinPriceCents of [135, 200, 300, 500]) {
    const api = checkout({ ownerUid: policy.WHEEL_DEALS_COMPANY_OWNER_UID, stripeAccountId: connected ? 'acct_company' : undefined, stripeChargesEnabled: connected });
    const response = await api.post({ checkoutMode, spinPriceCents, companyGiveawayOnly: false, ownerUid: 'other', email: 'other@example.test' });
    assert.equal(response.status, 403);
    assert.equal(response.body.code, 'company_giveaway_free_only');
    assert.match(response.body.error, /always FREE.*More giveaways coming soon/);
    assert.equal(api.calls.length, 0);
  }
});

test('ordinary merchants retain hosted and embedded checkout, Stripe readiness and daily limits', async () => {
  for (const checkoutMode of ['hosted', 'embedded']) {
    const api = checkout({ ownerUid: 'ordinary-owner', stripeAccountId: 'acct_shop', stripeChargesEnabled: true, name: 'Wheel Deals', email: 'pat@wheeldealsapp.com' });
    const response = await api.post({ checkoutMode });
    assert.equal(response.status, 200);
    assert.equal(api.calls.filter(([kind]) => kind === 'checkout').length, 1);
    assert.equal(api.calls.find(([kind]) => kind === 'checkout')[1].line_items[0].price_data.unit_amount, 135);
    if (checkoutMode === 'embedded') assert.equal(response.body.clientSecret, 'fixture_client_secret');
    else assert.equal(response.body.url, 'https://checkout.example.test');
  }
  const notReady = checkout({ ownerUid: 'ordinary-owner' });
  assert.equal((await notReady.post()).status, 400); assert.equal(notReady.calls.length, 0);
  const limited = checkout({ ownerUid: 'ordinary-owner', stripeAccountId: 'acct_shop' }, 3);
  assert.equal((await limited.post()).status, 429); assert.equal(limited.calls.length, 0);
  assert.equal((await checkout(null).post()).status, 404);
});

test('merchant loading retains protected owner UID without changing ordinary merchant fields or using editable owner-email data', async () => {
  const docs = [
    { id: 'company', data: () => ({ active: true, ownerUid: policy.WHEEL_DEALS_COMPANY_OWNER_UID, name: 'Renamed company', about: 'Paragraph one\n\nParagraph two', boostActive: true, boostFreeSpinsRemaining: 497 }) },
    { id: 'ordinary', data: () => ({ active: true, ownerUid: 'other', name: 'Wheel Deals', email: 'pat@wheeldealsapp.com', stripeChargesEnabled: true }) },
  ];
  const merchants = load('lib/merchants.ts', {
    'firebase/firestore': { collection: () => ({}), query: () => ({}), where: () => ({}), getDocs: async () => ({ docs }) },
    './firebase': { getDb: () => ({}) },
  });
  const result = await merchants.getActiveMerchants();
  assert.equal(policy.isCompanyGiveaway(result[0]), true); assert.equal(policy.isCompanyGiveaway(result[1]), false);
  assert.equal(result[0].boostFreeSpinsRemaining, 497);
  assert.equal(result[0].about, 'Paragraph one\n\nParagraph two');
  assert.equal(result[1].stripeChargesEnabled, true);
});
