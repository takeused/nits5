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
