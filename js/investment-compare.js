// ============================================================
// 정부 R&D 투자 지형 비교 — 키워드 2~3개(3번째는 선택)를 각각 분석(collectInvestmentData)한 뒤 나란히 비교한다.
// 규모가 크게 다른 분야도 보이도록 절대 건수 대신 지수(첫 해=100)와 비중으로 맞춘다.
// 비교 계산은 InvestmentCore.compareInvestment, 여기는 입력창과 화면.
// ============================================================

const INVEST_CMP_COLORS = ['#2563eb', '#ea580c', '#16a34a'];
const INVEST_CMP_HEADER_COLORS = ['#93c5fd', '#fdba74', '#86efac'];   // 어두운 헤더 위에서 읽히는 밝은 톤
const INVEST_CMP_LABELS = ['A', 'B', 'C'];
let _investCmpSeq = 0;

function openInvestmentCompare() {
  closeInvestmentCompareModal();
  const first = (document.getElementById('searchInput')?.value || STATE.currentQuery || '').trim();
  const overlay = document.createElement('div');
  overlay.id = 'investCmpModal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.45);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;';
  const inputStyle = 'width:100%;padding:9px 11px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;';
  const field = (i, value, placeholder, optional) => `
      <label style="font-size:12px;font-weight:700;color:${INVEST_CMP_COLORS[i]};">키워드 ${INVEST_CMP_LABELS[i]}${optional ? ' <span style="font-weight:500;color:#98a2b3;">(선택)</span>' : ''}</label>
      <input id="investCmp${INVEST_CMP_LABELS[i]}" type="text" value="${escAttr(value)}" placeholder="${placeholder}" style="${inputStyle}margin:4px 0 12px;">`;
  overlay.innerHTML = `
    <div role="dialog" aria-modal="true" aria-labelledby="investCmpTitle" style="background:#fff;border-radius:14px;padding:22px 24px;width:100%;max-width:420px;box-shadow:0 20px 50px rgba(0,0,0,0.25);">
      <p id="investCmpTitle" style="font-size:15px;font-weight:800;color:#111;margin:0 0 4px;">R&amp;D 투자 지형 비교</p>
      <p style="font-size:12px;color:#6b7280;margin:0 0 14px;">기술 키워드 2개(최대 3개)를 입력하면 규모·성장·투자 구조를 나란히 비교합니다. 3번째 키워드는 비워두면 2개만 비교합니다.</p>
      ${field(0, first, '예: 인공지능', false)}
      ${field(1, '', '예: 재난안전', false)}
      ${field(2, '', '예: 인공지능', true)}
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:4px;">
        <button type="button" id="investCmpCancel" class="btn-secondary text-sm">취소</button>
        <button type="button" id="investCmpGo" class="btn-primary text-sm">비교 분석</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const inputs = INVEST_CMP_LABELS.map(l => overlay.querySelector(`#investCmp${l}`));
  const go = () => {
    const queries = inputs.map(el => el.value.trim());
    if (!queries[0] || !queries[1]) { showToast('키워드 A와 B는 반드시 입력해주세요', 'warning'); return; }
    const picked = queries.filter(Boolean);
    if (new Set(picked.map(x => x.toLowerCase())).size !== picked.length) { showToast('서로 다른 키워드를 입력해주세요', 'warning'); return; }
    closeInvestmentCompareModal();
    runInvestmentCompare(picked);
  };
  overlay.querySelector('#investCmpGo').onclick = go;
  overlay.querySelector('#investCmpCancel').onclick = closeInvestmentCompareModal;
  overlay.addEventListener('click', e => { if (e.target === overlay) closeInvestmentCompareModal(); });
  overlay.addEventListener('keydown', e => {
    if (e.key === 'Enter') go();
    if (e.key === 'Escape') closeInvestmentCompareModal();
  });
  (first ? inputs[1] : inputs[0]).focus();
}

