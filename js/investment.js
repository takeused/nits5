// ============================================================
// 정부 R&D 투자 지형 분석 — NTIS 과제 데이터로 "어디에·얼마를·누구에게" 투자하는지 본다.
// 집계·판정 로직은 js/investment-core.js(InvestmentCore), 여기는 수집과 화면.
//   ① 연도별 과제 건수: 연도 필터(addQuery PY)로 연도마다 조회 → 정확한 전체 건수
//   ② 연도별 정부연구비(최근 6년): 과제가 적으면 전수 합산, 많으면 연도당 표본 평균 × 전체 건수로 추정
//   ③ 투자 구조: 최근 5년 과제 중 관련도 상위 표본(최대 200건)의 부처·사업·수행주체·단계·지역
// ============================================================

const INVEST_YEAR_SPAN = 10;       // 연도별 건수 추이 기간
const INVEST_RECENT_SPAN = 5;      // 투자 구조(표본) 기간
const INVEST_SAMPLE_PAGES = 20;    // NTIS는 페이지당 10건 → 최대 200건
const INVEST_FUND_SPAN = 6;               // 연구비 집계 기간(최근 3년 vs 직전 3년 증감용)
const INVEST_CENSUS_MAX = 8000;           // 연구비 기간 과제가 이 이하면 전부 받아 정확히 합산(약 800회 조회)
const INVEST_CENSUS_CONCURRENCY = 3;
const INVEST_FUND_SAMPLE_PAGES = 10;      // 그보다 많으면 연도당 10페이지(최대 100건) 표본으로 추정
let _investRunSeq = 0;

// NTIS 1회 조회. 429는 지수 백오프로 3회까지 재시도, NTIS 오류 코드는 예외로 올린다.
async function investNtisFetch(proxyBase, params) {
  const url = `${proxyBase}/ntis?${params.toString()}`;
  let resp = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    resp = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (resp.status !== 429) break;
    await new Promise(r => setTimeout(r, 700 * Math.pow(2, attempt) + Math.random() * 300));
  }
  if (!resp.ok) throw new Error(`NTIS HTTP ${resp.status}`);
  const xml = new DOMParser().parseFromString(await resp.text(), 'text/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('NTIS 응답 XML 파싱 실패');
  const gx = tag => xml.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
  const errCode = gx('CODE') || gx('returnCode');
  if (errCode && errCode !== '0') throw new Error(`NTIS 오류 [${errCode}] ${gx('MESSAGE') || gx('returnMsg')}`);
  return { xml, totalHits: parseInt(gx('TOTALHITS'), 10) || 0 };
}

function investParams(query, { addQuery = '', startPosition = 1 } = {}) {
  const params = new URLSearchParams({
    apprvKey: STATE.ntisKey, collection: 'project', SRWR: query, query,
    displayCnt: NTIS_PAGE_SIZE, startPosition, searchRnkn: 'Y', naviCount: 5,
  });
  if (addQuery) params.set('addQuery', addQuery);
  return params;
}

