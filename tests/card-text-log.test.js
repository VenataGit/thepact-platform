// Дневникът на текста по Basecamp картите — какъв е бил и с какво е заменен.
// Тук се проверява чистата логика: изчистването на HTML-а (без снимки и видеа),
// кога изобщо се пише запис и как се намира авторът.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

jest.mock('../src/services/basecamp', () => ({
  normalizeAppUrl: (u) => u,
  getRecordingEvents: jest.fn().mockResolvedValue([]),
}));

const bc = require('../src/services/basecamp');
const ctl = require('../src/services/card-text-log');

const AUTH = { token: 't', account: '1' };
const META = { projectId: 39396506, boardTitle: 'Pre-Production' };

// Редовете, вкарани в дневника (без CREATE TABLE / CREATE INDEX).
function insertedRows() {
  return mockDb.execute.mock.calls
    .filter((c) => /INSERT INTO bc_card_text_log/.test(c[0]))
    .map((c) => c[1]);
}

beforeEach(() => {
  mockDb.execute.mockReset().mockResolvedValue(undefined);
  mockDb.query.mockReset().mockResolvedValue([]);
  bc.getRecordingEvents.mockReset().mockResolvedValue([]);
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => { console.warn.mockRestore(); });

// ------------------------------------------------------------- изчистването

describe('plainText', () => {
  test('снимките и видеата не се пазят — остава само бележка', () => {
    const html = '<div>Начало' +
      '<bc-attachment sgid="abc" content-type="image/jpeg" filename="кадър.jpg">нещо</bc-attachment>' +
      'Край</div>';
    const out = ctl.plainText(html);
    expect(out).toContain('[снимка кадър.jpg]');
    expect(out).not.toContain('sgid');
    expect(out).not.toContain('bc-attachment');
  });

  test('видеото се разпознава като видео, непознатото — като файл', () => {
    expect(ctl.plainText('<bc-attachment content-type="video/mp4"></bc-attachment>')).toBe('[видео]');
    expect(ctl.plainText('<bc-attachment content-type="application/pdf"></bc-attachment>')).toBe('[файл]');
  });

  test('редовете и списъците стават четим текст', () => {
    const out = ctl.plainText('<div>Ред 1</div><div>Ред 2</div><ul><li>Едно</li><li>Две</li></ul>');
    expect(out.split('\n').filter(Boolean)).toEqual(['Ред 1', 'Ред 2', '• Едно', '• Две']);
  });

  test('HTML entities се разкодират, и то в правилен ред', () => {
    expect(ctl.plainText('a &amp;lt; b')).toBe('a &lt; b');
    expect(ctl.plainText('&quot;КП&quot; &nbsp;&amp; още')).toBe('"КП" & още');
  });

  test('само форматирането да се смени → същият текст', () => {
    const a = '<div><strong>Видео 1</strong> - идея</div>';
    const b = '<div><em>Видео 1</em> - идея</div>';
    expect(ctl.plainText(a)).toBe(ctl.plainText(b));
  });

  test('празно/липсващо не гърми', () => {
    expect(ctl.plainText(null)).toBe('');
    expect(ctl.plainText(undefined)).toBe('');
    expect(ctl.plainText('')).toBe('');
  });
});

// ------------------------------------------------------------ кога се пише

describe('logCardTextChange', () => {
  const card = (over) => ({ id: 99, title: 'Fornetti КП-5', content: '<div>Нов текст</div>', app_url: 'https://3.basecamp.com/c/99', updated_at: '2026-08-13T10:00:00.000Z', ...over });

  test('нова карта (няма предишен снапшот) не се брои за промяна', async () => {
    const n = await ctl.logCardTextChange(AUTH, card(), null, META);
    expect(n).toBe(0);
    expect(insertedRows()).toHaveLength(0);
  });

  test('еднакъв текст → нищо не се записва', async () => {
    const n = await ctl.logCardTextChange(AUTH, card(), { title: 'Fornetti КП-5', content: '<p>Нов текст</p>' }, META);
    expect(n).toBe(0);
    expect(insertedRows()).toHaveLength(0);
  });

  test('сменен текст → ред със стария и новия вариант', async () => {
    const n = await ctl.logCardTextChange(
      AUTH, card({ content: '<div>Втора версия</div>' }),
      { title: 'Fornetti КП-5', content: '<div>Първа версия</div>' }, META);
    expect(n).toBe(1);
    const rows = insertedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0][5]).toBe('content');       // field
    expect(rows[0][6]).toBe('Първа версия');  // old_text
    expect(rows[0][7]).toBe('Втора версия');  // new_text
  });

  test('смяна само на снимка не се брои за смяна на текста', async () => {
    const before = '<div>Текст<bc-attachment sgid="AAA" content-type="image/jpeg"></bc-attachment></div>';
    const after = '<div>Текст<bc-attachment sgid="BBB" content-type="image/jpeg"></bc-attachment></div>';
    const n = await ctl.logCardTextChange(AUTH, card({ content: after }), { title: 'Fornetti КП-5', content: before }, META);
    expect(n).toBe(0);
  });

  test('сменени заглавие и текст → два реда, но само едно питане кой', async () => {
    bc.getRecordingEvents.mockResolvedValue([
      { created_at: '2026-08-13T10:00:05.000Z', creator: { id: 5, name: 'Мария' } },
    ]);
    const n = await ctl.logCardTextChange(
      AUTH, card({ title: 'Fornetti КП-6', content: '<div>Ново</div>' }),
      { title: 'Fornetti КП-5', content: '<div>Старо</div>' }, META);
    expect(n).toBe(2);
    expect(bc.getRecordingEvents).toHaveBeenCalledTimes(1);
    const fields = insertedRows().map((r) => r[5]);
    expect(fields.sort()).toEqual(['content', 'title']);
    expect(insertedRows()[0][9]).toBe('Мария'); // who_name
  });

  test('много дълъг текст се реже до тавана', async () => {
    const long = 'я'.repeat(ctl.MAX_TEXT + 500);
    await ctl.logCardTextChange(AUTH, card({ content: long }), { title: 'Fornetti КП-5', content: 'кратко' }, META);
    expect(insertedRows()[0][7]).toHaveLength(ctl.MAX_TEXT);
  });
});

