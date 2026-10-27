@echo off
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0bridge.ps1" -Install -NoBrowser
if errorlevel 1 pause
