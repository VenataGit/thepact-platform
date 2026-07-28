// Екип и роли (routes/team.js), изтриване на профил (routes/users.js)
// и намирането на клиентския Basecamp проект (services/kp-comment.js).
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};

jest.mock('../src/db/pool', () => mockDb);

jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(),
  broadcast: jest.fn(),
  sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0),
  getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null),
  disconnectUser: jest.fn()
}));

// Basecamp не се вика в тестовете — sync-ът се моква целенасочено.
jest.mock('../src/services/bc-team', () => ({
  initBcTeamSync: jest.fn(),
  restartBcTeamSync: jest.fn().mockResolvedValue(undefined),
  refreshTeam: jest.fn().mockResolvedValue({ count: 3, added: ['Нов Човек'], deactivated: [] }),
  ensureFresh: jest.fn().mockResolvedValue(undefined),
  syncTime: jest.fn().mockResolvedValue('07:30'),
  kpResponsiblePeople: jest.fn().mockResolvedValue([]),
  getReadAuth: jest.fn(),
  mentionOf: (p, n) => `<strong>${(p && p.name) || n}</strong>`,
  escHtml: (s) => String(s == null ? '' : s)
}));

const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');

const adminCookie = getAuthCookie(ADMIN_USER);
const memberCookie = getAuthCookie(MEMBER_USER);

beforeEach(() => {
  mockDb.query.mockReset().mockResolvedValue([]);
  mockDb.queryOne.mockReset().mockResolvedValue(null);
  mockDb.execute.mockReset().mockResolvedValue(undefined);
});

describe('GET /api/team/overview', () => {
  test('само пълен админ има достъп', async () => {
    const res = await request(app).get('/api/team/overview').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });

  test('без сесия → 401', async () => {
    const res = await request(app).get('/api/team/overview');
    expect(res.status).toBe(401);
  });

  test('връща хора, позиции и профили', async () => {
    mockDb.query
      .mockResolvedValueOnce([{ person_id: '11', name: 'Мария', email: 'm@thepact.bg', active: true, position_id: 4, position_name: 'Криейтив', kp_responsible: true }])
      .mockResolvedValueOnce([{ id: 4, name: 'Криейтив', kp_responsible: true, people_count: 1 }])
      .mockResolvedValueOnce([{ id: 2, name: 'Тест', email: 't@x.bg', role: 'member', is_active: false }]);
    mockDb.queryOne.mockResolvedValueOnce({ at: '2026-07-28T05:30:00.000Z' });

    const res = await request(app).get('/api/team/overview').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.people).toHaveLength(1);
    expect(res.body.positions[0].kp_responsible).toBe(true);
    expect(res.body.users[0].is_active).toBe(false);
    expect(res.body.syncTime).toBe('07:30');
    expect(res.body.myUserId).toBe(ADMIN_USER.id);
  });
});