function closeInvestmentCompareModal() {
  document.getElementById('investCmpModal')?.remove();
}

async function runInvestmentCompare(queries) {
  if (!STATE.ntisKey && !(PROXY_AVAILABLE && STATE.ntisConfigured)) {
    showToast('🔑 NTIS 인증키가 필요합니다. 상단 "API 설정"에서 입력해주세요', 'warning');
    return;
  }
  const proxyBase = getProxyBase() || VERCEL_BASE || '';
  if (!proxyBase) {
    showToast('프록시 서버가 연결되어 있지 않습니다. 서버를 실행한 뒤 다시 시도해주세요.', 'warning');
    return;
  }
  const seq = ++_investCmpSeq;
  ++_investRunSeq;                                  // 진행 중인 단일 분석이 있으면 중단시킨다
  const isStale = () => seq !== _investCmpSeq;
  const title = queries.map(q => `"${escHtml(q)}"`).join(' vs ');

  document.body.classList.add('search-mode');
  hideAll();
  const section = document.getElementById('analysisSection');
  section.classList.remove('hidden');
  section.innerHTML = `
    <div class="analysis-card trend-analysis-card fade-up">
      <div class="analysis-header flex items-center gap-3">
        <iconify-icon icon="solar:pie-chart-2-bold-duotone" width="20"></iconify-icon>
        <div>
          <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">정부 R&amp;D 투자 지형 비교 (${queries.length}개 분야)</p>
          <p style="font-size:15px;font-weight:700;margin:0">${title}</p>
        </div>
      </div>
      <div class="analysis-body trend-analysis-loading">
        <div class="spinner"></div>
        <p id="investProgress" style="color:#6b7280;font-size:13px;margin-top:12px;">비교 분석 준비 중...</p>
      </div>
    </div>`;

  try {
    // NTIS 호출 제한(429)을 피하려고 키워드를 순차로 수집한다. 캐시된 키워드는 즉시 반환된다.
    const sides = [];
    for (let i = 0; i < queries.length; i++) {
      const data = await collectInvestmentData(proxyBase, queries[i], { isStale, label: `[${INVEST_CMP_LABELS[i]} ${queries[i]}] ` });
      if (!data) return;
      sides.push({ query: queries[i], ...data });
    }
    const cmp = InvestmentCore.compareInvestment(sides);
    renderInvestmentCompare(sides, cmp);
    generateInvestmentCompareAISummary(seq, sides, cmp);
  } catch (err) {
    if (isStale()) return;
    console.error('[InvestmentCompare]', err);
    section.innerHTML = `<div class="analysis-card trend-analysis-card trend-analysis-error fade-up">투자 지형 비교 중 오류가 발생했습니다: ${escHtml(err.message)}</div>`;
  }
}

// ── 화면 ──────────────────────────────────────────────────────────
function investCmpPairPanel(title, rows, note = '') {
  const visible = rows.filter(r => r.values.some(v => Math.round(v * 100) > 0));
  const bar = (v, color) => `
    <span style="display:grid;grid-template-columns:minmax(0,1fr) 34px;gap:6px;align-items:center;">
      <span style="height:7px;background:#eef2f6;border-radius:4px;overflow:hidden;display:block;"><span style="display:block;height:100%;width:${v > 0 ? Math.max(2, Math.round(v * 100)) : 0}%;background:${color};"></span></span>
      <span style="font-size:11px;font-weight:700;color:#1d2939;text-align:right;">${Math.round(v * 100)}%</span>
    </span>`;
  const body = visible.length ? visible.map(r => `
    <div style="margin-bottom:9px;">
      <div style="font-size:12px;color:#1d2939;margin-bottom:3px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escAttr(r.name)}">${escHtml(r.name)}</div>
      ${r.values.map((v, i) => bar(v, INVEST_CMP_COLORS[i])).join('')}
    </div>`).join('') : '<div style="font-size:12px;color:#98a2b3;">데이터 없음</div>';
  return `
    <div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px 16px;min-width:0;">
      <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:10px;">${title}</div>
      ${body}
      ${note ? `<div style="font-size:10.5px;color:#98a2b3;margin-top:4px;">${note}</div>` : ''}
    </div>`;
}

