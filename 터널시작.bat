@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ============================================================
echo  ScienceON/NTIS 프록시 + Cloudflare 터널 시작
echo  (배포 사이트 nits5.vercel.app 가 이 PC의 승인 IP를 경유)
echo ============================================================
echo.

REM 1) 이 저장소의 프록시를 8737 포트로 실행 (승인 IP = 이 PC)
echo [1/2] 프록시 서버 시작 (포트 8737)...
start "SC-NTIS Proxy 8737" cmd /c "set PORT=8737&& node proxy-server.js"

REM 프록시가 뜰 때까지 잠깐 대기
timeout /t 3 /nobreak >nul

REM 2) Cloudflare 임시 터널 시작 → https URL 발급
echo [2/2] Cloudflare 터널 시작...
echo.
echo  * 아래 출력에서 https://XXXX.trycloudflare.com 주소를 복사하세요.
echo  * 배포 사이트를 아래처럼 한 번 열면 그 주소가 저장됩니다:
echo      https://nits5.vercel.app/?proxy=https://XXXX.trycloudflare.com
echo.
echo  (이 창을 닫으면 터널이 끊깁니다. 켜둔 채로 두세요.)
echo ============================================================
echo.

cloudflared tunnel --url http://localhost:8737 --no-autoupdate

endlocal
