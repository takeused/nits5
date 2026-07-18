/**
 * ScienceON + NTIS 로컬 프록시 서버
 * 포트: 3737
 * 실행: node proxy-server.js
 * 접속: http://127.0.0.1:3737  (로컬)
 *       http://<내PC_IP>:3737  (인트라넷)
 */
const http   = require('http');
const https  = require('https');
const crypto = require('crypto');
const url    = require('url');
const fs     = require('fs');
const path   = require('path');
const zlib   = require('zlib');

// 의존성 없이 로컬 .env를 읽는다. 이미 설정된 프로세스 환경변수는 덮어쓰지 않는다.
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
  for (const rawLine of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || !line.includes('=')) continue;
    const idx = line.indexOf('=');
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

// ── 정적 파일 서빙 (인트라넷 접속용) ────────────────────────────
const STATIC_ROOT = __dirname;
const MIME_TYPES  = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.ico':  'image/x-icon',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.svg':  'image/svg+xml',
  '.md':   'text/plain; charset=utf-8',
};

const PORT      = Number(process.env.PORT || 3737);
const API_HOST  = 'apigateway.kisti.re.kr';
const NTIS_HOST = 'www.ntis.go.kr';
const FIXED_IV  = 'jvHJ1EFA0IXBrxxz';
// Gemini 모델명은 .env의 GEMINI_MODEL로 덮어쓸 수 있다(모델 개편 시 코드 수정 불필요).
const GEMINI_DEFAULT_MODEL = 'gemini-3.1-flash-lite';

// ── .env 로더 (의존성 없이 KEY=VALUE 파싱, 소스에 비밀값을 넣지 않기 위함) ──
// 프로젝트 폴더의 .env 파일을 읽어 아직 설정되지 않은 환경변수만 주입한다.
(function loadDotEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith('#')) continue;
      const key = m[1];
      const val = m[2].trim().replace(/^["']|["']$/g, '');
      if (process.env[key] === undefined) process.env[key] = val;
    }
    console.log('[.env] 로드됨');
  } catch { /* .env 없거나 읽기 실패 시 무시 */ }
})();

// ── 서버 환경변수 자격증명 (인트라넷 다중 PC 지원) ────────────────
const REGISTERED = {
  clientId: process.env.SC_CLIENT_ID || '',
  apiKey:   process.env.SC_API_KEY   || '',
  macAddr:  process.env.SC_MAC_ADDR  || '',
};

