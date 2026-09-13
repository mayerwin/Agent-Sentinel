@echo off
setlocal
cd /d "%~dp0"

:: If AgentSentinel.exe does not exist, compile it on the fly using built-in csc.exe
if not exist "%~dp0AgentSentinel.exe" (
    if exist "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" (
        "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /target:winexe /optimize+ /out:"%~dp0AgentSentinel.exe" /r:System.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll "%~dp0tools\AgentSentinelTray.cs" >nul 2>&1
    )
)

:: Launch AgentSentinel System Tray application (native GUI, zero console flash)
if exist "%~dp0AgentSentinel.exe" (
    start "" "%~dp0AgentSentinel.exe"
    exit /b 0
)

:: Fallback if compilation was not possible
powershell -WindowStyle Hidden -NoProfile -Command "Start-Process node -ArgumentList 'server.js' -WorkingDirectory '%~dp0' -WindowStyle Hidden"
timeout /t 1 /nobreak >nul
start http://localhost:3456
endlocal
