const test = require('node:test');
const assert = require('node:assert/strict');
const {
  regionProvince,
  performerGroup,
  aggregateInvestment,
  summarizeYearCounts,
  buildInvestmentInsights,
  compareInvestment,
  indexSeries,
  alignShares,
} = require('../js/investment-core.js');

const rec = (over) => ({
  title: '과제', year: 2024, ministry: '과학기술정보통신부', business: '사업A',
  performer: '대학', phase: '기초연구', region: '서울특별시 강남구', gov: 100, priv: 0, total: 100, ...over,
});

test('지역은 시도 단위로, 수행주체는 정책 해석용 묶음으로 정리한다', () => {
  assert.equal(regionProvince('부산광역시 사하구'), '부산');
  assert.equal(regionProvince('전라북도 전주시'), '전북');
  assert.equal(regionProvince('전북특별자치도 전주시'), '전북');
  assert.equal(regionProvince(''), '');
  assert.equal(performerGroup('출연연구소'), '출연(연)·국공립');
  assert.equal(performerGroup('중소기업'), '중소기업');
});

test('정부연구비 비중으로 부처·수행주체·지역 구성을 집계한다', () => {
  const agg = aggregateInvestment([
    rec({ title: 'A', gov: 600, ministry: '과학기술정보통신부', performer: '대학' }),
    rec({ title: 'B', gov: 300, ministry: '해양수산부', performer: '중소기업', region: '부산광역시 사하구', priv: 100, total: 400 }),
    rec({ title: 'C', gov: 100, ministry: '해양수산부', performer: '중견기업', business: '사업B' }),
  ]);
  assert.equal(agg.records, 3);
  assert.equal(agg.gov, 1000);
  assert.equal(agg.byMinistry[0].name, '과학기술정보통신부');
  assert.equal(Math.round(agg.byMinistry[0].share * 100), 60);
  assert.equal(Math.round(agg.companyShare * 100), 40);           // 중소 30% + 중견 10%
  assert.equal(Math.round(agg.capitalShare * 100), 70);           // 서울 600+100
  assert.equal(agg.businesses[0].name, '사업A');
  assert.equal(agg.businesses[0].projects, 2);
  assert.equal(agg.privateRatio, 100 / 600);
});

test('띄어쓰기·(R&D) 꼬리표만 다른 같은 사업은 하나로 합친다', () => {
  const agg = aggregateInvestment([
    rec({ title: 'A', business: '디지털트윈 기반 재난 안전관리 플랫폼 기술개발(R&D)', year: 2021 }),
    rec({ title: 'B', business: '디지털트윈기반재난안전관리플랫폼기술개발', year: 2023 }),
    rec({ title: 'C', business: '디지털트윈기반재난안전관리플랫폼기술개발(과기부,국토부,산업부,행안부)', year: 2024 }),
    rec({ title: 'D', business: '다른 사업' }),
  ]);
  assert.equal(agg.businesses.length, 2);
  assert.equal(agg.businesses[0].variants, 3);
  assert.equal(agg.businesses[0].yearFrom, 2021);
  assert.equal(agg.businesses[0].yearTo, 2024);
  assert.doesNotMatch(agg.businesses[0].name, /\(/);
});

test('연도별 건수는 최근 3년 평균과 직전 3년 평균으로 성장 단계를 판정한다', () => {
  const s = summarizeYearCounts([2019, 2020, 2021, 2022, 2023, 2024], [100, 100, 100, 150, 150, 150]);
  assert.equal(Math.round(s.growth * 100), 50);
  assert.equal(s.phase, '급성장');
  assert.equal(s.peakYear, 2022);
  assert.equal(summarizeYearCounts([2023, 2024], [1, 2]).growth, null);
});

test('규칙 기반 시사점은 부처 집중·기업 참여 저조·단계 편중을 짚는다', () => {
  const agg = aggregateInvestment([
    rec({ title: 'A', gov: 900 }), rec({ title: 'B', gov: 100, ministry: '산업통상자원부' }),
  ]);
  const texts = buildInvestmentInsights(agg, summarizeYearCounts([2019, 2020, 2021, 2022, 2023, 2024], [10, 10, 10, 10, 10, 10])).map(i => i.text).join('\n');
  assert.match(texts, /부처 집중/);
  assert.match(texts, /기업 참여 저조/);
  assert.match(texts, /기초연구가 100%/);
  assert.match(texts, /수도권 집중/);
  assert.match(texts, /정체·성숙/);
});

test('개편으로 이름이 바뀐 부처(산업통상부)는 산업통상자원부로 합산한다', () => {
  const agg = aggregateInvestment([
    rec({ title: 'A', gov: 200, ministry: '산업통상자원부' }),
    rec({ title: 'B', gov: 100, ministry: '산업통상부', business: '사업B' }),
  ]);
  assert.equal(agg.byMinistry.length, 1);
  assert.equal(agg.byMinistry[0].name, '산업통상자원부');
});

const years = [2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const side = (query, counts, recs, recentTotal) => {
  const agg = aggregateInvestment(recs);
  const trend = summarizeYearCounts(years, counts);
  return { query, agg, trend, meta: { recentTotal } };
};

test('연도별 건수는 첫 유효 연도를 100으로 한 지수로 바꾼다', () => {
  assert.deepEqual(indexSeries([0, 100, 200, null, 50]).values, [null, 100, 200, null, 50]);
  assert.equal(indexSeries([0, 0]).base, null);
});

test('두 분포는 합집합 항목으로 맞추고 기타·미상은 뺀다', () => {
  const rows = alignShares(
    [{ name: '가', share: 0.6 }, { name: '기타', share: 0.4, isOther: true }],
    [{ name: '나', share: 0.7 }, { name: '가', share: 0.1 }, { name: '미상', share: 0.2 }],
  );
  assert.deepEqual(rows.map(r => [r.name, r.a, r.b]), [['나', 0, 0.7], ['가', 0.6, 0.1]]);
  assert.equal(Math.round(rows[1].diff * 100), 50);
});

test('두 키워드 비교는 규모 배수·지수·격차 신호를 만든다', () => {
  const a = side('인공지능', [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
    [rec({ gov: 500, ministry: '과학기술정보통신부', performer: '대학' }), rec({ gov: 500, ministry: '산업통상자원부', performer: '중소기업', business: '사업B' })], 8000);
  const b = side('재난안전', [100, 110, 120, 130, 140, 150, 150, 150, 150, 150],
    [rec({ gov: 900, ministry: '행정안전부', performer: '출연연구소', phase: '개발연구', region: '대전광역시' })], 1000);
  const cmp = compareInvestment(a, b);
  assert.equal(cmp.scale.ratio, 8);
  assert.equal(cmp.scale.larger, 'a');
  assert.equal(cmp.index.a.values[0], 100);
  assert.equal(cmp.index.b.values[9], 150);
  assert.equal(cmp.kpis.topMinistry.b, '행정안전부');
  const texts = cmp.signals.map(s => s.text).join(' | ');
  assert.match(texts, /성장 속도: "인공지능"이 /);
  assert.match(texts, /주도 부처: "인공지능"은 /);
  assert.equal(cmp.dims.length, 5);
});
