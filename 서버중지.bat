@echo off
chcp 65001 > nul
title 프록시 서버 중지

echo.
echo  포트 3737 프로세스를 종료합니다...

:: 포트 3737을 사용하는 PID 찾아서 종료
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| find ":3737 " ^| find "LISTENING"') do (
    echo  PID %%a 종료 중...
    taskkill /PID %%a /F > nul 2>&1
)

:: 혹시 남은 node.exe 중 proxy-server 실행 중인 것도 종료
taskkill /FI "WINDOWTITLE eq NTIS프록시_3737" /F > nul 2>&1

netstat -an 2>nul | find ":3737 " | find "LISTENING" > nul
if %errorlevel% == 0 (
    echo  [경고] 아직 실행 중인 프로세스가 있습니다.
) else (
    echo  [OK] 프록시 서버가 종료되었습니다.
)

echo.
timeout /t 2 /nobreak > nul
