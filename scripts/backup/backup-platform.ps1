# ThePact — локален бекъп на цялата платформа от VPS-а
#
# Тегли всяка нощ от хостинга (46.225.171.84) на този компютър:
#   - базата (pg_dump в два формата)
#   - кода + uploads + .env + google-credentials.json
#   - сървърните настройки (nginx, cron, pm2, SSL сертификати, system info)
#
# Пуска се от Scheduled Task „ThePactPlatformBackup" всеки ден в 00:00.
# Ръчно:  powershell -ExecutionPolicy Bypass -File "<път>\backup-platform.ps1"

param(
    [string]$Root        = 'D:\PlatformBackup',
    [string]$VpsTarget   = 'root@46.225.171.84',
    [int]   $KeepDays    = 30,    # колко дневни бекъпа се пазят
    [int]   $KeepMonths  = 24,    # бекъпите от 1-во число се пазят по-дълго
    [switch]$NoRetention
)

$ErrorActionPreference = 'Stop'
$startedAt = Get-Date
$stamp     = $startedAt.ToString('yyyy-MM-dd')
$sshExe    = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh.exe'
$scpExe    = Join-Path $env:SystemRoot 'System32\OpenSSH\scp.exe'
$sshOpts   = @('-o','BatchMode=yes','-o','ConnectTimeout=30','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=8')

$logDir    = Join-Path $Root 'logs'
$dailyDir  = Join-Path $Root 'daily'
$destDir   = Join-Path $dailyDir $stamp
$logFile   = Join-Path $logDir 'backup.log'
$failMark  = Join-Path $Root 'БЕКЪПЪТ-НЕ-МИНА.txt'
$remoteTmp = '/tmp/tpbackup'

foreach ($d in @($Root, $logDir, $dailyDir)) {
    if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $line = '[{0}] {1,-5} {2}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Level, $Message
    Add-Content -Path $logFile -Value $line -Encoding utf8
    Write-Output $line
}

function Format-Size {
    param([long]$Bytes)
    if ($Bytes -ge 1GB) { return ('{0:N2} GB' -f ($Bytes / 1GB)) }
    if ($Bytes -ge 1MB) { return ('{0:N2} MB' -f ($Bytes / 1MB)) }
    if ($Bytes -ge 1KB) { return ('{0:N1} KB' -f ($Bytes / 1KB)) }
    return "$Bytes B"
}

# Ротация на лога (пази последните ~5 MB)
if ((Test-Path $logFile) -and ((Get-Item $logFile).Length -gt 5MB)) {
    Move-Item $logFile "$logFile.old" -Force
}

Write-Log "=== Старт на бекъп $stamp (цел: $destDir) ==="

# ---------------------------------------------------------------------------
# 1. Отдалечена част — сървърът си подготвя всичко в /tmp/tpbackup
# ---------------------------------------------------------------------------
$remoteScript = @'
#!/bin/bash
set -uo pipefail
APP=/opt/thepact-platform
OUT=/tmp/tpbackup
DB=thepact
FAIL=0

rm -rf "$OUT"; mkdir -p "$OUT/server" || exit 9

# --- база: plain SQL (възстановява се навсякъде с psql) ---
sudo -u postgres pg_dump "$DB" | gzip -9 > "$OUT/db-thepact.sql.gz"
if [ "${PIPESTATUS[0]}" -ne 0 ] || [ ! -s "$OUT/db-thepact.sql.gz" ]; then
  echo "ERR pg_dump (plain) се провали"; FAIL=1
fi

# --- база: custom формат (за избирателен restore с pg_restore) ---
sudo -u postgres pg_dump -Fc "$DB" > "$OUT/db-thepact.dump"
if [ $? -ne 0 ] || [ ! -s "$OUT/db-thepact.dump" ]; then
  echo "ERR pg_dump (custom) се провали"; FAIL=1
fi

