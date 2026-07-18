
    // ============================================================

    function resetToHome() {
      // 완전 초기화: URL 쿼리스트링(?q=...&t=...) 제거 + 페이지 새로고침으로
      // 검색어·탭 건수·DB토글·검색결과 등 모든 상태를 깨끗이 리셋
      const cleanUrl = window.location.origin + window.location.pathname;
      window.location.replace(cleanUrl);
    }

    // 홈 화면 예시 키워드 칩 → 검색창에 채우고 바로 검색
    function runExampleSearch(kw) {
      const input = document.getElementById('searchInput');
      if (!input) return;
      input.removeAttribute('readonly');
      input.value = kw;
      input.focus();
      input.select();
    }

    // 식별자는 화면에서 말줄임하더라도 원문 전체를 한 번에 복사할 수 있게 한다.
    function copyIdentifierValue(value, trigger) {
      const text = String(value || '').trim();
      if (!text) return;
      const finish = () => {
        if (trigger) {
          trigger.classList.add('is-copied');
          setTimeout(() => trigger.classList.remove('is-copied'), 1200);
        }
        if (typeof showToast === 'function') showToast('식별자를 복사했습니다.', 'success');
      };
      const fallback = () => {
        const area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.opacity = '0';
        document.body.appendChild(area);
        area.select();
        try { document.execCommand('copy'); } finally { area.remove(); }
        finish();
      };
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(text).then(finish).catch(fallback);
      } else {
        fallback();
      }
    }

    // ============================================================

    let _tokenRefreshTimer = null;

    function scheduleTokenRefresh() {
      if (_tokenRefreshTimer) clearTimeout(_tokenRefreshTimer);
      if (!STATE.tokenExpire || !STATE.refreshToken) return;

      // 만료 시각 파싱 ("2026-04-01 22:14:53.213" → Date)
      const expireMs = new Date(STATE.tokenExpire.replace(' ', 'T')).getTime();
      if (isNaN(expireMs)) return;

      const now = Date.now();
      const msUntilExpire = expireMs - now;

      if (msUntilExpire <= 0) {
        // 이미 만료 → 즉시 갱신 시도
        console.log('[TOKEN] 이미 만료됨 → 즉시 갱신 시도');
        if (STATE.refreshToken) refreshAccessToken();
        return;
      }

      // 만료 2분 전에 자동 갱신
      const refreshDelay = Math.max(0, msUntilExpire - 2 * 60 * 1000);
      const minutesLeft = Math.round(msUntilExpire / 60000);
      console.log(`[TOKEN] 자동 갱신 예약: 약 ${minutesLeft}분 후 만료 / ${Math.round(refreshDelay / 60000)}분 후 갱신 실행`);

      _tokenRefreshTimer = setTimeout(async () => {
        if (STATE.refreshToken) {
          console.log('[TOKEN] ⏰ 만료 2분 전 자동 갱신 시작...');
          await refreshAccessToken();
        }
      }, refreshDelay);
    }

    function updateTokenExpireDisplay() {
      if (!STATE.tokenExpire || !STATE.token) return;
      const expireMs = new Date(STATE.tokenExpire.replace(' ', 'T')).getTime();
      if (isNaN(expireMs)) return;
      const msLeft = expireMs - Date.now();
      const text = document.getElementById('statusText');
      if (!text) return;

      if (msLeft <= 0) {
        text.textContent = 'API 토큰 만료됨';
        return;
      }
      const minLeft = Math.round(msLeft / 60000);
      const hrLeft  = Math.floor(minLeft / 60);
      const suffix  = minLeft < 10
        ? ` · ${minLeft}분 후 갱신`
        : hrLeft >= 1
          ? ` · ${hrLeft}h 남음`
          : '';
      if (suffix && !text.textContent.includes('남음') && !text.textContent.includes('갱신')) {
        text.textContent += suffix;
      }
    }


    async function checkProxy() {
      // 1순위: 로컬 프록시
      try {
        const res = await fetch(`${PROXY_BASE}/health`, { signal: AbortSignal.timeout(1500) });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          STATE.aiConfigured = data.aiConfigured === true;
          STATE.cerebrasConfigured = data.cerebrasConfigured;
          STATE.geminiConfigured = data.geminiConfigured === true;
          STATE.scienceOnConfigured = data.scienceOnConfigured === true;
          STATE.ntisConfigured = data.ntisConfigured === true;
          ACTIVE_PROXY = 'local'; updateProxyStatus(); return;
        }
      } catch { /* 로컬 없음 */ }

      // 2순위: Vercel Serverless (Seoul icn1 고정 리전 — NTIS IP 화이트리스트 등록 가능)
      try {
        const res = await fetch(`${VERCEL_BASE}/health`, { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
          const data = await res.json().catch(() => ({}));
          STATE.aiConfigured = data.aiConfigured === true;
          STATE.cerebrasConfigured = data.cerebrasConfigured;
          STATE.geminiConfigured = data.geminiConfigured === true;
          STATE.scienceOnConfigured = data.scienceOnConfigured === true;
          STATE.ntisConfigured = data.ntisConfigured === true;
          ACTIVE_PROXY = 'vercel'; updateProxyStatus(); return;
        }
      } catch { /* Vercel 접근 실패 */ }

      // 3순위: Cloudflare Worker (NTIS IP 차단될 수 있음)
      if (!CF_WORKER_BASE.includes('YOUR_CF_SUBDOMAIN')) {
        try {
          const res = await fetch(`${CF_WORKER_BASE}/health`, { signal: AbortSignal.timeout(4000) });
          if (res.ok) {
            const data = await res.json().catch(() => ({}));
            STATE.aiConfigured = data.aiConfigured === true;
            STATE.cerebrasConfigured = data.cerebrasConfigured;
            STATE.geminiConfigured = data.geminiConfigured === true;
            STATE.scienceOnConfigured = data.scienceOnConfigured === true;
            STATE.ntisConfigured = data.ntisConfigured === true;
            ACTIVE_PROXY = 'worker'; updateProxyStatus(); return;
          }
        } catch { /* Worker 접근 실패 */ }
      }

      ACTIVE_PROXY = 'direct';
      STATE.aiConfigured = false;
      STATE.scienceOnConfigured = false;
      STATE.ntisConfigured = false;
      updateProxyStatus();
    }

    function getProxyBase() {
      if (ACTIVE_PROXY === 'local')  return PROXY_BASE;
      if (ACTIVE_PROXY === 'vercel') return VERCEL_BASE;
      if (ACTIVE_PROXY === 'worker') return CF_WORKER_BASE;
      return null; // 직접 호출
    }

    function updateProxyStatus() {
      const dot = document.getElementById('statusDot');
      const text = document.getElementById('statusText');
      const bar = document.getElementById('apiStatus');
      const proxyBanner = document.getElementById('proxyOfflineBanner');
      const aiStatus = document.getElementById('cerebrasServerStatus');
      if (aiStatus) {
        if (BROWSER_API_MODE) {
          aiStatus.textContent = isValidCerebrasKey(STATE.cerebrasKey)
            ? '브라우저 개발 키가 설정되어 있습니다. 배포 전 반드시 제거하세요.'
            : STATE.cerebrasKey
              ? '⚠️ Cerebras API 키 형식이 올바르지 않습니다.'
              : '브라우저 개발용 Cerebras API 키를 입력하세요.';
        } else {
          aiStatus.textContent = STATE.aiConfigured
            ? '✅ 서버 AI 키가 안전하게 설정되어 있습니다.'
            : '⚠️ 서버의 CEREBRAS_API_KEY 환경변수가 필요합니다.';
        }
      }

      if (STATE.clientId && STATE.token && BROWSER_API_MODE && ACTIVE_PROXY === 'direct') {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-green-400';
        text.textContent = '브라우저 API 직접 연결됨';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-connected';
        if (proxyBanner) proxyBanner.classList.add('hidden');
      } else if (STATE.clientId && STATE.token && ACTIVE_PROXY === 'local') {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-green-400';
        text.textContent = 'API + 로컬 프록시 연결됨';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-connected';
        if (proxyBanner) proxyBanner.classList.add('hidden');
      } else if (STATE.clientId && STATE.token && ACTIVE_PROXY === 'vercel') {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
        text.textContent = VERCEL_BASE ? 'API + 원격 프록시 연결됨 (터널)' : 'API + Vercel 프록시 연결됨 (Seoul)';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-connected';
        if (proxyBanner) proxyBanner.classList.add('hidden');
      } else if (STATE.clientId && STATE.token && ACTIVE_PROXY === 'worker') {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-blue-400';
        text.textContent = 'API + Worker 프록시 연결됨 ☁️';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-connected';
        if (proxyBanner) proxyBanner.classList.add('hidden');
      } else if (STATE.clientId && STATE.token) {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-yellow-400';
        text.textContent = 'API 설정됨 (프록시 없음)';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-warn';
        if (proxyBanner) proxyBanner.classList.remove('hidden');
      } else if (ACTIVE_PROXY !== 'direct') {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-emerald-400';
        text.textContent = '프록시 연결됨 · ScienceON API 미설정';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-warn';
        if (proxyBanner) proxyBanner.classList.add('hidden');
      } else {
        dot.className = 'w-1.5 h-1.5 rounded-full bg-gray-600';
        text.textContent = 'API 미설정';
        bar.className = bar.className.replace(/api-status-\w+/g, '').trim() + ' api-status-pill';
        if (proxyBanner) proxyBanner.classList.remove('hidden');
      }

      // API 설정 버튼: 프록시가 연결되고 서버가 ScienceON 자격증명을 보유하면
      // (.env로 토큰 자동발급) 브라우저 키 입력이 불필요하므로 버튼을 숨긴다.
      // 프록시 미연결(직접 모드)이거나 서버 미설정이면 fallback으로 노출한다.
      const apiSettingsBtn = document.getElementById('apiSettingsBtn');
      if (apiSettingsBtn) {
        const serverHandlesAuth = PROXY_AVAILABLE && STATE.scienceOnConfigured;
        apiSettingsBtn.classList.toggle('hidden', serverHandlesAuth);
      }
    }

    function getApiBase() {
      const base = getProxyBase();
      return base !== null ? `${base}/api` : API_BASE_DIRECT;
    }


    // ============================================================

    // Settings
    // ============================================================

    function openSettings() {
      document.getElementById('clientIdInput').value = STATE.clientId;
      document.getElementById('tokenInput').value = STATE.token;
      document.getElementById('refreshTokenInput').value = STATE.refreshToken;
      document.getElementById('apiKeyInput').value = STATE.apiKey;
      document.getElementById('macAddrInput').value = STATE.macAddr;
      document.getElementById('ntisKeyInput').value = STATE.ntisKey;
      document.getElementById('cerebrasKeyInput').value = STATE.cerebrasKey;
      const aiModelInput = document.getElementById('aiModelModeInput');
      if (aiModelInput) aiModelInput.value = STATE.aiModelMode || AI_MODEL_MODES.GLM;
      const aiStatus = document.getElementById('cerebrasServerStatus');
      if (aiStatus) {
        aiStatus.textContent = BROWSER_API_MODE
          ? isValidCerebrasKey(STATE.cerebrasKey)
            ? '브라우저 개발 키가 설정되어 있습니다. 배포 전 반드시 제거하세요.'
            : STATE.cerebrasKey
              ? '⚠️ Cerebras API 키 형식이 올바르지 않습니다.'
              : '브라우저 개발용 Cerebras API 키를 입력하세요.'
          : STATE.aiConfigured
            ? '✅ 서버 AI 키가 안전하게 설정되어 있습니다.'
            : '⚠️ 서버의 CEREBRAS_API_KEY 환경변수가 필요합니다.';
      }
      document.getElementById('tokenReqResult').classList.add('hidden');
      document.getElementById('settingsModal').classList.remove('hidden');
    }

    function closeSettings() {
      document.getElementById('settingsModal').classList.add('hidden');
    }

    // 입력 즉시 자동 저장 (개별 필드)
    function normalizeCerebrasKey(value) {
      const raw = String(value || '').trim().replace(/^Bearer\s+/i, '');
      const embedded = raw.match(/csk-[A-Za-z0-9_-]{16,}/);
      return embedded ? embedded[0] : raw;
    }

    function isValidCerebrasKey(value) {
      return /^csk-[A-Za-z0-9_-]{16,}$/.test(normalizeCerebrasKey(value));
    }

    const AI_MODEL_MODES = Object.freeze({
      GPT: 'gpt-oss-120b',
      GLM: 'zai-glm-4.7',
      COMPARE: 'compare-gpt-glm',
    });

    function getActiveCerebrasModel() {
      return STATE.aiModelMode === AI_MODEL_MODES.GLM ? AI_MODEL_MODES.GLM : AI_MODEL_MODES.GPT;
    }

    function isModelExperimentMode() {
      return STATE.aiModelMode === AI_MODEL_MODES.COMPARE;
    }

    function getCerebrasModelLabel(modelId) {
      if (modelId === AI_MODEL_MODES.GLM) return 'zai-glm-4.7';
      if (modelId === AI_MODEL_MODES.GPT) return 'gpt-oss-120b';
      return modelId || 'unknown';
    }

    function prepareCerebrasBody(body, modelOverride = null) {
      const requestedModel = body?.model;
      const activeModel = getActiveCerebrasModel();
      const model = modelOverride
        || (requestedModel === AI_MODEL_MODES.GPT ? activeModel : requestedModel)
        || activeModel;
      const payload = { ...(body || {}), model };
      // GLM reasoning is enabled by default and does not accept the GPT-OSS
      // graduated high/medium/low setting. Keep only portable parameters.
      if (model !== AI_MODEL_MODES.GPT && payload.reasoning_effort && payload.reasoning_effort !== 'none') {
        delete payload.reasoning_effort;
      }
      return payload;
    }

    function hasAIAccess() {
      // 프록시가 서버 CEREBRAS_API_KEY를 보유하면(aiConfigured) 브라우저 키 없이도 사용 가능.
      // 그 외(직접 모드/서버 키 없음)에는 브라우저 입력 키를 요구한다.
      if (getProxyBase() !== null && STATE.aiConfigured) return true;
      return isValidCerebrasKey(STATE.cerebrasKey);
    }

    // ── Gemini 사용 동의 ────────────────────────────────────────────
    // 대체 AI(Gemini)를 쓰면 검색어·논문 제목 등 분석 입력이 Google 서버로 전송되므로
    // 자동 전환하지 않고 최초 사용 시 명시적 승인을 받는다.
    // 승인은 localStorage에 저장(다음 방문에 재질문 없음), 거부는 세션 한정
    // (거부가 영구 고정되어 다음 방문에 AI를 아예 못 쓰는 상황을 피한다).
    let _geminiConsentSession = null;   // 'granted' | 'denied' | null
    let _geminiConsentPending = null;   // 동시 호출이 모달을 여러 개 띄우지 않도록 공유

    function geminiConsentState() {
      if (_geminiConsentSession) return _geminiConsentSession;
      return localStorage.getItem('sc_gemini_consent') === 'granted' ? 'granted' : null;
    }

    function resetGeminiConsent() {
      _geminiConsentSession = null;
      localStorage.removeItem('sc_gemini_consent');
      showToast('Gemini 사용 승인을 초기화했습니다. 다음 사용 시 다시 확인합니다.', 'info');
    }

    async function ensureGeminiConsent() {
      const known = geminiConsentState();
      if (known === 'granted') return true;
      if (known === 'denied') return false;
      if (_geminiConsentPending) return _geminiConsentPending;
      _geminiConsentPending = showGeminiConsentDialog().then(approved => {
        _geminiConsentSession = approved ? 'granted' : 'denied';
        if (approved) localStorage.setItem('sc_gemini_consent', 'granted');
        _geminiConsentPending = null;
        return approved;
      });
      return _geminiConsentPending;
    }

    function showGeminiConsentDialog() {
      return new Promise(resolve => {
        const overlay = document.createElement('div');
        overlay.style.cssText = 'position:fixed;inset:0;background:rgba(15,23,42,0.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;';
        overlay.innerHTML = `
          <div role="dialog" aria-modal="true" aria-labelledby="geminiConsentTitle"
               style="background:#fff;border-radius:14px;max-width:420px;width:100%;padding:22px 24px;box-shadow:0 20px 50px rgba(0,0,0,0.25);">
            <p id="geminiConsentTitle" style="font-size:15px;font-weight:800;color:#111;margin:0 0 10px;">🤖 대체 AI(Gemini) 사용 승인</p>
            <p style="font-size:12.5px;color:#374151;line-height:1.65;margin:0 0 10px;">
              기본 AI(Cerebras)를 사용할 수 없습니다. 계속하려면 <strong>Google Gemini</strong>로 전환해야 합니다.
            </p>
            <p style="font-size:12px;color:#6b7280;line-height:1.6;margin:0 0 14px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:10px 12px;">
              승인하면 분석 입력(검색어, 조회된 논문·특허 제목 등)이 <strong>Google 서버로 전송</strong>됩니다.
              승인 여부는 이 브라우저에 저장되며, 거부하면 AI 단계는 실행되지 않습니다.
            </p>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
              <button type="button" data-act="deny"
                style="padding:8px 14px;border-radius:8px;border:1px solid #d1d5db;background:#fff;color:#374151;font-size:12.5px;font-weight:600;cursor:pointer;">사용 안 함</button>
              <button type="button" data-act="allow"
                style="padding:8px 14px;border-radius:8px;border:1px solid #111;background:#111;color:#fff;font-size:12.5px;font-weight:700;cursor:pointer;">승인하고 계속</button>
            </div>
          </div>`;
        const finish = (approved) => {
          document.removeEventListener('keydown', onKey);
          overlay.remove();
          resolve(approved);
        };
        const onKey = (e) => { if (e.key === 'Escape') finish(false); };
        overlay.addEventListener('click', (e) => {
          const act = e.target.closest('button')?.dataset.act;
          if (act === 'allow') finish(true);
          else if (act === 'deny') finish(false);
          else if (e.target === overlay) finish(false);
        });
        document.addEventListener('keydown', onKey);
        document.body.appendChild(overlay);
        overlay.querySelector('[data-act="allow"]')?.focus();
      });
    }

    // AI 인증키는 가능하면 서버 프록시에서만 주입한다. 프록시가 서버 키를 보유하면
    // 프록시를 경유하고, 그렇지 않으면 브라우저 입력 키로 직접 호출한다.
    // Cerebras가 막히는 환경을 위해 Gemini(/gemini) 대체 경로를 둔다 — Google의
    // OpenAI 호환 엔드포인트라 응답 형식이 같아 호출부는 수정할 필요가 없다.
    // 단, Gemini 전환은 사용자 승인을 받은 뒤에만 수행한다.
    async function cerebrasChat(body, timeoutMs = 30000, options = {}) {
      const payload = prepareCerebrasBody(body, options.model);

      // 1순위: 프록시가 서버 키 보유 시 프록시 경유 (브라우저에 키 노출 안 함)
      const proxyBase = getProxyBase();
      if (proxyBase !== null && STATE.aiConfigured) {
        const postTo = async (endpoint) => {
          const ctrl = new AbortController();
          const timer = setTimeout(() => ctrl.abort(), timeoutMs);
          try {
            return await fetch(`${proxyBase}${endpoint}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: ctrl.signal,
            });
          } finally {
            clearTimeout(timer);
          }
        };

        // 서버가 어떤 키를 가졌는지 /health로 파악한 값에 따라 시도 순서를 정한다.
        // (구버전 프록시는 두 플래그가 없으므로 Cerebras를 기본으로 시도)
        const hasCerebras = STATE.cerebrasConfigured !== false;
        const hasGemini   = STATE.geminiConfigured === true;

        if (hasCerebras) {
          try {
            const resp = await postTo('/cerebras');
            if (resp.ok || !hasGemini) return resp;
            // 승인받지 못하면 전환하지 않고 원래 실패 응답을 그대로 돌려준다.
            if (!await ensureGeminiConsent()) return resp;
            console.warn(`[AI] Cerebras 실패(HTTP ${resp.status}) → 승인됨, Gemini로 전환`);
          } catch (error) {
            if (!hasGemini) throw error;
            if (!await ensureGeminiConsent()) throw error;
            console.warn('[AI] Cerebras 호출 실패 → 승인됨, Gemini로 전환:', error.message);
          }
          return postTo('/gemini');
        }
        if (hasGemini) {
          // Cerebras 키가 아예 없는 경우 — Gemini가 유일한 경로여도 승인은 받는다.
          if (!await ensureGeminiConsent()) throw new Error('GEMINI_CONSENT_DECLINED');
          return postTo('/gemini');
        }
        return postTo('/cerebras');
      }

      // 2순위: 브라우저 입력 키로 직접 호출 (직접 모드 / 프록시에 키 없음)
      const cerebrasKey = normalizeCerebrasKey(STATE.cerebrasKey);
      if (!isValidCerebrasKey(cerebrasKey)) {
        throw new Error(proxyBase === null ? 'AI_SERVER_UNAVAILABLE' : 'AI_KEY_INVALID');
      }
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        return await fetch('https://api.cerebras.ai/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${cerebrasKey}`,
          },
          body: JSON.stringify(payload),
          signal: ctrl.signal,
        });
      } finally {
        clearTimeout(timer);
      }
    }

    function autoSaveField(lsKey, value, stateKey) {
      let v = value.trim();
      if (stateKey === 'cerebrasKey' && isValidCerebrasKey(v)) v = normalizeCerebrasKey(v);
      if (stateKey === 'aiModelMode' && !Object.values(AI_MODEL_MODES).includes(v)) v = AI_MODEL_MODES.GLM;
      STATE[stateKey] = v;
      localStorage.setItem(lsKey, v);
      updateProxyStatus();
    }

    function saveSettings() {
      STATE.clientId = document.getElementById('clientIdInput').value.trim();
      STATE.token = document.getElementById('tokenInput').value.trim();
      STATE.refreshToken = document.getElementById('refreshTokenInput').value.trim();
      STATE.apiKey = document.getElementById('apiKeyInput').value.trim();
      STATE.macAddr = document.getElementById('macAddrInput').value.trim();
      STATE.ntisKey = document.getElementById('ntisKeyInput').value.trim();
      const aiModelInput = document.getElementById('aiModelModeInput');
      STATE.aiModelMode = aiModelInput?.value || STATE.aiModelMode || AI_MODEL_MODES.GLM;
      if (!Object.values(AI_MODEL_MODES).includes(STATE.aiModelMode)) STATE.aiModelMode = AI_MODEL_MODES.GLM;
      const rawCerebrasKey = document.getElementById('cerebrasKeyInput').value.trim();
      if (BROWSER_API_MODE && rawCerebrasKey && !isValidCerebrasKey(rawCerebrasKey)) {
        showToast('Cerebras API 키 형식이 올바르지 않습니다. csk-로 시작하는 키만 입력해주세요.', 'warning');
        document.getElementById('cerebrasKeyInput').focus();
        return;
      }
      STATE.cerebrasKey = normalizeCerebrasKey(rawCerebrasKey);

      localStorage.setItem('sc_client_id', STATE.clientId);
      localStorage.setItem('sc_token', STATE.token);
      localStorage.setItem('sc_refresh_token', STATE.refreshToken);
      localStorage.setItem('sc_api_key', STATE.apiKey);
      localStorage.setItem('sc_mac_addr', STATE.macAddr);
      localStorage.setItem('sc_ntis_key', STATE.ntisKey);
      localStorage.setItem('sc_cerebras_key', STATE.cerebrasKey);
      localStorage.setItem('sc_ai_model_mode', STATE.aiModelMode);
      // tokenExpire는 발급 시 자동 저장되므로 여기서는 재스케줄만 수행
      STATE.tokenExpire = localStorage.getItem('sc_token_expire') || STATE.tokenExpire;
      scheduleTokenRefresh();

      updateApiStatus();
      closeSettings();
      showToast('API 설정이 저장되었습니다', 'success');
    }

    function clearSettings() {
      STATE.clientId = '';
      STATE.token = '';
      STATE.refreshToken = '';
      STATE.apiKey = '';
      STATE.macAddr = '';
      STATE.ntisKey = '';
      STATE.cerebrasKey = '';
      STATE.aiModelMode = AI_MODEL_MODES.GLM;
      ['sc_client_id', 'sc_token', 'sc_refresh_token', 'sc_api_key', 'sc_mac_addr', 'sc_ntis_key', 'sc_cerebras_key', 'sc_ai_model_mode'].forEach(k => localStorage.removeItem(k));

      ['clientIdInput', 'tokenInput', 'refreshTokenInput', 'apiKeyInput', 'macAddrInput', 'ntisKeyInput', 'cerebrasKeyInput'].forEach(id => {
        document.getElementById(id).value = '';
      });
      const aiModelInput = document.getElementById('aiModelModeInput');
      if (aiModelInput) aiModelInput.value = AI_MODEL_MODES.GLM;

      updateApiStatus();
      showToast('API 설정이 초기화되었습니다', 'info');
    }

    // updateApiStatus는 updateProxyStatus로 통합됨
    function updateApiStatus() { updateProxyStatus(); }

    // ============================================================

    // Target Selection
    // ============================================================

    function setDatabase(db) {
      STATE.currentDB = db;
      const btnSci = document.getElementById('btnDbScienceON');
      const btnNtis = document.getElementById('btnDbNTIS');
      const tabsSci = document.getElementById('tabsScienceON');
      const tabsNtis = document.getElementById('tabsNTIS');

      if (db === 'SCIENCEON') {
        btnSci.classList.add('active');
        btnNtis.classList.remove('active');
        tabsSci.classList.remove('hidden');
        tabsNtis.classList.add('hidden');
        
        const defaultSciBtn = tabsSci.querySelector('[data-target="ARTI"]');
        if (defaultSciBtn) setTarget(defaultSciBtn, false);
      } else {
        btnSci.classList.remove('active');
        btnNtis.classList.add('active');
        tabsSci.classList.add('hidden');
        tabsNtis.classList.remove('hidden');
        
        const defaultNtisBtn = tabsNtis.querySelector('[data-target="NTIS_prjt"]');
        if (defaultNtisBtn) setTarget(defaultNtisBtn, false);
      }
      
      // 만약 검색어가 있다면 즉시 재검색하여 결과 업데이트
      const query = document.getElementById('searchInput').value.trim();
      if (query && document.body.classList.contains('search-mode')) {
        STATE.currentPage = 1;
        if (db === 'NTIS') doNTISSearch();
        else doSearch();
      }
      
      document.getElementById('searchInput').focus();
    }

    function setTarget(btn, triggerSearch = true) {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.currentTarget = btn.dataset.target;
      const isNTIS = STATE.currentTarget.startsWith('NTIS_');
      updateSearchFieldOptions();

      // If query exists, re-search
      if (triggerSearch && STATE.currentQuery) {
        STATE.currentPage = 1;
        if (isNTIS) {
          doNTISSearch();
        } else {
          doSearch();
        }
      }
    }

    function updateSearchFieldOptions() {
      const sel = document.getElementById('searchField');
      const target = STATE.currentTarget;
      const isNTIS = target.startsWith('NTIS_');

      // NTIS 전용 필터 UI 토글
      document.getElementById('ntisYearFilter').classList.toggle('hidden', !isNTIS);
      document.getElementById('groupingWrapper').classList.toggle('hidden', isNTIS);
      const sortField = document.getElementById('sortField');
      if (sortField) sortField.closest('.flex.items-center.gap-2')?.classList.toggle('hidden', isNTIS);

      let options = [['BI', '전체'], ['TI', '제목/명칭']];

      if (isNTIS) {
        // PDF 24 기관용 통합검색 searchFd 코드
        options = [
          ['BI', '전체'],
          ['TI', '과제명'],
          ['AU', '연구자'],
          ['OG', '수행기관'],
          ['PB', '발주기관'],
          ['KW', '키워드'],
          ['AB', '초록'],
        ];
      } else if (['ARTI', 'REPORT', 'ATT'].includes(target)) {
        options.push(['AU', '저자'], ['AB', '초록'], ['KW', '키워드'], ['PB', '출판사/기관'], ['PY', '발행년도']);
      } else if (target === 'PATENT') {
        options = [
          ['BI', '전체'], ['TI', '발명 명칭'], ['AB', '초록'],
          ['PA', '출원인'], ['IN', '발명자'], ['IC', 'IPC 분류'],
          ['AN', '출원번호'], ['RN', '등록번호'], ['AD', '출원일자'],
        ];
      } else if (target === 'RESEARCHER') {
        options = [['BI', '전체'], ['TI', '연구자명']];
      } else if (target === 'ORGAN') {
        options = [['BI', '전체'], ['TI', '기관명']];
      } else if (target === 'TREND') {
        options = [['BI', '전체'], ['TI', '트렌드명'], ['KW', '키워드']];
      }

      sel.innerHTML = options.map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
    }

    // ============================================================

    // Advanced toggle
    // ============================================================

    function toggleAdvanced() {
      STATE.advancedOpen = !STATE.advancedOpen;
      const bar = document.getElementById('advancedBar');
      const btn = document.getElementById('advancedToggle');
      bar.classList.toggle('hidden', !STATE.advancedOpen);
      btn.classList.toggle('btn-active-accent', STATE.advancedOpen);
    }

    // ============================================================

    // doSearch / fetchTabCounts 는 api.js 에서 정의·실행됨
    // (이전 ui.js 중복 정의는 덮어쓰여 실행되지 않던 죽은 코드여서 제거)

    async function doNTISSearch(page = 1) {
      // 프록시가 서버 NTIS_API_KEY를 보유하면(ntisConfigured) 브라우저 키 없이도 검색 가능.
      // 직접 모드이거나 서버에 키가 없을 때만 브라우저 입력 키를 요구한다.
      if (!STATE.ntisKey && !(PROXY_AVAILABLE && STATE.ntisConfigured)) {
        showToast('🔑 NTIS 인증키가 필요합니다. 상단 "API 설정"에서 입력해주세요', 'warning');
        return;
      }

      // 검색 모드 도입 (Google 스타일)
      document.body.classList.add('search-mode');
      
      const query = document.getElementById('searchInput').value.trim();
      STATE.currentQuery = query;
      STATE.currentPage = page;
      addToHistory(query);
      updateShareUrl(query, 'NTIS_prjt');

      const searchField = document.getElementById('searchField').value;
      const rowCount = parseInt(document.getElementById('rowCount').value);
      STATE.rowCount = rowCount;
      
      setLoading(true);
      hideAll();
      document.getElementById('resultsHeader').classList.remove('hidden');
      document.getElementById('advancedBar').classList.toggle('hidden', !STATE.advancedOpen);
      
      const collection = 'project'; // 기관용 통합검색: 과제만 사용

      // PDF 24 기관용 searchFd: 코드값을 그대로 전달 (BI/TI/AU/OG/PB/KW/AB)
      const searchFd = (searchField && searchField !== 'BI') ? searchField : '';

      // 연도 필터 (addQuery=PY=FROM/MORE,TO/UNDER)
      const yearFrom = document.getElementById('ntisYearFrom')?.value?.trim();
      const yearTo   = document.getElementById('ntisYearTo')?.value?.trim();
      let addQuery = '';
      if (yearFrom && yearTo)   addQuery = `PY=${yearFrom}/MORE,${yearTo}/UNDER`;
      else if (yearFrom)        addQuery = `PY=${yearFrom}/MORE`;
      else if (yearTo)          addQuery = `PY=${yearTo}/UNDER`;

      const startPosition = (page - 1) * rowCount + 1;

      const params = new URLSearchParams({
        apprvKey: STATE.ntisKey,
        collection: collection,
        displayCnt: rowCount,
        startPosition: startPosition,
        SRWR: query,       // NTIS 최신 API 검색 파라미터 (PDF 공식 매뉴얼 기준)
        query: query,      // 기존 하위 호환성용 병행 전송
        searchRnkn: 'Y',
        naviCount: 5
      });
      if (searchFd) params.append('searchFd', searchFd);
      if (addQuery)  params.append('addQuery', addQuery);
      
      const proxyBase = getProxyBase();
      if (proxyBase === null && !BROWSER_API_MODE) {
        setLoading(false);
        document.getElementById('emptyState').classList.add('hidden');
        // 직접 NTIS URL 생성 (프록시 없이 브라우저에서 열기용)
        const directParams = new URLSearchParams(params);
        const directUrl = `https://www.ntis.go.kr/rndopen/openApi/totalRstSearch?${directParams.toString()}`;
        const grid = document.getElementById('resultsGrid');
        grid.innerHTML = `<div class="p-5 rounded-2xl" style="border:1px solid rgba(251,146,60,0.3);background:rgba(251,146,60,0.05);">
          <p class="text-orange-300 font-semibold mb-2">⚠️ 프록시 서버가 연결되어 있지 않습니다</p>
          <p class="text-gray-400 text-sm mb-3">아래 URL을 새 탭에서 열어 NTIS 응답을 직접 확인하세요.</p>
          <p class="text-xs text-gray-500 mb-1 font-semibold">NTIS 직접 URL:</p>
          <code class="text-xs text-blue-300 break-all block p-2 rounded mb-3" style="background:rgba(0,0,0,0.4);">${escHtml(directUrl)}</code>
          <button onclick="window.open('${escAttr(directUrl)}','_blank')" class="btn-secondary text-xs">새 탭에서 NTIS 직접 호출</button>
          <p class="text-gray-500 text-xs mt-3">로컬 프록시: <code class="text-green-400">node proxy-server.js</code> 실행 후 새로고침</p>
        </div>`;
        return;
      }

      const url = proxyBase === null
        ? `${NTIS_BASE}/rndopen/openApi/totalRstSearch?${params.toString()}`
        : `${proxyBase}/ntis?${params.toString()}`;

      try {
        const resp = await fetch(url);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const text = await resp.text();

        // [DEBUG] NTIS 응답 저장 (디버그 패널용)
        window._ntisDebug = { url, raw: text };
        console.log('[NTIS-DEBUG] URL:', url);
        console.log('[NTIS-DEBUG] RAW TEXT:', text);

        const parser = new DOMParser();
        const xml = parser.parseFromString(text, 'text/xml');

        // NTIS 오류 응답 파싱: <RESULT><ERROR><CODE>/<MESSAGE> 또는 <returnCode>/<returnMsg>
        const gx = (tag) => xml.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
        const errCode = gx('CODE') || gx('returnCode');
        const errMsg  = gx('MESSAGE') || gx('returnMsg');
        if (errCode && errCode !== '0') {
           const isIpBlock = errMsg.includes('IP');
           showToast(`NTIS 오류 [${errCode}]: ${errMsg}`, 'error');
           document.getElementById('emptyState').classList.add('hidden');
           document.getElementById('resultsGrid').innerHTML = `<div class="p-5 rounded-2xl" style="border:1px solid rgba(239,68,68,0.3);background:rgba(239,68,68,0.05);">
             <p class="text-red-400 font-semibold mb-1">NTIS API 오류 [${escHtml(errCode)}]</p>
             <p class="text-gray-300 text-sm mb-3">${escHtml(errMsg)}</p>
             ${isIpBlock ? `<div class="p-3 rounded-lg text-xs space-y-1" style="background:rgba(0,0,0,0.3);">
               <p class="text-yellow-300 font-semibold">IP 차단 해결 방법</p>
               <p class="text-gray-400">Cloudflare Worker IP는 NTIS에 등록되지 않아 차단됩니다.</p>
               <p class="text-green-300 mt-2 font-semibold">→ 로컬 프록시를 사용하세요:</p>
               <code class="text-green-400 block mt-1">node proxy-server.js</code>
               <p class="text-gray-500 mt-1">실행 후 페이지를 새로고침하면 로컬 프록시(127.0.0.1:3737)로 자동 전환됩니다.</p>
             </div>` : ''}
             <p class="text-xs text-gray-600 mt-3 break-all">요청 URL: ${escHtml(url)}</p>
           </div>`;
           setLoading(false);
           return;
        }

        renderNTISResults(xml, query, collection);
      } catch (err) {
        console.error(err);
        if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
          showCORSGuide(url);
        } else {
          showToast(`NTIS 요청 실패: ${err.message}`, 'error');
        }
        setLoading(false);
        document.getElementById('emptyState').classList.remove('hidden');
      }
    }

    // ============================================================

    function encryptNTISAccounts(apiKey, macAddr) {
      if (typeof CryptoJS === 'undefined') return null;

      try {
        // ScienceON spec: AES-256-CBC, UTF-8 key, IV=jvHJ1EFA0IXBrxxz, datetime=yyyyMMddHHmmss, then URIEncode standard Base64.
        const now = new Date();
        const pad = n => String(n).padStart(2, '0');
        const datetime = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        const accountsJson = JSON.stringify({ mac_address: macAddr, datetime }).replace(/ /g, '');

        const key = CryptoJS.enc.Utf8.parse(apiKey);
        const iv = CryptoJS.enc.Utf8.parse('jvHJ1EFA0IXBrxxz');
        const encrypted = CryptoJS.AES.encrypt(accountsJson, key, {
          iv, mode: CryptoJS.mode.CBC, padding: CryptoJS.pad.Pkcs7,
        });

        // ScienceON 실측 정답: IV 프리펜드 없이 ciphertext만 → URL-safe base64
        // (IV를 앞에 붙이면 KISTI 복호화 실패로 E4006 발생)
        return encrypted.ciphertext.toString(CryptoJS.enc.Base64)
          .replace(/\+/g, '-').replace(/\//g, '_');
      } catch (e) {
        console.error('Encryption failed:', e);
        return null;
      }
    }

    // ============================================================

    async function autoRequestToken() {
      const clientId = STATE.clientId;
      const apiKey = STATE.apiKey;
      const macAddr = STATE.macAddr;

      try {
        let url;
        if (BROWSER_API_MODE && !PROXY_AVAILABLE) {
          // 직접 발급: 브라우저 자격증명으로 accounts를 암호화해야 하므로 필수
          if (!clientId || !apiKey || !macAddr) return;
          const accounts = encryptNTISAccounts(apiKey, macAddr);
          if (!accounts) return;
          url = `${TOKEN_URL_DIRECT}?accounts=${encodeURIComponent(accounts)}&client_id=${encodeURIComponent(clientId)}`;
        } else if (ACTIVE_PROXY === 'worker') {
          if (!clientId || !apiKey || !macAddr) return;
          const accounts = encryptNTISAccounts(apiKey, macAddr);
          if (!accounts) return;
          url = `${getProxyBase()}/token?accounts=${encodeURIComponent(accounts)}&client_id=${encodeURIComponent(clientId)}`;
        } else {
          // 로컬 프록시: 서버가 등록(REGISTERED) 자격증명으로 발급하므로
          // 브라우저에 api_key/mac_address가 없어도 토큰이 발급된다.
          const params = new URLSearchParams();
          if (clientId) params.set('client_id', clientId);
          if (apiKey) params.set('api_key', apiKey);
          if (macAddr) params.set('mac_address', macAddr);
          url = `${getProxyBase()}/token?${params}`;
        }

        const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
        const data = await resp.json();

        if (data.access_token) {
          if (data.client_id) {
            STATE.clientId = data.client_id;
            localStorage.setItem('sc_client_id', STATE.clientId);
          }
          STATE.token       = data.access_token;
          STATE.tokenExpire = data.access_token_expire || '';
          if (data.refresh_token) STATE.refreshToken = data.refresh_token;
          localStorage.setItem('sc_token', STATE.token);
          localStorage.setItem('sc_token_expire', STATE.tokenExpire);
          localStorage.setItem('sc_refresh_token', STATE.refreshToken);
          updateProxyStatus();
          scheduleTokenRefresh();   // ⏰ 자동 갱신 예약
          updateTokenExpireDisplay();
          showToast('✅ 토큰 자동 발급 완료! 검색할 수 있습니다', 'success');
        }
      } catch (e) {
        console.warn('자동 토큰 발급 실패:', e.message);
      }
    }

    // ============================================================

    async function requestToken() {
      const clientId = document.getElementById('clientIdInput').value.trim();
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const macAddr = document.getElementById('macAddrInput').value.trim();
      const resultEl = document.getElementById('tokenReqResult');
      const btn = document.getElementById('tokenReqBtn');

      if (!clientId || !apiKey || !macAddr) {
        resultEl.className = 'token-result-err';
        resultEl.textContent = 'Client ID, 인증키, MAC 주소를 모두 입력해주세요.';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;"></span> 발급 중...';
      resultEl.className = '';
      resultEl.textContent = '';

      // 프록시 서버 가용 여부 재확인
      await checkProxy();

      try {
        let data;

        if (PROXY_AVAILABLE) {
          // ── 방법 1: 프록시 서버 사용
          let url;
          if (ACTIVE_PROXY === 'worker') {
            // Worker는 암호화된 accounts 파라미터를 기대함
            const accounts = encryptNTISAccounts(apiKey, macAddr);
            if (!accounts) throw new Error('CryptoJS 로드 실패 (암호화 불가)');
            url = `${getProxyBase()}/token?accounts=${encodeURIComponent(accounts)}&client_id=${encodeURIComponent(clientId)}`;
          } else {
            // 로컬 프록시는 raw 파라미터를 받아 직접 암호화함
            url = `${getProxyBase()}/token?client_id=${encodeURIComponent(clientId)}&api_key=${encodeURIComponent(apiKey)}&mac_address=${encodeURIComponent(macAddr)}`;
          }
          const resp = await fetch(url);
          data = await resp.json();
        } else {
          // ── 방법 2: 브라우저에서 직접 시도 (Proxy 없이 KISTI 직접 호출)
          const accounts = encryptNTISAccounts(apiKey, macAddr);
          if (!accounts) {
            resultEl.className = 'token-result-err';
            resultEl.innerHTML = `
          <strong>CryptoJS 로드 실패</strong><br><br>
          해결 방법:<br>
          1. 터미널에서 <code style="background:#1a1a1a;padding:2px 4px;border-radius:3px;">node proxy-server.js</code> 실행 후 재시도<br>
          2. 또는 인터넷 연결 확인 (CryptoJS CDN)
        `;
            btn.disabled = false;
            btn.innerHTML = '<iconify-icon icon="solar:key-square-bold-duotone" width="18"></iconify-icon> Access Token 자동 발급';
            return;
          }

          const tokenUrl = `${TOKEN_URL_DIRECT}?accounts=${encodeURIComponent(accounts)}&client_id=${encodeURIComponent(clientId)}`;
          const resp = await fetch(tokenUrl);
          if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
          data = await resp.json();
        }

        if (data.access_token) {
          // STATE + localStorage에 즉시 저장 (저장 버튼 없이도 유지)
          STATE.token = data.access_token;
          localStorage.setItem('sc_token', STATE.token);
          if (data.refresh_token) {
            STATE.refreshToken = data.refresh_token;
            localStorage.setItem('sc_refresh_token', STATE.refreshToken);
          }
          const expire = data.access_token_expire || '';
          STATE.tokenExpire = expire;
          localStorage.setItem('sc_token_expire', expire);
          // 입력 필드도 반영
          document.getElementById('tokenInput').value = STATE.token;
          if (data.refresh_token) document.getElementById('refreshTokenInput').value = STATE.refreshToken;
          scheduleTokenRefresh();
          updateTokenExpireDisplay();
          updateProxyStatus();
          resultEl.className = 'token-result-ok';
          resultEl.textContent = `✅ 토큰 발급 성공! 만료: ${expire || '2시간 후'} — 자동 저장됨`;
        } else {
          throw new Error(data.error || data.message || JSON.stringify(data));
        }
      } catch (err) {
        resultEl.className = 'token-result-err';
        const msg = err.message || '';
        if (err.name === 'TypeError' && msg.includes('fetch')) {
          resultEl.innerHTML = `
        연결 오류 — 프록시 서버 또는 API 서버에 접속할 수 없습니다.<br><br>
        <strong>해결:</strong> 터미널에서 <code style="background:#1a1a1a;padding:3px 6px;border-radius:4px;display:inline-block;margin-top:4px;">node proxy-server.js</code> 실행 확인
      `;
        } else if (msg.includes('E4006')) {
          resultEl.innerHTML = `오류 E4006: 암호화 실패 — 인증키(AES256)가 ScienceON에 등록된 키와 일치하는지 확인하세요. (32자리 영문/숫자)`;
        } else if (msg.includes('E4107')) {
          resultEl.innerHTML = `오류 E4107: MAC 주소 불일치 — ScienceON에 등록된 MAC 주소와 다릅니다. <strong>자동 탐색</strong> 버튼을 눌러 올바른 형식을 찾아보세요.`;
        } else {
          resultEl.textContent = `오류: ${msg}`;
        }
      } finally {
        btn.disabled = false;
        btn.innerHTML = '<iconify-icon icon="solar:key-square-bold-duotone" width="18"></iconify-icon> Access Token 자동 발급';
      }
    }

    // ============================================================

    async function probeToken() {
      const clientId = document.getElementById('clientIdInput').value.trim();
      const apiKey = document.getElementById('apiKeyInput').value.trim();
      const macAddr = document.getElementById('macAddrInput').value.trim();
      const resultEl = document.getElementById('tokenReqResult');
      const btn = document.getElementById('tokenProbeBtn');

      if (!clientId || !apiKey || !macAddr) {
        resultEl.className = 'token-result-err';
        resultEl.textContent = 'Client ID, 인증키, MAC 주소를 모두 입력해주세요.';
        return;
      }

      await checkProxy();
      if (!PROXY_AVAILABLE) {
        resultEl.className = 'token-result-err';
        resultEl.innerHTML = '프록시 서버가 실행 중이어야 합니다.<br><code style="background:#1a1a1a;padding:2px 5px;border-radius:3px;">node proxy-server.js</code> 실행 후 재시도하세요.';
        return;
      }

      btn.disabled = true;
      btn.innerHTML = '<iconify-icon icon="solar:radar-bold-duotone" width="16"></iconify-icon> 탐색 중...';
      resultEl.className = 'token-result-ok';
      resultEl.textContent = '암호화 방식 탐색 중... (MAC 6가지 × 암호화 7가지 = 최대 42회 시도)';

      try {
        const url = `${getProxyBase()}/token/probe?client_id=${encodeURIComponent(clientId)}&api_key=${encodeURIComponent(apiKey)}&mac_address=${encodeURIComponent(macAddr)}`;
        const resp = await fetch(url);
        const data = await resp.json();

        if (data.success) {
          // STATE + localStorage에 즉시 저장
          STATE.token = data.access_token;
          localStorage.setItem('sc_token', STATE.token);
          if (data.refresh_token) {
            STATE.refreshToken = data.refresh_token;
            localStorage.setItem('sc_refresh_token', STATE.refreshToken);
          }
          const expire = data.access_token_expire || '';
          STATE.tokenExpire = expire;
          localStorage.setItem('sc_token_expire', expire);
          document.getElementById('tokenInput').value = STATE.token;
          if (data.refresh_token) document.getElementById('refreshTokenInput').value = STATE.refreshToken;
          scheduleTokenRefresh();
          updateTokenExpireDisplay();
          updateProxyStatus();
          resultEl.className = 'token-result-ok';
          resultEl.innerHTML = `탐색 성공! 자동 저장됨<br>MAC 형식: <strong>${escHtml(data.mac)}</strong><br>암호화: <strong>${escHtml(data.enc)}</strong><br>만료: ${escHtml(expire || '2시간 후')}`;
        } else {
          resultEl.className = 'token-result-err';
          resultEl.innerHTML = `모든 조합 실패 (${data.results?.length || 0}가지 시도)<br>API 포털에서 등록 정보를 다시 확인하세요.`;
        }
      } catch (err) {
        resultEl.className = 'token-result-err';
        resultEl.textContent = `오류: ${err.message}`;
      }

      btn.disabled = false;
      btn.innerHTML = '<iconify-icon icon="solar:radar-bold-duotone" width="16"></iconify-icon> 자동 탐색';
    }

    // ============================================================


    // ── Stage 1: ScienceON에서 실제 논문·특허 컨텍스트 수집 ─────────
    async function fetchDomainContext(mainQuery) {
      const fetchTop = async (target, n) => {
        const searchQuery = JSON.stringify({ BI: mainQuery });
        // 토큰은 매 시도마다 STATE에서 다시 읽는다(갱신 후 재시도에 새 토큰이 반영되도록).
        const attempt = async () => {
          const url = `${getApiBase()}?client_id=${STATE.clientId}&token=${STATE.token}&version=1.0&action=search&target=${target}&searchQuery=${encodeURIComponent(searchQuery)}&rowCount=${n}`;
          const resp = await fetchWithRetry429(url, { timeout: 8000 });
          const text = await resp.text();
          const xml = new DOMParser().parseFromString(text, 'text/xml');
          const errorCode = xml.querySelector('parsererror') ? '' : xml.querySelector('errorCode')?.textContent?.trim();
          return { xml, errorCode };
        };
        try {
          let out = await attempt();
          if (out.errorCode === 'E4103') {   // 토큰 만료 → 갱신 후 1회 재시도
            await refreshTokenOnce();
            out = await attempt();
          }
          return out.xml;
        } catch { return null; }
      };

      // 테마의 근거를 넓히기 위해 상위 5건이 아니라 논문 40건·특허 30건을 수집한다.
      // 상위 5건 제목만으로는 도메인 연구 지형을 대표하지 못해 AI가 사전지식으로
      // 테마를 "창작"하게 되므로, 제목·저자키워드·IPC의 실측 빈도를 함께 뽑는다.
      const [artiXml, patentXml] = await Promise.all([
        fetchTop('ARTI', 40),
        fetchTop('PATENT', 30),
      ]);

      const extractItems = (xml, n) => {
        if (!xml) return [];
        return Array.from(xml.querySelectorAll('recordList record, record')).slice(0, n);
      };

      const paperItems  = extractItems(artiXml, 40);
      const patentItems = extractItems(patentXml, 30);

      // 대표 사례 블록(상위 5건)은 기존 형식 유지
      const paperSummaries = paperItems.slice(0, 5).map(item => {
        const title   = getVal(item, 'Title') || '';
        const authors = (getVal(item, 'Author') || '').split(/[;,|]/)[0].trim();
        const year    = (getVal(item, 'Pubyear', 'PublDate') || '').substring(0, 4);
        return `"${title}"${authors ? ' — ' + authors : ''}${year ? ' (' + year + ')' : ''}`;
      }).filter(Boolean);

      const patentSummaries = patentItems.slice(0, 5).map(item => {
        const title     = getVal(item, 'Title') || '';
        const applicant = (getVal(item, 'Publisher', 'Applicants') || '').split(/[;|,]/)[0].trim();
        const ipc       = getVal(item, 'IPC') || '';
        const year      = (getVal(item, 'Pubyear', 'ApplDate') || '').substring(0, 4);
        return `"${title}"${applicant ? ' — ' + applicant : ''}${ipc ? ' [' + ipc.split(/[,;]/)[0].trim() + ']' : ''}${year ? ' (' + year + ')' : ''}`;
      }).filter(Boolean);

      // ── 관측 용어 빈도 테이블 — 테마가 이 목록에 근거하도록 강제하는 재료 ──
      const paperTitles  = paperItems.map(it => getVal(it, 'Title') || '').filter(Boolean);
      const patentTitles = patentItems.map(it => getVal(it, 'Title') || '').filter(Boolean);
      const authorKeywords = paperItems
        .flatMap(it => (getVal(it, 'Keyword', 'Keywords') || '').split(/[;,|]/))
        .map(k => k.trim()).filter(k => k.length >= 2);

      const termFrequency = buildTermFrequency(
        [...paperTitles, ...patentTitles, ...authorKeywords.join(' ')], mainQuery);

      // IPC 서브클래스(앞 4자리) 분포 — 특허측 기술 구조의 객관 근거
      const ipcCounts = new Map();
      patentItems.forEach(it => {
        (getVal(it, 'IPC') || '').split(/[,;]/).forEach(code => {
          const sub = code.trim().substring(0, 4).toUpperCase();
          if (/^[A-H]\d\d[A-Z]$/.test(sub)) ipcCounts.set(sub, (ipcCounts.get(sub) || 0) + 1);
        });
      });
      const ipcDistribution = [...ipcCounts.entries()]
        .sort((a, b) => b[1] - a[1]).slice(0, 8)
        .map(([code, count]) => `${code}(${count})`);

      return {
        paperSummaries, patentSummaries, termFrequency, ipcDistribution,
        paperCount: paperItems.length, patentCount: patentItems.length,
      };
    }

    // 제목·저자키워드 텍스트에서 유니그램/바이그램 빈도를 계산해 상위 용어를 반환한다.
    // 메인 키워드 자체와 범용 접미어는 제외해 "새 정보"만 남긴다.
    function buildTermFrequency(texts, mainQuery, topN = 25) {
      const stop = new Set(['연구', '개발', '분석', '기반', '기술', '시스템', '방법', '방안', '위한',
        '이용한', '이용', '활용한', '활용', '적용', '관한', '대한', '따른', '통한', '및', '등',
        '동향', '현황', '사례', '평가', '설계', '구현', '제안', '개선', '향상', '효과', '특성',
        'the', 'of', 'and', 'for', 'a', 'an', 'on', 'in', 'with', 'using', 'based', 'study']);
      const mainTokens = new Set(String(mainQuery || '').toLowerCase().split(/\s+/).filter(Boolean));
      const uni = new Map();
      const bi = new Map();
      for (const text of texts) {
        const tokens = String(text || '')
          .replace(/<[^>]*>/g, ' ')
          .split(/[\s.,;:()\[\]{}/·ㆍ&+\-_'"“”‘’?!]+/)
          .map(t => t.trim().toLowerCase())
          .filter(t => t.length >= 2 && !stop.has(t) && !mainTokens.has(t) && !/^\d+$/.test(t));
        tokens.forEach((t, i) => {
          uni.set(t, (uni.get(t) || 0) + 1);
          if (i < tokens.length - 1) {
            const pair = `${t} ${tokens[i + 1]}`;
            bi.set(pair, (bi.get(pair) || 0) + 1);
          }
        });
      }
      // 바이그램(2회 이상)을 우선하고 유니그램으로 보충 — 구체적 기술명 우선
      const bigrams  = [...bi.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
      const unigrams = [...uni.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]);
      const seen = new Set();
      const result = [];
      for (const [term, count] of [...bigrams, ...unigrams]) {
        if (result.length >= topN) break;
        if (seen.has(term)) continue;
        seen.add(term);
        result.push(`${term}(${count})`);
      }
      return result;
    }

    // LLM이 살짝 깨진 JSON(배열 요소 사이 콤마 누락·후행 콤마 등)을 줄 때 대비한
    // 관대한 복구 파서. 첫 '{'~마지막 '}' 블록을 뽑아 단계적으로 교정하며 파싱을 시도한다.
    function lenientJSONParse(raw) {
      const match = String(raw || '').match(/\{[\s\S]*\}/);
      if (!match) return null;
      const repairs = [
        x => x,                                              // 원본
        x => x.replace(/,(\s*[}\]])/g, '$1'),                // 후행 콤마 제거
        x => x.replace(/}\s*{/g, '},{').replace(/]\s*\[/g, '],['), // 객체/배열 사이 콤마 누락
        x => x.replace(/"\s*\n\s*"/g, '",\n"'),              // 배열 내 인접 문자열 콤마 누락
      ];
      let cur = match[0];
      for (const fn of repairs) {
        cur = fn(cur);
        try { return JSON.parse(cur); } catch { /* 다음 교정 시도 */ }
      }
      return null;
    }

    // ── Stage 2: 실데이터 기반 구조화 추론 → 후보 6개 생성 ──────────
    async function fetchSubKeywords(mainQuery, domainContext) {
      if (!hasAIAccess()) throw new Error('AI_SERVER_UNAVAILABLE');

      const { paperSummaries, patentSummaries, termFrequency = [], ipcDistribution = [],
              paperCount = 0, patentCount = 0 } = domainContext;

      const paperBlock  = paperSummaries.length
        ? paperSummaries.map((p, i) => `${i+1}. ${p}`).join('\n')
        : '(No paper data available — infer from domain knowledge)';

      const patentBlock = patentSummaries.length
        ? patentSummaries.map((p, i) => `${i+1}. ${p}`).join('\n')
        : '(No patent data available — this may indicate a near-complete white space)';

      const termBlock = termFrequency.length
        ? termFrequency.join(', ')
        : '(no term statistics available)';

      const ipcBlock = ipcDistribution.length
        ? ipcDistribution.join(', ')
        : '(no IPC data)';

      const systemPrompt = `You are a technology commercialization (기술사업화) strategist and patent analyst.
You specialize in proposing testable "white space" hypotheses: sub-domains that may have strong academic research but relatively limited patent coverage.
You ALWAYS respond with valid JSON only. No markdown, no explanation outside the JSON.`;

      const userPrompt = `Analyze the following real data for the main research keyword: "${mainQuery}"

=== OBSERVED TERM FREQUENCY (from ${paperCount} papers + ${patentCount} patents: titles + author keywords, format: term(count)) ===
${termBlock}

=== PATENT IPC SUBCLASS DISTRIBUTION (from ${patentCount} patents, format: IPC(count)) ===
${ipcBlock}

=== SAMPLE TOP PAPERS (from ScienceON database) ===
${paperBlock}

=== SAMPLE TOP PATENTS (from ScienceON database) ===
${patentBlock}

Perform this 3-step analysis:

STEP 1 — Identify 5 to 8 core research themes GROUNDED IN THE OBSERVED DATA above (aim for 6-7). Write each "theme" in KOREAN (3-6 words) as a concrete TECHNOLOGY name.
  - CRITICAL GROUNDING RULE: every theme MUST be supported by the observed term frequency table and/or the sample titles.
    For each theme, fill "evidence" with 2-4 EXACT terms copied from the frequency table (or title phrases) that support it.
    Do NOT invent themes from your own prior knowledge that have no supporting observed terms.
  - Do NOT append meta/filler suffixes like "동향", "트렌드", "현황", "연구", "분석" (trend/status/research/analysis).
    Name the technology itself. Example: write "자율 주행 차량 기술" NOT "자율 주행 차량 기술 동향".
  For each theme, provide a Korean "hypothesis" (1 sentence) explaining why it may merit a research-to-IP gap check. This is only a hypothesis: do not claim that a theme is a verified patent gap.

STEP 2 — From all commercializable themes, generate 8 to 10 sub-keywords. Cover as many distinct themes as possible; do not filter a theme out only because of an AI gap judgement.
  (More candidates than needed are requested on purpose — they will be pruned later by actual database counts.)
  - Prefer keywords built from terms that actually appear in the observed frequency table: these match the database vocabulary and return real search results.
  - IMPORTANT: Write BOTH "keyword" and "patent_query" in KOREAN. The search targets are Korean databases
    (ScienceON papers, Korean patents), so English terms return almost no matches. Use Korean technical terms.
  - "keyword": 2-3 Korean words — specific enough to distinguish sub-domains, used for PAPER search.
    Keep it short; overly long compound phrases return 0 papers.
  - "patent_query": 1-2 core Korean words ONLY — stripped of adjectives/modifiers, used for PATENT database search.
    Patent databases index by technology domain, not full research phrases.
    IMPORTANT: Separate the core words with a SPACE (do NOT glue them into one compound token).
    Korean patent text indexes spaced terms; a glued compound like "차량통신" returns almost no matches,
    while the spaced form "차량 통신" matches correctly (AND search).
    Example: keyword="도시 재난 회복력 평가" → patent_query="재난 회복력"
    Example: keyword="위성영상 홍수 탐지" → patent_query="홍수 탐지"
    Example: keyword="무선 차량통신" → patent_query="차량 통신"  (NOT "차량통신")
  - Avoid repeating the main keyword verbatim in "keyword"
  - Represent different angles (methodology, application, sector, scale)
  - CRITICAL: Only generate keywords that can lead to PATENTABLE technology or a commercial PRODUCT/SERVICE.
    EXCLUDE non-technical topics that cannot be commercialized through patents — such as policy, regulation,
    law, institutional/governance research, ethics, public awareness, education, social science, welfare,
    administrative systems (정책·제도·법률·규제·거버넌스·윤리·인식개선·홍보·교육정책·인문사회·복지·행정 등).
    NOTE: "인식(recognition)" as in image/object/gaze recognition IS technical and MUST be included.
    These domains have many research projects but almost no patents, which falsely inflates the "gap" score.
    Focus on engineering, devices, software, materials, sensors, algorithms, manufacturing, and applied systems.

STEP 3 — For each candidate, provide:
  - theme: The exact theme name this candidate belongs to
  - search_terms: 2 to 4 Korean query variants (synonyms, spacing variants, or accepted abbreviations). The first item must equal "keyword".
  - gap_reason: Why this sub-domain merits data validation for a possible research-to-IP gap (1 sentence)
  - target_market: Who would buy/use this technology (1 sentence)

Respond ONLY with this JSON structure:
{
  "themes": [
    {"theme": "...", "hypothesis": "...", "evidence": ["term1", "term2"]}
  ],
  "candidates": [
    {"theme": "...", "keyword": "...", "patent_query": "...", "search_terms": ["..."], "gap_reason": "...", "target_market": "..."}
  ]
}`;

      const baseRequest = {
        model: getActiveCerebrasModel(),
        reasoning_effort: 'high',   // 화이트스페이스 판단 — 추론 비중 큰 작업
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userPrompt   },
        ],
        // 관측 데이터 요약이 목적이므로 낮은 온도로 재현성을 확보한다.
        // (높은 온도는 실행마다 전혀 다른 테마를 만들어 임의성의 주범이었음)
        temperature: 0.2,
        max_tokens: 8000,
      };

      if (isModelExperimentMode()) return runSubKeywordModelExperiment(baseRequest);

      const attempt = await requestSubKeywordsWithModel(baseRequest, getActiveCerebrasModel());
      if (attempt.error) throw new Error(attempt.error);
      return attempt.result;
    }

    function parseSubKeywordPayload(raw) {
      // JSON 추출 + 관대한 복구 파싱 (마크다운 코드블록·콤마 누락 등 방어)
      let parsed = lenientJSONParse(raw);

      // 복구도 실패하면 keyword/patent_query만 정규식으로 salvage 해 최소 후보를 구성
      // (테마/근거는 없지만 후속 파이프라인이 keyword만으로도 동작하므로 분석은 진행됨)
      if (!parsed) {
        const kws = [...raw.matchAll(/"keyword"\s*:\s*"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
        const pqs = [...raw.matchAll(/"patent_query"\s*:\s*"([^"]*)"/g)].map(m => m[1].trim());
        if (kws.length) {
          console.warn('[Cerebras RAG] JSON 파싱 실패 → keyword 직접 추출', kws);
          parsed = { themes: [], candidates: kws.map((k, i) => ({ keyword: k, patent_query: pqs[i] || '' })) };
        }
      }
      if (!parsed) throw new Error('AI 응답 파싱 실패: ' + raw.substring(0, 120));
      return parsed;
    }

    function normalizeSubKeywordResult(parsed) {
      const themes     = Array.isArray(parsed?.themes)     ? parsed.themes     : [];
      const candidates = Array.isArray(parsed?.candidates) ? parsed.candidates : [];
      if (candidates.length < 1) throw new Error('후보 키워드 배열이 비어 있습니다');

      const mappedCandidates = candidates.slice(0, 12).map(c => ({
        theme:        stripThemeSuffix(c.theme || '').trim(),
        keyword:      (c.keyword     || '').trim(),
        patent_query: (c.patent_query || '').trim(),
        search_terms: Array.isArray(c.search_terms) ? c.search_terms.map(v => String(v || '').trim()).filter(Boolean) : [],
        gap_reason:   (c.gap_reason  || '').trim(),
        target_market:(c.target_market || '').trim(),
      })).filter(c => c.keyword);

      // 테마를 먼저 정제하고 비사업화 여부 판정 (evidence = 관측 데이터 근거 용어)
      const mappedThemes = themes.map(t => {
        const cleaned = stripThemeSuffix(t.theme || t.keyword || '');
        const evidence = Array.isArray(t.evidence)
          ? t.evidence.map(e => String(e || '').trim()).filter(Boolean).slice(0, 4)
          : [];
        return { ...t, theme: cleaned, evidence, nonCommercial: isNonCommercialTopic(cleaned) };
      });
      const nonCommercialThemes = mappedThemes.filter(t => t.nonCommercial).map(t => t.theme);

      // 후보 비사업화 판정 = 키워드 자체가 비사업화 패턴이거나,
      // 비사업화 테마에서 파생(단어 대부분 겹침)된 경우.
      // AI가 검색용 후보를 만들 때 비사업화 키워드(예 '윤리')를 떼어내면
      // ('인공지능 윤리 딜레마 시뮬레이션' → '딜레마 시뮬레이션') 필터를 빠져나가
      // Step1에선 '비사업화 제외'인데 순위에는 유망분야로 뜨는 모순이 생기므로,
      // 원 테마와의 단어 겹침으로 파생 후보까지 함께 배제한다.
      const isCandidateNonCommercial = (kw) =>
        isNonCommercialTopic(kw) ||
        nonCommercialThemes.some(th => keywordWordOverlap(kw, th) >= 0.6);

      const commercializable = mappedCandidates.filter(c => !isCandidateNonCommercial(c.keyword));
      if (!commercializable.length) throw new Error('특허·제품화 가능한 기술 후보를 생성하지 못했습니다');
      // 과생성분(최대 10개)을 그대로 넘긴다 — 최종 6개 선별은 실측 프로브가 결정한다.
      const finalCandidates = commercializable.slice(0, 10);

      return {
        themes: mappedThemes,
        candidates: finalCandidates,
      };
    }

    function scoreSubKeywordModelResult(result) {
      const candidates = result?.candidates || [];
      const themes = result?.themes || [];
      const uniqueKeywords = new Set(candidates.map(c => c.keyword)).size;
      const uniqueThemes = new Set(candidates.map(c => c.theme).filter(Boolean)).size;
      const hasKorean = text => /[가-힣]/.test(String(text || ''));
      const conciseKeyword = text => {
        const words = String(text || '').trim().split(/\s+/).filter(Boolean);
        return words.length >= 1 && words.length <= 4;
      };
      const usefulPatentQuery = text => {
        const value = String(text || '').trim();
        const words = value.split(/\s+/).filter(Boolean);
        return hasKorean(value) && words.length >= 1 && words.length <= 3;
      };
      const candidateShape = candidates.reduce((sum, c) => {
        let score = 0;
        if (hasKorean(c.keyword)) score += 2;
        if (conciseKeyword(c.keyword)) score += 2;
        if (usefulPatentQuery(c.patent_query || c.keyword)) score += 2;
        if (Array.isArray(c.search_terms) && c.search_terms.length >= 2) score += 1;
        if (c.gap_reason) score += 1;
        if (c.target_market) score += 1;
        if (!isNonCommercialTopic(`${c.theme} ${c.keyword}`)) score += 1;
        return sum + score;
      }, 0);
      const targetCountScore = candidates.length >= 8 && candidates.length <= 10
        ? 18
        : Math.max(0, 18 - Math.abs(8 - candidates.length) * 4);
      const diversityScore = Math.min(18, uniqueKeywords * 2 + uniqueThemes * 2);
      const themeScore = Math.min(12, themes.filter(t => hasKorean(t.theme || t.keyword)).length * 2);
      const fieldScore = Math.min(32, candidateShape);
      const total = Math.round(Math.min(100, targetCountScore + diversityScore + themeScore + fieldScore + 20));
      return { total, targetCountScore, diversityScore, themeScore, fieldScore };
    }

    async function requestSubKeywordsWithModel(baseRequest, modelId) {
      const startedAt = Date.now();
      // 응답이 max_tokens에 걸려 잘리면 JSON이 미완성이라 파싱이 실패한다.
      // finish_reason으로 잘림을 감지해 출력 한도를 늘려 1회 재시도한다.
      const callOnce = async (request) => {
        const resp = await cerebrasChat(request, 45000, { model: modelId });
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err?.error?.message || `Cerebras API 오류 (${resp.status})`);
        }
        const data = await resp.json();
        const choice = data?.choices?.[0];
        return {
          raw: (choice?.message?.content || '').trim(),
          truncated: choice?.finish_reason === 'length',
        };
      };
      try {
        let { raw, truncated } = await callOnce(baseRequest);
        console.log(`[Cerebras ${modelId}] raw response${truncated ? ' (truncated)' : ''}:`, raw);
        let parsed;
        try {
          parsed = parseSubKeywordPayload(raw);
        } catch (parseError) {
          if (!truncated) throw parseError;
          const retryRequest = { ...baseRequest, max_tokens: Math.max(16000, (baseRequest.max_tokens || 8000) * 2) };
          console.warn(`[Cerebras ${modelId}] 응답 잘림 → max_tokens ${retryRequest.max_tokens}로 재시도`);
          ({ raw, truncated } = await callOnce(retryRequest));
          if (truncated) throw new Error(`AI 응답이 토큰 한도에서 잘렸습니다(재시도 후에도 미완성). 검색어를 더 좁혀 다시 시도해주세요.`);
          parsed = parseSubKeywordPayload(raw);
        }
        const result = normalizeSubKeywordResult(parsed);
        const score = scoreSubKeywordModelResult(result);
        return { model: modelId, raw, result, score, latencyMs: Date.now() - startedAt };
      } catch (error) {
        return {
          model: modelId,
          error: error.message || 'AI 응답 처리 실패',
          latencyMs: Date.now() - startedAt,
          score: { total: 0 },
        };
      }
    }

    async function runSubKeywordModelExperiment(baseRequest) {
      const models = [AI_MODEL_MODES.GPT, AI_MODEL_MODES.GLM];
      const attempts = await Promise.all(models.map(model => requestSubKeywordsWithModel(baseRequest, model)));
      const winner = [...attempts].sort((a, b) =>
        (b.score?.total || 0) - (a.score?.total || 0) || (a.latencyMs || Infinity) - (b.latencyMs || Infinity)
      )[0];
      if (!winner || winner.error || !winner.result) {
        const detail = attempts.map(a => `${getCerebrasModelLabel(a.model)}: ${a.error || `${a.score?.total || 0}점`}`).join(' / ');
        throw new Error(`AI 모델 품질 실험 실패 (${detail})`);
      }
      const summary = {
        winner: winner.model,
        winnerLabel: getCerebrasModelLabel(winner.model),
        attempts: attempts.map(a => ({
          model: a.model,
          label: getCerebrasModelLabel(a.model),
          score: a.score?.total || 0,
          latencyMs: a.latencyMs || 0,
          candidateCount: a.result?.candidates?.length || 0,
          error: a.error || '',
        })),
      };
      showToast(`AI 품질 실험 결과: ${summary.winnerLabel} 선택 (${winner.score.total}점)`, 'info');
      return { ...winner.result, modelExperiment: summary };
    }

    // 테마명 끝의 불필요한 메타 접미어(동향·트렌드·현황 등) 제거
    // 예) "자율 주행 차량 기술 동향" → "자율 주행 차량 기술"
    function stripThemeSuffix(text) {
      return String(text || '').trim()
        .replace(/[\s·]*(연구\s*)?(동향|트렌드|현황)\s*$/u, '')
        .trim();
    }

    // 기술사업화(특허·제품화)와 거리가 먼 비기술 영역(정책·제도·법률·인문사회 등)을
    // 후보에서 제외하기 위한 판별 함수. 이런 주제는 NTIS 과제는 많아도 특허가 거의 없어
    // '공백률'이 비정상적으로 높게 나와 유망도 점수가 왜곡되므로 분석 대상에서 배제한다.
    const NON_COMMERCIAL_PATTERNS = [
      '정책', '제도', '법률', '법제', '규제', '거버넌스', '윤리', '교육',
      '홍보', '인문', '사회학', '복지', '행정', '조례', '입법', '제도화',
      '여론', '시민참여', '협력체계', '추진체계', '활성화 방안',
      '발전 방안', '개선 방안', '정책적', '제도적',
      '인식개선', '인식 향상', '사회 인식', '시민 인식', '공공 인식',
    ];
    function isNonCommercialTopic(text) {
      if (!text) return false;
      const s = String(text);
      return NON_COMMERCIAL_PATTERNS.some(p => s.includes(p));
    }

    // 단계별 진행 상황 UI 헬퍼
    function setAnalysisProgress(steps, activeIdx) {
      const section = document.getElementById('analysisSection');
      const stepsHtml = steps.map((s, i) => {
        const done    = i < activeIdx;
        const active  = i === activeIdx;
        const color   = done ? '#22c55e' : active ? '#111' : '#d1d5db';
        const bgColor = done ? '#f0fdf4' : active ? '#f5f5f5' : '#f9fafb';
        const icon    = done ? '✓' : active ? '⟳' : String(i + 1);
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:${bgColor};border:1px solid ${color}20;">
          <span style="width:22px;height:22px;border-radius:50%;background:${color};color:white;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;${active ? 'animation:spin 1s linear infinite;' : ''}">${icon}</span>
          <span style="font-size:12px;font-weight:${active ? '600' : '500'};color:${active ? '#111' : done ? '#166534' : '#9ca3af'};">${s}</span>
        </div>`;
      }).join('');
      section.innerHTML = `
        <div class="analysis-card analysis-loading-pulse">
          <div class="analysis-header flex items-center justify-between">
            <div class="flex items-center gap-2">
              <iconify-icon icon="solar:graph-up-bold-duotone" width="20"></iconify-icon>
              <span class="font-bold">연구–IP 전환 공백 분석 중...</span>
            </div>
            <div class="spinner" style="width:20px;height:20px;border-width:2px;border-top-color:white;"></div>
          </div>
          <div class="analysis-body">
            <div style="display:flex;flex-direction:column;gap:8px;padding:4px 0;">${stepsHtml}</div>
          </div>
        </div>`;
    }

    async function mapWithConcurrency(items, limit, mapper) {
      const source = Array.isArray(items) ? items : [];
      const results = new Array(source.length);
      let cursor = 0;
      const workers = Array.from({ length: Math.min(Math.max(1, limit), source.length) }, async () => {
        while (cursor < source.length) {
          const index = cursor++;
          results[index] = await mapper(source[index], index);
        }
      });
      await Promise.all(workers);
      return results;
    }

    // 메인 진입점 — 버튼 onclick
    async function runTechCommerceAnalysis() {
      // 검색 모드에서도 현재 쿼리를 STATE에서 폴백
      const mainQuery = document.getElementById('searchInput').value.trim() || STATE.currentQuery || '';
      if (!mainQuery) {
        showToast('분석할 키워드를 입력해주세요', 'warning');
        document.getElementById('searchInput').focus();
        return;
      }

      // AI 서버 환경변수 확인
      if (!hasAIAccess()) {
        showToast(getProxyBase() !== null
          ? '🤖 AI 서버 키가 없습니다. 프록시의 CEREBRAS_API_KEY 또는 API 설정의 csk- 키를 확인해주세요.'
          : '🤖 Cerebras API 키가 비어 있거나 형식이 올바르지 않습니다. csk-로 시작하는 키를 확인해주세요.', 'warning');
        return;
      }

      // ScienceON API 토큰 확인 (없으면 프록시로 자동 발급 시도)
      if (!STATE.token && PROXY_AVAILABLE) await autoRequestToken();
      if (!STATE.clientId || !STATE.token) {
        showToast('🔑 ScienceON API 토큰이 필요합니다. 우측 상단 "API 설정"을 확인해주세요.', 'warning');
        return;
      }

      document.body.classList.add('search-mode');
      hideAll();

      const analysisSection = document.getElementById('analysisSection');
      analysisSection.classList.remove('hidden');

      const STAGES = [
        'Stage 1 — ScienceON 도메인 컨텍스트 수집 (논문 5 + 특허 5)',
        'Stage 2 — Cerebras AI 구조화 추론 (테마 가설 → 후보 6개 생성)',
        'Stage 3 — 후보 6개 실데이터 검증 (ScienceON·NTIS 병렬 조회)',
        'Stage 3.5 — 트렌드 성장률 검증 (최근 2년 vs 이전 2년 논문 비교)',
        'Stage 4 — 다중 요소 스코어링 (공백 + 트렌드) → TOP 3 선정',
      ];

      const abort = () => {
        analysisSection.classList.add('hidden');
        document.body.classList.remove('search-mode');
        document.getElementById('emptyState').classList.remove('hidden');
      };

      try {
        // ── Stage 1: ScienceON 컨텍스트 수집 ─────────────────────
        setAnalysisProgress(STAGES, 0);
        const domainContext = await fetchDomainContext(mainQuery);

        // ── Stage 2: AI 구조화 추론 ──────────────────────────────
        setAnalysisProgress(STAGES, 1);
        let aiResult;
        try {
          aiResult = await fetchSubKeywords(mainQuery, domainContext);
        } catch (err) {
          console.error('[Cerebras]', err);
          if (err.message === 'AI_SERVER_UNAVAILABLE') {
            showToast('AI 서버 설정을 확인해주세요 (CEREBRAS_API_KEY 또는 GEMINI_API_KEY)', 'warning');
          } else if (err.message === 'GEMINI_CONSENT_DECLINED') {
            showToast('Gemini 사용을 승인하지 않아 AI 분석을 중단했습니다.', 'warning');
          } else {
            showToast('AI 키워드 생성 실패: ' + err.message, 'error');
          }
          abort();
          return;
        }

        const { themes, candidates: overGenerated, modelExperiment } = aiResult;

        // ── Stage 2.5: 실측 프로브로 후보 선별 ────────────────────
        // AI가 과생성한 후보(최대 10개)의 논문 건수를 가볍게 조회해,
        // DB에 데이터가 실제로 존재하는 6개만 본검증에 올린다.
        // 최종 후보 구성을 AI 선택이 아니라 실측이 결정하게 하는 장치다.
        const candidates = await probeAndSelectCandidates(overGenerated, 6);
        if (candidates.length < overGenerated.length) {
          console.log(`[TechCommerce] 실측 프로브 선별: ${overGenerated.length}개 → ${candidates.length}개`,
            candidates.map(c => c.keyword));
        }

        // ── Stage 3: 후보 실데이터 검증 ──────────────────────────
        setAnalysisProgress(STAGES, 2);
        // 현재 후보 키워드 목록을 UI에 노출
        const candidateChips = candidates.map((c, i) =>
          `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:6px;padding:5px 10px;font-size:11px;font-weight:600;color:#374151;display:inline-flex;align-items:center;gap:5px;">
            <span style="background:#111;color:white;width:15px;height:15px;border-radius:50%;font-size:9px;display:flex;align-items:center;justify-content:center;">${i+1}</span>
            ${escHtml(c.keyword)}
          </div>`).join('');
        analysisSection.querySelector('.analysis-body').insertAdjacentHTML('beforeend',
          `<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;">${candidateChips}</div>`);

        // 후보별 검색식은 순차 검증하되, 후보 간 동시 요청은 2개로 제한해
        // ScienceON/NTIS rate limit 오류가 점수 왜곡으로 이어지는 것을 줄인다.
        const rawResults = await mapWithConcurrency(candidates, 2,
          c => fetchKeywordAnalysisData(c.keyword, c.patent_query || null, c.search_terms || []));
        // AI 분석 이유 결합
        rawResults.forEach((r, i) => {
          r.aiReason     = candidates[i]?.gap_reason    || '';
          r.targetMarket = candidates[i]?.target_market || '';
          r.theme        = candidates[i]?.theme || '';
        });

        // ── Stage 3.5: 트렌드 성장률 수집 ───────────────────────
        setAnalysisProgress(STAGES, 3);
        const trendSignals = await fetchTrendSignals(rawResults.map(r => ({
          keyword: r.keyword,
          query: r.queryMeta?.canonicalQuery || r.keyword,
        })));

        // ── Stage 4: 스코어링 + 다양성 보정 ─────────────────────
        setAnalysisProgress(STAGES, 4);
        await new Promise(r => setTimeout(r, 300)); // brief visual pause

        const { top3, eliminated, exploratory } = selectTop3WithDiversity(rawResults, trendSignals);
        // 정식 순위가 0개여도 초기 탐색 후보와 제외 사유는 분석 결과다.
        // 화면을 닫아버리면 사용자가 검색식·표본·오류 원인을 확인할 수 없다.
        if (!top3.length) showToast('정식 순위 후보는 없지만 검증 결과와 보류 사유를 표시합니다.', 'warning');
        renderTechCommerceComparison(mainQuery, themes, top3, eliminated, exploratory, modelExperiment);

      } catch (err) {
        console.error('[TechCommerce]', err);
        showToast('분석 중 오류: ' + err.message, 'error');
        abort();
      }
    }

    // 키워드 1개에 대한 전체 데이터 수집
    async function fetchKeywordAnalysisData(keyword, patentQuery = null, searchTerms = []) {
      const metric = (value, status, extra = {}) => ({ value, status, ...extra });
      const getItems = (xml, n) => Array.from(xml?.querySelectorAll('recordList record, record') || []).slice(0, n);

      const fetchScienceON = async (target, query, rowCount = 1) => {
        // 토큰은 매 시도마다 STATE에서 다시 읽는다(갱신 후 재시도에 새 토큰이 반영되도록).
        const attempt = async () => {
          const searchQuery = JSON.stringify({ BI: query });
          const url = `${getApiBase()}?client_id=${STATE.clientId}&token=${STATE.token}&version=1.0&action=search&target=${target}&searchQuery=${encodeURIComponent(searchQuery)}&rowCount=${rowCount}`;
          const resp = await fetchWithRetry429(url, { timeout: 10000 });
          const text = await resp.text();
          if (!resp.ok) return { result: { xml: null, metric: metric(0, 'error', { error: `HTTP ${resp.status}` }) } };
          const xml = new DOMParser().parseFromString(text, 'text/xml');
          if (xml.querySelector('parsererror')) return { result: { xml: null, metric: metric(0, 'error', { error: 'XML parse error' }) } };
          const errorCode = xml.querySelector('errorCode')?.textContent?.trim();
          if (errorCode) return { errorCode, result: { xml, metric: metric(0, 'error', { error: errorCode }) } };
          const el = xml.querySelector('TotalCount') || xml.querySelector('totalCount');
          const value = parseInt(el?.textContent, 10) || 0;
          return { result: { xml, metric: metric(value, value > 0 ? 'ok' : 'no_result') } };
        };
        try {
          let out = await attempt();
          if (out.errorCode === 'E4103') {   // 토큰 만료 → 갱신 후 1회 재시도
            await refreshTokenOnce();
            out = await attempt();
          }
          return out.result;
        } catch (error) {
          return { xml: null, metric: metric(0, 'error', { error: error.name || 'request failed' }) };
        }
      };

      const words = keyword.trim().split(/\s+/).filter(w => w.length >= 2);
      const variants = [...new Set([
        keyword.trim(),
        (patentQuery || '').trim(),
        ...searchTerms,
        words.length >= 2 ? words.slice(0, 2).join(' ') : '',
      ].map(v => String(v || '').trim()).filter(Boolean))].slice(0, 5);

      // 논문·특허는 항상 같은 canonical 검색어 쌍으로 조회한다.
      let selectedPair = null;
      let bestPair = null;
      let bestAttempt = null;
      for (const query of variants) {
        const [arti, patent] = await Promise.all([
          fetchScienceON('ARTI', query, 3),
          fetchScienceON('PATENT', query, 5),
        ]);
        const pair = { query, arti, patent };
        if (!bestAttempt || arti.metric.value > bestAttempt.arti.metric.value) bestAttempt = pair;
        const comparablePair = arti.metric.status !== 'error' && patent.metric.status !== 'error';
        if (comparablePair && (!bestPair || arti.metric.value > bestPair.arti.metric.value)) bestPair = pair;
        if (comparablePair && arti.metric.value >= 20) {
          selectedPair = pair;
          break;
        }
      }
      selectedPair = selectedPair || bestPair || bestAttempt || {
        query: keyword,
        arti: { xml: null, metric: metric(0, 'error', { error: 'no query result' }) },
        patent: { xml: null, metric: metric(0, 'error', { error: 'no query result' }) },
      };

      const canonicalQuery = selectedPair.query;
      const canonicalIndex = Math.max(0, variants.indexOf(canonicalQuery));
      const pairComparable = selectedPair.arti.metric.status !== 'error' && selectedPair.patent.metric.status !== 'error';
      const fetchNTIS = async () => {
        const proxyBase = getProxyBase();
        if (proxyBase === null) return { xml: null, metric: metric(0, 'error', { error: 'proxy unavailable' }) };
        try {
          const params = new URLSearchParams({ collection: 'project', query: canonicalQuery, displayCnt: '1', startPosition: '1' });
          if (STATE.ntisKey) params.set('apprvKey', STATE.ntisKey);
          const resp = await fetchWithRetry429(`${proxyBase}/ntis?${params}`, { timeout: 7000 });
          const text = await resp.text();
          if (!resp.ok) return { xml: null, metric: metric(0, 'error', { error: `HTTP ${resp.status}` }) };
          const xml = new DOMParser().parseFromString(text, 'text/xml');
          if (xml.querySelector('parsererror')) return { xml: null, metric: metric(0, 'error', { error: 'XML parse error' }) };
          const value = parseInt(xml.getElementsByTagName('TOTALHITS')[0]?.textContent, 10) || 0;
          return { xml, metric: metric(value, value > 0 ? 'ok' : 'no_result') };
        } catch (error) {
          return { xml: null, metric: metric(0, 'error', { error: error.name || 'request failed' }) };
        }
      };

      const [report, att, ntis] = await Promise.all([
        fetchScienceON('REPORT', canonicalQuery, 1),
        fetchScienceON('ATT', canonicalQuery, 1),
        fetchNTIS(),
      ]);
      const metrics = {
        arti: selectedPair.arti.metric,
        patent: selectedPair.patent.metric,
        report: report.metric,
        att: att.metric,
        ntis: ntis.metric,
      };

      return {
        keyword,
        patentQuery: canonicalQuery,
        queryMeta: {
          requestedQuery: keyword,
          canonicalQuery,
          relaxed: canonicalQuery !== keyword.trim(),
          relaxationDepth: canonicalIndex,
          comparable: pairComparable,
          variantsTried: variants.slice(0, canonicalIndex + 1),
          querySet: variants,
          retrievedAt: new Date().toISOString(),
        },
        metrics,
        counts: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, value.value])),
        topPapers: getItems(selectedPair.arti.xml, 3),
        topPatents: getItems(selectedPair.patent.xml, 5),
        enrichment: {
          patentFamily: { status: 'not_connected' },
          market: { status: 'not_connected' },
          trl: { status: 'not_connected' },
        },
      };
    }

    // ── Stage 4-A: 공백 매력도·전환/실행 근거·데이터 신뢰도 분리 ──────
    function calcCommerceIndicators(result, trendSignal = null, peerContext = null) {
      return CommerceScoring.computeIndicators({
        counts: result.counts,
        metrics: result.metrics,
        queryMeta: result.queryMeta,
        enrichment: result.enrichment,
        trendSignal,
        peerContext,
      });
    }

    // ScienceON API는 짧은 시간에 요청이 몰리면 HTTP 429(Too Many Requests)를 반환한다.
    // 429를 즉시 실패로 확정하면 후보가 "핵심 데이터 조회 오류"로 부당하게 탈락해
    // 정식 순위 후보가 0개가 되므로, 지수 백오프로 재시도한다.
    async function fetchWithRetry429(url, { timeout = 10000, tries = 3 } = {}) {
      let lastResp = null;
      for (let attempt = 0; attempt < tries; attempt++) {
        const resp = await fetch(url, { signal: AbortSignal.timeout(timeout) });
        if (resp.status !== 429) return resp;
        lastResp = resp;
        if (attempt < tries - 1) {
          const wait = 700 * Math.pow(2, attempt) + Math.random() * 300;
          await new Promise(r => setTimeout(r, wait));
        }
      }
      return lastResp;
    }

    // ScienceON 토큰이 분석 도중 만료되면 이후 호출이 모두 E4103으로 실패해 후보가
    // "핵심 데이터 조회 오류"로 부당하게 탈락한다. 만료를 감지하면 토큰을 갱신하고 재시도한다.
    // 동시 호출이 각자 갱신을 트리거하지 않도록 진행 중인 갱신 하나를 공유한다.
    let _tokenRefreshPromise = null;
    async function refreshTokenOnce() {
      if (!_tokenRefreshPromise) {
        _tokenRefreshPromise = (async () => {
          try {
            if (typeof autoRequestToken === 'function') await autoRequestToken();
          } finally {
            setTimeout(() => { _tokenRefreshPromise = null; }, 1000);
          }
        })();
      }
      return _tokenRefreshPromise;
    }

    // ── Stage 2.5: 과생성 후보를 실측 건수로 선별 ──────────────────
    // 후보 keyword의 ARTI 건수만 가볍게 조회(rowCount=1)해 데이터가 존재하는 후보를
    // 우선 선발한다. 우선순위: 논문 20건 이상(정식 기준 충족 가능) > 5~19건(탐색 가능)
    // > 나머지(0건·오류). 같은 등급 안에서는 AI 제안 순서를 유지해 다양성을 보존한다.
    async function probeAndSelectCandidates(candidates, limit = 6) {
      const list = Array.isArray(candidates) ? candidates : [];
      if (list.length <= limit) return list;

      const quickArtiCount = async (kw) => {
        const attempt = async () => {
          const q = JSON.stringify({ BI: kw });
          const url = `${getApiBase()}?client_id=${STATE.clientId}&token=${STATE.token}&version=1.0&action=search&target=ARTI&searchQuery=${encodeURIComponent(q)}&rowCount=1`;
          const resp = await fetchWithRetry429(url, { timeout: 8000 });
          if (!resp.ok) return { count: null };
          const xml = new DOMParser().parseFromString(await resp.text(), 'text/xml');
          if (xml.querySelector('parsererror')) return { count: null };
          const errorCode = xml.querySelector('errorCode')?.textContent?.trim();
          if (errorCode) return { errorCode, count: null };
          const el = xml.querySelector('TotalCount') || xml.querySelector('totalCount');
          return { count: parseInt(el?.textContent, 10) || 0 };
        };
        try {
          let out = await attempt();
          if (out.errorCode === 'E4103') {   // 토큰 만료 → 갱신 후 1회 재시도
            await refreshTokenOnce();
            out = await attempt();
          }
          return out.count;                  // null = 조회 실패(판단 보류)
        } catch { return null; }
      };

      const probed = await mapWithConcurrency(list, 2, async (c) => ({
        candidate: c,
        count: await quickArtiCount(c.keyword),
      }));

      const tier = ({ count }) => (count === null ? 1 : count >= 20 ? 3 : count >= 5 ? 2 : count > 0 ? 1 : 0);
      const selected = probed
        .map((p, order) => ({ ...p, order }))
        .sort((a, b) => tier(b) - tier(a) || a.order - b.order)  // 등급 우선, 동급은 AI 순서
        .slice(0, limit)
        .sort((a, b) => a.order - b.order)                        // 표시 순서는 원래대로
        .map(p => ({ ...p.candidate, probedArtiCount: p.count }));
      return selected;
    }

    // 후보별 최근 완결 2년과 그 이전 2년을 동적으로 비교한다.
    async function fetchTrendSignals(candidates) {
      const fetchYearCount = async (kw, year) => {
        const q = JSON.stringify({ BI: kw, PY: String(year) });
        // 토큰은 매 시도마다 STATE에서 다시 읽는다(갱신 후 재시도에 새 토큰이 반영되도록).
        const attempt = async () => {
          const url = `${getApiBase()}?client_id=${STATE.clientId}&token=${STATE.token}&version=1.0&action=search&target=ARTI&searchQuery=${encodeURIComponent(q)}&rowCount=1`;
          const resp = await fetchWithRetry429(url, { timeout: 10000 });
          if (!resp.ok) return { result: { value: 0, status: 'error' } };
          const xml = new DOMParser().parseFromString(await resp.text(), 'text/xml');
          if (xml.querySelector('parsererror')) return { result: { value: 0, status: 'error' } };
          const errorCode = xml.querySelector('errorCode')?.textContent?.trim();
          if (errorCode) return { errorCode, result: { value: 0, status: 'error' } };
          const el = xml.querySelector('TotalCount') || xml.querySelector('totalCount');
          const value = parseInt(el?.textContent) || 0;
          return { result: { value, status: value > 0 ? 'ok' : 'no_result' } };
        };
        try {
          let out = await attempt();
          if (out.errorCode === 'E4103') {   // 토큰 만료 → 갱신 후 1회 재시도
            await refreshTokenOnce();
            out = await attempt();
          }
          return out.result;
        } catch { return { value: 0, status: 'error' }; }
      };

      const lastCompleteYear = new Date().getFullYear() - 1;
      const years = [lastCompleteYear - 3, lastCompleteYear - 2, lastCompleteYear - 1, lastCompleteYear];
      // 후보 전체 × 연도 전체를 한꺼번에 병렬 호출하면(예: 6후보×4개년=24요청) ScienceON이
      // 429로 차단해 후보들이 통째로 탈락한다. 후보는 2개씩, 연도는 순차로 호출한다.
      return mapWithConcurrency(candidates, 2, async candidate => {
        const kw = typeof candidate === 'string' ? candidate : candidate.query;
        const label = typeof candidate === 'string' ? candidate : candidate.keyword;
        const yearly = [];
        for (const year of years) yearly.push(await fetchYearCount(kw, year));
        const summary = CommerceScoring.summarizeTrendMetrics(yearly, 20);
        return {
          keyword: label,
          query: kw,
          years,
          ...summary,
        };
      });
    }

    // ── Stage 4-B: 다양성 보정 + TOP 3 선정 ─────────────────────
    function keywordWordOverlap(kw1, kw2) {
      const stopWords = new Set(['and','or','of','in','for','the','a','an','with','based','using','via','by']);
      const toWords = kw => new Set(
        kw.toLowerCase().split(/\s+/).filter(w => w.length >= 2 && !stopWords.has(w))
      );
      const w1 = toWords(kw1), w2 = toWords(kw2);
      if (w1.size === 0 || w2.size === 0) return 0;
      const intersection = [...w1].filter(w => w2.has(w)).length;
      return intersection / Math.min(w1.size, w2.size);
    }

    function selectTop3WithDiversity(results, trendSignals = []) {
      const sigMap = Object.fromEntries(trendSignals.map(s => [s.keyword, s]));
      results.forEach(r => {
        r.trendSignal = sigMap[r.keyword] || null;
        // 검색 완화 수준과 검색어 폭이 비슷한 후보끼리만 상대 기준을 만든다.
        // 후보 전체 중앙값 하나를 공유하면 넓은 단어 검색이 다른 후보의 공백도를 흔든다.
        r.peerContext = CommerceScoring.buildPeerContext(results, 5, r);
        r.indicators = calcCommerceIndicators(r, r.trendSignal, r.peerContext);
        r.score = r.indicators.rankingScore;
      });
      const sorted = [...results].sort((a, b) => b.score - a.score);
      const selected  = [];
      const eliminated = [];
      const exploratory = [];
      for (const candidate of sorted) {
        if (!candidate.indicators.eligible) {
          if (candidate.indicators.exploratory) {
            candidate.eliminatedReason = `초기 탐색 후보 — 논문 ${candidate.counts.arti}건, 추세·신뢰도 확인 후 재검토`;
            exploratory.push(candidate);
            continue;
          }
          const hasDataError = ['arti', 'patent'].some(name => candidate.metrics?.[name]?.status === 'error');
          candidate.eliminatedReason = hasDataError
            ? '핵심 데이터 조회 오류 — 0건과 구분하여 순위에서 제외'
            : !candidate.indicators.confidenceGate
              ? `데이터 신뢰도 ${candidate.indicators.confidence}점 — 최소 60점 미만으로 순위 보류`
              : `논문 ${candidate.counts.arti}건 — 연구 기반 부족 (최소 20건 필요)`;
          eliminated.push(candidate);
          continue;
        }
        if (selected.length >= 3) {
          candidate.eliminatedReason = '점수 하위 (TOP 3 이미 선정됨)';
          eliminated.push(candidate);
          continue;
        }
        const dupWith = selected.find(s =>
          (candidate.theme && s.theme && candidate.theme === s.theme) ||
          keywordWordOverlap(s.keyword, candidate.keyword) >= 0.5
        );
        if (dupWith) {
          candidate.eliminatedReason = `"${dupWith.keyword}"와 유사 — 다양성 보정으로 제외`;
          eliminated.push(candidate);
        } else {
          candidate.rank = selected.length + 1;
          selected.push(candidate);
        }
      }
      // 다양성 기준으로 제외한 후보를 Top 3 숫자를 채우기 위해 다시 넣지 않는다.
      // 서로 다른 유효 후보가 부족하면 Top 1/2만 반환하는 것이 더 정직하다.
      return { top3: selected, eliminated, exploratory };
    }

    function saveCommerceSnapshot(mainQuery, results) {
      const key = 'sc_commerce_history_v3';
      let history = [];
      try { history = JSON.parse(localStorage.getItem(key) || '[]'); } catch { history = []; }
      if (!Array.isArray(history)) history = [];
      history.unshift({
        version: 3,
        createdAt: new Date().toISOString(),
        mainQuery,
        results: results.map(r => ({
          scoringVersion: 4,
          keyword: r.keyword,
          rank: r.rank || null,
          counts: r.counts,
          metrics: r.metrics,
          queryMeta: r.queryMeta,
          trendSignal: r.trendSignal,
          indicators: r.indicators,
          peerContext: r.peerContext,
          enrichment: r.enrichment,
        })),
      });
      try { localStorage.setItem(key, JSON.stringify(history.slice(0, 50))); }
      catch (error) { console.warn('[CommerceHistory] 저장 실패:', error.message); }
    }

    window.exportCommerceHistory = function exportCommerceHistory() {
      const raw = localStorage.getItem('sc_commerce_history_v3') || '[]';
      const blob = new Blob([raw], { type: 'application/json;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `commerce-analysis-history-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };

    // 비교 대시보드 렌더링 (top3 + eliminated + exploratory + AI 분석 테마)
    function renderTechCommerceComparison(mainQuery, themes, top3, eliminated, exploratory = [], modelExperiment = null) {
      const today  = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });
      top3 = Array.isArray(top3) ? top3 : [];
      eliminated = Array.isArray(eliminated) ? eliminated : [];
      exploratory = Array.isArray(exploratory) ? exploratory : [];
      const hasRankedCandidates = top3.length > 0;
      const allZero = !hasRankedCandidates;

      const displayScore = value => Number.isFinite(Number(value)) ? Number(value).toFixed(1) : '0.0';

      // ── 포지션 레이블 ─────────────────────────────────────────────
      const getStatus = result => {
        const { arti, patent } = result.counts;
        const trendSignal = result.trendSignal;
        const gapSignal = Number(result.indicators?.components?.gapSignal) || 0;
        const patentIntensity = Number(result.indicators?.components?.patentIntensity) || 0;
        const hasCoreError = ['arti', 'patent'].some(name => result.metrics?.[name]?.status === 'error');
        if (hasCoreError) return { icon: '❓', label: '핵심 데이터 오류', color: '#9ca3af', bg: '#f9fafb' };
        if (arti === 0) return { icon: '❓', label: '데이터 없음', color: '#9ca3af', bg: '#f9fafb' };
        // 특허 0건: 진짜 공백인지 검색 실패인지 불확실 → 수동 검증 권고
        if (patent === 0) return { icon: '⚠️', label: '특허 0건 (검증 필요)', color: '#b45309', bg: '#fffbeb' };
        const isGrowing    = (trendSignal?.growthRate ?? 0) > 20;
        if (gapSignal >= 60 && isGrowing) return { icon: '🎯', label: '급성장 공백 후보', color: '#1d4ed8', bg: '#eff6ff' };
        if (gapSignal >= 60) return { icon: '🔎', label: '공백 신호 강함', color: '#1d4ed8', bg: '#dbeafe' };
        if (gapSignal >= 35) return { icon: '📈', label: '공백 신호 관찰', color: '#b45309', bg: '#fefce8' };
        if (patentIntensity >= 100) return { icon: '🔴', label: 'IP 밀집·우세', color: '#dc2626', bg: '#fef2f2' };
        return { icon: '🌱', label: isGrowing ? '성장 탐색 후보' : '균형·성숙 후보', color: '#059669', bg: '#ecfdf5' };
      };

      const rankMedal  = r => r === 1 ? '🥇' : r === 2 ? '🥈' : '🥉';
      const rankColors = {
        1: { border:'#f59e0b', headerBg:'linear-gradient(135deg,#111 0%,#1d4ed8 100%)', headerText:'white', cardBg:'#fffbeb' },
        2: { border:'#9ca3af', headerBg:'linear-gradient(135deg,#374151 0%,#4b5563 100%)', headerText:'white', cardBg:'#f9fafb' },
        3: { border:'#cd7c3a', headerBg:'linear-gradient(135deg,#78350f 0%,#b45309 100%)', headerText:'white', cardBg:'#fff7ed' },
      };

      const modelExperimentHtml = modelExperiment ? `
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-left:4px solid #64748b;border-radius:8px;padding:10px 14px;margin-bottom:18px;font-size:11px;color:#475569;">
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;">
            <strong style="color:#0f172a;">AI 품질 실험 결과: ${escHtml(modelExperiment.winnerLabel)} 선택</strong>
            <span style="color:#64748b;">Stage 2 후보 생성 기준</span>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;">
            ${modelExperiment.attempts.map(a => `
              <span style="display:inline-flex;align-items:center;gap:6px;background:white;border:1px solid #e2e8f0;border-radius:999px;padding:4px 9px;">
                <strong style="color:${a.model === modelExperiment.winner ? '#2563eb' : '#64748b'};">${escHtml(a.label)}</strong>
                <span>${a.error ? '오류' : `${a.score}점 · 후보 ${a.candidateCount}개 · ${(a.latencyMs / 1000).toFixed(1)}초`}</span>
              </span>`).join('')}
          </div>
        </div>` : '';

      // ── 순위 카드 HTML ────────────────────────────────────────────
      const rankCards = top3.map(r => {
        const { arti, patent, ntis } = r.counts;
        const st    = getStatus(r);
        const sc    = displayScore(r.indicators?.opportunity);
        const evidence = displayScore(r.indicators?.evidence);
        const evidenceCoverage = displayScore(r.indicators?.evidenceCoverage);
        const confidence = displayScore(r.indicators?.confidence);
        const col   = rankColors[r.rank] || rankColors[3];
        const kw    = r.keyword.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const scoreBar = `<div style="background:#e5e7eb;border-radius:999px;height:6px;margin-top:6px;overflow:hidden;">
          <div style="background:${r.rank===1?'#1d4ed8':'#6b7280'};height:6px;width:${sc}%;border-radius:999px;transition:width 0.6s;"></div></div>`;

        return `
          <div id="rankCard_${r.rank}" onclick="selectRankCard(${r.rank})"
              style="flex:1;min-width:240px;border:2px solid ${col.border};border-radius:14px;overflow:hidden;cursor:pointer;transition:box-shadow 0.2s,transform 0.2s;box-shadow:0 2px 8px rgba(0,0,0,0.07);"
              onmouseover="this.style.transform='translateY(-3px)';this.style.boxShadow='0 8px 24px rgba(0,0,0,0.12)'"
              onmouseout="this.style.transform='';this.style.boxShadow='0 2px 8px rgba(0,0,0,0.07)'">
            <!-- 카드 헤더 -->
            <div style="background:${col.headerBg};color:${col.headerText};padding:12px 16px;display:flex;align-items:center;justify-content:space-between;">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:22px;">${rankMedal(r.rank)}</span>
                <div>
                  <p style="font-size:10px;opacity:0.7;margin:0;">${r.rank}순위 유망 분야</p>
                  <p style="font-size:14px;font-weight:800;margin:0;line-height:1.2;">${escHtml(r.keyword)}</p>
                </div>
              </div>
              <div style="text-align:right;">
                <p style="font-size:10px;opacity:0.7;margin:0;">공백 매력도</p>
                <p style="font-size:22px;font-weight:900;margin:0;line-height:1;">${sc}</p>
              </div>
            </div>
            <!-- 카드 바디 -->
            <div style="background:${col.cardBg};padding:14px 16px;">
              <div style="display:flex;gap:10px;margin-bottom:10px;">
                <div style="flex:1;text-align:center;background:white;border-radius:8px;padding:8px 4px;border:1px solid #e5e7eb;">
                  <p style="font-size:10px;color:#6b7280;margin:0;">논문</p>
                  <p style="font-size:16px;font-weight:700;color:#1d4ed8;margin:0;">${arti.toLocaleString()}</p>
                </div>
                <div style="flex:1;text-align:center;background:white;border-radius:8px;padding:8px 4px;border:1px solid #e5e7eb;">
                  <p style="font-size:10px;color:#6b7280;margin:0;">특허</p>
                  <p style="font-size:16px;font-weight:700;color:#374151;margin:0;">${patent.toLocaleString()}</p>
                  ${r.patentQuery && r.patentQuery !== r.keyword ? `<p style="font-size:9px;color:#9ca3af;margin:0;">"${escHtml(r.patentQuery)}"</p>` : ''}
                </div>
                <div style="flex:1;text-align:center;background:white;border-radius:8px;padding:8px 4px;border:1px solid #e5e7eb;">
                  <p style="font-size:10px;color:#6b7280;margin:0;">NTIS</p>
                  <p style="font-size:16px;font-weight:700;color:#111;margin:0;">${ntis.toLocaleString()}</p>
                </div>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;">
                <span style="background:${st.bg};color:${st.color};font-size:10px;font-weight:700;padding:3px 8px;border-radius:999px;">${st.icon} ${st.label}</span>
              </div>
              ${scoreBar}
              <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;margin-top:10px;">
                <div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:6px;text-align:center;"><p style="font-size:9px;color:#6b7280;margin:0;">공백 매력도</p><strong style="font-size:12px;color:#1d4ed8;">${sc}</strong></div>
                <div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:6px;text-align:center;"><p style="font-size:9px;color:#6b7280;margin:0;">전환·실행 근거</p><strong style="font-size:12px;color:#7c3aed;">${evidence}</strong><small style="display:block;font-size:8px;color:#98a2b3;">범위 ${evidenceCoverage}%</small></div>
                <div style="background:white;border:1px solid #e5e7eb;border-radius:6px;padding:6px;text-align:center;"><p style="font-size:9px;color:#6b7280;margin:0;">데이터 신뢰도</p><strong style="font-size:12px;color:#059669;">${confidence}</strong></div>
              </div>
              ${r.queryMeta?.relaxed ? `<p style="font-size:9px;color:#b45309;margin:7px 0 0;">검색 완화 적용: “${escHtml(r.queryMeta.canonicalQuery)}” — 논문·특허 동일 범위 비교</p>` : ''}
              <p style="font-size:11px;color:#6b7280;margin:8px 0 0 0;line-height:1.45;">${r.aiReason ? escHtml(r.aiReason) : ''}</p>
              <p style="font-size:10px;color:#9ca3af;margin:8px 0 0 0;text-align:right;">카드 클릭 → 상세 리포트 전환</p>
            </div>
          </div>`;
      }).join('');

      // ── Step 1: AI 도메인 세부 기술 테마 섹션 ────────────────────
      const themesHtml = (themes && themes.length) ? `
        <details open style="margin-bottom:24px;">
          <summary style="font-size:13px;font-weight:700;color:#111;margin:0 0 4px 0;cursor:pointer;user-select:none;list-style:none;display:flex;align-items:center;gap:6px;">
            <span style="font-size:15px;">🧠</span> Step 1 — AI 도메인 세부 기술 테마 (${themes.length}개)
            <span style="font-size:11px;font-weight:500;color:#9ca3af;">▼ 펼치기/접기</span>
          </summary>
          <p style="font-size:11px;color:#9ca3af;margin:6px 0 10px 0;">실제 논문·특허 표본(제목·저자키워드·IPC)의 용어 빈도에 근거해 AI가 요약한 세부 기술 테마와 검증 가설입니다. 각 테마의 "근거 용어"는 관측 데이터에서 인용된 것입니다. 공백 여부는 이 단계에서 확정하지 않으며, 후보별 동일 검색 범위의 실측 데이터로 다음 단계에서 검증합니다.</p>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:8px;">
            ${themes.map((t, i) => {
              const isNonComm = t.nonCommercial;
              let bg, color, badge;
              if (isNonComm) {
                bg = '#f3f4f6'; color = '#6b7280'; badge = '⚪ 비사업화 제외';
              } else {
                bg = '#eff6ff'; color = '#1d4ed8'; badge = '🔵 검증 가설';
              }
              return `<div style="background:${bg};border-left:3px solid ${color};padding:10px 12px;border-radius:0 8px 8px 0;font-size:11px;${isNonComm ? 'opacity:0.75;' : ''}">
                <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                  <span style="color:#9ca3af;font-weight:700;font-size:10px;">#${i+1}</span>
                  <span style="font-weight:700;color:#111;flex:1;${isNonComm ? 'text-decoration:line-through;color:#9ca3af;' : ''}">${escHtml(t.theme || t.keyword || '')}</span>
                  <span style="font-weight:700;color:${color};white-space:nowrap;">${badge}</span>
                </div>
                ${isNonComm ? '<p style="color:#9ca3af;margin:0;line-height:1.4;">정책·제도·법률 등 특허/제품화가 어려운 영역으로 점수 산출에서 제외됩니다.</p>' : ((t.hypothesis || t.reason) ? `<p style="color:#6b7280;margin:0;line-height:1.4;">${escHtml(t.hypothesis || t.reason)}</p>` : '')}
                ${!isNonComm && Array.isArray(t.evidence) && t.evidence.length ? `<p style="color:#9ca3af;margin:4px 0 0;font-size:10px;line-height:1.4;">근거 용어: ${t.evidence.map(e => escHtml(e)).join(' · ')}</p>` : ''}
              </div>`;
            }).join('')}
          </div>
        </details>` : '';

      // ── 제외된 후보 섹션 ─────────────────────────────────────────
      const eliminatedHtml = eliminated.length ? `
        <details style="margin-bottom:16px;">
          <summary style="font-size:12px;font-weight:600;color:#9ca3af;cursor:pointer;padding:8px 0;user-select:none;">
            ▶ 제외된 후보 ${eliminated.length}건 (투명성 공개)
          </summary>
          <div style="margin-top:8px;display:flex;flex-direction:column;gap:4px;">
            ${eliminated.map(r => `
              <div style="background:#f9fafb;border:1px solid #e5e7eb;padding:8px 12px;border-radius:6px;display:flex;align-items:center;gap:10px;font-size:11px;flex-wrap:wrap;">
                <span style="font-weight:600;color:#374151;flex:1;">${escHtml(r.keyword)}</span>
                <span style="color:#6b7280;">논문 ${r.counts.arti.toLocaleString()}건 · 특허 ${r.counts.patent.toLocaleString()}건</span>
                <span style="background:#fee2e2;color:#dc2626;padding:2px 8px;border-radius:999px;font-weight:600;white-space:nowrap;">${escHtml(r.eliminatedReason || '제외')}</span>
              </div>`).join('')}
          </div>
        </details>` : '';

      const exploratoryHtml = exploratory.length ? `
        <details style="margin-bottom:16px;">
          <summary style="font-size:12px;font-weight:600;color:#047857;cursor:pointer;padding:8px 0;user-select:none;">
            ▶ 초기 탐색 후보 ${exploratory.length}건 (정식 순위 미포함)
          </summary>
          <p style="font-size:11px;color:#6b7280;margin:0 0 8px;">논문 5~19건이지만 최근 연구 모멘텀과 데이터 신뢰도가 기준을 충족한 후보입니다. 충분한 누적 데이터가 생긴 뒤 정식 순위로 재평가합니다.</p>
          <div style="display:flex;flex-direction:column;gap:4px;">
            ${exploratory.map(r => `
              <div style="background:#ecfdf5;border:1px solid #a7f3d0;padding:8px 12px;border-radius:6px;display:flex;align-items:center;gap:10px;font-size:11px;flex-wrap:wrap;">
                <span style="font-weight:600;color:#065f46;flex:1;">${escHtml(r.keyword)}</span>
                <span style="color:#047857;">논문 ${r.counts.arti.toLocaleString()}건 · 특허 ${r.counts.patent.toLocaleString()}건 · 신뢰도 ${r.indicators.confidence}</span>
              </div>`).join('')}
          </div>
        </details>` : '';

      // ── 방법론 설명 ───────────────────────────────────────────────
      const methodologyHtml = `
        <details style="margin-top:24px;">
          <summary style="font-size:13px;font-weight:700;color:#374151;cursor:pointer;padding:12px 16px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:10px;user-select:none;list-style:none;display:flex;align-items:center;gap:8px;">
            <span style="font-size:16px;">📖</span> 연구–IP 전환 공백 분석 — 절차·방법·의미
          </summary>
          <div style="background:#f8fafc;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 10px 10px;padding:20px 24px;font-size:12px;color:#374151;line-height:1.7;">

            <p style="font-weight:700;color:#111;margin:0 0 14px 0;">📌 분석 목적</p>
            <p style="margin:0 0 16px 0;">입력 키워드 주변에서 <strong>연구–IP 전환 공백 신호</strong>를 탐색합니다. 결과는 사업화 성공확률이 아니라 후속 검토 우선순위이며, 전환·실행 근거와 데이터 신뢰도를 별도로 제공합니다.</p>

            <p style="font-weight:700;color:#111;margin:0 0 10px 0;">🔄 4단계 분석 절차</p>
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:16px;">
              <div style="background:white;border:1px solid #e5e7eb;border-left:4px solid #111;border-radius:6px;padding:12px 14px;">
                <p style="font-weight:700;color:#111;margin:0 0 4px 0;">Step 1 — AI 도메인 테마 분석</p>
                <p style="margin:0;color:#6b7280;">Cerebras AI가 세부 기술 테마 5~8개와 검색식 가설을 생성합니다. 이 단계의 공백 판단은 확정값이 아니며, 모든 사업화 가능 테마를 다음 단계의 실측 검증 대상으로 유지합니다.</p>
              </div>
              <div style="background:white;border:1px solid #e5e7eb;border-left:4px solid #1d4ed8;border-radius:6px;padding:12px 14px;">
                <p style="font-weight:700;color:#1d4ed8;margin:0 0 4px 0;">Step 2 — 세부 키워드 생성 및 데이터 수집</p>
                <p style="margin:0;color:#6b7280;">테마별로 한국어 세부 키워드와 동의어·띄어쓰기 변형을 생성합니다. 선택된 canonical 검색식은 논문과 특허에 동일하게 적용하고, ScienceON·NTIS 데이터와 조회 시각을 함께 기록합니다.</p>
              </div>
              <div style="background:white;border:1px solid #e5e7eb;border-left:4px solid #059669;border-radius:6px;padding:12px 14px;">
                <p style="font-weight:700;color:#059669;margin:0 0 4px 0;">Step 3 — 3개 지표 산출</p>
                <p style="margin:0;color:#6b7280;">논문 20건 미만, 핵심 데이터 오류, 신뢰도 60점 미만 후보는 정식 순위에서 보류합니다. 논문 5~19건 후보는 성장·신뢰도 조건을 만족할 때만 <strong>초기 탐색 후보</strong>로 별도 표시합니다. 통과 후보는 <strong>공백 매력도</strong>(연구 기반 35% + IP 공백 신호 40% + 연구 모멘텀·안정성 25%), <strong>전환·실행 근거</strong>(NTIS·보고서·특허 전환 신호), <strong>데이터 신뢰도</strong>(API 상태·검색 완화 깊이·관측량·추세 완결성)로 분리합니다. 직접 IP 공백은 <strong>log10((논문+1)/(특허+1))/2</strong>로 산출해 같은 특허/논문 비율의 규모 편향을 줄입니다. 후보군 상대 비교는 핵심 데이터가 정상이고 논문 5건 이상이며 검색 완화 수준·검색어 폭이 비슷한 후보가 3개 이상일 때만 사용하고, 후보 수와 분포 안정성에 따라 반영 비중을 낮춥니다.</p>
              </div>
              <div style="background:white;border:1px solid #e5e7eb;border-left:4px solid #f59e0b;border-radius:6px;padding:12px 14px;">
                <p style="font-weight:700;color:#b45309;margin:0 0 4px 0;">Step 4 — 최종 순위 선정 (Top 3)</p>
                <p style="margin:0;color:#6b7280;">공백 매력도에 데이터 신뢰도를 직접 반영한 내부 우선순위로 정렬하고, 같은 테마·유사 키워드는 한 개만 선정합니다. 정식 순위 조건을 통과한 서로 다른 후보가 3개보다 적으면 유사 후보를 다시 채우지 않고 Top 1~2만 표시합니다. 전환·실행 근거는 순위와 분리하며, 표시값은 사업화 성공확률이 아닙니다.</p>
              </div>
            </div>

            <p style="font-weight:700;color:#111;margin:0 0 10px 0;">📊 결과 해석 가이드</p>
            <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:8px;margin-bottom:12px;">
              <div style="background:white;border:1px solid #dbeafe;border-radius:8px;padding:10px 12px;">
                <p style="font-size:11px;font-weight:700;color:#1d4ed8;margin:0 0 3px 0;">🔎 강한 공백 후보</p>
                <p style="font-size:11px;color:#6b7280;margin:0;">논문 대비 보정 로그 특허 비중이 낮고, 비교 가능한 후보군 기준에서도 낮으며 데이터 신뢰도가 확보된 후속검토 후보</p>
              </div>
              <div style="background:white;border:1px solid #dcfce7;border-radius:8px;padding:10px 12px;">
                <p style="font-size:11px;font-weight:700;color:#15803d;margin:0 0 3px 0;">🌱 신흥 분야</p>
                <p style="font-size:11px;color:#6b7280;margin:0;">논문·특허 모두 초기 단계 — 성장성과 데이터 안정성을 함께 확인할 탐색 후보</p>
              </div>
              <div style="background:white;border:1px solid #fef9c3;border-radius:8px;padding:10px 12px;">
                <p style="font-size:11px;font-weight:700;color:#b45309;margin:0 0 3px 0;">📈 성장/성숙기</p>
                <p style="font-size:11px;color:#6b7280;margin:0;">경쟁이 시작된 분야 — 틈새 응용 특허 전략 필요, 차별화가 핵심</p>
              </div>
              <div style="background:white;border:1px solid #fee2e2;border-radius:8px;padding:10px 12px;">
                <p style="font-size:11px;font-weight:700;color:#dc2626;margin:0 0 3px 0;">🔴 레드오션</p>
                <p style="font-size:11px;color:#6b7280;margin:0;">논문 대비 IP 색인 강도가 높아 공백 신호가 약한 분야 — 실제 권리 장벽은 FTO로 별도 확인</p>
              </div>
            </div>

            <p style="font-size:11px;color:#9ca3af;margin:0;border-top:1px solid #e5e7eb;padding-top:10px;">
              ※ 특허 0건은 공백 만점으로 보지 않고 신뢰도도 감점합니다. 특허 패밀리·유효권리·연구-특허 시차·시장·TRL 데이터는 아직 미연결이므로 최종 투자·사업화 결정 전에 FTO와 별도 검토가 필요합니다.
            </p>
          </div>
        </details>`;

      const section = document.getElementById('analysisSection');
      section.innerHTML = `
        <div id="comparisonDashboard" class="analysis-card fade-up" style="max-width:1040px;margin:0 auto;">
          <div class="analysis-header flex items-center justify-between">
            <div class="flex items-center gap-2">
              <iconify-icon icon="solar:graph-up-bold-duotone" width="20"></iconify-icon>
              <div>
                <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">연구–IP 전환 공백 분석 — 4단계 검증 파이프라인</p>
                <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(mainQuery)}"</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button onclick="exportCommerceHistory()" style="font-size:10px;border:1px solid rgba(255,255,255,.35);border-radius:6px;padding:4px 7px;">분석 이력 JSON</button>
              <span style="font-size:11px;opacity:0.5;">${today}</span>
              <button onclick="document.getElementById('analysisSection').classList.add('hidden')" class="text-white/60 hover:text-white transition-colors">
                <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
              </button>
            </div>
          </div>

          <div class="analysis-body bg-white" style="padding:28px 32px;">

            <!-- 데이터 부족 경고 -->
            ${allZero ? `<div style="background:#fef3c7;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:6px;margin-bottom:16px;font-size:12px;color:#92400e;">
              ⚠️ <strong>정식 공백 우선순위는 산출하지 않았습니다.</strong> 논문 표본·핵심 데이터·신뢰도 기준을 통과한 후보가 없습니다.<br>
              아래 초기 탐색 후보와 제외 사유에서 검색 완화 수준, API 오류, 관측량을 확인하세요.
            </div>` : ''}

            <!-- 메타 callout -->
            <div style="background:#fafafa;border-left:4px solid #111;padding:10px 14px;border-radius:6px;margin-bottom:20px;font-size:11px;color:#555;">
              🤖 Cerebras AI + ScienceON + NTIS 실시간 데이터 기반 분석 &nbsp;|&nbsp; ${today}
            </div>

            ${modelExperimentHtml}

            <!-- Step 1: AI 세부 기술 테마 -->
            ${themesHtml}

            <!-- ★ 순위별 카드 -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 12px 0;">🏅 연구–IP 전환 공백 우선 검토 후보</h3>
            <div style="display:flex;flex-wrap:wrap;gap:16px;margin-bottom:24px;" id="rankCardGrid">
              ${rankCards || '<p style="font-size:12px;color:#6b7280;margin:0;">정식 순위 기준을 통과한 후보가 없습니다.</p>'}
            </div>

            <!-- 제외된 후보 -->
            ${eliminatedHtml}

            <!-- 초기 탐색 후보 -->
            ${exploratoryHtml}

            <!-- ★ 세부 분석 리포트 영역 (카드 클릭 시 전환) -->
            <div id="detailReportArea" style="display:none;"></div>

            <!-- 방법론 설명 -->
            ${methodologyHtml}

          </div>
        </div>`;

      // 카드 선택 함수 — 선택된 카드 강조 + 세부 리포트 전환
      window.selectRankCard = function(rank) {
        // 카드 강조
        top3.forEach(r => {
          const card = document.getElementById(`rankCard_${r.rank}`);
          if (!card) return;
          if (r.rank === rank) {
            card.style.outline = '3px solid #1d4ed8';
            card.style.outlineOffset = '2px';
          } else {
            card.style.outline = '';
            card.style.outlineOffset = '';
          }
        });
        // 리포트 표시
        const r = top3.find(x => x.rank === rank);
        if (r) {
          showDetailedReportInline(r.keyword, r.counts, r.topPapers, r.topPatents, r.indicators, r.queryMeta);
          document.getElementById('detailReportArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      };

      // 1위 카드 자동 선택
      if (hasRankedCandidates) selectRankCard(1);

      // 캐시
      window._techCommerceCache = {};
      top3.forEach(r => { window._techCommerceCache[r.keyword] = r; });
      eliminated.forEach(r => { window._techCommerceCache[r.keyword] = r; });
      exploratory.forEach(r => { window._techCommerceCache[r.keyword] = r; });
      saveCommerceSnapshot(mainQuery, [...top3, ...eliminated, ...exploratory]);
    }

    // 비교 테이블에서 키워드 클릭 시 상세 리포트 전환
    function showDetailedReport(keyword) {
      const cached = window._techCommerceCache?.[keyword];
      if (!cached) return;
      // rank가 있는 경우 카드 선택 UI 동반
      if (cached.rank && window.selectRankCard) {
        window.selectRankCard(cached.rank);
      } else {
        showDetailedReportInline(keyword, cached.counts, cached.topPapers, cached.topPatents, cached.indicators, cached.queryMeta);
        document.getElementById('detailReportArea')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }

    function showDetailedReportInline(keyword, counts, topPapers, topPatents, indicators = null, queryMeta = null) {
      const area = document.getElementById('detailReportArea');
      if (!area) return;
      area.style.display = 'block';
      area.innerHTML = `
        <div style="border-top:2px solid #e5e7eb;padding-top:24px;margin-top:8px;">
          <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 16px 0;">📋 "${escHtml(keyword)}" 상세 분석 리포트</h3>
          ${indicators ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:16px;">
            <div style="background:#eff6ff;padding:10px;border-radius:8px;text-align:center;"><small>공백 매력도</small><strong style="display:block;color:#1d4ed8;">${indicators.opportunity.toFixed(1)}</strong></div>
            <div style="background:#f5f3ff;padding:10px;border-radius:8px;text-align:center;"><small>전환·실행 근거</small><strong style="display:block;color:#7c3aed;">${indicators.evidence.toFixed(1)}</strong><small style="display:block;color:#98a2b3;">근거 범위 ${indicators.evidenceCoverage}%</small></div>
            <div style="background:#ecfdf5;padding:10px;border-radius:8px;text-align:center;"><small>데이터 신뢰도</small><strong style="display:block;color:#059669;">${indicators.confidence.toFixed(1)}</strong></div>
          </div>` : ''}
          ${queryMeta ? `<p style="font-size:10px;color:#6b7280;margin:0 0 12px;">비교 검색어: “${escHtml(queryMeta.canonicalQuery)}” · 논문/특허 동일 범위${queryMeta.relaxed ? ' · 원 후보에서 검색 완화됨' : ''}</p>` : ''}
          <div id="detailReportInner"></div>
        </div>`;
      renderWhiteSpaceDashboard(keyword, counts, topPapers, topPatents,
        document.getElementById('detailReportInner'), { indicators, queryMeta });
    }

    // ============================================================

    // ============================================================

    async function runWhiteSpaceAnalysis() {
      const query = document.getElementById('searchInput').value.trim();
      if (!query) {
        showToast('분석할 키워드를 입력해주세요', 'warning');
        document.getElementById('searchInput').focus();
        return;
      }

      document.body.classList.add('search-mode');
      hideAll();

      const analysisSection = document.getElementById('analysisSection');
      analysisSection.classList.remove('hidden');
      analysisSection.innerHTML = `
        <div class="analysis-card analysis-loading-pulse">
          <div class="analysis-header flex items-center justify-between">
            <div class="flex items-center gap-2">
              <iconify-icon icon="solar:chart-2-bold-duotone" width="20"></iconify-icon>
              <span class="font-bold">기술 공백(White Space) 분석 중...</span>
            </div>
            <div class="spinner" style="width:20px; height:20px; border-width:2px; border-top-color:white;"></div>
          </div>
          <div class="analysis-body">
            <p class="text-gray-500 text-sm mb-4">"${escHtml(query)}" 분야의 논문·특허·보고서·동향·연구자·NTIS 과제를 종합 분석 중입니다.</p>
            <div class="grid grid-cols-3 sm:grid-cols-6 gap-2">
              ${['논문', '특허', '보고서', '동향', '연구자', 'NTIS'].map(t => `
                <div class="p-3 rounded-xl bg-gray-50 border border-gray-100 text-center animate-pulse">
                  <p class="text-[10px] text-gray-300 font-bold mb-1">${t}</p>
                  <div class="h-5 w-10 bg-gray-200 rounded mx-auto"></div>
                </div>`).join('')}
            </div>
          </div>
        </div>`;

      try {
        // ScienceON API 호출 (count + top 결과)
        const fetchScienceON = async (target, rowCount = 1) => {
          const searchQuery = JSON.stringify({ BI: query });
          const url = `${getApiBase()}?client_id=${STATE.clientId}&token=${STATE.token}&version=1.0&action=search&target=${target}&searchQuery=${encodeURIComponent(searchQuery)}&rowCount=${rowCount}`;
          const resp = await fetch(url);
          const text = await resp.text();
          return new DOMParser().parseFromString(text, 'text/xml');
        };

        // NTIS API 호출
        const fetchNTIS = async (rowCount = 1) => {
          if (!STATE.ntisKey) return null;
          try {
            const url = `${getProxyBase()}/ntis?apprvKey=${STATE.ntisKey}&collection=project&query=${encodeURIComponent(query)}&displayCnt=${rowCount}&startPosition=1`;
            const resp = await fetch(url, { signal: AbortSignal.timeout(5000) });
            const text = await resp.text();
            return new DOMParser().parseFromString(text, 'text/xml');
          } catch { return null; }
        };

        const getCount = (xml, isNTIS = false) => {
          if (!xml) return 0;
          if (isNTIS) {
            const el = xml.getElementsByTagName('TOTALHITS')[0];
            return el ? parseInt(el.textContent) || 0 : 0;
          }
          const el = xml.querySelector('TotalCount') || xml.querySelector('totalCount');
          return el ? parseInt(el.textContent) || 0 : 0;
        };

        // 5개 데이터 타입 병렬 수집 — 논문 TOP 3, 특허 TOP 5 결과도 함께
        const [artiXml, patentXml, reportXml, attXml, ntisXml] = await Promise.all([
          fetchScienceON('ARTI', 3),
          fetchScienceON('PATENT', 5),
          fetchScienceON('REPORT', 1),
          fetchScienceON('ATT', 1),
          fetchNTIS(1),
        ]);

        const counts = {
          arti:   getCount(artiXml),
          patent: getCount(patentXml),
          report: getCount(reportXml),
          att:    getCount(attXml),
          ntis:   getCount(ntisXml, true),
        };

        // TOP 결과 추출 (recordList record 구조)
        const getTopItems = (xml, n = 3) => {
          if (!xml) return [];
          const records = Array.from(xml.querySelectorAll('recordList record, record'));
          return records.slice(0, n);
        };

        renderWhiteSpaceDashboard(query, counts, getTopItems(artiXml, 3), getTopItems(patentXml, 3));

      } catch (err) {
        console.error('[WhiteSpace] 분석 실패:', err);
        showToast('분석 중 오류가 발생했습니다. API 설정을 확인하세요.', 'error');
        analysisSection.classList.add('hidden');
      }
    }

    function renderWhiteSpaceDashboard(query, counts, topPapers, topPatents, targetEl = null, analysisMeta = null) {
      const { arti, patent, report, att, ntis } = counts;
      const today = new Date().toLocaleDateString('ko-KR', { year:'numeric', month:'2-digit', day:'2-digit' });

      // ── 연구–IP 공백 지수 ───────────────────────────────────────────
      // 순위 카드에서 계산한 동일 지표를 우선 재사용한다. 단독 리포트 경로에서는
      // 로그 특허강도(로그 특허/로그 논문)의 결핍값을 사용한다.
      const logArti     = Math.log10(arti + 1);
      const logPatent   = Math.log10(patent + 1);
      const patentIntensity = logArti > 0 ? logPatent / logArti : 0;
      const directGapPct = Math.max(0, Math.min(100, (1 - patentIntensity) * 100));
      const gapPct = Number.isFinite(Number(analysisMeta?.indicators?.components?.gapSignal))
        ? Number(analysisMeta.indicators.components.gapSignal)
        : (patent === 0 && arti > 0 ? Math.min(directGapPct, 70) : directGapPct);
      const patentRatio = arti > 0 ? (patent / arti * 100) : 0;    // 참고용 raw 비율(표시 전용)
      const zeroPatent  = patent === 0 && arti > 0;

      // ── 상태 레이블 (순위와 동일한 gapPct 기준) ─────────────────────
      let statusBg, statusText, statusIcon, finalInsight;
      if (zeroPatent) {
        statusBg = '#eff6ff'; statusText = '특허 0건 (검증 필요)'; statusIcon = '⚠️';
        finalInsight = `검색된 특허가 0건입니다. 진짜 IP 공백인지 검색어·분류 차이인지 확인하고, 유효 특허·패밀리·FTO를 추가 검토하세요.`;
      } else if (gapPct >= 60) {
        statusBg = '#eff6ff'; statusText = '공백 신호 강함'; statusIcon = '🔎';
        finalInsight = `연구성과 대비 특허 색인 강도가 낮습니다. 검색 범위·유효권리·특허 패밀리를 확인한 뒤 특허성·시장성 검토 여부를 결정하세요.`;
      } else if (gapPct >= 35) {
        statusBg = '#f0fdf4'; statusText = '공백 신호 있음'; statusIcon = '🌱';
        finalInsight = `연구–특허 전환 격차가 관찰됩니다. 응용별 특허 분포와 실제 수요를 추가 확인할 가치가 있습니다.`;
      } else if (patentIntensity <= 1.10) {
        statusBg = '#fefce8'; statusText = '연구·IP 균형'; statusIcon = '⚖️';
        finalInsight = `연구와 특허가 로그 기준 비슷한 수준입니다. 세부 응용 영역에서 틈새 기회를 탐색하세요.`;
      } else if (patentIntensity <= 1.40) {
        statusBg = '#fff7ed'; statusText = 'IP 우세 (성숙기)'; statusIcon = '📈';
        finalInsight = `특허가 연구를 앞서는 성숙 분야입니다. 틈새 응용 특허 전략이 필요합니다.`;
      } else {
        statusBg = '#fef2f2'; statusText = 'IP 밀집·우세'; statusIcon = '🔴';
        finalInsight = `특허 색인 강도가 높아 공백 신호는 약합니다. 실제 진입장벽은 유효권리와 FTO 분석으로 별도 확인해야 합니다.`;
      }

      // ── 비고 텍스트 생성 ─────────────────────────────────────────
      const artiNote = arti > 10000 ? '해외논문 중심, 연구 매우 활발'
                     : arti > 1000  ? '국내외 연구 활발'
                     : arti > 100   ? '연구 진행 중'
                     : arti > 0     ? '초기 연구 단계'
                                    : '데이터 없음';

      // 특허 출원인 TOP 추출
      const patentApplicants = topPatents
        .map(it => (getVal(it, 'Publisher', 'Applicants') || '').split(/[;|,]/)[0].trim())
        .filter(Boolean);
      const uniqueApplicants = [...new Set(patentApplicants)].slice(0, 3);
      const patentNote = patent === 0       ? '검색 특허 0건 — 검색·패밀리 검증 필요'
                       : patent < 10        ? '특허 표본 적음 — 특허성·권리범위 검토 필요'
                       : uniqueApplicants.length > 0
                           ? uniqueApplicants.join(', ') + ' 등 중심'
                           : patent < arti / 20 ? '논문 대비 특허 색인 적음' : '경쟁 특허 다수';

      const reportNote     = report === 0  ? '보고서 없음' : '정부 R&D 보고서';
      const attNote        = att === 0     ? '전무 — 정보 공백 존재' : '동향 정보 존재';
      const ntisNote = ntis === 0 ? 'NTIS 과제 없음 또는 API 미연결'
                     : ntis > 200 ? `정부 투자 매우 활발`
                     : ntis > 50  ? `정부 투자 지속 중`
                                  : `정부 과제 존재`;

      // ── 특허 TOP 행 ───────────────────────────────────────────────
      const patentRows = topPatents.length === 0
        ? `<tr><td colspan="4" style="padding:12px;text-align:center;color:#9ca3af;font-size:11px;">특허 데이터 없음 (API 미연결 또는 결과 없음)</td></tr>`
        : topPatents.map((item, i) => {
            const title     = getVal(item, 'Title') || '(제목 없음)';
            const applicant = (getVal(item, 'Publisher', 'Applicants') || '').split(/[;|,]/)[0].trim();
            const year      = (getVal(item, 'Pubyear', 'ApplDate', 'RegisterDate') || '').substring(0, 4);
            const nation    = getVal(item, 'Nation', 'NationCode') || '';
            const docType   = getVal(item, 'DocType', 'KindCode') || '';
            return `<tr style="border-top:1px solid #f3f4f6;">
              <td style="padding:10px 8px;font-size:11px;font-weight:700;color:#9ca3af;width:24px;vertical-align:top">${i + 1}</td>
              <td style="padding:10px 8px;font-size:12px;color:#1f2937;line-height:1.5;vertical-align:top">${escHtml(title)}</td>
              <td style="padding:10px 8px;font-size:11px;color:#374151;white-space:nowrap;vertical-align:top;font-weight:500">${escHtml(applicant)}</td>
              <td style="padding:10px 8px;font-size:11px;color:#9ca3af;white-space:nowrap;vertical-align:top">${[nation, docType, year].filter(Boolean).join(' · ')}</td>
            </tr>`;
          }).join('');

      // ── 논문 TOP 행 ───────────────────────────────────────────────
      const paperList = topPapers.map((item, i) => {
        const title   = getVal(item, 'Title') || '(제목 없음)';
        const authors = getVal(item, 'Author') || '';
        const year    = (getVal(item, 'Pubyear', 'PublDate') || '').substring(0, 4);
        const journal = getVal(item, 'JournalName') || '';
        const auArr   = authors.split(/[;,|]/).map(a => a.trim()).filter(Boolean);
        const auShort = auArr.length ? auArr[0] + (auArr.length > 1 ? ` 외 ${auArr.length - 1}명` : '') : '';
        const meta    = [auShort, journal, year].filter(Boolean).join(' · ');
        return `<li style="padding:8px 0;border-top:1px solid #f3f4f6;">
          <p style="font-size:12px;font-weight:600;color:#1f2937;line-height:1.5;margin:0 0 3px 0">${escHtml(title)}</p>
          ${meta ? `<p style="font-size:11px;color:#9ca3af;margin:0">${escHtml(meta)}</p>` : ''}
        </li>`;
      }).join('');

      // ── 후속 검증 경로 생성 ───────────────────────────────────────
      const itDominated = uniqueApplicants.some(a =>
        /IBM|Samsung|LG|Qualcomm|Intel|Microsoft|Google|Apple|Huawei|Sony|NEC|Fujitsu|HITACHI/i.test(a));

      const scenarioA = {
        icon: '💡', coverage: '필수',
        title: `${escHtml(query)} 특허성·선행기술 검토`,
        basis: `논문 ${arti.toLocaleString()}건·특허 ${patent.toLocaleString()}건의 색인 규모 비교, 특허/논문 비율 ${arti > 0 ? Math.round(patentRatio).toLocaleString() + '%' : '-'}`,
        target: '해당 기술 연구팀, 지식재산·기술사업화 담당 조직',
        ip: '청구항 중복, 신규성·진보성, 유효 특허와 패밀리 범위 검증',
      };
      const scenarioB = {
        icon: '🏗️', coverage: ntis > 0 ? '근거 있음' : '근거 제한',
        title: `NTIS 과제·수행기관 연계 검토`,
        basis: ntis > 0 ? `동일 검색어 기준 NTIS 과제 ${ntis.toLocaleString()}건` : 'NTIS 결과가 없거나 조회되지 않아 추가 검색 필요',
        target: '관련 과제 수행기관·수요기관·기술이전 담당자',
        ip: '기존 과제 성과·중복성·후속 실증 수요 확인',
      };
      const scenarioC = {
        icon: '🌐', coverage: uniqueApplicants.length > 0 ? '표본 근거' : '가설',
        title: itDominated
          ? `상위 특허 표본의 응용영역 편중 여부 검증`
          : `${escHtml(query)} 응용·플랫폼 가설 검증`,
        basis: itDominated
          ? `상위 검색결과에서 ${uniqueApplicants.slice(0,2).join(', ')} 등이 확인됨 — 전체 출원인 분포와 IPC/CPC로 재검증 필요`
          : `상위 특허 표본만으로 응용 공백을 확정할 수 없어 수요·분류 기반 검증 필요`,
        target: '잠재 수요기업·현장 사용자·제품기획 담당자',
        ip: '응용별 문제–해결 적합성, 구현 차별성, 데이터·표준 의존성 검증',
      };

      // ── 즉시 실행 액션 플랜 ───────────────────────────────────────
      const actionPlan = [
        { period: '1~3개월 (단기)', icon: '⚡', items: [
          `${query} 관련 선행특허·비특허문헌 검색식 확장 및 유효권리 검토`,
          `주요 특허 보유자(${uniqueApplicants.length > 0 ? uniqueApplicants.slice(0,2).join(', ') : '해외 기업'}) FTO(Freedom to Operate) 조사 수행`,
        ]},
        { period: '3~6개월 (중기)', icon: '📋', items: [
          ntis > 0 ? `NTIS 과제 ${ntis.toLocaleString()}건의 수행기관·성과·중복성 분석` : '유사어·분류코드로 NTIS 검색 범위를 재검증',
          '잠재 수요기관 인터뷰로 해결 문제와 구매·도입 조건 확인',
        ]},
        { period: '6개월+ (장기)', icon: '🎯', items: [
          '특허성·시장성·TRL 근거가 확보된 후보만 실증·사업화 과제로 전환',
          '필요 시 FTO·표준·규제 검토를 포함한 단계별 투자 의사결정',
        ]},
      ];

      // ── 최종 렌더링 ───────────────────────────────────────────────
      const section = targetEl || document.getElementById('analysisSection');
      section.innerHTML = `
        <div class="analysis-card fade-up" style="max-width:900px;margin:0 auto;">
          <!-- 헤더 -->
          <div class="analysis-header flex items-center justify-between">
            <div class="flex items-center gap-2">
              <iconify-icon icon="solar:chart-2-bold-duotone" width="20"></iconify-icon>
              <div>
                <p style="font-size:11px;opacity:0.6;margin:0 0 2px 0">기술 공백(White Space) 분석 리포트</p>
                <p style="font-size:15px;font-weight:700;margin:0">"${escHtml(query)}"</p>
              </div>
            </div>
            <div class="flex items-center gap-3">
              <span style="font-size:11px;opacity:0.5;display:none" class="sm:block">${today}</span>
              <button onclick="document.getElementById('analysisSection').classList.add('hidden')" class="text-white/60 hover:text-white transition-colors">
                <iconify-icon icon="solar:close-circle-bold" width="18"></iconify-icon>
              </button>
            </div>
          </div>

          <div class="analysis-body bg-white" style="padding:28px 32px;">

            <!-- 메타 callout -->
            <div style="background:#eff6ff;border-left:4px solid #3b82f6;padding:10px 14px;border-radius:6px;margin-bottom:24px;font-size:11px;color:#1e40af;">
              📌 분석 도구: ScienceON API + NTIS API &nbsp;|&nbsp; 검색어: <strong>"${escHtml(query)}"</strong> &nbsp;|&nbsp; 분석 일시: ${today}
            </div>

            <!-- 핵심 수치 테이블 -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 10px 0;">📊 핵심 수치 (실측 데이터)</h3>
            <div style="overflow-x:auto;margin-bottom:28px;">
              <table style="width:100%;border-collapse:collapse;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden;font-size:12px;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb;">구분</th>
                    <th style="padding:10px 14px;text-align:right;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb;">건수</th>
                    <th style="padding:10px 14px;text-align:left;font-weight:700;color:#374151;border-bottom:1px solid #e5e7eb;">비고</th>
                  </tr>
                </thead>
                <tbody>
                  ${[
                    { icon: '📄', label: '논문',     count: arti,   note: artiNote,   highlight: arti > 1000 },
                    { icon: '🔬', label: '특허',     count: patent, note: patentNote, highlight: false,      alert: patent < arti * 0.05 },
                    { icon: '🏗️', label: 'NTIS 과제', count: ntis,   note: ntisNote,  highlight: ntis > 50 },
                  ].map(({ icon, label, count, note, highlight, alert }) => `
                    <tr style="border-bottom:1px solid #f3f4f6;${highlight ? 'background:#fafafa;' : ''}">
                      <td style="padding:10px 14px;font-weight:600;color:#374151;">${icon} ${label}</td>
                      <td style="padding:10px 14px;text-align:right;font-weight:800;font-size:14px;color:${alert ? '#dc2626' : highlight ? '#1d4ed8' : '#111'};">${count.toLocaleString()}건</td>
                      <td style="padding:10px 14px;color:${alert ? '#dc2626' : '#6b7280'};font-size:11px;">${note}</td>
                    </tr>`).join('')}
                </tbody>
              </table>
            </div>

            <!-- 핵심 발견 callout (상태색 반영) -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 10px 0;">🔥 핵심 발견: ${escHtml(statusIcon)} ${escHtml(statusText)}</h3>
            <div style="background:${statusBg};border-left:4px solid ${statusText.includes('레드오션') ? '#ef4444' : statusText.includes('IP 우세') ? '#f59e0b' : statusText.includes('균형') ? '#ca8a04' : '#22c55e'};padding:14px 18px;border-radius:6px;margin-bottom:24px;">
              <p style="font-size:13px;font-weight:700;color:#1f2937;margin:0 0 6px 0;">
                논문 ${arti.toLocaleString()}건 vs 특허 ${patent.toLocaleString()}건
              </p>
              <p style="font-size:12px;color:#4b5563;margin:0 0 4px 0;">→ 특허화율(특허÷논문): <strong>${arti > 0 ? Math.round(patentRatio).toLocaleString() + '%' : '-'}</strong> <span style="color:#9ca3af;">(원 건수 비율 · 참고용)</span></p>
              <p style="font-size:12px;color:#4b5563;margin:0;">→ 연구–IP 공백 지수: <strong style="font-size:16px;">${gapPct.toFixed(1)}%</strong> <span style="color:#9ca3af;">(로그 기준 · 높을수록 연구 대비 IP 공백)</span>
                <span style="margin-left:8px;background:rgba(0,0,0,0.06);color:#1f2937;font-size:11px;padding:2px 8px;border-radius:999px;font-weight:700;">${statusIcon} ${statusText}</span>
              </p>
            </div>

            <!-- 공백 지수 게이지 -->
            <div style="margin-bottom:28px;">
              <div style="display:flex;justify-content:space-between;font-size:10px;color:#9ca3af;margin-bottom:4px;">
                <span>특허 우세 (IP 성숙)</span><span>연구 우세 (공백 신호)</span>
              </div>
              <div class="gauge-container">
                <div class="gauge-fill" style="width:${Math.max(0, Math.min(gapPct, 100))}%"></div>
              </div>
            </div>

            <!-- 특허 TOP 결과 분석 -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 10px 0;">🔍 특허 TOP 결과 분석 (IP 보유자)</h3>
            <div style="overflow-x:auto;margin-bottom:16px;">
              <table style="width:100%;border-collapse:collapse;font-size:12px;">
                <thead>
                  <tr style="background:#f9fafb;">
                    <th style="padding:8px;text-align:left;color:#9ca3af;font-weight:600;border-bottom:1px solid #e5e7eb;width:24px;">#</th>
                    <th style="padding:8px;text-align:left;color:#9ca3af;font-weight:600;border-bottom:1px solid #e5e7eb;">제목</th>
                    <th style="padding:8px;text-align:left;color:#9ca3af;font-weight:600;border-bottom:1px solid #e5e7eb;white-space:nowrap;">출원인</th>
                    <th style="padding:8px;text-align:left;color:#9ca3af;font-weight:600;border-bottom:1px solid #e5e7eb;white-space:nowrap;">구분</th>
                  </tr>
                </thead>
                <tbody>${patentRows}</tbody>
              </table>
            </div>
            ${uniqueApplicants.length > 0 ? `
            <div style="background:#fefce8;border-left:4px solid #eab308;padding:10px 14px;border-radius:6px;margin-bottom:28px;font-size:11px;color:#713f12;">
              💡 <strong>상위 표본:</strong> 검색 상위 결과에서 <strong>${uniqueApplicants.slice(0,2).join(', ')} 등</strong>이 확인됩니다.
              ${itDominated ? 'IT 기업이 포함되어 있으나 편중 여부는 전체 출원인·IPC/CPC 분포로 검증해야 합니다.' : '전체 출원인 분포를 의미하지 않으므로 세부 응용별 추가 검색이 필요합니다.'}
            </div>` : `<div style="margin-bottom:28px;"></div>`}

            <!-- 주요 논문 TOP 3 -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 10px 0;">📄 주요 논문 TOP 결과 (연구 트렌드)</h3>
            ${paperList ? `<ol style="padding-left:20px;margin:0 0 28px 0;space-y:4px;">${paperList}</ol>`
              : `<p style="font-size:12px;color:#9ca3af;margin-bottom:28px;">논문 데이터가 없거나 조회되지 않았습니다.</p>`}

            <!-- 후속 검토 시나리오 -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 12px 0;">🧭 후속 검증 경로</h3>
            <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:28px;">
              ${[scenarioA, scenarioB, scenarioC].map((s, i) => `
              <div style="border:1px solid #e5e7eb;border-radius:10px;padding:14px 16px;background:white;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                  <span style="font-size:16px;">${s.icon}</span>
                  <span style="font-size:12px;font-weight:700;color:#111;">Scenario ${String.fromCharCode(65+i)}: ${s.title}</span>
                  <span style="margin-left:auto;font-size:10px;color:#667085;background:#f2f4f7;border-radius:999px;padding:2px 7px;">${s.coverage}</span>
                </div>
                <div style="display:grid;grid-template-columns:70px 1fr;gap:4px 8px;font-size:11px;">
                  <span style="color:#9ca3af;font-weight:600;">근거</span><span style="color:#374151;">${s.basis}</span>
                  <span style="color:#9ca3af;font-weight:600;">타깃</span><span style="color:#374151;">${s.target}</span>
                  <span style="color:#9ca3af;font-weight:600;">핵심 IP</span><span style="color:#374151;">${s.ip}</span>
                </div>
              </div>`).join('')}
            </div>

            <!-- 즉시 실행 액션 플랜 -->
            <h3 style="font-size:13px;font-weight:700;color:#111;margin:0 0 12px 0;">📋 단계별 검증 계획</h3>
            <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:28px;">
              ${actionPlan.map(phase => `
              <div style="border-left:3px solid #e5e7eb;padding-left:14px;">
                <p style="font-size:11px;font-weight:700;color:#6b7280;margin:0 0 4px 0;">${phase.icon} ${phase.period}</p>
                <ul style="margin:0;padding-left:16px;">
                  ${phase.items.map(it => `<li style="font-size:12px;color:#374151;padding:2px 0;">${it}</li>`).join('')}
                </ul>
              </div>`).join('')}
            </div>

            <!-- 최종 소견 callout -->
            <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:14px 18px;border-radius:6px;margin-bottom:16px;">
              <p style="font-size:12px;font-weight:700;color:#14532d;margin:0 0 4px 0;">🫡 최종 소견</p>
              <p style="font-size:12px;color:#166534;line-height:1.7;margin:0;">${finalInsight}</p>
            </div>

            <div style="padding-top:12px;border-top:1px solid #f3f4f6;display:flex;align-items:center;justify-content:space-between;">
              <span style="font-size:10px;color:#d1d5db;">* 데이터 출처: ScienceON API (ARTI/PATENT/REPORT/ATT/RESEARCHER) + NTIS API</span>
              <button onclick="doSearch(1)" style="font-size:11px;color:#3b82f6;background:none;border:none;cursor:pointer;font-weight:600;">논문 검색 결과 보기 →</button>
            </div>
          </div>
        </div>`;
    }

    // ============================================================

    async function refreshAccessToken() {
      try {
        let data;
        if (PROXY_AVAILABLE) {
          const url = `${getProxyBase()}/token/refresh?client_id=${encodeURIComponent(STATE.clientId)}&refresh_token=${encodeURIComponent(STATE.refreshToken)}`;
          const resp = await fetch(url);
          data = await resp.json();
        } else {
          const params = new URLSearchParams({ refresh_token: STATE.refreshToken, client_id: STATE.clientId });
          const resp = await fetch(`${TOKEN_URL_DIRECT}?${params.toString()}`);
          data = await resp.json();
        }

        if (data.access_token) {
          STATE.token       = data.access_token;
          STATE.tokenExpire = data.access_token_expire || '';
          if (data.refresh_token) STATE.refreshToken = data.refresh_token;
          localStorage.setItem('sc_token', STATE.token);
          localStorage.setItem('sc_token_expire', STATE.tokenExpire);
          localStorage.setItem('sc_refresh_token', STATE.refreshToken);
          scheduleTokenRefresh();   // ⏰ 다음 갱신 재예약
          updateTokenExpireDisplay();
          showToast('🔄 Access Token이 자동 갱신되었습니다', 'success');
          return true;
        }
        return false;   // 갱신 응답에 access_token 없음 → 실패로 처리
      } catch (e) {
        showToast('⚠️ 토큰 자동 갱신 실패. API 설정에서 새 토큰을 입력하세요', 'error');
        return false;
      }
    }

    // ============================================================

    // Render Results
    // ============================================================

    function renderResults(xml, query) {
      const grid = document.getElementById('resultsGrid');
      const pagination = document.getElementById('pagination');
      grid.innerHTML = '';
      pagination.innerHTML = '';

      // Total count
      const totalEl = xml.querySelector('TotalCount') || xml.querySelector('totalCount');
      const total = totalEl ? parseInt(totalEl.textContent) || 0 : 0;
      STATE.totalCount = total;

      const targetLabel = getTargetLabel(STATE.currentTarget);

      document.getElementById('resultTotal').textContent =
        `${targetLabel} ${total.toLocaleString()}건 검색됨`;
      document.getElementById('resultQuery').textContent = `"${query}"`;

      if (total === 0) {
        setLoading(false);
        document.getElementById('noResultState').classList.remove('hidden');
        return;
      }

      // Get items based on target
      const items = getItems(xml);

      if (!items || items.length === 0) {
        setLoading(false);
        document.getElementById('noResultState').classList.remove('hidden');
        return;
      }

      // currentItems 수집 (CSV 내보내기 + 네트워크 시각화용)
      STATE.currentItems = items.map(item => ({
        type: getTargetLabel(STATE.currentTarget),
        title: getVal(item,'Title','ScentTitle','AuthorNameKor','OrganKor'),
        authors: getVal(item,'Author'),
        publisher: getVal(item,'Publisher', 'Applicants', 'AuthorInstKor', 'OrganKor'),
        year: (getVal(item,'Pubyear','PublDate','RegisterDate','ApplDate')||'').substring(0,4),
        url: getVal(item,'ContentURL','FulltextURL','MobileURL'),
        keywords: getVal(item,'Keyword'),
        abstract: getVal(item,'Abstract'),
      }));

      // Render items
      grid.insertAdjacentHTML('beforeend', renderScienceONTable(items, query));

      // Pagination
      renderPagination(total);

      setLoading(false);

      // Fade in
      document.querySelectorAll('.result-card, .scienceon-result-row').forEach((card, i) => {
        card.style.animationDelay = `${i * 0.04}s`;
        card.classList.add('fade-up');
      });

      // 인사이트 바 (키워드 클라우드 + 정렬 바)
      renderInsightsBar();
    }

    function renderScienceONTable(items, query) {
      const target = STATE.currentTarget;
      const hasValue = (value) => String(value || '').trim().length > 0;
      const flags = {
        year: items.some(item => hasValue(getVal(item, 'Pubyear', 'PublDate', 'RegisterDate', 'ApplDate'))),
        people: items.some(item => hasValue(getVal(item, 'Author', 'Publisher', 'Applicants', 'AuthorInstKor', 'OrganKor'))),
        source: items.some(item => target === 'PATENT'
          ? hasValue(getVal(item, 'Nation', 'NationCode', 'IPC', 'PatentStatus'))
          : target === 'RESEARCHER'
            ? hasValue(getVal(item, 'ArticleCnt', 'PatentCnt'))
            : hasValue(getVal(item, 'JournalName', 'DBCode', 'Keyword'))),
        identifier: items.some(item => target === 'PATENT'
          ? hasValue(getVal(item, 'ApplNum', 'GrantNum', 'CN'))
          : hasValue(getVal(item, 'DOI', 'CN'))),
      };
      const rows = items.map((item, idx) => renderScienceONRow(item, idx, query, flags)).join('');
      return `
        <div class="ntis-table-wrap scienceon-table-wrap">
          <table class="ntis-result-table scienceon-result-table">
            <thead>
              <tr>
                <th style="width:38%;">자료명</th>
                ${flags.year ? '<th>연도</th>' : ''}
                ${flags.people ? '<th>저자·기관</th>' : ''}
                ${flags.source ? '<th>출처·분류</th>' : ''}
                ${flags.identifier ? '<th>식별자</th>' : ''}
                <th>보기</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="ntis-table-note">출처: ScienceON · 현재 페이지 결과를 표 형태로 표시합니다.</div>
        </div>`;
    }

    function renderScienceONRow(item, idx, query, flags = { year: true, people: true, source: true, identifier: true }) {
      const target = STATE.currentTarget;
      const cn = getVal(item, 'CN');
      const title = getVal(item, 'Title', 'ScentTitle', 'AuthorNameKor', 'OrganKor') || '제목 없음';
      const url = getVal(item, 'ContentURL', 'FulltextURL', 'MobileURL');
      const yearRaw = getVal(item, 'Pubyear', 'PublDate', 'RegisterDate', 'ApplDate');
      const yearDisplay = yearRaw ? yearRaw.substring(0, 4) : '-';
      const authors = getVal(item, 'Author');
      const journal = getVal(item, 'JournalName');
      const publisher = getVal(item, 'Publisher', 'Applicants', 'AuthorInstKor', 'OrganKor');
      const keyword = getVal(item, 'Keyword');
      const doi = getVal(item, 'DOI');
      const dbcode = getVal(item, 'DBCode');
      const fulltextFlag = getVal(item, 'FulltextFlag');
      const nation = getVal(item, 'Nation', 'NationCode');
      const ipc = getVal(item, 'IPC');
      const patentStatus = getVal(item, 'PatentStatus');
      const applNum = getVal(item, 'ApplNum');
      const grantNum = getVal(item, 'GrantNum');
      const articleCnt = getVal(item, 'ArticleCnt');
      const patentCnt = getVal(item, 'PatentCnt');

      const hl = (text) => {
        if (!text || !query) return escHtml(text);
        const regex = new RegExp(`(${escRegex(query)})`, 'gi');
        return escHtml(text).replace(regex, '<mark>$1</mark>');
      };
      const compactPeople = (value) => {
        if (!value) return '';
        const list = value.split(/[;,|]/).map(v => v.trim()).filter(Boolean);
        return list.slice(0, 3).join(', ') + (list.length > 3 ? ` 외 ${list.length - 3}명` : '');
      };
      const compactKeywords = (value) => {
        if (!value) return '';
        return value.split(/[;,|]/).map(v => v.trim()).filter(Boolean).slice(0, 3).join(' · ');
      };

      const primaryMeta = target === 'PATENT'
        ? (publisher || '-')
        : target === 'RESEARCHER'
          ? (publisher || getVal(item, 'AuthorInstEng') || '-')
          : (compactPeople(authors) || publisher || '-');
      const sourceParts = target === 'PATENT'
        ? [nation, ipc ? `IPC ${ipc.substring(0, 18)}` : '', patentStatus].filter(Boolean)
        : target === 'RESEARCHER'
          ? [articleCnt ? `논문 ${articleCnt}편` : '', patentCnt ? `특허 ${patentCnt}건` : ''].filter(Boolean)
          : [journal, dbcode, compactKeywords(keyword)].filter(Boolean);
      const sourceText = sourceParts.join(' · ') || '-';
      const identifierParts = target === 'PATENT'
        ? [applNum ? `출원 ${applNum}` : '', grantNum ? `등록 ${grantNum}` : '', cn].filter(Boolean)
        : [doi ? `DOI ${doi}` : '', cn].filter(Boolean);
      const identifierText = identifierParts.join(' · ') || '-';
      const favId = cn || title;
      const favPayload = escAttr(JSON.stringify({
        id: favId,
        title,
        url,
        year: yearDisplay === '-' ? '' : yearDisplay,
        type: getTargetLabel(target),
        authors: primaryMeta
      }));
      const openAction = url
        ? `href="${escAttr(url)}" target="_blank" rel="noopener"`
        : `href="javascript:void(0)" aria-disabled="true"`;
      const titleClass = url ? 'ntis-result-title' : 'ntis-result-title no-link';

      return `
        <tr class="scienceon-result-row" data-year="${escAttr(yearDisplay)}" data-title="${escAttr(title)}">
          <td>
            <a class="${titleClass}" ${openAction} onclick="event.stopPropagation()">
              ${idx === 0 ? '<span class="text-xs text-black font-bold mr-1">TOP</span>' : ''}${hl(title)}
              ${url ? '<iconify-icon icon="solar:arrow-right-up-linear" width="11" style="color:#9ca3af; vertical-align:middle; margin-left:2px;"></iconify-icon>' : ''}
            </a>
            <div class="ntis-result-meta">${escHtml(getTargetLabel(target))}${fulltextFlag === 'Y' ? ' · 원문' : ''}</div>
          </td>
          ${flags.year ? `<td><span class="ntis-muted">${escHtml(yearDisplay)}</span></td>` : ''}
          ${flags.people ? `<td><div class="ntis-cell-ellipsis" title="${escAttr(primaryMeta)}">${escHtml(primaryMeta)}</div></td>` : ''}
          ${flags.source ? `<td><div class="ntis-cell-ellipsis" title="${escAttr(sourceText)}">${escHtml(sourceText)}</div></td>` : ''}
          ${flags.identifier ? `<td>
            <button type="button" class="identifier-copy ntis-cell-ellipsis" title="클릭하여 식별자 전체 복사"
              aria-label="식별자 복사" data-identifier="${escAttr(identifierText)}"
              onclick="event.stopPropagation();copyIdentifierValue(this.dataset.identifier,this)">${escHtml(identifierText)}</button>
          </td>` : ''}
          <td>
            <div class="ntis-row-actions">
              ${target === 'RESEARCHER' ? `<button type="button" class="ntis-row-btn"
                data-name="${escAttr(title)}"
                data-subtitle="${escAttr(publisher)}"
                onclick="event.stopPropagation();showDeepProfile(this.dataset.name,this.dataset.subtitle)">
                <iconify-icon icon="solar:user-circle-bold-duotone" width="13"></iconify-icon>프로필
              </button>` : ''}
              ${url ? `<a class="ntis-row-btn" href="${escAttr(url)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                <iconify-icon icon="solar:arrow-right-up-bold-duotone" width="13"></iconify-icon>본문
              </a>` : ''}
              <button type="button" class="fav-btn ${isFav(favId) ? 'active' : ''}" title="즐겨찾기"
                data-fav="${favPayload}"
                onclick="event.stopPropagation();toggleFav(JSON.parse(this.dataset.fav),this)">
                <iconify-icon icon="solar:bookmark-bold${isFav(favId) ? '' : '-duotone'}" width="15"></iconify-icon>
              </button>
            </div>
          </td>
        </tr>`;
    }

    function renderNTISResults(xml, query, collection) {
      const grid = document.getElementById('resultsGrid');
      const pagination = document.getElementById('pagination');
      grid.innerHTML = '';
      pagination.innerHTML = '';

      // XML 파싱 오류 체크 (DOMParser 실패 시 <parsererror> 반환)
      if (xml.getElementsByTagName('parsererror').length > 0) {
        console.error('[NTIS] XML 파싱 오류:', xml.getElementsByTagName('parsererror')[0]?.textContent);
        showToast('NTIS 응답 XML 파싱 오류 — 브라우저 콘솔 확인', 'error');
        setLoading(false);
        return;
      }

      // getElementsByTagName 사용: querySelector는 XML 대문자 태그에 브라우저별 불안정
      const getXmlTag = (tagName) => xml.getElementsByTagName(tagName)[0] || null;

      // NTIS 오류 응답 처리: <RESULT><ERROR><CODE>/<MESSAGE> 또는 <returnCode>/<returnMsg>
      const errCode = getXmlTag('CODE')?.textContent?.trim() || getXmlTag('returnCode')?.textContent?.trim() || '';
      const errMsg  = getXmlTag('MESSAGE')?.textContent?.trim() || getXmlTag('returnMsg')?.textContent?.trim() || '';
      console.log(`[NTIS] errCode=${errCode} | errMsg=${errMsg}`);
      if (errCode && errCode !== '0') {
        showToast(`NTIS API 오류: [${errCode}] ${errMsg}`, 'error');
        console.error('[NTIS] API 오류 응답:', errCode, errMsg, new XMLSerializer().serializeToString(xml));
        setLoading(false);
        return;
      }

      // NTIS 기관용 API는 <TOTALHITS> 사용 (다양한 태그명 폴백)
      const totalEl = getXmlTag('TOTALHITS') || getXmlTag('TOTAL_HITS')
                   || getXmlTag('totalCount') || getXmlTag('TOTAL_COUNT')
                   || getXmlTag('total_count') || getXmlTag('TotalCount')
                   || getXmlTag('resultCount') || getXmlTag('RESULT_COUNT');
      const total = totalEl ? parseInt(totalEl.textContent) || 0 : 0;
      STATE.totalCount = total;

      console.log(`[NTIS] total=${total}, query="${query}", collection=${collection}`);

      const targetLabel = getTargetLabel(STATE.currentTarget);
      document.getElementById('resultTotal').textContent = `${targetLabel} ${total.toLocaleString()}건 검색됨`;
      document.getElementById('resultQuery').innerHTML = `"${escHtml(query)}" <span class="badge badge-ntis-prjt ml-2" style="vertical-align: middle;">NTIS API</span>`;

      if (total === 0) {
        setLoading(false);
        document.getElementById('noResultState').classList.remove('hidden');
        // 디버그 패널: 원시 응답 표시
        if (window._ntisDebug) {
          const panel = document.getElementById('ntisDebugPanel');
          const urlEl  = document.getElementById('ntisDebugUrl');
          const rawEl  = document.getElementById('ntisDebugRaw');
          if (panel && urlEl && rawEl) {
            urlEl.textContent = window._ntisDebug.url;
            rawEl.textContent = window._ntisDebug.raw.substring(0, 3000);
            panel.classList.remove('hidden');
          }
        }
        return;
      }

      // getElementsByTagName으로 HIT 요소 추출 (querySelector 대체)
      let items = Array.from(xml.getElementsByTagName('HIT'));
      if (items.length === 0) items = Array.from(xml.getElementsByTagName('item'));
      if (items.length === 0) items = Array.from(xml.getElementsByTagName('row'));
      if (items.length === 0) items = Array.from(xml.getElementsByTagName('record'));
      console.log(`[NTIS] items found: ${items.length}`);

      if (items.length === 0) {
        setLoading(false);
        document.getElementById('noResultState').classList.remove('hidden');
        return;
      }

      if (collection === 'project' || collection === 'prjt') {
        grid.insertAdjacentHTML('beforeend', renderNTISProjectTable(items, query));
      } else {
        items.forEach((item, idx) => {
          const card = renderNTISCard(item, idx, query, collection);
          grid.insertAdjacentHTML('beforeend', card);
        });
      }

      renderPagination(total);
      setLoading(false);

      document.querySelectorAll('.result-card, .ntis-result-row').forEach((card, i) => {
        card.style.animationDelay = `${i * 0.04}s`;
        card.classList.add('fade-up');
      });
    }

    function renderNTISProjectTable(items, query) {
      const rows = items.map((item, idx) => renderNTISProjectRow(item, idx, query)).join('');
      return `
        <div class="ntis-table-wrap">
          <table class="ntis-result-table">
            <thead>
              <tr>
                <th style="width:38%;">과제명</th>
                <th>연간 연구비</th>
                <th>수행기간</th>
                <th>수행기관</th>
                <th>부처·사업</th>
                <th>보기</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <div class="ntis-table-note">출처: 국가과학기술지식정보서비스(NTIS) · 현재 페이지 결과를 표 형태로 표시합니다.</div>
        </div>`;
    }

    function renderNTISProjectRow(item, idx, query) {
      const stripHL = (text) => (text || '').replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '').trim();
      const gv = (tagName) => {
        const el = item.getElementsByTagName(tagName)[0];
        return el ? stripHL(decodeEntities(el.textContent.trim())) : '';
      };
      const gnv = (parentTag, childTag) => {
        const parent = item.getElementsByTagName(parentTag)[0];
        if (!parent) return '';
        if (!childTag) return stripHL(decodeEntities(parent.textContent.trim()));
        const child = parent.getElementsByTagName(childTag)[0];
        return stripHL(child ? decodeEntities(child.textContent.trim()) : '');
      };
      const hl = (text) => {
        if (!text || !query) return escHtml(text);
        const regex = new RegExp(`(${escRegex(query)})`, 'gi');
        return escHtml(text).replace(regex, '<mark>$1</mark>');
      };
      const formatYm = (value) => {
        const s = String(value || '').replace(/\D/g, '');
        return s.length >= 6 ? `${s.slice(0, 4)}-${s.slice(4, 6)}` : '';
      };
      const durationYears = (start, end) => {
        const s = String(start || '').replace(/\D/g, '');
        const e = String(end || '').replace(/\D/g, '');
        if (s.length < 6 || e.length < 6) return 1;
        const sy = Number(s.slice(0, 4)), sm = Number(s.slice(4, 6));
        const ey = Number(e.slice(0, 4)), em = Number(e.slice(4, 6));
        const months = Math.max(1, (ey - sy) * 12 + (em - sm) + 1);
        return months / 12;
      };
      const fmtYears = (years) => {
        if (!Number.isFinite(years) || years <= 0) return '';
        return Number.isInteger(years) ? `${years}년` : `${Number(years.toFixed(2))}년`;
      };
      const formatAnnualBudget = (raw, years) => {
        const won = Number(String(raw || '').replace(/[^\d.-]/g, ''));
        if (!Number.isFinite(won) || won <= 0) return '금액 미상';
        const annual = won / Math.max(years || 1, 0.01);
        if (annual >= 100000000) {
          const eok = annual / 100000000;
          return `${(eok >= 10 ? eok.toFixed(0) : eok.toFixed(1)).replace(/\.0$/, '')}억 원`;
        }
        return `${Math.round(annual / 10000).toLocaleString()}만 원`;
      };

      const pjtNo = gv('ProjectNumber');
      const title = gnv('ProjectTitle', 'Korean') || gnv('ProjectTitle', null) || '제목 없음';
      const manager = gnv('Manager', 'Name');
      const manageAgency = gnv('ManageAgency', 'Name') || gv('LeadAgency');
      const researchAgency = gnv('ResearchAgency', 'Name') || manageAgency || '기관 미상';
      const ministry = gnv('Ministry', 'Name');
      const business = stripHL(gv('BusinessName'));
      const start = gnv('ProjectPeriod', 'Start');
      const end = gnv('ProjectPeriod', 'End');
      const years = durationYears(start, end);
      const period = formatYm(start) && formatYm(end)
        ? `${formatYm(start)}~${formatYm(end)} (${fmtYears(years)})`
        : '-';
      const fundsRaw = gv('TotalFunds') || gv('GovernmentFunds');
      const annualBudget = formatAnnualBudget(fundsRaw, years);
      const ntisUrl = pjtNo
        ? `https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${encodeURIComponent(pjtNo)}&pageCode=TH_PJT_PJT_DTL`
        : 'https://www.ntis.go.kr';
      const sourceMeta = [manager, pjtNo].filter(Boolean).join(' · ');
      const ministryBiz = [ministry, business].filter(Boolean).join(' · ') || '-';
      const favId = pjtNo || title;
      const favPayload = escAttr(JSON.stringify({ id: favId, title, type: 'R&D과제', url: ntisUrl }));

      return `
        <tr class="ntis-result-row">
          <td>
            <a class="ntis-result-title" href="${ntisUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
              ${idx === 0 ? '<span class="text-xs text-black font-bold mr-1">TOP</span>' : ''}${hl(title)}
              <iconify-icon icon="solar:arrow-right-up-linear" width="11" style="color:#9ca3af; vertical-align:middle; margin-left:2px;"></iconify-icon>
            </a>
            ${sourceMeta ? `<div class="ntis-result-meta">${escHtml(sourceMeta)}</div>` : ''}
            ${pjtNo ? `<button type="button" class="identifier-copy ntis-result-meta ntis-project-id" title="클릭하여 과제번호 전체 복사"
              data-identifier="${escAttr(pjtNo)}" onclick="event.stopPropagation();copyIdentifierValue(this.dataset.identifier,this)">과제번호 ${escHtml(pjtNo)}</button>` : ''}
          </td>
          <td><span class="ntis-money">${escHtml(annualBudget)}</span></td>
          <td><span class="ntis-muted">${escHtml(period)}</span></td>
          <td><div class="ntis-cell-ellipsis" title="${escAttr(researchAgency)}">${escHtml(researchAgency)}</div></td>
          <td><div class="ntis-cell-ellipsis" title="${escAttr(ministryBiz)}">${escHtml(ministryBiz)}</div></td>
          <td>
            <div class="ntis-row-actions">
              ${pjtNo ? `<button type="button" class="ntis-row-btn"
                data-pjt-id="${escAttr(pjtNo)}"
                data-pjt-title="${escAttr(title)}"
                onclick="event.stopPropagation(); showRelated(this.dataset.pjtId, this.dataset.pjtTitle)">
                <iconify-icon icon="solar:link-bold-duotone" width="13"></iconify-icon>연관
              </button>` : ''}
              <a class="ntis-row-btn" href="${ntisUrl}" target="_blank" rel="noopener" onclick="event.stopPropagation()">
                <iconify-icon icon="solar:arrow-right-up-bold-duotone" width="13"></iconify-icon>상세
              </a>
              <button type="button" class="fav-btn ${isFav(favId) ? 'active' : ''}" title="즐겨찾기"
                onclick="event.stopPropagation();toggleFav(${favPayload},this)">
                <iconify-icon icon="solar:bookmark-bold${isFav(favId) ? '' : '-duotone'}" width="15"></iconify-icon>
              </button>
            </div>
          </td>
        </tr>`;
    }

    function renderNTISCard(item, idx, query, collection) {
      const target = STATE.currentTarget;

      const escHtml = (text) => text ? text.toString().replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])) : '';
      const escRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const hl = (text) => {
        if (!text || !query) return escHtml(text);
        const regex = new RegExp(`(${escRegex(query)})`, 'gi');
        return escHtml(text).replace(regex, '<mark>$1</mark>');
      };

      // NTIS 기관용 API 응답 XML에서 하이라이트 span 제거 (먼저 정의)
      const stripHL = (text) => (text || '').replace(/<span[^>]*>/gi, '').replace(/<\/span>/gi, '').trim();

      // getElementsByTagName 기반 헬퍼 (XML 대문자 태그 안전 처리, querySelector 대체)
      const gv = (tagName) => {
        const el = item.getElementsByTagName(tagName)[0];
        return el ? decodeEntities(el.textContent.trim()) : '';
      };
      // 중첩 구조: <Parent><Child>값</Child></Parent>
      const gnv = (parentTag, childTag) => {
        const parent = item.getElementsByTagName(parentTag)[0];
        if (!parent) return '';
        if (!childTag) return stripHL(decodeEntities(parent.textContent.trim()));
        const child = parent.getElementsByTagName(childTag)[0];
        return stripHL(child ? decodeEntities(child.textContent.trim()) : '');
      };

      let title = '', subtitle = '', tags = [], extra = '';
      let badgeCls = 'badge-ntis-prjt', icon = 'solar:case-bold-duotone';

      // PDF 24 기관용 통합검색 HIT 응답 구조 파싱
      if (collection === 'project' || collection === 'prjt') {
        const pjtNo = gv('ProjectNumber');

        // 제목: <ProjectTitle><Korean>값</Korean></ProjectTitle>
        title = gnv('ProjectTitle', 'Korean') || gnv('ProjectTitle', null);

        // 주관기관: <ManageAgency><Name>값</Name></ManageAgency>
        // LeadAgency는 텍스트 직접 포함 구조: <LeadAgency>기관명</LeadAgency>
        const mngInst  = gnv('ManageAgency', 'Name') || gv('LeadAgency');
        // 사업명: <BusinessName>
        const bizNm    = stripHL(gv('BusinessName'));
        // 부처: <Ministry><Name>
        const ministry = gnv('Ministry', 'Name');
        // 수행기관: <ResearchAgency><Name>
        const researchAgency = gnv('ResearchAgency', 'Name');
        // 연구비: <TotalFunds> (원 단위)
        const fundsRaw = gv('TotalFunds') || gv('GovernmentFunds');
        const fundsAmt = fundsRaw && !isNaN(fundsRaw)
          ? (Number(fundsRaw) / 1000).toLocaleString() + '천원'
          : fundsRaw || '금액 미상';
        // 연구기간: <ProjectPeriod><Start>/<End>
        const periodStart = gnv('ProjectPeriod', 'Start').substring(0, 6);
        const periodEnd   = gnv('ProjectPeriod', 'End').substring(0, 6);
        const periodStr   = periodStart ? `${periodStart}~${periodEnd}` : '';
        // 키워드: <Keyword><Korean>
        const keywords = gnv('Keyword', 'Korean');
        // 연구자: <Manager><Name>
        subtitle = gnv('Manager', 'Name');

        extra = `
          <div class="ntis-info-row mt-2">
            <div class="ntis-info-item" title="주관기관"><iconify-icon icon="solar:folder-with-files-bold-duotone" width="14"></iconify-icon>${escHtml(mngInst || researchAgency || '기관 미상')}</div>
            ${bizNm ? `<div class="ntis-info-item" title="사업명"><iconify-icon icon="solar:branching-paths-bold-duotone" width="14"></iconify-icon>${escHtml(bizNm)}</div>` : ''}
            ${ministry ? `<div class="ntis-info-item" title="부처"><iconify-icon icon="solar:wallet-money-bold-duotone" width="14"></iconify-icon>${escHtml(ministry)}</div>` : ''}
            <div class="ntis-info-item ntis-funds" title="연구비"><iconify-icon icon="solar:wad-of-money-bold-duotone" width="14"></iconify-icon>${escHtml(fundsAmt)}</div>
          </div>
          ${keywords ? `<div class="mt-1.5 flex flex-wrap gap-1">${keywords.split(/[,;|]/).slice(0,5).map(k => `<span class="tag">${escHtml(k.trim())}</span>`).join('')}</div>` : ''}
          ${pjtNo ? `<div class="mt-2 flex gap-2">
            <button type="button" class="btn-secondary"
              data-pjt-id="${escHtml(pjtNo)}"
              data-pjt-title="${escHtml(title || '')}"
              onclick="event.stopPropagation(); showRelated(this.dataset.pjtId, this.dataset.pjtTitle)">
              <iconify-icon icon="solar:link-bold-duotone" width="14"></iconify-icon>연관컨텐츠
            </button>
            <a href="https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${encodeURIComponent(pjtNo)}&pageCode=TH_PJT_PJT_DTL"
              target="_blank" rel="noopener"
              style="display:inline-flex; align-items:center; gap:0.375rem;"
              class="btn-secondary"
              onclick="event.stopPropagation()">
              <iconify-icon icon="solar:arrow-right-up-bold-duotone" width="14"></iconify-icon>NTIS 상세
            </a>
          </div>` : ''}
        `;
        if (periodStr) tags.push(`${periodStr}`);
        badgeCls = 'badge-ntis-prjt';
        icon = 'solar:case-bold-duotone';
      } else {
        title = gv('koTitle') || gv('equipNm');
        subtitle = gv('instNm') || gv('korNm');
        badgeCls = 'badge-ntis-requip';
        icon = 'solar:microscope-bold-duotone';
      }

      return `
  <div class="result-card">
    <div class="flex items-start gap-4">
      <div class="type-icon hidden sm:flex" style="background: #f5f5f5; color: #111;">
        <iconify-icon icon="${icon}" width="20"></iconify-icon>
      </div>
      <div class="flex-1 min-w-0">
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="badge ${badgeCls}">${getTargetLabel(target)}</span>
          ${idx === 0 ? '<span class="text-xs text-black font-bold flex items-center gap-1"><iconify-icon icon="solar:star-bold" width="12"></iconify-icon>TOP</span>' : ''}
          ${tags.map(t => `<span class="tag">${escHtml(t)}</span>`).join(' ')}
        </div>
        <h3 class="text-black font-bold text-lg leading-snug mb-2">${hl(title) || '<span class="text-tertiary">제목 없음</span>'}</h3>
        ${subtitle ? `<p class="text-sm text-secondary mb-2 truncate">${hl(subtitle)}</p>` : ''}
        ${extra}
        <div class="flex items-center justify-between mt-4 pt-3 border-t border-border">
          <span class="text-xs text-tertiary">출처: 국가과학기술지식정보서비스(NTIS)</span>
          <button type="button" class="fav-btn ${isFav(gv('ProjectNumber')||title)?'active':''}" title="즐겨찾기"
            onclick="event.stopPropagation();toggleFav(${JSON.stringify({id:gv('ProjectNumber')||title,title,type:'R&D과제',url:'https://www.ntis.go.kr'})},this)">
            <iconify-icon icon="solar:bookmark-bold${isFav(gv('ProjectNumber')||title)?'':'-duotone'}" width="16"></iconify-icon>
          </button>
        </div>
      </div>
    </div>
  </div>`;
    }

    function getItems(xml) {
      // 실제 API 응답 구조: <recordList><record rownum="N">...</record></recordList>
      const records = Array.from(xml.querySelectorAll('recordList record, record'));
      if (records.length > 0) return records;

      // fallback: 이전 방식 (태그명 기반)
      const target = STATE.currentTarget;
      const selectors = {
        ARTI: 'ARTI, Article', PATENT: 'PATENT, Patent',
        REPORT: 'REPORT, Report', ATT: 'ATT',
        SCENT: 'SCENT', RESEARCHER: 'RESEARCHER',
        ORGAN: 'ORGAN', TREND: 'TREND', SNEWS: 'SNEWS',
      };
      return Array.from(xml.querySelectorAll(selectors[target] || target));
    }

    function getVal(item, ...fields) {
      for (const f of fields) {
        // 실제 구조: <item metaCode="Title" metaName="...">값</item>
        const byMeta = item.querySelector(`item[metaCode="${f}"]`);
        if (byMeta && byMeta.textContent.trim()) return decodeEntities(byMeta.textContent.trim());

        // fallback: 태그명으로 직접 조회
        const byTag = item.querySelector(f);
        if (byTag && byTag.textContent.trim()) return decodeEntities(byTag.textContent.trim());
      }
      return '';
    }

    function renderCard(item, idx, query) {
      const target = STATE.currentTarget;
      const cn = getVal(item, 'CN');
      const title = getVal(item, 'Title', 'ScentTitle', 'AuthorNameKor', 'OrganKor');
      const url = getVal(item, 'ContentURL', 'FulltextURL', 'MobileURL');
      const year = getVal(item, 'Pubyear', 'PublDate', 'RegisterDate', 'ApplDate');
      const abstract = getVal(item, 'Abstract');
      const authors = getVal(item, 'Author');
      const keyword = getVal(item, 'Keyword');
      const journal = getVal(item, 'JournalName');
      const publisher = getVal(item, 'Publisher', 'Applicants', 'AuthorInstKor', 'OrganKor');
      const doi = getVal(item, 'DOI');
      const dbcode = getVal(item, 'DBCode');
      const fulltextFlag = getVal(item, 'FulltextFlag');

      // Highlight function
      const hl = (text) => {
        if (!text || !query) return escHtml(text);
        const regex = new RegExp(`(${escRegex(query)})`, 'gi');
        return escHtml(text).replace(regex, '<mark>$1</mark>');
      };

      const badge = getBadge(target);
      const typeIcon = getTypeIcon(target);

      // Year display
      const yearDisplay = year ? year.substring(0, 4) : '';

      // Authors - limit to 3
      let authorDisplay = '';
      if (authors) {
        const auList = authors.split(/[;,|]/).map(a => a.trim()).filter(Boolean);
        authorDisplay = auList.slice(0, 3).join(', ') + (auList.length > 3 ? ` 외 ${auList.length - 3}명` : '');
      }

      // Keywords - limit to 5
      let kwDisplay = '';
      if (keyword) {
        const kwList = keyword.split(/[;,|]/).map(k => k.trim()).filter(Boolean);
        kwDisplay = kwList.slice(0, 5).map(k => `<span class="tag">${escHtml(k)}</span>`).join('');
      }

      // Patent specific
      let patentInfo = '';
      if (target === 'PATENT') {
        const nation = getVal(item, 'Nation', 'NationCode');
        const applNum = getVal(item, 'ApplNum');
        const grantNum = getVal(item, 'GrantNum');
        const ipc = getVal(item, 'IPC');
        const status = getVal(item, 'PatentStatus');

        if (nation) patentInfo += `<span class="tag">${escHtml(nation)}</span> `;
        if (ipc) patentInfo += `<span class="tag">IPC: ${escHtml(ipc.substring(0, 20))}</span> `;
        if (status) patentInfo += `<span class="tag">${escHtml(status)}</span> `;
      }

      // Researcher specific
      let researcherInfo = '';
      if (target === 'RESEARCHER') {
        const engName = getVal(item, 'AuthorNameEng');
        const inst = getVal(item, 'AuthorInstKor', 'AuthorInstEng');
        const artCnt = getVal(item, 'ArticleCnt');
        const patCnt = getVal(item, 'PatentCnt');
        if (engName) researcherInfo += `<span class="text-gray-500 text-sm">${escHtml(engName)}</span>`;
        if (inst) researcherInfo += ` · <span class="text-gray-500 text-sm">${escHtml(inst)}</span>`;
        if (artCnt) researcherInfo += ` <span class="tag">논문 ${escHtml(artCnt)}편</span>`;
        if (patCnt) researcherInfo += ` <span class="tag">특허 ${escHtml(patCnt)}건</span>`;
      }

      const clickAction = url ? `onclick="window.open('${escAttr(url)}', '_blank')"` : '';
      const cursorClass = url ? 'cursor-pointer' : '';

      return `
  <div class="result-card ${cursorClass}" ${clickAction} data-year="${yearDisplay}" data-title="${escAttr(title)}">
    <div class="flex items-start gap-4">
      <!-- Icon -->
      <div class="type-icon hidden sm:flex" style="background: #f5f5f5; color: #111;">
        <iconify-icon icon="${typeIcon}" width="18"></iconify-icon>
      </div>

      <!-- Content -->
      <div class="flex-1 min-w-0">
        <!-- Header -->
        <div class="flex flex-wrap items-center gap-2 mb-3">
          <span class="badge ${badge}">${getTargetLabel(target)}</span>
          ${dbcode ? `<span class="text-xs text-secondary">${escHtml(dbcode)}</span>` : ''}
          ${yearDisplay ? `<span class="text-xs text-secondary flex items-center gap-1"><iconify-icon icon="solar:calendar-bold-duotone" width="12"></iconify-icon>${yearDisplay}</span>` : ''}
          ${fulltextFlag === 'Y' ? '<span class="text-xs text-black font-bold flex items-center gap-1"><iconify-icon icon="solar:link-circle-bold-duotone" width="12"></iconify-icon>원문</span>' : ''}
          ${idx === 0 ? '<span class="text-xs text-black font-bold flex items-center gap-1"><iconify-icon icon="solar:star-bold" width="12"></iconify-icon>TOP</span>' : ''}
        </div>

        <!-- Title -->
        <h3 class="text-black font-bold text-lg leading-snug mb-2" style="word-break: keep-all; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">
          ${hl(title) || '<span class="text-tertiary">제목 없음</span>'}
        </h3>

        <!-- Authors / Publisher -->
        ${authorDisplay ? `<p class="text-sm text-secondary mb-2 truncate">${renderAuthorLinks(authors, query)}${journal ? ` · <span class="italic text-tertiary">${escHtml(journal)}</span>` : ''}</p>` : ''}
        ${!authorDisplay && publisher ? `<p class="text-sm text-secondary mb-2 truncate">${hl(publisher)}</p>` : ''}
        ${researcherInfo ? `<p class="text-sm mb-2">${researcherInfo}</p>` : ''}

        <!-- Abstract -->
        ${abstract ? `<p class="abstract-text mt-3 mb-3">${hl(abstract)}</p>` : ''}

        <!-- Patent info -->
        ${patentInfo ? `<div class="flex flex-wrap gap-1 mt-2">${patentInfo}</div>` : ''}

        <!-- Keywords -->
        ${kwDisplay ? `<div class="tags-scroll mt-3">${kwDisplay}</div>` : ''}

        <!-- Footer -->
        <div class="flex items-center justify-between mt-5 pt-3 border-t border-border">
          <div class="flex items-center gap-3">
            ${doi ? `<button type="button" class="identifier-copy card-identifier-copy" title="클릭하여 DOI 전체 복사"
              data-identifier="${escAttr(`DOI ${doi}`)}" onclick="event.stopPropagation();copyIdentifierValue(this.dataset.identifier,this)">DOI: ${escHtml(doi)}</button>` : ''}
            ${cn ? `<button type="button" class="identifier-copy card-identifier-copy font-mono" title="클릭하여 식별자 전체 복사"
              data-identifier="${escAttr(cn)}" onclick="event.stopPropagation();copyIdentifierValue(this.dataset.identifier,this)">${escHtml(cn)}</button>` : ''}
            ${target === 'RESEARCHER' ? `<button type="button" class="btn-secondary text-xs" onclick="event.stopPropagation();showDeepProfile('${escAttr(title)}','${escAttr(publisher)}')" data-name="${escAttr(title)}" data-subtitle="${escAttr(publisher)}"><iconify-icon icon="solar:user-circle-bold-duotone" width="13"></iconify-icon>심층 프로필</button>` : ''}
          </div>
          <div class="flex items-center gap-2">
            <button type="button" class="fav-btn ${typeof hasMemo !== 'undefined' && hasMemo(cn||title) ? 'memo-active' : ''}" title="메모"
              data-memo-id="${escAttr(cn||title)}"
              onclick="event.stopPropagation();openMemoPanel('${escAttr(cn||title)}','${escAttr(title)}')">
              <iconify-icon icon="solar:notes-bold${typeof hasMemo !== 'undefined' && hasMemo(cn||title) ? '' : '-duotone'}" width="16"></iconify-icon>
            </button>
            <button type="button" class="fav-btn ${isFav(cn||title)?'active':''}" title="즐겨찾기"
              onclick="event.stopPropagation();toggleFav(${JSON.stringify({id:cn||title,title,url,year:yearDisplay,type:getTargetLabel(target),authors:authorDisplay})},this)">
              <iconify-icon icon="solar:bookmark-bold${isFav(cn||title)?'':'-duotone'}" width="16"></iconify-icon>
            </button>
            ${url ? `
            <div class="flex items-center gap-1 text-xs text-black font-bold shrink-0">
              <span>본문 보기</span>
              <iconify-icon icon="solar:arrow-right-up-bold" width="14"></iconify-icon>
            </div>` : ''}
          </div>
        </div>
      </div>
    </div>
  </div>`;
    }

    // ============================================================

    // Pagination
    // ============================================================

    function renderPagination(total) {
      const container = document.getElementById('pagination');
      const totalPages = Math.min(Math.ceil(total / STATE.rowCount), Math.floor(10000 / STATE.rowCount));
      if (totalPages <= 1) return;

      container.classList.remove('hidden');
      const cur = STATE.currentPage;

      // ── [FIX #3] NTIS / ScienceON 페이지 함수 분기 ──
      const isNTIS = STATE.currentTarget.startsWith('NTIS_');
      const gotoFn = isNTIS ? 'doNTISSearch' : 'doSearch';

      let btns = '';

      // Prev
      btns += `<button class="page-btn" onclick="${gotoFn}(${cur - 1})" ${cur <= 1 ? 'disabled' : ''}>
    <iconify-icon icon="solar:alt-arrow-left-bold" width="14"></iconify-icon>
  </button>`;

      // Page numbers
      const start = Math.max(1, cur - 4);
      const end = Math.min(totalPages, start + 8);

      if (start > 1) btns += `<button class="page-btn" onclick="${gotoFn}(1)">1</button>`;
      if (start > 2) btns += `<span class="text-gray-600 px-1">…</span>`;

      for (let i = start; i <= end; i++) {
        btns += `<button class="page-btn ${i === cur ? 'active' : ''}" onclick="${gotoFn}(${i})">${i}</button>`;
      }

      if (end < totalPages - 1) btns += `<span class="text-gray-600 px-1">…</span>`;
      if (end < totalPages) btns += `<button class="page-btn" onclick="${gotoFn}(${totalPages})">${totalPages}</button>`;

      // Next
      btns += `<button class="page-btn" onclick="${gotoFn}(${cur + 1})" ${cur >= totalPages ? 'disabled' : ''}>
    <iconify-icon icon="solar:alt-arrow-right-bold" width="14"></iconify-icon>
  </button>`;

      container.innerHTML = btns;

      // Scroll to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // ============================================================

    // CORS Guide
    // ============================================================

    function showCORSGuide(url) {
      const grid = document.getElementById('resultsGrid');
      grid.innerHTML = `
  <div class="p-6 rounded-2xl" style="background: var(--surface); border: 1px solid rgba(239,68,68,0.2);">
    <div class="flex items-start gap-3 mb-4">
      <iconify-icon icon="solar:shield-warning-bold-duotone" style="color: #f87171; flex-shrink:0;" width="24"></iconify-icon>
      <div>
        <h3 class="text-white font-semibold mb-1">CORS 오류 — 브라우저 직접 요청 차단됨</h3>
        <p class="text-gray-400 text-sm" style="word-break:keep-all;">
          ScienceON API는 브라우저에서 직접 호출 시 CORS 정책으로 인해 차단될 수 있습니다.
          아래 방법 중 하나를 사용하세요.
        </p>
      </div>
    </div>

    <div class="space-y-3 mt-4">
      <div class="p-3 rounded-xl" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">
        <p class="text-xs font-semibold text-gray-300 mb-2">방법 1: 브라우저 CORS 확장 프로그램 사용</p>
        <p class="text-xs text-gray-500">Chrome 확장: "CORS Unblock" 또는 "Allow CORS: Access-Control-Allow-Origin" 설치 후 활성화</p>
      </div>
      <div class="p-3 rounded-xl" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">
        <p class="text-xs font-semibold text-gray-300 mb-2">방법 2: 로컬 프록시 서버 실행</p>
        <code class="text-xs text-green-400 block mt-1">npx cors-anywhere</code>
        <p class="text-xs text-gray-500 mt-1">또는 Node.js / Python 로컬 프록시 서버를 구성하세요</p>
      </div>
      <div class="p-3 rounded-xl" style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.07);">
        <p class="text-xs font-semibold text-gray-300 mb-2">방법 3: API 직접 테스트</p>
        <p class="text-xs text-gray-500 mb-2">아래 URL로 직접 접속하여 응답을 확인하세요:</p>
        <code class="text-xs text-blue-400 break-all block p-2 rounded" style="background:rgba(0,0,0,0.3);">${escHtml(url)}</code>
        <button onclick="window.open('${escAttr(url)}', '_blank')" class="btn-secondary mt-2 text-xs">
          <iconify-icon icon="solar:external-link-bold-duotone" width="14"></iconify-icon>
          새 탭에서 열기
        </button>
      </div>
    </div>
  </div>`;
      document.getElementById('emptyState').classList.add('hidden');
    }

    // ============================================================

    // Helpers
    // ============================================================

    function setLoading(val) {
      STATE.isLoading = val;
      document.getElementById('loadingState').classList.toggle('hidden', !val);
      document.getElementById('searchBtn').disabled = val;
    }

    function hideAll() {
      ['emptyState', 'noResultState', 'loadingState', 'analysisSection'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.classList.add('hidden');
      });
      document.getElementById('resultsGrid').innerHTML = '';
      document.getElementById('pagination').classList.add('hidden');
      document.getElementById('pagination').innerHTML = '';
    }

    function getTargetLabel(target) {
      const map = {
        ARTI: '논문', PATENT: '특허', REPORT: '보고서',
        ATT: '동향', SCENT: '과학향기', RESEARCHER: '연구자',
        ORGAN: '연구기관', TREND: '트렌드', SNEWS: '과학뉴스', VOLUME: '권호',
        NTIS_prjt: 'R&D과제'
      };
      return map[target] || target;
    }

    function getBadge(target) {
      const map = {
        ARTI: 'badge-arti', PATENT: 'badge-patent', REPORT: 'badge-report',
        ATT: 'badge-att', RESEARCHER: 'badge-researcher', ORGAN: 'badge-organ',
        TREND: 'badge-trend', SCENT: 'badge-att', SNEWS: 'badge-trend',
      };
      return map[target] || 'badge-arti';
    }

    function getTypeIcon(target) {
      const map = {
        ARTI: 'solar:document-text-bold-duotone',
        PATENT: 'solar:lightbulb-bold-duotone',
        REPORT: 'solar:book-2-bold-duotone',
        ATT: 'solar:graph-new-up-bold-duotone',
        RESEARCHER: 'solar:user-id-bold-duotone',
        ORGAN: 'solar:buildings-2-bold-duotone',
        TREND: 'solar:chart-2-bold-duotone',
        SCENT: 'solar:test-tube-bold-duotone',
        SNEWS: 'solar:newspaper-bold-duotone',
      };
      return map[target] || 'solar:document-bold-duotone';
    }

    function getTypeIconBg(target) {
      const map = {
        ARTI: 'bg-blue-500/10',
        PATENT: 'bg-yellow-500/10',
        REPORT: 'bg-purple-500/10',
        ATT: 'bg-orange-500/10',
        RESEARCHER: 'bg-teal-500/10',
        ORGAN: 'bg-rose-500/10',
        TREND: 'bg-green-500/10',
        SCENT: 'bg-orange-500/10',
      };
      return map[target] || 'bg-gray-500/10';
    }

    function getTypeColor(target) {
      const map = {
        ARTI: '#93c5fd',
        PATENT: '#fde68a',
        REPORT: '#d8b4fe',
        ATT: '#fdba74',
        RESEARCHER: '#5eead4',
        ORGAN: '#fda4af',
        TREND: '#86efac',
        SCENT: '#fdba74',
      };
      return map[target] || '#9ca3af';
    }

    function escHtml(s) {
      if (!s) return '';
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    // ScienceON/NTIS API가 특수문자(·, &, < 등)를 이중 인코딩(&amp;#x00B7; 등)해 내려
    // XML 파싱 후 "&#x00B7;" 같은 잔여 엔티티가 그대로 남는다. 이를 실제 문자로 디코딩.
    // textarea는 rawtext 요소라 태그는 텍스트로 보존하고 엔티티(숫자·명명)만 해제하므로
    // 이후 escHtml로 재이스케이프해도 안전하다. (XSS 위험 없음)
    const _entityDecoder = typeof document !== 'undefined' ? document.createElement('textarea') : null;
    function decodeEntities(s) {
      if (!s || s.indexOf('&') === -1 || !_entityDecoder) return s || '';
      let out = String(s);
      // 삼중 인코딩(&amp;amp;#x..) 대비 최대 2회 반복 디코딩
      for (let i = 0; i < 2 && out.indexOf('&') !== -1; i++) {
        _entityDecoder.innerHTML = out;
        const dec = _entityDecoder.value;
        if (dec === out) break;
        out = dec;
      }
      return out;
    }

    function escAttr(s) {
      if (!s) return '';
      return String(s).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function escRegex(s) {
      return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    // ============================================================

    // 연관컨텐츠 모달 (PDF 15: ConnectionContent API)
    // ============================================================

    let _relPjtId = '';
    let _relActiveCol = 'project';

    async function showRelated(pjtId, title) {
      if (!STATE.ntisKey) {
        showToast('NTIS 인증키가 필요합니다', 'warning');
        return;
      }
      _relPjtId = pjtId;
      _relActiveCol = 'project';
      document.getElementById('relatedPjtTitle').textContent = title || pjtId;
      document.querySelectorAll('#relatedModal .tab-btn').forEach(b => b.classList.remove('active'));
      document.getElementById('relTab-project').classList.add('active');
      document.getElementById('relatedModal').classList.remove('hidden');
      await loadRelated('project');
    }

    function closeRelated() {
      document.getElementById('relatedModal').classList.add('hidden');
    }

    async function switchRelTab(collection, btn) {
      _relActiveCol = collection;
      document.querySelectorAll('#relatedModal .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      await loadRelated(collection);
    }

    async function loadRelated(collection) {
      const resultsEl = document.getElementById('relatedResults');
      resultsEl.innerHTML = '<div class="flex justify-center py-8"><div class="spinner"></div></div>';

      try {
        const params = new URLSearchParams({
          apprvKey: STATE.ntisKey,
          pjtId: _relPjtId,
          collection: collection,
          topN: 10,
        });
        const resp = await fetch(`${getProxyBase()}/ntis/connection?${params}`);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();

        if (!data.exist || !data.items || data.items.length === 0) {
          resultsEl.innerHTML = '<p class="text-gray-500 text-sm text-center py-8">연관 컨텐츠가 없습니다.</p>';
          return;
        }

        // 컬렉션별 제목 필드 매핑
        // researchreport는 실제 API가 KOR_RPT_TITLE_NM을 반환 (REPORT_NM 아님 → "(제목 없음)" 버그 방지)
        const titleField = { project: 'KOR_PJT_NM', paper: 'PAPER_NM', patent: 'IPR_INVENTION_NM', researchreport: 'KOR_RPT_TITLE_NM' };
        const tf = titleField[collection] || 'KOR_PJT_NM';

        resultsEl.innerHTML = data.items.map((item, i) => {
          const itemTitle = escHtml(item[tf] || item.KOR_PJT_NM || '(제목 없음)');
          const score = item.similarity_score ? Math.round(item.similarity_score * 100) : 0;
          const scoreColor = score >= 90 ? '#4ade80' : score >= 75 ? '#fbbf24' : '#9ca3af';
          const id = item.PJT_ID || item.RST_ID || '';
          const ntisLink = collection === 'project' && id
            ? `https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${encodeURIComponent(id)}&pageCode=TH_PJT_PJT_DTL`
            : 'https://www.ntis.go.kr';
          return `
            <div class="result-card" style="padding:1rem; border-radius:8px; background: #fff; border: 1px solid #eee;">
              <div class="flex items-start gap-4">
                <span class="text-xs font-bold shrink-0 pt-1" style="color:${scoreColor}; min-width:2.5rem; text-align:right;">${score}%</span>
                <div class="flex-1 min-w-0">
                  <p class="text-black text-sm font-semibold leading-snug">${itemTitle}</p>
                  <div class="flex items-center gap-2 mt-2">
                    <span class="text-xs text-tertiary">${escHtml(id)}</span>
                    <a href="${escAttr(ntisLink)}" target="_blank" rel="noopener"
                       class="text-xs text-black font-medium flex items-center gap-0.5 hover:underline" onclick="event.stopPropagation()">
                      NTIS<iconify-icon icon="solar:arrow-right-up-bold" width="11"></iconify-icon>
                    </a>
                  </div>
                </div>
              </div>
            </div>`;
        }).join('');
      } catch (e) {
        resultsEl.innerHTML = `<p class="text-red-400 text-sm text-center py-8">오류: ${escHtml(e.message)}</p>`;
      }
    }

    // ============================================================

    // ⑦ 검색 히스토리
    // ============================================================

    function addToHistory(query) {
      if (!query || query.length < 2) return;
      STATE.searchHistory = [query, ...STATE.searchHistory.filter(h => h !== query)].slice(0, 15);
      localStorage.setItem('sc_history', JSON.stringify(STATE.searchHistory));
    }
    function showHistory() {
      if (STATE.searchHistory.length === 0) return;
      const dd = document.getElementById('historyDropdown');
      const list = document.getElementById('historyList');
      list.innerHTML = STATE.searchHistory.map(h =>
        `<li onclick="setSearchAndGo('${escAttr(h)}')">
          <iconify-icon icon="solar:clock-circle-bold-duotone" width="14"></iconify-icon>${escHtml(h)}
        </li>`
      ).join('') + `<li class="clear-btn" onclick="clearHistory()">
        <iconify-icon icon="solar:trash-bin-2-bold-duotone" width="13"></iconify-icon>기록 삭제
      </li>`;
      dd.classList.remove('hidden');
    }
    function hideHistory() {
      document.getElementById('historyDropdown').classList.add('hidden');
    }
    function clearHistory() {
      STATE.searchHistory = [];
      localStorage.removeItem('sc_history');
      hideHistory();
    }
    function setSearchAndGo(q) {
      document.getElementById('searchInput').value = q;
      hideHistory();
      doSearch();
    }

    // ============================================================

    // ⑧ 공유 링크 생성
    // ============================================================

    function updateShareUrl(query, target) {
      const url = new URL(location.href.split('?')[0]);
      url.searchParams.set('q', query);
      url.searchParams.set('t', target);
      history.replaceState(null, '', url.toString());
    }
    function copyShareLink() {
      const url = location.href;
      navigator.clipboard.writeText(url).then(() => {
        showToast('공유 링크가 클립보드에 복사되었습니다.', 'success');
      }).catch(() => {
        prompt('아래 링크를 복사하세요:', url);
      });
    }

    // ============================================================

    // ⑨ 다크/라이트 모드
    // ============================================================

    function toggleTheme() {
      const isDark = document.documentElement.classList.toggle('dark');
      localStorage.setItem('sc_theme', isDark ? 'dark' : 'light');
      document.getElementById('themeIcon').setAttribute('icon',
        isDark ? 'solar:sun-bold-duotone' : 'solar:moon-bold-duotone');
    }
    function initTheme() {
      const saved = localStorage.getItem('sc_theme') || 'light';
      if (saved === 'dark') {
        document.documentElement.classList.add('dark');
        const icon = document.getElementById('themeIcon');
        if (icon) icon.setAttribute('icon', 'solar:sun-bold-duotone');
      }
    }

    // ============================================================

    // ② CSV 내보내기
    // ============================================================

    function exportCSV(items) {
      const rows = items || STATE.currentItems;
      if (!rows || rows.length === 0) { showToast('내보낼 결과가 없습니다.', 'warning'); return; }
      const headers = ['유형', '제목', '저자/발명자', '연도', 'URL', '키워드', '초록'];
      const csvRows = [headers.join(',')];
      rows.forEach(r => {
        const cols = [r.type||'', r.title||'', r.authors||'', r.year||'', r.url||'', r.keywords||'', (r.abstract||'').replace(/\n/g,' ')];
        csvRows.push(cols.map(c => `"${String(c).replace(/"/g,'""')}"`).join(','));
      });
      const blob = new Blob(['\uFEFF' + csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `scienceon_${STATE.currentQuery}_${new Date().toISOString().slice(0,10)}.csv`;
      link.click();
      showToast(`${rows.length}건을 CSV로 내보냈습니다.`, 'success');
    }
    function exportFavCSV() { exportCSV(STATE.favorites.map(f => ({...f, authors:'', keywords:'', abstract:''}))); }

    // ============================================================

    // ③ 즐겨찾기
    // ============================================================

    function isFav(id) { return STATE.favorites.some(f => f.id === id); }
    function saveFavs() {
      localStorage.setItem('sc_favorites', JSON.stringify(STATE.favorites));
      updateFavCount();
    }
    function updateFavCount() {
      const cnt = STATE.favorites.length;
      const el = document.getElementById('favCount');
      const panelEl = document.getElementById('favPanelCount');
      if (el) { el.textContent = cnt; el.classList.toggle('hidden', cnt === 0); }
      if (panelEl) panelEl.textContent = `${cnt}건`;
    }
    function toggleFav(data, btn) {
      const idx = STATE.favorites.findIndex(f => f.id === data.id);
      if (idx >= 0) {
        STATE.favorites.splice(idx, 1);
        if (btn) { btn.classList.remove('active'); btn.querySelector('iconify-icon').setAttribute('icon','solar:bookmark-bold-duotone'); }
        showToast('즐겨찾기에서 제거했습니다.', 'info');
      } else {
        STATE.favorites.unshift(data);
        if (btn) { btn.classList.add('active'); btn.querySelector('iconify-icon').setAttribute('icon','solar:bookmark-bold'); }
        showToast('즐겨찾기에 추가했습니다.', 'success');
      }
      saveFavs();
      if (!document.getElementById('favPanel').classList.contains('open')) return;
      renderFavList();
    }
    function openFavPanel() {
      renderFavList();
      document.getElementById('favPanel').classList.add('open');
      document.getElementById('favOverlay').classList.add('open');
    }
    function closeFavPanel() {
      document.getElementById('favPanel').classList.remove('open');
      document.getElementById('favOverlay').classList.remove('open');
    }
    function renderFavList() {
      const container = document.getElementById('favList');
      updateFavCount();
      if (STATE.favorites.length === 0) {
        container.innerHTML = '<div class="p-8 text-center text-gray-400 text-sm">즐겨찾기가 없습니다.<br>검색 결과의 <iconify-icon icon="solar:bookmark-bold-duotone" width="14"></iconify-icon> 버튼을 눌러 추가하세요.</div>';
        return;
      }
      container.innerHTML = STATE.favorites.map(f => `
        <div class="fav-card" onclick="${f.url ? `window.open('${escAttr(f.url)}','_blank')` : ''}">
          <div class="flex items-start justify-between gap-2">
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5 mb-1">
                <span class="text-xs px-1.5 py-0.5 rounded font-medium" style="background:#f5f5f5;">${escHtml(f.type||'')}</span>
                ${f.year ? `<span class="text-xs text-gray-400">${escHtml(f.year)}</span>` : ''}
              </div>
              <p class="text-sm font-semibold leading-snug line-clamp-2">${escHtml(f.title||'')}</p>
              ${f.authors ? `<p class="text-xs text-gray-400 mt-1 truncate">${escHtml(f.authors)}</p>` : ''}
            </div>
            <button type="button" class="fav-btn active flex-shrink-0" onclick="event.stopPropagation();removeFav('${escAttr(f.id)}',this)">
              <iconify-icon icon="solar:bookmark-bold" width="16"></iconify-icon>
            </button>
          </div>
        </div>`).join('');
    }
    function removeFav(id, btn) {
      STATE.favorites = STATE.favorites.filter(f => f.id !== id);
      saveFavs();
      renderFavList();
      document.querySelectorAll(`.fav-btn`).forEach(b => {
        const icon = b.querySelector('iconify-icon');
        if (icon) icon.setAttribute('icon', 'solar:bookmark-bold-duotone');
        b.classList.remove('active');
      });
    }

    // ============================================================

    // ⑤ 연구자/기관 프로필 패널
    // ============================================================

    function showProfilePanel(btn) {
      const name = btn.dataset.name || '';
      const subtitle = btn.dataset.subtitle || '';
      document.getElementById('profileTitle').textContent = name;
      document.getElementById('profileContent').innerHTML = `
        <div class="flex items-center gap-3">
          <div class="w-14 h-14 rounded-full bg-gray-100 flex items-center justify-center">
            <iconify-icon icon="solar:user-circle-bold-duotone" width="32" class="text-gray-400"></iconify-icon>
          </div>
          <div>
            <p class="font-bold text-lg">${escHtml(name)}</p>
            <p class="text-sm text-gray-400">${escHtml(subtitle)}</p>
          </div>
        </div>
        <div class="text-sm text-gray-400 pt-2">검색창에서 이 연구자의 논문을 검색합니다.</div>
        <button type="button" class="btn-primary text-sm w-full mt-2" onclick="setSearchAndGo('${escAttr(name)}')">
          <iconify-icon icon="solar:magnifer-bold" width="14"></iconify-icon>논문 검색
        </button>`;
      document.getElementById('profilePanel').classList.add('open');
    }
    function closeProfilePanel() {
      document.getElementById('profilePanel').classList.remove('open');
    }

    // ============================================================

    // ⑥ 비교 검색
    // ============================================================

    function toggleCompare() {
      STATE.compareMode = !STATE.compareMode;
      const section = document.getElementById('compareSection');
      section.classList.toggle('active', STATE.compareMode);
      const btn = document.getElementById('compareToggleBtn');
      if (btn) btn.classList.toggle('active', STATE.compareMode);
      if (STATE.compareMode) {
        section.scrollIntoView({ behavior: 'smooth', block: 'start' });
        document.getElementById('compareInputA').value = STATE.currentQuery || '';
      }
    }
    function renderCompareGrid(xml, gridId) {
      if (!xml) return;
      const items = getItems(xml);
      document.getElementById(gridId).innerHTML = items.length
        ? items.map((item,i) => renderCard(item, i, '')).join('')
        : '<p class="text-center text-gray-400 text-sm py-8">결과 없음</p>';
    }

    // Toast
    // ============================================================

    let toastTimeout;
    function showToast(msg, type = 'info') {
      const container = document.getElementById('toastContainer');
      container.innerHTML = '';
      clearTimeout(toastTimeout);

      const icons = {
        success: 'solar:check-circle-bold-duotone',
        error: 'solar:close-circle-bold-duotone',
        warning: 'solar:danger-circle-bold-duotone',
        info: 'solar:info-circle-bold-duotone',
      };
      const colors = {
        success: '#4ade80',
        error: '#f87171',
        warning: '#fbbf24',
        info: '#60a5fa',
      };
      const borders = {
        success: 'rgba(74,222,128,0.3)',
        error: 'rgba(239,68,68,0.3)',
        warning: 'rgba(251,191,36,0.3)',
        info: 'rgba(96,165,250,0.3)',
      };

      container.innerHTML = `
  <div class="toast" style="border-color: ${borders[type]};">
    <iconify-icon icon="${icons[type]}" style="color: ${colors[type]}; flex-shrink:0;" width="20"></iconify-icon>
    <span class="text-sm text-gray-300" style="word-break:keep-all;">${escHtml(msg)}</span>
    <button onclick="this.closest('.toast').remove()" style="margin-left:auto; color:#666; flex-shrink:0;">
      <iconify-icon icon="solar:close-circle-bold-duotone" width="16"></iconify-icon>
    </button>
  </div>`;

      toastTimeout = setTimeout(() => {
        container.innerHTML = '';
      }, 5000);
    }

    // ============================================================

    document.addEventListener('keydown', (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        document.getElementById('searchInput').focus();
        document.getElementById('searchInput').select();
      }
      if (e.key === 'Escape') {
        closeSettings();
      }
    });

    // Click outside modal to close
    document.getElementById('settingsModal').addEventListener('click', function (e) {
      if (e.target === this) closeSettings();
    });

    // ============================================================


    // ── 모달 열기/닫기 ────────────────────────────────────────────
    // 적정 연구비 분석 박스를 analysisSection(인라인)으로 이동 — 다른 분석과 동일하게 표출
    // 박스 노드 참조를 보관하여 다른 분석이 analysisSection을 덮어써도(노드 detach) 재사용 가능
    let _budgetBoxRef = null;
    function _mountBudgetInline() {
      const section = document.getElementById('analysisSection');
      if (!_budgetBoxRef) {
        _budgetBoxRef = document.querySelector('#budgetResultModal .budget-modal-box');
      }
      const box = _budgetBoxRef;
      if (box && box.parentElement !== section) {
        section.innerHTML = '';
        section.appendChild(box);
        box.classList.add('budget-inline-box');
      }
      // 오버레이는 항상 숨김 상태 유지
      document.getElementById('budgetResultModal').classList.add('hidden');
      section.classList.remove('hidden');
    }

    function openBudgetModal() {
      // 프록시가 서버 NTIS_API_KEY를 보유하면(ntisConfigured) 브라우저 키 없이도 가능.
      // 직접 모드이거나 서버에 키가 없을 때만 브라우저 입력 키를 요구한다.
      if (!STATE.ntisKey && !(PROXY_AVAILABLE && STATE.ntisConfigured)) {
        showToast('NTIS API 인증키가 필요합니다. API 설정에서 입력해주세요.', 'warning');
        return;
      }
      const query = document.getElementById('searchInput').value.trim() || STATE.currentQuery || '';

      // 다른 분석 메뉴와 동일하게 페이지 인라인으로 표출
      document.body.classList.add('search-mode');
      hideAll();
      _mountBudgetInline();

      // 기간·규모·연구단계를 확인한 뒤 사용자가 명시적으로 시작하도록 한다.
      document.getElementById('budgetQueryForm').classList.remove('hidden');
      document.getElementById('budgetProgressArea').classList.add('hidden');
      document.getElementById('budgetResultContent').innerHTML = '';
      document.getElementById('budgetQueryInput').value = query;
      _budgetActiveProject = query;
      document.getElementById('budgetQueryInput').focus();
    }
    function _startBudgetWithQuery(query) {
      query = query.trim();
      if (!query) return;
      document.getElementById('budgetQueryForm').classList.add('hidden');
      runBudgetEstimation(query);
    }
    function closeBudgetModal() {
      document.getElementById('analysisSection').classList.add('hidden');
    }
    function closeBudgetResult() {
      document.getElementById('analysisSection').classList.add('hidden');
    }

    // ── 유틸: 연구비 포맷 (억 / 백만 원) ───────────────────────────
    function fmtBudget(won) {
      if (won === null || won === undefined || isNaN(won) || won < 0) return '-';
      if (won === 0) return '0원';
      const num = Number(won);
      if (num >= 100000000) return (num / 100000000).toFixed(1) + '억 원';
      if (num >= 10000000)  return (num / 10000000).toFixed(1)  + '천만 원';
      if (num >= 1000000)   return (num / 1000000).toFixed(0)   + '백만 원';
      if (num >= 1000)      return (num / 1000).toLocaleString() + '천 원';
      return Math.round(num).toLocaleString() + ' 원';
    }

    // ── 유틸: 로그 추가 ──────────────────────────────────────────
    let budgetLog = [];
    let _budgetReportData = null;   // 마지막 분석 결과 저장 (보고서 생성용)
    function addBudgetLog(icon, msg) {
      budgetLog.push({ icon, msg });
      const box = document.getElementById('budgetProcessLog');
      if (!box) return;
      box.innerHTML = budgetLog.map(l =>
        `<div class="budget-log-line"><span class="budget-log-icon">${l.icon}</span><span>${escHtml(l.msg)}</span></div>`
      ).join('');
      box.scrollTop = box.scrollHeight;
    }

    // ── 유틸: 진행 바 업데이트 (1~5) ──────────────────────────────
    function setBudgetStep(step) {
      for (let i = 1; i <= 5; i++) {
        const el = document.getElementById(`budgetStep${i}`);
        if (!el) continue;
        el.className = 'budget-step ' + (i < step ? 'done' : i === step ? 'active' : '');
      }
      const label = [
        '', 'Step 1: AI 키워드 추출 중...', 'Step 2: NTIS 과제 수집 중...', 'Step 3: 연간 정규화 + 이상치 제거 중...',
        'Step 4: AI 유사도 평가 중...', 'Step 5: 비교기준 예산 산출 중...'
      ][step] || '';
      const lbl = document.getElementById('budgetStepLabel');
      if (lbl) lbl.textContent = label;
    }

    // ── Step 0: 연구내용 시놉시스 생성 (과제명 기반) ──────────────
    async function generateResearchSynopsis(projName) {
      if (!hasAIAccess()) {
        return "과제명 기반 기계적 매칭 (AI 요약 미처리)";
      }
      try {
        const systemPrompt = `You are a Korean R&D expert. Based on the given PROJECT NAME, write a concise technical summary (synopsis) of what this project likely involves.
Focus on research goals and expected core technologies. 
Keep it under 80 Korean characters. No preamble.`;
        const userPrompt = `Project Name: "${projName}"`;

        const resp = await cerebrasChat({
          model: getActiveCerebrasModel(),
          messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
          temperature: 0.3,
          max_tokens: 500,
        });
        if (!resp.ok) return "AI 요약 생성 실패 (과제명 기반 매칭)";
        const data = await resp.json();
        return (data?.choices?.[0]?.message?.content || '').trim().substring(0, 150);
      } catch (e) {
        return "AI 연동 오류 (과제명 기반 매칭)";
      }
    }

    // ── Step 1: AI 키워드 추출 ───────────────────────────────────
    async function extractKeywordsForBudget(projName, researchContent) {
      if (!hasAIAccess()) {
        // AI 서버 미설정 시 입력값을 그대로 키워드로 사용
        addBudgetLog('⚠️', 'AI 서버 미설정 → 과제명 기반 기본 검색');
        return buildBudgetSearchKeywords(projName, extractKeywordsManual(projName));
      }

      const systemPrompt = `You are a Korean R&D project search expert. Generate NTIS (National Science and Technology Information Service) search keywords.
Always respond with ONLY valid JSON. No explanation.`;

      const userPrompt = `New project name: "${projName}"
Research content: "${researchContent}"

Generate 3 NTIS search keyword combinations optimized for searching similar Korean R&D projects.
1. FOCUS primarily on the core technology and domain found in the Project Name.
2. The Research Content is only for technical context—do not include rare or too many specific terms from it.
3. Each keyword combination should be 2-3 words (e.g., "AI 재난안전 플랫폼").
4. One of the combinations should be the core part of the Project Name itself.

Respond ONLY with:
{"keywords": ["keyword1", "keyword2", "keyword3"]}`;

      let resp;
      try {
        resp = await cerebrasChat({
          model: getActiveCerebrasModel(),
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.4,
          max_tokens: 1000,
        });
      } catch (e) {
        addBudgetLog('⚠️', 'AI 키워드 추출 시간 초과/오류 → 수동 분절 검색으로 전환');
        return extractKeywordsManual(projName);
      }

      if (!resp.ok) {
        addBudgetLog('⚠️', `AI 키워드 추출 실패 (${resp.status}) → 수동 분절 검색으로 전환`);
        return extractKeywordsManual(projName);
      }

      const data = await resp.json();
      const raw = (data?.choices?.[0]?.message?.content || '').trim();
      // 관대한 복구 파싱(콤마 누락 등) → 실패 시 "..." 문자열 직접 추출 → 수동 분절
      const parsed = lenientJSONParse(raw);
      if (Array.isArray(parsed?.keywords) && parsed.keywords.length) {
        return buildBudgetSearchKeywords(projName, parsed.keywords.map(k => String(k || '').trim()).filter(Boolean).slice(0, 3));
      }
      const salvaged = [...raw.matchAll(/"([^"\n]{2,40})"/g)].map(m => m[1])
        .filter(s => s !== 'keywords' && /[가-힣A-Za-z]/.test(s)).slice(0, 3);
      if (salvaged.length) {
        addBudgetLog('⚠️', `AI 키워드 JSON 복구 실패 → 문자열 직접 추출 (${salvaged.join(', ')})`);
        return buildBudgetSearchKeywords(projName, salvaged);
      }
      addBudgetLog('⚠️', 'AI 키워드 JSON 파싱 실패 → 수동 분절 검색으로 전환');
      return buildBudgetSearchKeywords(projName, extractKeywordsManual(projName));
    }

    // AI 미설정 시 수동 키워드 추출 (최대한 쪼개서 NTIS 검색 유도)
    // AI 미설정 시 수동 키워드 추출 (핵심어 추출 및 불용어 제거)
    function extractKeywordsManual(projName) {
      // 1. 공백/콤마로 분리
      const words = projName.split(/[\s,]+/).filter(w => w.length >= 2);
      if (!words.length) return [projName];
      
      // 2. 불용어(개발, 구축 등) 제거한 핵심어군 생성
      const stopWords = ['개발', '연구', '고도화', '구축', '플랫폼', '시스템', '기반', '기술', '사업', '과제'];
      const coreWords = words.filter(w => !stopWords.includes(w));
      
      const results = [];
      // (1) 전체 과제명
      results.push(projName);
      // (2) 핵심어 조합
      if (coreWords.length >= 2) results.push(coreWords.join(' '));
      // (3) 첫 두 단어
      if (words.length >= 2) results.push(words.slice(0, 2).join(' '));
      // (4) 가장 긴 단어 (보통 기술명인 경우가 많음)
      const longest = [...words].sort((a, b) => b.length - a.length)[0];
      if (longest && !results.includes(longest)) results.push(longest);

      return [...new Set(results)].slice(0, 4);
    }

    // 적정 연구비는 검색어가 조금만 좁아져도 표본이 급격히 줄어든다.
    // AI 키워드 3개가 과제명 세부 표현에 갇히지 않도록 상위 도메인 앵커를 함께 검색한다.
    function buildBudgetSearchKeywords(projName, seedKeywords = []) {
      const text = String(projName || '').replace(/\s+/g, ' ').trim();
      const compact = text.replace(/\s+/g, '');
      const seeds = Array.isArray(seedKeywords) ? seedKeywords : [];
      const stop = new Set(['개발','연구','고도화','구축','플랫폼','시스템','기반','기술','사업','과제','이용한','활용한','위한']);
      const anchors = [];
      const addAnchor = (kw) => {
        if (kw && !anchors.includes(kw)) anchors.push(kw);
      };

      [
        [/인공지능|(^|[^A-Za-z])AI([^A-Za-z]|$)|Artificial\s*Intelligence/i, '인공지능'],
        [/재난안전|재난\s*안전|재난/, '재난안전'],
        [/디지털\s*트윈|디지털트윈/i, '디지털트윈'],
        [/양자\s*컴퓨팅|양자컴퓨팅/i, '양자컴퓨팅'],
        [/(이차|2차)\s*전지|배터리/i, '이차전지'],
        [/자율\s*주행|자율주행/i, '자율주행'],
        [/수소\s*에너지|수소에너지/i, '수소에너지'],
      ].forEach(([pattern, keyword]) => {
        if (pattern.test(text) || pattern.test(compact)) addAnchor(keyword);
      });

      const tokens = text.split(/[\s,·/()_-]+/)
        .map(token => token.replace(/(을|를|은|는|이|가|의|과|와|로|으로)$/u, ''))
        .filter(token => token.length >= 2 && !stop.has(token));
      tokens.slice(0, 3).forEach(addAnchor);

      const expanded = [];
      const add = (kw) => {
        const normalized = String(kw || '').replace(/\s+/g, ' ').trim();
        if (!normalized || normalized.length < 2) return;
        if (!expanded.includes(normalized)) expanded.push(normalized);
      };

      seeds.forEach(add);
      if (anchors.length >= 2) add(anchors.slice(0, 2).join(' '));
      anchors.forEach(add);
      add(text);

      const result = expanded.slice(0, 6);
      if (result.length > seeds.filter(Boolean).length) {
        addBudgetLog('🔎', `표본 보강 검색어 추가: ${result.slice(seeds.filter(Boolean).length).join(', ')}`);
      }
      return result.length ? result : [text || String(seedKeywords?.[0] || '')].filter(Boolean);
    }

    // ── Step 2: NTIS 과제 수집 ──────────────────────────────────
    async function fetchNTISForBudget(keywords, rndPhase, bizSect, displayCnt = 100) {
      if (!STATE.ntisKey && !(PROXY_AVAILABLE && STATE.ntisConfigured)) throw new Error('NTIS API 인증키가 필요합니다. API 설정에서 입력해주세요.');

      // ACTIVE_PROXY='direct'(프록시 미감지) 시에도 Vercel 프록시로 폴백 시도
      // VERCEL_BASE는 Vercel 도메인에서 ''(상대경로), 외부에서는 절대 URL
      const proxyBase = getProxyBase() || VERCEL_BASE || '';
      if (!proxyBase) throw new Error('프록시 서버가 연결되어 있지 않습니다. 터미널에서 node proxy-server.js 를 실행하세요.');

      const allItems = [];
      const seenIds = new Set();

      for (const kw of keywords) {
        addBudgetLog('🔍', `NTIS 검색: "${kw}"`);
        const params = new URLSearchParams({
          apprvKey: STATE.ntisKey,
          collection: 'project',
          SRWR: kw,      // 최신 API 필수 파라미터 병행
          query: kw,     // 하위 호환성용
          displayCnt: displayCnt,
          startPosition: 1,
          searchRnkn: 'Y',
          naviCount: 5,
        });

        // addQuery는 사용하지 않음 — 형식 오류 시 API 0건 원인이 되므로 클라이언트 필터로만 처리

        const sleep = ms => new Promise(r => setTimeout(r, ms));
        let tries = 0;
        let resp;
        
        while (tries < 3) {
          try {
            resp = await fetch(`${proxyBase}/ntis?${params.toString()}`, { signal: AbortSignal.timeout(12000) });
            if (resp.status === 429) {
              addBudgetLog('⏳', `API 부하(429) 발생 → 재시도 준비 (${tries + 1}/3)`);
              await sleep(600 + Math.random() * 400);
              tries++;
              continue;
            }
            break;
          } catch (e) {
            tries++;
            await sleep(500);
          }
        }

        try {
          if (!resp || !resp.ok) {
            addBudgetLog('⚠️', `"${kw}" HTTP 오류: ${resp ? resp.status : '응답 없음'}`);
            continue;
          }
          const text = await resp.text();
          const xml = new DOMParser().parseFromString(text, 'text/xml');

          // XML 파싱 오류 감지
          if (xml.getElementsByTagName('parsererror').length > 0) {
            addBudgetLog('⚠️', `"${kw}" XML 파싱 실패 — 유효하지 않은 응답`);
            addBudgetLog('🔍', `RAW 응답: ${text.substring(0, 300)}`);
            continue;
          }

          // NTIS API 오류 코드 감지 (일반 검색과 동일하게 처리)
          const gxErr = (tag) => xml.getElementsByTagName(tag)[0]?.textContent?.trim() || '';
          const errCode = gxErr('CODE') || gxErr('returnCode');
          const errMsg  = gxErr('MESSAGE') || gxErr('returnMsg');
          if (errCode && errCode !== '0') {
            addBudgetLog('❌', `NTIS API 오류 [${errCode}]: ${errMsg}`);
            throw new Error(`NTIS API 오류 [${errCode}]: ${errMsg}`);
          }

          // HIT 태그 폴백 (NTIS 응답 구조 변형 대응)
          let items = Array.from(xml.getElementsByTagName('HIT'));
          if (items.length === 0) items = Array.from(xml.getElementsByTagName('item'));
          if (items.length === 0) items = Array.from(xml.getElementsByTagName('row'));
          if (items.length === 0) items = Array.from(xml.getElementsByTagName('record'));

          // [PATCH] 공백이 포함된 검색어인데 결과가 0건인 경우, 띄어쓰기를 무시하고 검색 시도 (NTIS 특성 대응)
          if (items.length === 0 && kw.includes(' ')) {
            const noSpaceKw = kw.replace(/\s+/g, '');
            addBudgetLog('🔍', `결과 0건 → 띄어쓰기 제거 재검색: "${noSpaceKw}"`);
            params.set('query', noSpaceKw);
            params.set('SRWR', noSpaceKw);
            
            let resp2 = await fetch(`${proxyBase}/ntis?${params.toString()}`, { signal: AbortSignal.timeout(12000) });
            if (resp2.status === 429) {
              await sleep(800);
              resp2 = await fetch(`${proxyBase}/ntis?${params.toString()}`, { signal: AbortSignal.timeout(12000) });
            }

            if (resp2 && resp2.ok) {
              const text2 = await resp2.text();
              const xml2 = new DOMParser().parseFromString(text2, 'text/xml');
              items = Array.from(xml2.getElementsByTagName('HIT'));
              if (items.length === 0) items = Array.from(xml2.getElementsByTagName('item'));
              if (items.length === 0) items = Array.from(xml2.getElementsByTagName('row'));
              if (items.length === 0) items = Array.from(xml2.getElementsByTagName('record'));
            }
          }
          
          // 수집 전 약간의 지연 (연속 호출 방지)
          await sleep(150);

          // 아이템이 0건인 경우 진단용 RAW 응답 출력
          if (items.length === 0) {
            const rootTag = xml.documentElement?.tagName || '(없음)';
            const totalHits = xml.getElementsByTagName('TOTALHITS')[0]?.textContent?.trim()
                           || xml.getElementsByTagName('totalCount')[0]?.textContent?.trim() || '?';
            addBudgetLog('⚠️', `"${kw}" 0건 — XML 루트: <${rootTag}>, TOTALHITS: ${totalHits}`);
            addBudgetLog('🔍', `RAW: ${text.substring(0, 500)}`);
          }

          addBudgetLog('📦', `"${kw}" → ${items.length}건 수집`);

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            // [PATCH] 대소문자 무시 검색 및 계층/평면 구조 동시 지원 유틸리티
            const gv = (tagName, subTagName) => {
              const findElLower = (root, tag) => {
                if (!root || !tag) return null;
                const tagLower = tag.toLowerCase();
                return Array.from(root.children).find(e => e.tagName.toLowerCase() === tagLower) || 
                       root.getElementsByTagName(tag)[0] || 
                       root.getElementsByTagName(tagLower)[0];
              };
              
              let el = findElLower(item, tagName);
              if (!el) return '';
              
              if (subTagName) {
                const sub = findElLower(el, subTagName);
                return sub?.textContent?.trim() || '';
              }
              return el.textContent?.trim() || '';
            };

            const parseMoney = (s) => {
              return BudgetCore.parseMoneyValue(s);
            };

            const rawPjtId = gv('ProjectNumber') || gv('PJT_ID') || gv('PJTID') || gv('pjtId') || '';
            const projNm    = gv('ProjectTitle', 'Korean') || gv('ProjectTitle') || '';
            const absContent= gv('Abstract', 'Full') || gv('Abstract') || gv('Goal', 'Full') || '';
            
            // NTIS API 연구비 파싱 (실제 XML 태그 확인된 필드)
            const totFund   = parseMoney(
              gv('TotalFunds', 'Total') || gv('TotalFunds', 'Amount') ||
              gv('TotalFunds', 'Sum') || gv('TotalFunds') || '0'
            );
            const fundGov   = parseMoney(
              gv('TotalFunds', 'Government') || gv('GovernmentFunds', 'Total') ||
              gv('GovernmentFunds') || '0'
            );
            const fundThyr  = parseMoney(
              gv('CurrentYearFunds', 'Total') || gv('CurrentYearFunds', 'Amount') ||
              gv('CurrentYearFunds') || gv('ThisYearFunds') || gv('YearFunds') ||
              gv('FUND_THYR') || gv('fundThyr') || '0'
            );

            // ProjectPeriod: <Start>20240601</Start> (YYYYMMDD 8자)
            const prdStartRaw = gv('ProjectPeriod', 'Start') || gv('ProjectPeriod', 'TotalStart') || '';
            const prdEndRaw   = gv('ProjectPeriod', 'End')   || gv('ProjectPeriod', 'TotalEnd')   || '';
            const prdStart    = prdStartRaw.substring(0, 4);
            const prdEnd      = prdEndRaw.substring(0, 4);

            // 연구개발단계: <DevelopmentPhases>개발연구</DevelopmentPhases>
            const phase     = gv('DevelopmentPhases') || gv('ResearchPhase') || gv('RND_PHASE') || '';
            const biz       = gv('BusinessName') || gv('BusinessSector') || gv('BIZ_SECT') || '';
            const perfOrg   = gv('ResearchAgency', 'Name') || gv('LeadAgency') || '';

            // 과제번호가 누락된 응답을 배열 인덱스로 중복 제거하면 서로 다른 검색 결과가
            // 잘못 합쳐진다. 과제명·기간·기관 복합키를 안정적인 폴백 식별자로 사용한다.
            const stableTitle = projNm.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
            const pjtId = rawPjtId || [stableTitle, prdStartRaw, prdEndRaw, perfOrg].join('|');
            if (pjtId && seenIds.has(pjtId)) continue;
            if (pjtId) seenIds.add(pjtId);

            // [Step 2] 연도 필터 (너무 오래된 과제 제외, 거스 연도 없으면 통과)
            const startYr = parseInt(prdStart);
            const curYr   = new Date().getFullYear();
            if (prdStart && !isNaN(startYr) && startYr < curYr - 15) continue; // 15년 이내로 완화

            // 수행연수 계산 (기간 정보 있는 경우에만)
            const hasPeriod = prdStart && prdEnd && !isNaN(parseInt(prdStart)) && !isNaN(parseInt(prdEnd));
            const exactDuration = BudgetCore.durationYearsFromDates(prdStartRaw, prdEndRaw);
            const projYrs   = exactDuration || (hasPeriod ? Math.max(1, parseInt(prdEnd) - parseInt(prdStart) + 1) : 0);

            // 수행기간은 연간 연구비 정규화에만 사용한다. 표본 축소를 막기 위해 기간 필터는 적용하지 않는다.

            // 연구개발단계 필터
            if (rndPhase && rndPhase !== '전체' && rndPhase !== 'ALL' && phase && !phase.includes(rndPhase)) continue;

            // 사업유형 필터
            if (bizSect && bizSect !== '전체' && bizSect !== 'ALL' && biz && !biz.includes(bizSect)) continue;

            // ── 연간 예산 산출 ──────────────────────────────────────
            const normalizedBudget = BudgetCore.normalizeAnnualBudget({
              currentYearFunds: fundThyr,
              totalFunds: totFund,
              governmentFunds: fundGov,
              start: prdStartRaw,
              end: prdEndRaw,
            });
            const annualBudget = normalizedBudget.annualBudget;
            const budgetSource = normalizedBudget.source;
            const budgetQuality = normalizedBudget.quality;
            
            allItems.push({
              projNm, annualBudget, budgetSource, budgetQuality, totFund, fundThyr, fundGov,
              prdStart, prdEnd, prdStartRaw, prdEndRaw, projYrs,
              phase, biz, perfOrg, absContent, pjtId, ntisPjtId: rawPjtId,
            });
          }
        } catch (e) {
          addBudgetLog('⚠️', `"${kw}" 검색 오류: ${e.message}`);
        }
      }

      addBudgetLog('✅', `메타 필터 후 ${allItems.length}건 확보`);
      return allItems;
    }

    // ── Step 2.5: 동일 과제 병합 (연차·공동수행기관 분할 방지) ─────
    // NTIS는 다년 과제의 연차별·공동수행기관별 레코드에 서로 다른 과제번호를 부여하므로,
    // 과제번호 기준 중복제거만으로는 같은 과제가 표본에 과다 반영된다.
    // 정규화 과제명 키로 묶어 1과제=1표본으로 병합하고(사업명이 달라도 후속 연차·재편성 과제까지
    // 공격적으로 통합), 대표 연간 연구비는 "연도별 합산(같은 연도의 공동수행기관 몫을 합산) →
    // 그 연도별 합산액의 중앙값"으로 산출한다. 제목이 같은 서로 다른 과제가 합쳐질 수 있는 위험은 감수한다.
    function collapseByProject(items) {
      if (!Array.isArray(items) || items.length <= 1) return items || [];
      const normKey = (s) => String(s || '')
        .replace(/<[^>]*>/g, '')            // HTML 태그 제거
        .toLowerCase()
        .replace(/[\s ]+/g, '')        // 공백 제거
        .replace(/[()[\]{}·,./_+-]/g, '');  // 구분기호 제거

      const groups = new Map();
      for (const it of items) {
        const key = normKey(it.projNm);   // 과제명만으로 병합 (사업명 무시)
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(it);
      }

      const merged = [];
      let collapsedCount = 0;
      for (const group of groups.values()) {
        if (group.length === 1) { merged.push(group[0]); continue; }

        // 연도별(시작연도 기준) 합산 — 같은 연도의 공동수행기관 몫을 합쳐 과제-연도 총액을 만든다.
        const yearSum = new Map();
        for (const it of group) {
          const b = Number(it.annualBudget) || 0;
          if (b <= 0) continue;
          const yr = it.prdStart || '기타';
          yearSum.set(yr, (yearSum.get(yr) || 0) + b);
        }
        const yearTotals = [...yearSum.values()].filter(v => v > 0).sort((a, b) => a - b);
        const repBudget = yearTotals.length ? Math.round(BudgetCore.quantileSorted(yearTotals, 0.50)) : 0;

        // 표시용 대표 레코드 = 연간 연구비가 가장 큰 멤버. 기간은 그룹 전체 span, 연구비는 대표값으로 덮어쓴다.
        const base = group.reduce((a, b) => ((Number(b.annualBudget) || 0) > (Number(a.annualBudget) || 0) ? b : a), group[0]);
        const starts = group.map(g => g.prdStart).filter(Boolean).sort();
        const ends   = group.map(g => g.prdEnd).filter(Boolean).sort();
        const mergedStart = starts[0] || base.prdStart;
        const mergedEnd   = ends[ends.length - 1] || base.prdEnd;
        const spanYrs = (parseInt(mergedStart) && parseInt(mergedEnd))
          ? Math.max(1, parseInt(mergedEnd) - parseInt(mergedStart) + 1) : base.projYrs;

        merged.push({
          ...base,
          annualBudget: repBudget,
          budgetSource: 'merged_year_median',
          prdStart: mergedStart,
          prdEnd: mergedEnd,
          projYrs: spanYrs,
          mergedCount: group.length,
          mergedYears: yearTotals.length,
        });
        collapsedCount += group.length - 1;
      }

      if (collapsedCount > 0) {
        addBudgetLog('🧩', `동일 과제 병합: ${items.length}건 → ${merged.length}건 (연차·공동기관 중복 ${collapsedCount}건 통합 · 대표값=연도별 합산액의 중앙값)`);
      }
      return merged;
    }

    // ── Step 3: 연간 정규화 + IQR 이상치 제거 ────────────────────
    function normalizeAndClean(items) {
      const result = BudgetCore.cleanBudgetItems(items);
      const d = result.diagnostics;
      if (d.missingBudgetCount > 0) {
        addBudgetLog('⚠️', `연구비 누락 ${d.missingBudgetCount}건은 통계·AI 평가에서 제외`);
      }
      if (d.iqrMultiplier === null) {
        addBudgetLog('📊', `유효 연구비 ${result.items.length}건 — 소표본이므로 IQR 제거를 생략`);
      } else {
        addBudgetLog('📊', `IQR ${d.iqrMultiplier}배 기준 이상치 ${d.outlierCount}건 제외 → ${result.items.length}건 유지 (Q1: ${fmtBudget(d.q1)}, Q3: ${fmtBudget(d.q3)})`);
      }
      return result.items;
    }

    // ── Step 4: AI 유사도 평가 ───────────────────────────────────
    function budgetLexicalRelevance(projName, item) {
      const stop = new Set(['개발','연구','고도화','구축','플랫폼','시스템','기반','기술','사업','과제']);
      const tokens = String(projName || '').toLowerCase().split(/[\s,·/()_-]+/)
        .filter(token => token.length >= 2 && !stop.has(token));
      if (!tokens.length) return 0;
      const title = String(item?.projNm || '').toLowerCase();
      const matches = tokens.filter(token => title.includes(token));
      return matches.length / tokens.length;
    }

    async function aiSimilarityEval(projName, items) {
      if (!hasAIAccess() || items.length <= 5) {
        // AI 없거나 이미 5건 이하 → 통계 기반 선정
        // 유사도를 순서 기반으로 차등 부여하면 가중평균이 왜곡되므로 균등값(null) 처리
        const topN = [...items]
          .sort((a, b) => budgetLexicalRelevance(projName, b) - budgetLexicalRelevance(projName, a))
          .slice(0, 12)
          .map(item => ({ ...item, similarity: null, similaritySource: 'none', aiReason: '키워드 관련성 기반 선정 (AI 미평가)' }));
        addBudgetLog('📌', `AI 평가 생략 → 통계 기반 Top ${topN.length}건 선정`);
        return topN;
      }

      addBudgetLog('🤖', `AI 유사도 평가 중... (${items.length}건 후보)`);

      // API 반환 순서 대신 제목 핵심어 관련성으로 1차 정렬한다.
      // 연구비는 비교대상 선택에 노출하지 않아 예산값이 유사도 판단을 끌어가는 누출을 차단한다.
      const candidatePool = [...items]
        .sort((a, b) => budgetLexicalRelevance(projName, b) - budgetLexicalRelevance(projName, a))
        .slice(0, 40);
      const candidateList = candidatePool.map((item, i) =>
        `[${i}] ${item.projNm} | ${item.prdStart}~${item.prdEnd} | ${item.perfOrg} | ${item.phase || '-'} | ${item.biz || '-'}`
      ).join('\n---\n');

      const systemPrompt = `You are a Korean R&D budget expert. Evaluate similarity between a new project and existing NTIS projects.
Always respond ONLY with valid JSON. No extra text.`;

      const userPrompt = `New project:
Name: "${projName}"

Candidate NTIS projects (index: name | period | org | R&D phase | program):
${candidateList}

Select the Top 10 projects most similar to the New Project based on these weighted criteria:
- Technical similarity (55%): research goals, core technologies, and theoretical methodology
- Scope/Scale fit (30%): R&D stage (TRL), scale of work, and type of deliverables
- Recency & Policy fit (15%): proximity to current date (newer is better) and policy context

Evaluate from the project names and listed metadata only. Do not infer similarity from project budget; budget values are intentionally hidden.

Respond ONLY with:
{"selected": [
  {"index": 0, "similarity": 88, "reason": "2-sentence explanation in Korean"}
]}`;

      try {
        const resp = await cerebrasChat({
          model: getActiveCerebrasModel(),
          reasoning_effort: 'high',   // 3차원 가중 유사도 비교·Top-10 선정
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: 6000,           // Top-10 사유 JSON과 추론 여유
        });

        if (!resp.ok) throw new Error(`Cerebras ${resp.status}`);

        const data = await resp.json();
        const raw = (data?.choices?.[0]?.message?.content || '').trim();

        // 2단계 JSON 파싱: Korean reason 필드의 특수문자로 인한 SyntaxError 대응
        let parsed;
        try {
          // 1차: "selected" 키를 포함한 JSON 블록 추출
          const match = raw.match(/\{[\s\S]*"selected"[\s\S]*\}/);
          if (!match) throw new Error('selected 키 없음');
          parsed = JSON.parse(match[0]);
        } catch {
          // 2차: index/similarity 값만 정규식으로 직접 추출 (reason 파싱 포기)
          const idxMatches = [...raw.matchAll(/"index"\s*:\s*(\d+)/g)];
          const simMatches = [...raw.matchAll(/"similarity"\s*:\s*(\d+)/g)];
          parsed = {
            selected: idxMatches.map((m, i) => ({
              index: parseInt(m[1]),
              similarity: simMatches[i] ? parseInt(simMatches[i][1]) : null,
              reason: 'AI 분석 기반 (reason 파싱 실패)',
            })),
          };
          if (parsed.selected.length === 0) throw new Error('AI 응답에서 index 추출 실패');
          addBudgetLog('⚠️', `JSON 1차 파싱 실패 → index/similarity 직접 추출 (${parsed.selected.length}건)`);
        }

        const rawResult = (parsed?.selected || []);
        const seenIdx = new Set();   // AI가 같은 index를 중복 반환하는 경우 방어
        const result = rawResult
          .map(s => {
            const idx = parseInt(s.index);
            if (isNaN(idx) || seenIdx.has(idx)) return null;
            seenIdx.add(idx);
            const item = candidatePool[idx];
            if (!item) return null;
            // 복사본을 만들어 원본 items 배열의 무결성 유지 (부수효과 방지)
            const newItem = { ...item };
            const similarity = Number(s.similarity);
            newItem.similarity = Number.isFinite(similarity) ? Math.max(0, Math.min(100, Math.round(similarity))) : null;
            newItem.similaritySource = newItem.similarity === null ? 'ai_unscored' : 'ai';
            newItem.aiReason = s.reason || 'AI 분석 기반 선정';
            return newItem;
          })
          .filter(Boolean);
        
        // [SAFETY] AI가 아무것도 선택하지 않았거나 형식이 틀린 경우 폴백
        if (result.length === 0) {
          console.warn('[Budget AI] Empty selection, falling back');
          throw new Error('AI가 유효한 유사 과제를 선정하지 못했습니다.');
        }

        // AI 선정 건수가 3건 미만이면 budget>0 항목으로 보충
        if (result.length < 3) {
          const selectedPjtIds = new Set(result.map(i => i.pjtId).filter(Boolean));
          const supplement = items
            .filter(i => i.annualBudget > 0 && !selectedPjtIds.has(i.pjtId))
            .slice(0, 3 - result.length)
            .map(item => ({ ...item, similarity: null, similaritySource: 'fallback', aiReason: '키워드 관련성 기반 보충 선정' }));
          if (supplement.length > 0) {
            const aiCount = result.length;
            result.push(...supplement);
            addBudgetLog('📌', `AI 선정 ${aiCount}건 + 통계 보충 ${supplement.length}건 = 총 ${result.length}건`);
          }
        }

        addBudgetLog('✅', `AI 유사과제 ${result.length}건 선정 완료`);
        return result;
      } catch (err) {
        addBudgetLog('⚠️', `AI 평가 오류 (${err.message}) → 통계 기반으로 대체`);
        // budget > 0 항목 우선 선택 (API 응답 순서 의존 방지)
        const topN = [...items]
          .filter(item => item.annualBudget > 0)
          .sort((a, b) => budgetLexicalRelevance(projName, b) - budgetLexicalRelevance(projName, a))
          .slice(0, 12)
          .map(item => ({ ...item, similarity: null, similaritySource: 'fallback', aiReason: '키워드 관련성 기반 선정 (AI 오류 폴백)' }));
        return topN;
      }
    }

    // ── Step 5: 최종 예산 산출 ───────────────────────────────────

    const BUDGET_ESC_RATE = 0.03;
    const BUDGET_ESC_CAP  = 12;

    // ── 연구과제 규모 프리셋 ─────────────────────────────────────
    // 규모는 임의 배수가 아니라 "실제 유사 NTIS 과제 분포 내 기준 구간"으로 연동한다.
    //   소형 → 하위분위(보수적) / 중형 → 중상위(절사평균·Q3) / 대형 → 상위분위(연구단급)
    const BUDGET_SCALES = {
      small:  { key:'small',  label:'소형 과제', short:'소형', desc:'중소기업 지원 · 연구범위/목표 작음',
                note:'유사 과제 분포의 35백분위와 20~50백분위 범위를 사용' },
      medium: { key:'medium', label:'중형 과제', short:'중형', desc:'일반 국가R&D · 표준 규모',
                note:'유사 과제 분포의 중앙값과 25~75백분위 범위를 사용' },
      large:  { key:'large',  label:'대형 과제', short:'대형', desc:'연구단 규모 · 목표 원대/범위 포괄적',
                note:'유사 과제 분포의 75백분위와 50~90백분위 범위를 사용' },
    };
    let _budgetScale    = 'medium';           // 현재 선택된 규모
    let _budgetPhase    = 'ALL';               // 비교할 연구개발단계
    let _budgetLastRun  = null;                // { projName, finalItems, distItems } — 재수집 없이 재산출용
    let _budgetRunSeq   = 0;                   // 늦게 끝난 이전 요청이 최신 결과를 덮지 않도록 하는 실행 번호
    let _budgetRerunTimer = null;
    let _budgetActiveProject = '';

    function scheduleBudgetRerun(reason) {
      const queryForm = document.getElementById('budgetQueryForm');
      if (queryForm && !queryForm.classList.contains('hidden')) return;
      const projName = _budgetLastRun?.projName || _budgetActiveProject;
      if (!projName) return;
      if (_budgetRerunTimer) clearTimeout(_budgetRerunTimer);
      _budgetRunSeq++; // 진행 중인 이전 조건의 결과를 즉시 무효화
      budgetLog.push({ icon: '🔁', msg: reason });
      _budgetRerunTimer = setTimeout(() => runBudgetEstimation(projName), 300);
    }

    // 분석 이력이 있으면 NTIS 재검색 없이 산출·표시만 다시 한다 (규모 변경)
    function _recomputeBudgetDisplay(logMsg) {
      if (!(_budgetLastRun && Array.isArray(_budgetLastRun.finalItems) && _budgetLastRun.finalItems.length)) return;
      const dist = _budgetLastRun.distItems && _budgetLastRun.distItems.length
        ? _budgetLastRun.distItems : _budgetLastRun.finalItems;
      const range = calcBudgetRange(dist, _budgetScale, _budgetLastRun.finalItems);
      if (!range) return;
      if (_budgetLastRun.filterSummary) range.filterSummary = _budgetLastRun.filterSummary;
      if (logMsg) budgetLog.push({ icon: '🔁', msg: logMsg });
      renderBudgetDashboard(_budgetLastRun.projName, _budgetLastRun.finalItems, range);
    }

    // 규모 버튼 클릭 → 선택 갱신 + (분석 이력 있으면) 즉시 재산출
    function setBudgetScale(key) {
      if (!BUDGET_SCALES[key]) key = 'medium';
      _budgetScale = key;
      document.querySelectorAll('#budgetScaleBar .budget-scale-btn').forEach(b => {
        b.classList.toggle('is-active', b.dataset.scale === key);
      });
      _recomputeBudgetDisplay(`과제 규모 변경 → ${BUDGET_SCALES[key].short} 기준 재산출`);
    }

    function setBudgetPhase(phase) {
      _budgetPhase = ['기초', '응용', '개발'].includes(phase) ? phase : 'ALL';
      scheduleBudgetRerun(`연구개발단계 변경 → ${_budgetPhase === 'ALL' ? '전체' : _budgetPhase} 과제를 다시 수집`);
    }

    // statItems = 연구비 분포 통계 산출용 과제 풀(많을수록 안정적)
    // aiItems   = AI 유사도 가중평균/유사도 표시용 대표 과제(없으면 statItems 사용)
    function calcBudgetRange(statItems, scaleKey = _budgetScale, aiItems = null) {
      return BudgetCore.calculateBudgetEstimate(statItems, {
        scaleKey,
        aiItems,
        annualRate: BUDGET_ESC_RATE,
      });
    }

    // ── 결과 대시보드 렌더링 ─────────────────────────────────────
    function toggleBudgetMore(button) {
      const table = button.closest('.budget-table-shell');
      if (!table) return;
      const expanded = button.getAttribute('aria-expanded') === 'true';
      table.querySelectorAll('.budget-extra-row').forEach(row => row.classList.toggle('hidden', expanded));
      button.setAttribute('aria-expanded', String(!expanded));
      button.querySelector('.budget-more-label').textContent = expanded ? '더 보기' : '접기';
      button.querySelector('iconify-icon').setAttribute('icon', expanded ? 'solar:alt-arrow-down-linear' : 'solar:alt-arrow-up-linear');
    }

    function renderBudgetDashboard(projName, selectedItems, budgetRange) {
      // null 체크 — runBudgetEstimation에서 이미 처리되므로 여기서는 조용히 리턴
      if (!budgetRange) return;

      // ── 신뢰도 등급 UI 설정 ─────────────────────────────────────
      const confidenceCfg = {
        A: { label: '신뢰도 높음',  color: '#16a34a', bg: '#f0fdf4', border: '#bbf7d0', icon: 'solar:shield-check-bold-duotone' },
        B: { label: '신뢰도 보통',  color: '#b45309', bg: '#fffbeb', border: '#fde68a', icon: 'solar:shield-warning-bold-duotone' },
        C: { label: '근거 제한 — 참고용', color: '#b91c1c', bg: '#fef2f2', border: '#fecaca', icon: 'solar:shield-cross-bold-duotone' },
      };
      const cf = confidenceCfg[budgetRange.confidence];

      // ── 신뢰도 경고 배너 ────────────────────────────────────────
      const warningBanners = [];
      if (budgetRange.n < 5) {
        warningBanners.push(`⚠️ 표본 ${budgetRange.n}건 — 통계적 대표성이 낮습니다. 검색어를 더 일반화하거나 연구개발단계 필터를 '전체 단계'로 완화해 재시도하세요.`);
      } else if (budgetRange.n < 12) {
        warningBanners.push(`ℹ️ 표본 ${budgetRange.n}건 — 원 검색결과가 아니라 유효 연구비·기간·연구개발단계·관련성 정제를 통과한 계산 표본입니다.`);
      }
      if (budgetRange.n < 12 && budgetRange.filterSummary) {
        const fs = budgetRange.filterSummary;
        const phaseLabel = fs.rndPhase && fs.rndPhase !== 'ALL' ? `${fs.rndPhase}연구` : '전체 단계';
        warningBanners.push(`검색 ${fs.keywords}개 키워드 · 원수집 ${fs.raw}건 → 유효 연구비/IQR ${fs.cleaned}건 → 계산 ${fs.dist}건 (${phaseLabel}, 기간 필터 없음).`);
      }
      // 연구비 분포 폭은 결과를 막는 경고가 아니라 대표값 해석을 돕는 보조 진단으로 표시한다.
      const cvRounded = Math.round(budgetRange.cv);
      const cvCfg = budgetRange.cv >= 120
        ? { tone: 'high', label: '매우 큼', note: '이기종 과제 혼재 가능성. 권장 범위와 유사과제를 함께 확인하세요.' }
        : budgetRange.cv >= 80
          ? { tone: 'medium', label: '다소 큼', note: '단일 대표값보다 권장 범위를 함께 해석하세요.' }
          : { tone: 'low', label: '참고 범위', note: '대표값 해석에 큰 제약은 낮습니다.' };
      const cvDiagnostic = `
        <div class="budget-diagnostic-title">분포 편차</div>
        <div class="budget-diagnostic-main">
          <strong class="budget-diagnostic-badge is-${cvCfg.tone}">${cvCfg.label}</strong>
          <span>변동계수 ${cvRounded}%</span>
        </div>
        <div class="budget-diagnostic-copy">${cvCfg.note}</div>`;
      if (budgetRange.avgSimilarity !== null && budgetRange.avgSimilarity < 65) {
        warningBanners.push(`⚠️ AI 유사도 평균 ${budgetRange.avgSimilarity}점 — 유사과제 매칭 품질이 낮습니다. 과제명을 구체적으로 입력해 주세요.`);
      }
      if (budgetRange.sourceQuality < 0.6) {
        warningBanners.push(`⚠️ 연구비 원자료 품질 ${Math.round(budgetRange.sourceQuality * 100)}점 — 당해연도 연구비보다 기간 미상 총액 비중이 높습니다.`);
      }
      if (budgetRange.periodCompleteness < 0.6) {
        warningBanners.push(`⚠️ 수행기간 완결성 ${Math.round(budgetRange.periodCompleteness * 100)}% — 연간 환산 오차 가능성이 있습니다.`);
      }
      const warningHTML = warningBanners.length
        ? `<div class="budget-warning" role="status">
            ${warningBanners.map(w => `<div>${w}</div>`).join('')}
           </div>`
        : '';

      // ── 과제 테이블 ─────────────────────────────────────────────
      // projNm에는 NTIS 검색 하이라이트 태그(<span class="search_word">)가 포함될 수 있으므로 제거
      const stripTags = (html) => (html || '').replace(/<[^>]*>/g, '');

      const tableHTML = selectedItems.map((item, itemIndex) => {
        const projectYears = Number(item.projYrs);
        const projectYearsLabel = Number.isFinite(projectYears)
          ? projectYears.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1')
          : '';
        const simDisplay = item.similarity !== null
          ? `<div style="font-size:0.75rem; font-weight:600; color:#374151; white-space:nowrap;">${item.similarity}점</div>
             <div class="budget-score-bar"><div class="budget-score-fill" style="width:${item.similarity}%"></div></div>`
          : `<div style="font-size:0.7rem; color:#9ca3af; white-space:nowrap;">AI 미평가</div>`;
        const sourceTag = item.budgetSource === 'current_year'
          ? `<span style="font-size:0.65rem; color:#f59e0b; background:#fffbeb; border:1px solid #fde68a; border-radius:3px; padding:1px 4px; margin-left:4px;">당해연도</span>`
          : String(item.budgetSource || '').includes('period_unknown')
          ? `<span style="font-size:0.65rem; color:#b91c1c; background:#fef2f2; border:1px solid #fecaca; border-radius:3px; padding:1px 4px; margin-left:4px;">기간미상 총액</span>`
          : item.budgetSource === 'merged_year_median'
          ? `<span title="연차·공동수행기관 ${item.mergedCount}개 레코드를 1개 과제로 병합 — 연간 연구비는 연도별 합산액의 중앙값" style="font-size:0.65rem; color:#7c3aed; background:#f5f3ff; border:1px solid #ddd6fe; border-radius:3px; padding:1px 4px; margin-left:4px;">병합 ${item.mergedCount}건</span>`
          : item.budgetSource === 'government_annualized'
          ? `<span style="font-size:0.65rem; color:#6b7280; background:#f3f4f6; border:1px solid #d1d5db; border-radius:3px; padding:1px 4px; margin-left:4px;">정부연구비 환산</span>`
          : '';

        const cleanNm = escHtml(stripTags(item.projNm) || '-');
        const ntisUrl = item.ntisPjtId
          ? `https://www.ntis.go.kr/project/pjtInfo.do?pjtId=${encodeURIComponent(item.ntisPjtId)}&pageCode=TH_PJT_PJT_DTL`
          : '';
        const nameCell = ntisUrl
          ? `<a href="${ntisUrl}" target="_blank" rel="noopener"
               style="font-weight:600; color:var(--accent); text-decoration:none;"
               onmouseover="this.style.textDecoration='underline';"
               onmouseout="this.style.textDecoration='none';"
               title="NTIS 상세 보기">${cleanNm}
               <iconify-icon icon="solar:arrow-right-up-linear" width="11" style="color:#9ca3af; vertical-align:middle; margin-left:2px;"></iconify-icon>
             </a>`
          : `<span style="font-weight:600; color:var(--accent);">${cleanNm}</span>`;

        const org    = escHtml(stripTags(item.perfOrg) || '-');
        const reason = escHtml(item.aiReason || '-');

        return `
        <tr class="${itemIndex >= 3 ? 'budget-extra-row hidden' : ''}">
          <td><div style="display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; line-height:1.4; max-width:300px;">${nameCell}</div></td>
          <td style="white-space:nowrap; font-weight:700; color:var(--accent);">${fmtBudget(item.annualBudget)}${sourceTag}</td>
          <td style="white-space:nowrap; color:#6b7280;">${item.prdStart || '?'}~${item.prdEnd || '?'}${projectYearsLabel ? ` (${projectYearsLabel}년)` : ''}</td>
          <td><span style="display:inline-block; max-width:120px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom;" title="${escAttr(stripTags(item.perfOrg) || '')}">${org}</span></td>
          <td style="white-space:nowrap;">${simDisplay}</td>
          <td><span style="display:inline-block; max-width:200px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; vertical-align:bottom; font-size:0.75rem; color:#6b7280;" title="${escAttr(item.aiReason || '')}">${reason}</span></td>
        </tr>`;
      }).join('');
      const extraItemCount = Math.max(0, selectedItems.length - 3);
      const moreItemsHTML = extraItemCount > 0
        ? `<button type="button" class="budget-more-btn" aria-expanded="false" onclick="toggleBudgetMore(this)">
             <iconify-icon icon="solar:alt-arrow-down-linear" width="15"></iconify-icon>
             <span class="budget-more-label">더 보기</span>
             <span class="budget-more-count">${extraItemCount}건</span>
           </button>`
        : '';

      const logHTML = budgetLog.map(l =>
        `<div class="budget-log-line"><span class="budget-log-icon">${l.icon}</span><span>${escHtml(l.msg)}</span></div>`
      ).join('');

      // ── KPI 3종 (중복 없이 핵심만) ───────────────────────────────
      const benchmarkKpi = { label: '표본 중앙값', value: fmtBudget(budgetRange.empiricalMedian), sub: '규모 시나리오 적용 전 비교 기준' };
      const similarityKpi = budgetRange.weightedAvg !== null
        ? { label: 'AI 유사도 가중평균', value: fmtBudget(budgetRange.weightedAvg), sub: `실제 AI 평가 ${budgetRange.aiN || 0}건만 반영` }
        : null;
      const rangeKpi = budgetRange.n >= 10
        ? { label: '규모 시나리오 권장 범위', value: `${fmtBudget(budgetRange.q1)} ~ ${fmtBudget(budgetRange.q3)}`, sub: budgetRange.scaleNote }
        : { label: '참고 범위 (Min~Max)', value: `${fmtBudget(budgetRange.min)} ~ ${fmtBudget(budgetRange.max)}`, sub: `표본 ${budgetRange.n}건 — 참고용` };
      const spreadKpi = { label: '전체 분포 (Min~Max)', value: `${fmtBudget(budgetRange.min)} ~ ${fmtBudget(budgetRange.max)}`, sub: budgetRange.escApplied ? '유효 과제 전체 범위 (현재가치 보정)' : '유효 과제 전체 범위' };
      const kpiCard = (k) =>
        `<div class="budget-kpi-card" style="text-align:left;">
           <div class="budget-kpi-label">${k.label}</div>
           <div class="budget-kpi-value" style="font-size:1.15rem;">${k.value}</div>
           <div class="budget-kpi-sub">${k.sub}</div>
         </div>`;
      const totalKpi = '';
      const simChip = budgetRange.avgSimilarity !== null
        ? `<span class="budget-chip">유사도 평균 ${budgetRange.avgSimilarity}점</span>` : '';

      // ── 규모 3종 래더 — 소/중/대 제안값을 한눈에 비교 (클릭 시 전환) ──
      const distForLadder = (_budgetLastRun && Array.isArray(_budgetLastRun.distItems) && _budgetLastRun.distItems.length)
        ? _budgetLastRun.distItems : selectedItems;
      const ladder = ['small', 'medium', 'large'].map(k => {
        const r = calcBudgetRange(distForLadder, k, selectedItems);
        return r ? { k, label: BUDGET_SCALES[k].short, v: r.median } : null;
      }).filter(Boolean);
      const activeScale = budgetRange.scaleKey || 'medium';
      const ladderHtml = ladder.length === 3 ? `
        <div class="budget-ladder">
          ${ladder.map(l =>
            `<button type="button" class="budget-ladder-chip ${l.k === activeScale ? 'is-active' : ''}"
               onclick="setBudgetScale('${l.k}')" title="${BUDGET_SCALES[l.k].note}">
               ${l.label} ${fmtBudget(l.v)}</button>`).join('')}
          <span style="font-size:0.7rem; color:#9ca3af; align-self:center;">← 규모 클릭 시 즉시 전환</span>
        </div>` : '';

      // ── 분포 스트립 — 보정 후 과제 연구비를 로그 스케일 점으로 표시 ──
      let distHtml = '';
      const vals = budgetRange.values || [];
      if (vals.length >= 5 && vals[vals.length - 1] > vals[0] * 1.05) {
        const lo = vals[0], hi = vals[vals.length - 1];
        const pos = v => Math.max(0, Math.min(100, (Math.log(v) - Math.log(lo)) / (Math.log(hi) - Math.log(lo)) * 100)).toFixed(1);
        const dots = vals.map(v => `<span class="bd-dot" style="left:${pos(v)}%" title="${fmtBudget(v)}"></span>`).join('');
        const marker = (v, label, cls) =>
          `<span class="bd-marker ${cls}" style="left:${pos(v)}%"><i></i><em>${label}</em></span>`;
        distHtml = `
          <div class="budget-section-title">
            <iconify-icon icon="solar:chart-square-bold-duotone" width="17" style="color:#111;"></iconify-icon>
            연구비 분포 <span class="muted">· ${vals.length}건 ${budgetRange.escApplied ? '· 현재가치 보정' : ''} · 로그 스케일</span>
          </div>
          <div class="budget-dist">
            ${dots}
            ${marker(budgetRange.q1, '하한', 'q')}
            ${marker(Math.min(budgetRange.median, hi), '제안', 'main')}
            ${marker(budgetRange.q3, '상한', 'q')}
          </div>
          <div class="budget-dist-axis"><span>${fmtBudget(lo)}</span><span>${fmtBudget(hi)}</span></div>`;
      }

      // ── 방법론·가정 섹션 ─────────────────────────────────────────
      const methodHtml = `
        <details class="budget-method">
          <summary>📐 산출 방법·가정 보기</summary>
          <ol>
            <li><strong>수집</strong> — AI 최적화 키워드(+상위 도메인 앵커·과제명 분절 폴백)로 NTIS 과제 수집 (15년 이내 · 과제번호 중복 제거)</li>
            <li><strong>연간 정규화</strong> — 당해연도 연구비 우선, 없으면 총·정부연구비를 실제 수행월수로 연간화 (기간 미상 총액은 저신뢰 표본)</li>
            <li><strong>동일 과제 병합</strong> — NTIS는 다년 과제의 연차별·공동수행기관별 레코드에 과제번호를 따로 부여해 같은 과제가 과다 반영됩니다. <strong>과제명</strong>으로 묶어 1과제=1표본으로 병합하고(후속 연차가 다른 사업으로 편성돼도 통합), 대표 연간 연구비는 <strong>연도별 합산(같은 연도 공동수행기관 몫 합산)→그 합산액의 중앙값</strong>으로 산출합니다.</li>
            <li><strong>현재가치 보정</strong> — 수행 중간연도 기준 연 ${(BUDGET_ESC_RATE * 100).toFixed(0)}% 상승률로 올해 가치 환산 (최대 ${BUDGET_ESC_CAP}년)</li>
            <li><strong>정제</strong> — 수행기간은 필터로 쓰지 않고 연간 환산에만 사용. 유효 표본 8건 이상일 때 IQR×1.5 이상치 제거(표본 급감 시 ×3 완화) + 관련성 게이트</li>
            <li><strong>AI 유사도 평가</strong> — 연구비를 숨긴 채 기술 55% / 규모·단계 30% / 최신성 15%로 대표 과제 선정</li>
            <li><strong>규모 시나리오</strong> — 소형 35백분위(20~50) / 중형 중앙값(25~75) / 대형 75백분위(50~90), 임의 배수 없음</li>
            <li><strong>분포 로그 스케일</strong> — 연구비는 소액 과제가 다수이고 대형 과제는 소수여서 오른쪽 꼬리가 긴 분포(right-skew)입니다. 선형 축으로 점을 찍으면 대부분이 왼쪽 끝에 뭉치고 대형 과제 몇 건만 멀리 떨어져 보여 판독이 어렵습니다. 로그 스케일은 <strong>배수(비율) 차이를 같은 간격</strong>으로 표시(1억→10억과 10억→100억이 동일 간격)하므로, 중앙 밀집 구간과 대형 과제를 한 화면에서 함께 읽을 수 있습니다.</li>
          </ol>
          <p>※ 가정: 연 ${(BUDGET_ESC_RATE * 100).toFixed(0)}% 연구비 상승률. 유사과제 표의 '연간 연구비'는 원자료이며, 분포 통계·시나리오 기준값은 현재가치 보정 반영값입니다.</p>
        </details>`;

      document.getElementById('budgetResultContent').innerHTML = `
        <!-- 핵심 요약 (사이트 모노크롬 헤더 밴드) -->
        <div class="budget-hero">
          <div class="budget-hero-eyebrow">${escHtml(projName)} · ${budgetRange.scaleLabel || '중형'} 과제 · 연간 비교기준 예산</div>
          <div class="budget-hero-value">${fmtBudget(budgetRange.median)}</div>
          <div class="budget-hero-chips">
            <span class="budget-chip"><span class="dot" style="background:${cf.color};"></span>${cf.label}</span>
            <span class="budget-chip">근거 품질 ${budgetRange.confidenceScore}점</span>
            <span class="budget-chip">표본 ${budgetRange.n}건</span>
            ${simChip}
          </div>
          <div class="budget-hero-diagnostic">${cvDiagnostic}</div>
        </div>

        ${ladderHtml}

        ${warningHTML}

        <!-- 핵심 지표 -->
        <div class="budget-kpi-grid" style="margin-bottom:0.5rem;">
          ${kpiCard(rangeKpi)}
          ${kpiCard(benchmarkKpi)}
          ${similarityKpi ? kpiCard(similarityKpi) : ''}
          ${kpiCard(spreadKpi)}
          ${totalKpi}
        </div>

        ${distHtml}

        <!-- 산출 근거 -->
        <div class="budget-section-title">
          <iconify-icon icon="solar:lightbulb-bold-duotone" width="17" style="color:#111;"></iconify-icon>
          산출 근거 및 해석
        </div>
        <div class="budget-note">
          최근 15년 내 NTIS 유효 연구비 과제 <strong>${budgetRange.n}건</strong>을
          ${budgetRange.escApplied ? `현재가치 보정(연 ${(budgetRange.escRate * 100).toFixed(0)}%)하고 ` : ''}표본 수에 따라 IQR 이상치 기준을 적용해 분석했습니다.
          <strong>${budgetRange.scaleLabel || '중형'} 과제</strong> 기준(${budgetRange.scaleNote || '유사 과제 분포의 중앙·평균 구간'})으로
          연간 <strong>${fmtBudget(budgetRange.median)}</strong>을 비교기준 예산으로 제시합니다.
          ${budgetRange.n >= 10
            ? `권장 범위 <strong>${fmtBudget(budgetRange.q1)} ~ ${fmtBudget(budgetRange.q3)}</strong> 내에서 과제 특성에 맞게 조정하세요.`
            : `표본이 적어 권장 범위보다 <strong>${fmtBudget(budgetRange.min)} ~ ${fmtBudget(budgetRange.max)}</strong>를 참고 범위로 활용하세요.`}
          ${budgetRange.weightedAvg !== null ? ` AI 가중평균(<strong>${fmtBudget(budgetRange.weightedAvg)}</strong>)과 제안값 차이가 크면 이상치 가능성을 검토하세요.` : ''}
        </div>

        <!-- 대표 유사과제 -->
        <div class="budget-section-title">
          <iconify-icon icon="solar:ranking-bold-duotone" width="17" style="color:#111;"></iconify-icon>
          대표 유사과제 ${budgetRange.weightedAvg !== null ? 'AI 선정' : '통계 기반'} Top-${selectedItems.length}
          <span class="muted">· 연구비 분포는 전체 ${budgetRange.n}건 기준</span>
        </div>
        <div class="budget-table-shell">
          <div style="overflow-x:auto;">
          <table class="budget-table">
            <thead>
              <tr>
                <th>과제명</th><th>연간 연구비</th><th>수행기간</th><th>수행기관</th><th>유사도</th><th>선정 사유</th>
              </tr>
            </thead>
            <tbody>${tableHTML}</tbody>
          </table>
          </div>
          ${moreItemsHTML}
        </div>

        ${methodHtml}

        <details style="margin-top:1.25rem;">
          <summary style="font-size:0.8125rem; font-weight:600; color:#6b7280; cursor:pointer;">🔍 분석 프로세스 로그 보기</summary>
          <div class="budget-process-log" style="margin-top:0.6rem;">${logHTML}</div>
        </details>

        <p class="budget-disclaimer">
          * 본 결과는 NTIS 공개 과제 데이터 기반 참고 자료이며, 공식 예산 심의 근거로 단독 활용은 지양해 주세요.
        </p>
      `;

      document.getElementById('budgetProgressArea').classList.add('hidden');
      _mountBudgetInline(); // 결과를 인라인 영역에 유지

      // 보고서 생성을 위해 결과 저장
      _budgetReportData = { projName, selectedItems, budgetRange };
    }

    // Removed: report draft modal is no longer part of the UI.
    function generateBudgetReportText({ projName, selectedItems, budgetRange }) {
      const today = new Date();
      const dateStr = `${today.getFullYear()}년 ${today.getMonth()+1}월 ${today.getDate()}일`;
      const br = budgetRange;
      const stripTags = (s) => (s || '').replace(/<[^>]*>/g, '');

      const confidenceLabel = { A: 'A등급 (근거 품질 높음)', B: 'B등급 (근거 품질 보통)', C: 'C등급 (근거 제한 — 참고용)' };

      // 근거 과제 표
      const tableRows = selectedItems.map((item, i) => {
        const nm   = stripTags(item.projNm || '-').substring(0, 40);
        const org  = stripTags(item.perfOrg || '-').substring(0, 12);
        const period = item.prdStart && item.prdEnd ? `${item.prdStart}~${item.prdEnd}` : '기간미상';
        const budget = fmtBudget(item.annualBudget);
        const sim  = item.similarity !== null ? `${item.similarity}점` : 'AI미평가';
        const reason = (item.aiReason || '-').replace(/\n/g, ' ').substring(0, 50);
        return `  ${String(i+1).padStart(2)}. ${nm.padEnd(40)} | ${budget.padEnd(10)} | ${period.padEnd(12)} | ${org.padEnd(12)} | ${sim.padEnd(7)} | ${reason}`;
      }).join('\n');

      const rangeDesc = br.n >= 10
        ? `${br.scaleLabel} 시나리오 권장 범위: ${fmtBudget(br.q1)} ~ ${fmtBudget(br.q3)} (표본 ${br.n}건 기준)`
        : `참고 범위(Min~Max): ${fmtBudget(br.min)} ~ ${fmtBudget(br.max)} (표본 ${br.n}건, 통계적 신뢰도 제한)`;

      const weightedDesc = br.weightedAvg !== null
        ? `AI 유사도 가중평균: ${fmtBudget(br.weightedAvg)} (유사도 점수 반영)`
        : `AI 유사도 가중평균: 미산출 (AI 미평가 또는 유효 점수 없음)`;

      return `
■ 신규과제 적정 연구개발비 산출 보고서
${'='.repeat(64)}
□ 분석 과제명: ${projName}
□ 분석 일시  : ${dateStr}
□ 데이터 출처: 국가과학기술지식정보서비스(NTIS) 공개 과제 DB
□ 분석 방법  : NTIS 통계 기반 + AI 하이브리드 5단계 파이프라인 (v2)

${'─'.repeat(64)}
1. 분석 방법 및 절차
${'─'.repeat(64)}

본 분석은 NTIS(국가과학기술지식정보서비스) 공개 과제 데이터를
활용한 5단계 하이브리드 파이프라인으로 수행되었습니다.

  [Step 1] AI 키워드 추출 및 후보 확보
    - 과제명에서 핵심 기술 키워드를 AI(LLaMA 기반)가 추출
    - NTIS 과제명(projNm) 필드 대상 복수 쿼리 실행
    - 목표 후보: 30~50건 확보

  [Step 2] 정책 메타데이터 필터링
    - 최근 15년 이내 과제로 한정
    - 연구개발단계 선택 시 동일 단계 과제로 동질성 강화
    - 수행기간은 표본 필터가 아니라 연간 연구비 정규화에만 사용

  [Step 3] 연간 예산 정규화 + IQR 이상치 제거
    - 당해연도 연구비 우선, 없으면 총·정부연구비 ÷ 실제 수행월수로 연간 환산
    - 연구비 누락 과제 제외, 유효 표본 8건 이상일 때 IQR × 1.5 적용
    - 제거 후 표본이 5건 미만이면 IQR × 3으로 완화

  [Step 4] AI 3차원 유사도 평가 (과제명 기반·연구비 비노출)
    - 연구비 금액을 AI 입력에서 제외하여 예산값에 의한 선택 편향 방지
    - 기술적 유사성  55% : 연구 목표·핵심 기술·방법론 일치도
    - 규모·범위 적합 30% : TRL 단계, 성과물 유형 유사도
    - 최신성·정책 부합 15% : 최근 과제 우선, 정책 방향 부합

  [Step 5] 최종 적정 연구비 산출
    - 규모 시나리오: 소형 35백분위 / 중형 중앙값 / 대형 75백분위
    - 가중평균 : AI 유사도 점수를 가중치로 반영
    - 범위     : 규모별 인접 백분위 구간 (소형 20~50 / 중형 25~75 / 대형 50~90)

${'─'.repeat(64)}
2. 산출 결과
${'─'.repeat(64)}

  ○ 연간 비교기준 예산 (${br.scaleLabel} 시나리오) : ${fmtBudget(br.median)}
  ○ ${rangeDesc}
  ○ ${weightedDesc}

  [분석 품질 지표]
  ○ 유효 표본 수   : ${br.n}건
  ○ 근거 품질 등급 : ${confidenceLabel[br.confidence] || br.confidence} (${br.confidenceScore}점)
  ○ 원자료 품질    : ${Math.round(br.sourceQuality * 100)}점
  ○ 기간 완결성    : ${Math.round(br.periodCompleteness * 100)}%
  ○ 변동계수(CV)   : ${Math.round(br.cv)}% ${br.cv >= 80 ? '⚠ 편차 높음 — 이기종 과제 혼재 가능' : '(참고 범위)'}
  ${br.avgSimilarity !== null ? `○ AI 유사도 평균  : ${br.avgSimilarity}점 ${br.avgSimilarity < 65 ? '⚠ 유사도 낮음' : ''}` : '○ AI 유사도 평균  : AI 미평가'}

${'─'.repeat(64)}
3. 근거 과제 목록 (유사과제 Top-${selectedItems.length})
${'─'.repeat(64)}

  No. 과제명                                     | 연간연구비   | 수행기간      | 수행기관      | 유사도   | 선정 사유(요약)
  ${'─'.repeat(120)}
${tableRows}

${'─'.repeat(64)}
4. 해석 및 활용 방안
${'─'.repeat(64)}

  ○ 비교기준 예산: ${fmtBudget(br.median)}/년
     위 값은 선택한 규모 시나리오의 백분위 기준값이며,
     과제 고유 특성(신규 장비 구축, 대규모 실증 등)을 감안하여
     ${rangeDesc.split('범위:').pop().trim()} 내에서 조정하는 것을 권장합니다.

  ○ 총 연구비 편성 참고값
     본 모듈은 연간 비교기준 예산을 산출합니다. 총 연구비는 실제 사업기간,
     장비·실증·인건비 투입 곡선에 맞춰 별도 편성하시기 바랍니다.

  ○ 유의 사항
     - 변동계수 ${Math.round(br.cv)}%: ${br.cv >= 80 ? '편차가 높아 단일 대표값 사용 시 주의가 필요합니다.' : '분포 폭은 결과 해석 시 보조 지표로 사용합니다.'}
     - 표본 ${br.n}건, 원자료 품질·기간 완결성·유사도 평가를 합산한 근거 품질은 ${br.confidenceScore}점(${br.confidence}등급)입니다.
     - 본 결과는 NTIS 공개 데이터 기반 참고 자료입니다.
       공식 예산 심의 시 추가적인 전문가 검토를 병행하시기 바랍니다.

${'─'.repeat(64)}
5. 근거 자료 출처
${'─'.repeat(64)}

  - 데이터: 국가과학기술지식정보서비스(NTIS) 통합검색 오픈 API
    (https://www.ntis.go.kr)
  - 분석 도구: ScienceON NTIS 검색 시스템 내 적정 연구비 산출 모듈
  - 분석 기준일: ${dateStr}
  - AI 엔진: Cerebras LLaMA (키워드 추출·유사도 평가)

${'='.repeat(64)}
※ 본 보고서는 NTIS 공개 과제 데이터를 기반으로 자동 생성된
   참고 자료입니다. 최종 예산 편성 시 관련 부처 지침 및 내부
   심의 기준을 우선 적용하시기 바랍니다.
${'='.repeat(64)}
`.trim();
    }

    // ── 메인 진입점 ───────────────────────────────────────────────
    async function runBudgetEstimation(projName) {
      const runSeq = ++_budgetRunSeq;
      _budgetActiveProject = projName;
      const rndPhase       = _budgetPhase;
      const bizSect        = "ALL";

      const runBtn = document.getElementById('runBtn');
      if (runBtn) {
        runBtn.disabled = true;
        runBtn.innerHTML = '<span class="spinner" style="width:16px;height:16px;border-width:2px;display:inline-block;"></span> 분석 중...';
      }

      // 로그 초기화 + 진행 바 표시
      budgetLog = [];
      document.getElementById('budgetResultContent').innerHTML = '';
      document.getElementById('budgetProgressArea').classList.remove('hidden');
      document.getElementById('budgetProcessLog').innerHTML = '';
      setBudgetStep(1);

      try {
        // ── Step 0: AI 연구내용 시놉시스 생성 ──────────────────
        addBudgetLog('🤖', 'Step 0: 과제명 기반 핵심 연구내용 유추 중...');
        const aiSynopsis = await generateResearchSynopsis(projName);
        if (runSeq !== _budgetRunSeq) return;
        addBudgetLog('📝', `유추된 연구내용: ${aiSynopsis}`);

        // ── Step 1: AI 키워드 추출 ──────────────────────────────
        addBudgetLog('🤖', 'Step 1: AI 키워드 최적화 시작...');
        const keywords = await extractKeywordsForBudget(projName, aiSynopsis);
        if (runSeq !== _budgetRunSeq) return;
        addBudgetLog('✅', `추출된 키워드: ${keywords.join(', ')}`);

        // ── Step 2: NTIS 과제 수집 (3단계 Fallback 전략) ───────────
        setBudgetStep(2);
        addBudgetLog('📡', 'Step 2: NTIS 과제 데이터 수집 시작 (1단계: AI 키워드)');
        let rawItems = await fetchNTISForBudget(keywords, rndPhase, bizSect);
        if (runSeq !== _budgetRunSeq) return;
        
        // 2단계: 수동 분절 검색 (AI 결과가 부족할 때)
        if (rawItems.length < 5) {
          addBudgetLog('⚠️', '결과가 부족합니다. 2단계: 과제명 핵심어 분절 검색을 시도합니다...');
          const fallbackKeywords = extractKeywordsManual(projName);
          const secondItems = await fetchNTISForBudget(fallbackKeywords, rndPhase, bizSect);
          if (runSeq !== _budgetRunSeq) return;
          
          // 중복 제거 및 합치기
          const seenIds = new Set(rawItems.map(i => i.pjtId));
          secondItems.forEach(item => {
            if (!seenIds.has(item.pjtId)) {
              rawItems.push(item);
              seenIds.add(item.pjtId);
            }
          });
        }

        // 3단계: 초광역 검색 (데이터가 정말 없을 때)
        if (rawItems.length === 0) {
          addBudgetLog('⚠️', '여전히 데이터가 없습니다. 3단계: 연도 필터를 완화하여 초광역 검색을 시도합니다...');
          // 일반 동사 대신 가장 정보량이 큰 핵심 토큰 하나로 넓게 검색한다.
          const broadStop = new Set(['개발','연구','고도화','구축','플랫폼','시스템','기반','기술','사업','과제']);
          const broadToken = projName.split(/[\s,·/()_-]+/)
            .filter(word => word.length >= 2 && !broadStop.has(word))
            .sort((a, b) => b.length - a.length)[0];
          const superBroadKeywords = [broadToken || projName.trim()];
          rawItems = await fetchNTISForBudget(superBroadKeywords, 'ALL', 'ALL', 100);
          if (runSeq !== _budgetRunSeq) return;
        }

        if (rawItems.length === 0) {
          showToast('모든 검색 시도에도 불구하고 NTIS 과제를 찾지 못했습니다. 과제명을 더 일반적인 용어로 수정해보세요.', 'warning');
          if (runBtn) {
            runBtn.disabled = false;
            runBtn.innerHTML = '<iconify-icon icon="solar:calculator-bold-duotone" width="18"></iconify-icon> 분석 시작';
          }
          document.getElementById('budgetProgressArea').classList.add('hidden');
          return;
        }

        // ── Step 2.5: 동일 과제(연차·공동수행기관 분할) 병합 ─────
        rawItems = collapseByProject(rawItems);

        // ── Step 3: IQR 이상치 제거 ─────────────────────────────
        setBudgetStep(3);
        addBudgetLog('📊', 'Step 3: 연간 정규화 + IQR 이상치 제거...');
        const cleanedItems = normalizeAndClean(rawItems);

        // 연구비가 없는 원본을 다시 넣으면 근거 없는 금액을 만들게 되므로 즉시 중단한다.
        const effectiveItems = cleanedItems;
        if (cleanedItems.length === 0) {
          addBudgetLog('❌', '유효한 연구비 표본이 없습니다. 임의 기본값은 생성하지 않습니다.');
          showToast('유효 연구비 데이터가 없어 산출을 중단했습니다. 과제명을 조정해 다시 검색해 주세요.', 'warning');
          return;
        }

        // ── Step 4: AI 유사도 평가 ──────────────────────────────────────────
        setBudgetStep(4);
        addBudgetLog('🔬', 'Step 4: AI 3차원 유사도 평가 시작...');
        const selectedItems = await aiSimilarityEval(projName, effectiveItems);
        if (runSeq !== _budgetRunSeq) return;

        // Guard: AI/통계 선정 후에도 0건이면 직접 상위 7건 선택
        const finalItems = selectedItems.length > 0
          ? selectedItems
          : effectiveItems.filter(i => i.annualBudget > 0).slice(0, 7);
        if (selectedItems.length === 0) {
          addBudgetLog('⚠️', 'AI/통계 선정 실패 → budget > 0 항목 상위 7건 직접 사용');
          finalItems.forEach(item => { item.similarity = null; item.similaritySource = 'fallback'; item.aiReason = '직접 선정 (폴백)'; });
        }

        // ── Step 5: 최종 예산 산출 ───────────────────────────────────────────────
        setBudgetStep(5);
        addBudgetLog('💰', 'Step 5: 중앙값·가중평균·범위 산출...');

        // 연구비 분포 통계는 IQR 정제된 "전체 과제 풀"(budget>0)로 산출 → 표본이 클수록 안정적.
        // AI가 고른 finalItems는 대표 유사과제(표시·가중평균)로만 사용한다.
        let statBase = effectiveItems.filter(i => i.annualBudget > 0);

        // 관련성 게이트: 폴백 광역 검색(첫 단어 등)으로 유입된 무관 과제가
        // 분포를 오염시키지 않도록, 과제명·초록에 입력 핵심어가 하나도 없는
        // 항목은 (관련 표본이 충분할 때만) 분포에서 제외한다.
        const _gateStop = ['개발','연구','고도화','구축','플랫폼','시스템','기반','기술','사업','과제'];
        const coreTokens = projName.split(/[\s,·/()]+/).filter(w => w.length >= 2 && !_gateStop.includes(w));
        if (coreTokens.length) {
          const isRelevant = (it) => {
            const hay = ((it.projNm || '') + ' ' + (it.absContent || '').substring(0, 300)).toLowerCase();
            return coreTokens.some(t => hay.includes(t.toLowerCase()));
          };
          const relevant = statBase.filter(isRelevant);
          if (relevant.length >= 8 && relevant.length < statBase.length) {
            addBudgetLog('🧹', `관련성 게이트: 핵심어 무관 ${statBase.length - relevant.length}건을 분포에서 제외 (${relevant.length}건 유지)`);
            statBase = relevant;
          }
        }

        const useBroad = statBase.length >= 5;            // 충분하면 광범위 분포 사용
        const distItems = useBroad ? statBase : finalItems;
        addBudgetLog('📈', useBroad
          ? `연구비 분포 산출 대상: ${statBase.length}건 (AI 대표 ${finalItems.length}건 포함)`
          : `연구비 데이터 부족 → AI 대표 ${finalItems.length}건으로 산출`);

        let budgetRange = calcBudgetRange(distItems, _budgetScale, finalItems);

        // 산출 실패 → effectiveItems 직접 재시도
        if (!budgetRange && effectiveItems.length > 0) {
          addBudgetLog('⚠️', '산출 실패 → effectiveItems 직접 사용 (폴백)');
          const fallbackItems = effectiveItems.filter(i => i.annualBudget > 0);
          if (fallbackItems.length > 0) budgetRange = calcBudgetRange(fallbackItems, _budgetScale, finalItems);
        }

        console.log('[Budget Final] Range:', budgetRange);

        if (!budgetRange) {
          addBudgetLog('❌', '예산 산출 실패 — 수집된 과제의 연구비 데이터가 없거나 부족합니다');
          showToast('유사 과제를 찾지 못했습니다. 검색어나 필터 조건을 조정해보세요.', 'warning');
          return;
        }

        budgetRange.filterSummary = {
          raw: rawItems.length,
          cleaned: cleanedItems.length,
          dist: distItems.length,
          keywords: keywords.length,
          rndPhase,
        };
        if (budgetRange.n < 12) {
          addBudgetLog('ℹ️', `표본 축소 진단: 원수집 ${rawItems.length}건 → 유효 연구비/IQR ${cleanedItems.length}건 → 계산 표본 ${budgetRange.n}건`);
        }

        addBudgetLog('🎉', `분석 완료! ${budgetRange.scaleLabel} 시나리오 연간 비교기준: ${fmtBudget(budgetRange.median)}`);
        // 규모 변경 시 NTIS 재검색 없이 재산출할 수 있도록 수집·평가 결과를 보관
        _budgetLastRun = { projName, finalItems, distItems, filterSummary: budgetRange.filterSummary };
        renderBudgetDashboard(projName, finalItems, budgetRange);

      } catch (err) {
        console.error('[Budget]', err);
        showToast('분석 오류: ' + err.message, 'error');
        addBudgetLog('❌', '오류: ' + err.message);
        document.getElementById('budgetProgressArea').classList.add('hidden');
      } finally {
        if (runSeq !== _budgetRunSeq) return;
        const btn = document.getElementById('runBtn');
        if (btn) {
          btn.disabled = false;
          btn.innerHTML = '<iconify-icon icon="solar:calculator-bold-duotone" width="16"></iconify-icon> 분석 시작';
        }
      }
    }

    // ============================================================
    // Feature 2: 클라이언트 사이드 정렬
    // ============================================================

    function renderInsightsBar() {
      const sortBar = document.getElementById('sortBar');
      if (sortBar) sortBar.classList.remove('hidden');
      document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
      const defaultBtn = document.querySelector('.sort-btn[data-sort=""]');
      if (defaultBtn) defaultBtn.classList.add('active');
      renderKeywordCloud();
    }

    function applyClientSort(criterion) {
      document.querySelectorAll('.sort-btn').forEach(b => {
        b.classList.toggle('active', b.dataset.sort === criterion);
      });
      const cards = Array.from(document.querySelectorAll('#resultsGrid .result-card, #resultsGrid .scienceon-result-row'));
      if (cards.length === 0) return;
      const sorted = cards.slice().sort((a, b) => {
        if (criterion === 'year-desc') return (parseInt(b.dataset.year) || 0) - (parseInt(a.dataset.year) || 0);
        if (criterion === 'year-asc')  return (parseInt(a.dataset.year) || 0) - (parseInt(b.dataset.year) || 0);
        if (criterion === 'title')     return (a.dataset.title || '').localeCompare(b.dataset.title || '', 'ko');
        return 0;
      });
      const grid = document.getElementById('resultsGrid');
      sorted.forEach(card => grid.appendChild(card));
    }

    // ============================================================
    // Feature 4+5: 연도별/기관별 분포 차트
    // ============================================================

    let _yearChart = null;
    let _instChart = null;

    function showYearInstCharts() {
      if (!STATE.currentItems || STATE.currentItems.length === 0) {
        showToast('먼저 검색을 실행해주세요', 'warning');
        return;
      }

      // 연도 분포 집계
      const yearFreq = {};
      STATE.currentItems.forEach(item => {
        const y = (item.year || '').substring(0, 4);
        if (y && /^\d{4}$/.test(y)) yearFreq[y] = (yearFreq[y] || 0) + 1;
      });
      const yearLabels = Object.keys(yearFreq).sort();
      const yearData = yearLabels.map(y => yearFreq[y]);

      // 기관 분포 집계
      const instFreq = {};
      STATE.currentItems.forEach(item => {
        const text = item.publisher || item.authors || '';
        const parts = text.split(/[·;,|]/);
        const inst = (parts[0] || '').trim().replace(/\s+/g, ' ').substring(0, 25);
        if (inst && inst.length > 1) instFreq[inst] = (instFreq[inst] || 0) + 1;
      });
      const instEntries = Object.entries(instFreq).sort((a, b) => b[1] - a[1]).slice(0, 8);

      // 모달 표시
      const modal = document.getElementById('analyticsModal');
      if (!modal) return;
      modal.classList.remove('hidden');
      document.getElementById('analyticsQuery').textContent =
        '"' + STATE.currentQuery + '" — ' + STATE.currentItems.length + '건 기준';

      // 기존 차트 파괴
      if (_yearChart) { _yearChart.destroy(); _yearChart = null; }
      if (_instChart) { _instChart.destroy(); _instChart = null; }

      // 연도 차트
      const yearWrap = document.getElementById('yearChartWrap');
      if (yearWrap) yearWrap.innerHTML = '<canvas id="yearChartCanvas"></canvas>';
      const yearCtx = document.getElementById('yearChartCanvas');
      if (yearCtx && yearLabels.length > 0) {
        _yearChart = new Chart(yearCtx, {
          type: 'bar',
          data: {
            labels: yearLabels,
            datasets: [{ label: '건수', data: yearData, backgroundColor: 'rgba(59,130,246,0.75)', borderRadius: 4 }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: { y: { beginAtZero: true, ticks: { stepSize: 1 } } }
          }
        });
      } else if (yearWrap) {
        yearWrap.innerHTML = '<p class="text-xs text-gray-400 text-center py-8">연도 데이터 없음</p>';
      }

      // 기관 차트
      const instWrap = document.getElementById('instChartWrap');
      if (instWrap) instWrap.innerHTML = '<canvas id="instChartCanvas"></canvas>';
      const instCtx = document.getElementById('instChartCanvas');
      if (instCtx && instEntries.length > 0) {
        const COLORS = ['#3b82f6','#10b981','#f59e0b','#ef4444','#8b5cf6','#06b6d4','#f97316','#84cc16'];
        _instChart = new Chart(instCtx, {
          type: 'doughnut',
          data: {
            labels: instEntries.map(e => e[0]),
            datasets: [{ data: instEntries.map(e => e[1]), backgroundColor: COLORS.slice(0, instEntries.length), borderWidth: 2, borderColor: '#fff' }]
          },
          options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { font: { size: 10 }, boxWidth: 12, padding: 6 } } }
          }
        });
      } else if (instWrap) {
        instWrap.innerHTML = '<p class="text-xs text-gray-400 text-center py-8">기관 데이터 없음</p>';
      }
    }

    function closeAnalyticsModal() {
      const modal = document.getElementById('analyticsModal');
      if (modal) modal.classList.add('hidden');
    }

    // ============================================================
    // Feature 6: 연관 키워드 클라우드
    // ============================================================

    function renderKeywordCloud() {
      const container = document.getElementById('keywordCloud');
      if (!container) return;
      if (!STATE.currentItems || STATE.currentItems.length === 0) {
        container.innerHTML = '';
        return;
      }
      const freq = {};
      STATE.currentItems.forEach(item => {
        if (!item.keywords) return;
        item.keywords.split(/[;,|]/).map(k => k.trim()).filter(k => k && k.length > 1 && k.length < 30).forEach(k => {
          const key = k.toLowerCase();
          if (!freq[key]) freq[key] = { display: k, count: 0 };
          freq[key].count++;
        });
      });
      const top = Object.values(freq)
        .filter(e => e.display.toLowerCase() !== (STATE.currentQuery || '').toLowerCase())
        .sort((a, b) => b.count - a.count)
        .slice(0, 15);
      if (top.length === 0) { container.innerHTML = ''; return; }
      const maxCount = top[0].count;
      container.innerHTML = top.map(({ display, count }) => {
        const sz = count === maxCount ? 'text-sm font-bold' : count >= maxCount * 0.6 ? 'text-xs font-semibold' : 'text-xs';
        const op = count >= maxCount * 0.6 ? '' : 'opacity-70';
        return `<button type="button" class="keyword-cloud-tag ${sz} ${op}" onclick="setSearchAndGo('${escAttr(display)}')" title="${escAttr(display)} (${count}건)">${escHtml(display)}<span class="text-[10px] opacity-50 ml-0.5">${count}</span></button>`;
      }).join('');
    }

    // ============================================================
    // Feature 11: 저자명 클릭 → 연구자 검색
    // ============================================================

    function renderAuthorLinks(authors, query) {
      if (!authors) return '';
      const auList = authors.split(/[;,|]/).map(a => a.trim()).filter(Boolean);
      const display = auList.slice(0, 3);
      const extra = auList.length > 3 ? ` <span class="text-tertiary">외 ${auList.length - 3}명</span>` : '';
      const hl = (text) => {
        if (!text || !query) return escHtml(text);
        return escHtml(text).replace(new RegExp(`(${escRegex(query)})`, 'gi'), '<mark>$1</mark>');
      };
      return display.map(a =>
        `<span class="author-link" onclick="event.stopPropagation();searchByAuthor('${escAttr(a)}')" title="${escAttr(a)} 연구자 검색">${hl(a)}</span>`
      ).join(', ') + extra;
    }

    function searchByAuthor(name) {
      if (!name) return;
      document.getElementById('searchInput').value = name;
      if (!STATE.currentTarget.startsWith('NTIS_')) {
        const btn = document.querySelector('#tabsScienceON [data-target="RESEARCHER"]');
        if (btn) {
          document.querySelectorAll('#tabsScienceON .tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          STATE.currentTarget = 'RESEARCHER';
        }
      }
      doSearch();
    }