// ── 암호화 유틸 ──────────────────────────────────────────────
// ScienceON 게이트웨이가 기대하는 정확한 AES 방식이 환경에 따라 달라,
// 여러 변형(IV 종류 × IV 프리펜드 여부 × base64 형식)을 정의해두고
// probe가 실제로 토큰이 발급되는 방식을 자동으로 찾는다.
// 변형 키 형식: <ivKind>|<prepend>|<b64>
//   ivKind   : 'fixed'(고정 IV) | 'key16'(인증키 앞 16바이트)
//   prepend  : 'pre'(IV||ct) | 'noPre'(ct만)
//   b64      : 'std'(표준 base64) | 'url'(URL-safe base64)
function aesEncryptVariant(plaintext, keyStr, variant) {
  const [ivKind, prepend, b64] = variant.split('|');
  const key = Buffer.from(keyStr, 'utf8');
  const iv  = ivKind === 'key16'
    ? Buffer.from(keyStr.slice(0, 16), 'utf8')
    : Buffer.from(FIXED_IV, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const enc    = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const out    = prepend === 'pre' ? Buffer.concat([iv, enc]) : enc;
  let s = out.toString('base64');
  if (b64 === 'url') s = s.replace(/\+/g, '-').replace(/\//g, '_');
  return s;
}

// 시도 우선순위: 실측으로 확인된 정답(고정 IV · 프리펜드 없음 · URL-safe base64)을 가장 먼저.
// (이 client_id/인증키 조합에서 KISTI가 실제로 토큰을 발급하는 방식)
const ENC_VARIANTS = [
  'fixed|noPre|url',   // ✅ 실측 정답 — 고정 IV, 프리펜드 없음, URL-safe base64
  'key16|noPre|url',
  'fixed|noPre|std',
  'key16|noPre|std',
  'fixed|pre|std',     // 구버전(고정 IV 프리펜드) — E4006 유발
  'key16|pre|std',
];

// 기존 호출 호환용: 가장 유력한 표준 방식으로 암호화
function aesEncryptOfficial(plaintext, keyStr) {
  return aesEncryptVariant(plaintext, keyStr, ENC_VARIANTS[0]);
}

function nowDatetime14() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

// ── HTTPS 요청 헬퍼 ─────────────────────────────────────────
function httpsGet(hostname, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname, path, method: 'GET',
      rejectUnauthorized: false,
      headers: { 'User-Agent': 'ScienceON-LocalProxy/1.0', Accept: '*/*', ...headers },
    }, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({
        status: res.statusCode,
        body: Buffer.concat(chunks).toString('utf-8'),
        headers: res.headers,
      }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function httpsPostJSON(hostname, requestPath, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname,
      path: requestPath,
      method: 'POST',
      rejectUnauthorized: true,
      headers: {
        'User-Agent': 'ScienceON-LocalProxy/2.0',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, upstream => {
      const chunks = [];
      upstream.on('data', chunk => chunks.push(chunk));
      upstream.on('end', () => resolve({
        status: upstream.statusCode,
        body: Buffer.concat(chunks).toString('utf8'),
        headers: upstream.headers,
      }));
    });
    req.on('error', reject);
    req.setTimeout(60000, () => req.destroy(new Error('AI timeout')));
    req.end(body);
  });
}

function readJSONBody(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

// ── CORS 헤더 ───────────────────────────────────────────────
function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization,Accept,Origin');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
}

function sendJSON(res, status, obj) {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

// ── 정적 자산 인메모리 캐시 + gzip 사전압축 ──────────────────────
// 파일을 1회 읽어 raw·gzip·ETag를 메모리에 보관하고, mtime/size 변경 시에만 갱신.
// → 반복 로드 시 디스크 재읽기·재압축 없이 즉시 응답하고, 조건부 요청은 304로 처리.
const STATIC_CACHE = new Map();                 // filePath -> { mtimeMs, size, etag, raw, gzip, ext }
const GZIP_EXTS    = new Set(['.html', '.js', '.css', '.svg', '.md']);

function loadStatic(filePath) {
  const stat   = fs.statSync(filePath);         // 없으면 throw → 404 처리
  const cached = STATIC_CACHE.get(filePath);
  if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached;

  const raw  = fs.readFileSync(filePath);
  const ext  = path.extname(filePath);
  const etag = `"${stat.size.toString(16)}-${Math.round(stat.mtimeMs).toString(16)}"`;
  let gzip = null;
  if (GZIP_EXTS.has(ext) && raw.length > 1024) {
    try { gzip = zlib.gzipSync(raw, { level: 6 }); } catch { /* 압축 실패 시 원본 사용 */ }
  }
  const entry = { mtimeMs: stat.mtimeMs, size: stat.size, etag, raw, gzip, ext };
  STATIC_CACHE.set(filePath, entry);
  return entry;
}

function serveStatic(req, res, pathname) {
  const filePath = path.join(STATIC_ROOT, pathname === '/' ? 'index.html' : pathname);
  if (!filePath.startsWith(STATIC_ROOT)) { res.writeHead(403); res.end('Forbidden'); return; }

  let entry;
  try { entry = loadStatic(filePath); }
  catch { res.writeHead(404); res.end('Not found: ' + pathname); return; }

  setCORS(res);
  // 캐시 정책: vendor/(라이브러리) 등 거의 불변 자산은 장기 캐시,
  //           앱 파일(html/js/css)은 재검증(no-cache + ETag → 변경 없으면 304)
  const cacheCtl = pathname.startsWith('/vendor/')
    ? 'public, max-age=604800'                  // 7일
    : 'no-cache';

  // 조건부 요청 → 304 (본문 전송 생략)
  if (req.headers['if-none-match'] === entry.etag) {
    res.writeHead(304, { 'ETag': entry.etag, 'Cache-Control': cacheCtl });
    res.end();
    return;
  }

  const headers = {
    'Content-Type': MIME_TYPES[entry.ext] || 'application/octet-stream',
    'Cache-Control': cacheCtl,
    'ETag': entry.etag,
  };

  const acceptsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (entry.gzip && acceptsGzip) {
    headers['Content-Encoding'] = 'gzip';
    headers['Vary'] = 'Accept-Encoding';
    res.writeHead(200, headers);
    res.end(entry.gzip);
  } else {
    res.writeHead(200, headers);
    res.end(entry.raw);
  }
}

function sendRaw(res, status, body, contentType) {
  setCORS(res);
  res.writeHead(status, { 'Content-Type': contentType });
  res.end(body);
}

function parseJSONSafe(text) {
  try {
    return JSON.parse(text);
  } catch {
    return {
      error: 'UPSTREAM_INVALID_JSON',
      bodyPreview: String(text || '').slice(0, 1000),
    };
  }
}

function tokenHTTPStatus(upstreamStatus, data) {
  if (data && data.access_token) return 200;
  return upstreamStatus >= 400 ? upstreamStatus : 400;
}

async function requestScienceONToken(clientId, accounts) {
  const path = `/tokenrequest.do?accounts=${encodeURIComponent(accounts)}&client_id=${encodeURIComponent(clientId)}`;
  const upstream = await httpsGet(API_HOST, path);
  const data = parseJSONSafe(upstream.body);
  if (data.error === 'UPSTREAM_INVALID_JSON') data.upstreamStatus = upstream.status;
  return { upstream, data };
}

// ── 메인 서버 ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const q        = parsed.query;

  // OPTIONS preflight
  if (req.method === 'OPTIONS') {
    setCORS(res);
    res.writeHead(204);
    res.end();
    return;
  }

  // ── 정적 파일 서빙 (/, /index.html, /js/*, /css/*) ──────────
  const staticExts = ['.html', '.js', '.css', '.ico', '.png', '.jpg', '.svg', '.md'];
  const isStatic   = pathname === '/' || staticExts.some(e => pathname.endsWith(e));
  if (isStatic && !pathname.startsWith('/token') && !pathname.startsWith('/api')
               && !pathname.startsWith('/ntis') && !pathname.startsWith('/health')
               && !pathname.startsWith('/myip')) {
    return serveStatic(req, res, pathname);
  }

  console.log(`[${new Date().toISOString()}] ${req.method} ${pathname}`);

  try {
    // ── /health
    if (pathname === '/health') {
      return sendJSON(res, 200, {
        status: 'ok',
        service: 'ScienceON Local Proxy',
        port: PORT,
        aiConfigured: Boolean(process.env.CEREBRAS_API_KEY || process.env.GEMINI_API_KEY),
        cerebrasConfigured: Boolean(process.env.CEREBRAS_API_KEY),
        geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
        geminiModel: process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL,
        scienceOnConfigured: Boolean(REGISTERED.clientId && REGISTERED.apiKey && REGISTERED.macAddr),
        ntisConfigured: Boolean(process.env.NTIS_API_KEY),
      });
    }

    // ── /cerebras — API 키를 브라우저에 노출하지 않는 서버 측 AI 프록시
    if (pathname === '/cerebras') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST required' });
      const apiKey = process.env.CEREBRAS_API_KEY || '';
      if (!apiKey) return sendJSON(res, 503, { error: 'CEREBRAS_API_KEY is not configured on the server' });
      const payload = await readJSONBody(req);
      const upstream = await httpsPostJSON('api.cerebras.ai', '/v1/chat/completions', payload, {
        Authorization: `Bearer ${apiKey}`,
      });
      return sendRaw(res, upstream.status, upstream.body, 'application/json; charset=utf-8');
    }

    // ── /gemini — Cerebras가 막혔을 때 쓰는 대체 AI 경로.
    // Google의 OpenAI 호환 엔드포인트를 사용하므로 요청·응답 형식이 /cerebras와 동일해
    // 프론트엔드는 호출 주소만 바꾸면 된다.
    if (pathname === '/gemini') {
      if (req.method !== 'POST') return sendJSON(res, 405, { error: 'POST required' });
      const apiKey = process.env.GEMINI_API_KEY || '';
      if (!apiKey) return sendJSON(res, 503, { error: 'GEMINI_API_KEY is not configured on the server' });
      const payload = await readJSONBody(req);
      // 모델명은 서버가 정한다(브라우저가 보낸 Cerebras 모델명을 그대로 쓰면 404).
      payload.model = process.env.GEMINI_MODEL || GEMINI_DEFAULT_MODEL;
      delete payload.reasoning_effort;   // Gemini 호환 엔드포인트가 인식하지 못하는 필드
      const upstream = await httpsPostJSON('generativelanguage.googleapis.com',
        '/v1beta/openai/chat/completions', payload, {
          Authorization: `Bearer ${apiKey}`,
        });
      return sendRaw(res, upstream.status, upstream.body, 'application/json; charset=utf-8');
    }

    // ── /myip
    if (pathname === '/myip') {
      const r = await httpsGet('api.ipify.org', '/?format=json');
      const ip = parseJSONSafe(r.body).ip;
      return sendJSON(res, 200, { ip, note: '로컬 프록시 발신 IP (내 PC의 공인 IP)' });
    }

    // ── /token
    if (pathname === '/token') {
      const { accounts } = q;

      // 인트라넷 다중 PC 지원: 서버 등록 자격증명을 우선 사용하고,
      // 없을 때만 클라이언트가 보낸 값으로 폴백한다.
      const client_id   = REGISTERED.clientId || q.client_id;
      const api_key     = REGISTERED.apiKey   || q.api_key;
      const mac_address = REGISTERED.macAddr  || q.mac_address;

      // 클라이언트가 직접 암호화한 accounts를 보낸 경우는 그대로 전달
      // (단, 서버 등록값이 있으면 무시하고 서버가 새로 암호화 — 잘못된 MAC 방지)
      if (accounts && client_id && !REGISTERED.macAddr) {
        const { upstream, data } = await requestScienceONToken(client_id, accounts);
        return sendJSON(res, tokenHTTPStatus(upstream.status, data), { ...data, client_id });
      }

      if (!client_id || !api_key || !mac_address) {
        return sendJSON(res, 400, { error: 'client_id, api_key, mac_address 필요' });
      }
      if (api_key.length !== 32) {
        return sendJSON(res, 400, { error: `인증키(AES256)는 32자여야 합니다 (현재 ${api_key.length}자)` });
      }

      const datetime  = nowDatetime14();
      const plaintext = JSON.stringify({ mac_address, datetime }).replace(/ /g, '');
      const encrypted = aesEncryptOfficial(plaintext, api_key);
      const { upstream, data } = await requestScienceONToken(client_id, encrypted);
      return sendJSON(res, tokenHTTPStatus(upstream.status, data), { ...data, client_id });
    }

    if (pathname === '/token/probe') {
      const { client_id, api_key, mac_address } = q;
      if (!client_id || !api_key || !mac_address) {
        return sendJSON(res, 400, { error: 'client_id, api_key, mac_address ?꾩슂' });
      }

      const raw = String(mac_address);
      const compact = raw.replace(/[^0-9a-fA-F]/g, '').toUpperCase();
      const macCandidates = Array.from(new Set([
        raw,
        raw.toUpperCase(),
        raw.toLowerCase(),
        compact,
        compact.match(/.{1,2}/g)?.join('-'),
        compact.match(/.{1,2}/g)?.join(':'),
      ].filter(Boolean)));

      // 암호화 변형 × MAC 형식을 모두 시도하여 실제 발급되는 조합을 자동 탐색
      const results = [];
      for (const variant of ENC_VARIANTS) {
        for (const mac of macCandidates) {
          const datetime  = nowDatetime14();
          const plaintext = JSON.stringify({ mac_address: mac, datetime }).replace(/ /g, '');
          const accounts  = aesEncryptVariant(plaintext, api_key, variant);
          const { upstream, data } = await requestScienceONToken(client_id, accounts);
          const errorCode = data.errorCode || data.error_code || '';
          results.push({
            variant, mac,
            status: upstream.status,
            errorCode,
            errorMessage: data.errorMessage || data.message || data.error || '',
          });
          if (data.access_token) {
            return sendJSON(res, 200, { success: true, mac, enc: variant, ...data, results });
          }
          // E4107(MAC 불일치)/E4006(암호화) 외의 치명적 오류는 조기 중단
          // (E4102 잘못된 client_id, E4104 미승인 등은 조합을 더 시도해도 무의미)
          if (errorCode === 'E4102' || errorCode === 'E4104') {
            return sendJSON(res, 400, { success: false, fatal: errorCode, results });
          }
        }
      }

      return sendJSON(res, 400, { success: false, results });
    }

    // ── /token/refresh
    if (pathname === '/token/refresh') {
      const { client_id, refresh_token } = q;
      if (!client_id || !refresh_token) {
        return sendJSON(res, 400, { error: 'client_id, refresh_token 필요' });
      }
      const path = `/tokenrequest.do?refresh_token=${encodeURIComponent(refresh_token)}&client_id=${encodeURIComponent(client_id)}`;
      const r    = await httpsGet(API_HOST, path);
      return sendJSON(res, r.status, parseJSONSafe(r.body));
    }

    // ── /api  (ScienceON API Gateway)
    if (pathname === '/api') {
      const qs   = parsed.search || '';
      const path = `/openapicall.do${qs}`;
      const r    = await httpsGet(API_HOST, path);
      const isXml = r.body.trim().startsWith('<');
      return sendRaw(res, r.status, r.body, isXml ? 'application/xml; charset=utf-8' : 'text/plain');
    }

    // ── /ntis  (NTIS API)
    if (pathname === '/ntis') {
      const { apprvKey, collection, SRWR, searchWord, searchFd,
              startPosition, displayCnt, searchRnkn, addQuery, naviCount } = q;

      const serverKey = process.env.NTIS_API_KEY || apprvKey || '';
      if (!serverKey) return sendJSON(res, 400, { error: 'NTIS_API_KEY 환경변수 또는 apprvKey 파라미터 필요' });

      const params = new URLSearchParams();
      params.set('apprvKey', serverKey);
      const keyword = q.query || SRWR || searchWord;
      if (keyword) { params.set('SRWR', keyword); params.set('query', keyword); }
      let finalCollection = collection;
      if (collection === 'prjt')  finalCollection = 'project';
      if (collection === 'equip') finalCollection = 'equipment';
      if (finalCollection) params.set('collection', finalCollection);
      if (searchFd)      params.set('searchFd', searchFd);
      if (startPosition) params.set('startPosition', startPosition);
      if (displayCnt)    params.set('displayCnt', displayCnt);
      if (addQuery)      params.set('addQuery', addQuery);
      params.set('searchRnkn', searchRnkn || 'Y');
      params.set('naviCount',  naviCount  || '5');

      const ntisPath = `/rndopen/openApi/totalRstSearch?${params.toString()}`;
      const r = await httpsGet(NTIS_HOST, ntisPath, {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ScienceON-LocalProxy/1.0',
        'Accept': 'application/xml, text/xml, */*',
      });
      const isXml = r.body.trim().startsWith('<');
      return sendRaw(res, r.status, r.body, isXml ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8');
    }

    // ── /ntis/connection
    if (pathname === '/ntis/connection') {
      const { apprvKey, pjtId, collection, topN } = q;
      const serverKey = process.env.NTIS_API_KEY || apprvKey || '';
      if (!serverKey || !pjtId) return sendJSON(res, 400, { error: 'NTIS_API_KEY/apprvKey, pjtId 필요' });
      const params = new URLSearchParams({ apprvKey: serverKey, pjtId });
      if (collection) params.set('collection', collection);
      if (topN)       params.set('topN', topN);
      const r = await httpsGet(NTIS_HOST, `/rndopen/openApi/ConnectionContent?${params.toString()}`);
      return sendRaw(res, r.status, r.body, 'application/json; charset=utf-8');
    }

    return sendJSON(res, 404, { error: 'Not found', path: pathname });

  } catch (err) {
    console.error('[ERROR]', err.message);
    return sendJSON(res, 500, { error: err.message });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  // 인트라넷 IP 목록 출력
  const os = require('os');
  const nets = os.networkInterfaces();
  const ips = [];
  for (const iface of Object.values(nets)) {
    for (const addr of iface) {
      if (addr.family === 'IPv4' && !addr.internal) ips.push(addr.address);
    }
  }
  console.log(`\n✅ ScienceON 프록시 서버 시작 (포트 ${PORT})`);
  console.log(`   로컬:      http://127.0.0.1:${PORT}`);
  ips.forEach(ip => console.log(`   인트라넷:  http://${ip}:${PORT}  ← 같은 네트워크 PC에서 이 주소로 접속`));
  console.log(`\n   📂 정적 파일 서빙: http://<IP>:${PORT}/  → index.html 직접 제공`);
  console.log(`   🔔 NTIS 승인 IP: 1.252.84.41 (정박사님 PC)`);
  console.log(`   API: /health  /token  /api  /ntis  /ntis/connection\n`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n❌ 포트 ${PORT}이 이미 사용 중입니다. 기존 프로세스를 종료 후 재실행하세요.\n`);
  } else {
    console.error('[SERVER ERROR]', err);
  }
  process.exit(1);
});
