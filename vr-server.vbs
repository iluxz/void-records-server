' void-records-server autostart
' drops a copy in the startup folder; checks /health first so it never
' launches twice. window is hidden, output appends to data\server-startup.log.

Option Explicit

Dim serverDir, logFile, npmCmd, shell, fso, xhr, cmd, log

serverDir = "D:\Cube\void-records-server"
logFile = serverDir & "\data\server-startup.log"
npmCmd = "C:\Program Files\nodejs\npm.cmd"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FileExists(npmCmd) Then WScript.Quit 1

' already answering? nothing to do.
On Error Resume Next
Set xhr = CreateObject("MSXML2.ServerXMLHTTP.6.0")
xhr.SetTimeouts 300, 300, 1000, 1000
xhr.Open "GET", "http://127.0.0.1:8787/health", False
xhr.Send
If Err.Number = 0 Then
  If xhr.Status = 200 Then WScript.Quit 0
End If
On Error GoTo 0

Set log = fso.OpenTextFile(logFile, 8, True)
log.WriteLine "--- " & Now & " autostart ---"
log.Close

cmd = "cmd /c cd /d """ & serverDir & """ && """ & npmCmd & """ start >> """ & logFile & """ 2>&1"
shell.Run cmd, 0, False
