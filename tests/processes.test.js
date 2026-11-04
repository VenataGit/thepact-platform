// Процеси (routes/processes.js): всеки чете, редактират само admin/mini_admin;
// запазването е нова версия; чужда междувременна промяна → 409; използвана роля не се маха.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);
jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(), broadcast: jest.fn(), sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0), getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null), disconnectUser: jest.fn()
}));

const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');
const { _test } = require('../src/routes/processes');

const member = getAuthCookie(MEMBER_USER);
const admin = getAuthCookie(ADMIN_USER);
const CONFIG = {
  roles: [{ key: 'vid', name: 'Видеограф', color: '#d2a8ff' }, { key: 'ed', name: 'Монтажист', color: '#3fb950' }],
  depts: [{ key: 'prod', name: 'Заснемане', icon: '🎬', color: '#d2a8ff' }],
};
const ROW = { id: 5, dept: 'prod', name: 'Снимачен ден', owner: 'vid', when_text: '', done_text: '', steps: [{ title: 'Снимай', who: 'vid', more: '', checks: [], warn: '' }], sort: 10, version: 3, updated_by: 'X' };

// queryOne по SQL-а: конфигурацията, „има ли процеси“ и т.н.
function routeQueryOne({ update = ROW, current = null } = {}) {
  mockDb.queryOne.mockImplementation(async (sql) => {
    if (/FROM process_config/.test(sql)) return CONFIG;
    if (/SELECT 1 AS x FROM processes/.test(sql)) return { x: 1 };
    if (/^\s*UPDATE processes/.test(sql)) return update;
    if (/SELECT version, updated_by FROM processes/.test(sql)) return current;
    return null;
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue([]);
  routeQueryOne();
});

describe('четене', () => {
  it('всеки логнат вижда процесите; обикновен човек не може да редактира', async () => {
    mockDb.query.mockResolvedValueOnce([ROW]);
    const res = await request(app).get('/api/processes').set('Cookie', member);
    expect(res.status).toBe(200);
    expect(res.body.canEdit).toBe(false);
    expect(res.body.processes[0]).toMatchObject({ id: 5, name: 'Снимачен ден', version: 3 });
    expect(res.body.config.roles).toHaveLength(2);
  });
  it('админът може да редактира', async () => {
    const res = await request(app).get('/api/processes').set('Cookie', admin);
    expect(res.body.canEdit).toBe(true);
  });
  it('без вход — 401', async () => {
    const res = await request(app).get('/api/processes');
    expect(res.status).toBe(401);
  });
});

describe('редакция', () => {
  const body = { name: 'Снимачен ден', dept: 'prod', owner: 'vid', steps: ROW.steps, baseVersion: 3, note: 'тест' };

  it('обикновен човек не може да запише — 403', async () => {
    const res = await request(app).put('/api/processes/5').set('Cookie', member).send(body);
    expect(res.status).toBe(403);
    expect(mockDb.queryOne.mock.calls.some((c) => /^\s*UPDATE processes/.test(c[0]))).toBe(false);
  });

  it('админ записва → нова версия в историята, с baseVersion в условието', async () => {
    routeQueryOne({ update: { ...ROW, version: 4 } });
    const res = await request(app).put('/api/processes/5').set('Cookie', admin).send(body);
    expect(res.status).toBe(200);
    expect(res.body.process.version).toBe(4);
    const upd = mockDb.queryOne.mock.calls.find((c) => /^\s*UPDATE processes/.test(c[0]));
    expect(upd[0]).toMatch(/version = \$9/);
    expect(upd[1][8]).toBe(3);
    const ver = mockDb.execute.mock.calls.find((c) => /INSERT INTO process_versions/.test(c[0]) && c[1][1] === 4);
    expect(ver[1][3]).toBe('тест');
  });

  it('някой е запазил междувременно → 409 и нищо в историята', async () => {
    routeQueryOne({ update: null, current: { version: 4, updated_by: 'Мими' } });
    const res = await request(app).put('/api/processes/5').set('Cookie', admin).send(body);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Мими/);
    expect(mockDb.execute.mock.calls.some((c) => /INSERT INTO process_versions/.test(c[0]) && c[1][1] === 4)).toBe(false);
  });

  it('без име — 400', async () => {
    const res = await request(app).put('/api/processes/5').set('Cookie', admin).send({ ...body, name: '   ' });
    expect(res.status).toBe(400);
  });
});

describe('настройки', () => {
  it('не дава да се махне роля, която още се ползва', async () => {
    mockDb.query.mockResolvedValueOnce([{ name: 'Монтаж', dept: 'prod', owner: 'vid', steps: [{ who: 'ed' }] }]);
    const res = await request(app).put('/api/processes/config/all').set('Cookie', admin)
      .send({ roles: [CONFIG.roles[0]], depts: CONFIG.depts });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ed/);
    expect(mockDb.execute.mock.calls.some((c) => /UPDATE process_config/.test(c[0]))).toBe(false);
  });

  it('невалиден цвят става сив, а ключ с опасни символи се изхвърля', async () => {
    mockDb.query.mockResolvedValueOnce([]);
    const res = await request(app).put('/api/processes/config/all').set('Cookie', admin).send({
      roles: [{ key: 'vid', name: 'Видеограф', color: 'red;}' }, { key: '"><x', name: 'Лош', color: '#ffffff' }],
      depts: CONFIG.depts,
    });
    expect(res.status).toBe(200);
    expect(res.body.config.roles).toEqual([{ key: 'vid', name: 'Видеограф', color: '#9aa7ad' }]);
  });

  it('обикновен човек — 403', async () => {
    const res = await request(app).put('/api/processes/config/all').set('Cookie', member).send(CONFIG);
    expect(res.status).toBe(403);
  });
});

describe('почистване на стъпките', () => {
  it('маха празните, непознатата роля става „all“ ако я има, реже дължините', () => {
    const out = _test.cleanSteps([
      { title: '  Снимай\nпо сценария ', who: 'nope', checks: ['a', '', 'b'], more: 'x'.repeat(5000) },
      { title: '', who: 'vid' },
    ], new Set(['vid', 'all']));
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe('Снимай по сценария');
    expect(out[0].who).toBe('all');
    expect(out[0].checks).toEqual(['a', 'b']);
    expect(out[0].more.length).toBe(4000);
  });
});
