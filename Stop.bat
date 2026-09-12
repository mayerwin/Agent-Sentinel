@echo off
setlocal
echo [Agent Sentinel]: Stopping Sentinel daemon...
powershell -NoProfile -Command "try { Invoke-RestMethod -Uri 'http://localhost:3456/api/shutdown' -Method Post -TimeoutSec 2 | Out-Null; Write-Host 'Sentinel server stopped gracefully.' } catch { Write-Host 'Sentinel server was not running.' }"
timeout /t 1 /nobreak >nul
endlocal
