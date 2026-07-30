// „Известия от таблица" — чистата логика, която решава кое е важно и коя нишка е.
// Тя решава дали клиентско одобрение изобщо ще стигне до Basecamp, затова се тества
// без база и без Basecamp.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

const sa = require('../src/services/sheet-alerts');

// Реалните колони от таблицата на Re/Shape.
const HEADERS = [
  'Име на видеото', 'Идея / скрипт', 'Коментар от клиента', 'Одобрение от клиента',
  'Необходими ресурси', 'Копи/описание', 'Дата на публикуване', 'Cover снимка',
];

describe('кои колони са важни', () => {
  const important = ['одобрение', 'коментар'];

  test('одобрението и коментарът от клиента са важни', () => {
    expect(sa.matchesAny('Одобрение от клиента', important)).toBe(true);
    expect(sa.matchesAny('Коментар от клиента', important)).toBe(true);
  });

  test('останалите колони мълчат', () => {
    expect(sa.matchesAny('Дата на публикуване', important)).toBe(false);
    expect(sa.matchesAny('Cover снимка', important)).toBe(false);
    expect(sa.matchesAny('', important)).toBe(false);
  });

  test('регистърът и излишните интервали не пречат', () => {
    expect(sa.matchesAny('  ОДОБРЕНИЕ   ОТ КЛИЕНТА ', important)).toBe(true);
  });
});

describe('заглавие на нишката', () => {
  const titleCols = ['име', 'видео', 'заглавие'];
  const values = ['Видео 3 — офис тур', 'скрипт…', '', 'FALSE', '', '', '10.08', ''];

  test('взима се от колоната с името на видеото', () => {
    expect(sa.rowTitle(HEADERS, values, 5, titleCols)).toBe('Видео 3 — офис тур');
  });

  test('празно име → първата непразна клетка', () => {
    const v = ['', '', 'коментар от клиента', ...Array(5).fill('')];
    expect(sa.rowTitle(HEADERS, v, 7, titleCols)).toBe('коментар от клиента');
  });

  test('съвсем празен ред → номерът на реда', () => {
    expect(sa.rowTitle(HEADERS, Array(8).fill(''), 12, titleCols)).toBe('Ред 12');
  });
});

describe('ключ на нишката', () => {
  test('еднакво име → една и съща нишка, независимо от номера на реда', () => {
    // Точно това пази нишката, когато някой вмъкне ред по средата на плана.
    expect(sa.threadKeyOf('Видео 3', 5)).toBe(sa.threadKeyOf('видео  3', 9));
  });

  test('без име се пада обратно на номера на реда', () => {
    expect(sa.threadKeyOf('', 12)).toBe('row:12');
    expect(sa.threadKeyOf('', 13)).not.toBe(sa.threadKeyOf('', 12));
  });
});

describe('стойности в известието', () => {
  test('чекбоксът се чете човешки', () => {
    expect(sa.pretty('TRUE')).toBe('ДА ✅');
    expect(sa.pretty('FALSE')).toBe('не');
  });

  test('обикновеният текст остава', () => {
    expect(sa.pretty('  Одобрено, пускаме  ')).toBe('Одобрено, пускаме');
  });

  test('дългият коментар се подрязва', () => {
    expect(sa.pretty('я'.repeat(500))).toHaveLength(301); // 300 + „…"
  });
});

describe('линк към реда', () => {
  test('сочи точния шийт и ред', () => {
    expect(sa.rowUrl({ spreadsheetId: 'ABC', gid: 1751870148, row: 7 }))
      .toBe('https://docs.google.com/spreadsheets/d/ABC/edit#gid=1751870148&range=A7');
  });

  test('без spreadsheetId няма линк', () => {
    expect(sa.rowUrl({ row: 7 })).toBe('');
  });

  test('липсващ gid не се преправя на 0 (иначе сочи първия шийт)', () => {
    expect(sa.sanitize({ spreadsheetId: 'ABC' }).gid).toBeNull();
    expect(sa.sanitize({ spreadsheetId: 'ABC', gid: 0 }).gid).toBe(0);
  });
});

describe('намиране на заглавния ред', () => {
  const needles = ['одобрение', 'коментар', 'име', 'видео', 'заглавие'];

  test('заглавният ред не е първи (отгоре стои заглавие на плана)', () => {
    // Точно случаят от таблицата на Re/Shape — затова нито една колона не се
    // разпознаваше и „важните колони" на практика не работеха.
    const top = [
      ['ФИНАЛЕН ПОСТИНГ ПЛАН КП-2 + Реклами', '', '', ''],
      ['', '', '', ''],
      HEADERS.slice(0, 4),
      ['Видео 1', 'скрипт', '', 'FALSE'],
    ];
    const r = sa.pickHeaderRow(top, needles);
    expect(r.headerRow).toBe(3);
    expect(r.headers[3]).toBe('Одобрение от клиента');
  });

  test('нормалната таблица със заглавия на първи ред пак работи', () => {
    const r = sa.pickHeaderRow([HEADERS, ['Видео 1']], needles);
    expect(r.headerRow).toBe(1);
    expect(r.headers[2]).toBe('Коментар от клиента');
  });
});

