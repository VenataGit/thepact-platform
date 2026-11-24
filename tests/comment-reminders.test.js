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
