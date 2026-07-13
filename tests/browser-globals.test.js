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

test('home search trigger sits beside the database switcher', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const controls = html.match(/class="home-search-controls[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';

  assert.match(controls, /id="btnDbScienceON"/);
  assert.match(controls, /id="btnDbNTIS"/);
  assert.match(controls, /id="searchBtn"/);
  assert.ok(controls.indexOf('id="btnDbNTIS"') < controls.indexOf('id="searchBtn"'));
});

test('primary brand and action surfaces use graphite instead of pure black', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

  assert.match(css, /--graphite:\s*#344054/);
  assert.match(css, /\.brand-mark\s*\{\s*background:\s*var\(--graphite\)/);
  assert.match(css, /\.btn-primary,[\s\S]*background:\s*var\(--graphite\)/);
  assert.match(html, /class="brand-mark w-8 h-8 rounded/);
  assert.doesNotMatch(html, /class="w-8 h-8 rounded bg-black/);
});

test('ScienceON tables omit columns with no values in the result set', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(ui, /const flags = \{/);
  assert.match(ui, /flags\.year \? '<th>연도<\/th>' : ''/);
  assert.match(ui, /flags\.people \? `<td>/);
  assert.match(ui, /flags\.source \? `<td>/);
  assert.match(ui, /flags\.identifier \? `<td>/);
});

test('trend analysis loading and result views share the compact visual surface', () => {
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const chart = fs.readFileSync(path.join(ROOT, 'js/chart.js'), 'utf8');

  assert.match(chart, /trend-analysis-card/);
  assert.match(chart, /trend-analysis-loading/);
  assert.match(chart, /trend-kpi-grid/);
  assert.match(css, /\.trend-analysis-card\s*\{/);
  assert.match(css, /\.trend-kpi-grid\s*\{/);
  assert.match(css, /\.trend-analysis-loading\s*\{/);
  assert.match(css, /same quiet graphite\/silver language/);
  assert.match(css, /linear-gradient\(135deg, #f8fafc 0%, #e4e7ec 100%\)/);
  assert.match(chart, /rgba\(152,162,179,0\.72\)/);
});

test('trend quality helpers distinguish empty, partial, and reliable distributions', () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/chart.js');

  const period = context.getTrendPeriod(new Date('2026-07-13T00:00:00Z'), 10);
  assert.equal(period.startYear, 2016);
  assert.equal(period.endYear, 2025);
  assert.equal(period.years.length, 10);

  assert.equal(context.summarizeTrendQuality({ total: 0 }).status, 'empty');
  assert.equal(context.summarizeTrendQuality({ total: 100, fetched: 20, yearKnown: 20, yearUnknown: 0, estimated: true }).status, 'partial');
  assert.equal(context.summarizeTrendQuality({ total: 100, fetched: 100, yearKnown: 100, yearUnknown: 0 }).status, 'ok');
  assert.equal(context.summarizeTrendQuality({ total: 100, fetched: 100, yearKnown: 100, yearUnknown: 0, direct: true }).direct, true);
  assert.equal(context.classifyTrendPhase([10, 10, 10, 11, 11, 11], { status: 'ok' }).phase, '성숙기');
  assert.equal(context.classifyTrendPhase([0, 0, 0, 0, 0, 0], { status: 'empty' }).code, 'insufficient');
});

test('trend calculation guidance follows the live aggregation path', () => {
  const chart = fs.readFileSync(path.join(ROOT, 'js/chart.js'), 'utf8');

  assert.match(chart, /연도 필터 집계를 우선 사용하며/);
  assert.match(chart, /\$\{years\[0\]\}~\$\{years\[years\.length - 1\]\}년/);
  assert.match(chart, /현재 결과는 연도별 직접 집계값을 사용/);
  assert.match(chart, /const displayRate = rate === null \? '—'/);
  assert.doesNotMatch(chart, /t > 0 \? 999/);
});

test('commerce ranking never backfills candidates removed by diversity rules', () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  const metrics = {
    arti: { status: 'ok' }, patent: { status: 'ok' },
    ntis: { status: 'ok' }, report: { status: 'ok' },
  };
  const makeResult = (keyword, patent) => ({
    keyword, theme: '동일 테마', counts: { arti: 200, patent, ntis: 20, report: 1 }, metrics,
    queryMeta: { comparable: true, relaxed: false, variantsTried: [keyword] }, enrichment: {},
  });
  const ranked = context.selectTop3WithDiversity([
    makeResult('센서 융합', 5), makeResult('센서 통합', 10), makeResult('센서 결합', 15),
  ], []);

  assert.equal(ranked.top3.length, 1);
  assert.equal(ranked.eliminated.length, 2);
});

test('commerce detail report reuses the ranked gap indicator instead of a conflicting formula', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  assert.match(ui, /analysisMeta\?\.indicators\?\.components\?\.gapSignal/);
  assert.doesNotMatch(ui, /logArti\s*\/\s*\(logArti\s*\+\s*logPatent\)/);
  assert.match(ui, /후속 검증 경로/);
});
