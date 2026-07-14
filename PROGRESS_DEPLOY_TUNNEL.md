# 배포(nits5.vercel.app) 터널 연동 진행 기록

## 배경 / 근본 원인
- ScienceON·NTIS API 인증정보가 **승인 PC의 IP(NTIS 승인 IP 1.252.84.41)에 묶임**.
- Vercel 서버리스는 유동 클라우드 IP → ScienceON 토큰 E4006(MAC 확인 불가), NTIS IP 화이트리스트 거부.
- 환경변수를 Vercel에 넣어도(IP 문제라) 검색 불가. `scienceOnConfigured:true`여도 토큰 발급 실패.

## 해결 (방안 A): 승인 PC 프록시를 터널로 노출
- PC에서 이 저장소 `proxy-server.js`(포트 8737) 실행 + Cloudflare 터널로 https 노출.
- 배포 프론트엔드가 터널 URL을 프록시로 호출 → API가 승인 PC IP를 봄 → 정상 동작.
- 라이브 검증 완료: ScienceON 논문/특허, NTIS R&D과제, 적정 연구비 산출, 연구-IP 전환 공백 분석 모두 OK.

## 적용 커밋
| 커밋 | 내용 |
|------|------|
| `9d97e06` | `?proxy=`/localStorage로 터널 URL 설정 가능 (`js/state.js` `VERCEL_BASE`, `js/ui.js` 배지) |
| `c3d5f76` | `터널시작.bat` 런처 추가 |
| `e273547` | 적정 연구비 산출이 프록시 NTIS 키 사용(브라우저 키 강제 제거): `openBudgetModal`, `fetchNTISForBudget` |
| `b464606` | AI(Cerebras)가 프록시 `/cerebras` 경유: `hasAIAccess`, `cerebrasChat` (프록시 서버키 우선, csk- 키 폴백) |

## 공통 패턴 (유사 버그 대응)
배포판에서 "키/인증 필요" 에러가 나면 → 해당 기능이 `PROXY_AVAILABLE && STATE.xxxConfigured`를 무시하고 브라우저측 키를 직접 요구하는지 확인 → 검색 경로와 동일 조건으로 맞춤.

## 제약
- PC + 프록시(8737) + 터널이 켜져 있어야 배포 검색 가능.
- Cloudflare **임시** 터널 URL은 재시작마다 바뀜 → 새 URL로 `nits5.vercel.app/?proxy=<새URL>` 한 번 접속(브라우저 localStorage 저장).

## 서버(프록시+터널) 재시작 방법
1. 저장소 루트 `터널시작.bat` 더블클릭 → 프록시(8737) + cloudflared 터널 실행.
2. 출력의 `https://XXXX.trycloudflare.com` 복사.
3. `https://nits5.vercel.app/?proxy=https://XXXX.trycloudflare.com` 접속(1회) → 저장됨.
4. 창은 닫지 말 것(닫으면 터널 끊김).
- 확인: `https://<터널>/health` → `...Configured: true` 3종 확인.

## 다음 작업 (예정)
**고정 URL 업그레이드 (ngrok 기준)** — 임시 터널의 URL 변동/브라우저별 제약 제거. 누구나 `nits5.vercel.app`만 열어도 동작하게.
1. ngrok 계정 + 무료 고정 도메인 예약 + authtoken (사용자 작업).
2. `ngrok http 8737 --url=<고정도메인>`, `터널시작.bat` 갱신.
3. ngrok 브라우저 경고 우회 필요 시: 프론트 fetch에 `ngrok-skip-browser-warning` 헤더 + `proxy-server.js` CORS 허용 헤더 추가(실제 경고 뜨는지 먼저 테스트).
4. 고정 URL을 `js/state.js` `TUNNEL_DEFAULT`에 하드코딩 → 커밋·재배포.
5. 라이브 재검증.
- 대안: Cloudflare named tunnel(도메인 보유 시, 인터스티셜 없음).
