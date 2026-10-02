/**
 * 터널 주소 자동 등록
 * cloudflared 로그에서 https://XXXX.trycloudflare.com 주소를 찾아
 * 배포 사이트(https://nits5.vercel.app/tunnel)에 등록한다. 배포 사이트는 이 주소를 읽어
 * 자동으로 사용하므로, 터널 주소가 바뀌어도 사용자는 nits5.vercel.app만 열면 된다.
 *
 * 실행: node register-tunnel.js <cloudflared 로그 파일>   (터널시작.bat이 자동 실행)
 * 인증: .env의 PROXY_TOKEN
 */
const fs    = require('fs');
const path  = require('path');
const https = require('https');
const tls   = require('tls');

const SITE = 'nits5.vercel.app';
const logFile = process.argv[2] || path.join(__dirname, 'tunnel.log');

// .env에서 PROXY_TOKEN만 읽는다
function readProxyToken() {
  if (process.env.PROXY_TOKEN) return process.env.PROXY_TOKEN;
  const envPath = path.join(__dirname, '.env');
  if (!fs.existsSync(envPath)) return '';
  const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(l => /^\s*PROXY_TOKEN\s*=/.test(l));
  return line ? line.slice(line.indexOf('=') + 1).trim().replace(/^['"]|['"]$/g, '') : '';
}

// 회사망 SSL 검사 대응: Windows 시스템 인증서 저장소를 신뢰 (proxy-server.js와 동일)
try {
  if (typeof tls.setDefaultCACertificates === 'function') {
    tls.setDefaultCACertificates([...tls.getCACertificates('default'), ...tls.getCACertificates('system')]);
  }
} catch { /* 무시 */ }

function findTunnelUrl() {
  if (!fs.existsSync(logFile)) return '';
  const m = fs.readFileSync(logFile, 'utf8').match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
  return m ? m[m.length - 1] : '';   // 재연결로 여러 번 찍히면 마지막 주소
}

function postJSON(pathname, body, token) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: SITE, path: pathname, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data), 'X-Proxy-Token': token },
    }, res => {
      let text = '';
      res.on('data', c => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => req.destroy(new Error('timeout')));
    req.end(data);
  });
}

(async () => {
  const token = readProxyToken();
  if (!token) {
    console.error('[등록 실패] .env에 PROXY_TOKEN이 없습니다.');
    process.exit(1);
  }

  // cloudflared가 주소를 발급받을 때까지 최대 60초 대기
  let url = '';
  for (let i = 0; i < 60 && !url; i++) {
    url = findTunnelUrl();
    if (!url) await new Promise(r => setTimeout(r, 1000));
  }
  if (!url) {
    console.error(`[등록 실패] 60초 안에 터널 주소를 찾지 못했습니다 (${logFile})`);
    process.exit(1);
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const r = await postJSON('/tunnel', { url }, token);
      if (r.status === 200) {
        console.log(`\n✅ 터널 주소 자동 등록 완료: ${url}`);
        console.log('   이제 https://nits5.vercel.app 만 열면 됩니다.\n');
        return;
      }
      console.error(`[등록 시도 ${attempt}/3] HTTP ${r.status} ${r.text}`);
    } catch (e) {
      console.error(`[등록 시도 ${attempt}/3] ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 3000));
  }
  console.error(`\n❌ 자동 등록 실패. 배포 사이트를 아래 주소로 한 번 열면 됩니다:\n   https://${SITE}/?proxy=${url}\n`);
  process.exit(1);
})();