describe('стабилност на нишката', () => {
  test('дописан Drive линк към името не отваря нова нишка', () => {
    // Наблюдавано на живо: един и същи ред роди 3 нишки, защото към името
    // постепенно се дописваше линк към Google Drive.
    const a = 'КП-3 - Видео 1 - Повдигането и намаляването на бюста';
    const b = a + '\nhttps://drive.google.com/file/d/1fFViw/view?usp=drive_link';
    const c = a + 'https://drive.google.com/file/d/1fFViw/view?usp=drive_link';
    expect(sa.threadKeyOf(b, 25)).toBe(sa.threadKeyOf(a, 25));
    expect(sa.threadKeyOf(c, 25)).toBe(sa.threadKeyOf(a, 25));
  });

  test('различни видеа пак са различни нишки', () => {
    expect(sa.threadKeyOf('КП-3 - Видео 1', 5)).not.toBe(sa.threadKeyOf('КП-3 - Видео 2', 6));
  });
});

describe('игнорирани акаунти', () => {
  const list = ['@thepact.bg', 'външен@example.com'];

  test('цял домейн се игнорира', () => {
    expect(sa.isIgnored('ivan@thepact.bg', list)).toBe(true);
    expect(sa.isIgnored('IVAN@ThePact.BG', list)).toBe(true);
  });

  test('конкретен имейл се игнорира', () => {
    expect(sa.isIgnored('външен@example.com', list)).toBe(true);
  });

  test('клиентът минава', () => {
    expect(sa.isIgnored('client@reshape.bg', list)).toBe(false);
  });

  test('празен имейл НИКОГА не се игнорира', () => {
    // Google не дава имейла на външните редактори — ако ги мълчахме, точно
    // одобренията на клиента щяха да изчезнат.
    expect(sa.isIgnored('', list)).toBe(false);
    expect(sa.isIgnored(undefined, list)).toBe(false);
  });

  test('празен списък пуска всички', () => {
    expect(sa.isIgnored('ivan@thepact.bg', [])).toBe(false);
  });

  test('домейнът не хваща подобен, но различен домейн', () => {
    expect(sa.isIgnored('ivan@nethepact.bg', ['@thepact.bg'])).toBe(false);
  });
});

