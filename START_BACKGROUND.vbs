' 1-Click Silent Background Launcher for WhatsApp Monthly Sender
Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
driveLetter = LCase(Left(projectDir, 1))
subPath = Replace(Mid(projectDir, 3), "\", "/")
wslPath = "/mnt/" & driveLetter & subPath

cmd = "wsl.exe -e bash -c ""cd " & wslPath & " && ./start.sh >> app.log 2>&1"""
WshShell.Run cmd, 0, False

WScript.Sleep 1500
WshShell.Run "cmd /c start http://localhost:3000", 0, False

Set WshShell = Nothing
Set fso = Nothing
