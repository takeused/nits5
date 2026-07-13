const test = require('node:test');
const assert = require('node:assert/strict');
const { computeIndicators } = require('../js/commerce-score.js');

const okMetrics = {
  arti: { status: 'ok' }, patent: { status: 'ok' },
  ntis: { status: 'ok' }, report: { status: 'ok' },
};

test('논문 20건 미만 후보는 순위 대상에서 제외한다', () => {
  const result = computeIndicators({ counts: { arti: 19, patent: 1 }, metrics: okMetrics });
  assert.equal(result.eligible, false);
  assert.equal(result.rankingScore, 0);
});

test('특허 0건을 완전한 공백 만점으로 처리하지 않는다', () => {
  const result = computeIndicators({
    counts: { arti: 200, patent: 0, ntis: 20, report: 1 },
    metrics: okMetrics,
    trendSignal: { status: 'ok', growthRate: 20, recent: 40, prev: 30 },
    queryMeta: { comparable: true, relaxed: false },
  });
  assert.equal(result.components.gapSignal, 70);
  assert.ok(result.confidence > 80);
});

test('검색 범위가 불일치하면 데이터 신뢰도가 하락한다', () => {
  const base = { counts: { arti: 200, patent: 10, ntis: 20, report: 1 }, metrics: okMetrics,
    trendSignal: { status: 'ok', growthRate: 10, recent: 30, prev: 25 } };
  const aligned = computeIndicators({ ...base, queryMeta: { comparable: true, relaxed: false } });
  const mismatched = computeIndicators({ ...base, queryMeta: { comparable: false, relaxed: true } });
  assert.ok(aligned.confidence > mismatched.confidence);
  assert.ok(aligned.rankingScore > mismatched.rankingScore);
});

test('API 오류는 실제 0건보다 낮은 신뢰도를 만든다', () => {
  const validZero = computeIndicators({
    counts: { arti: 100, patent: 0, ntis: 0, report: 0 }, metrics: {
      ...okMetrics, patent: { status: 'no_result' }, ntis: { status: 'no_result' }, report: { status: 'no_result' },
    }, queryMeta: { comparable: true } });
  const failed = computeIndicators({
    counts: { arti: 100, patent: 0, ntis: 0, report: 0 }, metrics: {
      ...okMetrics, patent: { status: 'error' }, ntis: { status: 'error' }, report: { status: 'error' },
    }, queryMeta: { comparable: true } });
  assert.ok(validZero.confidence > failed.confidence);
});

test('후보군 기준 특허 전환이 낮을수록 공백 신호가 높다', () => {
  const base = {
    counts: { arti: 200, ntis: 20, report: 1 },
    metrics: okMetrics,
    queryMeta: { comparable: true, variantsTried: ['테스트 기술'] },
    trendSignal: { status: 'ok', growthRate: 10, recent: 30, prev: 25, yearlyCounts: [10, 15, 14, 16] },
    peerContext: { medianPatentIntensity: 0.65 },
  };
  const sparsePatent = computeIndicators({ ...base, counts: { ...base.counts, patent: 5 } });
  const densePatent = computeIndicators({ ...base, counts: { ...base.counts, patent: 80 } });
  assert.ok(sparsePatent.components.gapSignal > densePatent.components.gapSignal);
});

test('신뢰도 기준 미달 후보는 점수가 있어도 정식 순위에서 제외한다', () => {
  const result = computeIndicators({
    counts: { arti: 100, patent: 10, ntis: 0, report: 0 },
    metrics: { ...okMetrics, ntis: { status: 'error' }, report: { status: 'error' } },
    queryMeta: { comparable: false, relaxed: true },
    trendSignal: { status: 'error' },
  });
  assert.equal(result.confidenceGate, false);
  assert.equal(result.eligible, false);
  assert.equal(result.rankingScore, 0);
});

test('논문 5~19건의 성장 후보는 초기 탐색 후보로 분리한다', () => {
  const result = computeIndicators({
    counts: { arti: 10, patent: 1, ntis: 5, report: 1 },
    metrics: okMetrics,
    queryMeta: { comparable: true, variantsTried: ['초기 기술'] },
    trendSignal: { status: 'ok', growthRate: 40, recent: 20, prev: 5, yearlyCounts: [1, 4, 8, 12] },
  });
  assert.equal(result.eligible, false);
  assert.equal(result.exploratory, true);
});
