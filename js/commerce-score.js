(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.CommerceScoring = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
  const count = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0;
  const logScale = (value, fullScale) => clamp(Math.log10(count(value) + 1) / Math.log10(fullScale + 1));
  const metricUsable = metric => !metric || metric.status === 'ok' || metric.status === 'no_result';
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  };

  function researchMomentum(trend = {}) {
    const growthRate = Number.isFinite(Number(trend.growthRate)) ? Number(trend.growthRate) : 0;
    const growth = trend.status === 'ok' ? clamp(0.5 + growthRate / 200) : 0.5;
    const yearly = Array.isArray(trend.yearlyCounts)
      ? trend.yearlyCounts.map(Number).filter(Number.isFinite)
      : [];
    if (trend.status !== 'ok' || yearly.length < 3) return { score: growth, growth, stability: 0.5 };

    const mean = yearly.reduce((sum, value) => sum + value, 0) / yearly.length;
    const variance = yearly.reduce((sum, value) => sum + (value - mean) ** 2, 0) / yearly.length;
    const coefficientOfVariation = mean > 0 ? Math.sqrt(variance) / mean : 1;
    const stability = 1 - clamp(coefficientOfVariation / 1.25);
    return { score: 0.70 * growth + 0.30 * stability, growth, stability };
  }

  function computeIndicators(input = {}) {
    const counts = input.counts || {};
    const metrics = input.metrics || {};
    const trend = input.trendSignal || {};
    const queryMeta = input.queryMeta || {};
    const enrichment = input.enrichment || {};
    const peerContext = input.peerContext || {};

    const papers = count(counts.arti);
    const patents = count(counts.patent);
    const ntis = count(counts.ntis);
    const reports = count(counts.report);

    const paperFoundation = logScale(papers, 1000);
    const logPaper = Math.log10(papers + 1);
    const logPatent = Math.log10(patents + 1);
    const patentIntensity = logPaper > 0 ? logPatent / logPaper : 0;
    const directGapSignal = (logPaper + logPatent) > 0 ? logPaper / (logPaper + logPatent) : 0;
    const peerIntensity = Number.isFinite(Number(peerContext.medianPatentIntensity))
      ? Number(peerContext.medianPatentIntensity)
      : null;
    // 후보군 내부 중앙값과 비교해 상대적으로 특허 전환이 낮은지를 보정한다.
    // 후보군이 작거나 편향될 수 있으므로 직접 공백 신호를 더 크게 반영한다.
    const peerGapSignal = peerIntensity === null
      ? directGapSignal
      : clamp(0.5 + (peerIntensity - patentIntensity) / Math.max(peerIntensity, 0.20) * 0.25);
    let gapSignal = 0.70 * directGapSignal + 0.30 * peerGapSignal;
    // 특허 0건은 진짜 공백과 검색 실패를 구분하기 어려우므로 만점으로 보지 않는다.
    if (patents === 0) gapSignal = Math.min(gapSignal, 0.70);

    const momentum = researchMomentum(trend);

    const opportunity = 100 * (
      0.35 * paperFoundation +
      0.40 * gapSignal +
      0.25 * momentum.score
    );

    const ntisSignal = logScale(ntis, 1000);
    const reportSignal = reports > 0 ? 1 : 0;
    // 특허가 일부 존재하는 것은 전환 가능성의 증거다. 특허 과다는 공백도에서 별도로 감점된다.
    const patentTranslationSignal = patents > 0 ? logScale(patents, 100) : 0;
    const externalSignals = ['patentFamily', 'market', 'trl']
      .map(key => enrichment[key])
      .filter(item => item && item.status === 'connected' && Number.isFinite(Number(item.score)));
    const externalSignal = externalSignals.length
      ? externalSignals.reduce((sum, item) => sum + clamp(Number(item.score) / 100), 0) / externalSignals.length
      : 0;

    const commercializationEvidence = 100 * (
      0.45 * ntisSignal +
      0.20 * reportSignal +
      0.25 * patentTranslationSignal +
      0.10 * externalSignal
    );

    const coreMetricNames = ['arti', 'patent', 'ntis', 'report'];
    const metricQuality = coreMetricNames.filter(name => metricUsable(metrics[name])).length / coreMetricNames.length;
    const queryComparable = queryMeta.comparable === false ? 0.35 : 1;
    const queryPenalty = queryMeta.relaxed ? 0.85 : 1;
    const paperReliability = clamp(papers / 20);
    const trendVolume = count(trend.recent) + count(trend.prev);
    const trendReliability = trend.status === 'ok' ? clamp(trendVolume / 20) : 0.25;
    const queryTraceability = Array.isArray(queryMeta.variantsTried) && queryMeta.variantsTried.length
      ? 1
      : 0.70;
    const confidence = 100 * (
      0.35 * metricQuality +
      0.25 * queryComparable * queryPenalty * queryTraceability +
      0.20 * paperReliability +
      0.20 * trendReliability
    );

    const coreDataValid = metricUsable(metrics.arti) && metricUsable(metrics.patent);
    const eligible = papers >= 20 && coreDataValid && confidence >= 60;
    const exploratory = papers >= 5 && papers < 20 && coreDataValid && confidence >= 65 && momentum.growth >= 0.65;
    // 신뢰도를 약한 보정치가 아니라 실제 우선순위의 비례 요인으로 사용한다.
    const rankingScore = eligible ? opportunity * confidence / 100 : 0;

    return {
      eligible,
      rankingScore: Number(rankingScore.toFixed(2)),
      opportunity: Number(opportunity.toFixed(1)),
      evidence: Number(commercializationEvidence.toFixed(1)),
      confidence: Number(confidence.toFixed(1)),
      components: {
        paperFoundation: Number((paperFoundation * 100).toFixed(1)),
        gapSignal: Number((gapSignal * 100).toFixed(1)),
        directGapSignal: Number((directGapSignal * 100).toFixed(1)),
        peerGapSignal: Number((peerGapSignal * 100).toFixed(1)),
        patentIntensity: Number((patentIntensity * 100).toFixed(1)),
        growthSignal: Number((momentum.growth * 100).toFixed(1)),
        stabilitySignal: Number((momentum.stability * 100).toFixed(1)),
        momentumSignal: Number((momentum.score * 100).toFixed(1)),
        ntisSignal: Number((ntisSignal * 100).toFixed(1)),
        reportSignal: Number((reportSignal * 100).toFixed(1)),
        patentTranslationSignal: Number((patentTranslationSignal * 100).toFixed(1)),
        externalSignal: Number((externalSignal * 100).toFixed(1)),
      },
      exploratory,
      confidenceGate: confidence >= 60,
      externalDataStatus: externalSignals.length ? 'connected' : 'not_connected',
    };
  }

  return { clamp, median, researchMomentum, computeIndicators };
});
