#!/bin/bash
# Безопасен deploy (04.11.2026, стабилност). Копие в git; на VPS-а живее като
# /opt/thepact-platform/scripts/deploy.sh (cron всяка минута).
#
# Разлики със стария:
#  - тестовете минават в отделно копие (git worktree) ПРЕДИ новата версия да стане жива;
#    при провал на живо остава старата версия и Венци получава сигнал (веднъж за версия);
#  - рестарт само след успешен fast-forward (на 2–3.09 pull-ът гърмеше, а PM2 се
#    рестартираше всяка минута два дни);
#  - без ред в лога всяка минута („Already up to date" беше 1 млн реда / 62 MB).
cd /opt/thepact-platform || exit 1
LOG=/var/log/thepact-deploy.log
FAILED=/var/tmp/thepact-deploy-failed
TMP=/var/tmp/thepact-test
log() { echo "[$(date)] $*" >> "$LOG"; }

exec 9>/var/tmp/thepact-deploy.lock
flock -n 9 || exit 0

git fetch -q origin main 2>>"$LOG" || { log "git fetch не мина"; exit 0; }
LOCAL=$(git rev-parse HEAD)
REMOTE=$(git rev-parse origin/main)
[ "$LOCAL" = "$REMOTE" ] && exit 0
# тази версия вече е тествана и е паднала — чакаме следващ push
[ -f "$FAILED" ] && [ "$(cat "$FAILED")" = "$REMOTE" ] && exit 0

log "нова версия ${REMOTE:0:7} (живата е ${LOCAL:0:7}) — тестове…"
rm -rf "$TMP"; git worktree prune
git worktree add -f --detach "$TMP" "$REMOTE" >>"$LOG" 2>&1 || { log "worktree не мина"; exit 0; }

DEPS_CHANGED=0
git diff --quiet "$LOCAL" "$REMOTE" -- package.json package-lock.json || DEPS_CHANGED=1
if [ $DEPS_CHANGED = 1 ]; then
  (cd "$TMP" && npm ci --no-audit --no-fund >>"$LOG" 2>&1)
else
  ln -s /opt/thepact-platform/node_modules "$TMP/node_modules"
fi

(cd "$TMP" && NODE_ENV=test timeout 600 npx jest --forceExit > /var/tmp/thepact-test.out 2>&1)
RC=$?
if [ $RC != 0 ]; then
  SUMMARY=$(grep -E "●.*›|Tests:" /var/tmp/thepact-test.out | head -6 | tr '\n' ' ')
  log "ТЕСТОВЕТЕ НЕ МИНАХА ($RC) — остава ${LOCAL:0:7}. $SUMMARY"
  echo "$REMOTE" > "$FAILED"
  node scripts/system-signal.js deploy-failed "версия ${REMOTE:0:7}: ${SUMMARY:-код $RC}" >>"$LOG" 2>&1
  rm -rf "$TMP"; git worktree prune
  exit 0
fi
rm -rf "$TMP"; git worktree prune

git merge --ff-only "$REMOTE" >>"$LOG" 2>&1 || {
  log "git merge --ff-only не мина — НЕ рестартирам"
  echo "$REMOTE" > "$FAILED"
  node scripts/system-signal.js deploy-failed "git не може да приеме версия ${REMOTE:0:7} (историята е пренаписана?)" >>"$LOG" 2>&1
  exit 0
}
if [ $DEPS_CHANGED = 1 ]; then
  log "package.json е сменен — npm install"
  npm install --no-audit --no-fund >>"$LOG" 2>&1
fi
log "тестовете минаха — рестарт с ${REMOTE:0:7}"
pm2 restart thepact-v2 --update-env >>"$LOG" 2>&1
rm -f "$FAILED"
node scripts/system-signal.js deploy-ok >>"$LOG" 2>&1
exit 0
