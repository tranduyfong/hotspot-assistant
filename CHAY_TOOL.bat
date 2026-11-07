@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Can cai Node.js 24 tro len truoc khi chay tool.
  pause
  exit /b 1
)
if not exist node_modules\playwright\package.json (
  call npm.cmd install
  if errorlevel 1 (
    pause
    exit /b 1
  )
)
node server.mjs --open
pause
