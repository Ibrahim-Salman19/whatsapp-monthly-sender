@echo off
echo ======================================================
echo  Installing WhatsApp Monthly Sender Windows Auto-Start
echo ======================================================
echo.

set TARGET_VBS=%~dp0start-background.vbs
set STARTUP_DIR=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT_PATH=%STARTUP_DIR%\WhatsAppSenderBackground.lnk

powershell -Command "$ws = New-Object -ComObject WScript.Shell; $s = $ws.CreateShortcut('%SHORTCUT_PATH%'); $s.TargetPath = 'wscript.exe'; $s.Arguments = '\"%TARGET_VBS%\"'; $s.WorkingDirectory = '%~dp0'; $s.Save()"

if exist "%SHORTCUT_PATH%" (
    echo [SUCCESS] Auto-start shortcut created in Windows Startup folder!
    echo WhatsApp Monthly Sender will now start silently in the background whenever Windows boots.
) else (
    echo [ERROR] Failed to create shortcut.
)

echo.
pause