// HIT 1건 → 집계용 평면 레코드. 부처·기관은 <Name> 하위, 수행주체·지역은 code 속성이 붙은 텍스트.
function investParseHit(hit) {
  const child = (parent, tag) => parent ? Array.from(parent.children).find(el => el.tagName === tag) || null : null;
  const text = (el) => String(el?.textContent || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
  const named = (tag) => text(child(child(hit, tag), 'Name')) || text(child(hit, tag));
  return {
    id: text(child(hit, 'ProjectNumber')),
    title: text(child(child(hit, 'ProjectTitle'), 'Korean')) || text(child(hit, 'ProjectTitle')),
    year: parseInt(text(child(hit, 'ProjectYear')), 10) || null,
    ministry: named('Ministry'),
    orderAgency: named('OrderAgency'),
    business: text(child(hit, 'BusinessName')),
    bigProject: text(child(hit, 'BigprojectTitle')),
    performer: text(child(hit, 'PerformAgent')),
    phase: text(child(hit, 'DevelopmentPhases')),
    region: text(child(hit, 'Region')),
    agency: named('ResearchAgency'),
    gov: BudgetCore.parseMoneyValue(text(child(hit, 'GovernmentFunds'))),
    priv: BudgetCore.parseMoneyValue(text(child(hit, 'SbusinessFunds'))),
    total: BudgetCore.parseMoneyValue(text(child(hit, 'TotalFunds'))),
  };
}

function investSetProgress(msg) {
  const el = document.getElementById('investProgress');
  if (el) el.textContent = msg;
}

// 키워드 1개의 투자 지형 데이터를 수집·집계한다. 같은 검색어는 30분간 캐시(비교 분석 재사용).
// isStale()이 true가 되면(새 분석이 시작되면) null을 돌려 중단한다.
const _investCache = new Map();
const INVEST_CACHE_TTL = 30 * 60 * 1000;

// withFunding: 연구비(전수 또는 표본 추정)도 모은다 — 조회가 많아 비교 분석에서만 켠다.
async function collectInvestmentData(proxyBase, query, { isStale = () => false, label = '', withFunding = false } = {}) {
  const cacheKey = query.trim().toLowerCase();
  const cached = _investCache.get(cacheKey);
  if (cached && Date.now() - cached.at < INVEST_CACHE_TTL && (!withFunding || cached.data.funding)) return cached.data;

  const lastYear = new Date().getFullYear() - 1;            // 완결 연도까지만
  const years = Array.from({ length: INVEST_YEAR_SPAN }, (_, i) => lastYear - INVEST_YEAR_SPAN + 1 + i);
  const recentFrom = lastYear - INVEST_RECENT_SPAN + 1;

  // ① 연도별 과제 건수 (정확한 전체 건수)
  let doneYears = 0;
  const counts = await mapWithConcurrency(years, 2, async (y) => {
    try {
      const { totalHits } = await investNtisFetch(proxyBase, investParams(query, { addQuery: `PY=${y}/MORE,${y}/UNDER` }));
      return totalHits;
    } catch { return null; }
    finally { investSetProgress(label + `연도별 과제 건수 집계 중... (${++doneYears}/${years.length})`); }
  });
  if (isStale()) return null;

  // ② 연구비(최근 6년 — 3년 대 3년 증감을 보려고 5년보다 1년 더)
  //    NTIS는 금액 합계를 주지 않고 한 번에 10건만 돌려준다. 그래서 과제가 적으면 전부 받아 정확히 합산(전수)하고,
  //    많으면 연도마다 관련도 순위 전 구간에 고르게 흩어진 페이지로 표본을 뽑아 추정한다.
  const fundYears = years.slice(-INVEST_FUND_SPAN);
  const fundCounts = counts.slice(-INVEST_FUND_SPAN);
  const fundTotal = fundCounts.every(c => c !== null) ? fundCounts.reduce((s, c) => s + c, 0) : null;
  const census = withFunding && fundTotal !== null && fundTotal <= INVEST_CENSUS_MAX;
  const recordKey = r => `${r.id || r.title}|${r.year}|${r.agency}`;   // 레코드 = 과제×연도×수행기관
  let failedPages = 0;
  const records = [];
  let fundSamples = null;

  if (census) {
    const rangeQuery = `PY=${fundYears[0]}/MORE,${lastYear}/UNDER`;
    const starts = Array.from({ length: Math.ceil(fundTotal / NTIS_PAGE_SIZE) }, (_, i) => i * NTIS_PAGE_SIZE + 1);
    let done = 0;
    const xmls = await mapWithConcurrency(starts, INVEST_CENSUS_CONCURRENCY, async (start) => {
      if (isStale()) return null;
      try { return (await investNtisFetch(proxyBase, investParams(query, { addQuery: rangeQuery, startPosition: start }))).xml; }
      catch { failedPages++; return null; }
      finally { investSetProgress(label + `연구비 전수 집계 중... ${(++done * NTIS_PAGE_SIZE).toLocaleString()} / ${fundTotal.toLocaleString()}건`); }
    });
    if (isStale()) return null;
    const seen = new Set();
    const all = [];
    for (const xml of xmls.filter(Boolean)) {
      for (const hit of Array.from(xml.getElementsByTagName('HIT'))) {
        const r = investParseHit(hit);
        if (seen.has(recordKey(r))) continue;
        seen.add(recordKey(r));
        all.push(r);
      }
    }
    // 연도별 전체 레코드의 정부연구비 → summarizeYearFunding이 평균×건수(=합계)로 계산.
    // 일부 페이지가 실패해도 받은 레코드 평균 × 실제 건수로 보정된다.
    fundSamples = fundYears.map(y => all.filter(r => r.year === y).map(r => r.gov).filter(Number.isFinite));
  } else if (withFunding) {
    // 표본: 연도마다 관련도 순위를 10등분한 각 구간의 가운데 페이지(최대 100건). 최상위 페이지는 대형 대표과제가
    // 몰려 평균을 부풀리므로(실측: 인공지능 2025 상위 10건 평균이 중앙값의 4배) 순위 전 구간에서 고르게 뽑는다.
    let done = 0;
    fundSamples = await mapWithConcurrency(fundYears, 2, async (y, i) => {
      const total = fundCounts[i];
      const starts = [...new Set(Array.from({ length: INVEST_FUND_SAMPLE_PAGES },
        (_, k) => Math.floor(total * (k + 0.5) / INVEST_FUND_SAMPLE_PAGES / NTIS_PAGE_SIZE) * NTIS_PAGE_SIZE + 1))];
      const gov = [];
      for (const start of starts) {
        if (isStale()) break;
        try {
          const { xml } = await investNtisFetch(proxyBase, investParams(query, { addQuery: `PY=${y}/MORE,${y}/UNDER`, startPosition: start }));
          gov.push(...Array.from(xml.getElementsByTagName('HIT')).map(h => investParseHit(h).gov).filter(Number.isFinite));
        } catch { /* 표본 페이지 하나가 실패해도 나머지로 추정 */ }
      }
      investSetProgress(label + `연구비 표본 집계 중... (${++done}/${fundYears.length}년)`);
      return gov;
    });
    if (isStale()) return null;
  }

  // ③ 최근 5년 투자 구조 표본(관련도 상위 최대 200건). 연구비가 전수여도 구조는 모든 분야를 같은 기준(관련도 상위)으로
  //    집계해야 비교가 공정하다 — 전수에는 검색어가 느슨하게 걸린 과제까지 섞여 부처 비중이 크게 달라진다.
  {
    const rangeQuery = `PY=${recentFrom}/MORE,${lastYear}/UNDER`;
    const first = await investNtisFetch(proxyBase, investParams(query, { addQuery: rangeQuery }));
    const pageCount = Math.min(INVEST_SAMPLE_PAGES, Math.ceil(first.totalHits / NTIS_PAGE_SIZE));
    let donePages = 1;
    investSetProgress(label + `최근 ${INVEST_RECENT_SPAN}년 과제 표본 수집 중... (1/${Math.max(1, pageCount)}페이지)`);
    const rest = Array.from({ length: Math.max(0, pageCount - 1) }, (_, i) => (i + 1) * NTIS_PAGE_SIZE + 1);
    const restXml = await mapWithConcurrency(rest, 2, async (start) => {
      try {
        return (await investNtisFetch(proxyBase, investParams(query, { addQuery: rangeQuery, startPosition: start }))).xml;
      } catch { failedPages++; return null; }
      finally { investSetProgress(label + `최근 ${INVEST_RECENT_SPAN}년 과제 표본 수집 중... (${++donePages}/${pageCount}페이지)`); }
    });
    if (isStale()) return null;
    const seen = new Set();
    for (const xml of [first.xml, ...restXml.filter(Boolean)]) {
      for (const hit of Array.from(xml.getElementsByTagName('HIT'))) {
        const r = investParseHit(hit);
        const key = r.id || `${r.title}|${r.year}|${r.agency}`;
        if (seen.has(key)) continue;
        seen.add(key);
        records.push(r);
      }
    }
  }

  const recentTotal = counts.slice(-INVEST_RECENT_SPAN).reduce((s, c) => s + (c || 0), 0);
  const agg = InvestmentCore.aggregateInvestment(records, { query });
  const trend = InvestmentCore.summarizeYearCounts(years, counts);
  const funding = withFunding ? {
    ...InvestmentCore.summarizeYearFunding(fundYears, fundCounts, fundSamples, { minSample: census ? 1 : 3 }),
    mode: census ? 'census' : 'sample',
  } : null;
  const insights = InvestmentCore.buildInvestmentInsights(agg, trend);
  const meta = { query, years, recentFrom, lastYear, recentTotal, failedPages, sampleSize: records.length };
  const data = { meta, agg, trend, funding, insights };
  // 일부 연도·페이지 조회가 실패한 결과는 캐시하지 않는다(재시도 시 완전한 결과를 받도록).
  if (trend.complete && !failedPages) _investCache.set(cacheKey, { at: Date.now(), data });
  return data;
}

async function runInvestmentAnalysis() {
  const query = document.getElementById('searchInput').value.trim() || STATE.currentQuery || '';
  if (!query) {
    showToast('분석할 기술 키워드를 입력해주세요', 'warning');
    document.getElementById('searchInput').focus();
    return;
  }
  if (!STATE.ntisKey && !(PROXY_AVAILABLE && STATE.ntisConfigured)) {
    showToast('🔑 NTIS 인증키가 필요합니다. 상단 "API 설정"에서 입력해주세요', 'warning');
    return;
  }
  const proxyBase = getProxyBase() || VERCEL_BASE || '';
  if (!proxyBase) {
    showToast('프록시 서버가 연결되어 있지 않습니다. 서버를 실행한 뒤 다시 시도해주세요.', 'warning');
    return;
  }

  const runSeq = ++_investRunSeq;
  const lastYear = new Date().getFullYear() - 1;            // 완결 연도까지만
  const years = Array.from({ length: INVEST_YEAR_SPAN }, (_, i) => lastYear - INVEST_YEAR_SPAN + 1 + i);
  const recentFrom = lastYear - INVEST_RECENT_SPAN + 1;

  document.body.classList.add('search-mode');
  hideAll();
  const section = document.getElementById('analysisSection');
  section.classList.remove('hidden');
  section.innerHTML = `
    <div class="analysis-card trend-analysis-card fade-up">
      <div class="analysis-header flex items-center gap-3">
        <iconify-icon icon="solar:pie-chart-2-bold-duotone" width="20"></iconify-icon>
        <div>
          <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">정부 R&amp;D 투자 지형 분석 — NTIS 국가R&amp;D 과제</p>
          <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(query)}"</p>
        </div>
      </div>
      <div class="analysis-body trend-analysis-loading">
        <div class="spinner"></div>
        <p id="investProgress" style="color:#6b7280;font-size:13px;margin-top:12px;">연도별 과제 건수 집계 준비 중...</p>
      </div>
    </div>`;

  try {
    const d = await collectInvestmentData(proxyBase, query, { isStale: () => runSeq !== _investRunSeq });
    if (!d) return;
    renderInvestmentDashboard(d.meta, d.agg, d.trend, d.insights);
    generateInvestmentAISummary(runSeq, d.meta, d.agg, d.trend, d.insights);
  } catch (err) {
    if (runSeq !== _investRunSeq) return;
    console.error('[Investment]', err);
    section.innerHTML = `<div class="analysis-card trend-analysis-card trend-analysis-error fade-up">투자 지형 분석 중 오류가 발생했습니다: ${escHtml(err.message)}</div>`;
  }
}

// ── 화면 ──────────────────────────────────────────────────────────
const INVEST_TONE = {
  up: { icon: '📈', color: '#15803d' }, down: { icon: '📉', color: '#b91c1c' },
  flat: { icon: '➖', color: '#475467' }, warn: { icon: '⚠️', color: '#b45309' },
  gap: { icon: '🧩', color: '#1d4ed8' }, info: { icon: 'ℹ️', color: '#344054' },
};

function investSharePanel(title, allRows, { note = '' } = {}) {
  // 반올림 0%인 항목은 막대가 의미 없어 숨긴다(합계·비중 계산에는 그대로 포함)
  const rows = allRows.filter(r => Math.round(r.share * 100) > 0);
  const body = rows.length
    ? rows.map(r => `
        <div style="display:grid;grid-template-columns:minmax(0,1fr) 64px 38px;gap:8px;align-items:center;font-size:12px;margin-bottom:6px;">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:${r.isOther || r.name === '미상' ? '#98a2b3' : '#1d2939'};" title="${escAttr(r.name)} · 표본 ${r.count}건">${escHtml(r.name)}</span>
          <span style="height:8px;background:#eef2f6;border-radius:4px;overflow:hidden;display:block;">
            <span style="display:block;height:100%;width:${Math.max(2, Math.round(r.share * 100))}%;background:${r.isOther || r.name === '미상' ? '#cbd5e1' : '#475467'};"></span>
          </span>
          <span style="text-align:right;font-weight:700;color:#1d2939;">${Math.round(r.share * 100)}%</span>
        </div>`).join('')
    : '<div style="font-size:12px;color:#98a2b3;">데이터 없음</div>';
  return `
    <div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px 16px;min-width:0;">
      <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:10px;">${title}</div>
      ${body}
      ${note ? `<div style="font-size:10.5px;color:#98a2b3;margin-top:6px;">${note}</div>` : ''}
    </div>`;
}

function investKpi(label, value, sub) {
  return `
    <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 16px;flex:1;min-width:150px;">
      <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:4px;">${label}</div>
      <div style="font-size:17px;font-weight:800;color:#273444;line-height:1.3;">${value}</div>
      ${sub ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">${sub}</div>` : ''}
    </div>`;
}

// ── 주요 기존 사업 표 (필터: 키워드 특화 / 범용 제외 / 전체) ─────────────────
// 표본 과제는 관련도 상위라 제목에는 모두 키워드가 들어 있지만, 그 과제를 담은 사업은
// 개인기초연구·출연연 운영비처럼 주제와 무관한 범용 사업일 수 있다. 유사·중복 검토에는
// 사업명에 키워드가 들어간 "키워드 특화" 사업이 기본이다.
let _investBizState = null;

function setInvestBizFilter(mode) {
  if (!_investBizState) return;
  _investBizState.mode = mode;
  renderInvestBusinessTable();
}

function renderInvestBusinessTable() {
  const box = document.getElementById('investBizTable');
  const bar = document.getElementById('investBizFilter');
  const note = document.getElementById('investBizNote');
  if (!box || !_investBizState) return;
  const { agg, mode } = _investBizState;
  const lists = {
    specific: agg.businesses.filter(b => b.keywordInName),
    nonGeneric: agg.businesses.filter(b => !b.generic),
    all: agg.businesses,
  };
  const labels = { specific: '키워드 특화', nonGeneric: '범용 사업 제외', all: '전체' };
  if (bar) {
    bar.innerHTML = Object.keys(labels).map((key, i) => {
      const active = key === mode;
      const empty = !lists[key].length;
      return `<button type="button" ${empty ? 'disabled' : ''} onclick="setInvestBizFilter('${key}')" style="padding:4px 10px;font-size:11px;font-weight:700;border:0;${i ? 'border-left:1px solid #d0d5dd;' : ''}cursor:${empty ? 'not-allowed' : 'pointer'};${active ? 'background:#344054;color:#fff;' : `background:#fff;color:${empty ? '#cbd5e1' : '#475467'};`}">${labels[key]} ${lists[key].length}</button>`;
    }).join('');
  }
  if (note) {
    const base = '표본 과제 기준 정부연구비 순. 과제 수는 과제명 기준 고유 과제. 비중은 표본 전체 정부연구비 대비.';
    const noSpecific = agg.businessCounts && !agg.businessCounts.specific;
    note.textContent = mode === 'specific'
      ? `사업명에 검색어가 들어간 주제 특화 사업만 표시합니다. ${base}`
      : mode === 'nonGeneric'
        ? `개인·집단 기초연구, 출연연 운영비, 창업·국제협력 지원처럼 주제와 무관한 범용 사업을 뺐습니다(사업명 기준 자동 분류라 완전하지 않음). ${noSpecific ? '사업명에 검색어가 들어간 사업이 없어 이 보기가 기본입니다. ' : ''}${base}`
        : `범용 사업을 포함한 전체 목록입니다. ${base}`;
  }
  const rows = lists[mode] || lists.all;
  if (!rows.length) {
    box.innerHTML = '<div style="font-size:12px;color:#98a2b3;">해당하는 사업이 없습니다.</div>';
    return;
  }
  const badge = (text, color, bg, border, title) => ` <span title="${title}" style="font-size:10px;font-weight:500;color:${color};background:${bg};border:1px solid ${border};border-radius:3px;padding:0 4px;white-space:nowrap;">${text}</span>`;
  const body = rows.slice(0, 10).map((b, i) => `
    <tr style="border-top:1px solid #f2f4f7;">
      <td style="padding:7px 8px;color:#98a2b3;font-size:11px;">${i + 1}</td>
      <td style="padding:7px 8px;font-size:12px;color:${b.generic ? '#667085' : '#1d2939'};font-weight:600;max-width:320px;">${escHtml(b.name)}${b.keywordInName ? badge('키워드 특화', '#1d4ed8', '#eff6ff', '#bfdbfe', '사업명에 검색어가 들어간 주제 특화 사업') : ''}${b.generic ? badge('범용', '#667085', '#f2f4f7', '#d0d5dd', '주제와 무관하게 여러 분야 과제를 담는 범용 사업(사업명 기준 자동 분류)') : ''}${b.variants > 1 ? badge(`표기 ${b.variants}종 통합`, '#7c3aed', '#f5f3ff', '#ddd6fe', `띄어쓰기·(R&amp;D) 등 표기가 다른 같은 사업 ${b.variants}가지를 하나로 합침`) : ''}</td>
      <td style="padding:7px 8px;font-size:11.5px;color:#475467;white-space:nowrap;">${escHtml(b.ministry || '-')}</td>
      <td style="padding:7px 8px;font-size:11.5px;color:#475467;white-space:nowrap;text-align:right;">${b.projects}건</td>
      <td style="padding:7px 8px;font-size:11.5px;color:#1d2939;white-space:nowrap;text-align:right;font-weight:700;">${fmtBudget(b.gov)}</td>
      <td style="padding:7px 8px;font-size:11.5px;color:#475467;white-space:nowrap;text-align:right;">${Math.round(b.share * 100)}%</td>
      <td style="padding:7px 8px;font-size:11px;color:#98a2b3;white-space:nowrap;">${b.yearFrom ? (b.yearFrom === b.yearTo ? b.yearFrom : `${b.yearFrom}~${b.yearTo}`) : '-'}</td>
    </tr>`).join('');
  box.innerHTML = `<table style="width:100%;border-collapse:collapse;min-width:620px;">
    <thead><tr style="font-size:10.5px;color:#98a2b3;text-align:left;">
      <th style="padding:4px 8px;">#</th><th style="padding:4px 8px;">사업명</th><th style="padding:4px 8px;">부처</th>
      <th style="padding:4px 8px;text-align:right;">과제</th><th style="padding:4px 8px;text-align:right;">정부연구비(표본)</th>
      <th style="padding:4px 8px;text-align:right;">비중</th><th style="padding:4px 8px;">연도</th>
    </tr></thead><tbody>${body}</tbody></table>${rows.length > 10 ? `<div style="font-size:10.5px;color:#98a2b3;margin-top:6px;">상위 10개 표시 (전체 ${rows.length}개)</div>` : ''}`;
}

function renderInvestmentDashboard(meta, agg, trend, insights) {
  const { query, years, recentFrom, lastYear, recentTotal, sampleSize, failedPages } = meta;
  const coverage = recentTotal > 0 ? Math.min(1, sampleSize / recentTotal) : 0;
  const pctText = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
  const topMinistry = agg.byMinistry.find(r => !r.isOther && r.name !== '미상');
  const growthText = trend.growth === null ? '—' : `${trend.growth >= 0 ? '+' : ''}${Math.round(trend.growth * 100)}%`;
  const sampleNote = `표본: ${recentFrom}~${lastYear}년 과제 중 관련도 상위 ${sampleSize.toLocaleString()}건 (전체 ${recentTotal.toLocaleString()}건의 ${Math.round(coverage * 100)}%) · 정부연구비 비중 기준`;

  const section = document.getElementById('analysisSection');
  section.innerHTML = `
    <div id="investDashboard" class="analysis-card trend-analysis-card fade-up">
      <div class="analysis-header flex items-center justify-between">
        <div class="flex items-center gap-3">
          <iconify-icon icon="solar:pie-chart-2-bold-duotone" width="20"></iconify-icon>
          <div>
            <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">정부 R&amp;D 투자 지형 분석 — 과제 건수 ${years[0]}~${years[years.length - 1]} · 투자 구조 ${recentFrom}~${lastYear}</p>
            <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(query)}"</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('analysisSection').classList.add('hidden')" class="text-white/60 hover:text-white transition-colors" aria-label="닫기">
          <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
        </button>
      </div>
      <div class="analysis-body trend-analysis-body">
        <div class="trend-kpi-grid">
          ${investKpi(`최근 ${INVEST_RECENT_SPAN}년 과제`, `${recentTotal.toLocaleString()}건`, `${recentFrom}~${lastYear} · 연차·기관 단위 전체 건수`)}
          ${investKpi('과제 건수 추세', `${escHtml(trend.phase)} ${growthText}`, '최근 3년 평균 vs 직전 3년 평균')}
          ${investKpi('주도 부처', topMinistry ? escHtml(topMinistry.name) : '—', topMinistry ? `정부연구비 ${pctText(topMinistry.share)} · HHI ${agg.ministryHHI}` : '')}
          ${investKpi('기업 수행 비중', pctText(agg.companyShare), `대학 ${pctText(agg.universityShare)} · 민간부담 ${pctText(agg.privateRatio)}`)}
        </div>

        <div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:16px;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:10px;">연도별 과제 건수 (NTIS 전체 건수, 연차·기관 단위)${trend.complete ? '' : ' · 일부 연도 조회 실패'}</div>
          <div style="position:relative;height:220px;"><canvas id="investYearChart"></canvas></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px;margin-bottom:14px;">
          ${investSharePanel('부처별 정부연구비', agg.byMinistry)}
          ${investSharePanel('전문기관별', agg.byOrderAgency)}
          ${investSharePanel('수행주체별', agg.byPerformer)}
          ${investSharePanel('연구개발단계별', agg.byPhase)}
          ${investSharePanel('지역별 (시도)', agg.byRegion, { note: `수도권(서울·경기·인천) ${pctText(agg.capitalShare)}` })}
        </div>

        <div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px 16px;margin-bottom:14px;overflow-x:auto;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px;">
            <div style="font-size:12px;font-weight:700;color:#344054;">주요 기존 사업 (내역사업) — 신규사업 유사·중복 검토용</div>
            <div id="investBizFilter" role="group" aria-label="사업 필터" style="display:inline-flex;border:1px solid #d0d5dd;border-radius:8px;overflow:hidden;"></div>
          </div>
          <div id="investBizNote" style="font-size:10.5px;color:#98a2b3;margin-bottom:8px;"></div>
          <div id="investBizTable"></div>
        </div>

        <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px;">🔍 데이터 기반 신호 <span style="font-weight:500;color:#64748b;">(판단 보조용 탐색 신호)</span></div>
          <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;">
            ${insights.length ? insights.map(s => `<li style="font-size:12px;color:#1e3a5f;line-height:1.6;">${INVEST_TONE[s.tone]?.icon || '•'} ${escHtml(s.text)}</li>`).join('')
              : '<li style="font-size:12px;color:#64748b;">특이 신호가 감지되지 않았습니다.</li>'}
          </ul>
        </div>

        <div id="investAIBox" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:14px;${hasAIAccess() ? '' : 'display:none;'}">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px;">🤖 정책·신규사업 기획 시사점 (AI 요약)</div>
          <div id="investAIBody" style="font-size:12px;color:#475467;">위 수치를 바탕으로 시사점을 작성하는 중...</div>
        </div>

        <div style="font-size:11px;color:#98a2b3;margin-bottom:10px;">${escHtml(sampleNote)}${failedPages ? ` · 수집 실패 ${failedPages}페이지 제외` : ''}</div>

        <details style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;">
          <summary style="font-size:12px;font-weight:700;color:#475569;cursor:pointer;list-style:none;">📐 투자 지형 분석은 이렇게 산출됩니다</summary>
          <div style="margin-top:12px;font-size:12px;color:#475569;line-height:1.75;">
            <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;">
              <li><strong>연도별 과제 건수</strong> — NTIS 과제검색에 연도 필터(PY)를 걸어 연도마다 <strong>전체 건수</strong>를 조회합니다(표본 아님). NTIS는 과제를 <strong>연차·수행기관 단위 레코드</strong>로 집계하므로, 다년·공동 과제는 여러 건으로 셉니다.</li>
              <li><strong>투자 구조 표본</strong> — 최근 ${INVEST_RECENT_SPAN}년(${recentFrom}~${lastYear}) 과제 중 검색 관련도 상위 최대 ${INVEST_SAMPLE_PAGES * NTIS_PAGE_SIZE}건을 가져옵니다(NTIS가 페이지당 10건만 제공). 부처·전문기관·수행주체·단계·지역은 이 표본의 <strong>정부연구비 비중</strong>입니다.</li>
              <li><strong>합산 방식</strong> — 레코드마다 정부연구비는 "그 기관의 그 연도 금액"이라 단순 합산해도 이중 계산이 없습니다. 정부연구비가 비어 있는 경우 건수 비중으로 대체합니다.</li>
              <li><strong>주요 기존 사업</strong> — 내역사업명(BusinessName) 기준으로 묶은 표본 정부연구비 순위입니다. 기본 보기는 사업명에 검색어가 들어간 <strong>키워드 특화 사업</strong>이며(없으면 범용 사업 제외), 개인·집단 기초연구·출연연 운영비 같은 <strong>범용 사업</strong>은 사업명 패턴으로 자동 분류해 필터로 숨기거나 볼 수 있습니다. 신규사업 기획 시 유사·중복 검토의 출발점으로 쓰세요.</li>
              <li><strong>데이터 기반 신호</strong> — 부처 1위 60% 이상(집중), 기업 수행 20% 미만(사업화 공백), 기초 50% 이상·개발 60% 이상(단계 편중), 민간부담 10% 미만, 수도권 60% 이상, 단일 사업 30% 이상 등 <strong>고정 기준</strong>으로 판정합니다. 정책 판단은 원자료와 함께 검토하세요.</li>
            </ol>
            <p style="margin:12px 0 0 0;font-size:11px;color:#94a3b8;">※ 표본은 검색 관련도 순이라 대형·핵심 과제 위주로 잡히며, 전수 통계와 차이가 있을 수 있습니다. 검색어가 넓을수록 무관 과제가 섞일 수 있습니다.</p>
          </div>
        </details>
      </div>
    </div>`;

  _investBizState = { agg, mode: agg.businessFocus || 'all' };
  renderInvestBusinessTable();

  requestAnimationFrame(() => {
    const ctx = document.getElementById('investYearChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (window._investChartInstance) window._investChartInstance.destroy();
    const peak = trend.peakYear;
    window._investChartInstance = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: years.map(String),
        datasets: [{
          label: '과제 건수',
          data: trend.counts.map(v => (v === null ? 0 : v)),
          backgroundColor: years.map(y => (y === peak ? '#344054' : y >= recentFrom ? '#667085' : '#cbd5e1')),
          borderRadius: 4,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: c => `${Number(c.raw).toLocaleString()}건${trend.counts[c.dataIndex] === null ? ' (조회 실패)' : ''}` } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#667085' } },
          y: { beginAtZero: true, grid: { color: 'rgba(52,64,84,0.08)' }, ticks: { color: '#667085' } },
        },
      },
    });
  });
}

// ── AI 시사점 (선택) ────────────────────────────────────────────
async function generateInvestmentAISummary(runSeq, meta, agg, trend, insights) {
  const body = document.getElementById('investAIBody');
  if (!body || !hasAIAccess()) return;
  const share = rows => rows.filter(r => !r.isOther).slice(0, 5).map(r => `${r.name} ${Math.round(r.share * 100)}%`).join(', ');
  const facts = {
    기술: meta.query,
    연도별과제건수: Object.fromEntries(meta.years.map((y, i) => [y, trend.counts[i]])),
    추세: `${trend.phase}${trend.growth !== null ? ` (최근3년 vs 직전3년 ${Math.round(trend.growth * 100)}%)` : ''}`,
    표본: `${meta.recentFrom}~${meta.lastYear}년 상위 ${meta.sampleSize}건 / 전체 ${meta.recentTotal}건`,
    부처: share(agg.byMinistry),
    전문기관: share(agg.byOrderAgency),
    수행주체: share(agg.byPerformer),
    연구단계: share(agg.byPhase),
    지역: share(agg.byRegion),
    민간부담비율: agg.privateRatio === null ? '미상' : `${Math.round(agg.privateRatio * 100)}%`,
    주요사업: (agg.focusBusinesses || agg.businesses).slice(0, 6).map(b => `${b.name}(${b.ministry}, ${Math.round(b.share * 100)}%, ${b.yearFrom || ''}~${b.yearTo || ''})`),
    주요사업기준: agg.businessFocus === 'specific' ? '사업명에 기술 키워드가 들어간 주제 특화 사업' : '범용 사업(기초연구·기관운영비 등) 제외',
    규칙기반신호: insights.map(i => i.text),
  };
  try {
    const resp = await cerebrasChat({
      model: getActiveCerebrasModel(),
      messages: [
        { role: 'system', content: '당신은 한국 국가R&D 정책 기획 전문가입니다. 주어진 수치만 근거로 쓰고, 수치에 없는 사실은 추측하지 않습니다. 한국어로 답합니다.' },
        { role: 'user', content: `아래는 "${meta.query}" 분야 NTIS 국가R&D 과제 집계입니다.\n${JSON.stringify(facts)}\n\nR&D 정책 수립·신규사업 기획 담당자에게 줄 시사점 4개를 작성하세요. 투자 공백, 중복 위험(기존 주요 사업과 겹칠 부분), 신규사업 기회, 추가로 확인할 점을 다루세요. 각 항목은 "- "로 시작하는 1~2문장이며, 근거 수치를 괄호로 인용하세요. 주요사업의 연도 범위는 같은 사업의 다년 계속 지원이므로 그 자체를 중복으로 보지 마세요(중복 위험은 서로 다른 사업·부처가 같은 대상을 다룰 때입니다). 목록 외 다른 문장은 쓰지 마세요.` },
      ],
      temperature: 0.3,
      reasoning_effort: 'low',
      max_tokens: 2000,
    }, 45000);
    if (runSeq !== _investRunSeq) return;
    if (!resp.ok) throw new Error(`AI ${resp.status}`);
    const data = await resp.json();
    const raw = String(data?.choices?.[0]?.message?.content || '').trim();
    const lines = raw.split(/\r?\n/).map(l => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim()).filter(Boolean);
    if (!lines.length) throw new Error('빈 응답');
    body.innerHTML = `<ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:6px;">
      ${lines.slice(0, 6).map(l => `<li style="line-height:1.6;color:#344054;">• ${escHtml(l.replace(/\*\*/g, ''))}</li>`).join('')}
    </ul>
    <div style="font-size:10.5px;color:#98a2b3;margin-top:8px;">AI가 위 집계 수치로 작성한 초안입니다. 정책 문서에 쓰기 전 원자료로 확인하세요.</div>`;
  } catch (err) {
    if (runSeq !== _investRunSeq) return;
    body.textContent = err.message === 'GEMINI_CONSENT_DECLINED'
      ? 'Gemini 사용을 승인하지 않아 AI 요약을 생략했습니다. 위 데이터 기반 신호를 참고하세요.'
      : `AI 요약을 만들지 못했습니다 (${err.message}). 위 데이터 기반 신호를 참고하세요.`;
  }
}