function renderInvestmentCompare(sides, cmp) {
  const pctText = v => (v === null || v === undefined ? '—' : `${Math.round(v * 100)}%`);
  const growthText = v => (v === null || v === undefined ? '—' : `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`);
  const k = cmp.kpis;
  const { recentFrom, lastYear } = sides[0].meta;
  const names = sides.map(s => s.query);

  let scaleText = '분야 간 규모가 비슷합니다';
  if (cmp.scale.ratio !== null && cmp.scale.largest !== null) {
    const big = names[cmp.scale.largest], small = names[cmp.scale.smallest];
    scaleText = `가장 큰 "${escHtml(big)}"${InvestmentCore.josa(big, '이', '가')} 가장 작은 "${escHtml(small)}"의 약 ${cmp.scale.ratio.toFixed(1)}배`;
  }

  const fallbackNote = cmp.index.some(ix => ix.baseIndex >= 0 && cmp.years[ix.baseIndex] !== cmp.baseYear)
    ? ' 일부 분야는 해당 연도 건수가 없어 첫 유효 연도를 기준으로 했습니다.' : '';
  const rows = [
    ['최근 5년 과제 건수', k.recentTotal.map(v => `${v.toLocaleString()}건`)],
    ['성장 단계 (최근3년 vs 직전3년)', k.phase.map((p, i) => `${escHtml(p)} ${growthText(k.growth[i])}`)],
    ['주도 부처', k.topMinistry.map((m, i) => `${escHtml(m || '—')} <span style="color:#98a2b3;">${pctText(k.topMinistryShare[i])}</span>`)],
    ['부처 집중도 (HHI)', k.ministryHHI.map(v => String(v ?? '—'))],
    ['기업 수행 비중', k.companyShare.map(pctText)],
    ['대학 수행 비중', k.universityShare.map(pctText)],
    ['민간부담 비율', k.privateRatio.map(pctText)],
    ['수도권 비중', k.capitalShare.map(pctText)],
  ];
  const kpiTable = `
    <table style="width:100%;border-collapse:collapse;">
      <thead><tr style="font-size:12px;text-align:left;">
        <th style="padding:6px 8px;"></th>
        ${names.map((n, i) => `<th style="padding:6px 8px;color:${INVEST_CMP_COLORS[i]};">● ${escHtml(n)}</th>`).join('')}
      </tr></thead>
      <tbody>${rows.map(r => `
        <tr style="border-top:1px solid #f2f4f7;">
          <td style="padding:8px;font-size:11.5px;color:#667085;">${r[0]}</td>
          ${r[1].map(v => `<td style="padding:8px;font-size:13px;font-weight:700;color:#1d2939;">${v}</td>`).join('')}
        </tr>`).join('')}</tbody>
    </table>`;

  const failedNote = side => (!side.trend.complete || side.meta.failedPages)
    ? ` · "${escHtml(side.query)}" 일부 조회 실패(연도 또는 ${side.meta.failedPages || 0}페이지)` : '';
  const sampleLine = side => `"${escHtml(side.query)}" 표본 ${side.meta.sampleSize.toLocaleString()}건 (전체 ${side.meta.recentTotal.toLocaleString()}건의 ${side.meta.recentTotal ? Math.max(1, Math.round(side.meta.sampleSize / side.meta.recentTotal * 100)) : 0}%)`;
  const headerTitle = sides.map((s, i) => `<span style="color:${INVEST_CMP_HEADER_COLORS[i]};">"${escHtml(s.query)}"</span>`).join(' vs ');

  document.getElementById('analysisSection').innerHTML = `
    <div id="investCompareDashboard" class="analysis-card trend-analysis-card fade-up">
      <div class="analysis-header flex items-center justify-between">
        <div class="flex items-center gap-3">
          <iconify-icon icon="solar:pie-chart-2-bold-duotone" width="20"></iconify-icon>
          <div>
            <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">정부 R&amp;D 투자 지형 비교 — 과제 건수 ${cmp.years[0]}~${cmp.years[cmp.years.length - 1]} · 투자 구조 ${recentFrom}~${lastYear}</p>
            <p style="font-size:15px;font-weight:700;margin:0">${headerTitle}</p>
          </div>
        </div>
        <button type="button" onclick="document.getElementById('analysisSection').classList.add('hidden')" class="text-white/60 hover:text-white transition-colors" aria-label="닫기">
          <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
        </button>
      </div>
      <div class="analysis-body trend-analysis-body">
        <div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:14px 16px;margin-bottom:14px;overflow-x:auto;">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:2px;">핵심 지표 비교</div>
          <div style="font-size:11.5px;color:#667085;margin-bottom:8px;">규모: ${scaleText}</div>
          ${kpiTable}
        </div>

        <div style="background:#fff;border:1px solid #e4e7ec;border-radius:12px;padding:16px;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:2px;">성장 추세 비교 (지수: ${cmp.baseYear}년 = 100)</div>
          <div style="font-size:10.5px;color:#98a2b3;margin-bottom:10px;">규모가 달라도 성장 속도를 비교할 수 있도록 모든 분야를 ${cmp.baseYear}년 건수 대비 지수로 환산했습니다(100 초과 = ${cmp.baseYear}년보다 증가). 실제 건수는 마우스를 올리면 표시됩니다.${fallbackNote}</div>
          <div style="position:relative;height:240px;"><canvas id="investCmpChart"></canvas></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px;margin-bottom:14px;">
          ${cmp.dims.map(d => investCmpPairPanel(d.title, d.rows, d.key === 'byRegion' ? `수도권 ${k.capitalShare.map(pctText).join(' vs ')}` : '')).join('')}
        </div>

        <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:14px;">
          <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px;">🔍 분야 간 차이 <span style="font-weight:500;color:#64748b;">(판단 보조용 탐색 신호)</span></div>
          <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;">
            ${cmp.signals.length ? cmp.signals.map(s => `<li style="font-size:12px;color:#1e3a5f;line-height:1.6;">${INVEST_TONE[s.tone]?.icon || '•'} ${escHtml(s.text)}</li>`).join('')
              : '<li style="font-size:12px;color:#64748b;">뚜렷한 차이 신호가 감지되지 않았습니다.</li>'}
          </ul>
        </div>

        <div id="investAIBox" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:12px 16px;margin-bottom:14px;${hasAIAccess() ? '' : 'display:none;'}">
          <div style="font-size:12px;font-weight:700;color:#344054;margin-bottom:8px;">🤖 비교 시사점 (AI 요약)</div>
          <div id="investAIBody" style="font-size:12px;color:#475467;">분야별 수치를 비교해 시사점을 작성하는 중...</div>
        </div>

        <div style="font-size:11px;color:#98a2b3;line-height:1.7;">
          표본 기준: ${recentFrom}~${lastYear}년 과제 중 검색 관련도 상위 최대 200건의 정부연구비 비중 — ${sides.map(sampleLine).join(', ')}${sides.map(failedNote).join('')}.<br>
          표본 비율이 다르면(전체 건수가 큰 분야일수록 표본 비율이 낮음) 구조 비중의 신뢰도가 다를 수 있습니다. 연도별 건수는 전수(표본 아님)이며 연차·수행기관 단위로 집계됩니다.
        </div>
      </div>
    </div>`;

  requestAnimationFrame(() => {
    const ctx = document.getElementById('investCmpChart');
    if (!ctx || typeof Chart === 'undefined') return;
    if (window._investCmpChartInstance) window._investCmpChartInstance.destroy();
    const datasets = sides.map((side, i) => ({
      label: side.query,
      data: cmp.index[i].values,
      rawCounts: side.trend.counts,
      borderColor: INVEST_CMP_COLORS[i], backgroundColor: INVEST_CMP_COLORS[i],
      borderWidth: 2.5, pointRadius: 3, tension: 0.25, spanGaps: false,
    }));
    window._investCmpChartInstance = new Chart(ctx, {
      type: 'line',
      data: { labels: cmp.years.map(String), datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { usePointStyle: true, color: '#475467' } },
          tooltip: { callbacks: { label: c => {
            const raw = c.dataset.rawCounts[c.dataIndex];
            return `${c.dataset.label}: 지수 ${c.raw === null ? '—' : c.raw}${raw === null || raw === undefined ? '' : ` (${Number(raw).toLocaleString()}건)`}`;
          } } },
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: '#667085' } },
          y: { beginAtZero: true, grid: { color: 'rgba(52,64,84,0.08)' }, ticks: { color: '#667085' } },
        },
      },
    });
  });
}

