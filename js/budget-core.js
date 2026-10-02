(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.BudgetCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const positiveNumber = value => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };

  function parseMoneyValue(value) {
    if (typeof value === 'number') return positiveNumber(value);
    const text = String(value || '').replace(/,/g, '').trim();
    // "1억 5천만원"처럼 단위가 여러 개 섞인 표기는 숫자+단위 쌍을 모두 더한다.
    // (첫 숫자만 읽으면 1억으로 잘려 5천만원이 누락된다)
    const UNIT = { '억': 100000000, '천만': 10000000, '백만': 1000000, '만': 10000, '천': 1000 };
    const pairs = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(억|천\s*만|백\s*만|만|천)/g)];
    if (pairs.length > 1 && !/-/.test(text)) {
      const sum = pairs.reduce((acc, [, num, unit]) => acc + Number(num) * UNIT[unit.replace(/\s+/g, '')], 0);
      return Number.isFinite(sum) && sum > 0 ? sum : 0;
    }
    const match = text.match(/-?\d+(?:\.\d+)?/);
    if (!match) return 0;
    const number = Number(match[0]);
    if (!Number.isFinite(number) || number <= 0) return 0;
    if (/억\s*원?/.test(text)) return number * 100000000;
    if (/천\s*만\s*원?/.test(text)) return number * 10000000;
    if (/백\s*만\s*원?/.test(text)) return number * 1000000;
    if (/만\s*원?/.test(text)) return number * 10000;
    if (/천\s*원/.test(text)) return number * 1000;
    return number;
  }

  function parseCompactDate(value) {
    const digits = String(value || '').replace(/\D/g, '');
    if (digits.length < 4) return null;
    const year = Number(digits.slice(0, 4));
    const month = digits.length >= 6 ? Number(digits.slice(4, 6)) : 1;
    const day = digits.length >= 8 ? Number(digits.slice(6, 8)) : 1;
    if (year < 1900 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const date = new Date(Date.UTC(year, month - 1, day));
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function durationYearsFromDates(start, end) {
    const startDate = parseCompactDate(start);
    const endDate = parseCompactDate(end);
    if (!startDate || !endDate || endDate < startDate) return null;
    const days = (endDate.getTime() - startDate.getTime()) / 86400000 + 1;
    return Math.max(1 / 12, Math.round(days / 365.25 * 12) / 12);
  }

  function normalizeAnnualBudget(input = {}) {
    const currentYearFunds = positiveNumber(input.currentYearFunds);
    const totalFunds = positiveNumber(input.totalFunds);
    const governmentFunds = positiveNumber(input.governmentFunds);
    const durationYears = durationYearsFromDates(input.start, input.end);

    if (currentYearFunds > 0) {
      return { annualBudget: currentYearFunds, source: 'current_year', quality: 1, durationYears };
    }
    if (totalFunds > 0 && durationYears) {
      return {
        annualBudget: totalFunds / durationYears,
        source: 'total_annualized',
        quality: 0.90,
        durationYears,
      };
    }
    if (governmentFunds > 0 && durationYears) {
      return {
        annualBudget: governmentFunds / durationYears,
        source: 'government_annualized',
        quality: 0.75,
        durationYears,
      };
    }
    if (totalFunds > 0) {
      return {
        annualBudget: totalFunds,
        source: 'total_period_unknown',
        quality: 0.35,
        durationYears: null,
      };
    }
    if (governmentFunds > 0) {
      return {
        annualBudget: governmentFunds,
        source: 'government_period_unknown',
        quality: 0.25,
        durationYears: null,
      };
    }
    return { annualBudget: 0, source: 'missing', quality: 0, durationYears };
  }

  function quantileSorted(sorted, probability) {
    if (!sorted.length) return 0;
    if (sorted.length === 1) return sorted[0];
    const index = (sorted.length - 1) * clamp(probability);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
  }

  // 기간 미상 과제의 총액이 "연간 연구비"로 그대로 잡혀 분포를 부풀리는 것을 막는다(A-1).
  // 표본에서 관측된 수행연수의 중앙값으로 총액을 연간화한다. 관측 기간이 하나도 없으면 3년 가정.
  function reannualizeUnknownPeriods(items = []) {
    const list = Array.isArray(items) ? items : [];
    const durations = [];
    for (const it of list) {
      const d = durationYearsFromDates(it?.prdStartRaw, it?.prdEndRaw);
      if (d) durations.push(d);
    }
    durations.sort((a, b) => a - b);
    const fallbackDuration = durations.length ? quantileSorted(durations, 0.5) : 3;
    let adjustedCount = 0;
    const out = list.map(it => {
      if (!String(it?.budgetSource || '').includes('period_unknown')) return it;
      const total = positiveNumber(it?.totFund) || positiveNumber(it?.fundGov);
      if (!total) return it;
      adjustedCount++;
      return {
        ...it,
        annualBudget: total / fallbackDuration,
        budgetSource: 'total_median_annualized',
        budgetQuality: 0.5,
      };
    });
    return { items: out, fallbackDuration, adjustedCount };
  }

  function cleanBudgetItems(items = {}, options = {}) {
    const source = Array.isArray(items) ? items : [];
    const valid = source.filter(item => positiveNumber(item?.annualBudget) > 0);
    const diagnostics = {
      inputCount: source.length,
      missingBudgetCount: source.length - valid.length,
      outlierCount: 0,
      iqrMultiplier: null,
      scale: 'log',
    };
    // 소표본에서도 극단 이상치를 걸러내기 위해 임계값을 8 → 5로 낮춘다(A-2).
    const minimumForIqr = Number(options.minimumForIqr) || 5;

    // 이상치 판정 기준값 = 현재가치 보정 후 값(최종 통계와 동일한 기준으로 판정, B-4).
    // 보정을 끄면(escalate:false) 원 연간값으로 판정한다.
    const currentYear = Number(options.currentYear) || new Date().getFullYear();
    const annualRate = Number.isFinite(Number(options.annualRate)) ? Number(options.annualRate) : 0.03;
    const judge = (item) => options.escalate === false
      ? positiveNumber(item?.annualBudget)
      : (escalateBudget(item, currentYear, annualRate) || positiveNumber(item?.annualBudget));

    if (valid.length < minimumForIqr) {
      // 소표본: 사분위가 불안정하므로 중앙값 대비 극단값(P50 × cap 초과)만 보수적으로 제거(A-2).
      const vals = valid.map(judge).sort((a, b) => a - b);
      const med = quantileSorted(vals, 0.50);
      const capRatio = Number(options.smallSampleCapRatio) || 12;
      const cap = med * capRatio;
      const cleaned = med > 0 ? valid.filter(it => judge(it) <= cap) : valid;
      diagnostics.outlierCount = valid.length - cleaned.length;
      if (diagnostics.outlierCount > 0) diagnostics.smallSampleCap = Math.round(cap);
      return { items: cleaned, diagnostics };
    }

    // 연구비는 로그정규(우편향) 분포라 원값 IQR은 정상적인 대형과제까지 이상치로 잘라낸다(A-3).
    // log10 스케일에서 Q1·Q3·IQR을 구해 [Q1−k·IQR, Q3+k·IQR]를 벗어난 과제만 제외한다.
    const logs = valid.map(item => Math.log10(judge(item))).sort((a, b) => a - b);
    const q1 = quantileSorted(logs, 0.25);
    const q3 = quantileSorted(logs, 0.75);
    const iqr = q3 - q1;
    if (iqr <= 0) return { items: valid, diagnostics: { ...diagnostics, q1: Math.pow(10, q1), q3: Math.pow(10, q3) } };

    const filterWith = multiplier => valid.filter(item => {
      const logValue = Math.log10(judge(item));
      return logValue >= q1 - multiplier * iqr && logValue <= q3 + multiplier * iqr;
    });
    let multiplier = 1.5;
    let cleaned = filterWith(multiplier);
    if (cleaned.length < 5) {
      multiplier = 3;
      cleaned = filterWith(multiplier);
    }
    diagnostics.outlierCount = valid.length - cleaned.length;
    diagnostics.iqrMultiplier = multiplier;
    diagnostics.q1 = Math.pow(10, q1);   // 진단 표시용: 로그 경계를 원화로 역변환
    diagnostics.q3 = Math.pow(10, q3);
    return { items: cleaned, diagnostics };
  }

  function escalateBudget(item, currentYear, annualRate = 0.03, yearCap = 12) {
    const value = positiveNumber(item?.annualBudget);
    if (!value) return 0;
    const start = parseCompactDate(item?.prdStart);
    const end = parseCompactDate(item?.prdEnd);
    const startYear = start?.getUTCFullYear();
    const endYear = end?.getUTCFullYear();
    let middleYear = null;
    if (startYear && endYear) middleYear = Math.round((startYear + endYear) / 2);
    else middleYear = startYear || endYear || null;
    if (!middleYear || middleYear >= currentYear) return value;
    const elapsed = Math.min(yearCap, currentYear - middleYear);
    return value * Math.pow(1 + annualRate, elapsed);
  }

  const SCALE_SCENARIOS = {
    small:  { point: 0.35, low: 0.20, high: 0.50, label: '소형', note: '유사 과제 분포의 하위 시나리오' },
    medium: { point: 0.50, low: 0.25, high: 0.75, label: '중형', note: '유사 과제 분포의 중앙 시나리오' },
    large:  { point: 0.75, low: 0.50, high: 0.90, label: '대형', note: '유사 과제 분포의 상위 시나리오' },
  };

  function calculateBudgetEstimate(statItems, options = {}) {
    const items = Array.isArray(statItems) ? statItems : [];
    const currentYear = Number(options.currentYear) || new Date().getFullYear();
    const annualRate = Number.isFinite(Number(options.annualRate)) ? Number(options.annualRate) : 0.03;
    const scaleKey = SCALE_SCENARIOS[options.scaleKey] ? options.scaleKey : 'medium';
    const scenario = SCALE_SCENARIOS[scaleKey];
    let escalationCount = 0;
    const records = items.map(item => {
      const raw = positiveNumber(item?.annualBudget);
      if (!raw) return null;
      const adjusted = escalateBudget(item, currentYear, annualRate);
      if (adjusted > raw) escalationCount++;
      return { item, value: adjusted };
    }).filter(Boolean);
    if (!records.length) return null;

    const values = records.map(record => record.value).sort((a, b) => a - b);
    const n = values.length;
    const empiricalMedian = quantileSorted(values, 0.50);
    const rawQ1 = quantileSorted(values, 0.25);
    const rawQ3 = quantileSorted(values, 0.75);

    // C-9) 규모 시나리오를 "분포의 부분집합"으로 산출한다. 단순히 백분위 한 점을 읽는 대신,
    // 해당 규모의 백분위 구간[low,high]에 드는 과제만 모아 그 중앙값을 제안값,
    // 부분집합의 실제 min~max를 권장 범위로 쓴다(같은 규모대 과제끼리 비교).
    // 부분집합이 너무 작으면(<4건) 기존 백분위-점 방식으로 안전하게 폴백한다.
    const bandLow = quantileSorted(values, scenario.low);
    const bandHigh = quantileSorted(values, scenario.high);
    const subset = values.filter(v => v >= bandLow && v <= bandHigh);
    let pointEstimate, recommendedLow, recommendedHigh, scaleMode;
    if (subset.length >= 4) {
      pointEstimate = Math.round(quantileSorted(subset, 0.50));
      recommendedLow = Math.round(subset[0]);
      recommendedHigh = Math.round(subset[subset.length - 1]);
      scaleMode = 'subset';
    } else {
      pointEstimate = Math.round(quantileSorted(values, scenario.point));
      recommendedLow = Math.round(bandLow);
      recommendedHigh = Math.round(bandHigh);
      scaleMode = 'percentile';
    }

    const average = values.reduce((sum, value) => sum + value, 0) / n;
    const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / n;
    const standardDeviation = Math.sqrt(variance);
    const cv = average > 0 ? standardDeviation / average * 100 : 0;

    const aiSource = Array.isArray(options.aiItems) ? options.aiItems : items;
    const aiEvaluated = aiSource.filter(item =>
      item?.similaritySource === 'ai' &&
      positiveNumber(item?.similarity) > 0 &&
      positiveNumber(item?.annualBudget) > 0
    );
    // C-8) 유사도 가중을 선명하게: 선형 대신 (유사도−50)²을 가중치로 써 고유사 과제에 집중한다.
    // 유사도 50 이하는 좋은 비교대상이 아니므로 가중 0. 전부 0이면 단순평균으로 폴백.
    const simWeight = (sim) => Math.pow(Math.max(0, positiveNumber(sim) - 50), 2);
    const aiEscalated = aiEvaluated.map(item => ({
      value: escalateBudget(item, currentYear, annualRate),
      weight: simWeight(item.similarity),
    }));
    const totalWeight = aiEscalated.reduce((sum, r) => sum + r.weight, 0);
    const weightedAvg = totalWeight > 0
      ? Math.round(aiEscalated.reduce((sum, r) => sum + r.value * r.weight / totalWeight, 0))
      : (aiEscalated.length
          ? Math.round(aiEscalated.reduce((sum, r) => sum + r.value, 0) / aiEscalated.length)
          : null);
    // C-7) AI 대표과제와 같은 모집단의 중앙값. 가중평균과 이 값을 비교하면(같은 모집단)
    // 유사도 가중이 어느 쪽으로 쏠렸는지 알 수 있다. 전체 분포 제안값과의 비교는 모집단이 달라 부적절.
    const aiSortedValues = aiEscalated.map(r => r.value).sort((a, b) => a - b);
    const aiMedian = aiSortedValues.length ? Math.round(quantileSorted(aiSortedValues, 0.50)) : null;
    const avgSimilarity = aiEvaluated.length
      ? Math.round(aiEvaluated.reduce((sum, item) => sum + positiveNumber(item.similarity), 0) / aiEvaluated.length)
      : null;

    const sourceQuality = records.reduce((sum, record) => {
      const quality = Number(record.item?.budgetQuality);
      return sum + (Number.isFinite(quality) ? clamp(quality) : 0.50);
    }, 0) / n;
    const periodCompleteness = records.filter(record =>
      parseCompactDate(record.item?.prdStart) && parseCompactDate(record.item?.prdEnd)
    ).length / n;
    const robustSpread = empiricalMedian > 0 ? (rawQ3 - rawQ1) / empiricalMedian : 1;
    // C-6) 병합으로 표본수(n)가 줄어도, 각 과제가 여러 원 레코드(연차·공동기관)에서 관측됐다면
    // 그 연구비 값은 더 잘 확립된 것이다. 병합된 원 레코드 수를 부분적으로 표본에 credit한다
    // (레코드 1건당 0.25표본, 최대 +n까지). 같은 과제이므로 독립 표본으로 전액 인정하지는 않는다.
    const mergedRecords = records.reduce((sum, record) => sum + (positiveNumber(record.item?.mergedCount) || 1), 0);
    const effectiveN = n + Math.max(0, Math.min(n, 0.25 * (mergedRecords - n)));
    const sampleScore = 35 * clamp(effectiveN / 15);
    const sourceScore = 25 * sourceQuality;
    const periodScore = 10 * periodCompleteness;
    const dispersionScore = 15 * (1 - clamp((robustSpread - 0.50) / 2));
    const similarityScore = aiEvaluated.length
      ? 15 * clamp(aiEvaluated.length / 5) * clamp((avgSimilarity || 0) / 80)
      : 7.5;
    const confidenceScore = Math.round(sampleScore + sourceScore + periodScore + dispersionScore + similarityScore);
    const confidence = n < 5
      ? 'C'
      : confidenceScore >= 80 ? 'A' : confidenceScore >= 60 ? 'B' : 'C';

    return {
      pointEstimate,
      median: pointEstimate,
      empiricalMedian: Math.round(empiricalMedian),
      recommendedLow,
      recommendedHigh,
      q1: recommendedLow,
      q3: recommendedHigh,
      rawQ1: Math.round(rawQ1),
      rawQ3: Math.round(rawQ3),
      weightedAvg,
      aiMedian,
      avg: average,
      sd: standardDeviation,
      cv,
      avgSimilarity,
      confidence,
      confidenceScore,
      effectiveN: Math.round(effectiveN * 10) / 10,
      mergedRecords,
      scaleMode,
      sourceQuality,
      periodCompleteness,
      min: values[0],
      max: values[n - 1],
      n,
      aiN: aiEvaluated.length,
      scaleKey,
      scaleLabel: scenario.label,
      scaleNote: scenario.note,
      scenarioQuantile: scenario.point,
      values,
      escApplied: escalationCount > 0,
      escRate: annualRate,
      isEstimated: false,
    };
  }

  return {
    SCALE_SCENARIOS,
    parseMoneyValue,
    parseCompactDate,
    durationYearsFromDates,
    normalizeAnnualBudget,
    quantileSorted,
    reannualizeUnknownPeriods,
    cleanBudgetItems,
    escalateBudget,
    calculateBudgetEstimate,
  };
});
