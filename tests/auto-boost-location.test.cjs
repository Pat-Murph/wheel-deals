const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(filename, mocks = {}, globals = {}) {
  const exports = {};
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  const mockRequire = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    throw new Error(`Unexpected dependency ${name}`);
  };
  vm.runInNewContext(code, { exports, require: mockRequire, Date, Number, console, ...globals });
  return exports;
}
const geo = load('lib/boostLocation.ts');
const merchant = {
  id: 'company', name: 'Wheel Deals', isMobile: true, boostMode: 'always',
  boostActive: true, boostFreeSpinsRemaining: 500, boostWheelPriceCents: 135,
  lat: 40, lng: -120, mobileLat: 41, mobileLng: -121,
  mobileServiceLat: 36.17, mobileServiceLng: -115.14,
  wheel: [{ label: 'BOGO', weight: 100 }],
};

test('25-mile mode stays available without check-in and uses service-area GPS rather than storefront or check-in', () => {
  assert.equal(geo.hasAvailableBoostWheel(merchant, 135), true);
  assert.equal(geo.hasAvailableBoostWheel({ ...merchant, boostFreeSpinsRemaining: 0 }, 135), false);
  assert.equal(geo.hasAvailableBoostWheel(merchant, 200), false);
  assert.equal(geo.withinBoostArea(merchant, { lat: 36.17, lng: -115.14 }), true);
  assert.equal(geo.withinBoostArea(merchant, { lat: 37, lng: -115.14 }), false);
  assert.equal(geo.withinBoostArea(merchant, null), false);
  const legacy = { ...merchant, mobileServiceLat: undefined, mobileServiceLng: undefined, lat: 36.17, lng: -115.14 };
  assert.equal(geo.withinBoostArea(legacy, { lat: 36.17, lng: -115.14 }), true);
  assert.equal(geo.boostCenter({ ...legacy, mobileServiceLat: 50 }).lat, 36.17);
});

test('mobile check-in and storefront modes retain their existing 200-meter limits', () => {
  const checkin = { ...merchant, boostMode: 'checkin', mobileLat: 36.17, mobileLng: -115.14 };
  assert.equal(geo.hasAvailableBoostWheel(checkin, 135), false);
  const checkedIn = { ...checkin, mobileActiveUntil: { toDate: () => new Date(Date.now() + 3600000) } };
  assert.equal(geo.hasAvailableBoostWheel(checkedIn, 135), true);
  assert.equal(geo.withinBoostArea(checkedIn, { lat: 36.171, lng: -115.14 }), true);
  assert.equal(geo.withinBoostArea(checkedIn, { lat: 36.18, lng: -115.14 }), false);
  const store = { ...merchant, isMobile: false, lat: 36.17, lng: -115.14 };
  assert.equal(geo.withinBoostArea(store, { lat: 36.18, lng: -115.14 }), false);
});

function hooksFor(filename, functionName, seeds) {
  const source = fs.readFileSync(path.join(__dirname, '..', filename), 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === functionName);
  const names = [];
  for (const statement of fn.body.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      const init = declaration.initializer;
      if (init && ts.isCallExpression(init) && init.expression.getText(ast) === 'useState') names.push(declaration.name.elements[0].name.text);
    }
  }
  let index = 0;
  return { ...React, useEffect: () => {}, useMemo: (fn) => fn(), useCallback: (fn) => fn, useRef: (value) => ({ current: value }),
    useState: (initial) => {
      const key = names[index++];
      return [Object.hasOwn(seeds, key) ? seeds[key] : typeof initial === 'function' ? initial() : initial, () => {}];
    },
  };
}

function renderWheel(props = {}, seeds = {}, fetchSpy = () => { throw new Error('Unexpected network'); }) {
  const file = 'components/Wheel.tsx';
  const hooks = hooksFor(file, 'Wheel', seeds);
  const module = load(file, {
    react: hooks,
    '@capacitor/core': { Capacitor: { isNativePlatform: () => false } },
    'firebase/auth': { getAuth: () => ({}) }, '@/lib/firebase': { app: {} },
    './EmbeddedCheckoutModal': { default: () => null },
  }, { window: {}, navigator: { userAgent: 'test' }, fetch: fetchSpy });
  const tree = module.default({ items: merchant.wheel, merchantId: 'company', uid: 'customer', spinPriceCents: 135, ...props });
  return { tree, html: renderToStaticMarkup(tree) };
}
function buttonIn(tree, label) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.type === 'button' && tree.props.children === label) return tree;
  const children = React.Children.toArray(tree.props?.children);
  for (const child of children) { const result = buttonIn(child, label); if (result) return result; }
  return null;
}

test('pending location replaces the paid button from the first render and cannot start checkout', async () => {
  let network = 0, retries = 0;
  const gate = { label: 'Checking location…', busy: true, onRetry: () => retries++ };
  const { tree, html } = renderWheel({ boostLocationGate: gate }, {}, () => network++);
  assert.doesNotMatch(html, /Unlock Deal — Pay/);
  assert.match(html, /Checking location/);
  const button = buttonIn(tree, gate.label);
  assert.equal(button.props.disabled, true);
  await button.props.onClick(); // programmatic click cannot bypass the disabled UI
  assert.equal(network, 0);
  assert.equal(retries, 0);
});

