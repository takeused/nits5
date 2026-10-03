(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.InvestmentCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ── 정부 R&D 투자 지형 분석 — 집계·판정 로직 (DOM 비의존, 테스트 가능) ──
  // 입력 레코드는 NTIS 과제검색 HIT 1건 = "수행기관 × 연도" 1건이다(실측).
  // 따라서 정부연구비를 레코드 단위로 합산해도 이중합산이 아니다.

  const positive = value => {
    const n = Number(value);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };

  // 2025년 조직개편으로 이름이 바뀐 부처는 한 부처로 합산한다(표기만 다른 같은 부처가 둘로 갈리는 것 방지).
  const MINISTRY_ALIASES = { '산업통상부': '산업통상자원부' };
  const normMinistry = name => MINISTRY_ALIASES[name] || name;

  // "부산광역시 사하구" → "부산". 시도 단위로 묶어 지역 분포를 본다.
  const PROVINCES = [
    ['서울', /^서울/], ['부산', /^부산/], ['대구', /^대구/], ['인천', /^인천/],
    ['광주', /^광주/], ['대전', /^대전/], ['울산', /^울산/], ['세종', /^세종/],
    ['경기', /^경기/], ['강원', /^강원/], ['충북', /^(충청북|충북)/], ['충남', /^(충청남|충남)/],
    ['전북', /^(전라북|전북)/], ['전남', /^(전라남|전남)/], ['경북', /^(경상북|경북)/],
    ['경남', /^(경상남|경남)/], ['제주', /^제주/],
  ];
  const CAPITAL_AREA = new Set(['서울', '경기', '인천']);

  function regionProvince(text) {
    const value = String(text || '').trim();
    if (!value) return '';
    for (const [name, pattern] of PROVINCES) if (pattern.test(value)) return name;
    return '기타';
  }

  // 수행주체를 정책 해석용 묶음으로 정리 (원 분류는 그대로 보존하고 묶음만 추가)
  function performerGroup(text) {
    const value = String(text || '');
    if (/대학/.test(value)) return '대학';
    if (/출연|국공립|연구소|연구원/.test(value)) return '출연(연)·국공립';
    if (/중소/.test(value)) return '중소기업';
    if (/중견/.test(value)) return '중견기업';
    if (/대기업/.test(value)) return '대기업';
    if (/기업/.test(value)) return '기타 기업';
    return value ? '기타' : '';
  }
  const isCompanyGroup = group => /기업/.test(group);

  function phaseGroup(text) {
    const value = String(text || '');
    if (/기초/.test(value)) return '기초연구';
    if (/응용/.test(value)) return '응용연구';
    if (/개발/.test(value)) return '개발연구';
    return value ? '기타' : '';
  }

  const normTitle = s => String(s || '').replace(/<[^>]*>/g, '').toLowerCase().replace(/[\s()[\]{}·,./_+-]/g, '');

  // 사업명 정규화 키: 괄호 꼬리표((R&D), (다부처R&D), (과기부,국토부…))와 공백·구분기호를 제거
  const businessKey = s => String(s || '').toLowerCase().replace(/\([^)]*\)/g, '').replace(/[\s·,./_+&-]/g, '');

  // 표시용 사업명: 괄호 꼬리표를 뗀 이름 중 가장 많이 등장한 것, 같으면 띄어쓰기가 있는(읽기 쉬운) 것
  function displayBusinessName(names) {
    const variants = [...names.entries()].map(([name, count]) => ({ name: name.replace(/\s*\([^)]*\)\s*$/g, '').trim() || name, count }));
    variants.sort((a, b) => b.count - a.count || (b.name.split(' ').length - a.name.split(' ').length));
    return variants[0].name;
  }

  // 키별로 정부연구비 합계·레코드 수를 모아 정부연구비 비중 내림차순으로 정렬한다.
  function groupBy(records, keyOf, { top = 8, unknownLabel = '미상' } = {}) {
    const map = new Map();
    let govTotal = 0;
    for (const r of records) {
      const key = keyOf(r) || unknownLabel;
      const gov = positive(r.gov);
      govTotal += gov;
      if (!map.has(key)) map.set(key, { name: key, gov: 0, count: 0 });
      const g = map.get(key);
      g.gov += gov;
      g.count += 1;
    }
    const n = records.length || 1;
    const rows = [...map.values()]
      .map(g => ({ ...g, share: govTotal > 0 ? g.gov / govTotal : g.count / n, countShare: g.count / n }))
      .sort((a, b) => b.share - a.share || b.count - a.count);
    if (rows.length <= top) return rows;
    const head = rows.slice(0, top);
    const rest = rows.slice(top);
    head.push(rest.reduce((acc, g) => ({
      name: `그 외 ${rest.length}곳`, gov: acc.gov + g.gov, count: acc.count + g.count,
      share: acc.share + g.share, countShare: acc.countShare + g.countShare, isOther: true,
    }), { gov: 0, count: 0, share: 0, countShare: 0 }));
    return head;
  }

  // 허핀달-허쉬만 지수(0~10000). 2500 이상이면 고집중으로 본다.
  const hhi = rows => Math.round(rows.filter(r => !r.isOther).reduce((s, r) => s + (r.share * 100) ** 2, 0));

  function aggregateInvestment(records = []) {
    const list = (Array.isArray(records) ? records : []).filter(Boolean);
    const gov = list.reduce((s, r) => s + positive(r.gov), 0);
    const priv = list.reduce((s, r) => s + positive(r.priv), 0);
    const total = list.reduce((s, r) => s + (positive(r.total) || positive(r.gov) + positive(r.priv)), 0);

    // 주요 사업: 내역사업명 기준. 부처·연도 범위·고유 과제 수를 함께 보여 유사·중복 검토에 쓴다.
    // 같은 사업이 연도별로 띄어쓰기·"(R&D)"·"(다부처R&D)"·"(과기부,국토부…)" 꼬리표만 달리 등록되므로
    // 정규화 키로 묶는다(안 묶으면 한 사업의 연차가 "중복 사업"처럼 보인다).
    const businessMap = new Map();
    for (const r of list) {
      const name = String(r.business || r.bigProject || '').trim();
      if (!name) continue;
      const key = businessKey(name);
      if (!businessMap.has(key)) businessMap.set(key, { names: new Map(), gov: 0, count: 0, ministries: new Map(), years: [], titles: new Set() });
      const b = businessMap.get(key);
      b.names.set(name, (b.names.get(name) || 0) + 1);
      b.gov += positive(r.gov);
      b.count += 1;
      if (r.ministry) { const m = normMinistry(r.ministry); b.ministries.set(m, (b.ministries.get(m) || 0) + 1); }
      if (Number(r.year)) b.years.push(Number(r.year));
      if (r.title) b.titles.add(normTitle(r.title));
    }
    const businesses = [...businessMap.values()].map(b => ({
      name: displayBusinessName(b.names),
      variants: b.names.size,
      gov: b.gov,
      count: b.count,
      projects: b.titles.size || b.count,
      ministry: [...b.ministries.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '',
      yearFrom: b.years.length ? Math.min(...b.years) : null,
      yearTo: b.years.length ? Math.max(...b.years) : null,
      share: gov > 0 ? b.gov / gov : 0,
    })).sort((a, b) => b.gov - a.gov || b.count - a.count);

    const byMinistry = groupBy(list, r => normMinistry(r.ministry), { top: 6 });
    const byPerformer = groupBy(list, r => performerGroup(r.performer), { top: 7 });
    const byPhase = groupBy(list, r => phaseGroup(r.phase), { top: 6 });
    const byRegion = groupBy(list, r => regionProvince(r.region), { top: 8 });
    const byOrderAgency = groupBy(list, r => r.orderAgency, { top: 6 });

    const shareOf = (rows, predicate) => rows.filter(r => !r.isOther && predicate(r.name)).reduce((s, r) => s + r.share, 0);
    const years = list.map(r => Number(r.year)).filter(Boolean);

    return {
      records: list.length,
      projects: new Set(list.map(r => normTitle(r.title)).filter(Boolean)).size,
      gov, priv, total,
      privateRatio: total > 0 ? priv / total : null,
      yearFrom: years.length ? Math.min(...years) : null,
      yearTo: years.length ? Math.max(...years) : null,
      byMinistry, byOrderAgency, byPerformer, byPhase, byRegion,
      businesses,
      ministryHHI: hhi(byMinistry),
      companyShare: shareOf(byPerformer, isCompanyGroup),
      universityShare: shareOf(byPerformer, name => name === '대학'),
      capitalShare: shareOf(byRegion, name => CAPITAL_AREA.has(name)),
      phaseShares: Object.fromEntries(byPhase.map(r => [r.name, r.share])),
    };
  }

  // 연도별 과제 건수(정확한 전체 건수) 요약. 최근 3년 평균 vs 직전 3년 평균.
  function summarizeYearCounts(years = [], counts = []) {
    const values = counts.map(c => (Number.isFinite(Number(c)) && Number(c) >= 0 ? Number(c) : null));
    const known = values.filter(v => v !== null);
    const sum = arr => arr.reduce((s, v) => s + (v || 0), 0);
    const recent = values.slice(-3);
    const prev = values.slice(-6, -3);
    const okWindow = recent.every(v => v !== null) && prev.length === 3 && prev.every(v => v !== null);
    const recentAvg = okWindow ? sum(recent) / 3 : null;
    const prevAvg = okWindow ? sum(prev) / 3 : null;
    const growth = okWindow && prevAvg > 0 ? (recentAvg - prevAvg) / prevAvg : null;
    let peakIndex = -1;
    values.forEach((v, i) => { if (v !== null && (peakIndex < 0 || v > values[peakIndex])) peakIndex = i; });
    const phase = growth === null ? '판정 불가'
      : growth > 0.3 ? '급성장' : growth > 0.1 ? '성장' : growth >= -0.1 ? '정체·성숙' : '감소';
    return {
      years, counts: values, total: sum(known), recentAvg, prevAvg, growth, phase,
      peakYear: peakIndex >= 0 ? years[peakIndex] : null,
      complete: known.length === values.length,
    };
  }

  const pct = v => `${Math.round(v * 100)}%`;

  // 수치에 근거한 규칙 기반 시사점. 임계값은 판단 보조용 "탐색 신호"이며 화면에 그렇게 표기한다.
  function buildInvestmentInsights(agg, trend) {
    const out = [];
    if (trend && trend.growth !== null) {
      const dir = trend.growth >= 0 ? '증가' : '감소';
      out.push({ tone: trend.growth > 0.1 ? 'up' : trend.growth < -0.1 ? 'down' : 'flat',
        text: `과제 건수: 최근 3년 평균이 직전 3년 대비 ${Math.abs(Math.round(trend.growth * 100))}% ${dir} (${trend.phase}).${trend.peakYear ? ` 정점 ${trend.peakYear}년.` : ''}` });
    }
    if (!agg || !agg.records) return out;

    const topMinistry = agg.byMinistry.find(r => !r.isOther && r.name !== '미상');
    if (topMinistry) {
      if (topMinistry.share >= 0.6) {
        out.push({ tone: 'warn', text: `부처 집중: ${topMinistry.name}가 정부연구비의 ${pct(topMinistry.share)}를 차지(HHI ${agg.ministryHHI}). 단일 부처 주도 분야로, 타 부처 수요(실증·규제·현장 적용)와의 연계 사업 여지가 있습니다.` });
      } else {
        const ministries = agg.byMinistry.filter(r => !r.isOther && r.name !== '미상' && r.share >= 0.1).length;
        out.push({ tone: 'info', text: `부처 분산: 정부연구비 10% 이상 부처가 ${ministries}곳(1위 ${topMinistry.name} ${pct(topMinistry.share)}). 신규사업은 부처 간 역할 분담과 중복 조정이 핵심입니다.` });
      }
    }
    if (agg.companyShare < 0.2) {
      out.push({ tone: 'gap', text: `기업 참여 저조: 기업 수행 비중이 ${pct(agg.companyShare)}에 그칩니다. 실증·사업화·기술이전형 사업의 공백 신호입니다.` });
    } else if (agg.companyShare >= 0.5) {
      out.push({ tone: 'info', text: `기업 주도: 기업 수행 비중 ${pct(agg.companyShare)}. 원천·기초 역량 보강(대학·출연연) 여지를 함께 검토하세요.` });
    }
    const basic = agg.phaseShares['기초연구'] || 0;
    const dev = agg.phaseShares['개발연구'] || 0;
    if (basic >= 0.5) {
      out.push({ tone: 'gap', text: `단계 편중: 기초연구가 ${pct(basic)}. 응용·개발 단계로 잇는 후속 사업 수요가 있을 수 있습니다.` });
    } else if (dev >= 0.6) {
      out.push({ tone: 'gap', text: `단계 편중: 개발연구가 ${pct(dev)}. 차세대 원천기술(기초) 투자 공백 여부를 점검하세요.` });
    }
    if (agg.privateRatio !== null && agg.privateRatio < 0.1) {
      out.push({ tone: 'gap', text: `민간 매칭 낮음: 총연구비 중 민간부담이 ${pct(agg.privateRatio)}. 민간 투자 유인(매칭형·수요연계형) 설계를 고려할 만합니다.` });
    }
    if (agg.capitalShare >= 0.6) {
      out.push({ tone: 'warn', text: `수도권 집중: 정부연구비의 ${pct(agg.capitalShare)}가 서울·경기·인천. 지역 거점형 사업 기획 시 근거가 됩니다.` });
    }
    const topBiz = agg.businesses[0];
    if (topBiz && topBiz.share >= 0.3) {
      out.push({ tone: 'warn', text: `사업 쏠림: "${topBiz.name}" 한 사업이 표본 정부연구비의 ${pct(topBiz.share)}. 신규사업은 이 사업과의 차별화(대상·단계·성과물)가 필수입니다.` });
    }
    return out;
  }


  // ── 두 키워드 상대 비교 ───────────────────────────────────────
  // a, b = { query, agg, trend, meta }. 규모가 크게 다른 분야도 비교되도록 절대값 대신
  // 지수(첫 유효 연도=100)와 비중으로 맞춘다.
  const COMPARE_DIMENSIONS = [
    ['byMinistry', '부처별 정부연구비'], ['byOrderAgency', '전문기관별'], ['byPerformer', '수행주체별'],
    ['byPhase', '연구개발단계별'], ['byRegion', '지역별 (시도)'],
  ];

  function indexSeries(counts = []) {
    const baseIdx = counts.findIndex(v => Number.isFinite(v) && v > 0);
    if (baseIdx < 0) return { base: null, baseIndex: -1, values: counts.map(() => null) };
    const base = counts[baseIdx];
    return {
      base, baseIndex: baseIdx,
      values: counts.map((v, i) => (i < baseIdx || !Number.isFinite(v) ? null : Math.round((v / base) * 1000) / 10)),
    };
  }

  // 두 분포를 같은 항목 기준으로 맞춘다. 기타·미상은 제외하고, 양쪽 비중이 큰 순으로 top개.
  function alignShares(rowsA = [], rowsB = [], top = 8) {
    const clean = rows => rows.filter(r => !r.isOther && r.name !== '미상');
    const map = new Map();
    for (const r of clean(rowsA)) map.set(r.name, { name: r.name, a: r.share, b: 0 });
    for (const r of clean(rowsB)) {
      if (map.has(r.name)) map.get(r.name).b = r.share;
      else map.set(r.name, { name: r.name, a: 0, b: r.share });
    }
    return [...map.values()]
      .sort((x, y) => Math.max(y.a, y.b) - Math.max(x.a, x.b))
      .slice(0, top)
      .map(r => ({ ...r, diff: r.a - r.b }));
  }

  function compareInvestment(a, b) {
    const totalA = a.meta.recentTotal, totalB = b.meta.recentTotal;
    const hi = Math.max(totalA, totalB), lo = Math.min(totalA, totalB);
    const scale = {
      ratio: lo > 0 ? hi / lo : null,
      larger: totalA === totalB ? null : (totalA > totalB ? 'a' : 'b'),
    };
    const topName = side => (side.agg.byMinistry.find(r => !r.isOther && r.name !== '미상') || {}).name || null;
    const topShare = side => (side.agg.byMinistry.find(r => !r.isOther && r.name !== '미상') || {}).share ?? null;
    const kpis = {
      recentTotal: { a: totalA, b: totalB },
      growth: { a: a.trend.growth, b: b.trend.growth },
      phase: { a: a.trend.phase, b: b.trend.phase },
      topMinistry: { a: topName(a), b: topName(b) },
      topMinistryShare: { a: topShare(a), b: topShare(b) },
      ministryHHI: { a: a.agg.ministryHHI, b: b.agg.ministryHHI },
      companyShare: { a: a.agg.companyShare, b: b.agg.companyShare },
      universityShare: { a: a.agg.universityShare, b: b.agg.universityShare },
      privateRatio: { a: a.agg.privateRatio, b: b.agg.privateRatio },
      capitalShare: { a: a.agg.capitalShare, b: b.agg.capitalShare },
    };
    const dims = COMPARE_DIMENSIONS.map(([key, title]) => ({ key, title, rows: alignShares(a.agg[key], b.agg[key]) }));
    return {
      scale, kpis, dims,
      years: a.trend.years,
      index: { a: indexSeries(a.trend.counts), b: indexSeries(b.trend.counts) },
      signals: buildCompareSignals(a, b, kpis, dims),
    };
  }

  // 두 분야의 차이를 짚는 규칙 기반 신호(판단 보조용). 격차 임계값은 고정 기준.
  // 받침 유무로 조사를 고른다 ("인공지능"+가 → "인공지능이", "재난안전"+는 → "재난안전은").
  function josa(word, withBatchim, without) {
    const ch = String(word).trim().slice(-1);
    const code = ch.charCodeAt(0);
    const hasBatchim = code >= 0xac00 && code <= 0xd7a3 && (code - 0xac00) % 28 !== 0;
    return hasBatchim ? withBatchim : without;
  }
  const q = word => `"${word}"`;

  function buildCompareSignals(a, b, kpis, dims) {
    const out = [];
    const A = a.query, B = b.query;
    const ga = w => `${q(w)}${josa(w, '이', '가')}`;       // 주격
    const un = w => `${q(w)}${josa(w, '은', '는')}`;       // 보조사
    const gap = (x, y) => (x === null || x === undefined || y === null || y === undefined ? null : x - y);
    const pp = v => `${Math.round(Math.abs(v) * 100)}%p`;

    const g = gap(kpis.growth.a, kpis.growth.b);
    if (g !== null && Math.abs(g) >= 0.2) {
      const [fast, slow] = g > 0 ? [A, B] : [B, A];
      out.push({ tone: 'up', text: `성장 속도: ${ga(fast)} ${q(slow)}보다 최근 3년 증가율이 ${pp(g)} 높습니다 (${kpis.growth.a === null ? '—' : pct(kpis.growth.a)} vs ${kpis.growth.b === null ? '—' : pct(kpis.growth.b)}).` });
    } else if (g !== null) {
      out.push({ tone: 'flat', text: `성장 속도: 두 분야의 최근 3년 증가율 차이가 ${pp(g)}로 비슷한 수준입니다.` });
    }
    const gc = gap(kpis.companyShare.a, kpis.companyShare.b);
    if (gc !== null && Math.abs(gc) >= 0.15) {
      const [more, less] = gc > 0 ? [A, B] : [B, A];
      out.push({ tone: 'info', text: `기업 참여: ${ga(more)} ${q(less)}보다 기업 수행 비중이 ${pp(gc)} 높습니다 (${pct(kpis.companyShare.a)} vs ${pct(kpis.companyShare.b)}). 낮은 쪽은 실증·사업화형 사업 공백 가능성을 점검하세요.` });
    }
    const gu = gap(kpis.universityShare.a, kpis.universityShare.b);
    if (gu !== null && Math.abs(gu) >= 0.15) {
      const [more, less] = gu > 0 ? [A, B] : [B, A];
      out.push({ tone: 'info', text: `대학 수행: ${ga(more)} ${q(less)}보다 대학 비중이 ${pp(gu)} 높습니다 (${pct(kpis.universityShare.a)} vs ${pct(kpis.universityShare.b)}).` });
    }
    if (kpis.topMinistry.a && kpis.topMinistry.b) {
      if (kpis.topMinistry.a === kpis.topMinistry.b) {
        out.push({ tone: 'info', text: `주도 부처: 두 분야 모두 ${kpis.topMinistry.a}가 1위입니다 (${pct(kpis.topMinistryShare.a)} vs ${pct(kpis.topMinistryShare.b)}). 부처 간 연계 여지는 2위 이하 부처에서 찾아보세요.` });
      } else {
        out.push({ tone: 'info', text: `주도 부처: ${un(A)} ${kpis.topMinistry.a}(${pct(kpis.topMinistryShare.a)}), ${un(B)} ${kpis.topMinistry.b}(${pct(kpis.topMinistryShare.b)})${josa(kpis.topMinistry.b, '이', '가')} 주도합니다. 두 부처가 만나는 융합 사업의 근거가 될 수 있습니다.` });
      }
    }
    const gh = gap(kpis.ministryHHI.a, kpis.ministryHHI.b);
    if (gh !== null && Math.abs(gh) >= 1500) {
      const [conc, disp] = gh > 0 ? [A, B] : [B, A];
      out.push({ tone: 'warn', text: `부처 집중도: ${ga(conc)} ${q(disp)}보다 부처 집중도(HHI)가 높습니다 (${kpis.ministryHHI.a} vs ${kpis.ministryHHI.b}). 높은 쪽은 단일 부처 주도, 낮은 쪽은 다부처 조정이 쟁점입니다.` });
    }
    const gcap = gap(kpis.capitalShare.a, kpis.capitalShare.b);
    if (gcap !== null && Math.abs(gcap) >= 0.15) {
      const [more, less] = gcap > 0 ? [A, B] : [B, A];
      out.push({ tone: 'warn', text: `수도권 집중: ${ga(more)} ${q(less)}보다 수도권 비중이 ${pp(gcap)} 높습니다 (${pct(kpis.capitalShare.a)} vs ${pct(kpis.capitalShare.b)}).` });
    }
    const phase = (dims.find(d => d.key === 'byPhase') || { rows: [] }).rows
      .filter(r => r.name !== '기타' && Math.abs(r.diff) >= 0.15).sort((x, y) => Math.abs(y.diff) - Math.abs(x.diff))[0];
    if (phase) {
      const [more, less] = phase.diff > 0 ? [A, B] : [B, A];
      out.push({ tone: 'gap', text: `연구단계: ${phase.name} 비중이 ${q(more)}에서 ${q(less)}보다 ${pp(phase.diff)} 높습니다 (${pct(phase.a)} vs ${pct(phase.b)}).` });
    }
    return out;
  }

  return {
    compareInvestment,
    josa,
    indexSeries,
    alignShares,
    regionProvince,
    performerGroup,
    phaseGroup,
    groupBy,
    aggregateInvestment,
    summarizeYearCounts,
    buildInvestmentInsights,
  };
});
