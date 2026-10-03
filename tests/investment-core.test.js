const test = require('node:test');
const assert = require('node:assert/strict');
const {
  regionProvince,
  performerGroup,
  aggregateInvestment,
  summarizeYearCounts,
  buildInvestmentInsights,
  compareInvestment,
  isGenericBusiness,
  keywordMatcher,
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

test('연도별 건수는 기준 연도를 100으로 한 지수로 바꾼다', () => {
  assert.deepEqual(indexSeries([0, 100, 200, null, 50]).values, [null, 100, 200, null, 50]);   // 기준 미지정: 첫 유효 연도
  assert.deepEqual(indexSeries([50, 100, 200], 1).values, [50, 100, 200]);                     // 두 번째 해=100
  assert.equal(indexSeries([0, 0, 0], 1).base, null);
  assert.equal(indexSeries([0, 0, 40], 1).baseIndex, 2);                                       // 기준 연도 값이 0이면 첫 유효 연도로 대체
});

test('초기 건수가 아주 적은 분야가 있어도 공통 기준 연도로 지수가 폭주하지 않는다', () => {
  const tiny = side('신생', [1, 5, 20, 80, 300, 1000, 1200, 1300, 1400, 1500], [rec({})], 5000);
  const big = side('성숙', [800, 850, 900, 950, 1000, 1000, 1000, 1000, 1000, 1000], [rec({})], 5000);
  big.meta.recentFrom = tiny.meta.recentFrom = 2021;
  const cmp = compareInvestment([tiny, big]);
  assert.equal(cmp.baseYear, 2021);
  assert.equal(cmp.index[0].values[5], 100);
  assert.equal(cmp.index[0].values[9], 150);                                                   // 첫 해 기준이었다면 150000
  assert.equal(cmp.index[1].values[0], 80);
});

test('여러 분포는 합집합 항목으로 맞추고 기타·미상은 뺀다', () => {
  const rows = alignShares([
    [{ name: '가', share: 0.6 }, { name: '기타', share: 0.4, isOther: true }],
    [{ name: '나', share: 0.7 }, { name: '가', share: 0.1 }, { name: '미상', share: 0.2 }],
    [{ name: '다', share: 0.5 }],
  ]);
  assert.deepEqual(rows.map(r => [r.name, ...r.values]), [['나', 0, 0.7, 0], ['가', 0.6, 0.1, 0], ['다', 0, 0, 0.5]]);
  assert.equal(Math.round(rows[1].spread * 100), 60);   // 최대 0.6 - 최소 0
});

const sideA = () => side('인공지능', [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000],
  [rec({ gov: 500, ministry: '과학기술정보통신부', performer: '대학' }), rec({ gov: 500, ministry: '산업통상자원부', performer: '중소기업', business: '사업B' })], 8000);
const sideB = () => side('재난안전', [100, 110, 120, 130, 140, 150, 150, 150, 150, 150],
  [rec({ gov: 900, ministry: '행정안전부', performer: '출연연구소', phase: '개발연구', region: '대전광역시' })], 1000);
const sideC = () => side('양자', [10, 20, 40, 80, 160, 320, 400, 500, 600, 700],
  [rec({ gov: 800, ministry: '과학기술정보통신부', performer: '대학', phase: '기초연구' })], 500);

test('두 키워드 비교는 규모 배수·지수·격차 신호를 만든다', () => {
  const cmp = compareInvestment([sideA(), sideB()]);
  assert.equal(cmp.scale.ratio, 8);
  assert.equal(cmp.scale.largest, 0);
  assert.equal(cmp.scale.smallest, 1);
  assert.equal(cmp.index[0].values[0], 100);   // meta.recentFrom 없음 → 첫 유효 연도 기준
  assert.equal(cmp.index[1].values[9], 150);
  assert.equal(cmp.kpis.topMinistry[1], '행정안전부');
  const texts = cmp.signals.map(s => s.text).join(' | ');
  assert.match(texts, /성장 속도: "인공지능"이 가장 빠르고 "재난안전"이 가장 느립니다/);
  assert.match(texts, /주도 부처: "인공지능"은 /);
  assert.equal(cmp.dims.length, 5);
  assert.equal(cmp.dims[0].rows[0].values.length, 2);
});

test('세 키워드 비교는 지표를 3개씩 담고 최고·최저 분야로 신호를 요약한다', () => {
  const cmp = compareInvestment([sideA(), sideB(), sideC()]);
  assert.equal(cmp.queries.length, 3);
  assert.equal(cmp.index.length, 3);
  assert.equal(cmp.kpis.recentTotal.length, 3);
  assert.equal(cmp.scale.ratio, 16);                         // 8000 / 500
  assert.equal(cmp.scale.smallest, 2);
  assert.ok(cmp.dims.every(d => d.rows.length <= 6 && d.rows.every(r => r.values.length === 3)));
  const texts = cmp.signals.map(s => s.text).join(' | ');
  assert.match(texts, /성장 속도: "양자"가 가장 빠르고 "재난안전"이 가장 느립니다/);
  assert.match(texts, /주도 부처: "인공지능"은 .*"재난안전"은 .*"양자"는 /);
});

test('키워드가 2개 미만이면 비교하지 않는다', () => {
  assert.throws(() => compareInvestment([sideA()]));
});

test('범용 사업(기초연구·운영비·창업·국제협력)은 사업명 패턴으로 가려낸다', () => {
  for (const name of ['개인기초연구(과기정통부)(R&D)', '집단연구지원', '한국전기연구원연구운영비지원(운영경비)', '국립환경과학원연구사업', '창업성장기술개발', '산업기술국제협력']) {
    assert.equal(isGenericBusiness(name), true, name);
  }
  for (const name of ['해양공간 디지털트윈 적용 및 활용 기술개발', '스마트제조혁신기술개발', '재난안전취약계층지원']) {
    assert.equal(isGenericBusiness(name), false, name);
  }
});

test('사업명 키워드 일치는 띄어쓰기를 무시하고, 여러 단어면 모두 들어 있어야 한다', () => {
  const m = keywordMatcher('디지털트윈');
  assert.equal(m('디지털 트윈 기반 스마트시티 LAB'), true);
  assert.equal(m('스마트시티 기상기후 융합기술'), false);
  assert.equal(keywordMatcher('재난 안전')('재난안전기술개발'), true);
  assert.equal(keywordMatcher('재난 안전')('재난대응기술'), false);
  assert.equal(keywordMatcher('')('아무 사업'), false);
});

test('주요사업 기본 목록은 키워드 특화 사업, 없으면 범용 사업을 뺀 목록이다', () => {
  const recs = [
    rec({ title: 'A', gov: 900, business: '개인기초연구(과기정통부)' }),
    rec({ title: 'B', gov: 300, business: '디지털 트윈 기반 스마트시티' }),
    rec({ title: 'C', gov: 200, business: '스마트제조혁신기술개발' }),
  ];
  const agg = aggregateInvestment(recs, { query: '디지털트윈' });
  assert.equal(agg.businessFocus, 'specific');
  assert.deepEqual(agg.focusBusinesses.map(b => b.name), ['디지털 트윈 기반 스마트시티']);
  assert.deepEqual(agg.businessCounts, { all: 3, specific: 1, nonGeneric: 2 });
  assert.equal(agg.businesses[0].generic, true);                    // 전체 목록에는 그대로 남는다

  const none = aggregateInvestment(recs, { query: '양자' });
  assert.equal(none.businessFocus, 'nonGeneric');
  assert.deepEqual(none.focusBusinesses.map(b => b.name), ['디지털 트윈 기반 스마트시티', '스마트제조혁신기술개발']);

  // 사업 쏠림 신호는 범용 사업이 아니라 기본 목록 1위로 판단한다
  const texts = buildInvestmentInsights(agg, null).map(i => i.text).join(' | ');
  assert.doesNotMatch(texts, /개인기초연구/);
});