// ── AI 비교 시사점 (선택) ────────────────────────────────────────
async function generateInvestmentCompareAISummary(seq, sides, cmp) {
  const body = document.getElementById('investAIBody');
  if (!body || !hasAIAccess()) return;
  const share = rows => rows.filter(r => !r.isOther).slice(0, 4).map(r => `${r.name} ${Math.round(r.share * 100)}%`).join(', ');
  const brief = side => ({
    키워드: side.query,
    최근5년과제건수: side.meta.recentTotal,
    추세: `${side.trend.phase}${side.trend.growth !== null ? ` (${Math.round(side.trend.growth * 100)}%)` : ''}`,
    부처: share(side.agg.byMinistry),
    수행주체: share(side.agg.byPerformer),
    연구단계: share(side.agg.byPhase),
    지역: share(side.agg.byRegion),
    민간부담비율: side.agg.privateRatio === null ? '미상' : `${Math.round(side.agg.privateRatio * 100)}%`,
    주요사업: side.agg.businesses.slice(0, 4).map(x => `${x.name}(${x.ministry})`),
  });
  const facts = { 분야: sides.map(brief), 규칙기반차이: cmp.signals.map(s => s.text) };
  const quoted = sides.map(s => `"${s.query}"`).join(' vs ');
  try {
    const resp = await cerebrasChat({
      model: getActiveCerebrasModel(),
      messages: [
        { role: 'system', content: '당신은 한국 국가R&D 정책 기획 전문가입니다. 주어진 수치만 근거로 쓰고, 수치에 없는 사실은 추측하지 않습니다. 한국어로 답합니다.' },
        { role: 'user', content: `아래는 ${sides.length}개 기술 분야(${quoted})의 NTIS 국가R&D 과제 집계입니다.\n${JSON.stringify(facts)}\n\nR&D 정책 수립·신규사업 기획 담당자에게 분야들을 상대 비교한 시사점 4개를 작성하세요. 규모·성장 차이, 투자 구조(부처·수행주체·단계·지역) 차이, 한 분야의 사례를 다른 분야에 적용할 기회나 융합 여지, 추가로 확인할 점을 다루세요. 각 항목은 "- "로 시작하는 1~2문장이며 근거 수치를 괄호로 인용하세요. 목록 외 다른 문장은 쓰지 마세요.` },
      ],
      temperature: 0.3,
      reasoning_effort: 'low',
      max_tokens: 2000,
    }, 45000);
    if (seq !== _investCmpSeq) return;
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
    if (seq !== _investCmpSeq) return;
    body.textContent = err.message === 'GEMINI_CONSENT_DECLINED'
      ? 'Gemini 사용을 승인하지 않아 AI 요약을 생략했습니다. 위 차이 신호를 참고하세요.'
      : `AI 요약을 만들지 못했습니다 (${err.message}). 위 차이 신호를 참고하세요.`;
  }
}
