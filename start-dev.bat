@echo off
REM Starts the RPS Champions / Hand Clash Arena dev server (same as running "npm run dev" here).
cd /d "%~dp0"
title RPS Champions dev server
call npm run dev
pause
