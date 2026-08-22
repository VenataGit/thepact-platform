# ThePact — бекъп на задачите от Basecamp (проект Video Production) към сървъра
#
# Тегли от платформата един самостоятелен HTML с ВСИЧКИ карти по всички дъски и
# колони (вкл. Not now, On hold и Done), с описанията, стъпките, отговорниците,
# коментарите и отчетеното през платформата време, и го записва в
# Z:\Backup - платформа и бейскамп.
#
# Пуска се от планираната задача „ThePactBasecampBackup" всяка събота в 18:00.
# Ръчно:  powershell -ExecutionPolicy Bypass -File "<път>\backup-basecamp.ps1"
#
# ВАЖНО: файлът се пази като UTF-8 С BOM — иначе Windows PowerShell 5.1 не чете
# кирилицата и скриптът не се компилира.

param(
    [string]$Root       = 'Z:\Backup - платформа и бейскамп',
    # Ако Z: го няма (напр. задачата тръгне преди мрежовите дискове), се пробва и това.
    [string]$RootUnc    = '\\192.168.31.147\Production\Backup - платформа и бейскамп',
    [string]$BaseUrl    = 'https://thepact.pro',
    [string]$ConfigPath = 'D:\Claude ThePact\autodev\config.json',
    [string]$Secret     = '',
    [int]   $KeepCopies = 12,   # колко датирани копия се пазят в „Архив"
    [switch]$NoArchive          # само актуалният файл, без датирано копие
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date
$stamp     = $startedAt.ToString('yyyy-MM-dd')

# TLS 1.2 — PowerShell 5.1 по подразбиране пробва по-стар протокол и получава отказ.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

# --- къде пишем -------------------------------------------------------------
if (-not (Test-Path -LiteralPath $Root)) {
    if ($RootUnc -and (Test-Path -LiteralPath $RootUnc)) { $Root = $RootUnc }
}
$logFile   = Join-Path $Root 'лог-на-бекъпа.txt'
$failMark  = Join-Path $Root 'БЕКЪПЪТ-НЕ-МИНА.txt'
$archive   = Join-Path $Root 'Архив'
$htmlFile  = Join-Path $Root 'Video Production - задачи (АКТУАЛЕН).html'
$jsonFile  = Join-Path $Root 'Video Production - задачи (АКТУАЛЕН).json'

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '[{0}] {1,-5} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Write-Output $line
    try { Add-Content -LiteralPath $logFile -Value $line -Encoding utf8 } catch { }
}

function Fail {
    param([string]$Message)
    Write-Log $Message 'ERROR'
    try {
        Set-Content -LiteralPath $failMark -Encoding utf8 -Value @"
Бекъпът от $stamp НЕ мина.

$Message

Подробности: $logFile
Ръчно пускане: powershell -ExecutionPolicy Bypass -File "$PSCommandPath"
"@
    } catch { }
    exit 1
}

if (-not (Test-Path -LiteralPath $Root)) {
    Write-Output "Папката за бекъпи не е достъпна: $Root"
    exit 1
}
if (-not $NoArchive -and -not (Test-Path -LiteralPath $archive)) {
    New-Item -ItemType Directory -Path $archive -Force | Out-Null
}

# Ротация на лога (пази последните ~2 MB)
if ((Test-Path -LiteralPath $logFile) -and ((Get-Item -LiteralPath $logFile).Length -gt 2MB)) {
    Move-Item -LiteralPath $logFile "$logFile.old" -Force
}

Write-Log "=== Старт на бекъпа на Basecamp ($stamp) — цел: $Root ==="

# --- ключът към платформата -------------------------------------------------
if (-not $Secret) {
    if (-not (Test-Path -LiteralPath $ConfigPath)) { Fail "Липсва $ConfigPath — няма откъде да се вземе ключът." }
    try {
        $cfg = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
        $Secret = $cfg.secret
        if ($cfg.baseUrl) { $BaseUrl = $cfg.baseUrl }
    } catch { Fail "Конфигурацията $ConfigPath не се чете: $($_.Exception.Message)" }
}
if (-not $Secret) { Fail 'Ключът към платформата е празен.' }

$headers = @{ 'X-Dev-Queue-Key' = $Secret }
$tmpHtml = Join-Path $env:TEMP "bc-backup-$stamp.html"
$tmpJson = Join-Path $env:TEMP "bc-backup-$stamp.json"

