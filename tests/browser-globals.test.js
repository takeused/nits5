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
    AbortController: class AbortController {
      constructor() { this.signal = {}; }
      abort() {}
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
  assert.match(ui, /budget-diagnostic-main/);
  assert.match(css, /\.budget-diagnostic-badge\s*\{/);
  assert.match(css, /\.budget-diagnostic-copy\s*\{/);
});

test('budget search keywords preserve broad domain anchors for larger samples', () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  const keywords = context.buildBudgetSearchKeywords(
    '인공지능을 이용한 재난안전 회복력 플랫폼 기술개발',
    ['AI 재난안전 플랫폼', '재난안전 회복력']
  );

  assert.ok(keywords.includes('인공지능'));
  assert.ok(keywords.includes('재난안전'));
  assert.ok(keywords.some(keyword => keyword.includes('인공지능') && keyword.includes('재난안전')));
  assert.ok(keywords.length <= 6);
});

test('budget estimation does not filter comparable projects by selected duration', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const css = fs.readFileSync(path.join(ROOT, 'css/style.css'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.doesNotMatch(html, /budgetYearGroup/);
  assert.doesNotMatch(html, /setBudgetDuration/);
  assert.doesNotMatch(css, /budget-year-btn/);
  assert.doesNotMatch(ui, /function setBudgetDuration/);
  assert.doesNotMatch(ui, /Math\.abs\(projYrs - durationYears\)/);
  assert.match(ui, /수행기간은 연간 연구비 정규화에만 사용/);
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
  // 특허 막대는 범례와 같은 주황색(f754199)
  assert.match(chart, /rgba\(251,146,60,0\.8\)/);
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

test('budget relevance matches Latin tokens as whole words and honors AI/인공지능 aliases', () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  const rel = (title) => context.budgetLexicalRelevance('AI 기반 재난안전 플랫폼 개발', { projNm: title });
  // "explainable"·"training" 속 ai는 AI로 보지 않는다
  assert.equal(rel('explainable training framework'), 0);
  // 조사가 붙은 AI, 하이라이트 태그로 감싼 AI, 동의어 인공지능은 인정한다
  assert.equal(rel('AI를 활용한 홍수 예측'), 0.5);
  assert.equal(rel('<span class="search_word">AI</span> 재난안전 관제'), 1);
  assert.equal(rel('인공지능 재난안전 상황판'), 1);
  // 태그 속성(class="search_word")이 영문 토큰과 맞지 않도록 태그는 제거된다
  assert.equal(context.budgetLexicalRelevance('search', { projNm: '<span class="search_word">검색</span> 엔진' }), 0);
});

test('budget relevance gate prefers projects sharing every core keyword, then loosens', () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  const make = (titles) => titles.map((projNm, i) => ({ projNm, pjtId: String(i) }));
  const both = Array.from({ length: 5 }, (_, i) => `AI 재난안전 관제 ${i}`);
  const aiOnly = Array.from({ length: 30 }, (_, i) => `AI 의료영상 진단 ${i}`);

  // 둘 다 공유하는 과제가 5건 이상이면 그 과제들만으로 분포를 만든다
  const strict = context.applyBudgetRelevanceGate(make([...both, ...aiOnly]), 'AI 기반 재난안전 플랫폼 개발');
  assert.equal(strict.tier, 'all');
  assert.equal(strict.items.length, 5);

  // 부족하면 핵심어 하나라도 공유하는 과제로 내려가고, 무관 과제는 여전히 뺀다
  const loose = context.applyBudgetRelevanceGate(make([...both.slice(0, 2), ...aiOnly.slice(0, 5), '해양 생태 조사']), 'AI 기반 재난안전 플랫폼 개발');
  assert.equal(loose.tier, 'any');
  assert.equal(loose.items.length, 7);
});

test('commerce detail report reuses the ranked gap indicator instead of a conflicting formula', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  assert.match(ui, /analysisMeta\?\.indicators\?\.components\?\.gapSignal/);
  assert.doesNotMatch(ui, /logArti\s*\/\s*\(logArti\s*\+\s*logPatent\)/);
  assert.match(ui, /후속 검증 경로/);
});

test('commerce methodology text matches ranking gates and peer gap logic', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  assert.match(ui, /논문 20건 미만, 핵심 데이터 오류, 신뢰도 60점 미만 후보는 정식 순위에서 보류/);
  assert.match(ui, /논문 5~19건 후보는 성장·신뢰도 조건을 만족할 때만 <strong>초기 탐색 후보<\/strong>로 별도 표시/);
  assert.match(ui, /log10\(\(논문\+1\)\/\(특허\+1\)\)\/2/);
  assert.match(ui, /검색 완화 수준·검색어 폭이 비슷한 후보가 3개 이상일 때만 사용/);
  assert.match(ui, /정식 순위 조건을 통과한 서로 다른 후보가 3개보다 적으면/);
});

