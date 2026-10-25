const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const root = path.join(__dirname, '..');
const { isPatchedNode24 } = require('../scripts/check-node-security.cjs');

test('accepts stable patched Node.js 24, rejects older/unrelated/prerelease/invalid runtimes', () => {
  for (const version of ['v24.22.1', '24.22.1', 'v24.22.2', 'v24.23.0', 'v24.100.0']) assert.equal(isPatchedNode24(version), true, version);
  for (const version of ['v24.22.0', 'v24.21.99', 'v24.0.0', 'v22.23.4', 'v26.12.1', 'v20.20.0', 'v24.22.1-rc.1', 'v24.22.1-extra', '', 'invalid']) assert.equal(isPatchedNode24(version), false, version);
});

test('prebuild guard blocks unpatched builds and logs only runtime version, never environment secrets', () => {
  const code = fs.readFileSync(path.join(root, 'scripts/check-node-security.cjs'), 'utf8');
  for (const version of ['v24.22.1', 'v24.21.0', 'v22.13.0']) {
    const module = { exports: {} };
    const require = () => { throw new Error('Unexpected dependency'); }; require.main = module;
    const logs = [];
    const process = { version, env: { STRIPE_SECRET_KEY: 'secret-sentinel' } };
    vm.runInNewContext(code, { module, require, process, console: { info: (...args) => logs.push(args.join(' ')), error: (...args) => logs.push(args.join(' ')) } });
    assert.equal(process.exitCode, version === 'v24.22.1' ? undefined : 1);
    assert.match(logs.join('\n'), new RegExp(version.replaceAll('.', '\\.')));
    assert.doesNotMatch(logs.join('\n'), /secret-sentinel/);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.engines.node, '24.x');
  assert.equal(pkg.scripts.build, 'node scripts/check-node-security.cjs && next build');
});

test('diagnostic route preserves safe response and logs actual server version once, without publishing it or leaking secrets', async () => {
  const exports = {}, logs = [];
  const code = ts.transpileModule(fs.readFileSync(path.join(root, 'app/api/debug-env/route.ts'), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(code, { exports, require: (name) => { assert.equal(name, 'next/server'); return { NextResponse: { json: (body) => body } }; }, console: { info: (...args) => logs.push(args.join(' ')) }, process: { version: 'v24.22.1', env: { NEXT_PUBLIC_APP_URL: 'https://example.test', STRIPE_SECRET_KEY: 'secret-sentinel', STRIPE_PUBLISHABLE_KEY: 'public-sentinel' } } });
  assert.equal(exports.dynamic, 'force-dynamic'); assert.equal(exports.runtime, 'nodejs');
  const req = { headers: { get: () => null }, url: 'https://example.test/api/debug-env' };
  const first = await exports.GET(req), second = await exports.GET(req);
  assert.equal(first.NEXT_PUBLIC_APP_URL, 'https://example.test');
  assert.equal(first.STRIPE_PUBLISHABLE_KEY_CONFIGURED, true);
  assert.equal(JSON.stringify(first), JSON.stringify(second));
  assert.doesNotMatch(JSON.stringify(first), /v24\.22\.1|secret-sentinel|public-sentinel|STRIPE_SECRET_KEY/);
  assert.equal(logs.length, 1);
  assert.equal(logs[0], '[Wheel Deals server runtime] Node.js v24.22.1');
  assert.doesNotMatch(logs.join('\n'), /sentinel/);
});
