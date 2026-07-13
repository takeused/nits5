const test = require('node:test');
const assert = require('node:assert/strict');
const {
  durationYearsFromDates,
  parseMoneyValue,
  normalizeAnnualBudget,
  cleanBudgetItems,
  calculateBudgetEstimate,
} = require('../js/budget-core.js');

const item = (annualBudget, extra = {}) => ({
  annualBudget,
  budgetQuality: 1,
  prdStart: '20240101',
  prdEnd: '20241231',
  similarity: null,
  similaritySource: 'none',
  ...extra,
});

test('수행기간을 실제 월수 기준 연수로 환산한다', () => {
  assert.equal(durationYearsFromDates('20240101', '20241231'), 1);
  assert.equal(durationYearsFromDates('20240101', '20250630'), 1.5);
  assert.equal(durationYearsFromDates('', ''), null);
});

test('NTIS 연구비의 쉼표와 한글 금액 단위를 해석한다', () => {
  assert.equal(parseMoneyValue('1,200,000,000'), 1_200_000_000);
  assert.equal(parseMoneyValue('1,200 백만원'), 1_200_000_000);
  assert.equal(parseMoneyValue('12억 원'), 1_200_000_000);
});

test('당해연도 연구비를 총연구비보다 우선 사용한다', () => {
  const result = normalizeAnnualBudget({
    currentYearFunds: 120_000_000,
    totalFunds: 600_000_000,
    governmentFunds: 500_000_000,
    start: '20230101',
    end: '20251231',
  });
  assert.equal(result.annualBudget, 120_000_000);
  assert.equal(result.source, 'current_year');
  assert.equal(result.quality, 1);
});

test('총연구비와 정부연구비는 수행기간으로 연간화한다', () => {
  const total = normalizeAnnualBudget({
    totalFunds: 600_000_000,
    start: '20230101',
    end: '20251231',
  });
  assert.equal(total.annualBudget, 200_000_000);
  assert.equal(total.source, 'total_annualized');

  const government = normalizeAnnualBudget({
    governmentFunds: 300_000_000,
    start: '20240101',
    end: '20251231',
  });
  assert.equal(government.annualBudget, 150_000_000);
  assert.equal(government.source, 'government_annualized');
});

test('유효 연구비가 없으면 근거 없는 기본 금액을 생성하지 않는다', () => {
  assert.equal(calculateBudgetEstimate([item(0)], { scaleKey: 'medium' }), null);
});

test('중형 시나리오의 대표값은 실제 표본 중앙값이다', () => {
  const sample = [1, 2, 3, 4, 5].map(v => item(v * 100_000_000));
  const result = calculateBudgetEstimate(sample, { scaleKey: 'medium', currentYear: 2024 });
  assert.equal(result.pointEstimate, 300_000_000);
  assert.equal(result.empiricalMedian, 300_000_000);
  assert.ok(result.pointEstimate >= result.recommendedLow);
  assert.ok(result.pointEstimate <= result.recommendedHigh);
});

test('표본 5건 미만은 다른 품질이 좋아도 C등급을 넘지 않는다', () => {
  const sample = [1, 2, 3, 4].map(v => item(v * 100_000_000));
  const result = calculateBudgetEstimate(sample, { scaleKey: 'medium', currentYear: 2024 });
  assert.equal(result.confidence, 'C');
});

test('규모 시나리오는 같은 분포 안에서 단조 증가한다', () => {
  const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9].map(v => item(v * 100_000_000));
  const small = calculateBudgetEstimate(sample, { scaleKey: 'small', currentYear: 2024 });
  const medium = calculateBudgetEstimate(sample, { scaleKey: 'medium', currentYear: 2024 });
  const large = calculateBudgetEstimate(sample, { scaleKey: 'large', currentYear: 2024 });
  assert.ok(small.pointEstimate < medium.pointEstimate);
  assert.ok(medium.pointEstimate < large.pointEstimate);
});

test('AI가 실제 평가한 유사도만 가중평균에 사용한다', () => {
  const sample = [item(100_000_000), item(300_000_000)];
  const representatives = [
    item(100_000_000, { similarity: 90, similaritySource: 'ai' }),
    item(300_000_000, { similarity: 60, similaritySource: 'fallback' }),
  ];
  const result = calculateBudgetEstimate(sample, {
    scaleKey: 'medium', currentYear: 2024, aiItems: representatives,
  });
  assert.equal(result.aiN, 1);
  assert.equal(result.weightedAvg, 100_000_000);
});

test('0원 표본을 제외하고 충분한 표본에서 IQR 이상치를 제거한다', () => {
  const values = [0, 100, 110, 120, 130, 140, 150, 160, 2000];
  const result = cleanBudgetItems(values.map(v => item(v)));
  assert.equal(result.items.some(v => v.annualBudget === 0), false);
  assert.equal(result.items.some(v => v.annualBudget === 2000), false);
  assert.equal(result.diagnostics.missingBudgetCount, 1);
  assert.equal(result.diagnostics.outlierCount, 1);
});
