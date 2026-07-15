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

  function cleanBudgetItems(items = {}, options = {}) {
    const source = Array.isArray(items) ? items : [];
    const valid = source.filter(item => positiveNumber(item?.annualBudget) > 0);
    const diagnostics = {
      inputCount: source.length,
      missingBudgetCount: source.length - valid.length,
      outlierCount: 0,
      iqrMultiplier: null,
    };
    const minimumForIqr = Number(options.minimumForIqr) || 8;
    if (valid.length < minimumForIqr) return { items: valid, diagnostics };

    // IQR(Interquartile Range, 사분위 범위) 기반 이상치 제거.
    // 연구비를 오름차순 정렬한 뒤 4등분하여 Q1(하위 25% 지점)·Q3(상위 25% 지점)을 구하고,
    // IQR = Q3 − Q1 (가운데 50% 데이터가 퍼진 폭)을 계산한다.
    // 평균은 초대형 국책과제 같은 극단값 하나에 크게 휘둘리지만, IQR은 중앙 50%만 보므로
    // 그런 이상치에 둔감하다. 아래에서 [Q1 − k·IQR, Q3 + k·IQR] 범위(k=1.5, 표본 급감 시 3)를
    // 벗어난 과제를 이상치로 제외해 적정 연구비 왜곡을 막는다.
    const values = valid.map(item => positiveNumber(item.annualBudget)).sort((a, b) => a - b);
    const q1 = quantileSorted(values, 0.25);
    const q3 = quantileSorted(values, 0.75);
    const iqr = q3 - q1;
    if (iqr <= 0) return { items: valid, diagnostics: { ...diagnostics, q1, q3 } };

    // 이상치 판정: value가 [Q1 − k·IQR, Q3 + k·IQR] 안에 있으면 유지, 벗어나면 제외.
    const filterWith = multiplier => valid.filter(item => {
      const value = positiveNumber(item.annualBudget);
      return value >= q1 - multiplier * iqr && value <= q3 + multiplier * iqr;
    });
    let multiplier = 1.5;
    let cleaned = filterWith(multiplier);
    if (cleaned.length < 5) {
      multiplier = 3;
      cleaned = filterWith(multiplier);
    }
    diagnostics.outlierCount = valid.length - cleaned.length;
    diagnostics.iqrMultiplier = multiplier;
    diagnostics.q1 = q1;
    diagnostics.q3 = q3;
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
    const pointEstimate = Math.round(quantileSorted(values, scenario.point));
    const recommendedLow = Math.round(quantileSorted(values, scenario.low));
    const recommendedHigh = Math.round(quantileSorted(values, scenario.high));
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
    const totalWeight = aiEvaluated.reduce((sum, item) => sum + positiveNumber(item.similarity), 0);
    const weightedAvg = totalWeight > 0
      ? Math.round(aiEvaluated.reduce((sum, item) =>
          sum + escalateBudget(item, currentYear, annualRate) * positiveNumber(item.similarity) / totalWeight, 0))
      : null;
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
    const sampleScore = 35 * clamp(n / 15);
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
      avg: average,
      sd: standardDeviation,
      cv,
      avgSimilarity,
      confidence,
      confidenceScore,
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
    cleanBudgetItems,
    escalateBudget,
    calculateBudgetEstimate,
  };
});
