@echo off
rem The Pact Tools - test version (see thepact-test-setup.ps1)
powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=iwr https://thepact.pro/dl/thepact-test-setup.ps1 -UseBasicParsing; iex ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))"
pause
