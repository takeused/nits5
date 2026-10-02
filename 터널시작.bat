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
echo [1/3] 프록시 서버 시작 (포트 8737)...
start "SC-NTIS Proxy 8737" cmd /c "set PORT=8737&& node proxy-server.js"

REM 프록시가 뜰 때까지 잠깐 대기
timeout /t 3 /nobreak >nul

REM 2) Cloudflare 임시 터널 시작 → https URL 발급 (별도 창, 로그는 tunnel.log)
echo [2/3] Cloudflare 터널 시작...
if exist "%~dp0tunnel.log" del "%~dp0tunnel.log"
start "SC-NTIS Tunnel" cloudflared tunnel --url http://localhost:8737 --no-autoupdate --logfile "%~dp0tunnel.log"

REM 3) 새 터널 주소를 배포 사이트에 자동 등록 → 사용자는 nits5.vercel.app만 열면 됨
echo [3/3] 터널 주소를 배포 사이트에 자동 등록하는 중...
node register-tunnel.js "%~dp0tunnel.log"
echo.
echo  (프록시·터널 창 2개를 닫으면 배포 사이트 검색이 멈춥니다. 켜둔 채로 두세요.)
echo  이 창은 닫아도 됩니다.
echo ============================================================
pause

endlocal
