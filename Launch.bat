@echo off
setlocal
cd /d "%~dp0"

:: If Launch.vbs exists, invoke via wscript for zero console flash
if exist "%~dp0Launch.vbs" (
    wscript "%~dp0Launch.vbs"
    exit /b 0
)

:: Fallback to hidden PowerShell execution
powershell -WindowStyle Hidden -NoProfile -Command "Start-Process node -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
timeout /t 1 /nobreak >nul
start http://localhost:3456
endlocal
