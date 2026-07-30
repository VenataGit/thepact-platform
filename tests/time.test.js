// Time tracking API (routes/time.js + routes/extension-tokens.js + bearer auth)
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
const { broadcast } = require('../src/ws/broadcast');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');

const adminCookie = getAuthCookie(ADMIN_USER);
const memberCookie = getAuthCookie(MEMBER_USER);

const entryRow = (over = {}) => ({
  id: 6,
  user_id: MEMBER_USER.id,
  bc_project_id: '39396506',
  bc_recording_id: '12345',
  recording_type: 'cards',
  title: 'Видео за клиент Х',
  url: 'https://3.basecamp.com/5750544/buckets/39396506/card_tables/cards/12345',
  started_at: '2026-07-10T09:00:00.000Z',
  ended_at: null,
  duration_seconds: null,
  is_manual: false,
  stopped_by: '',
  note: '',
  ...over
});

beforeAll(async () => {
  // Първата cookie заявка на потребител пали async is_active проверка, която
  // консумира един queryOne — загряваме кеша, за да са детерминистични тестовете.
  await request(app).get('/api/time/me/today').set('Cookie', adminCookie);
  await request(app).get('/api/time/me/today').set('Cookie', memberCookie);
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /api/time/start', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).post('/api/time/start').send({ bc_recording_id: '1' });
    expect(res.status).toBe(401);
  });

  it('returns 400 without bc_recording_id', async () => {
    const res = await request(app)
      .post('/api/time/start')
      .set('Cookie', memberCookie)
      .send({ title: 'Без задача' });
    expect(res.status).toBe(400);
  });

  it('starts a timer and broadcasts working:start', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);            // closeRunning — няма стар
    mockDb.queryOne.mockResolvedValueOnce(entryRow());      // INSERT RETURNING
    mockDb.queryOne.mockResolvedValueOnce({ secs: 3600 });  // todaySeconds

    const res = await request(app)
      .post('/api/time/start')
      .set('Cookie', memberCookie)
      .send({ bc_recording_id: '12345', bc_project_id: '39396506', recording_type: 'cards', title: 'Видео за клиент Х' });

    expect(res.status).toBe(200);
    expect(res.body.entry).toHaveProperty('id', 6);
    expect(res.body.entry).toHaveProperty('bcRecordingId', '12345');
    expect(res.body).toHaveProperty('todaySeconds', 3600);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'time:working:start', bcRecordingId: '12345', userId: MEMBER_USER.id
    }));
  });

  it('stops the previous timer when starting a new one (one per user)', async () => {
    const prev = entryRow({ id: 5, bc_recording_id: '111', ended_at: '2026-07-10T10:00:00.000Z' });
    mockDb.queryOne.mockResolvedValueOnce(prev);            // closeRunning затвори стария
    mockDb.queryOne.mockResolvedValueOnce(entryRow());      // INSERT
    mockDb.queryOne.mockResolvedValueOnce({ secs: 100 });   // todaySeconds

    const res = await request(app)
      .post('/api/time/start')
      .set('Cookie', memberCookie)
      .send({ bc_recording_id: '12345' });

    expect(res.status).toBe(200);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({
      type: 'time:working:stop', entryId: 5, bcRecordingId: '111'
    }));
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'time:working:start' }));
  });
});

