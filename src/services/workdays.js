// Working-day math that skips weekends AND Bulgarian official non-working holidays
// (Labour Code Art. 154), so deadlines reflect that the team rests on holidays.
//
// Included: 1 Jan, 3 Mar, 1 May, 6 May, 24 May, 6 Sep, 22 Sep, 24/25/26 Dec, and the
// Orthodox Easter cluster (Good Friday, Holy Saturday, Easter Sunday & Monday — movable).
// Weekend-shift rule: when a FIXED holiday falls on Sat/Sun, the next working day(s) are off.
// NOT included: 1 Nov (Ден на народните будители) — non-working only for schools, not companies.

const FIXED = [[1, 1], [3, 3], [5, 1], [5, 6], [5, 24], [9, 6], [9, 22], [12, 24], [12, 25], [12, 26]];

function pad(n) { return n < 10 ? '0' + n : '' + n; }
function ymd(d) { return d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()); }
function parse(dateStr) { return new Date(String(dateStr).slice(0, 10) + 'T00:00:00Z'); }
function isWeekend(d) { const w = d.getUTCDay(); return w === 0 || w === 6; }

// Orthodox (Eastern) Easter, Gregorian date — Meeus Julian algorithm + 13-day shift (valid 1900–2099).
function orthodoxEaster(year) {
  const a = year % 4, b = year % 7, c = year % 19;
  const d = (19 * c + 15) % 30;
  const e = (2 * a + 4 * b - d + 34) % 7;
  const month = Math.floor((d + e + 114) / 31); // 3 = March, 4 = April
  const day = ((d + e + 114) % 31) + 1;
  const easter = new Date(Date.UTC(year, month - 1, day));
  easter.setUTCDate(easter.getUTCDate() + 13);
  return easter;
}

const _cache = {};
function holidaySet(year) {
  if (_cache[year]) return _cache[year];
  const set = new Set();
  const fixedDates = FIXED.map(([m, d]) => new Date(Date.UTC(year, m - 1, d)));
  fixedDates.forEach((d) => set.add(ymd(d)));
  // Easter cluster — no weekend-shift for these (they are tied to the weekend by definition).
  const easter = orthodoxEaster(year);
  [-2, -1, 0, 1].forEach((off) => { const d = new Date(easter); d.setUTCDate(d.getUTCDate() + off); set.add(ymd(d)); });
  // Weekend-shift: a fixed holiday on Sat/Sun pushes the next working day(s) to non-working.
  fixedDates.slice().sort((a, b) => a - b).forEach((d) => {
    if (isWeekend(d)) {
      const c = new Date(d);
      do { c.setUTCDate(c.getUTCDate() + 1); } while (isWeekend(c) || set.has(ymd(c)));
      set.add(ymd(c));
    }
  });
  _cache[year] = set;
  return set;
}

function isNonWorking(d) { return isWeekend(d) || holidaySet(d.getUTCFullYear()).has(ymd(d)); }

// N working days before `dateStr` (skips weekends + BG holidays). Returns 'YYYY-MM-DD'.
function subtractWorkingDays(dateStr, days) {
  const d = parse(dateStr);
  let n = days;
  while (n > 0) { d.setUTCDate(d.getUTCDate() - 1); if (!isNonWorking(d)) n--; }
  return ymd(d);
}

// Working days from today until `dateStr` (negative if past). Skips weekends + BG holidays.
function workingDaysUntil(dateStr) {
  const today = parse(ymd(new Date()));
  const target = parse(dateStr);
  if (target.getTime() === today.getTime()) return 0;
  let n = 0; const dir = target > today ? 1 : -1; const d = new Date(today);
  while (d.getTime() !== target.getTime()) { d.setUTCDate(d.getUTCDate() + dir); if (!isNonWorking(d)) n += dir; }
  return n;
}

module.exports = { ymd, subtractWorkingDays, workingDaysUntil, holidaySet, orthodoxEaster };
