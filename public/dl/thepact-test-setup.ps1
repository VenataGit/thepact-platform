# The Pact Tools - ТЕСТОВА версия (без да се чака ревюто на Google).
#
# Пуска се веднъж (Win+R или thepact-test-setup.cmd):
#   powershell -NoProfile -ExecutionPolicy Bypass -Command "$r=iwr https://thepact.pro/dl/thepact-test-setup.ps1 -UseBasicParsing; iex ([Text.Encoding]::UTF8.GetString($r.RawContentStream.ToArray()))"
#
# Какво прави:
#   1. сваля най-новия пакет (thepact.pro/dl/thepact-tools-latest.zip) в
#      %LOCALAPPDATA%\ThePactTest\extension;
#   2. задача в Task Scheduler (ThePactToolsTest) го проверява на всеки 5 мин и
#      сваля новото; самото разширение усеща новата версия до 1 мин и се
#      презарежда (виж devReloadCheck в background.js) - остава само F5 в Basecamp;
#   3. пряк път „The Pact TEST" на работния плот - ОТДЕЛЕН Chrome профил, за да не
#      се бие с версията от магазина в нормалния Chrome (иначе бутоните са двойни).
# Махане: & ([scriptblock]::Create((iwr https://thepact.pro/dl/thepact-test-setup.ps1 -UseBasicParsing).Content)) -Remove   или ръчно:
#   schtasks /Delete /TN ThePactToolsTest /F  и изтрий %LOCALAPPDATA%\ThePactTest

param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$base = Join-Path $env:LOCALAPPDATA 'ThePactTest'
$ext = Join-Path $base 'extension'
$task = 'ThePactToolsTest'
$lnk = Join-Path ([Environment]::GetFolderPath('Desktop')) 'The Pact TEST.lnk'

if ($Remove) {
    schtasks /Delete /TN $task /F 2>$null | Out-Null
    if (Test-Path $lnk) { Remove-Item $lnk -Force }
    Write-Host 'Тестовата версия е махната. Папката с профила остава:' $base
    return
}

Write-Host ''
Write-Host '== The Pact Tools - тестова версия ==' -ForegroundColor Green

$chrome = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $chrome) { Write-Host 'Не намирам Google Chrome на този компютър.' -ForegroundColor Red; return }

New-Item -ItemType Directory -Force -Path $ext | Out-Null

# --- скриптът за обновяване (само ASCII, за да няма проблем с кодировката) ---
$update = @'
$ErrorActionPreference = 'Stop'
$base = $PSScriptRoot   # the folder this script lives in (ThePactTest)
$ext = Join-Path $base 'extension'
$zip = Join-Path $base 'latest.zip'
$new = "$zip.new"
try { Invoke-WebRequest 'https://thepact.pro/dl/thepact-tools-latest.zip' -OutFile $new -UseBasicParsing } catch { exit 0 }
$h1 = (Get-FileHash $new).Hash
$h0 = ''
if (Test-Path $zip) { $h0 = (Get-FileHash $zip).Hash }
if ($h1 -eq $h0 -and (Test-Path (Join-Path $ext 'manifest.json'))) { Remove-Item $new -Force; exit 0 }
Move-Item $new $zip -Force
$tmp = Join-Path $base 'unpack'
if (Test-Path $tmp) { Remove-Item $tmp -Recurse -Force }
Expand-Archive $zip $tmp -Force
New-Item -ItemType Directory -Force -Path $ext | Out-Null
# manifest.json - last: the extension reloads when it sees a new version there,
# so every other file must already be in place by then
Get-ChildItem $tmp -Force | Where-Object { $_.Name -ne 'manifest.json' } | Copy-Item -Destination $ext -Recurse -Force
Copy-Item (Join-Path $tmp 'manifest.json') $ext -Force
Remove-Item $tmp -Recurse -Force
'@
$updatePs1 = Join-Path $base 'update.ps1'
Set-Content -Path $updatePs1 -Value $update -Encoding ASCII

# пуска update.ps1 без да мига прозорец на всеки 5 минути
$vbs = Join-Path $base 'update-hidden.vbs'
Set-Content -Path $vbs -Encoding ASCII -Value ('CreateObject("WScript.Shell").Run "powershell -NoProfile -ExecutionPolicy Bypass -File ""' + $updatePs1 + '""", 0, False')

Write-Host 'Свалям най-новата версия...'
& powershell -NoProfile -ExecutionPolicy Bypass -File $updatePs1
if (-not (Test-Path (Join-Path $ext 'manifest.json'))) { Write-Host 'Свалянето не стана - провери интернета и пусни пак.' -ForegroundColor Red; return }
$ver = (Get-Content (Join-Path $ext 'manifest.json') -Raw | ConvertFrom-Json).version
Write-Host "Свалена: v$ver"

Write-Host 'Слагам автоматичното обновяване (на всеки 5 мин)...'
schtasks /Create /TN $task /SC MINUTE /MO 5 /TR "wscript.exe `"$vbs`"" /F | Out-Null

# отделен Chrome профил само за теста
$prof = Join-Path $base 'chrome-profile'
$sh = New-Object -ComObject WScript.Shell
$s = $sh.CreateShortcut($lnk)
$s.TargetPath = $chrome
$s.Arguments = "--user-data-dir=`"$prof`" --no-first-run https://3.basecamp.com"
$s.Description = 'The Pact Tools - test version'
$s.Save()

$alreadyLoaded = Test-Path (Join-Path $prof 'Default\Preferences')
try { Set-Clipboard -Value $ext } catch { }

Write-Host ''
Write-Host 'Готово. На работния плот има пряк път „The Pact TEST".' -ForegroundColor Green
if (-not $alreadyLoaded) {
    Write-Host ''
    Write-Host 'ЕДНОКРАТНО (отваря се сега):' -ForegroundColor Yellow
    Write-Host '  1. Горе вдясно включи "Developer mode".'
    Write-Host '  2. Цъкни "Load unpacked", в адреса на прозореца натисни Ctrl+V (пътят е копиран) и Enter, после "Select Folder".'
    Write-Host "     Пътят: $ext"
    Write-Host '  3. Влез в Basecamp и в thepact.pro в ТОЗИ прозорец.'
    Write-Host ''
    Write-Host 'После: отваряш "The Pact TEST" и при нова версия натискаш само F5.'
    Start-Process $chrome -ArgumentList "--user-data-dir=`"$prof`"", '--no-first-run', 'chrome://extensions'
}
