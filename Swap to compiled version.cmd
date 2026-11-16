@echo off
cd /d "%~dp0"
"%~dp0..\tools\node-v24.22.1-win-x64\node.exe" "%~dp0scripts\local-openrouter\activate-compiled-release.mjs"
if errorlevel 1 pause
