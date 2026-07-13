const http = require('http');
const https = require('https');
const crypto = require('crypto');

const API_HOST = 'apigateway.kisti.re.kr';
const NTIS_HOST = 'www.ntis.go.kr';
const FIXED_IV = 'jvHJ1EFA0IXBrxxz';

function aesEncryptOfficial(plaintext, keyStr) {
  const key = Buffer.from(keyStr, 'utf8');
  const iv  = Buffer.from(FIXED_IV, 'utf8');
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // ScienceON API expects IV prepended: IV(16) || ciphertext
  return Buffer.concat([iv, encrypted]).toString('base64');
}

function nowDatetime14() {
  const now = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}${p(now.getMonth()+1)}${p(now.getDate())}${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
}

function httpsGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: API_HOST,
      path,
      method: 'GET',
      headers: { 'User-Agent': 'ScienceON-VercelProxy/1.0', Accept: '*/*' },
    }, (res) => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => resolve({ status: res.statusCode, body: data, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('timeout')));
    req.end();
  });
}

function ntisGet(path) {
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: NTIS_HOST,
      path,
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ScienceON-VercelProxy/1.0',
        'Accept': 'application/xml, text/xml, */*',
        'Accept-Encoding': 'identity',
      },
    }, (res) => {
      let chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        resolve({ status: res.statusCode, body, headers: res.headers });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('NTIS timeout')));
    req.end();
  });
}

