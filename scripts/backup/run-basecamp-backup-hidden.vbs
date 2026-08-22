' Пуска backup-basecamp.ps1 без да мига конзолен прозорец (за Task Scheduler).
Set sh = CreateObject("WScript.Shell")
cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File ""D:\Claude ThePact\thepact-platform\scripts\backup\backup-basecamp.ps1"""
rc = sh.Run(cmd, 0, True)
WScript.Quit rc