describe('обработка на промяна от таблицата', () => {
  // Изчакването е нарочно голямо, за да не тръгне публикуването по време на теста.
  const SETTINGS = [
    { key: 'sheet_alerts_enabled', value: 'true' },
    { key: 'sheet_alerts_secret', value: 'tainа' },
    { key: 'sheet_alerts_bc_project', value: '39396506' },
    { key: 'sheet_alerts_bc_board', value: '10143861702' },
    { key: 'sheet_alerts_important', value: 'одобрение,коментар' },
    { key: 'sheet_alerts_title_cols', value: 'име,видео,заглавие' },
    { key: 'sheet_alerts_all_changes', value: 'false' },
    { key: 'sheet_alerts_delay', value: '600' },
  ];

  const hit = (changes, row) => sa.handleHit({
    kind: 'edit', spreadsheetId: 'ABC', spreadsheetName: 'Постинг план',
    sheetName: 'Юли', gid: 1751870148, row: row || 7,
    headers: HEADERS, rowValues: ['Видео 3', '', '', '', '', '', '', ''],
    editor: 'client@reshape.bg', changes,
  });

  beforeEach(() => {
    mockDb.query.mockReset().mockResolvedValue(SETTINGS);
    mockDb.execute.mockReset().mockResolvedValue(undefined);
  });

  test('цъкнато одобрение отива в Basecamp', async () => {
    const r = await hit([{ col: 4, old: 'FALSE', new: 'TRUE' }]);
    expect(r.posted).toBe(true);
  });

  test('промяна по неважна колона се записва, но не вдига шум', async () => {
    const r = await hit([{ col: 7, old: '', new: '10.08' }]);
    expect(r.posted).toBe(false);
    expect(r.logged).toBe(1);
  });

  test('клик без реална промяна се пропуска', async () => {
    const r = await hit([{ col: 4, old: 'TRUE', new: 'TRUE' }]);
    expect(r.skipped).toBe(true);
  });

  test('заглавният ред не е промяна по видео', async () => {
    const r = await hit([{ col: 4, old: '', new: 'TRUE' }], 1);
    expect(r.skipped).toBe(true);
  });

  test('одобрение от игнориран акаунт не отива в Basecamp', async () => {
    // Сценарият на Венци: човек от екипа минава през таблицата и пипа редовете.
    mockDb.query.mockResolvedValue(SETTINGS.concat([{ key: 'sheet_alerts_ignored', value: '@thepact.bg' }]));
    const r = await sa.handleHit({
      kind: 'edit', spreadsheetId: 'ABC', sheetName: 'Юли', row: 7,
      headers: HEADERS, rowValues: ['Видео 3'], editor: 'ivan@thepact.bg',
      changes: [{ col: 4, old: 'FALSE', new: 'TRUE' }],
    });
    expect(r.ignored).toBe(true);
    expect(r.posted).toBe(false);
    expect(r.logged).toBe(1); // пак се вижда в дневника
  });

  test('клиентът минава, дори когато екипът е игнориран', async () => {
    mockDb.query.mockResolvedValue(SETTINGS.concat([{ key: 'sheet_alerts_ignored', value: '@thepact.bg' }]));
    const r = await hit([{ col: 4, old: 'FALSE', new: 'TRUE' }]); // editor: client@reshape.bg
    expect(r.posted).toBe(true);
  });

  test('непознат редактор (празен имейл) минава', async () => {
    mockDb.query.mockResolvedValue(SETTINGS.concat([{ key: 'sheet_alerts_ignored', value: '@thepact.bg' }]));
    const r = await sa.handleHit({
      kind: 'edit', spreadsheetId: 'ABC', sheetName: 'Юли', row: 7,
      headers: HEADERS, rowValues: ['Видео 3'], editor: '',
      changes: [{ col: 3, old: '', new: 'Моля сменете музиката' }],
    });
    expect(r.posted).toBe(true);
  });

  test('одобрение се разпознава и когато заглавният ред е трети', async () => {
    // Без намирането на заглавния ред тази промяна излизаше като „Колона 4",
    // важно=false — тоест изобщо не стигаше до Basecamp.
    const r = await sa.handleHit({
      kind: 'edit', spreadsheetId: 'ABC', sheetName: 'ФИНАЛЕН ПОСТИНГ ПЛАН', row: 9,
      topRows: [['ФИНАЛЕН ПОСТИНГ ПЛАН КП-2', '', '', ''], ['', '', '', ''], HEADERS.slice(0, 4)],
      rowValues: ['Видео 1', '', '', 'TRUE'], editor: 'client@reshape.bg',
      changes: [{ col: 4, old: 'FALSE', new: 'TRUE' }],
    });
    expect(r.posted).toBe(true);
  });

  test('редовете НАД заглавния не са промени по видео', async () => {
    const r = await sa.handleHit({
      kind: 'edit', spreadsheetId: 'ABC', sheetName: 'ФИНАЛЕН ПОСТИНГ ПЛАН', row: 2,
      topRows: [['ФИНАЛЕН ПОСТИНГ ПЛАН КП-2', '', '', ''], ['', '', '', ''], HEADERS.slice(0, 4)],
      rowValues: [], editor: 'client@reshape.bg',
      changes: [{ col: 1, old: '', new: 'нещо в шапката' }],
    });
    expect(r.skipped).toBe(true);
  });

  test('важното се публикува дори когато е сред неважни промени', async () => {
    const r = await hit([
      { col: 7, old: '', new: '10.08' },
      { col: 3, old: '', new: 'Моля сменете музиката' },
    ]);
    expect(r.posted).toBe(true);
    expect(r.logged).toBe(2); // и двете се логват, известието е за важната
  });
});

describe('payload от Apps Script', () => {
  test('текстът се коерсва и броят промени е с таван', () => {
    const p = sa.sanitize({
      kind: 'edit', spreadsheetId: 'ABC', sheetName: 'Постинг план', row: '7',
      headers: HEADERS, rowValues: ['Видео 3'],
      changes: Array.from({ length: 200 }, (_, i) => ({ col: i + 1, old: '', new: 'x' })),
    });
    expect(p.row).toBe(7);
    expect(p.changes.length).toBeLessThanOrEqual(60);
    expect(p.sheetName).toBe('Постинг план');
  });

  test('боклук на входа не хвърля', () => {
    const p = sa.sanitize(null);
    expect(p.changes).toEqual([]);
    expect(p.sheetName).toBe('Без име');
  });

  test('промени без валидна колона отпадат', () => {
    const p = sa.sanitize({ changes: [{ col: 0 }, { col: 'x' }, { col: 3, new: 'ok' }] });
    expect(p.changes).toEqual([{ col: 3, old: '', new: 'ok' }]);
  });
});