test('denial, timeout, and out-of-range actions only recheck location, never open Stripe', async () => {
  for (const label of ['Retry location for free deal', 'Re-check location for free deal']) {
    let retries = 0, network = 0;
    const { tree, html } = renderWheel({ boostLocationGate: { label, busy: false, onRetry: () => retries++ } }, {}, () => network++);
    assert.doesNotMatch(html, /Unlock Deal — Pay/);
    await buttonIn(tree, label).props.onClick();
    assert.equal(retries, 1);
    assert.equal(network, 0);
  }
});

test('within-range customers see Claim Free Deal; ordinary paid wheels, share rewards and paid returns are preserved', () => {
  assert.match(renderWheel({ isFreeSpinBoost: true }).html, />Claim Free Deal<\/button>/);
  assert.doesNotMatch(renderWheel({ isFreeSpinBoost: true }, { payStatus: 'Merchant has not connected Stripe yet' }).html, /Merchant has not connected Stripe/);
  assert.match(renderWheel().html, /Unlock Deal — Pay \$1\.35/);
  assert.match(renderWheel({ boostLocationGate: { label: 'Checking location…', busy: true, onRetry: () => {} } }, { shareReward: { rewardId: 'earned' } }).html, /Use Free Share Reward/);
  assert.match(renderWheel({ boostLocationGate: { label: 'Checking location…', busy: true, onRetry: () => {} } }, { paidSpinReady: true, entitlementKind: 'paid' }).html, /Unlock \(\$1\.35\)/);
});

function renderCustomer(location, overrides = {}, props = {}) {
  const file = 'components/WheelDealsClient.tsx';
  const business = { ...merchant, ...overrides };
  let wheelProps, autoArgs;
  const hooks = hooksFor(file, 'WheelDealsClient', {
    merchants: [business], selectedMerchantId: business.id, loadingMerchants: false, uid: 'customer',
  });
  const module = load(file, {
    react: hooks,
    './Wheel': { default: (props) => { wheelProps = props; return null; } },
    'qrcode.react': { QRCodeCanvas: () => null },
    '../lib/merchants': { getActiveMerchants: async () => [business] },
    './SpinCelebration': { default: () => null, getRandomBeast: () => ({}) },
    '../lib/deviceFingerprint': { hasClaimedBoostLocally: () => false },
    '../lib/beastImagePreload': { preloadBeastImage: async () => true },
    '../lib/boostLocation': geo,
    '../lib/useBoostLocation': { useBoostLocation: (...args) => { autoArgs = args; return { ...location, requestLocation: () => {} }; } },
    'firebase/auth': {}, '../lib/firebase': { app: {} },
  }, { window: {}, navigator: { userAgent: 'test' } });
  const html = renderToStaticMarkup(React.createElement(module.default, props));
  return { html, wheelProps, autoArgs };
}

test('customer page auto-checks only an active 25-mile boosted wheel and suppresses extra manual location button', () => {
  const pending = renderCustomer({ userPos: null, geoChecking: true, geoError: null });
  assert.equal(pending.autoArgs[1], true);
  assert.match(pending.html, /Checking your location automatically/);
  assert.doesNotMatch(pending.html, /Check my location/);
  assert.equal(pending.wheelProps.boostLocationGate.busy, true);
  assert.equal(pending.wheelProps.isFreeSpinBoost, false);
  const ready = renderCustomer({ userPos: { lat: 36.17, lng: -115.14 }, geoChecking: false, geoError: null });
  assert.equal(ready.wheelProps.isFreeSpinBoost, true);
  assert.equal(ready.wheelProps.boostLocationGate, undefined);
  assert.match(ready.html, /Tap Claim Free Deal below/);
  assert.equal(renderCustomer({ userPos: null }, { boostActive: false }).autoArgs[1], false);
  assert.equal(renderCustomer({ userPos: null }, {}, { initialEventId: 'daily-drop' }).autoArgs[1], false);
  const checkin = renderCustomer({ userPos: null, geoChecking: false }, { boostMode: 'checkin', mobileActiveUntil: { toDate: () => new Date(Date.now() + 3600000) } });
  assert.equal(checkin.autoArgs[1], false);
  assert.match(checkin.html, /Check my location/);
});

test('merchant description preserves blank paragraphs and single line breaks from the edit field', () => {
  for (const newline of ['\n', '\r\n']) {
    const about = `About this business.${newline}${newline}Pickup instructions.${newline}Contact us for details.`;
    const { html } = renderCustomer({ userPos: null, geoChecking: false }, { boostActive: false, about });
    assert.ok(html.includes(about));
    assert.match(html, /white-space:pre-wrap/);
    assert.match(html, /overflow-wrap:anywhere/);
  }
});

test('description stays plain text, escapes HTML, and wraps long emails without altering the saved content', () => {
  const about = 'Contact pat@wheeldealsapp.com. <script>alert("test")</script>';
  const { html } = renderCustomer({ userPos: null, geoChecking: false }, { boostActive: false, about });
  assert.match(html, /Contact pat@wheeldealsapp\.com\./);
  assert.match(html, /&lt;script&gt;alert\(&quot;test&quot;\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /overflow-wrap:anywhere/);
});

test('empty descriptions do not add a blank formatted block', () => {
  const { html } = renderCustomer({ userPos: null, geoChecking: false }, { boostActive: false, about: '' });
  assert.doesNotMatch(html, /white-space:pre-wrap/);
});
