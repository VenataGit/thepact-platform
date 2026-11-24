// „Подсети“ в коментари (services/comment-reminders.js) — чистите помощници.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);

const r = require('../src/services/comment-reminders');

const BOT = 'BOTSGID';
const mention = (sgid, name) => `<bc-attachment sgid="${sgid}" content-type="application/vnd.basecamp.mention"><figure><img src="x"><figcaption>${name}</figcaption></figure></bc-attachment>`;

describe('commandOf', () => {
  it('подсети / напомни → remind', () => {
    expect(r.commandOf('@бот Подсети @Иван утре в 11:00')).toBe('remind');
    expect(r.commandOf('напомни ми в петък')).toBe('remind');
  });
  it('отмени → cancel (с предимство)', () => {
    expect(r.commandOf('@бот отмени 12')).toBe('cancel');
    expect(r.commandOf('отмени напомнянето')).toBe('cancel');
  });
  it('думи, които само приличат → нищо (остават за Content агента)', () => {
    expect(r.commandOf('идеи, които напомнят за Коледа')).toBe('');
    expect(r.commandOf('2 видеа без хумор')).toBe('');
  });
});

describe('mentions', () => {
  const html = `<div>${mention(BOT, 'ThePactAlerts')} Подсети ${mention('S1', 'Иван Петров')} утре в 11</div>`;
  it('extractMentions', () => {
    expect(r.extractMentions(html)).toEqual([{ sgid: BOT, caption: 'ThePactAlerts' }, { sgid: 'S1', caption: 'Иван Петров' }]);
  });
  it('textWithMentions', () => {
    expect(r.textWithMentions(html, BOT, { S1: 'Иван' })).toBe('@бот Подсети @Иван утре в 11');
  });
});

describe('sofiaToDate / formatWhen', () => {
  it('зимно време (UTC+2)', () => {
    expect(r.sofiaToDate('2026-11-25 11:00').toISOString()).toBe('2026-11-25T09:00:00.000Z');
  });
  it('лятно време (UTC+3)', () => {
    expect(r.sofiaToDate('2026-07-01 11:00').toISOString()).toBe('2026-07-01T08:00:00.000Z');
  });
  it('невалидно → null', () => {
    expect(r.sofiaToDate('утре')).toBeNull();
    expect(r.sofiaToDate(null)).toBeNull();
  });
  it('formatWhen', () => {
    expect(r.formatWhen(new Date('2026-11-25T09:00:00Z'))).toBe('25.11 (сряда) в 11:00');
  });
});

describe('parseJson', () => {
  it('изрязва JSON от текст', () => {
    expect(r.parseJson('ето:\n{"targets":["ME"],"when":null}')).toEqual({ targets: ['ME'], when: null });
    expect(r.parseJson('няма')).toBeNull();
  });
});

describe('timesInText (само ЧЧ:ММ, 24 ч.)', () => {
  it('намира и нормализира', () => {
    expect(r.timesInText('утре в 9:30 или в 15:00')).toEqual(['09:30', '15:00']);
  });
  it('„в 3“, „15 часа“, дати → нищо', () => {
    expect(r.timesInText('в 3 следобед, в 15 часа, на 25.11')).toEqual([]);
    expect(r.timesInText('в 25:00')).toEqual([]);
  });
});

describe('Ping', () => {
  it('handlePingLine: не е команда → false (dev-chat си го поема)', async () => {
    await expect(r.handlePingLine({}, { id: 1, content: 'здрасти', creator: { id: 5 } }, 1, 2)).resolves.toBe(false);
  });
  it('handlePingLine: човек извън екипа → false', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);
    await expect(r.handlePingLine({}, { id: 1, content: 'Подсети ме утре в 15:00', creator: { id: 5 } }, 1, 2)).resolves.toBe(false);
  });
});

describe('isInternal', () => {
  const bc = require('../src/services/basecamp');
  it('невидим за клиента → вътрешен', async () => {
    await expect(r.isInternal({}, { visible_to_clients: false, bucket: { id: 1 } })).resolves.toBe(true);
  });
  it('Video Production (служебният клиент „ThePact Tasks“) → вътрешен', async () => {
    await expect(r.isInternal({}, { visible_to_clients: true, bucket: { id: 39396506 } })).resolves.toBe(true);
  });
  it('проект с клиенти → не', async () => {
    const spy = jest.spyOn(bc, 'getProjectPeople').mockResolvedValue([{ client: true }]);
    await expect(r.isInternal({}, { visible_to_clients: true, bucket: { id: 777 } })).resolves.toBe(false);
    spy.mockResolvedValue([{ client: false }]);
    await expect(r.isInternal({}, { visible_to_clients: true, bucket: { id: 778 } })).resolves.toBe(true);
    spy.mockRestore();
  });
});
