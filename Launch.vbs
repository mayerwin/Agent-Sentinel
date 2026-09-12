Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
strDir = FSO.GetParentFolderName(WScript.ScriptFullName)

WshShell.CurrentDirectory = strDir

' Launch node server.js completely hidden (window style 0 = SW_HIDE, wait = False)
WshShell.Run "node server.js", 0, False

' Allow 1 second for port binding, then open dashboard
WScript.Sleep 1000
WshShell.Run "cmd /c start http://localhost:3456", 0, False
