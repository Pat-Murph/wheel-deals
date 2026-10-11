const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function renderDashboard(company, active) {
  const filename = path.join(__dirname, '..', 'app/merchant/page.tsx');
  const source = fs.readFileSync(filename, 'utf8');
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hookNames = [];
  const dashboard = ast.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'MerchantDashboardPage');
  dashboard.body.statements.forEach((statement) => {
    if (!ts.isVariableStatement(statement)) return;
    statement.declarationList.declarations.forEach((declaration) => {
      const initializer = declaration.initializer;
      if (initializer && ts.isCallExpression(initializer) && initializer.expression.getText(ast) === 'useState') {
        hookNames.push(declaration.name.elements[0].name.text);
      }
    });
  });
  const uid = company ? 'company-uid' : 'ordinary-uid';
  const merchant = {
    name: 'Test business', category: 'Others', ownerUid: uid, active: true, foundingNumber: 8,
    isMobile: true, boostMode: 'always', boostActive: active,
    boostFreeSpinsRemaining: company ? 500 : 10, boostUnlocksGranted: company ? 500 : 10,
    wheels: [{ spinPriceCents: 135, items: [{ label: '10% off', weight: 100 }] }],
  };
  const seeds = {
    user: { uid }, merchantId: 'shop', merchant, merchantName: 'Test business',
    boostCapability: { uid, merchantId: 'shop', allowed: company }, boostCapabilityLoading: false,
    boostMode: 'always',
  };
  let hookIndex = 0;
  const exports = {};
  const mocks = (name) => {
    if (name === 'react') return {
      ...React, useEffect: () => {}, useMemo: (fn) => fn(), useRef: (value) => ({ current: value }),
      useState: (initial) => {
        const key = hookNames[hookIndex++];
        return [Object.hasOwn(seeds, key) ? seeds[key] : (typeof initial === 'function' ? initial() : initial), () => {}];
      },
    };
    if (name === 'react/jsx-runtime') return require(name);
    if (name === 'firebase/auth') return { getAuth: () => ({}) };
    if (name === 'firebase/firestore') return {};
    if (name === '../../lib/firebase') return { app: {} };
    if (name === '../../lib/auth') return {};
    if (name === '../../lib/merchantStats') return { todayKeyLocal: () => '2026-10-11' };
    throw new Error(`Unexpected dashboard dependency ${name}`);
  };
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText;
  vm.runInNewContext(code, { exports, require: mocks, Date, console, URLSearchParams });
  return renderToStaticMarkup(React.createElement(exports.default));
}

test('company dashboard displays a 500-default quantity input alongside the 25-mile option', () => {
  const html = renderDashboard(true, false);
  assert.match(html, /id="boost-unlock-count"/);
  assert.match(html, /value="500"/);
  assert.match(html, /25-mile radius/);
  assert.match(html, /any positive whole number of free unlocks/);
});

test('ordinary dashboard has no custom quantity control but every active owner can end Boost', () => {
  assert.doesNotMatch(renderDashboard(false, false), /id="boost-unlock-count"/);
  assert.match(renderDashboard(false, true), />End Boost<\/button>/);
  const html = renderDashboard(true, true);
  assert.match(html, />End Boost<\/button>/);
  assert.match(html, /500 free unlocks left/);
  assert.match(html, /Already-issued deals remain valid/);
});
