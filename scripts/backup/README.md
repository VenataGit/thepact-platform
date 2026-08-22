Тук живеят два различни бекъпа:

* **[Платформата](#локален-бекъп-на-платформата)** — код + база + сървърни настройки от VPS-а,
  всяка нощ в `D:\PlatformBackup`. За вдигане на платформата отначало.
* **[Задачите от Basecamp](#бекъп-на-задачите-от-basecamp)** — един четим HTML с всички
  карти на Video Production, всяка събота в `Z:\Backup - платформа и бейскамп`.
  За да не изчезне информацията по задачите, ако Basecamp го няма.

---

# Локален бекъп на платформата

Всяка нощ в **00:00** компютърът тегли цялата платформа от VPS-а и я слага в
`D:\PlatformBackup`. Целта е: ако утре хостингът изчезне, всичко необходимо за
вдигане на платформата отначало да е тук, локално.

## Какво се тегли

| Файл | Съдържание |
|---|---|
| `db-thepact.sql.gz` | Цялата база като обикновен SQL (възстановява се навсякъде с `psql`) |
| `db-thepact.dump` | Същата база в custom формат (за избирателен restore с `pg_restore`) |
| `app-thepact-platform.tar.gz` | Кодът, `uploads/`, `.env`, `google-credentials.json` (без `node_modules` и `.git` — те са в GitHub / npm) |
| `server-config.tar.gz` | nginx конфигурации, crontab, PM2 списък, `whisper-service/server.py`, deploy/backup логове, system-info |
| `server-letsencrypt.tar.gz` | SSL сертификатите |
| `SHA256SUMS.txt` | Контролни суми (правят се на сървъра, преди сваляне) |
| `manifest.json` | Размери, контролни суми и проблеми от конкретния бекъп |

## Къде стои

```
D:\PlatformBackup\
  daily\2026-07-31\     ← един бекъп на ден
  logs\backup.log       ← лог на всяко пускане
  last-run.json         ← състояние на последното пускане
```

Пазят се последните **30 дни**, а бекъпите от 1-во число на месеца — **24 месеца**.
При ~36 MB на ден това е под 1.5 GB.

Ако нещо се счупи, се появява файл `D:\PlatformBackup\БЕКЪПЪТ-НЕ-МИНА.txt`
и се трие сам при първото успешно пускане.

## Как се пуска ръчно

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Claude ThePact\thepact-platform\scripts\backup\backup-platform.ps1"
```

Задачата в Task Scheduler се казва `ThePactPlatformBackup`:

```powershell
schtasks /Query /TN ThePactPlatformBackup /V /FO LIST   # състояние
schtasks /Run   /TN ThePactPlatformBackup               # пускане веднага
```

## Възстановяване на нов сървър

```bash
# 1. Кодът
tar xzf app-thepact-platform.tar.gz -C /opt
cd /opt/thepact-platform && npm install --production

# 2. Базата
sudo -u postgres createdb thepact
gunzip -c db-thepact.sql.gz | sudo -u postgres psql -d thepact
#   (или избирателно: sudo -u postgres pg_restore -d thepact db-thepact.dump)

# 3. nginx + SSL
tar xzf server-config.tar.gz
cp server/nginx-sites-available/thepact /etc/nginx/sites-available/thepact
ln -sf /etc/nginx/sites-available/thepact /etc/nginx/sites-enabled/thepact
tar xzf server-letsencrypt.tar.gz -C /etc
nginx -t && systemctl reload nginx

# 4. Стартиране
pm2 start /opt/thepact-platform/src/server.js --name thepact-v2
pm2 save
```

`.env` и `google-credentials.json` са вътре в архива на приложението — не се
налага да се вадят отникъде другаде.

## Как работи

`backup-platform.ps1` качва един bash скрипт на сървъра, той прави дъмповете в
`/tmp/tpbackup`, PowerShell ги сваля със `scp`, сверява размерите и контролните
суми и чак тогава подменя папката за деня. Ако свалянето прекъсне по средата,
предишният бекъп остава непокътнат (недовършеното стои като `<дата>.partial`).

Бележка: файлът трябва да се пази като **UTF-8 с BOM** — иначе Windows
PowerShell 5.1 не чете кирилицата и скриптът не се компилира.

## Не се бърка с бекъпа на сървъра

На VPS-а върви `scripts/backup.sh` (cron, 00:00 UTC), който пази 14 дни дъмпове
на базата в `/opt/backups/db` — но те са на същата машина. Локалният бекъп е
този, който оцелява при смърт на хостинга.

---

# Бекъп на задачите от Basecamp

Всяка **събота в 18:00** компютърът тегли от платформата целия проект
**Video Production** и го записва като един четим файл в
`Z:\Backup - платформа и бейскамп` (папката на сървъра).

Целта е друга от горния бекъп: не да се вдигне платформата, а **да не изчезне
информацията по задачите**, ако някой ден Basecamp или платформата ги няма.

## Какво се получава

```
Z:\Backup - платформа и бейскамп\
  Video Production - задачи (АКТУАЛЕН).html   ← отваря се с двоен клик
  Video Production - задачи (АКТУАЛЕН).json   ← същото като данни (за машина)
  ПОСЛЕДЕН БЕКЪП.txt                          ← кога, колко задачи, колко голямо
  лог-на-бекъпа.txt
  Архив\Video Production - задачи 2026-08-22.html   ← последните 12 датирани копия
```

Двата „АКТУАЛЕН" файла се **пренаписват** всеки път — те са винаги най-новото
състояние. Датираните копия в `Архив` са историята.

## Какво влиза във файла

| | |
|---|---|
| Дъски | Pre-Production, Production, Post-Production, Project Management |
| Колони | всички, включително Not now, On hold и Done |
| По всяка карта | описание, стъпки с датите и хората, отговорници, срок, коментари |
| To-do | dock-овете „Tasks" и „ThePact.pro / платформа" |
| Отчетено време | от платформата — това го няма никъде в Basecamp |

HTML-ът е самостоятелен: собствени стилове, търсачка и разгъване, без нито един
външен файл. Отваря се **без интернет и без логин**.

Прикачените файлове и снимките **не** влизат — те остават на сървърите на
Basecamp, а линковете в описанията водят към тях.

## Как работи

`backup-basecamp.ps1` дърпа `GET /api/backup/basecamp` от thepact.pro (ключът е
същият като на Dev Queue — `X-Dev-Queue-Key`, чете се от
`D:\Claude ThePact\autodev\config.json`). Сървърът сглобява снимката с токена на
бота ThePactAlerts и връща готовия HTML. Старият бекъп се подменя **чак след**
като новият файл е проверен (има `</html>`, JSON-ът се чете, има поне една карта) —
провалено теглене не изтрива миналата седмица, а оставя `БЕКЪПЪТ-НЕ-МИНА.txt`.

## Как се пуска ръчно

```powershell
powershell -ExecutionPolicy Bypass -File "D:\Claude ThePact\thepact-platform\scripts\backup\backup-basecamp.ps1"
```

Задачата в Task Scheduler се казва `ThePactBasecampBackup`:

```powershell
schtasks /Query /TN ThePactBasecampBackup /V /FO LIST   # състояние
schtasks /Run   /TN ThePactBasecampBackup               # пускане веднага
```

Ако някога трябва да се създаде наново:

```powershell
schtasks /Create /TN ThePactBasecampBackup /SC WEEKLY /D SAT /ST 18:00 /F ^
  /TR "wscript.exe //B \"D:\Claude ThePact\thepact-platform\scripts\backup\run-basecamp-backup-hidden.vbs\""
```

## Всеки ден вместо веднъж седмично

Едно пускане отнема под минута и файлът е няколко мегабайта, така че всекидневен
бекъп е напълно поносим. Превключва се с една команда — без `/D SAT` и с друг час:

```powershell
schtasks /Change /TN ThePactBasecampBackup /SC DAILY /ST 20:00
```

Ако тогава историята стане излишна, `-NoArchive` спира датираните копия и остава
само един винаги-актуален файл.

Бележка: и този скрипт се пази като **UTF-8 с BOM** (виж по-горе защо).
