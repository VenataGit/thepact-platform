// Производствен календар (routes/bc-calendar.js), 22.11.2026: календар на човек.
// Карта, пусната в календара на видеограф → той се назначава и се тагва (с часа и
// продължителността); преместена в календара на друг → първият се маха, вторият се
// тагва. Плюс: ⚙️ Настройките се пипат само от мини админ, мини админ дава само админ.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn(), queryOne: jest.fn(), execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);
jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(), broadcast: jest.fn(), sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0), getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null), disconnectUser: jest.fn(),
}));
jest.mock('../src/services/google-calendar', () => ({
  createGCalEvent: jest.fn().mockResolvedValue('gid-1'),
  updateGCalEvent: jest.fn().mockResolvedValue(undefined),
  deleteGCalEvent: jest.fn().mockResolvedValue(undefined),
  isGCalEnabled: jest.fn().mockResolvedValue(true),
  getCalendarClient: jest.fn().mockReturnValue(null),
  getTargetCalendarId: jest.fn().mockResolvedValue('prod@g'),
  getServiceAccountEmail: jest.fn().mockReturnValue('bot@sa'),
}));
const mockBc = {
  getCard: jest.fn(), updateCard: jest.fn().mockResolvedValue({}), createComment: jest.fn().mockResolvedValue({}),
};
jest.mock('../src/services/basecamp', () => mockBc);
jest.mock('../src/services/basecamp-token', () => ({
  getServiceAuth: jest.fn().mockResolvedValue({ token: 't', account: 'a' }),
  getUserAuth: jest.fn().mockResolvedValue({ token: 't', account: 'a' }),
  getAdminUserAuth: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');
const { _test } = require('../src/routes/bc-calendar');

const member = getAuthCookie(MEMBER_USER);
const admin = getAuthCookie(ADMIN_USER);

// Малка „база“: отговорите зависят от SQL-а.
let db;
function setupDb() {
  db = {
    feeds: [
      { id: 'prod@g', name: 'ThePact Production', can_write: true, pc_person_id: null },
      { id: 'ivo@g', name: 'Иво', can_write: true, pc_person_id: '11' },
      { id: 'viki@g', name: 'Вики', can_write: true, pc_person_id: '22' },
    ],
    entry: null, people: [], nextPeopleId: 100, miniAdmins: [],
  };
  mockDb.query.mockImplementation(async (sql, params) => {
    if (/FROM gcal_feeds WHERE enabled/.test(sql)) return db.feeds;
    if (/SELECT id FROM bc_production_calendar_people WHERE entry_id = \$1 AND person_id/.test(sql)) {
      return db.people.filter((p) => String(p.person_id) === String(params[1])).map((p) => ({ id: p.id }));
    }
    if (/SELECT \* FROM bc_production_calendar_people WHERE entry_id/.test(sql)) return db.people.slice();
    if (/FROM bc_production_calendar_people a/.test(sql)) {
      return db.people.map((p) => ({ id: p.id, entry_id: 1, person_id: p.person_id, ext_name: null, name: 'P' + p.person_id }));
    }
    return [];
  });
  mockDb.queryOne.mockImplementation(async (sql, params) => {
    if (/FROM users/.test(sql)) return params && params[0] === ADMIN_USER.id ? ADMIN_USER : MEMBER_USER;
    if (/pc_mini_admins WHERE user_id/.test(sql)) return db.miniAdmins.includes(params[0]) ? { '?column?': 1 } : null;
    if (/SELECT google_calendar_event_id, google_calendar_id FROM bc_production_calendar/.test(sql)) {
      return db.entry ? { google_calendar_event_id: db.entry.google_calendar_event_id, google_calendar_id: db.entry.google_calendar_id } : null;
    }
    if (/INSERT INTO bc_production_calendar \(/.test(sql)) {
      db.entry = { ...(db.entry || { google_calendar_event_id: null }), id: 1, basecamp_card_id: params[0], card_title: params[1], card_url: params[2],
        scheduled_date: params[3], start_minute: params[4], duration_minutes: params[5], google_calendar_id: params[6] };
      return { ...db.entry };
    }
    if (/SELECT \* FROM bc_production_calendar WHERE id/.test(sql)) return db.entry ? { ...db.entry } : null;
    if (/SELECT \* FROM bc_people WHERE person_id/.test(sql)) return { person_id: params[0], name: 'P' + params[0], attachable_sgid: 'sg' + params[0] };
    if (/INSERT INTO bc_production_calendar_people/.test(sql)) {
      const row = { id: db.nextPeopleId++, person_id: params[1], bc_added: false };
      db.people.push(row);
      return { id: row.id };
    }
    if (/SELECT name FROM bc_people/.test(sql)) return { name: 'P' + params[0] };
    return null;
  });
  mockDb.execute.mockImplementation(async (sql, params) => {
    if (/DELETE FROM bc_production_calendar_people WHERE id = ANY/.test(sql)) {
      db.people = db.people.filter((p) => !params[0].includes(p.id));
    }
    if (/UPDATE bc_production_calendar SET google_calendar_event_id = \$1/.test(sql) && db.entry) db.entry.google_calendar_event_id = params[0];
    if (/UPDATE bc_production_calendar_people SET bc_added = TRUE/.test(sql)) {
      db.people.forEach((p) => { if (params[0].includes(p.id)) p.bc_added = true; });
    }
  });
  mockBc.getCard.mockImplementation(async () => ({ id: 555, assignees: db.people.filter((p) => p.bc_added).map((p) => ({ id: Number(p.person_id) })) }));
}

beforeEach(() => { jest.clearAllMocks(); setupDb(); });

const drop = (calendarId, cookie = member) => request(app).post('/api/bc-calendar').set('Cookie', cookie)
  .send({ cardId: 555, title: 'Видео', url: '', scheduledDate: '2026-11-24', startMinute: 600, durationMinutes: 120, calendarId });

describe('календар на човек → назначаване', () => {
  test('карта в календара на Иво → Иво е assignee и е тагнат с деня, часа и продължителността', async () => {
    const res = await drop('ivo@g');
    expect(res.status).toBe(201);
    expect(res.body.people.map((p) => p.person_id)).toEqual(['11']);
    expect(mockBc.updateCard).toHaveBeenCalledWith('t', 'a', expect.anything(), expect.anything(), { assignee_ids: [11] });
    const comment = mockBc.createComment.mock.calls[0][4];
    expect(comment).toContain('вторник, 24.11.2026, 10:00 – 12:00 (2 ч.)');
  });

  test('преместена от Иво във Вики → Иво се маха, Вики се назначава и тагва', async () => {
    await drop('ivo@g');
    mockBc.updateCard.mockClear(); mockBc.createComment.mockClear();
    const res = await drop('viki@g');
    expect(res.status).toBe(201);
    expect(res.body.people.map((p) => p.person_id)).toEqual(['22']);
    expect(mockBc.updateCard).toHaveBeenCalledWith('t', 'a', expect.anything(), expect.anything(), { assignee_ids: [22] });
    expect(mockBc.createComment).toHaveBeenCalledTimes(1);
  });

  test('общ календар → никой не се назначава; Google събитието се създава веднъж', async () => {
    const res = await drop('prod@g');
    expect(res.status).toBe(201);
    expect(res.body.people).toEqual([]);
    expect(mockBc.updateCard).not.toHaveBeenCalled();
  });

  test('календар на човек: събитието в Google не се дублира', async () => {
    const gc = require('../src/services/google-calendar');
    await drop('ivo@g');
    expect(gc.createGCalEvent).toHaveBeenCalledTimes(1);
  });
});

describe('⚙️ настройки — права', () => {
  test('обикновен член не може да свързва календар с човек', async () => {
    const res = await request(app).put('/api/bc-calendar/settings/calendars/2').set('Cookie', member).send({ personId: '11' });
    expect(res.status).toBe(403);
  });

  test('мини админ може', async () => {
    db.miniAdmins.push(MEMBER_USER.id);
    const res = await request(app).put('/api/bc-calendar/settings/videographers/33').set('Cookie', member).send({ on: true });
    expect(res.status).toBe(200);
  });

  test('мини админ не може да дава мини админ — само админът', async () => {
    db.miniAdmins.push(MEMBER_USER.id);
    expect((await request(app).put('/api/bc-calendar/settings/admins/5').set('Cookie', member).send({ granted: true })).status).toBe(403);
    expect((await request(app).put('/api/bc-calendar/settings/admins/5').set('Cookie', admin).send({ granted: true })).status).toBe(200);
  });
});

describe('помощни', () => {
  test('продължителност', () => {
    expect(_test.humanDuration(120)).toBe('2 ч.');
    expect(_test.humanDuration(90)).toBe('1 ч. 30 мин');
    expect(_test.humanDuration(45)).toBe('45 мин');
  });
  test('видеограф: по длъжност или ръчно', () => {
    expect(_test.isVideographer({ person_id: 1, title: 'Videographer and content creator' }, new Set())).toBe(true);
    expect(_test.isVideographer({ person_id: 2, title: 'Head of Production' }, new Set())).toBe(true);
    expect(_test.isVideographer({ person_id: 3, title: 'Head of Post Production' }, new Set())).toBe(false);
    expect(_test.isVideographer({ person_id: 3, title: 'Video Editor' }, new Set(['3']))).toBe(true);
  });
  test('Calendar ID или линк', () => {
    expect(_test.parseCalendarInput('abc@group.calendar.google.com')).toBe('abc@group.calendar.google.com');
    expect(_test.parseCalendarInput('https://calendar.google.com/calendar/embed?src=x%40group.calendar.google.com')).toBe('x@group.calendar.google.com');
    expect(_test.parseCalendarInput('nonsense')).toBe(null);
  });
});
