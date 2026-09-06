@echo off
echo Stopping WhatsApp Monthly Sender in WSL...
wsl.exe -e bash -c "pkill -f 'dist/index.js' || true"
echo Service stopped.
timeout /t 2 >nul
