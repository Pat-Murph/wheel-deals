const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { execFileSync } = require('node:child_process');
const source = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
function load(file, globals = {}, mocks = {}) {
  const exports = {};
  const code = ts.transpileModule(source(file), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), console, ...globals });
  return exports;
}
function preloader() {
  const created = [], timers = [];
  class FakeImage {
    constructor() { this.complete = false; this.naturalWidth = 0; created.push(this); }
    decode() { this.decoded = true; return this.decodePromise ?? Promise.resolve(); }
    load() { this.complete = true; this.naturalWidth = 768; this.onload?.(); }
    fail() { this.onerror?.(); }
  }
  const globals = { window: {}, Image: FakeImage, setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimeout: (t) => { t.cleared = true; } };
  return { ...load('lib/beastImagePreload.ts', globals), created, timers, globals };
}

test('no collection downloads on import; only selected image starts immediately and concurrent requests deduplicate', async () => {
  const p = preloader();
  assert.equal(p.created.length, 0);
  const one = p.preloadBeastImage('/animals/magma-drake-chains.webp');
  const two = p.preloadBeastImage('/animals/magma-drake-chains.webp');
  assert.equal(one, two);
  assert.equal(p.created.length, 1);
  assert.equal(p.created[0].src, '/animals/magma-drake-chains.webp');
  assert.equal(p.created[0].fetchPriority, 'high');
  assert.equal(p.created[0].decoding, 'async');
  assert.equal(p.isBeastImageReady(p.created[0].src), false);
  p.created[0].load();
  assert.equal(await one, true);
  assert.equal(p.isBeastImageReady(p.created[0].src), true);
  assert.equal(p.created[0].decoded, true);
  assert.equal(await p.preloadBeastImage(p.created[0].src), true);
  assert.equal(p.created.length, 1);
});

test('readiness waits for decode, with compatibility fallback for old WebViews', async () => {
  const p = preloader();
  let finish;
  const promise = p.preloadBeastImage('/one.webp');
  p.created[0].decodePromise = new Promise((resolve) => { finish = resolve; });
  p.created[0].load();
  assert.equal(p.isBeastImageReady('/one.webp'), false);
  finish(); assert.equal(await promise, true);
  const other = p.preloadBeastImage('/two.webp');
  p.created[1].decodePromise = Promise.reject(new Error('WebView decode unsupported'));
  p.created[1].load(); assert.equal(await other, true);
  assert.equal(p.isBeastImageReady('/two.webp'), true);
});

test('failed requests and timeouts never block unlocks and can be retried', async () => {
  const p = preloader();
  const failed = p.preloadBeastImage('/fail.webp'); p.created[0].fail();
  assert.equal(await failed, false);
  const retry = p.preloadBeastImage('/fail.webp'); p.created[1].load();
  assert.equal(await retry, true);
  const stalled = p.preloadBeastImage('/stalled.webp');
  const timeout = p.timers.at(-1); assert.equal(timeout.ms, 10000); timeout.fn();
  assert.equal(await stalled, false);
  const retried = p.preloadBeastImage('/stalled.webp'); p.created.at(-1).load();
  assert.equal(await retried, true);
});

test('recent cache is bounded to six images and server rendering creates no Image objects', async () => {
  const p = preloader();
  for (let i = 0; i < 7; i++) { const promise = p.preloadBeastImage(`/${i}.webp`); p.created.at(-1).load(); await promise; }
  assert.equal(p.isBeastImageReady('/0.webp'), false);
  assert.equal(p.isBeastImageReady('/6.webp'), true);
  const ssr = load('lib/beastImagePreload.ts', { setTimeout, clearTimeout });
  assert.equal(await ssr.preloadBeastImage('/one.webp'), false);
});

