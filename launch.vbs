Dim dir, shell
dir = Left(WScript.ScriptFullName, InStrRev(WScript.ScriptFullName, "\") - 1)
Set shell = CreateObject("WScript.Shell")
shell.Run "cmd /c cd /d """ & dir & """ && launch.bat", 0, True
