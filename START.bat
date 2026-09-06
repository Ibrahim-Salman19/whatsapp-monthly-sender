@echo off
title WhatsApp Monthly Sender
echo ======================================================================
echo   WhatsApp Monthly Sender - 1-Click Launcher
echo ======================================================================
echo.
echo [1/3] Checking Windows Subsystem for Linux (WSL)...
wsl.exe --status >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] WSL is not detected or enabled on this machine.
    echo Please open PowerShell as Administrator and run: wsl --install
    echo Then restart your computer and run START.bat again.
    pause
    exit /b 1
)

echo [2/3] Starting WhatsApp Automation Server in WSL...
start "" "http://localhost:3000"

set PROJECT_DIR=%~dp0
wsl.exe -e bash -c "cd $(wslpath '%PROJECT_DIR%') && ./start.sh"

pause
