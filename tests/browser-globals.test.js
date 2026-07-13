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

test('shared UI visual tokens cover core surfaces and controls', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');

  assert.match(css, /--brand:\s*#4f46e5/);
  assert.match(css, /--radius-lg:\s*16px/);
  assert.match(css, /\.result-card, \.ntis-table-wrap, \.analysis-card/);
  assert.match(css, /:where\(button, input, select, textarea, a\):focus-visible/);
  assert.match(css, /html\.dark \.btn-primary/);
});

test('budget result callouts and layout use the compact surface system', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /class="budget-warning" role="status"/);
  assert.match(css, /\.budget-warning\s*\{[\s\S]*background:\s*var\(--surface-subtle\)/);
  assert.match(css, /\.budget-inline-box\s*\{[\s\S]*padding:\s*1\.25rem/);
  assert.match(css, /\.budget-kpi-grid\s*\{[\s\S]*gap:\s*\.65rem/);
  assert.match(css, /\.budget-hero-diagnostic\s*\{[\s\S]*grid-column:\s*2/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) minmax\(300px, \.9fr\)/);
  assert.match(css, /\.budget-hero-diagnostic strong\s*\{\s*white-space:\s*nowrap/);
});

test('budget project table reveals additional candidates on demand', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /function toggleBudgetMore\(button\)/);
  assert.match(ui, /budget-extra-row hidden/);
  assert.match(ui, /class="budget-more-btn" aria-expanded="false"/);
  assert.match(ui, /budget-more-label">더 보기/);
  assert.match(css, /\.budget-more-btn\s*\{/);
});

test('budget project duration is rounded to at most two decimals', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /projectYears\.toFixed\(2\)/);
  assert.match(ui, /\$\{projectYearsLabel\}년/);
});

test('home keyword chips fill the search input without auto-running a search', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  const fn = ui.match(/function runExampleSearch\(kw\) \{[\s\S]*?\n    \}/)?.[0] || '';

  assert.match(fn, /input\.value = kw/);
  assert.match(fn, /input\.focus\(\)/);
  assert.doesNotMatch(fn, /doSearch\(\)/);
});

test('identifiers are copyable across table and card result views', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /function copyIdentifierValue\(value, trigger\)/);
  assert.match(ui, /class="identifier-copy ntis-cell-ellipsis"/);
  assert.match(ui, /class="identifier-copy card-identifier-copy/);
  assert.match(ui, /copyIdentifierValue\(this\.dataset\.identifier,this\)/);
  assert.match(css, /\.identifier-copy\s*\{/);
  assert.match(css, /cursor:\s*copy/);
});
