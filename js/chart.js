    // ============================================================
    // Visualization & Analysis (D3, Chart.js, AI Reports)
    // ============================================================

    const TREND_WINDOW_YEARS = 10;

    function getTrendPeriod(now = new Date(), span = TREND_WINDOW_YEARS) {
      const latestCompleteYear = now.getFullYear() - 1;
      const startYear = latestCompleteYear - span + 1;
      return {
        startYear,
        endYear: latestCompleteYear,
        years: Array.from({ length: span }, (_, i) => startYear + i),
      };
    }

    function summarizeTrendQuality({ status = 'ok', total = 0, fetched = 0, yearKnown = 0, yearUnknown = 0, estimated = false, direct = false, error = '' } = {}) {
      const observed = yearKnown + yearUnknown;
      const coverage = total > 0 ? Math.min(1, fetched / total) : 0;
      const yearCompleteness = observed > 0 ? yearKnown / observed : 0;
      const effectiveStatus = error || status === 'error'
        ? 'error'
        : total === 0 && status !== 'partial'
          ? 'empty'
          : status === 'partial' || coverage < 1 || yearCompleteness < 0.8 || estimated
            ? 'partial'
            : 'ok';
      return {
        status: effectiveStatus,
        total,
        fetched,
        yearKnown,
        yearUnknown,
        coverage,
        yearCompleteness,
        estimated: Boolean(estimated),
        direct: Boolean(direct),
        error: error || '',
      };
    }

    function classifyTrendPhase(counts, quality = {}) {
      const values = Array.isArray(counts) ? counts : [];
      const n = values.length;
      const total = values.reduce((sum, value) => sum + (Number(value) || 0), 0);
      if (n < 6 || total === 0 || quality.status === 'error' || quality.status === 'empty') {
        return { phase: '데이터 부족', color: '#98a2b3', icon: '—', code: 'insufficient' };
      }
      const recent = values.slice(n - 3).reduce((a, b) => a + b, 0) / 3;
      const previous = values.slice(n - 6, n - 3).reduce((a, b) => a + b, 0) / 3;
      if (previous === 0) return { phase: '신호 형성', color: '#667085', icon: '↗', code: 'emerging' };
      const rate = (recent - previous) / previous * 100;
      if (rate > 30) return { phase: '급성장', color: '#039855', icon: '↗', rate, code: 'surging' };
      if (rate > 10) return { phase: '성장 중', color: '#4f46e5', icon: '↗', rate, code: 'growing' };
      if (rate > -10) return { phase: '성숙기', color: '#b54708', icon: '→', rate, code: 'stable' };
      return { phase: '하락 신호', color: '#d92d20', icon: '↘', rate, code: 'declining' };
    }

    async function runTrendAnalysis() {
      const query = document.getElementById('searchInput').value.trim() || STATE.currentQuery || '';
      const trendPeriod = getTrendPeriod();
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
        <div class="analysis-card trend-analysis-card fade-up">
          <div class="analysis-header flex items-center gap-3">
            <iconify-icon icon="solar:chart-2-bold-duotone" width="20"></iconify-icon>
            <div>
              <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">기술 트렌드 분석 — 연도별 연구·특허 동향</p>
              <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(query)}"</p>
            </div>
          </div>
          <div class="analysis-body trend-analysis-loading">
            <div class="spinner"></div>
            <p style="color:#6b7280;font-size:13px;margin-top:12px;">${trendPeriod.startYear}~${trendPeriod.endYear}년 · 논문·특허 연도별 집계 중...</p>
          </div>
        </div>`;

      try {
        const trendData = await fetchTrendData(query);
        renderTrendDashboard(query, trendData);
      } catch (err) {
        console.error('[Trend]', err);
        analysisSection.innerHTML = `<div class="analysis-card trend-analysis-card trend-analysis-error fade-up">트렌드 분석 중 오류가 발생했습니다: ${escHtml(err.message)}</div>`;
      }
    }

    async function fetchTrendData(query) {
      const { startYear, endYear, years } = getTrendPeriod();

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

      const fetchYearDistSampled = async (target, queryObjStr) => {
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
              if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
        const yearKnown = scaled.reduce((sum, count) => sum + count, 0);
        return {
          counts: scaled,
          total,
          fetched,
          yearKnown,
          yearUnknown: Math.max(0, total - yearKnown),
          status: fetched > 0 ? 'partial' : (total === 0 ? 'empty' : 'error'),
          estimated: true,
          direct: false,
        };
      };

      // Prefer API-side year aggregation (PY). Fall back to sampled records only
      // when the endpoint cannot return year-filtered totals.
      const fetchYearDist = async (target, queryObjStr) => {
        let baseQuery;
        try { baseQuery = JSON.parse(queryObjStr); } catch { baseQuery = { BI: query }; }
        const counts = [];
        let total = 0;
        let yearKnown = 0;
        let errors = 0;
        const requestCount = async (searchQuery) => {
          const resp = await fetch(buildApiUrl(target, { searchQuery, curPage: 1, rowCount: 1 }));
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          const text = await resp.text();
          const xml = new DOMParser().parseFromString(text, 'text/xml');
          if (xml.getElementsByTagName('parsererror').length) throw new Error('XML_PARSE_ERROR');
          const err = xml.getElementsByTagName('errorCode')[0];
          if (err && err.textContent.trim()) throw new Error(err.textContent.trim());
          return getTotalCount(xml);
        };

        try {
          total = await requestCount(queryObjStr);
          if (total === 0) {
            return { counts: years.map(() => 0), total: 0, fetched: 0, yearKnown: 0, yearUnknown: 0, status: 'empty', direct: true };
          }
          for (const year of years) {
            try {
              const count = await requestCount(JSON.stringify({ ...baseQuery, PY: String(year) }));
              counts.push(count);
              yearKnown += count;
              await sleep(80);
            } catch (error) {
              errors++;
              counts.push(0);
              console.warn(`[Trend ${target}] year ${year} aggregation failed:`, error.message);
            }
          }
          if (yearKnown === 0 && total > 0) {
            const sampled = await fetchYearDistSampled(target, queryObjStr);
            return { ...sampled, status: 'partial', estimated: true, direct: false, error: 'YEAR_FILTER_UNSUPPORTED' };
          }
          return {
            counts,
            total,
            fetched: total,
            yearKnown,
            yearUnknown: Math.max(0, total - yearKnown),
            status: errors ? 'partial' : 'ok',
            direct: true,
            estimated: false,
          };
        } catch (error) {
          const sampled = await fetchYearDistSampled(target, queryObjStr);
          return {
            ...sampled,
            status: sampled.fetched > 0 ? 'partial' : 'error',
            estimated: true,
            direct: false,
            error: error.message,
          };
        }
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
        paperQuality: summarizeTrendQuality(paperResult),
        patentQuality: summarizeTrendQuality(patentResult),
        patentQueryUsed: query,
        patentTotal: patentResult.total,
      };
    }

    function renderTrendDashboard(query, { years, paperCounts, patentCounts, paperQuality, patentQuality, patentQueryUsed, patentTotal }) {
      const today = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'long', day:'numeric' });
      const paperPhase  = classifyTrendPhase(paperCounts, paperQuality);
      const patentPhase = classifyTrendPhase(patentCounts, patentQuality);
      const peakPaperIdx  = Math.max(...paperCounts) > 0 ? paperCounts.indexOf(Math.max(...paperCounts)) : -1;
      const peakPatentIdx = Math.max(...patentCounts) > 0 ? patentCounts.indexOf(Math.max(...patentCounts)) : -1;
      const totalPapers  = paperCounts.reduce((a, b) => a + b, 0);
      const totalPatents = patentCounts.reduce((a, b) => a + b, 0);
      const recent3Papers  = paperCounts.slice(-3).reduce((a, b) => a + b, 0);
      const recent3Patents = patentCounts.slice(-3).reduce((a, b) => a + b, 0);
      const recentShareP = totalPapers  > 0 ? (recent3Papers  / totalPapers  * 100).toFixed(0) : 0;
      const recentShareT = totalPatents > 0 ? (recent3Patents / totalPatents * 100).toFixed(0) : 0;
      const directAggregation = Boolean(paperQuality?.direct && patentQuality?.direct);

      const insights = [];
      if (paperQuality?.status !== 'ok') {
        insights.push(`논문 데이터는 ${paperQuality?.estimated ? '표본 기반 추정' : '부분 수집'}으로 산출되어 연도별 비교 신뢰도가 제한됩니다.`);
      }
      if (patentQuality?.status !== 'ok') {
        insights.push(`특허 데이터는 ${patentQuality?.estimated ? '표본 기반 추정' : '부분 수집'}으로 산출되어 연도별 비교 신뢰도가 제한됩니다.`);
      }
      if (paperPhase.rate !== undefined) {
        insights.push(paperPhase.rate > 0
          ? `논문 발표가 최근 3년간 평균 <strong>${paperPhase.rate.toFixed(1)}%</strong> 증가했습니다.`
          : `논문 발표가 최근 3년간 평균 <strong>${Math.abs(paperPhase.rate).toFixed(1)}%</strong> 감소 추세입니다.`);
      }
      if (peakPaperIdx < 0) {
        insights.push('논문 데이터가 없어 피크 연도와 추세를 판정할 수 없습니다.');
      } else if (peakPaperIdx === years.length - 1 || peakPaperIdx === years.length - 2) {
        insights.push(`논문 피크가 <strong>${years[peakPaperIdx]}년</strong>으로 최근 연구 활동이 정점에 있습니다.`);
      } else {
        insights.push(`논문 피크는 <strong>${years[peakPaperIdx]}년</strong>으로, 이후 관심이 분산되고 있습니다.`);
      }
      if (totalPapers > 0 && totalPatents < totalPapers * 0.05) {
        insights.push(`특허/논문 색인 비율이 낮아(<strong>${((totalPatents/totalPapers)*100).toFixed(1)}%</strong>) 연구–IP 공백 탐색 신호가 보입니다. 사업화 판단에는 추가 검증이 필요합니다.`);
      } else if (totalPapers > 0 && totalPatents > totalPapers * 0.3) {
        insights.push(`특허/논문 색인 비율이 높습니다(<strong>${((totalPatents/totalPapers)*100).toFixed(1)}%</strong>). 실제 상업화 여부는 별도 확인이 필요합니다.`);
      }
      if (parseInt(recentShareP) > 40) {
        insights.push(`최근 3년이 전체 10년 논문의 <strong>${recentShareP}%</strong>를 차지 — 최근 급부상한 토픽입니다.`);
      }

      const analysisSection = document.getElementById('analysisSection');
      analysisSection.innerHTML = `
        <div id="trendDashboard" class="analysis-card trend-analysis-card fade-up">
          <div class="analysis-header flex items-center justify-between">
            <div class="flex items-center gap-3">
              <iconify-icon icon="solar:chart-2-bold-duotone" width="20"></iconify-icon>
              <div>
                <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">기술 트렌드 분석 — ${years[0]}~${years[years.length-1]}년 (${years.length}개년)${paperQuality?.estimated || patentQuality?.estimated ? ' · 표본 기반 추정' : ''}</p>
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
          <div class="analysis-body trend-analysis-body">
            <div class="trend-kpi-grid">
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
                <div style="font-size:18px;font-weight:800;color:#273444;">${totalPapers.toLocaleString()}건</div>
                <div style="font-size:11px;color:#6b7280;margin-top:2px;">최근 3년 ${recentShareP}% 집중</div>
              </div>
              <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:12px 18px;flex:1;min-width:160px;">
                <div style="font-size:10px;color:#9ca3af;font-weight:600;margin-bottom:4px;">10년 총 특허</div>
                <div style="font-size:18px;font-weight:800;color:#273444;">${totalPatents.toLocaleString()}건</div>
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
              <div style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase;margin-bottom:10px;">특허/논문 색인 비율 추이 · 전환율이 아닌 탐색 신호</div>
              <div style="display:flex;gap:4px;">
                ${years.map((y, i) => {
                  const p = paperCounts[i], t = patentCounts[i];
                  // 특허화율: 특허÷논문×100 (연속·단방향)
                  // 낮을수록 연구–IP 전환 공백 신호가 큼. 사업화 가능성과 동일하지 않음.
                  const rate = p > 0 ? Math.round(t / p * 100) : null;
                  const displayRate = rate === null ? '—' : `${rate}%`;
                  const bg = rate === null ? '#667085'
                           : rate < 30  ? '#1d4ed8'
                           : rate < 60  ? '#2563eb'
                           : rate < 90  ? '#60a5fa'
                           : rate < 110 ? '#fbbf24'
                           :              '#fb923c';
                  const textColor = (rate < 60 || rate >= 110) ? '#fff' : '#111';
                  return `<div style="flex:1;background:${bg};border-radius:6px;padding:8px 4px;text-align:center;" title="${y}년 · 특허 ${t}건 / 논문 ${p}건 · 특허화율 ${rate}% (낮을수록 연구–IP 전환 공백 신호)">
                    <div style="font-size:9px;color:${textColor};opacity:0.8;">${y}</div>
                    <div style="font-size:11px;font-weight:800;color:${textColor};line-height:1.3;">${t}/${p}</div>
                    <div style="font-size:9px;color:${textColor};opacity:0.85;">${displayRate}</div>
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
                  <li><strong>데이터 수집</strong> — ScienceON API에서 검색어로 <strong>논문(ARTI)·특허(PATENT)</strong>를 각각 조회합니다. 연도 필터 집계를 우선 사용하며, API가 이를 지원하지 않거나 오류가 나면 항목별 최대 <strong>500건</strong>(100건 × 5페이지)을 표본으로 가져옵니다.</li>
                  <li><strong>연도 분류</strong> — 각 레코드의 발행·출원 연도(Pubyear·PublDate·ApplDate 등)를 추출해 <strong>${years[0]}~${years[years.length - 1]}년</strong> 연도별로 집계합니다. (연도 미상 레코드는 제외)</li>
                  <li><strong>전체 추정(표본 보정)</strong> — ${directAggregation ? '현재 결과는 연도별 직접 집계값을 사용하므로 표본 보정을 적용하지 않습니다.' : '연도 필터 집계를 사용할 수 없어, 표본이 전체보다 적으면 연도별 표본 수에 <strong>(전체 건수 ÷ 표본 건수)</strong> 비율을 곱해 전체 분포를 추정합니다. 따라서 그래프는 <strong>표본 기반 추정치</strong>입니다.'}</li>
                  <li><strong>성장 단계 판정</strong> — 최근 3년(${years[years.length - 3]}~${years[years.length - 1]}) 평균과 직전 3년(${years[years.length - 6]}~${years[years.length - 4]}) 평균의 증감률로 분류합니다: <strong>급성장</strong>(+30% 초과) · <strong>성장 중</strong>(+10% 초과) · <strong>성숙기</strong>(−10% 이상~+10% 이하) · <strong>쇠퇴 신호</strong>(−10% 미만).</li>
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
        paperGrad.addColorStop(0, 'rgba(102,112,133,0.28)');
        paperGrad.addColorStop(1, 'rgba(152,162,179,0)');
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
                backgroundColor: years.map((_, i) => i === peakPatentIdx ? 'rgba(234,88,12,0.92)' : 'rgba(251,146,60,0.8)'),
                yAxisID: 'y1', order: 2,
              },
              {
                type: 'line', label: '논문', data: paperCounts,
                borderColor: '#344054', backgroundColor: paperGrad, borderWidth: 3,
                pointBackgroundColor: years.map((_, i) => i === peakPaperIdx ? '#344054' : '#667085'),
                tension: 0.4, fill: true, yAxisID: 'y', order: 1,
              },
            ],
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
              x: { grid: { color: 'rgba(52,64,84,0.10)' }, ticks: { color: '#667085' } },
              y: { position: 'left', min: 0, suggestedMax: Math.max(...paperCounts)*1.2, grid: { color: 'rgba(52,64,84,0.10)' }, ticks: { color: '#667085' } },
              y1: { position: 'right', min: 0, suggestedMax: Math.max(...patentCounts)*1.2, grid: { drawOnChartArea: false }, ticks: { color: '#fdba74' } },
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
