const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const tooling = process.env.BOOST_DOM_TOOLING;

if (!tooling) {
  test('Real automatic-location hook integration (requires BOOST_DOM_TOOLING)', { skip: true }, () => {});
} else {
  const { JSDOM } = require(path.join(tooling, 'jsdom'));
  test('auto location requests once, handles denial/timeout/retry, and cannot apply a previous merchant result', async () => {
    const dom = new JSDOM('<div id="root"></div>', { url: 'https://example.test' });
    const oldWindow = global.window, oldDocument = global.document;
    global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
    const calls = [];
    const navigator = { geolocation: { getCurrentPosition: (success, failure, options) => calls.push({ success, failure, options }) } };
    const exports = {};
    const code = ts.transpileModule(fs.readFileSync(path.join(__dirname, '..', 'lib/useBoostLocation.ts'), 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, require: (name) => { assert.equal(name, 'react'); return React; }, navigator });
    let value;
    function Harness({ requestKey, autoCheck }) {
      value = exports.useBoostLocation(requestKey, autoCheck);
      return React.createElement('span', null, value.geoChecking ? 'checking' : value.geoError ?? JSON.stringify(value.userPos));
    }
    const root = createRoot(dom.window.document.getElementById('root'));
    const render = async (key, auto = true) => React.act(() => root.render(React.createElement(React.StrictMode, null, React.createElement(Harness, { requestKey: key, autoCheck: auto }))));
    const coords = (lat) => ({ coords: { latitude: lat, longitude: -115.14 } });
    try {
      await render('shop:cycle-1');
      assert.equal(calls.length, 1); // Strict Mode double effects must not prompt twice
      assert.equal(value.geoChecking, true);
      assert.equal(calls[0].options.timeout, 10000);
      assert.equal(calls[0].options.maximumAge, 30000);
      await render('shop:cycle-1');
      assert.equal(calls.length, 1);
      await React.act(() => calls[0].success(coords(36.17)));
      assert.equal(value.geoChecking, false);
      assert.equal(value.userPos.lat, 36.17);
      await render('other:cycle-1');
      assert.equal(value.userPos, null);
      assert.equal(calls.length, 2);
      await React.act(() => calls[1].failure({ code: 1 }));
      assert.match(value.geoError, /Allow location access/);
      assert.equal(value.userPos, null);
      await render('other:cycle-1');
      assert.equal(calls.length, 2); // denial is not repeatedly prompted
      await React.act(() => value.requestLocation());
      assert.equal(calls.length, 3);
      await React.act(() => calls[2].failure({ code: 3 }));
      assert.match(value.geoError, /timed out/);
      await React.act(() => value.requestLocation());
      assert.equal(calls.length, 4);
      await render('new:cycle-1');
      assert.equal(calls.length, 5);
      await React.act(() => calls[3].success(coords(50)));
      assert.equal(value.userPos, null); // stale callback ignored
      assert.equal(value.geoChecking, true);
      await React.act(() => calls[4].success(coords(36.18)));
      assert.equal(value.userPos.lat, 36.18);
      await render('checkin:cycle-1', false);
      assert.equal(calls.length, 5); // 200m mode remains manual
      assert.equal(value.geoChecking, false);
      await React.act(() => value.requestLocation());
      assert.equal(calls.length, 6);
      await React.act(() => calls[5].failure({ code: 2 }));
      assert.match(value.geoError, /Could not determine/);
      navigator.geolocation = { getCurrentPosition: () => { throw new Error('Browser disallowed location'); } };
      await render('thrown:cycle-1');
      assert.equal(value.geoChecking, false);
      assert.match(value.geoError, /Could not start/);
      navigator.geolocation = undefined;
      await render('unsupported:cycle-1');
      assert.equal(value.geoChecking, false);
      assert.match(value.geoError, /unavailable/);
      assert.equal(value.userPos, null);
    } finally {
      await React.act(() => root.unmount());
      global.window = oldWindow; global.document = oldDocument;
      delete global.IS_REACT_ACT_ENVIRONMENT;
      dom.window.close();
    }
  });
}
