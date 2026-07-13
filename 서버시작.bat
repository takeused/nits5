@echo off
chcp 65001 > nul
title NTIS + ScienceON 로컬 프록시 서버

:: ── 이미 실행 중인지 확인 (포트 3737) ──────────────────────
netstat -an 2>nul | find ":3737 " | find "LISTENING" > nul
if %errorlevel% == 0 (
    echo.
    echo  [OK] 프록시 서버가 이미 실행 중입니다. 브라우저를 엽니다...
    echo.
    start http://127.0.0.1:3737
    timeout /t 2 /nobreak > nul
    exit /b 0
)

:: ── Node.js 설치 확인 ────────────────────────────────────
where node > nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  [오류] Node.js가 설치되어 있지 않습니다.
    echo  https://nodejs.org 에서 설치 후 다시 실행하세요.
    echo.
    pause
    exit /b 1
)

:: ── 서버 시작 (최소화 창으로 백그라운드 실행) ───────────────
echo.
echo  ScienceON + NTIS 프록시 서버를 시작합니다...
start /min "NTIS프록시_3737" cmd /c "cd /d "%~dp0" && node proxy-server.js"

:: ── 서버 준비 대기 (최대 10초) ──────────────────────────
set /a tries=0
:wait_loop
timeout /t 1 /nobreak > nul
netstat -an 2>nul | find ":3737 " | find "LISTENING" > nul
if %errorlevel% == 0 goto server_ready
set /a tries+=1
if %tries% lss 10 goto wait_loop

echo  [경고] 서버 시작 확인 시간 초과. 그냥 브라우저를 열어봅니다...
goto open_browser

:server_ready
echo  [OK] 서버 준비 완료! 브라우저를 엽니다...

:open_browser
echo.
start http://127.0.0.1:3737

:: ── 3초 후 자동 종료 (창이 사라짐) ─────────────────────
timeout /t 3 /nobreak > nul
