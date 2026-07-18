    // ============================================================
    // State & Constants
    // ============================================================

    const STATE = {
      clientId: '',
      token: '',
      refreshToken: '',
      tokenExpire: '',
      apiKey: '',
      macAddr: '',
      ntisKey: '',
      cerebrasKey: '',
      aiModelMode: localStorage.getItem('sc_ai_model_mode') || 'zai-glm-4.7',
      aiConfigured: false,
      cerebrasConfigured: undefined,  // /health 미제공(구버전 프록시) 시 undefined → Cerebras 시도
      geminiConfigured: false,
      scienceOnConfigured: false,
      ntisConfigured: false,
      currentTarget: 'ARTI',
      currentQuery: '',
      currentPage: 1,
      totalCount: 0,
      rowCount: 10,
      isLoading: false,
      advancedOpen: false,
      // 새 기능용
      searchHistory: JSON.parse(localStorage.getItem('sc_history') || '[]'),
      favorites: JSON.parse(localStorage.getItem('sc_favorites') || '[]'),
      currentItems: [],   // CSV 내보내기용 현재 결과 데이터
      compareMode: false,
    };

    // 인증정보는 소스에 포함하지 않는다. 로컬 프록시는 .env, Vercel은
    // 프로젝트 환경변수에서 읽는다.
    // Development-only browser configuration. Fill these values locally while
    // working on the site, then move them back to server environment variables
    // before publishing.
    const BROWSER_API_MODE = true;
    const BROWSER_API_CONFIG = Object.freeze({
      clientId: '',
      apiKey: '',
      macAddr: '',
      ntisKey: '',
      cerebrasKey: '',
    });
    const DEFAULTS = BROWSER_API_CONFIG;

    const NTIS_BASE = 'https://www.ntis.go.kr';

    // 로컬 프록시 (proxy-server.js, 포트 3737)
    // 같은 서버에서 HTML을 서빙받은 경우(인트라넷 포함) → 자동으로 해당 호스트 사용
    const PROXY_BASE = (() => {
      const { protocol, hostname, port } = window.location;
      if (/^https?:$/.test(protocol) && hostname && port) return `${protocol}//${hostname}:${port}`;
      return 'http://127.0.0.1:3737';                                 // 로컬 파일로 열었을 때
    })();
    const API_BASE_DIRECT  = 'https://apigateway.kisti.re.kr/openapicall.do';
    const TOKEN_URL_DIRECT = 'https://apigateway.kisti.re.kr/tokenrequest.do';

    // 외부 프록시 (터널) — 승인된 PC의 proxy-server.js를 https 터널(ngrok/Cloudflare)로
    // 노출한 주소. ScienceON/NTIS가 승인된 PC IP를 보게 되어 배포판에서도 검색이 동작한다.
    // 우선순위: URL 파라미터(?proxy=https://...) > localStorage('sc_proxy_url') > 기본값.
    // 기본값이 비어 있으면 같은 오리진(Vercel 서버리스 /health·/api …)으로 폴백한다.
    const TUNNEL_DEFAULT = ''; // 예: 'https://scienceon.ngrok-free.app'
    const VERCEL_BASE = (() => {
      const clean = (u) => (u || '').trim().replace(/\/+$/, '');
      try {
        const p = new URLSearchParams(location.search).get('proxy');
        if (p !== null) {
          const v = clean(p);
          if (v) { localStorage.setItem('sc_proxy_url', v); return v; }
          localStorage.removeItem('sc_proxy_url'); // ?proxy= (빈값) → 재설정 해제
        }
      } catch { /* location 접근 불가 시 무시 */ }
      const saved = clean(localStorage.getItem('sc_proxy_url'));
      return saved || clean(TUNNEL_DEFAULT);
    })();
    const CF_WORKER_BASE = 'https://YOUR_CF_SUBDOMAIN.workers.dev';

    // 현재 활성 프록시 ('local' | 'direct')
    let ACTIVE_PROXY = 'direct';
    Object.defineProperty(window, 'PROXY_AVAILABLE', {
      get() { return ACTIVE_PROXY !== 'direct'; },
      configurable: true,
    });

    function getProxyBase() {
      if (ACTIVE_PROXY === 'local')  return PROXY_BASE;
      if (ACTIVE_PROXY === 'vercel') return VERCEL_BASE;
      if (ACTIVE_PROXY === 'worker') return CF_WORKER_BASE;
      return null;
    }

    function getApiBase() {
      const base = getProxyBase();
      return base !== null ? `${base}/api` : API_BASE_DIRECT;
    }
