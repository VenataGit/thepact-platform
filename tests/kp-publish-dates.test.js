// Датите за публикуване в един КП (services/kp-create.js → distributePublishDates).
//
// Регресията, която тези тестове пазят (Венци, 28.08.2026): стъпката се смяташе като
// „дължина на календарния месец / брой видеа", заради което в 31-дневните месеци едно
// видео насред плана падаше през 4 дни (25.08 → … → 06.09 → 10.09), а на клиента е
// обещано през 3. Сега интервалът е фиксиран по клиент и месецът е само ориентир.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);

const kpc = require('../src/services/kp-create');

const iso = (d) => kpc.toDateStr(d);
const stepsOf = (dates) => dates.slice(1).map((d, i) => Math.round((d - dates[i]) / 86400000));
const cycleOf = (r) => Math.round((r.nextKpFirstDate - r.dates[0]) / 86400000);

describe('стандартът: 10 видеа през 3 дни', () => {
  // Месецът вече не влияе на ритъма — 28, 30 и 31-дневен дават едно и също.
  const MONTHS = ['2026-09-01', '2026-08-25', '2026-01-10', '2026-02-25', '2026-04-30'];

  test.each(MONTHS)('%s — всички стъпки са точно по 3 дни', (first) => {
    const r = kpc.distributePublishDates(first, 10, 30, 3);
    expect(r.dates).toHaveLength(10);
    expect(stepsOf(r.dates)).toEqual([3, 3, 3, 3, 3, 3, 3, 3, 3]);
    expect(r.interval).toBe(3);
  });

  test.each(MONTHS)('%s — следващият КП е 3 дни след последното видео (цикъл 30)', (first) => {
    const r = kpc.distributePublishDates(first, 10, 30, 3);
    expect(Math.round((r.nextKpFirstDate - r.lastVideoDate) / 86400000)).toBe(3);
    expect(cycleOf(r)).toBe(30);
  });

  test('примерът на Венци: 01.09 → 10 дати, следващ КП на 01.10', () => {
    const r = kpc.distributePublishDates('2026-09-01', 10, 30, 3);
    expect(r.dates.map(iso)).toEqual([
      '2026-09-01', '2026-09-04', '2026-09-07', '2026-09-10', '2026-09-13',
      '2026-09-16', '2026-09-19', '2026-09-22', '2026-09-25', '2026-09-28',
    ]);
    expect(iso(r.nextKpFirstDate)).toBe('2026-10-01');
  });

  test('старият дефект: 25.08 вече не прескача на 10.09', () => {
    const r = kpc.distributePublishDates('2026-08-25', 10, 30, 3);
    expect(r.dates.map(iso)).toEqual([
      '2026-08-25', '2026-08-28', '2026-08-31', '2026-09-03', '2026-09-06',
      '2026-09-09', '2026-09-12', '2026-09-15', '2026-09-18', '2026-09-21',
    ]);
    expect(r.dates.map(iso)).not.toContain('2026-09-10');
    expect(iso(r.nextKpFirstDate)).toBe('2026-09-24');
  });

  test('веригата се държи през няколко последователни КП-та', () => {
    let first = '2026-09-01';
    for (let kp = 0; kp < 4; kp++) {
      const r = kpc.distributePublishDates(first, 10, 30, 3);
      expect(new Set(stepsOf(r.dates))).toEqual(new Set([3]));
      first = iso(r.nextKpFirstDate);
    }
    expect(first).toBe('2026-12-30'); // 4 цикъла по 30 дни
  });
});

describe('custom: сам задаваш брой видеа и интервал', () => {
  test('5 видеа през 6 дни', () => {
    const r = kpc.distributePublishDates('2026-08-25', 5, 30, 6);
    expect(r.dates.map(iso)).toEqual([
      '2026-08-25', '2026-08-31', '2026-09-06', '2026-09-12', '2026-09-18',
    ]);
    expect(iso(r.nextKpFirstDate)).toBe('2026-09-24');
    expect(cycleOf(r)).toBe(30);
  });

  test('14 видеа през 2 дни — равни стъпки, цикълът е 28 дни', () => {
    const r = kpc.distributePublishDates('2026-08-25', 14, 30, 2);
    expect(r.dates).toHaveLength(14);
    expect(new Set(stepsOf(r.dates))).toEqual(new Set([2]));
    expect(cycleOf(r)).toBe(28);
  });

  test('17 видеа през 2 дни — планът излиза извън месеца, но ритъмът се пази', () => {
    const r = kpc.distributePublishDates('2026-08-25', 17, 30, 2);
    expect(new Set(stepsOf(r.dates))).toEqual(new Set([2]));
    expect(cycleOf(r)).toBe(34);
  });

  test('едно видео — следващият КП пак е един интервал по-късно', () => {
    const r = kpc.distributePublishDates('2026-08-25', 1, 30, 3);
    expect(r.dates.map(iso)).toEqual(['2026-08-25']);
    expect(iso(r.lastVideoDate)).toBe('2026-08-25');
    expect(iso(r.nextKpFirstDate)).toBe('2026-08-28');
  });
});

describe('стар запис без зададен интервал', () => {
  // Клиент, на когото още никой не е избрал график — пада на старото разпределяне в
  // календарния месец, за да не му се разместят датите без някой да е поискал.
  test('без интервал следващият КП е същият ден следващия месец', () => {
    const r = kpc.distributePublishDates('2026-08-25', 10, 30, null);
    expect(iso(r.nextKpFirstDate)).toBe('2026-09-25');
    expect(r.dates.map(iso)).toContain('2026-09-10'); // старото поведение, с четвъртия ден
  });

  test('интервал 0 или боклук се брои за „няма интервал"', () => {
    for (const bad of [0, -3, 'abc', undefined]) {
      const r = kpc.distributePublishDates('2026-08-25', 10, 30, bad);
      expect(iso(r.nextKpFirstDate)).toBe('2026-09-25');
    }
  });
});