describe('POST /api/time/beat', () => {
  it('404 when no timer is running', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/time/beat').set('Cookie', memberCookie);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/time/stop', () => {
  it('stops the running timer and broadcasts working:stop', async () => {
    const closed = entryRow({ ended_at: '2026-07-10T11:00:00.000Z', duration_seconds: 7200, stopped_by: 'pause' });
    mockDb.queryOne.mockResolvedValueOnce(closed);          // closeRunning
    mockDb.queryOne.mockResolvedValueOnce({ secs: 7200 });  // todaySeconds

    const res = await request(app)
      .post('/api/time/stop')
      .set('Cookie', memberCookie)
      .send({ reason: 'pause' });

    expect(res.status).toBe(200);
    expect(res.body.entry).toHaveProperty('durationSeconds', 7200);
    expect(broadcast).toHaveBeenCalledWith(expect.objectContaining({ type: 'time:working:stop', entryId: 6 }));
  });

  it('is a no-op when nothing runs', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);
    mockDb.queryOne.mockResolvedValueOnce({ secs: 0 });
    const res = await request(app).post('/api/time/stop').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body.entry).toBeNull();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('GET /api/time/active', () => {
  it('lists running timers with user names', async () => {
    mockDb.query.mockResolvedValueOnce([{ ...entryRow(), user_name: 'Test Member' }]);
    const res = await request(app).get('/api/time/active').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toHaveProperty('userName', 'Test Member');
  });
});

describe('Bearer token auth (extension)', () => {
  it('authenticates a valid pt_ token', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: MEMBER_USER.id, role: 'member', name: 'Test Member' }); // token lookup
    mockDb.queryOne.mockResolvedValueOnce({ secs: 42 });    // todaySeconds

    const res = await request(app)
      .get('/api/time/me/today')
      .set('Authorization', 'Bearer pt_' + 'a'.repeat(64));

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('todaySeconds', 42);
  });

  it('rejects an unknown token', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);            // token lookup — няма такъв
    const res = await request(app)
      .get('/api/time/me/today')
      .set('Authorization', 'Bearer pt_' + 'b'.repeat(64));
    expect(res.status).toBe(401);
  });

  it('rejects malformed bearer values', async () => {
    const res = await request(app)
      .get('/api/time/me/today')
      .set('Authorization', 'Bearer not-a-token');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/extension/token', () => {
  it('issues a pt_ token for a cookie session', async () => {
    const res = await request(app)
      .post('/api/extension/token')
      .set('Cookie', adminCookie)
      .send({ label: 'Chrome' });
    expect(res.status).toBe(200);
    expect(res.body.token).toMatch(/^pt_[0-9a-f]{64}$/);
    expect(res.body).toHaveProperty('name', 'Test Admin');
    expect(mockDb.query).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO extension_tokens'), expect.anything());
  });

  it('refuses to mint tokens from an extension token session', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: MEMBER_USER.id, role: 'member', name: 'Test Member' });
    const res = await request(app)
      .post('/api/extension/token')
      .set('Authorization', 'Bearer pt_' + 'c'.repeat(64));
    expect(res.status).toBe(403);
  });
});

