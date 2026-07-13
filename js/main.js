    // ============================================================
    // Main Entry & Initialization
    // ============================================================

    (async function init() {
      // 과거 버전이 소스 기본값을 localStorage에 복사했을 수 있으므로
      // 민감값을 1회 제거한다. 이후에는 서버 환경변수 또는 수동 설정만 사용한다.
      // Browser settings are the local-development source of API credentials.
      // Explicitly saved values take precedence over js/state.js defaults.
      const browserValue = (storageKey, configKey) =>
        localStorage.getItem(storageKey) || DEFAULTS[configKey] || '';
      STATE.clientId    = browserValue('sc_client_id', 'clientId');
      STATE.token       = localStorage.getItem('sc_token') || '';
      STATE.refreshToken= localStorage.getItem('sc_refresh_token') || '';
      STATE.tokenExpire = localStorage.getItem('sc_token_expire') || '';
      STATE.apiKey      = browserValue('sc_api_key', 'apiKey');
      STATE.macAddr     = browserValue('sc_mac_addr', 'macAddr');
      STATE.ntisKey     = browserValue('sc_ntis_key', 'ntisKey');
      STATE.cerebrasKey = browserValue('sc_cerebras_key', 'cerebrasKey');
      
      initTheme();
      updateFavCount();
      await checkProxy();

      // 토큰 만료 여부 확인
      const _expireMs  = STATE.tokenExpire
        ? new Date(STATE.tokenExpire.replace(' ', 'T')).getTime() : 0;
      const _isExpired = _expireMs > 0 && _expireMs < Date.now();

      if (!STATE.token || _isExpired) {
        // ① Refresh Token으로 갱신 시도 (가장 우선)
        if (STATE.refreshToken && STATE.clientId) {
          const ok = await refreshAccessToken();
          if (!ok) await autoRequestToken();
        } else {
          // ② 신규 발급 — 로컬 프록시는 서버 등록 자격증명으로 발급하므로
          //    브라우저 자격증명이 없어도 시도한다. (autoRequestToken이 내부에서 자체 가드)
          await autoRequestToken();
        }
      } else if (STATE.token) {
        scheduleTokenRefresh();
        updateTokenExpireDisplay();
      }

      // URL 파라미터에서 자동 검색
      const urlParams = new URLSearchParams(location.search);
      const initQ = urlParams.get('q');
      const initT = urlParams.get('t');
      if (initQ) {
        document.getElementById('searchInput').value = initQ;
        if (initT && initT.startsWith('NTIS')) {
          setDatabase('NTIS');
          setTimeout(() => doNTISSearch(), 300);
        } else {
          if (initT) {
            const btn = document.querySelector(`[data-target="${initT}"]`);
            if (btn) setTarget(btn, false);
          }
          setTimeout(() => doSearch(), 300);
        }
      }
    })();

    // Global Key Events
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const active = document.activeElement;
        if (active.id === 'searchInput') doSearch();
        else if (active.id === 'compareInputA' || active.id === 'compareInputB') runCompare();
      }
      if (e.key === 'Escape') {
        closeSettings();
        closeHistory();
        closeFavorites();
        document.getElementById('analysisSection').classList.add('hidden');
      }
    });
