    // ============================================================
    // Visualization & Analysis (D3, Chart.js, AI Reports)
    // ============================================================

    async function runTrendAnalysis() {
      const query = document.getElementById('searchInput').value.trim() || STATE.currentQuery || '';
      if (!query) {
        showToast('분석할 키워드를 입력해주세요', 'warning');
        document.getElementById('searchInput').focus();
        return;
      }
      if (!STATE.token && PROXY_AVAILABLE && typeof autoRequestToken === 'function') {
        await autoRequestToken();
      }
      if (!STATE.clientId || !STATE.token) {
        showToast('🔑 ScienceON API 토큰이 필요합니다. 우측 상단 "API 설정"을 확인해주세요.', 'warning');
        return;
      }

      document.body.classList.add('search-mode');
      hideAll();
      const analysisSection = document.getElementById('analysisSection');
      analysisSection.classList.remove('hidden');
      analysisSection.innerHTML = `
        <div class="analysis-card fade-up" style="max-width:900px;margin:0 auto;">
          <div class="analysis-header flex items-center gap-3">
            <iconify-icon icon="solar:chart-2-bold-duotone" width="20"></iconify-icon>
            <div>
              <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">기술 트렌드 분석 — 연도별 연구·특허 동향</p>
              <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(query)}"</p>
            </div>
          </div>
          <div class="analysis-body bg-white" style="padding:28px 32px;text-align:center;">
            <div class="spinner" style="margin:40px auto;"></div>
            <p style="color:#6b7280;font-size:13px;margin-top:12px;">2017~2025년 × 2개 지표 병렬 조회 중...</p>
          </div>
        </div>`;

      try {
        const trendData = await fetchTrendData(query);
        renderTrendDashboard(query, trendData);
      } catch (err) {
        console.error('[Trend]', err);
        analysisSection.innerHTML = `<div class="analysis-card fade-up" style="max-width:900px;margin:0 auto;padding:32px;text-align:center;color:#dc2626;">트렌드 분석 중 오류가 발생했습니다: ${escHtml(err.message)}</div>`;
      }
    }

    async function fetchTrendData(query) {
      const startYear = 2017;
      const endYear   = 2025;
      const years = Array.from({ length: endYear - startYear + 1 }, (_, i) => startYear + i);

      // 시작 전 토큰 유효성 확인 — 만료 시 갱신
      const ensureToken = async () => {
        const testParams = new URLSearchParams({
          client_id: STATE.clientId, token: STATE.token,
          version: '1.0', action: 'search', target: 'ARTI',
          searchQuery: JSON.stringify({ BI: query }), curPage: 1, rowCount: 1,
        });
        const resp = await fetch(`${getApiBase()}?${testParams}`);
        const text = await resp.text();
        if (text.includes('E4103')) {
          if (typeof autoRequestToken === 'function') await autoRequestToken();
        }
      };
      await ensureToken();

      const sleep = ms => new Promise(r => setTimeout(r, ms));

      // XML에서 TotalCount 읽기 (getElementsByTagName — XML 문서 호환)
      const getTotalCount = (xml) => {
        const els = xml.getElementsByTagName('TotalCount');
        if (els.length) return parseInt(els[0].textContent) || 0;
        const els2 = xml.getElementsByTagName('totalCount');
        return els2.length ? parseInt(els2[0].textContent) || 0 : 0;
      };

      // URL 빌드 시 STATE.token 참조 (항상 최신 토큰 사용)
      const buildApiUrl = (target, extra) => {
        const params = new URLSearchParams({
          client_id: STATE.clientId, token: STATE.token,
          version: '1.0', action: 'search', target,
          ...extra,
        });
        return `${getApiBase()}?${params}`;
      };

      const getYearFromRecord = (rec) => {
        const tags = ['Pubyear', 'PublDate', 'ApplDate', 'GrantDate', 'RegisterDate'];
        for (const t of tags) {
          const items = Array.from(rec.getElementsByTagName('item'));
          const byMeta = items.find(el => el.getAttribute('metaCode') === t);
          if (byMeta && byMeta.textContent.trim()) return byMeta.textContent.trim().substring(0, 4);
          
          const byTag = rec.getElementsByTagName(t);
          if (byTag.length > 0 && byTag[0].textContent.trim()) return byTag[0].textContent.trim().substring(0, 4);
        }
        return '';
      };

      const fetchYearDist = async (target, queryObjStr) => {
        const counts = Object.fromEntries(years.map(y => [y, 0]));
        let total = 0;
        let fetched = 0;
        const PAGE = 100;
        const MAX_PAGES = 5;

        for (let page = 1; page <= MAX_PAGES; page++) {
          try {
            const url = buildApiUrl(target, {
              searchQuery: queryObjStr,
              curPage: page, rowCount: PAGE,
            });
            
            let text = '';
            let attempts = 0;
            while (attempts < 2) {
              const resp = await fetch(url);
              if (resp.status === 429) {
                console.warn(`[${target}] 429 hit (page ${page}), retrying in 600ms...`);
                await sleep(600);
                attempts++;
                continue;
              }
              text = await resp.text();
              break;
            }

            const xml  = new DOMParser().parseFromString(text, 'text/xml');

            const parseErr = xml.getElementsByTagName('parsererror');
            if (parseErr.length > 0) { console.error(`[${target}] XML parse error`, text.slice(0,200)); break; }

            const errEls = xml.getElementsByTagName('errorCode');
            if (errEls.length > 0 && errEls[0].textContent.trim()) {
              console.warn(`[${target}] API error:`, errEls[0].textContent, text.slice(0,300));
              break;
            }

            if (page === 1) {
              total = getTotalCount(xml);
              console.log(`[${target}] TotalCount:`, total, '| text length:', text.length);
              if (total === 0) break;
            }

            const records = Array.from(xml.getElementsByTagName('record'));
            console.log(`[${target}] page`, page, 'records:', records.length);
            if (records.length === 0) break;

            records.forEach(rec => {
              const rawYear = getYearFromRecord(rec);
              const y = parseInt(rawYear);
              if (!isNaN(y) && y >= 2000 && counts[y] !== undefined) counts[y]++;
            });
            fetched += records.length;
            if (fetched >= total) break;
            
            // 페이지 간 짧은 지연 (KISTI 서버 보호)
            await sleep(150);
          } catch (e) {
            console.error(`[Trend ${target}] fetch error:`, e);
            break;
          }
        }
        let scaled = years.map(y => counts[y]);
        if (fetched > 0 && total > fetched) {
          const ratio = total / fetched;
          // 샘플링 비율만큼 곱하여 전체 추정치로 확대 (정수화)
          scaled = scaled.map(n => Math.round(n * ratio));
        }
        return { counts: scaled, total };
      };

      // 논문과 특허를 순차적으로 요청하여 동시 접속 부하 분산
      const paperResult = await fetchYearDist('ARTI', JSON.stringify({ BI: query }));
      console.log('[Trend] Paper data collection done. Waiting 500ms for Patent...');
      await sleep(500); 
      const patentResult = await fetchYearDist('PATENT', JSON.stringify({ BI: query }));

      return {
        years, 
        paperCounts: paperResult.counts,
        patentCounts: patentResult.counts,
        patentQueryUsed: query,
        patentTotal: patentResult.total,
      };
    }

    function calcTrendPhase(counts) {
      const n = counts.length;
      if (n < 6) return { phase: '데이터 부족', color: '#9ca3af', icon: '⚪' };
      const recent = counts.slice(n - 3).reduce((a, b) => a + b, 0) / 3;
      const prev   = counts.slice(n - 6, n - 3).reduce((a, b) => a + b, 0) / 3;
      if (prev === 0) return { phase: '신흥 분야', color: '#475569', icon: '🔘' };
      const rate = (recent - prev) / prev * 100;
      if (rate > 30)  return { phase: '급성장',    color: '#16a34a', icon: '🟢', rate };
      if (rate > 10)  return { phase: '성장 중',   color: '#2563eb', icon: '🔵', rate };
      if (rate > -10) return { phase: '성숙기',    color: '#d97706', icon: '🟡', rate };
      return             { phase: '쇠퇴 신호',    color: '#dc2626', icon: '🔴', rate };
    }

    function renderTrendDashboard(query, { years, paperCounts, patentCounts, patentQueryUsed, patentTotal }) {
      const today = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' });
      const paperPhase  = calcTrendPhase(paperCounts);
      const patentPhase = calcTrendPhase(patentCounts);
      const peakPaperIdx  = paperCounts.indexOf(Math.max(...paperCounts));
      const peakPatentIdx = patentCounts.indexOf(Math.max(...patentCounts));
      const totalPapers  = paperCounts.reduce((a, b) => a + b, 0);
      const totalPatents = patentCounts.reduce((a, b) => a + b, 0);
      const recent3Papers  = paperCounts.slice(-3).reduce((a, b) => a + b, 0);
      const recent3Patents = patentCounts.slice(-3).reduce((a, b) => a + b, 0);
      const recentShareP = totalPapers  > 0 ? (recent3Papers  / totalPapers  * 100).toFixed(0) : 0;
      const recentShareT = totalPatents > 0 ? (recent3Patents / totalPatents * 100).toFixed(0) : 0;

      const insights = [];
      if (paperPhase.rate !== undefined) {
        insights.push(paperPhase.rate > 0
          ? `논문 발표가 최근 3년간 평균 <strong>${paperPhase.rate.toFixed(1)}%</strong> 증가했습니다.`
          : `논문 발표가 최근 3년간 평균 <strong>${Math.abs(paperPhase.rate).toFixed(1)}%</strong> 감소 추세입니다.`);
      }
      if (peakPaperIdx === years.length - 1 || peakPaperIdx === years.length - 2) {
        insights.push(`논문 피크가 <strong>${years[peakPaperIdx]}년</strong>으로 최근 연구 활동이 정점에 있습니다.`);
      } else {
        insights.push(`논문 피크는 <strong>${years[peakPaperIdx]}년</strong>으로, 이후 관심이 분산되고 있습니다.`);
      }
      if (totalPatents < totalPapers * 0.05) {
        insights.push(`특허 대비 논문 비율이 낮아(<strong>${((totalPatents/Math.max(totalPapers,1))*100).toFixed(1)}%</strong>) 연구–IP 전환 공백 신호가 관찰됩니다. 사업화 판단에는 추가 검증이 필요합니다.`);
      } else if (totalPatents > totalPapers * 0.3) {
        insights.push(`특허 비중이 높아(<strong>${((totalPatents/Math.max(totalPapers,1))*100).toFixed(1)}%</strong>) 이미 상업화가 진행 중인 분야입니다.`);
      }
      if (parseInt(recentShareP) > 40) {
        insights.push(`최근 3년이 전체 10년 논문의 <strong>${recentShareP}%</strong>를 차지 — 최근 급부상한 토픽입니다.`);
      }

      const analysisSection = document.getElementById('analysisSection');
      analysisSection.innerHTML = `
        <div id="trendDashboard" class="analysis-card fade-up" style="max-width:900px;margin:0 auto;">
          <div class="analysis-header flex items-center justify-between">
            <div class="flex items-center gap-3">
              <iconify-icon icon="solar:chart-2-bold-duotone" width="20"></iconify-icon>
              <div>
                <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">기술 트렌드 분석 — ${years[0]}~${years[years.length-1]}년 (10개년)${patentTotal > 500 ? ` &nbsp;·&nbsp; 특허 ${patentTotal.toLocaleString()}건 중 500건 샘플 기반 추정` : ''}</p>
                <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(query)}"</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span style="font-size:11px;opacity:0.5;">${today}</span>
              <button type="button" onclick="document.getElementById('analysisSection').classList.add('hidden')" class="text-white/60 hover:text-white transition-colors">
                <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
              </button>
            </div>
          </div>
          <div class="analysis-body bg-white" style="padding:28px 32px;">
            <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:24px;">
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;flex:1;min-width:160px;">
                <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:4px;">논문 성장 단계</div>
                <div style="font-size:18px;font-weight:800;color:${paperPhase.color};">${paperPhase.icon} ${paperPhase.phase}</div>
                ${paperPhase.rate !== undefined ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">최근 3년 전기 대비 ${paperPhase.rate > 0 ? '+' : ''}${paperPhase.rate.toFixed(1)}%</div>` : ''}
              </div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;flex:1;min-width:160px;">
                <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:4px;">특허 성장 단계</div>
                <div style="font-size:18px;font-weight:800;color:${patentPhase.color};">${patentPhase.icon} ${patentPhase.phase}</div>
                ${patentPhase.rate !== undefined ? `<div style="font-size:11px;color:#6b7280;margin-top:2px;">최근 3년 전기 대비 ${patentPhase.rate > 0 ? '+' : ''}${patentPhase.rate.toFixed(1)}%</div>` : ''}
              </div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;flex:1;min-width:160px;">
                <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:4px;">10년 총 논문</div>
                <div style="font-size:18px;font-weight:800;color:#111;">${totalPapers.toLocaleString()}건</div>
                <div style="font-size:11px;color:#6b7280;margin-top:2px;">최근 3년 ${recentShareP}% 집중</div>
              </div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;flex:1;min-width:160px;">
                <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:4px;">10년 총 특허</div>
                <div style="font-size:18px;font-weight:800;color:#111;">${totalPatents.toLocaleString()}건</div>
                <div style="font-size:11px;color:#6b7280;margin-top:2px;">최근 3년 ${recentShareT}% 집중</div>
              </div>
            </div>
            <div style="background:linear-gradient(180deg,#0f172a 0%,#1e293b 100%);border-radius:16px;padding:24px 24px 16px;margin-bottom:16px;position:relative;overflow:hidden;">
              <div style="position:absolute;inset:0;background-image:linear-gradient(rgba(255,255,255,0.03) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px);background-size:40px 40px;pointer-events:none;"></div>
              <div style="position:relative;z-index:1;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:8px;">
                  <div>
                    <div style="font-size:11px;color:#94a3b8;font-weight:600;margin-bottom:4px;">연도별 발표 추이</div>
                    <div style="font-size:15px;font-weight:700;color:#f1f5f9;">논문 vs 특허 ${years[0]}–${years[years.length-1]}</div>
                  </div>
                  <div style="display:flex;gap:16px;">
                    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8;"><span style="width:24px;height:3px;background:linear-gradient(90deg,#60a5fa,#3b82f6);border-radius:2px;display:inline-block;"></span>논문</div>
                    <div style="display:flex;align-items:center;gap:6px;font-size:11px;color:#94a3b8;"><span style="width:14px;height:14px;background:rgba(251,146,60,0.8);border-radius:3px;display:inline-block;"></span>특허</div>
                  </div>
                </div>
                <div style="position:relative;height:300px;"><canvas id="trendChart"></canvas></div>
              </div>
            </div>
            <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:16px;">
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:10px;">특허화율 추이 — 특허/논문 건수</div>
              <div style="display:flex;gap:4px;">
                ${years.map((y, i) => {
                  const p = paperCounts[i], t = patentCounts[i];
                  // 특허화율: 특허÷논문×100 (연속·단방향)
                  // 낮을수록 연구–IP 전환 공백 신호가 큼. 사업화 가능성과 동일하지 않음.
                  const rate = p > 0 ? Math.round(t / p * 100) : (t > 0 ? 999 : 0);
                  const bg = rate < 30  ? '#1d4ed8'
                           : rate < 60  ? '#2563eb'
                           : rate < 90  ? '#60a5fa'
                           : rate < 110 ? '#fbbf24'
                           :              '#fb923c';
                  const textColor = (rate < 60 || rate >= 110) ? '#fff' : '#111';
                  return `<div style="flex:1;background:${bg};border-radius:6px;padding:8px 4px;text-align:center;" title="${y}년 · 특허 ${t}건 / 논문 ${p}건 · 특허화율 ${rate}% (낮을수록 연구–IP 전환 공백 신호)">
                    <div style="font-size:9px;color:${textColor};opacity:0.8;">${y}</div>
                    <div style="font-size:11px;font-weight:800;color:${textColor};line-height:1.3;">${t}/${p}</div>
                    <div style="font-size:9px;color:${textColor};opacity:0.85;">${rate}%</div>
                  </div>`;
                }).join('')}
              </div>
              <div style="font-size:9px;color:#94a3b8;margin-top:6px;">※ 특허화율 = 특허÷논문×100. 낮은 값은 연구–IP 전환 공백 신호이며, 시장성·FTO·TRL을 의미하지 않습니다.</div>
            </div>
            <div style="background:#eff6ff;border-left:4px solid #2563eb;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:20px;">
              <div style="font-size:12px;font-weight:700;color:#1d4ed8;margin-bottom:8px;">🔍 핵심 인사이트</div>
              <ul style="margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:5px;">
                ${insights.map(s => `<li style="font-size:12px;color:#1e3a5f;line-height:1.6;">• ${s}</li>`).join('')}
              </ul>
            </div>

            <!-- 산출 방법 설명 -->
            <details style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 16px;">
              <summary style="font-size:12px;font-weight:700;color:#475569;cursor:pointer;list-style:none;">📐 기술 트렌드 분석은 이렇게 산출됩니다 (계산 방법·절차)</summary>
              <div style="margin-top:12px;font-size:12px;color:#475569;line-height:1.75;">
                <ol style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:7px;">
                  <li><strong>데이터 수집</strong> — ScienceON API에서 검색어로 <strong>논문(ARTI)·특허(PATENT)</strong>를 각각 조회합니다. 항목별로 최대 <strong>500건</strong>(100건 × 5페이지)을 표본으로 가져옵니다.</li>
                  <li><strong>연도 분류</strong> — 각 레코드의 발행·출원 연도(Pubyear·PublDate·ApplDate 등)를 추출해 <strong>2017~2025년</strong> 연도별로 집계합니다. (연도 미상 레코드는 제외)</li>
                  <li><strong>전체 추정(표본 보정)</strong> — 표본이 전체보다 적으면, 연도별 표본 수에 <strong>(전체 건수 ÷ 표본 건수)</strong> 비율을 곱해 전체 분포를 추정합니다. 따라서 그래프의 막대·꺾은선은 <strong>표본 기반 추정치</strong>입니다. (상단 "특허 N건 중 500건 샘플 기반 추정" 표기 참조)</li>
                  <li><strong>성장 단계 판정</strong> — 최근 3년(2023~25) 평균과 직전 3년(2020~22) 평균의 증감률로 분류합니다: <strong>급성장</strong>(+30%↑) · <strong>성장 중</strong>(+10%↑) · <strong>성숙기</strong>(±10%) · <strong>쇠퇴 신호</strong>(−10%↓).</li>
                  <li><strong>특허화율</strong> — 연도별 <strong>특허건수 ÷ 논문건수 × 100</strong>. 낮은 값은 연구–IP 전환 공백 신호입니다. 사업화 가능성이나 특허 진입장벽은 별도 검토해야 합니다.</li>
                  <li><strong>핵심 인사이트</strong> — 위 증감률, 논문 피크 연도, 특허/논문 비중, 최근 3년 집중도를 종합해 자동 생성됩니다.</li>
                </ol>
                <p style="margin:12px 0 0 0;font-size:11px;color:#94a3b8;">※ 표본 기반 추정치이므로 실제 전수 통계와 차이가 있을 수 있습니다. 동일 검색어라도 데이터 갱신·표본에 따라 값이 달라질 수 있습니다.</p>
              </div>
            </details>
          </div>
        </div>`;

      requestAnimationFrame(() => {
        const ctx = document.getElementById('trendChart');
        if (!ctx) return;
        if (window._trendChartInstance) window._trendChartInstance.destroy();
        const c = ctx.getContext('2d');
        const paperGrad = c.createLinearGradient(0, 0, 0, 300);
        paperGrad.addColorStop(0, 'rgba(96,165,250,0.45)');
        paperGrad.addColorStop(1, 'rgba(59,130,246,0)');
        const yoyLabels = paperCounts.map((n, i) => {
          if (i === 0 || paperCounts[i-1] === 0) return '';
          const r = (n - paperCounts[i-1]) / paperCounts[i-1] * 100;
          return (r > 0 ? '+' : '') + r.toFixed(0) + '%';
        });

        window._trendChartInstance = new Chart(ctx, {
          type: 'bar',
          data: {
            labels: years.map(String),
            datasets: [
              {
                type: 'bar', label: '특허', data: patentCounts,
                backgroundColor: years.map((_, i) => i === peakPatentIdx ? 'rgba(251,146,60,0.95)' : 'rgba(251,146,60,0.65)'),
                yAxisID: 'y1', order: 2,
              },
              {
                type: 'line', label: '논문', data: paperCounts,
                borderColor: '#60a5fa', backgroundColor: paperGrad, borderWidth: 3,
                pointBackgroundColor: years.map((_, i) => i === peakPaperIdx ? '#fff' : '#3b82f6'),
                tension: 0.4, fill: true, yAxisID: 'y', order: 1,
              },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: { grid: { color: 'rgba(255,255,255,0.07)' }, ticks: { color: '#94a3b8' } },
              y: { position: 'left', min: 0, suggestedMax: Math.max(...paperCounts)*1.2, ticks: { color: '#93c5fd' } },
              y1: { position: 'right', min: 0, suggestedMax: Math.max(...patentCounts)*1.2, grid: { drawOnChartArea: false }, ticks: { color: '#fbbf24' } },
            }
          }
        });
      });
    }

    function calcChartBudgetRange(items) {
      if (!items || items.length === 0) return null;
      const budgets = items.map(t => parseInt(t.budget) || 0).filter(b => b > 0).sort((a,b)=>a-b);
      if (budgets.length === 0) return null;
      const mid = budgets[Math.floor(budgets.length/2)];
      return { min: budgets[0], max: budgets[budgets.length-1], median: mid };
    }