function Get-Snapshot {
    param([string]$Url, [string]$OutFile, [string]$What)
    Write-Log "Тегли се $What ..."
    # Сглобяването на снимката отнема около минута — оттам и дългият timeout.
    # Два опита: първият може да падне и заради рестарт на сървъра след deploy.
    for ($attempt = 1; $attempt -le 2; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -Headers $headers -OutFile $OutFile `
                -UseBasicParsing -TimeoutSec 600 | Out-Null
            return
        } catch {
            $msg = $_.Exception.Message
            if ($attempt -eq 2) { Fail "$What не се изтегли: $msg" }
            Write-Log "Опит $attempt се провали ($msg) — повтаря се след 30 сек." 'WARN'
            Start-Sleep -Seconds 30
        }
    }
}

Get-Snapshot "$BaseUrl/api/backup/basecamp" $tmpHtml 'HTML файлът'
Get-Snapshot "$BaseUrl/api/backup/basecamp?format=json" $tmpJson 'JSON файлът'

# --- проверка преди да сменим стария бекъп ---------------------------------
# Гледаме и двата файла: празен или орязан отговор не бива да изтрие миналата седмица.
$htmlLen = (Get-Item -LiteralPath $tmpHtml).Length
if ($htmlLen -lt 20KB) { Fail "HTML файлът е подозрително малък ($htmlLen B) — старият бекъп се запазва." }

$html = Get-Content -LiteralPath $tmpHtml -Raw -Encoding UTF8
if ($html -notmatch '(?i)</html>') { Fail 'HTML файлът е орязан (липсва </html>).' }

try { $snap = Get-Content -LiteralPath $tmpJson -Raw -Encoding UTF8 | ConvertFrom-Json }
catch { Fail "JSON файлът не се чете: $($_.Exception.Message)" }

if (-not $snap.stats -or [int]$snap.stats.cards -lt 1) { Fail 'В снимката няма нито една карта — нещо не е наред.' }

$s = $snap.stats
Write-Log ("Изтеглени: {0} карти ({1} отворени, {2} просрочени, {3} on hold, {4} завършени), {5} to-do, {6} коментара" `
    -f $s.cards, $s.active, $s.overdue, $s.onHold, $s.done, $s.todos, $s.comments)
if ($snap.warnings -and $snap.warnings.Count -gt 0) {
    foreach ($w in $snap.warnings) { Write-Log "  бележка: $w" 'WARN' }
}

# --- записване --------------------------------------------------------------
Move-Item -LiteralPath $tmpHtml -Destination $htmlFile -Force
Move-Item -LiteralPath $tmpJson -Destination $jsonFile -Force
$jsonLen = (Get-Item -LiteralPath $jsonFile).Length
Write-Log ("Записан: {0} ({1:N1} MB)" -f (Split-Path $htmlFile -Leaf), ($htmlLen / 1MB))

if (-not $NoArchive) {
    $copy = Join-Path $archive "Video Production - задачи $stamp.html"
    Copy-Item -LiteralPath $htmlFile -Destination $copy -Force
    Write-Log "Датирано копие: $(Split-Path $copy -Leaf)"

    # Пазим последните $KeepCopies датирани копия — останалите падат.
    $old = Get-ChildItem -LiteralPath $archive -Filter '*.html' -File |
           Sort-Object Name -Descending | Select-Object -Skip $KeepCopies
    foreach ($f in $old) {
        Remove-Item -LiteralPath $f.FullName -Force
        Write-Log "  изтрито старо копие: $($f.Name)"
    }
}

# --- кратка справка до файла, за да се вижда без отваряне на лога -----------
$duration = [int]((Get-Date) - $startedAt).TotalSeconds
Set-Content -LiteralPath (Join-Path $Root 'ПОСЛЕДЕН БЕКЪП.txt') -Encoding utf8 -Value @"
Последен бекъп на задачите от Basecamp (проект Video Production)

Кога:              $($startedAt.ToString('dd.MM.yyyy HH:mm')) (за $duration сек.)
Файл:              $(Split-Path $htmlFile -Leaf)   ($('{0:N1}' -f ($htmlLen / 1MB)) MB)
Същото като данни: $(Split-Path $jsonFile -Leaf)   ($('{0:N1}' -f ($jsonLen / 1MB)) MB)

Карти общо:        $($s.cards)
  отворени:        $($s.active)
  просрочени:      $($s.overdue)
  on hold:         $($s.onHold)
  завършени:       $($s.done)
To-do задачи:      $($s.todos)  (отворени: $($s.todosOpen))
Коментари:         $($s.comments)

HTML файлът се отваря с двоен клик — работи без интернет и без логин.
Датираните копия са в подпапката „Архив" (пазят се последните $KeepCopies).
"@

if (Test-Path -LiteralPath $failMark) { Remove-Item -LiteralPath $failMark -Force }
Write-Log "=== Готово за $duration сек. ==="
exit 0
