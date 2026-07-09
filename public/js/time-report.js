// ==================== ОТЧЕТ „ВРЕМЕ" (само за админ) ====================
// Детайлни разбивки на изработеното време от The Pact Tools таймерите:
// общо / по хора / по клиенти (Basecamp проекти) / по задачи / по дни,
// живо „кой работи сега" и списък на записите поединично + CSV. Данните
// идват от /api/time/report* (requireAdmin на API ниво).

let _trState = { from: null, to: null, filter: null, data: null };

function trFmtDur(secs) {
  secs = Math.max(0, Math.round(Number(secs) || 0));
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  if (!h && !m) return '0м';
  return (h ? h + 'ч ' : '') + (m ? m + 'м' : '');
}

function trDateStr(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function trPreset(kind) {
  const now = new Date();
  const today = trDateStr(now);
  if (kind === 'today') return { from: today, to: today };
  if (kind === 'week') {
    const d = new Date(now);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // понеделник
    return { from: trDateStr(d), to: today };
  }
  if (kind === 'month') {
    return { from: trDateStr(new Date(now.getFullYear(), now.getMonth(), 1)), to: today };
  }
  const d30 = new Date(now); d30.setDate(d30.getDate() - 29);
  return { from: trDateStr(d30), to: today };
}

async function renderTimeReport(el) {
  el.className = 'flush-top';
  if (!currentUser || currentUser.role !== 'admin') {
    el.innerHTML = '<div class="home-content-box"><h2>⏱ Време</h2><p>Тази страница е само за администратор.</p></div>';
    return;
  }
  if (!_trState.from) Object.assign(_trState, trPreset('week'), { filter: null });

  el.innerHTML = `
    <div class="home-content-box home-content-box--wide tr-page">
      <div class="tr-head">
        <h2>⏱ Време</h2>
        <div class="tr-presets">
          <button class="tr-preset" data-p="today">Днес</button>
          <button class="tr-preset" data-p="week">Тази седмица</button>
          <button class="tr-preset" data-p="month">Този месец</button>
          <button class="tr-preset" data-p="30">30 дни</button>
        </div>
        <div class="tr-range">
          <input type="date" id="trFrom" value="${_trState.from}">
          <span>—</span>
          <input type="date" id="trTo" value="${_trState.to}">
          <button class="tr-apply" id="trApply">Покажи</button>
          <button class="tr-csv" id="trCsv" title="Сваля записите за периода като CSV">⬇ CSV</button>
        </div>
      </div>
      <div class="tr-live" id="trLive"></div>
      <div class="tr-tiles" id="trTiles"></div>
      <div class="tr-grid">
        <div class="tr-box"><h3>По хора</h3><div id="trByUser"></div></div>
        <div class="tr-box"><h3>По клиенти / проекти</h3><div id="trByProject"></div></div>
      </div>
      <div class="tr-box"><h3>По дни</h3><div id="trByDay" class="tr-days"></div></div>
      <div class="tr-box"><h3 id="trTasksTitle">Топ задачи</h3><div id="trByTask"></div></div>
      <div class="tr-box"><h3 id="trEntriesTitle">Записи</h3><div id="trEntries" class="tr-entries"></div></div>
    </div>`;

  el.querySelectorAll('.tr-preset').forEach((b) => b.addEventListener('click', () => {
    Object.assign(_trState, trPreset(b.dataset.p), { filter: null });
    renderTimeReport(el);
  }));
  document.getElementById('trApply').addEventListener('click', () => {
    _trState.from = document.getElementById('trFrom').value || _trState.from;
    _trState.to = document.getElementById('trTo').value || _trState.to;
    _trState.filter = null;
    renderTimeReport(el);
  });
  document.getElementById('trCsv').addEventListener('click', trExportCsv);

  // живо опресняване на „кой работи сега", докато страницата е отворена
  window._trOnWorking = () => { if (location.hash.startsWith('#/time-report')) trLoadLive(); };

  trLoadLive();
  await trLoadReport();
  await trLoadEntries();
}

async function trLoadLive() {
  const host = document.getElementById('trLive');
  if (!host) return;
  try {
    const list = await (await fetch('/api/time/active')).json();
    if (!Array.isArray(list) || !list.length) {
      host.innerHTML = '<span class="tr-live__none">🟢 В момента никой не следи време.</span>';
      return;
    }
    host.innerHTML = list.map((e) => {
      const mins = Math.max(1, Math.round((Date.now() - new Date(e.startedAt).getTime()) / 60000));
      return '<span class="tr-live__item">🔴 <b>' + esc(e.userName || '') + '</b> — ' +
        esc(e.title || 'задача') + ' <i>(' + mins + ' мин' + (e.isManual ? '' : '') + ')</i></span>';
    }).join('');
  } catch { /* ignore */ }
}

async function trLoadReport() {
  const q = '?from=' + _trState.from + '&to=' + _trState.to;
  const r = await fetch('/api/time/report' + q);
  if (!r.ok) return;
  const data = await r.json();
  _trState.data = data;

  const t = data.totals || {};
  document.getElementById('trTiles').innerHTML = [
    ['Общо време', trFmtDur(t.seconds)],
    ['Души', String(t.users || 0)],
    ['Задачи', String(t.tasks || 0)],
    ['Сегменти', String(t.entries || 0)],
    ['Ръчно въведено', trFmtDur(t.manual_seconds)]
  ].map((x) => '<div class="tr-tile"><div class="tr-tile__num">' + x[1] + '</div><div class="tr-tile__label">' + x[0] + '</div></div>').join('');

  const bars = (rows, labelFn, secsFn, clickFn) => {
    if (!rows || !rows.length) return '<div class="tr-empty">Няма данни за периода.</div>';
    const max = Math.max(...rows.map(secsFn), 1);
    return rows.map((row, i) => {
      const secs = secsFn(row);
      return '<div class="tr-row" data-i="' + i + '">' +
        '<div class="tr-row__label">' + labelFn(row) + '</div>' +
        '<div class="tr-row__bar"><div class="tr-row__fill" style="width:' + Math.max(2, Math.round(secs / max * 100)) + '%"></div></div>' +
        '<div class="tr-row__val">' + trFmtDur(secs) + '</div>' +
      '</div>';
    }).join('');
  };

  const byUserHost = document.getElementById('trByUser');
  byUserHost.innerHTML = bars(data.byUser, (u) => esc(u.name) +
    (Number(u.manual_seconds) ? ' <span class="tr-manual" title="от които ръчно въведени">✎ ' + trFmtDur(u.manual_seconds) + '</span>' : ''),
    (u) => Number(u.seconds));
  byUserHost.querySelectorAll('.tr-row').forEach((row) => row.addEventListener('click', () => {
    const u = data.byUser[Number(row.dataset.i)];
    _trState.filter = { user_id: u.user_id, label: 'човек: ' + u.name };
    trLoadEntries();
  }));

  const byProjHost = document.getElementById('trByProject');
  byProjHost.innerHTML = bars(data.byProject,
    (p) => esc(p.project_name) + ' <span class="tr-dim">(' + p.users + ' души)</span>',
    (p) => Number(p.seconds));
  byProjHost.querySelectorAll('.tr-row').forEach((row) => row.addEventListener('click', () => {
    const p = data.byProject[Number(row.dataset.i)];
    _trState.filter = { project_id: p.bc_project_id, label: 'проект: ' + p.project_name };
    trLoadEntries();
  }));

  const days = data.byDay || [];
  const maxDay = Math.max(...days.map((d) => Number(d.seconds)), 1);
  document.getElementById('trByDay').innerHTML = days.length
    ? days.map((d) => '<div class="tr-day" title="' + d.day + ' — ' + trFmtDur(d.seconds) + '">' +
        '<div class="tr-day__bar"><div class="tr-day__fill" style="height:' + Math.max(3, Math.round(Number(d.seconds) / maxDay * 100)) + '%"></div></div>' +
        '<div class="tr-day__label">' + d.day.slice(8, 10) + '.' + d.day.slice(5, 7) + '</div>' +
      '</div>').join('')
    : '<div class="tr-empty">Няма данни за периода.</div>';

  const tasks = data.byTask || [];
  document.getElementById('trByTask').innerHTML = tasks.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Задача</th><th>Проект</th><th>Души</th><th style="text-align:right">Време</th></tr></thead><tbody>' +
      tasks.map((x, i) => '<tr class="tr-task" data-i="' + i + '"><td>' + esc(x.title || '(без заглавие)') + '</td><td>' +
        esc(x.project_name || '') + '</td><td>' + x.users + '</td><td style="text-align:right"><b>' + trFmtDur(x.seconds) + '</b></td></tr>').join('') +
      '</tbody></table>'
    : '<div class="tr-empty">Няма данни за периода.</div>';
  document.querySelectorAll('.tr-task').forEach((row) => row.addEventListener('click', () => {
    const x = tasks[Number(row.dataset.i)];
    _trState.filter = { recording_id: x.bc_recording_id, label: 'задача: ' + (x.title || x.bc_recording_id) };
    trLoadEntries();
  }));
}

function trEntriesQuery() {
  let q = '?from=' + _trState.from + '&to=' + _trState.to;
  const f = _trState.filter || {};
  if (f.user_id) q += '&user_id=' + f.user_id;
  if (f.project_id) q += '&project_id=' + f.project_id;
  if (f.recording_id) q += '&recording_id=' + f.recording_id;
  return q;
}

async function trLoadEntries() {
  const host = document.getElementById('trEntries');
  const title = document.getElementById('trEntriesTitle');
  if (!host) return;
  const f = _trState.filter;
  title.innerHTML = 'Записи' + (f ? ' <span class="tr-filterchip">' + esc(f.label) +
    ' <a href="#" id="trClearFilter" title="Махни филтъра">✕</a></span>' : '');
  const r = await fetch('/api/time/report/entries' + trEntriesQuery());
  if (!r.ok) return;
  const rows = await r.json();
  host.innerHTML = rows.length
    ? '<table class="admin-table tr-table"><thead><tr><th>Кога</th><th>Човек</th><th>Задача</th><th>Проект</th><th style="text-align:right">Време</th><th>Източник</th></tr></thead><tbody>' +
      rows.map((e) => {
        const st = new Date(e.startedAt);
        const when = st.toLocaleDateString('bg-BG', { day: '2-digit', month: '2-digit' }) + ' ' +
          st.toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' }) +
          (e.endedAt ? '–' + new Date(e.endedAt).toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' }) : '');
        const dur = e.endedAt ? trFmtDur(e.durationSeconds) : '<span class="tr-runchip">върви ⏱</span>';
        const src = e.isManual ? '<span class="tr-badge tr-badge--manual">ръчен</span>'
          : (e.stoppedBy === 'sweeper' ? '<span class="tr-badge" title="затворен автоматично при липса на пулс">авто-стоп</span>' : '<span class="tr-badge">таймер</span>');
        const link = e.url ? ' <a href="' + esc(e.url) + '" target="_blank" title="Отвори в Basecamp">↗</a>' : '';
        return '<tr><td>' + when + '</td><td>' + esc(e.userName || '') + '</td><td>' + esc(e.title || '') + link +
          '</td><td>' + esc(e.projectName || '') + '</td><td style="text-align:right"><b>' + dur + '</b></td><td>' + src + '</td></tr>';
      }).join('') + '</tbody></table>'
    : '<div class="tr-empty">Няма записи за този филтър.</div>';
  const clear = document.getElementById('trClearFilter');
  if (clear) clear.addEventListener('click', (e) => { e.preventDefault(); _trState.filter = null; trLoadEntries(); });
}

async function trExportCsv() {
  const r = await fetch('/api/time/report/entries' + trEntriesQuery());
  if (!r.ok) return;
  const rows = await r.json();
  const q = (s) => '"' + String(s === null || s === undefined ? '' : s).replace(/"/g, '""') + '"';
  const lines = ['Начало;Край;Човек;Задача;Проект;Секунди;Часове;Ръчен;Бележка'];
  rows.forEach((e) => lines.push([
    q(e.startedAt), q(e.endedAt || ''), q(e.userName || ''), q(e.title || ''), q(e.projectName || ''),
    e.durationSeconds || 0, ((e.durationSeconds || 0) / 3600).toFixed(2).replace('.', ','),
    e.isManual ? 'да' : 'не', q(e.note || '')
  ].join(';')));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'thepact-time-' + _trState.from + '-' + _trState.to + '.csv';
  a.click();
  URL.revokeObjectURL(a.href);
}
