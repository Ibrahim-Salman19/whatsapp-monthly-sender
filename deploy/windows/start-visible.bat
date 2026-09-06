@echo off
title WhatsApp Monthly Sender (WSL Console)
echo ======================================================
echo  Launching WhatsApp Monthly Sender inside WSL...
echo ======================================================
set CURRENT_DIR=%~dp0..\..
wsl.exe -e bash -c "cd $(wslpath '%CURRENT_DIR%') && ./start.sh"
pause