# --- кодът, uploads, .env, google-credentials (без node_modules и .git) ---
tar czf "$OUT/app-thepact-platform.tar.gz" \
  --exclude=node_modules --exclude=.git \
  -C /opt thepact-platform
TAR_RC=$?
# tar връща 1 само при предупреждение (файл променен по време на четене) — не е фатално
if [ "$TAR_RC" -eq 1 ]; then echo "WARN tar предупреждение (файл се е променил по време на архивирането)"; fi
if [ "$TAR_RC" -gt 1 ] || [ ! -s "$OUT/app-thepact-platform.tar.gz" ]; then
  echo "ERR tar на приложението се провали (rc=$TAR_RC)"; FAIL=1
fi

# --- сървърни настройки ---
cp -a /etc/nginx/nginx.conf          "$OUT/server/nginx.conf"           2>/dev/null
cp -a /etc/nginx/sites-available     "$OUT/server/nginx-sites-available" 2>/dev/null
cp -a /root/.pm2/dump.pm2            "$OUT/server/pm2-dump.json"        2>/dev/null
cp -a /opt/whisper-service/server.py "$OUT/server/whisper-server.py"    2>/dev/null
crontab -l                         > "$OUT/server/root-crontab.txt"     2>/dev/null
pm2 jlist                          > "$OUT/server/pm2-jlist.json"       2>/dev/null
tar czf "$OUT/server-letsencrypt.tar.gz" -C /etc letsencrypt            2>/dev/null
tail -n 2000 /var/log/thepact-deploy.log > "$OUT/server/thepact-deploy.log" 2>/dev/null
tail -n 2000 /var/log/thepact-backup.log > "$OUT/server/thepact-backup.log" 2>/dev/null
{
  echo "date:  $(date -Is)"
  echo "host:  $(hostname)"
  echo "os:    $(. /etc/os-release; echo "$PRETTY_NAME")"
  echo "kernel:$(uname -r)"
  echo "node:  $(node -v 2>/dev/null)"
  echo "npm:   $(npm -v 2>/dev/null)"
  echo "psql:  $(psql --version 2>/dev/null)"
  echo "nginx: $(nginx -v 2>&1)"
  echo "--- df -h ---"; df -h
  echo "--- pm2 ---";   pm2 list --no-color 2>/dev/null
} > "$OUT/server/system-info.txt" 2>&1
tar czf "$OUT/server-config.tar.gz" -C "$OUT" server && rm -rf "$OUT/server"

# --- контролни суми + отчет за размерите ---
cd "$OUT" || exit 9
sha256sum *.gz *.dump > SHA256SUMS.txt 2>/dev/null
for f in *; do
  [ -f "$f" ] && echo "SIZE $f $(stat -c%s "$f")"
done
echo "ROWS $(sudo -u postgres psql -d "$DB" -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'") таблици в базата"
echo "DONE FAIL=$FAIL"
exit $FAIL
'@

# Скриптът се качва като файл (LF, без BOM) — подаването му като аргумент на ssh
# се чупи от начина, по който PowerShell предава кавички на външни програми.
$localTmp = Join-Path $env:TEMP 'tpbackup-remote.sh'
[IO.File]::WriteAllText($localTmp, ($remoteScript -replace "`r`n", "`n"), (New-Object Text.UTF8Encoding($false)))

Write-Log 'Стъпка 1/4 — сървърът подготвя дъмповете...'
& $scpExe @sshOpts '-q' $localTmp "${VpsTarget}:/tmp/tpbackup.sh"
if ($LASTEXITCODE -ne 0) {
    Write-Log 'Скриптът не можа да се качи на сървъра.' 'ERROR'
    Set-Content -Path $failMark -Encoding utf8 -Value "Бекъпът от $stamp НЕ мина — скриптът не се качи на сървъра. Виж $logFile"
    exit 1
}
Remove-Item $localTmp -Force -ErrorAction SilentlyContinue