function httpsPostJSON(hostname, path, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const upstream = https.request({
      hostname, path, method: 'POST',
      headers: {
        'User-Agent': 'ScienceON-VercelProxy/2.0',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers,
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({ status: response.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    upstream.on('error', reject);
    upstream.setTimeout(60000, () => upstream.destroy(new Error('AI timeout')));
    upstream.end(body);
  });
}

async function tryTokenRequest(clientId, encryptedBase64) {
  const accounts = encodeURIComponent(encryptedBase64);
  const path = `/tokenrequest.do?accounts=${accounts}&client_id=${encodeURIComponent(clientId)}`;
  const result = await httpsGet(path);
  try {
    return JSON.parse(result.body);
  } catch {
    return { raw: result.body, status: result.status };
  }
}

function setCORS(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,Content-Type,Authorization,Accept,Origin');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Max-Age', '86400');
}

function jsonRes(res, statusCode, obj) {
  setCORS(res);
  res.status(statusCode).json(obj);
}

function setNoCache(res) {
  // Vercel Edge Network 및 브라우저 캐싱 완전 비활성화
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
}

module.exports = async (req, res) => {
  setCORS(res);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Vercel rewrites에 의해 원본 요청 URL이 req.url에 들어옴.
  // req.query 객체를 바로 활용 가능
  const pathname = req.url.split('?')[0];
  const q = req.query;

  // ── /health
  if (pathname === '/health') {
    return jsonRes(res, 200, {
      status: 'ok',
      service: 'ScienceON + NTIS Vercel Proxy (Seoul Region)',
      aiConfigured: Boolean(process.env.CEREBRAS_API_KEY),
      scienceOnConfigured: Boolean(process.env.SC_CLIENT_ID && process.env.SC_API_KEY && process.env.SC_MAC_ADDR),
      ntisConfigured: Boolean(process.env.NTIS_API_KEY),
    });
  }

  // ── /cerebras — 서버 환경변수 기반 AI 프록시
  if (pathname === '/cerebras') {
    if (req.method !== 'POST') return jsonRes(res, 405, { error: 'POST required' });
    const apiKey = process.env.CEREBRAS_API_KEY || '';
    if (!apiKey) return jsonRes(res, 503, { error: 'CEREBRAS_API_KEY is not configured on the server' });
    try {
      const result = await httpsPostJSON('api.cerebras.ai', '/v1/chat/completions', req.body || {}, {
        Authorization: `Bearer ${apiKey}`,
      });
      setCORS(res);
      setNoCache(res);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(result.status).send(result.body);
    } catch (e) {
      return jsonRes(res, 502, { error: e.message });
    }
  }

  // ── /myip — Vercel 서버 발신 IP 확인 (NTIS IP 등록용)
  if (pathname === '/myip') {
    try {
      const ip = await new Promise((resolve, reject) => {
        const req = https.request({
          hostname: 'api.ipify.org',
          path: '/?format=json',
          method: 'GET',
          headers: { 'User-Agent': 'ScienceON-VercelProxy/1.0' },
        }, (res) => {
          let data = '';
          res.on('data', c => { data += c; });
          res.on('end', () => {
            try { resolve(JSON.parse(data).ip); } catch { resolve(data.trim()); }
          });
        });
        req.on('error', reject);
        req.setTimeout(5000, () => req.destroy(new Error('timeout')));
        req.end();
      });
      return jsonRes(res, 200, {
        ip,
        note: 'NTIS IP 화이트리스트 등록 시 이 IP를 사용하세요. Vercel은 리전에 따라 IP가 다를 수 있습니다.',
        region: process.env.VERCEL_REGION || 'unknown',
      });
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  // ── /token
  if (pathname === '/token') {
    const { accounts } = q;
    const client_id = process.env.SC_CLIENT_ID || q.client_id;
    const api_key = process.env.SC_API_KEY || q.api_key;
    const mac_address = process.env.SC_MAC_ADDR || q.mac_address;
    
    // 워커와 동일하게 accounts 전송 방식 지원
    if (accounts && client_id) {
       try {
         const path = `/tokenrequest.do?accounts=${encodeURIComponent(accounts)}&client_id=${encodeURIComponent(client_id)}`;
         const result = await httpsGet(path);
         const data = JSON.parse(result.body);
          return jsonRes(res, data.access_token ? 200 : 400, { ...data, client_id });
       } catch (e) {
         return jsonRes(res, 500, { error: e.message });
       }
    }
    
    if (!client_id || !api_key || !mac_address) {
      return jsonRes(res, 400, { error: 'client_id, api_key, mac_address 필요' });
    }
    if (api_key.length !== 32) {
      return jsonRes(res, 400, { error: `api_key는 32자여야 합니다 (현재 ${api_key.length}자)` });
    }

    try {
      const datetime  = nowDatetime14();
      const plaintext = JSON.stringify({ mac_address, datetime }).replace(/ /g, '');
      const encrypted = aesEncryptOfficial(plaintext, api_key);
      const data = await tryTokenRequest(client_id, encrypted);
      return jsonRes(res, data.access_token ? 200 : 400, { ...data, client_id });
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  // ── /token/refresh
  if (pathname === '/token/probe') {
    const { client_id, api_key, mac_address } = q;
    if (!client_id || !api_key || !mac_address) {
      return jsonRes(res, 400, { error: 'client_id, api_key, mac_address required' });
    }
    if (api_key.length !== 32) {
      return jsonRes(res, 400, { error: `api_key must be 32 characters (current ${api_key.length})` });
    }

    try {
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

      const results = [];
      for (const mac of macCandidates) {
        const datetime = nowDatetime14();
        const plaintext = JSON.stringify({ mac_address: mac, datetime }).replace(/ /g, '');
        const encrypted = aesEncryptOfficial(plaintext, api_key);
        const data = await tryTokenRequest(client_id, encrypted);
        results.push({
          mac,
          status: data.status || 200,
          errorCode: data.errorCode || data.error_code || '',
          errorMessage: data.errorMessage || data.message || data.error || data.raw || '',
        });
        if (data.access_token) {
          return jsonRes(res, 200, { success: true, mac, enc: 'AES-256-CBC/Base64/URIEncoded', ...data, results });
        }
      }

      return jsonRes(res, 400, { success: false, results });
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  if (pathname === '/token/refresh') {
    const { client_id, refresh_token } = q;
    if (!client_id || !refresh_token) {
      return jsonRes(res, 400, { error: 'client_id, refresh_token 필요' });
    }
    try {
      const path = `/tokenrequest.do?refresh_token=${encodeURIComponent(refresh_token)}&client_id=${encodeURIComponent(client_id)}`;
      const result = await httpsGet(path);
      const data = JSON.parse(result.body);
      return jsonRes(res, result.status, data);
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  // ── /api
  if (pathname === '/api') {
    const queryStr = req.url.split('?')[1] || '';
    const apiPath = `/openapicall.do${queryStr ? '?' + queryStr : ''}`;
    try {
      const result = await httpsGet(apiPath);
      const isXml = result.body.trim().startsWith('<?xml') || result.body.trim().startsWith('<');
      setCORS(res);
      setNoCache(res); // 검색 결과 캐싱 비활성화 (토큰 보안 및 최신 데이터 보장)
      res.setHeader('Content-Type', isXml ? 'application/xml; charset=utf-8' : 'text/plain');
      return res.status(result.status).send(result.body);
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  // ── /ntis
  if (pathname === '/ntis') {
    const { apprvKey, collection, SRWR, searchWord, searchFd, startPosition, displayCnt, searchRnkn, addQuery, boostquery, naviCount } = q;
    const serverKey = process.env.NTIS_API_KEY || apprvKey || '';
    
    if (!serverKey) return jsonRes(res, 400, { error: 'NTIS_API_KEY 환경변수 또는 apprvKey 파라미터 필요' });

    const params = new URLSearchParams();
    params.set('apprvKey', serverKey);

    const keyword = q.query || SRWR || searchWord;
    if (keyword) {
      params.set('SRWR', keyword);
      params.set('query', keyword);
    }
    
    let finalCollection = collection;
    if (collection === 'prjt') finalCollection = 'project';
    if (collection === 'equip') finalCollection = 'equipment';
    if (finalCollection) params.set('collection', finalCollection);
    
    if (searchFd)      params.set('searchFd', searchFd);
    if (startPosition) params.set('startPosition', startPosition);
    if (displayCnt)    params.set('displayCnt', displayCnt);
    if (addQuery)      params.set('addQuery', addQuery);
    if (boostquery)    params.set('boostquery', boostquery);
    
    params.set('searchRnkn', searchRnkn || 'Y');
    params.set('naviCount', naviCount || '5');
    
    const ntisPath = `/rndopen/openApi/totalRstSearch?${params.toString()}`;
    
    try {
      const result = await ntisGet(ntisPath);
      const isXml = result.body.trim().startsWith('<?xml') || result.body.trim().startsWith('<');
      setCORS(res);
      setNoCache(res); // NTIS 검색 결과 캐싱 비활성화
      res.setHeader('Content-Type', isXml ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8');
      return res.status(result.status).send(result.body);
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  // ── /ntis/connection
  if (pathname === '/ntis/connection') {
    const { apprvKey, pjtId, collection, topN } = q;
    const serverKey = process.env.NTIS_API_KEY || apprvKey || '';
    if (!serverKey || !pjtId) return jsonRes(res, 400, { error: 'NTIS_API_KEY/apprvKey, pjtId 필요' });
    const params = new URLSearchParams({ apprvKey: serverKey, pjtId });
    if (collection) params.set('collection', collection);
    if (topN)       params.set('topN', topN);

    const ntisPath = `/rndopen/openApi/ConnectionContent?${params.toString()}`;
    try {
      const result = await ntisGet(ntisPath);
      setCORS(res);
      setNoCache(res); // 연관 콘텐츠 캐싱 비활성화 (안전제일)
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.status(result.status).send(result.body);
    } catch (e) {
      return jsonRes(res, 500, { error: e.message });
    }
  }

  return jsonRes(res, 404, { error: 'Not found', path: pathname });
};
