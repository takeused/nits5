    // ============================================================
    // API & Data Fetching
    // ============================================================

    function parseScienceONError(text, fallbackStatus) {
      try {
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        const errCode = xml.querySelector('errorCode')?.textContent || xml.querySelector('code')?.textContent || '';
        const errMsg = xml.querySelector('errorMessage')?.textContent || xml.querySelector('message')?.textContent || '';
        if (errCode || errMsg) return `${errMsg || 'ScienceON API error'}${errCode ? ` (${errCode})` : ''}`;
      } catch { /* ignore XML parse failure */ }

      try {
        const data = JSON.parse(text);
        const errCode = data.errorCode || data.error_code || data.code || '';
        const errMsg = data.errorMessage || data.message || data.error || '';
        if (errCode || errMsg) return `${errMsg || 'ScienceON API error'}${errCode ? ` (${errCode})` : ''}`;
      } catch { /* ignore JSON parse failure */ }

      return `HTTP ${fallbackStatus}`;
    }

    async function doSearch(page = 1, _isRetry = false) {
      const query = document.getElementById('searchInput').value.trim();
      if (!query) {
        showToast('검색어를 입력해주세요', 'warning');
        document.getElementById('searchInput').focus();
        return;
      }
      
      document.body.classList.add('search-mode');

      if (STATE.currentTarget.startsWith('NTIS_')) {
        return doNTISSearch(page);
      }

      if (!STATE.token) {
        // 토큰이 없으면 자동 발급 시도 — 로컬 프록시는 서버 등록 자격증명으로 발급하므로
        // 브라우저 자격증명이 없어도 가능. (설정 모달을 자동으로 열지 않는다)
        if (PROXY_AVAILABLE || (STATE.clientId && STATE.apiKey && STATE.macAddr)) {
          showToast('토큰을 자동 발급하는 중입니다 ⏳', 'info');
          await autoRequestToken();
        }
        if (!STATE.token) {
          showToast('🔑 토큰 발급에 실패했습니다. 우측 상단 "API 설정"에서 확인해주세요', 'warning');
          return;
        }
      }
      if (!STATE.clientId) {
        showToast('🔑 Client ID가 필요합니다. 우측 상단 "API 설정"에서 입력해주세요', 'warning');
        return;
      }

      STATE.currentQuery = query;
      STATE.currentPage = page;
      addToHistory(query);
      updateShareUrl(query, STATE.currentTarget);

      const searchField = document.getElementById('searchField').value;
      const sortField = document.getElementById('sortField').value;
      const rowCount = parseInt(document.getElementById('rowCount').value);
      const grouping = document.getElementById('groupingCheck').checked ? 'Y' : '';

      STATE.rowCount = rowCount;

      setLoading(true);
      hideAll();
      document.getElementById('resultsHeader').classList.remove('hidden');
      document.getElementById('advancedBar').classList.toggle('hidden', !STATE.advancedOpen);

      const searchQuery = JSON.stringify({ [searchField]: query });

      const params = new URLSearchParams({
        client_id: STATE.clientId,
        token: STATE.token,
        version: '1.0',
        action: 'search',
        target: STATE.currentTarget,
        searchQuery: searchQuery,
        curPage: page,
        rowCount: rowCount,
      });

      if (sortField) params.append('sortField', sortField);
      if (grouping) params.append('grouping', grouping);

      const url = `${getApiBase()}?${params.toString()}`;

      try {
        const resp = await fetch(url);
        const text = await resp.text();
        if (!resp.ok) throw new Error(parseScienceONError(text, resp.status));

        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');

        const statusCode = xml.querySelector('statusCode')?.textContent;
        if (statusCode && statusCode !== '200') {
          const errMsg = xml.querySelector('errorMessage')?.textContent || '알 수 없는 오류';
          const errCode = xml.querySelector('errorCode')?.textContent || '';

          switch (errCode) {
            case 'E4103':
              // 토큰 만료: 갱신에 성공했을 때만 1회 재시도. 갱신 실패이거나 이미 재시도한
              // 상태면 중단한다 (무한 재귀 → 요청 폭주 → E4290 방지).
              if (STATE.refreshToken && !_isRetry) {
                const ok = await refreshAccessToken();
                if (ok) { doSearch(page, true); return; }
              }
              showToast('Access Token이 만료됐습니다. 잠시 후 다시 시도해 주세요 (E4103)', 'error');
              break;
            case 'E4290':
              showToast('요청 한도를 초과했습니다. 30초쯤 후 다시 시도해 주세요 (E4290)', 'warning');
              break;
            default:
              showToast(`${errMsg} (${errCode})`, 'error');
          }
          setLoading(false);
          return;
        }

        renderResults(xml, query);
        // 탭 괄호 건수 표기 제거 (헤더 "N건 검색됨"과 중복 + 불필요한 추가 API 호출로 rate-limit 유발)
      } catch (err) {
        console.error(err);
        showToast(`요청 실패: ${err.message}`, 'error');
        setLoading(false);
        document.getElementById('emptyState').classList.remove('hidden');
      }
    }

    // (fetchTabCounts 제거: 탭 괄호 건수 표기 기능이 폐기되어 호출처가 없던 미사용 함수)

    async function runCompare() {
      const qA = document.getElementById('compareInputA').value.trim();
      const qB = document.getElementById('compareInputB').value.trim();
      if (!qA || !qB) { showToast('두 검색어를 모두 입력하세요.', 'warning'); return; }

      document.getElementById('compareLabelA').textContent = `"${qA}" — ${getTargetLabel(STATE.currentTarget)}`;
      document.getElementById('compareLabelB').textContent = `"${qB}" — ${getTargetLabel(STATE.currentTarget)}`;
      document.getElementById('compareGridA').innerHTML = '<div class="spinner mx-auto my-8"></div>';
      document.getElementById('compareGridB').innerHTML = '<div class="spinner mx-auto my-8"></div>';

      const fetchOne = async (query) => {
        const params = new URLSearchParams({ client_id: STATE.clientId, token: STATE.token,
          version: '1.0', action: 'search', target: STATE.currentTarget,
          searchQuery: JSON.stringify({ BI: query }), curPage: 1, rowCount: 5 });
        const resp = await fetch(`${getApiBase()}?${params}`);
        const text = await resp.text();
        const xml = new DOMParser().parseFromString(text, 'text/xml');
        
        // Token Expired check
        if (xml.querySelector('errorCode')?.textContent === 'E4103') {
          const ok = await refreshAccessToken();
          if (ok) return fetchOne(query);
        }
        return xml;
      };

      try {
        const [xmlA, xmlB] = await Promise.all([fetchOne(qA), fetchOne(qB)]);
        renderCompareGrid(xmlA, 'compareGridA');
        renderCompareGrid(xmlB, 'compareGridB');
      } catch (e) { showToast('비교 검색 오류: ' + e.message, 'error'); }
    }
