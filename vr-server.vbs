' void-records-server autostart
' starts the express server (if /health is not answering) and a quick
' cloudflare tunnel (if cloudflared is not running). both hidden.
' logs append under data\. copy this file into the startup folder.

Option Explicit

Dim serverDir, logFile, tunnelLog, tunnelExe, npmCmd, shell, fso, xhr, cmd, log, procs, alreadyUp

serverDir = "D:\Cube\void-records-server"
logFile = serverDir & "\data\server-startup.log"
tunnelLog = serverDir & "\data\tunnel.log"
tunnelExe = serverDir & "\tools\cloudflared.exe"
npmCmd = "C:\Program Files\nodejs\npm.cmd"

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If Not fso.FileExists(npmCmd) Then WScript.Quit 1

' --- server: skip if already answering ---
alreadyUp = False
On Error Resume Next
Set xhr = CreateObject("MSXML2.ServerXMLHTTP.6.0")
xhr.SetTimeouts 300, 300, 1000, 1000
xhr.Open "GET", "http://127.0.0.1:8787/health", False
xhr.Send
If Err.Number = 0 Then
  If xhr.Status = 200 Then alreadyUp = True
End If
On Error GoTo 0

If Not alreadyUp Then
  Set log = fso.OpenTextFile(logFile, 8, True)
  log.WriteLine "--- " & Now & " autostart ---"
  log.Close
  cmd = "cmd /c cd /d """ & serverDir & """ && """ & npmCmd & """ start >> """ & logFile & """ 2>&1"
  shell.Run cmd, 0, False
End If

' --- quick tunnel: skip if cloudflared is already running ---
If fso.FileExists(tunnelExe) Then
  Set procs = GetObject("winmgmts:").ExecQuery("SELECT ProcessId FROM Win32_Process WHERE Name = 'cloudflared.exe'")
  If procs.Count = 0 Then
    Set log = fso.OpenTextFile(tunnelLog, 8, True)
    log.WriteLine "--- " & Now & " quick tunnel start ---"
    log.Close
    cmd = "cmd /c cd /d """ & serverDir & """ && """ & tunnelExe & """ tunnel --url http://127.0.0.1:8787 --no-autoupdate >> """ & tunnelLog & """ 2>&1"
    shell.Run cmd, 0, False
  End If
End If