describe('PUT /api/team/people/:id', () => {
  test('задава позиция на човек от Basecamp', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ id: 4 })                                     // позицията съществува
      .mockResolvedValueOnce({ person_id: '11', name: 'Мария', position_id: 4 });
    const res = await request(app).put('/api/team/people/11')
      .set('Cookie', adminCookie).send({ position_id: 4 });
    expect(res.status).toBe(200);
    expect(res.body.person.position_id).toBe(4);
  });

  test('непознат човек → 404 с подсказка да се обнови екипът', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 4 }).mockResolvedValueOnce(null);
    const res = await request(app).put('/api/team/people/99')
      .set('Cookie', adminCookie).send({ position_id: 4 });
    expect(res.status).toBe(404);
  });

  test('не-админ не може', async () => {
    const res = await request(app).put('/api/team/people/11')
      .set('Cookie', memberCookie).send({ position_id: 4 });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/team/config', () => {
  test('приема ЧЧ:ММ', async () => {
    const res = await request(app).put('/api/team/config').set('Cookie', adminCookie).send({ syncTime: '08:15' });
    expect(res.status).toBe(200);
    expect(mockDb.execute).toHaveBeenCalled();
  });

  test('отхвърля невалиден час', async () => {
    const res = await request(app).put('/api/team/config').set('Cookie', adminCookie).send({ syncTime: 'сутринта' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/team/refresh', () => {
  test('връща какво се е променило', async () => {
    const res = await request(app).post('/api/team/refresh').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
    expect(res.body.added).toEqual(['Нов Човек']);
  });
});

describe('DELETE /api/users/:id', () => {
  test('трие тестов профил', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 7, name: 'Тест', email: 't@x.bg', role: 'member' });
    const res = await request(app).delete('/api/users/7').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.deleted.id).toBe(7);
    expect(mockDb.execute).toHaveBeenCalledWith('DELETE FROM users WHERE id = $1', [7]);
  });

  test('не трие собствения профил', async () => {
    const res = await request(app).delete('/api/users/' + ADMIN_USER.id).set('Cookie', adminCookie);
    expect(res.status).toBe(400);
    expect(mockDb.execute).not.toHaveBeenCalled();
  });

  test('не трие друг админ', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 9, name: 'Друг', email: 'a@x.bg', role: 'admin' });
    const res = await request(app).delete('/api/users/9').set('Cookie', adminCookie);
    expect(res.status).toBe(403);
  });

  test('профил със съдържание → 409, а не 500', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 8, name: 'Стар', email: 's@x.bg', role: 'member' });
    mockDb.execute.mockImplementation((sql) => {
      if (/DELETE FROM users/.test(sql)) return Promise.reject(Object.assign(new Error('fk'), { code: '23503' }));
      return Promise.resolve();
    });
    const res = await request(app).delete('/api/users/8').set('Cookie', adminCookie);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/Деактивирай/);
  });

  test('mini_admin не може да трие', async () => {
    const res = await request(app).delete('/api/users/7').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });
});

describe('kp-comment: кой е проектът на клиента', () => {
  const kc = require('../src/services/kp-comment');

  test('запомненият проект печели', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ project_id: '555', name: 'Cineland' });
    const p = await kc.resolveClientProject({ id: 1, name: 'Cineland', bc_project_id: '555' });
    expect(p.project_id).toBe('555');
    expect(mockDb.query).not.toHaveBeenCalled();
  });

  test('съвпадение по име въпреки суфикс в името на проекта', async () => {
    mockDb.query.mockResolvedValueOnce([
      { project_id: '1', name: 'Video Production' },
      { project_id: '777', name: 'Cineland - Видео' },
      { project_id: '888', name: 'Ecopack' }
    ]);
    const p = await kc.resolveClientProject({ id: 2, name: 'Cineland' });
    expect(p.project_id).toBe('777');
    // запомня съвпадението за следващия път
    expect(mockDb.execute).toHaveBeenCalledWith(
      'UPDATE kp_clients SET bc_project_id = $1 WHERE id = $2', ['777', 2]
    );
  });

  test('точното съвпадение бие частичното', async () => {
    mockDb.query.mockResolvedValueOnce([
      { project_id: '2', name: 'Ecopack' },
      { project_id: '3', name: 'Ecopack Bulgaria' }
    ]);
    const p = await kc.resolveClientProject({ id: 3, name: 'Ecopack' });
    expect(p.project_id).toBe('2');
  });

  test('двусмислено частично съвпадение → нищо (по-добре без данни, отколкото чужди)', async () => {
    mockDb.query.mockResolvedValueOnce([
      { project_id: '2', name: 'Eco Pack' },
      { project_id: '3', name: 'Eco Farm' }
    ]);
    expect(await kc.resolveClientProject({ id: 3, name: 'Eco' })).toBeNull();
  });

  test('няма съвпадение → null', async () => {
    mockDb.query.mockResolvedValueOnce([{ project_id: '2', name: 'Друг клиент' }]);
    expect(await kc.resolveClientProject({ id: 4, name: 'Cineland' })).toBeNull();
  });
});