$prepOut = & $sshExe @sshOpts $VpsTarget 'bash /tmp/tpbackup.sh'
$prepCode = $LASTEXITCODE
& $sshExe @sshOpts $VpsTarget 'rm -f /tmp/tpbackup.sh' | Out-Null

$remoteSizes = @{}
$sawDone = $false
foreach ($line in @($prepOut)) {
    if ($null -eq $line) { continue }
    $t = "$line".Trim()
    if ($t -match '^SIZE\s+(\S+)\s+(\d+)$') { $remoteSizes[$Matches[1]] = [long]$Matches[2] }
    elseif ($t -like 'DONE*')               { $sawDone = $true; Write-Log "  сървър: $t" }
    elseif ($t.Length -gt 0)                { Write-Log "  сървър: $t" }
}

if (-not $sawDone -and $prepCode -eq 0) {
    Write-Log 'Сървърът не докладва край на подготовката — приема се за провал.' 'ERROR'
    $prepCode = 8
}

if ($prepCode -ne 0) {
    Write-Log "Сървърната част се провали (exit $prepCode). Бекъпът се спира." 'ERROR'
    Set-Content -Path $failMark -Encoding utf8 -Value @"
Бекъпът от $stamp НЕ мина.
Сървърът не успя да подготви дъмповете (exit $prepCode).
Виж $logFile
"@
    exit 1
}

# ---------------------------------------------------------------------------
# 2. Сваляне на файловете
# ---------------------------------------------------------------------------
# Сваля се в отделна папка и чак след проверката заменя вчерашния/днешния бекъп,
# за да не остане нищо изтрито, ако свалянето прекъсне по средата.
$stageDir = Join-Path $dailyDir "$stamp.partial"
if (Test-Path $stageDir) { Remove-Item $stageDir -Recurse -Force }
New-Item -ItemType Directory -Path $stageDir -Force | Out-Null

Write-Log 'Стъпка 2/4 — сваляне на файловете...'
& $scpExe @sshOpts '-q' '-r' "${VpsTarget}:$remoteTmp/." $stageDir
$scpCode = $LASTEXITCODE

# Чистене на временната папка на сървъра — независимо от изхода на scp
& $sshExe @sshOpts $VpsTarget "rm -rf $remoteTmp" | Out-Null

if ($scpCode -ne 0) {
    Write-Log "Свалянето се провали (scp exit $scpCode)." 'ERROR'
    Remove-Item $stageDir -Recurse -Force -ErrorAction SilentlyContinue
    Set-Content -Path $failMark -Encoding utf8 -Value "Бекъпът от $stamp НЕ мина — свалянето се провали (scp exit $scpCode). Виж $logFile"
    exit 1
}

# ---------------------------------------------------------------------------
# 3. Проверка — файловете стигнаха ли цели
# ---------------------------------------------------------------------------
Write-Log 'Стъпка 3/4 — проверка на свалените файлове...'
$required = @('db-thepact.sql.gz', 'db-thepact.dump', 'app-thepact-platform.tar.gz', 'server-config.tar.gz')
$problems = @()
$files    = @()
$total    = 0L

foreach ($item in Get-ChildItem $stageDir -File) {
    $total += $item.Length
    $hash = (Get-FileHash $item.FullName -Algorithm SHA256).Hash.ToLower()
    $files += [ordered]@{ name = $item.Name; bytes = $item.Length; sha256 = $hash }

    if ($remoteSizes.ContainsKey($item.Name) -and $remoteSizes[$item.Name] -ne $item.Length) {
        $problems += "$($item.Name): различен размер (сървър $($remoteSizes[$item.Name]) B, тук $($item.Length) B)"
    }
    Write-Log ("  {0,-32} {1}" -f $item.Name, (Format-Size $item.Length))
}

foreach ($r in $required) {
    $p = Join-Path $stageDir $r
    if (-not (Test-Path $p))            { $problems += "$r липсва" }
    elseif ((Get-Item $p).Length -lt 1024) { $problems += "$r е подозрително малък" }
}

