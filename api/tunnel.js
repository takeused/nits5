// ── /tunnel — 현재 터널 주소 등록소 ─────────────────────────────────
// Cloudflare 임시 터널은 재시작할 때마다 주소가 바뀐다. 승인 PC가 터널을 띄우면
// 새 주소를 여기에 POST(접속 키 인증)로 등록하고, 배포 사이트는 GET으로 읽어
// 자동으로 그 주소를 쓴다. 사용자는 항상 nits5.vercel.app 하나로 접속하면 된다.
// 저장소: Vercel Blob(private) — 프로젝트에 연결되면 BLOB_READ_WRITE_TOKEN이 주입된다.
const crypto = require('crypto');
const { get, put } = require('@vercel/blob');

const BLOB_PATH = 'tunnel/current.json';
// cloudflared 임시 터널 주소만 허용 (다른 곳으로 트래픽을 돌리는 등록을 막는다)
const TUNNEL_URL_RE = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;

function setHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,X-Proxy-Token');
  res.setHeader('Cache-Control', 'no-store, max-age=0');
}

function tokenMatches(given) {
  const expected = process.env.PROXY_TOKEN || '';
  if (!expected || typeof given !== 'string') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function streamToText(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

module.exports = async (req, res) => {
  setHeaders(res);
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'GET') {
    try {
      const result = await get(BLOB_PATH, { access: 'private', useCache: false });
      if (!result || !result.stream) return res.status(404).json({ error: 'NOT_REGISTERED' });
      const data = JSON.parse(await streamToText(result.stream));
      return res.status(200).json({ url: data.url, updatedAt: data.updatedAt });
    } catch (e) {
      if (e && e.name === 'BlobNotFoundError') return res.status(404).json({ error: 'NOT_REGISTERED' });
      return res.status(500).json({ error: 'READ_FAILED', message: e.message });
    }
  }

  if (req.method === 'POST') {
    if (!tokenMatches(req.headers['x-proxy-token'])) {
      return res.status(401).json({ error: 'PROXY_TOKEN_REQUIRED' });
    }
    const url = String((req.body && req.body.url) || '').trim().replace(/\/+$/, '');
    if (!TUNNEL_URL_RE.test(url)) {
      return res.status(400).json({ error: 'INVALID_TUNNEL_URL' });
    }
    try {
      const updatedAt = new Date().toISOString();
      await put(BLOB_PATH, JSON.stringify({ url, updatedAt }), {
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: 'application/json',
      });
      return res.status(200).json({ ok: true, url, updatedAt });
    } catch (e) {
      return res.status(500).json({ error: 'WRITE_FAILED', message: e.message });
    }
  }

  return res.status(405).json({ error: 'GET or POST' });
};