// ------------------------------------------------------------------ датите

describe('logCardDateChange', () => {
  // Списъчният payload на картата — той носи и due_on, и steps.
  const card = (over) => ({
    id: 77, title: 'Fornetti — Видео 3', app_url: 'https://3.basecamp.com/c/77',
    updated_at: '2026-08-20T09:00:00.000Z', due_on: '2026-09-01', steps: [], ...over,
  });
  const step = (title, due) => ({ title, due_on: due, completed: false, assignees: [] });

  test('нова карта (няма предишен снапшот) не се брои за промяна', async () => {
    expect(await ctl.logCardDateChange(AUTH, card(), null, META)).toBe(0);
    expect(insertedRows()).toHaveLength(0);
  });

  test('същите дати → нищо не се записва', async () => {
    const prev = { due_on: '2026-09-01', steps: [step('Монтаж', '2026-08-28')] };
    const n = await ctl.logCardDateChange(AUTH, card({ steps: [step('Монтаж', '2026-08-28')] }), prev, META);
    expect(n).toBe(0);
  });

  test('сменен Due on → ред със старата и новата дата', async () => {
    const n = await ctl.logCardDateChange(AUTH, card({ due_on: '2026-09-05' }), { due_on: '2026-09-01', steps: [] }, META);
    expect(n).toBe(1);
    const r = insertedRows()[0];
    expect(r[5]).toBe('due_on');      // field
    expect(r[6]).toBe('');            // step_title
    expect(r[7]).toBe('2026-09-01');  // old
    expect(r[8]).toBe('2026-09-05');  // new
  });

  test('pg DATE (обект Date) се сравнява с низа от Basecamp без лъжлива промяна', async () => {
    const prev = { due_on: new Date(2026, 8, 1), steps: [] }; // локална полунощ, 01.09.2026
    expect(await ctl.logCardDateChange(AUTH, card({ due_on: '2026-09-01' }), prev, META)).toBe(0);
  });

  test('махнат Due on се записва като „без дата"', async () => {
    const n = await ctl.logCardDateChange(AUTH, card({ due_on: null }), { due_on: '2026-09-01', steps: [] }, META);
    expect(n).toBe(1);
    expect(insertedRows()[0][8]).toBe('');
  });

  test('сменена дата на стъпка → ред със заглавието на стъпката', async () => {
    bc.getRecordingEvents.mockResolvedValue([
      { created_at: '2026-08-20T09:00:03.000Z', creator: { id: 4, name: 'Венци' } },
    ]);
    const prev = { due_on: '2026-09-01', steps: [step('Снимане', '2026-08-25'), step('Монтаж', '2026-08-28')] };
    const now = card({ steps: [step('Снимане', '2026-08-26'), step('Монтаж', '2026-08-28')] });
    const n = await ctl.logCardDateChange(AUTH, now, prev, META);
    expect(n).toBe(1);
    const r = insertedRows()[0];
    expect(r[5]).toBe('step_due');
    expect(r[6]).toBe('Снимане');
    expect(r[7]).toBe('2026-08-25');
    expect(r[8]).toBe('2026-08-26');
    expect(r[10]).toBe('Венци'); // who_name
  });

  test('нова стъпка с дата не е смяна на дата', async () => {
    const prev = { due_on: '2026-09-01', steps: [step('Снимане', '2026-08-25')] };
    const now = card({ steps: [step('Снимане', '2026-08-25'), step('Монтаж', '2026-08-28')] });
    expect(await ctl.logCardDateChange(AUTH, now, prev, META)).toBe(0);
  });

  test('липсващ списък със стъпки не минава за изтрити дати', async () => {
    const prev = { due_on: '2026-09-01', steps: [step('Снимане', '2026-08-25')] };
    const now = card({ steps: undefined });
    expect(await ctl.logCardDateChange(AUTH, now, prev, META)).toBe(0);
  });

  test('две стъпки с еднакво заглавие се пропускат — не се знае коя с коя', async () => {
    const prev = { due_on: '2026-09-01', steps: [step('Монтаж', '2026-08-25'), step('Монтаж', '2026-08-28')] };
    const now = card({ steps: [step('Монтаж', '2026-08-26'), step('Монтаж', '2026-08-29')] });
    expect(await ctl.logCardDateChange(AUTH, now, prev, META)).toBe(0);
  });

  test('няколко мръднати дати наведнъж → само едно питане кой', async () => {
    const prev = { due_on: '2026-09-01', steps: [step('Снимане', '2026-08-25'), step('Монтаж', '2026-08-28')] };
    const now = card({ due_on: '2026-09-04', steps: [step('Снимане', '2026-08-26'), step('Монтаж', '2026-08-29')] });
    expect(await ctl.logCardDateChange(AUTH, now, prev, META)).toBe(3);
    expect(bc.getRecordingEvents).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------- авторът

describe('кой е променил', () => {
  const prev = { title: 'Карта', content: 'старо' };
  const card = { id: 7, title: 'Карта', content: 'ново', app_url: '', updated_at: '2026-08-13T12:00:00.000Z' };

  test('взима се събитието най-близко до момента на промяната', async () => {
    bc.getRecordingEvents.mockResolvedValue([
      { created_at: '2026-08-13T09:00:00.000Z', creator: { id: 1, name: 'Стар запис' } },
      { created_at: '2026-08-13T11:59:50.000Z', creator: { id: 2, name: 'Иван' } },
      { created_at: '2026-08-13T14:00:00.000Z', creator: { id: 3, name: 'По-късен' } },
    ]);
    await ctl.logCardTextChange(AUTH, card, prev, META);
    expect(insertedRows()[0][9]).toBe('Иван');
  });

  test('Basecamp да не отговори — записът пак се прави, само без име', async () => {
    bc.getRecordingEvents.mockRejectedValue(new Error('503'));
    const n = await ctl.logCardTextChange(AUTH, card, prev, META);
    expect(n).toBe(1);
    expect(insertedRows()[0][9]).toBe('');
  });

  test('няма събития — записът пак се прави', async () => {
    bc.getRecordingEvents.mockResolvedValue([]);
    const n = await ctl.logCardTextChange(AUTH, card, prev, META);
    expect(n).toBe(1);
    expect(insertedRows()[0][8]).toBeNull(); // who_id
  });
});
