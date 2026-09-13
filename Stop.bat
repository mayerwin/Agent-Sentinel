@echo off
setlocal
echo [Agent Sentinel]: Stopping Sentinel daemon and system tray application...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:3456/api/shutdown' -Method Post -TimeoutSec 2 | Out-Null; Write-Host 'Sentinel server stopped gracefully.' } catch { Write-Host 'Sentinel server was not running.' }"
taskkill /F /IM AgentSentinel.exe >nul 2>&1
timeout /t 1 /nobreak >nul
endlocal
