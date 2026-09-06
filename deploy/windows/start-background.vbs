' WhatsApp Monthly Sender - Silent Background Launcher for WSL
' Starts the node server inside WSL without showing any command prompt window.

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

' Get project directory (2 levels up from deploy\windows\)
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)
deployDir = fso.GetParentFolderName(scriptDir)
projectDir = fso.GetParentFolderName(deployDir)

' Convert Windows path (e.g. D:\code\automation) to WSL path (/mnt/d/code/automation)
driveLetter = LCase(Left(projectDir, 1))
subPath = Replace(Mid(projectDir, 3), "\", "/")
wslPath = "/mnt/" & driveLetter & subPath

cmd = "wsl.exe -e bash -c ""cd " & wslPath & " && ./start.sh >> app.log 2>&1"""

' 0 = Hide window, False = Don't wait for completion
WshShell.Run cmd, 0, False

Set WshShell = Nothing
Set fso = Nothing
