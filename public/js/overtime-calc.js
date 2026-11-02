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

  const api = { calc, dayOff, holidays, easter, hhmm, toMin, addDays };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.OvertimeCalc = api;
})(typeof window !== 'undefined' ? window : this);