describe('PATCH/DELETE /api/time/entries/:id', () => {
  it("forbids editing someone else's entry", async () => {
    mockDb.queryOne.mockResolvedValueOnce(entryRow({ user_id: ADMIN_USER.id, ended_at: '2026-07-10T11:00:00.000Z' }));
    const res = await request(app)
      .patch('/api/time/entries/6')
      .set('Cookie', memberCookie)
      .send({ note: 'чужд запис' });
    expect(res.status).toBe(403);
  });

  it('rejects editing a running entry', async () => {
    mockDb.queryOne.mockResolvedValueOnce(entryRow({ ended_at: null }));
    const res = await request(app)
      .patch('/api/time/entries/6')
      .set('Cookie', memberCookie)
      .send({ note: 'върви още' });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/time/manual', () => {
  it('rejects invalid dates', async () => {
    const res = await request(app)
      .post('/api/time/manual')
      .set('Cookie', memberCookie)
      .send({ started_at: 'not-a-date', ended_at: '2026-07-10T11:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('rejects reversed ranges', async () => {
    const res = await request(app)
      .post('/api/time/manual')
      .set('Cookie', memberCookie)
      .send({ started_at: '2026-07-10T12:00:00Z', ended_at: '2026-07-10T11:00:00Z' });
    expect(res.status).toBe(400);
  });

  it('creates a manual entry marked is_manual', async () => {
    mockDb.queryOne.mockResolvedValueOnce(entryRow({ is_manual: true, ended_at: '2026-07-10T11:00:00.000Z', duration_seconds: 3600 }));
    const res = await request(app)
      .post('/api/time/manual')
      .set('Cookie', memberCookie)
      .send({ started_at: '2026-07-10T10:00:00Z', ended_at: '2026-07-10T11:00:00Z', title: 'Забравен таймер' });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('isManual', true);
  });
});

// Времето се групира по ЗАГЛАВИЕ, не по bc_recording_id (картите сменят id при
// местене между дъски през портал). Клиентът и КП-то се разчитат от заглавието.
describe('GET /api/time/report — групиране по заглавие', () => {
  const titleRows = [
    {
      title_key: 'cineland кп-18 - видео 3 - монтаж',
      title: 'Cineland КП-18 - Видео 3 - Монтаж',
      seconds: 3600, users: 1, entries: 2, cards: 2,
      bc_recording_id: '999', project_name: 'Video Production'
    },
    {
      title_key: 'cineland кп-18 - видео 4 - заснемане',
      title: 'Cineland КП-18 - Видео 4 - Заснемане',
      seconds: 1800, users: 1, entries: 1, cards: 1,
      bc_recording_id: '1000', project_name: 'Video Production'
    },
    {
      title_key: 'вътрешна задача',
      title: 'Вътрешна задача',
      seconds: 1200, users: 1, entries: 1, cards: 1,
      bc_recording_id: null, project_name: ''
    }
  ];

  const mockReport = () => {
    mockDb.queryOne.mockResolvedValueOnce({ seconds: 6600, entries: 4, users: 2, tasks: 3, manual_seconds: 0 });
    mockDb.query
      .mockResolvedValueOnce([])         // byUser
      .mockResolvedValueOnce([])         // byProject
      .mockResolvedValueOnce(titleRows)  // задачите по заглавие
      .mockResolvedValueOnce([]);        // byDay
  };

  it('изисква админ', async () => {
    const res = await request(app).get('/api/time/report').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });

  it('сумира по клиент, вкл. „Без клиент" за заглавия без КП', async () => {
    mockReport();
    const res = await request(app)
      .get('/api/time/report?from=2026-07-01&to=2026-07-31')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.byClient).toEqual([
      { client: 'Cineland', seconds: 5400, tasks: 2, entries: 3 },
      { client: 'Без клиент', seconds: 1200, tasks: 1, entries: 1 }
    ]);
  });

  it('сумира по контент план', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.body.byKp).toHaveLength(1);
    expect(res.body.byKp[0]).toMatchObject({
      label: 'Cineland КП-18', client: 'Cineland', kp: 18, seconds: 5400, tasks: 2
    });
  });

  it('задача, минала през две карти, е един ред с cards: 2', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.body.byTask[0]).toMatchObject({ cards: 2, seconds: 3600 });
    expect(res.body.tasksTotal).toBe(3);
  });

  it('групира по нормализирано заглавие, а не по bc_recording_id', async () => {
    mockReport();
    await request(app).get('/api/time/report').set('Cookie', adminCookie);
    const taskSql = mockDb.query.mock.calls[2][0];
    expect(taskSql).toMatch(/GROUP BY lower\(btrim\(regexp_replace\(e\.title/);
    expect(taskSql).not.toMatch(/GROUP BY e\.bc_recording_id/);
  });
});

describe('GET /api/time/report/entries — филтър по клиент / КП', () => {
  const keyRows = [
    { title_key: 'cineland кп-18 - видео 3 - монтаж', title: 'Cineland КП-18 - Видео 3 - Монтаж' },
    { title_key: 'cineland кп-19 - видео 1 - монтаж', title: 'Cineland КП-19 - Видео 1 - Монтаж' },
    { title_key: 'друг клиент кп-2 - видео 1', title: 'Друг Клиент КП-2 - Видео 1' },
    { title_key: 'вътрешна задача', title: 'Вътрешна задача' }
  ];

  it('клиентът се превежда до своите заглавия и чуждите не влизат', async () => {
    mockDb.query.mockResolvedValueOnce(keyRows).mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/time/report/entries?client=Cineland')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(mockDb.query.mock.calls[1][1][5]).toEqual([
      'cineland кп-18 - видео 3 - монтаж',
      'cineland кп-19 - видео 1 - монтаж'
    ]);
  });

  it('клиент + КП стеснява до един контент план', async () => {
    mockDb.query.mockResolvedValueOnce(keyRows).mockResolvedValueOnce([]);
    await request(app)
      .get('/api/time/report/entries?client=Cineland&kp=19')
      .set('Cookie', adminCookie);
    expect(mockDb.query.mock.calls[1][1][5]).toEqual(['cineland кп-19 - видео 1 - монтаж']);
  });

  it('„Без клиент" хваща само заглавията без КП', async () => {
    mockDb.query.mockResolvedValueOnce(keyRows).mockResolvedValueOnce([]);
    await request(app)
      .get('/api/time/report/entries?client=' + encodeURIComponent('Без клиент'))
      .set('Cookie', adminCookie);
    expect(mockDb.query.mock.calls[1][1][5]).toEqual(['вътрешна задача']);
  });

  it('без филтър по задача не се подава списък заглавия', async () => {
    mockDb.query.mockResolvedValueOnce([]);
    await request(app).get('/api/time/report/entries').set('Cookie', adminCookie);
    expect(mockDb.query.mock.calls[0][1][5]).toBeNull();
  });
});