# .gz архивите трябва да започват с 1f 8b
foreach ($gz in Get-ChildItem $stageDir -File -Filter '*.gz') {
    $head = Get-Content $gz.FullName -Encoding Byte -TotalCount 2
    if ($head[0] -ne 0x1f -or $head[1] -ne 0x8b) { $problems += "$($gz.Name) не е валиден gzip архив" }
}

$duration = [int]((Get-Date) - $startedAt).TotalSeconds
$status   = 'ok'
if ($problems.Count -gt 0) { $status = 'problem' }

# Заменя днешния бекъп само ако всичко е наред; иначе счупеният остава настрани
if ($status -eq 'ok') {
    if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
    Move-Item $stageDir $destDir -Force
} else {
    $destDir = Join-Path $dailyDir "$stamp.problem"
    if (Test-Path $destDir) { Remove-Item $destDir -Recurse -Force }
    Move-Item $stageDir $destDir -Force
}

$manifest = [ordered]@{
    date       = $stamp
    started_at = $startedAt.ToString('s')
    duration_s = $duration
    source     = $VpsTarget
    status     = $status
    total_bytes = $total
    total_human = (Format-Size $total)
    files      = $files
    problems   = $problems
}
$manifest | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $destDir 'manifest.json') -Encoding utf8

if ($problems.Count -gt 0) {
    foreach ($p in $problems) { Write-Log "  ПРОБЛЕМ: $p" 'ERROR' }
}

# ---------------------------------------------------------------------------
# 4. Ротация — дневните се пазят KeepDays, тези от 1-во число KeepMonths
# ---------------------------------------------------------------------------
$deleted = 0
if (-not $NoRetention) {
    Write-Log 'Стъпка 4/4 — чистене на старите бекъпи...'
    foreach ($dir in Get-ChildItem $dailyDir -Directory) {
        $d = [datetime]::MinValue
        $namePart = ($dir.Name -split '\.')[0]
        if (-not [datetime]::TryParseExact($namePart, 'yyyy-MM-dd', $null, 'None', [ref]$d)) { continue }
        $ageDays = ($startedAt.Date - $d.Date).Days
        $limit = $KeepDays
        if ($d.Day -eq 1) { $limit = $KeepMonths * 31 }
        # недовършени/счупени папки не се пазят дълго
        if ($dir.Name -ne $namePart) { $limit = 3 }
        if ($ageDays -gt $limit) {
            Remove-Item $dir.FullName -Recurse -Force
            Write-Log "  изтрит стар бекъп: $($dir.Name)"
            $deleted++
        }
    }
}

$kept     = (Get-ChildItem $dailyDir -Directory).Count
$usedSize = (Get-ChildItem $dailyDir -Recurse -File | Measure-Object Length -Sum).Sum

$state = [ordered]@{
    last_run    = $startedAt.ToString('s')
    status      = $status
    date        = $stamp
    duration_s  = $duration
    size        = (Format-Size $total)
    backups_kept = $kept
    deleted_now = $deleted
    total_size  = (Format-Size $usedSize)
    problems    = $problems
    path        = $destDir
}
$state | ConvertTo-Json -Depth 5 | Set-Content (Join-Path $Root 'last-run.json') -Encoding utf8

if ($status -eq 'ok') {
    if (Test-Path $failMark) { Remove-Item $failMark -Force }
    Write-Log "=== Готово за ${duration}s — $(Format-Size $total), пазени бекъпи: $kept ($(Format-Size $usedSize)) ==="
    exit 0
} else {
    Set-Content -Path $failMark -Encoding utf8 -Value @"
Бекъпът от $stamp мина с проблеми:
$($problems -join "`r`n")

Виж $logFile
"@
    Write-Log "=== Приключи с ПРОБЛЕМИ за ${duration}s ===" 'ERROR'
    exit 2
}
