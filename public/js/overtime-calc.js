// ==================== OVERTIME: сметката ====================
// Един и същ файл се ползва и от браузъра (живата сметка във формата), и от
// сървъра (src/routes/overtime.js го require-ва) — така числото, което човек
// вижда преди „Запиши", е точно това, което се записва.
//
// Правила (Венци, 02.11.2026): работно време 10:00–19:00 в делник (8 ч + 1 ч обяд).
// Overtime = времето ИЗВЪН 10:00–19:00 в делник; в събота, неделя и официален
// празник — целият интервал. „До" < „От" = минава през полунощ, като частта след
// полунощ се смята по правилата на следващия ден.
(function (root) {
  const WORK_FROM = 10 * 60, WORK_TO = 19 * 60;
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate());
  const parseD = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
  const addDays = (s, n) => { const d = parseD(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };
  const toMin = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); if (!m) return NaN; const h = +m[1], mm = +m[2]; return h < 24 && mm < 60 ? h * 60 + mm : NaN; };
  const hhmm = (m) => pad(Math.floor((m % 1440) / 60)) + ':' + pad(m % 60);

  // Православен Великден (юлиански алгоритъм на Meeus + 13 дни за 1900–2099).
  function easter(y) {
    const a = y % 4, b = y % 7, c = y % 19, d = (19 * c + 15) % 30, e = (2 * a + 4 * b - d + 34) % 7;
    const month = Math.floor((d + e + 114) / 31), day = ((d + e + 114) % 31) + 1;
    const dt = new Date(Date.UTC(y, month - 1, day)); dt.setUTCDate(dt.getUTCDate() + 13);
    return ymd(dt);
  }

  // Официалните почивни дни в България (Кодекс на труда, чл. 154), вкл. пренасянето:
  // празник в събота/неделя → първият следващ работен ден е почивен.
  // Допълнителни „мостове" с решение на МС не се знаят предварително — не са вътре.
  const _cache = {};
  function holidays(y) {
    if (_cache[y]) return _cache[y];
    const map = {};
    const fixed = { '01-01': 'Нова година', '03-03': 'Освобождението', '05-01': 'Ден на труда', '05-06': 'Гергьовден',
      '05-24': '24 май', '09-06': 'Съединението', '09-22': 'Независимостта', '12-24': 'Бъдни вечер', '12-25': 'Коледа', '12-26': 'Коледа' };
    Object.keys(fixed).forEach((k) => { map[y + '-' + k] = fixed[k]; });
    const e = easter(y);
    map[addDays(e, -2)] = 'Разпети петък'; map[addDays(e, -1)] = 'Великден'; map[e] = 'Великден'; map[addDays(e, 1)] = 'Великден';
    const isWeekend = (s) => { const w = parseD(s).getUTCDay(); return w === 0 || w === 6; };
    Object.keys(fixed).forEach((k) => {
      const s = y + '-' + k;
      if (!isWeekend(s)) return;
      let n = addDays(s, 1);
      while (isWeekend(n) || map[n]) n = addDays(n, 1);
      map[n] = fixed[k] + ' (почивен)';
    });
    return (_cache[y] = map);
  }

  // null = работен ден; иначе текст защо е почивен
  function dayOff(s) {
    const h = holidays(Number(s.slice(0, 4)))[s];
    if (h) return h;
    const w = parseD(s).getUTCDay();
    return w === 6 ? 'събота' : w === 0 ? 'неделя' : null;
  }

  // → { total, ot, parts:[{from,to,ot,label}], nextDay } или { error }
  function calc(date, from, to) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) || isNaN(parseD(date))) return { error: 'Избери дата.' };
    const a = toMin(from); let b = toMin(to);
    if (isNaN(a) || isNaN(b)) return { error: 'Попълни „От" и „До".' };
    if (a === b) return { error: '„От" и „До" са еднакви.' };
    const nextDay = b < a; if (nextDay) b += 1440;
    const parts = [];
    for (let base = 0; base < b; base += 1440) {
      const day = addDays(date, base / 1440);
      const s = Math.max(a, base), e = Math.min(b, base + 1440);
      if (e <= s) continue;
      const off = dayOff(day);
      if (off) { parts.push({ from: s, to: e, ot: true, label: 'почивен ден (' + off + ')' }); continue; }
      const ws = base + WORK_FROM, we = base + WORK_TO;
      if (s < ws) parts.push({ from: s, to: Math.min(e, ws), ot: true, label: 'преди работно време' });
      if (e > ws && s < we) parts.push({ from: Math.max(s, ws), to: Math.min(e, we), ot: false, label: 'редовно работно време' });
      if (e > we) parts.push({ from: Math.max(s, we), to: e, ot: true, label: 'след работно време' });
    }
    const real = parts.filter((p) => p.to > p.from);
    const ot = real.filter((p) => p.ot).reduce((sum, p) => sum + p.to - p.from, 0);
    return { total: b - a, ot, parts: real, nextDay };
  }

  // „Минус време" (Венци, 19.11.2026): админът записва на човек закъснение, тръгване по-рано,
  // отсъствие в работно време или ръчно часове. kind: late | early | absence | other.
  //   late    — at = кога е дошъл     → at − 10:00
  //   early   — at = кога си е тръгнал → 19:00 − at
  //   absence — from–to                 → припокриването с 10:00–19:00, най-много 8 ч
  //   other   — minutes (ръчно)
  // → { minutes, label } или { error }
  const DED_KINDS = { late: 'Закъснение', early: 'Тръгнал по-рано', absence: 'Отсъствие', other: 'Друго' };
  function deduction(o) {
    o = o || {};
    const kind = o.kind;
    if (!DED_KINDS[kind]) return { error: 'Избери тип.' };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(o.date || '')) || isNaN(parseD(o.date))) return { error: 'Избери дата.' };
    if (kind === 'other') {
      const m = Math.round(Number(o.minutes));
      if (!(m > 0)) return { error: 'Напиши колко часа/минути.' };
      if (m > 24 * 60) return { error: 'Най-много 24 ч наведнъж.' };
      return { minutes: m, label: 'ръчно' };
    }
    if (dayOff(o.date)) return { error: 'Почивен ден (' + dayOff(o.date) + ') — няма работно време. Ползвай „Друго".' };
    if (kind === 'late' || kind === 'early') {
      const a = toMin(o.at);
      if (isNaN(a)) return { error: kind === 'late' ? 'Кога е дошъл?' : 'Кога си е тръгнал?' };
      if (kind === 'late') {
        if (a <= WORK_FROM) return { error: 'Преди 10:00 не е закъснение.' };
        return { minutes: Math.min(a, WORK_TO) - WORK_FROM, label: 'дошъл в ' + hhmm(a) + ' вместо 10:00' };
      }
      if (a >= WORK_TO) return { error: 'След 19:00 не е тръгване по-рано.' };
      return { minutes: WORK_TO - Math.max(a, WORK_FROM), label: 'тръгнал в ' + hhmm(a) + ' вместо 19:00' };
    }
    const f = toMin(o.from), t = toMin(o.to);
    if (isNaN(f) || isNaN(t)) return { error: 'Попълни „От" и „До".' };
    if (t <= f) return { error: '„До" трябва да е след „От".' };
    const overlap = Math.max(0, Math.min(t, WORK_TO) - Math.max(f, WORK_FROM));
    if (!overlap) return { error: 'Интервалът е извън работното време (10:00–19:00).' };
    return { minutes: Math.min(overlap, 8 * 60), label: 'отсъствал ' + hhmm(f) + '–' + hhmm(t) };
  }

  const api = { calc, dayOff, holidays, easter, hhmm, toMin, addDays, deduction, DED_KINDS };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OvertimeCalc = api;
})(typeof window !== 'undefined' ? window : this);