function clientHandlers(event = false) {
  const ast = ts.createSourceFile('client.tsx', source('components/WheelDealsClient.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const callbacks = {};
  function visit(node) {
    if (ts.isJsxAttribute(node) && ['onSpinStart', 'onSpinLand'].includes(node.name.text)) callbacks[node.name.text] = node.initializer.expression.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  const selections = [], downloads = [], state = {}, preparedBeastRef = { current: null };
  const globals = {
    initialEventId: event ? 'daily-drop' : undefined,
    selectedMerchant: { id: 'merchant-a' },
    wheelItems: [{ label: 'Candy', weight: 40 }, { label: 'BOGO', weight: 60 }],
    preparedBeastRef,
    getRandomBeast: (weight) => { const result = { beast: { id: `beast-${selections.length}`, imagePath: `/beast-${selections.length}.webp` }, tier: { weight } }; selections.push(result); return result; },
    preloadBeastImage: (path) => { downloads.push(path); return Promise.resolve(true); },
    setCelebrationLabel: (v) => { state.label = v; }, setCelebrationWeightPct: (v) => { state.weight = v; },
    setLastBeast: (v) => { state.beast = v; }, setCelebrationVisible: (v) => { state.visible = v; },
  };
  const exports = {};
  vm.runInNewContext(`exports.start = ${callbacks.onSpinStart}; exports.land = ${callbacks.onSpinLand};`, { exports, ...globals });
  return { ...exports, ...globals, state, selections, downloads };
}

test('one beast is chosen during animation and the same beast is used for both reveal and share state', () => {
  const c = clientHandlers();
  c.start('Candy');
  assert.equal(c.selections.length, 1);
  assert.equal(c.downloads[0], '/beast-0.webp');
  assert.equal(c.state.visible, undefined); // no premature reveal
  c.land('Candy');
  assert.equal(c.selections.length, 1); // no re-roll at landing
  assert.equal(c.state.beast, c.selections[0]);
  assert.equal(c.state.weight, 40);
  assert.equal(c.state.visible, true);
  assert.equal(c.preparedBeastRef.current, null);
  c.start('Candy'); c.land('Candy');
  assert.equal(c.selections.length, 2);
  assert.equal(c.state.beast, c.selections[1]);
});

test('merchant/label mismatch and missing preparation cannot reuse an unrelated beast; events remain excluded', () => {
  for (const mismatch of ['merchant', 'label', 'missing']) {
    const c = clientHandlers();
    if (mismatch !== 'missing') c.start('Candy');
    if (mismatch === 'merchant') c.selectedMerchant.id = 'merchant-b';
    c.land(mismatch === 'label' ? 'BOGO' : 'Candy');
    assert.equal(c.state.beast, c.selections.at(-1));
    assert.equal(c.selections.length, mismatch === 'missing' ? 1 : 2);
  }
  const event = clientHandlers(true); event.start('Candy'); event.land('Candy');
  assert.equal(event.downloads.length, 0); assert.equal(event.selections.length, 0);
});

test('preparation happens after verified entitlement guards and before animation; share/save/QR handlers and tier collection are unchanged', () => {
  const wheel = source('components/Wheel.tsx');
  const spin = wheel.slice(wheel.indexOf('const spin = async'), wheel.indexOf('const onSpinEnd = async'));
  assert.ok(spin.indexOf('if (!paidSpinReady || !verifiedSessionId)') < spin.indexOf('onSpinStart?.(winnerLabel)'));
  assert.ok(spin.indexOf('onSpinStart?.(winnerLabel)') < spin.indexOf('setRotation((prev)'));
  const current = source('components/WheelDealsClient.tsx');
  const original = execFileSync('git', ['show', 'origin/main:components/WheelDealsClient.tsx'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  assert.equal(current.slice(current.indexOf('  function brandedBeastCardUrl()'), current.indexOf('  async function sendSupportMessage')), original.slice(original.indexOf('  function brandedBeastCardUrl()'), original.indexOf('  async function sendSupportMessage')));
  const celebration = source('components/SpinCelebration.tsx');
  const old = execFileSync('git', ['show', 'origin/main:components/SpinCelebration.tsx'], { cwd: path.join(__dirname, '..'), encoding: 'utf8' });
  const tiers = (s) => s.slice(s.indexOf('export const RARITY_TIERS'), s.indexOf('\n/**', s.indexOf('export const RARITY_TIERS')));
  assert.equal(tiers(celebration), tiers(old));
  assert.match(celebration, /setTimeout\(\(\) => setPhase\("exit"\), 2400\)/);
  assert.match(celebration, /setTimeout\(\(\) => onDone\(\), 500\)/);
});

const tooling = process.env.BOOST_DOM_TOOLING;
if (!tooling) {
  test('real reveal image lifecycle and timer checks require BOOST_DOM_TOOLING', { skip: true }, () => {});
} else {
  test('preloaded image is visible on first render; late images fade in, timer/tap dismissal stays unchanged, and stale loads cannot switch beasts', async () => {
    const { JSDOM } = require(path.join(tooling, 'jsdom'));
    const { createRoot } = require('react-dom/client');
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
    const oldWindow = global.window, oldDocument = global.document;
    global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
    const p = preloader();
    const timers = [];
    const module = load('components/SpinCelebration.tsx', {
      window: dom.window, requestAnimationFrame: () => 1, cancelAnimationFrame: () => {},
      setTimeout: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; }, clearTimeout: (t) => { t.cleared = true; },
    }, { '../lib/beastImagePreload': p });
    const tier = module.RARITY_TIERS.find((t) => t.id === 'solid');
    const beast = tier.beasts.find((b) => b.name === 'Cinderjaw');
    const pre = p.preloadBeastImage(beast.imagePath); p.created[0].load(); await pre;
    const root = createRoot(dom.window.document.getElementById('root'));
    let done = 0; const onDone = () => done++;
    const render = (b) => React.act(() => root.render(React.createElement(module.default, { sliceWeightPct: 40, dealLabel: 'Candy', selectedBeast: { tier, beast: b }, onDone })));
    try {
      await render(beast);
      let img = dom.window.document.querySelector('img');
      assert.equal(img.style.opacity, '1'); assert.equal(img.getAttribute('fetchpriority'), 'high');
      assert.equal(img.getAttribute('loading'), 'eager'); assert.equal(img.style.width, '320px');
      assert.equal(timers.find((t) => !t.cleared).ms, 2400);
      const late = { ...beast, imagePath: '/late.webp', name: 'Late Beast' };
      await render(late); img = dom.window.document.querySelector('img'); assert.equal(img.style.opacity, '0');
      const stale = p.created.at(-1);
      const latest = { ...beast, imagePath: '/latest.webp', name: 'Latest Beast' };
      await render(latest);
      await React.act(async () => { stale.load(); await Promise.resolve(); });
      assert.equal(dom.window.document.querySelector('img').style.opacity, '0');
      await React.act(async () => { p.created.at(-1).load(); await Promise.resolve(); });
      img = dom.window.document.querySelector('img'); assert.equal(img.style.opacity, '1');
      assert.equal(img.style.transition, 'opacity 120ms ease-out'); assert.equal(img.alt, 'Latest Beast');
      await React.act(() => img.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })));
      assert.equal(done, 1);
      await React.act(() => timers.find((t) => !t.cleared && t.ms === 2400).fn());
      assert.equal(dom.window.document.getElementById('root').firstChild.style.opacity, '0');
      await React.act(() => timers.find((t) => !t.cleared && t.ms === 500).fn());
      assert.equal(done, 2);
    } finally {
      await React.act(() => root.unmount());
      global.window = oldWindow; global.document = oldDocument; delete global.IS_REACT_ACT_ENVIRONMENT; dom.window.close();
    }
  });
}
