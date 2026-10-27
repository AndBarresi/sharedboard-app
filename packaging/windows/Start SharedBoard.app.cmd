@echo off
setlocal
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\portable.ps1"
if errorlevel 1 (
  echo.
  echo See the message above and the data folder for startup details.
  pause
  exit /b 1
)
exit /b 0
