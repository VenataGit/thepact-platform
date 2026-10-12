// Бутонът „✓ Готово" (routes/task-completions.js) — отметката се намира и след
// местене на картата в друг отдел, когато Basecamp ѝ дава нов номер.
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

const request = require('supertest');
const app = require('../src/app');
const { MEMBER_USER, getAuthCookie } = require('./setup');

const cookie = getAuthCookie(MEMBER_USER);

beforeAll(async () => {
  await request(app).get('/api/task-completions/status?bc_card_id=1').set('Cookie', cookie);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue([]);
  mockDb.queryOne.mockResolvedValue(null);
});

describe('GET /api/task-completions/status', () => {
  it('търси по номер ИЛИ по заглавие, само за този човек', async () => {
    const res = await request(app)
      .get('/api/task-completions/status')
      .query({ bc_card_id: '222', title: '  Видео 3   Fornetti ' })
      .set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.done).toBe(false);
    const [sql, params] = mockDb.queryOne.mock.calls[0];
    expect(sql).toMatch(/user_id = \$1/);
    expect(sql).toMatch(/OR/);
    expect(params).toEqual([MEMBER_USER.id, '222', 'Видео 3 Fornetti']);
  });

  it('намерено по заглавие на стар номер → done и пренасочване към новия', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 9, bc_card_id: '111', occurred_at: '2026-10-01T10:00:00Z' });
    const res = await request(app)
      .get('/api/task-completions/status')
      .query({ bc_card_id: '222', title: 'Видео 3', url: 'https://3.basecamp.com/x/222' })
      .set('Cookie', cookie);
    expect(res.body.done).toBe(true);
    const upd = mockDb.query.mock.calls.find((c) => /UPDATE task_completions/.test(c[0]));
    expect(upd[1]).toEqual([9, '222', 'https://3.basecamp.com/x/222']);
  });

  it('кратко заглавие не се ползва за търсене', async () => {
    await request(app).get('/api/task-completions/status')
      .query({ bc_card_id: '5', title: 'аб' }).set('Cookie', cookie);
    expect(mockDb.queryOne.mock.calls[0][1][2]).toBe('');
  });
});

describe('POST /api/task-completions/toggle', () => {
  it('отметка, намерена по заглавие на стария номер, се маха', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 9, bc_card_id: '111' });
    const res = await request(app).post('/api/task-completions/toggle')
      .send({ bc_card_id: '222', title: 'Видео 3' }).set('Cookie', cookie);
    expect(res.body.done).toBe(false);
    expect(mockDb.query).toHaveBeenCalledWith('DELETE FROM task_completions WHERE id = $1', [9]);
  });

  it('няма отметка → записва', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null).mockResolvedValueOnce({ occurred_at: '2026-10-12T09:00:00Z' });
    const res = await request(app).post('/api/task-completions/toggle')
      .send({ bc_card_id: '222', bc_project_id: '7', title: 'Видео 3' }).set('Cookie', cookie);
    expect(res.body.done).toBe(true);
    expect(mockDb.queryOne.mock.calls[1][0]).toMatch(/INSERT INTO task_completions/);
  });
});
