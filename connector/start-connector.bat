@echo off
cd /d "%~dp0"

echo StorePulse Connector starting...
echo Press Ctrl+C to stop.
echo.

:loop
node storepulse-connector.mjs
echo.
echo Connector stopped. Restarting in 10 seconds...
timeout /t 10 /nobreak >nul
goto loop
