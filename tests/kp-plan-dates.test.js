// Датите в контент плана: подготвеният списък горе + смяната на датата на едно видео
// направо в HTML-а на картата (Венци, 21.08.2026 — „Създай задачи по КП").
//
// Пази трите обещания на функцията:
//   1. пипа САМО реда с датата на исканото видео — останалият текст, оцветяванията и
//      прикачените файлове остават дума по дума същите;
//   2. заглавният ред „Дата за публикуване на ПЪРВО видео" в главата не се брои за
//      дата на видео и никога не се пренаписва;
//   3. след смяната планът се чете обратно с новата дата (parsePublishDate).
const kp = require('../src/services/kp-plan');

const HL = 'background-color: rgb(250, 247, 133);';
const mark = (s) => `<mark style="${HL}">${s}</mark>`;

// Как реално изглежда една КП карта в Basecamp (services/bc-html.js формата):
// целият текст е в ЕДИН Trix блок с <br> между редовете.
const PLAN_HTML =
  '<div>' + [
    'Дата за публикуване на първо видео: 01.09.2026',
    '',
    'Дати за публикуване на видеа:',
    '01.09.2026',
    '04.09.2026',
    '07.09.2026',
    '',
    mark('Видео 1 - Лятна кампания'),
    '/Локация - София/',
    mark('Описание:'),
    'Нещо кратко',
    mark('Копи:') + ' текстче',
    'Дата за публикуване: 01.09.2026',
    'Контент криейтър: Иван',
    '',
    mark('Видео 2 - Есенна кампания'),
    mark('Описание:'),
    'Друго',
    'Дата за публикуване: ХХХ',
    '',
    mark('Видео 3 - Без ред за дата'),
    'Само описание',
  ].join('<br>') + '</div>';

describe('parsePlan — главата на плана', () => {
  test('връща редовете преди първата „Видео N" секция', () => {
    const { header, sections } = kp.parsePlan(PLAN_HTML);
    expect(sections).toHaveLength(3);
    expect(header).toContain('Дати за публикуване на видеа:');
    expect(header).not.toContain('Лятна кампания');
  });
});

describe('parsePlanDates — подготвените дати', () => {
  test('чете списъка под „Дати за публикуване на видеа:"', () => {
    const dates = kp.parsePlanDates(kp.parsePlan(PLAN_HTML).header);
    expect(dates).toEqual(['2026-09-01', '2026-09-04', '2026-09-07']);
  });

  test('без такъв блок пада на всички дати в главата, без дубликати', () => {
    const dates = kp.parsePlanDates('Дата за публикуване на първо видео: 05.10.2026\nОще 05.10.2026 и 08.10.2026');
    expect(dates).toEqual(['2026-10-05', '2026-10-08']);
  });

  test('пренебрегва невъзможни дати', () => {
    expect(kp.parsePlanDates('45.13.2026')).toEqual([]);
  });
});

describe('setPublishDateInHtml — смяна на датата на едно видео', () => {
  test('сменя датата само на посоченото видео', () => {
    const r = kp.setPublishDateInHtml(PLAN_HTML, 1, '2026-09-03');
    expect(r.ok).toBe(true);
    expect(r.html).toContain('Дата за публикуване: 03.09.2026');
    // второто видео е недокоснато
    expect(r.html).toContain('Дата за публикуване: ХХХ');
    // главата на плана също
    expect(r.html).toContain('Дата за публикуване на първо видео: 01.09.2026');
  });

  test('оцветяванията и останалият текст остават дума по дума същите', () => {
    const r = kp.setPublishDateInHtml(PLAN_HTML, 1, '2026-09-03');
    expect(r.html).toContain(mark('Видео 1 - Лятна кампания'));
    expect(r.html).toContain(mark('Копи:') + ' текстче');
    expect(r.html).toContain('/Локация - София/');
    expect(r.html).toContain('Контент криейтър: Иван');
    // променен е точно един низ — дължината се различава само с него
    expect(r.html.replace('03.09.2026', '01.09.2026')).toBe(PLAN_HTML);
  });

  test('попълва празния placeholder „ХХХ"', () => {
    const r = kp.setPublishDateInHtml(PLAN_HTML, 2, '2026-09-06');
    expect(r.ok).toBe(true);
    expect(r.html).toContain('Дата за публикуване: 06.09.2026');
    expect(r.html).not.toContain('Дата за публикуване: ХХХ');
  });

  test('добавя реда, когато видеото изобщо няма дата', () => {
    const r = kp.setPublishDateInHtml(PLAN_HTML, 3, '2026-09-09');
    expect(r.ok).toBe(true);
    expect(r.inserted).toBe(true);
    expect(r.html).toContain(mark('Видео 3 - Без ред за дата') + '<br>Дата за публикуване: 09.09.2026');
  });

  test('прочетен обратно, планът дава новата дата', () => {
    const r = kp.setPublishDateInHtml(PLAN_HTML, 1, '2026-09-03');
    const s = kp.parsePlan(r.html).sections.find((x) => x.videoNumber === 1);
    expect(kp.parsePublishDate(s.sectionText)).toBe('2026-09-03');
  });

  test('несъществуващо видео или невалидна дата не пипат нищо', () => {
    expect(kp.setPublishDateInHtml(PLAN_HTML, 99, '2026-09-03')).toMatchObject({ ok: false, html: PLAN_HTML });
    expect(kp.setPublishDateInHtml(PLAN_HTML, 1, '03.09.2026')).toMatchObject({ ok: false, html: PLAN_HTML });
  });
});

describe('setPublishDateInText — текстът, който отива в новата карта', () => {
  const SECTION = ['Видео 1 - Лятна кампания', '/Локация - София/', 'Описание:', 'Нещо', 'Дата за публикуване: 01.09.2026', 'Контент криейтър: Иван'].join('\n');

  test('сменя реда с датата на място', () => {
    const out = kp.setPublishDateInText(SECTION, '2026-09-03');
    expect(out.split('\n')[4]).toBe('Дата за публикуване: 03.09.2026');
    expect(out.split('\n')[5]).toBe('Контент криейтър: Иван');
  });

  test('без такъв ред датата се добавя най-отдолу (за да не мърда блокът с локациите)', () => {
    const out = kp.setPublishDateInText('Видео 4 - Нещо\nОписание:\nтекст', '2026-09-10');
    expect(out.split('\n').pop()).toBe('Дата за публикуване: 10.09.2026');
  });

  test('невалидна дата връща текста непроменен', () => {
    expect(kp.setPublishDateInText(SECTION, '')).toBe(SECTION);
  });
});

describe('isoToBg', () => {
  test('обръща формата, както го пише планът', () => {
    expect(kp.isoToBg('2026-09-03')).toBe('03.09.2026');
    expect(kp.isoToBg('глупост')).toBe('');
  });
});
