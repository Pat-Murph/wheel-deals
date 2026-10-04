const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const transpile = (filename) => ts.transpileModule(
  fs.readFileSync(path.join(root, filename), 'utf8'),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }
).outputText;

function storage(backing = new Map()) {
  return {
    getItem: (key) => backing.get(key) ?? null,
    setItem: (key, value) => backing.set(key, String(value)),
    removeItem: (key) => backing.delete(key),
    backing,
  };
}

function indexedDB(backing = new Map()) {
  return {
    open() {
      const request = {};
      const db = {
        objectStoreNames: { contains: () => true },
        createObjectStore: () => {},
        close: () => {},
        transaction() {
          const transaction = {
            objectStore: () => ({
              get(key) {
                const operation = { result: backing.get(key) };
                queueMicrotask(() => operation.onsuccess?.());
                return operation;
              },
              put(value, key) {
                backing.set(key, value);
                queueMicrotask(() => transaction.oncomplete?.());
              },
            }),
          };
          return transaction;
        },
      };
      queueMicrotask(() => { request.result = db; request.onsuccess?.(); });
      return request;
    },
    backing,
  };
}

function browserProfile(local = storage(), session = storage(), idb = indexedDB()) {
  const exports = {};
  const context = {
    exports, localStorage: local, sessionStorage: session, indexedDB: idb,
    crypto: crypto.webcrypto, setTimeout, clearTimeout, Uint8Array, Array,
  };
  vm.runInNewContext(transpile('lib/deviceFingerprint.ts'), context);
  return { api: exports, local, session, idb };
}

test('different iPhones with identical browser signals get distinct installation IDs', async () => {
  const phoneA = browserProfile();
  const phoneB = browserProfile();
  const [a, b] = await Promise.all([phoneA.api.getDeviceFingerprint(), phoneB.api.getDeviceFingerprint()]);
  assert.match(a, /^v2_[0-9a-f]{32}$/);
  assert.match(b, /^v2_[0-9a-f]{32}$/);
  assert.notEqual(a, b);
  assert.equal(a, await phoneA.api.getDeviceFingerprint());
});

test('the installation ID survives reload, local/session storage clearing, and ignores legacy collision IDs', async () => {
  const local = storage(new Map([['wd_device_fp', 'a'.repeat(32)]]));
  const session = storage();
  const idb = indexedDB(new Map([['device_fp', 'a'.repeat(32)]]));
  const id = await browserProfile(local, session, idb).api.getDeviceFingerprint();
  assert.notEqual(id, 'a'.repeat(32));
  assert.equal(id, await browserProfile(local, session, idb).api.getDeviceFingerprint());
  local.backing.clear();
  session.backing.clear();
  assert.equal(id, await browserProfile(local, session, idb).api.getDeviceFingerprint());
  assert.equal(local.getItem('wd_device_fp_v2'), id);
});

test('client-side cycle gate still resets only on a new merchant boost', async () => {
  const { api } = browserProfile();
  assert.equal(api.hasClaimedBoostLocally('shop', 'cycle-1'), false);
  api.markBoostClaimedLocally('shop', 'cycle-1');
  assert.equal(api.hasClaimedBoostLocally('shop', 'cycle-1'), true);
  assert.equal(api.hasClaimedBoostLocally('shop', 'cycle-2'), false);
});

function mockBoostServer() {
  const records = new Map([
    ['merchants/shop', { boostActive: true, boostFreeSpinsRemaining: 5, boostPurchasedAt: '2026-10-04T20:00:00.000Z' }],
  ]);
  function doc(key) {
    return {
      key,
      get: async () => ({ exists: records.has(key), data: () => records.get(key) }),
      collection: (name) => ({ doc: (id) => doc(`${key}/${name}/${id}`) }),
    };
  }
  const db = {
    collection(name) {
      return {
        doc: (id) => doc(`${name}/${id}`),
        where: () => ({ limit: () => ({ get: async () => ({ empty: true }) }) }),
      };
    },
    runTransaction: async (fn) => fn({
      get: async (ref) => ({ exists: records.has(ref.key), data: () => records.get(ref.key) }),
      set: (ref, value) => records.set(ref.key, value),
      update: (ref, value) => records.set(ref.key, { ...records.get(ref.key), ...value }),
      delete: (ref) => records.delete(ref.key),
    }),
  };
  const exports = {};
  const requires = (id) => {
    if (id === 'next/server') return { NextResponse: { json: (body, options = {}) => ({ body, status: options.status ?? 200 }) } };
    if (id === '@/lib/firebaseAdmin') return {
      adminDb: db,
      getAdminAuth: () => ({ verifyIdToken: async (token) => {
        if (!token.startsWith('valid-')) throw new Error('invalid token');
        return { uid: token.slice(6) };
      } }),
    };
    if (id === 'firebase-admin/firestore') return { FieldValue: { serverTimestamp: () => new Date() } };
    if (id === 'crypto') return crypto;
    throw new Error(`Unexpected dependency: ${id}`);
  };
  vm.runInNewContext(transpile('app/api/boost/consume/route.ts'), {
    exports, require: requires, Date, console, Uint8Array,
  });
  const post = (uid, fingerprint, token = `valid-${uid}`, extra = {}) => exports.POST({
    json: async () => ({ merchantId: 'shop', uid, deviceFingerprint: fingerprint, ...extra }),
    headers: new Headers(token ? { Authorization: `Bearer ${token}` } : {}),
  });
  return { post, records };
}

test('Boost requires the real Firebase customer, ignores legacy IDs, and keeps independent phones eligible', async () => {
  const server = mockBoostServer();
  const phoneA = 'v2_' + '1'.repeat(32);
  const phoneB = 'v2_' + '2'.repeat(32);
  assert.equal((await server.post('customerA', phoneA, '')).status, 401);
  assert.equal((await server.post('customerA', phoneA, 'invalid')).status, 401);
  assert.equal((await server.post('customerA', phoneA, 'valid-other')).status, 403);
  assert.equal((await server.post('customerA', 'a'.repeat(32))).status, 400);

  const a = await server.post('customerA', phoneA);
  assert.equal(a.status, 200);
  const repeatReservation = await server.post('customerA', phoneA);
  assert.equal(repeatReservation.body.sessionId, a.body.sessionId);
  const result = await server.post('customerA', phoneA, 'valid-customerA', {
    finalize: true, sessionId: a.body.sessionId, prizeLabel: '10% off',
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.type, 'free-boost');
  assert.equal((await server.post('customerA', phoneA)).status, 429);
  assert.equal((await server.post('customerA', phoneB)).status, 429); // UID rule survives ID changes
  assert.equal((await server.post('customerB', phoneA)).status, 429); // device rule survives UID changes
  assert.equal((await server.post('customerB', phoneB)).status, 200); // independent phone

  server.records.get('merchants/shop').boostPurchasedAt = '2026-10-05T20:00:00.000Z';
  assert.equal((await server.post('customerA', phoneA)).status, 429); // must also wait 24h
  server.records.get('merchants/shop/boostUserUsage/customerA').usedAt = new Date(Date.now() - 25 * 3600_000);
  server.records.get(`merchants/shop/boostDeviceUsage/${phoneA}`).usedAt = new Date(Date.now() - 25 * 3600_000);
  assert.equal((await server.post('customerA', phoneA)).status, 200);
});
