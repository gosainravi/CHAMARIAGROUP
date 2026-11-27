@echo off
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-planner.ps1"
if errorlevel 1 pause
timeout /t 5 >nul
