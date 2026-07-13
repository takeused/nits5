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
      aiConfigured: false,
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

    // 외부 프록시 (로컬 전용 운영 시 미사용 — 변수 참조 오류 방지용 선언)
    const VERCEL_BASE    = '';
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