test('commerce analysis still renders diagnostics when no candidate passes formal ranking', () => {
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');
  assert.match(ui, /const hasRankedCandidates = top3\.length > 0/);
  assert.match(ui, /if \(hasRankedCandidates\) selectRankCard\(1\)/);
  assert.doesNotMatch(ui, /if \(!top3 \|\| top3\.length === 0\) \{[\s\S]{0,180}return;/);
});

test('auto AI routing falls back from Cerebras to Groq without asking for Gemini consent', async () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  const called = [];
  context.fetch = async (url) => {
    called.push(String(url).replace(/^.*\//, '/'));
    return String(url).endsWith('/groq')
      ? { ok: true, status: 200, json: async () => ({}) }
      : { ok: false, status: 404, json: async () => ({}) };
  };
  vm.runInContext(`ACTIVE_PROXY = 'local';
    STATE.aiConfigured = true; STATE.cerebrasConfigured = true;
    STATE.groqConfigured = true; STATE.geminiConfigured = true; STATE.aiProviderMode = 'auto';`, context);

  const resp = await context.cerebrasChat({ messages: [] }, 1000);
  assert.equal(resp.ok, true);
  assert.deepEqual(called, ['/cerebras', '/groq']);

  // Groq 강제는 Cerebras를 거치지 않는다
  called.length = 0;
  vm.runInContext("STATE.aiProviderMode = 'groq'", context);
  await context.cerebrasChat({ messages: [] }, 1000);
  assert.deepEqual(called, ['/groq']);
});

test('Cerebras browser requests extract an ASCII key from pasted descriptive text', async () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  let captured = null;
  context.fetch = async (url, init) => {
    captured = { url, init };
    return { ok: true, json: async () => ({}) };
  };
  vm.runInContext("STATE.cerebrasKey = 'csk-abcdefghijklmnopqrstuvwxyz123456 cerebras API 키'", context);
  await context.cerebrasChat({ messages: [] }, 1000);

  assert.equal(captured.init.headers.Authorization, 'Bearer csk-abcdefghijklmnopqrstuvwxyz123456');
  assert.match(captured.init.headers.Authorization, /^[\x20-\x7E]+$/);
});

test('Cerebras GLM model requests omit GPT-OSS reasoning effort', async () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  let payload = null;
  context.fetch = async (url, init) => {
    payload = JSON.parse(init.body);
    return { ok: true, json: async () => ({}) };
  };
  vm.runInContext("STATE.cerebrasKey = 'csk-abcdefghijklmnopqrstuvwxyz123456'; STATE.aiModelMode = 'zai-glm-4.7';", context);
  await context.cerebrasChat({ model: 'gpt-oss-120b', reasoning_effort: 'high', messages: [] }, 1000);

  assert.equal(payload.model, 'zai-glm-4.7');
  assert.equal(Object.hasOwn(payload, 'reasoning_effort'), false);
});

test('AI model quality experiment mode is available in settings and result view', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(html, /id="aiModelModeInput"/);
  assert.match(html, /value="compare-gpt-glm"/);
  assert.match(ui, /function runSubKeywordModelExperiment/);
  assert.match(ui, /AI 품질 실험 결과/);
  assert.match(ui, /Stage 2 후보 생성 기준/);
});

test('GLM is the default model mode after benchmark result', () => {
  const state = fs.readFileSync(path.join(ROOT, 'js/state.js'), 'utf8');
  const main = fs.readFileSync(path.join(ROOT, 'js/main.js'), 'utf8');
  const ui = fs.readFileSync(path.join(ROOT, 'js/ui.js'), 'utf8');

  assert.match(state, /localStorage\.getItem\('sc_ai_model_mode'\) \|\| 'zai-glm-4\.7'/);
  assert.match(main, /STATE\.aiModelMode \|\| 'zai-glm-4\.7'/);
  assert.match(ui, /STATE\.aiModelMode = AI_MODEL_MODES\.GLM/);
});

test('invalid Cerebras browser keys fail before fetch builds a header', async () => {
  const context = createBrowserContext();
  loadScript(context, 'js/state.js');
  loadScript(context, 'js/commerce-score.js');
  loadScript(context, 'js/budget-core.js');
  loadScript(context, 'js/ui.js');

  let called = false;
  context.fetch = async () => { called = true; return { ok: true }; };
  vm.runInContext("STATE.cerebrasKey = '잘못된 API 키'", context);

  await assert.rejects(context.cerebrasChat({ messages: [] }, 1000), /AI_KEY_INVALID/);
  assert.equal(called, false);
});
