const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

function createBrowserContext() {
  const fakeElement = {
    classList: { add() {}, remove() {}, contains() { return false; } },
    style: {},
    dataset: {},
    addEventListener() {},
    querySelector() { return fakeElement; },
    querySelectorAll() { return []; },
    appendChild() {},
    insertAdjacentHTML() {},
    setAttribute() {},
    getAttribute() { return null; },
    focus() {},
    textContent: '',
    innerHTML: '',
    value: '',
  };

  const document = {
    getElementById() { return fakeElement; },
    querySelector() { return fakeElement; },
    querySelectorAll() { return []; },
    createElement() { return { ...fakeElement }; },
    addEventListener() {},
  };

  const context = {
    console,
    document,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    window: {
      location: { protocol: 'http:', hostname: 'localhost', port: '3737' },
      addEventListener() {},
    },
    AbortSignal: { timeout() { return undefined; } },
    fetch() { return Promise.resolve({ ok: false }); },
    setTimeout,
    clearTimeout,
    URLSearchParams,
    DOMParser: function DOMParser() {},
    Chart: function Chart() {},
  };
  context.window = Object.assign(context.window, context);
  return vm.createContext(context);
}

function loadScript(context, relativePath) {
  const source = fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
  vm.runInContext(source, context, { filename: relativePath });
}

test('trend analysis can access the shared ScienceON API base helper', () => {
  const context = createBrowserContext();

  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');
  loadScript(context, 'js/chart.js');

  assert.equal(typeof context.getApiBase, 'function');
  assert.equal(context.getApiBase(), 'https://apigateway.kisti.re.kr/openapicall.do');
  assert.equal(typeof context.runTrendAnalysis, 'function');
  assert.equal(typeof context.BudgetCore.calculateBudgetEstimate, 'function');
});

test('budget core loads before UI in the browser entrypoint', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.ok(html.indexOf('js/budget-core.js') < html.indexOf('js/ui.js'));
});

test('budget result summary uses the light card treatment', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  const heroRule = css.match(/\.budget-hero\s*\{[^}]+\}/)?.[0] || '';
  assert.match(heroRule, /background:\s*#fff/);
  assert.doesNotMatch(heroRule, /linear-gradient\(135deg,\s*#111/);
  assert.doesNotMatch(ui, /<span class="budget-chip">CV/);
  assert.match(ui, /budget-hero-diagnostic/);
});

test('NTIS project search results use the compact table layout', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /function renderNTISProjectTable/);
  assert.match(ui, /class="ntis-result-table"/);
  assert.match(ui, /collection === 'project' \|\| collection === 'prjt'/);
  assert.match(css, /\.ntis-result-table/);
  assert.match(css, /\.ntis-result-row/);
});

test('ScienceON search results use the compact table layout', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /function renderScienceONTable/);
  assert.match(ui, /class="ntis-result-table scienceon-result-table"/);
  assert.match(ui, /grid\.insertAdjacentHTML\('beforeend', renderScienceONTable\(items, query\)\)/);
  assert.doesNotMatch(ui, /items\.forEach\(\(item, idx\) => \{\s*const card = renderCard\(item, idx, query\);/);
  assert.match(css, /\.scienceon-result-row/);
});
