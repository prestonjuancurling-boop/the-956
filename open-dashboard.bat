@echo off
rem Double-click to open The 956 Mission Control dashboard.
rem Starts the local server if it isn't already running, then opens the page.
cd /d "%~dp0"
powershell -NoProfile -Command "if (-not (Test-NetConnection -ComputerName localhost -Port 4956 -InformationLevel Quiet -WarningAction SilentlyContinue)) { Start-Process -WindowStyle Hidden python -ArgumentList '-m','http.server','4956','-d','.' ; Start-Sleep -Seconds 2 }"
start http://localhost:4956/social/dashboard.html
