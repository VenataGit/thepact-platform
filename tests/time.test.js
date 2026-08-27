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
    mockDb.queryOne.mockResolvedValueOnce(null);            // stageOf — картата не е в снапшота
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
    mockDb.queryOne.mockResolvedValueOnce(null);            // stageOf
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

  // Етапът = дъската, на която стои картата в момента на старта. Записва се
  // върху сегмента, за да не се пренапише, когато картата мине нататък.
  it('записва етапа от дъската на картата', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ board_title: 'Production', column_title: 'Студио' });
    mockDb.queryOne.mockResolvedValueOnce(null);
    mockDb.queryOne.mockResolvedValueOnce(entryRow({ stage_board: 'Production', stage_column: 'Студио' }));
    mockDb.queryOne.mockResolvedValueOnce({ secs: 0 });

    const res = await request(app)
      .post('/api/time/start')
      .set('Cookie', memberCookie)
      .send({ bc_recording_id: '12345', recording_type: 'cards', title: 'Заснемане' });

    expect(res.status).toBe(200);
    expect(res.body.entry).toMatchObject({ stageBoard: 'Production', stageColumn: 'Студио' });

    const insert = mockDb.queryOne.mock.calls.find((c) => /INSERT INTO time_entries/.test(c[0]));
    expect(insert[1]).toEqual(expect.arrayContaining(['Production', 'Студио']));
  });

  it('todo-то не се води на етап (дъски има само при картите)', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);            // closeRunning (stageOf се прескача)
    mockDb.queryOne.mockResolvedValueOnce(entryRow({ recording_type: 'todos' }));
    mockDb.queryOne.mockResolvedValueOnce({ secs: 0 });

    const res = await request(app)
      .post('/api/time/start')
      .set('Cookie', memberCookie)
      .send({ bc_recording_id: '999', recording_type: 'todos', title: 'Todo' });

    expect(res.status).toBe(200);
    const lookedUp = mockDb.queryOne.mock.calls.some((c) => /FROM bc_cards_snap/.test(c[0]));
    expect(lookedUp).toBe(false);
    const insert = mockDb.queryOne.mock.calls.find((c) => /INSERT INTO time_entries/.test(c[0]));
    expect(insert[1].slice(-2)).toEqual(['', '']);
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

// Разширението пита платформата „кой съм аз" и „как се казва човек с това
// Basecamp id" — оттам се оправя „Колега редактира…" в Basecamp.
describe('GET /api/extension/me и /api/extension/people', () => {
  it('/me връща името и Basecamp id-то на човека', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ name: 'Венцислав Калчев', basecamp_user_id: '123' });
    const res = await request(app).get('/api/extension/me').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Венцислав Калчев', basecampUserId: '123' });
  });

  it('/me не гърми, ако човекът още няма вързан Basecamp профил', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ name: 'Някой', basecamp_user_id: null });
    const res = await request(app).get('/api/extension/me').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body.basecampUserId).toBe('');
  });

  it('/people връща имена по id и пропуска боклука в списъка', async () => {
    mockDb.query.mockResolvedValueOnce([
      { person_id: '777', name: 'Йоанна Минчева' },
      { person_id: '888', name: '' }
    ]);
    const res = await request(app)
      .get('/api/extension/people?ids=777,%20888,абв,999')
      .set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ 777: 'Йоанна Минчева' });   // празните имена не се връщат
    expect(mockDb.query.mock.calls[0][1][0]).toEqual(['777', '888', '999']);
  });

  it('/people без id-та не пита базата', async () => {
    const before = mockDb.query.mock.calls.length;
    const res = await request(app).get('/api/extension/people').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({});
    expect(mockDb.query.mock.calls.length).toBe(before);
  });

  it('без вход не се дава нищо', async () => {
    expect((await request(app).get('/api/extension/me')).status).toBe(401);
    expect((await request(app).get('/api/extension/people?ids=1')).status).toBe(401);
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


// Една задача се проследява през ДВЕ различни събития, които никога не идват
// заедно: местене между дъски (ново id, старо заглавие) и преименуване (старо id,
// ново заглавие). Затова заглавието и id-то се обединяват транзитивно.
describe('GET /api/time/report — една задача през местене и преименуване', () => {
  // „Видео 3 - Монтаж" е започнало на карта 100, преместено е на карта 200
  // (ново id, същото заглавие), после е преименувано на „Финален монтаж"
  // (същата карта 200, ново заглавие). Трите двойки са една задача.
  const pairs = [
    {
      title_key: 'cineland кп-18 - видео 3 - монтаж', bc_recording_id: '100',
      title: 'Cineland КП-18 - Видео 3 - Монтаж', last_started: '2026-07-05T09:00:00.000Z',
      seconds: 1200, entries: 1, user_ids: [2], project_name: 'Video Production'
    },
    {
      title_key: 'cineland кп-18 - видео 3 - монтаж', bc_recording_id: '200',
      title: 'Cineland КП-18 - Видео 3 - Монтаж', last_started: '2026-07-06T09:00:00.000Z',
      seconds: 1200, entries: 1, user_ids: [3], project_name: 'Video Production'
    },
    {
      title_key: 'cineland кп-18 - видео 3 - финален монтаж', bc_recording_id: '200',
      title: 'Cineland КП-18 - Видео 3 - Финален монтаж', last_started: '2026-07-07T09:00:00.000Z',
      seconds: 1200, entries: 1, user_ids: [2], project_name: 'Video Production'
    },
    {
      title_key: 'cineland кп-18 - видео 4 - заснемане', bc_recording_id: '300',
      title: 'Cineland КП-18 - Видео 4 - Заснемане', last_started: '2026-07-06T09:00:00.000Z',
      seconds: 1800, entries: 1, user_ids: [2], project_name: 'Video Production'
    },
    {
      title_key: 'вътрешна задача', bc_recording_id: null,
      title: 'Вътрешна задача', last_started: '2026-07-06T09:00:00.000Z',
      seconds: 1200, entries: 1, user_ids: [4], project_name: ''
    }
  ];

  const mockReport = () => {
    mockDb.queryOne.mockResolvedValueOnce({ seconds: 6600, entries: 5, users: 3, manual_seconds: 0 });
    mockDb.query
      .mockResolvedValueOnce([])     // byUser
      .mockResolvedValueOnce([])     // byProject
      .mockResolvedValueOnce(pairs)  // двойките (заглавие, карта)
      .mockResolvedValueOnce([])     // byDay
      .mockResolvedValueOnce([       // byStage — колко е отнело на всеки етап
        { stage: 'Post-Production', seconds: 3600, entries: 3, users: 2, tasks: 2 },
        { stage: 'Production', seconds: 1800, entries: 1, users: 1, tasks: 1 },
        { stage: '(без етап)', seconds: 1200, entries: 1, users: 1, tasks: 0 }
      ]);
  };

  it('изисква админ', async () => {
    const res = await request(app).get('/api/time/report').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });

  it('връща разбивка по етап (измисляне / записване / монтаж)', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body.byStage).toHaveLength(3);
    expect(res.body.byStage[0]).toMatchObject({ stage: 'Post-Production', seconds: 3600 });
    // подредбата е по време, за да се вижда веднага кое отнема най-много
    const secs = res.body.byStage.map((s) => s.seconds);
    expect(secs).toEqual([...secs].sort((a, b) => b - a));
  });

  it('слива местене + преименуване в една задача', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    const top = res.body.byTask[0];
    expect(top.seconds).toBe(3600);   // 3 x 1200 събрани
    expect(top.cards).toBe(2);        // карти 100 и 200
    expect(top.titles).toBe(2);       // преди и след преименуването
    expect(top.entries).toBe(3);
    expect(top.users).toBe(2);        // 2 и 3, без дублиране
  });

  it('показва НАЙ-СКОРОШНОТО заглавие, не първото', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.body.byTask[0].title).toBe('Cineland КП-18 - Видео 3 - Финален монтаж');
    expect(res.body.byTask[0].titleKeys.slice().sort()).toEqual([
      'cineland кп-18 - видео 3 - монтаж',
      'cineland кп-18 - видео 3 - финален монтаж'
    ]);
  });

  it('брои сглобените задачи, а не заглавията', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.body.totals.tasks).toBe(3);  // Видео 3, Видео 4, Вътрешна
    expect(res.body.tasksTotal).toBe(3);
  });

  it('записи без карта не се слепват в една задача', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ seconds: 0, entries: 0, users: 0, manual_seconds: 0 });
    mockDb.query
      .mockResolvedValueOnce([]).mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          title_key: 'първа', bc_recording_id: null, title: 'Първа',
          last_started: '2026-07-05T09:00:00.000Z', seconds: 60, entries: 1, user_ids: [2], project_name: ''
        },
        {
          title_key: 'втора', bc_recording_id: null, title: 'Втора',
          last_started: '2026-07-05T10:00:00.000Z', seconds: 60, entries: 1, user_ids: [2], project_name: ''
        }
      ])
      .mockResolvedValueOnce([]);
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.body.tasksTotal).toBe(2);
  });

  it('сумира по клиент, вкл. „Без клиент" за заглавия без КП', async () => {
    mockReport();
    const res = await request(app).get('/api/time/report').set('Cookie', adminCookie);
    expect(res.body.byClient).toEqual([
      { client: 'Cineland', seconds: 5400, tasks: 2, entries: 4 },
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

  it('групира по нормализирано заглавие + карта, а не само по bc_recording_id', async () => {
    mockReport();
    await request(app).get('/api/time/report').set('Cookie', adminCookie);
    const sql = mockDb.query.mock.calls[2][0];
    expect(sql).toMatch(/GROUP BY lower\(btrim\(regexp_replace\(e\.title[\s\S]*e\.bc_recording_id/);
  });
});

describe('GET /api/time/report/entries — филтър по задача / клиент / КП', () => {
  const pairs = [
    {
      title_key: 'cineland кп-18 - видео 3 - монтаж', bc_recording_id: '100',
      title: 'Cineland КП-18 - Видео 3 - Монтаж', last_started: '2026-07-05T09:00:00.000Z',
      seconds: 3000, entries: 1, user_ids: [2], project_name: ''
    },
    {
      title_key: 'cineland кп-18 - видео 3 - финален монтаж', bc_recording_id: '100',
      title: 'Cineland КП-18 - Видео 3 - Финален монтаж', last_started: '2026-07-07T09:00:00.000Z',
      seconds: 3000, entries: 1, user_ids: [2], project_name: ''
    },
    {
      title_key: 'cineland кп-19 - видео 1 - монтаж', bc_recording_id: '400',
      title: 'Cineland КП-19 - Видео 1 - Монтаж', last_started: '2026-07-06T09:00:00.000Z',
      seconds: 1000, entries: 1, user_ids: [2], project_name: ''
    },
    {
      title_key: 'друг клиент кп-2 - видео 1', bc_recording_id: '500',
      title: 'Друг Клиент КП-2 - Видео 1', last_started: '2026-07-06T09:00:00.000Z',
      seconds: 500, entries: 1, user_ids: [3], project_name: ''
    },
    {
      title_key: 'вътрешна задача', bc_recording_id: null,
      title: 'Вътрешна задача', last_started: '2026-07-06T09:00:00.000Z',
      seconds: 100, entries: 1, user_ids: [4], project_name: ''
    }
  ];
  const keysPassed = (call) => (mockDb.query.mock.calls[call][1][5] || []).slice().sort();

  it('преименувана задача се филтрира по ВСИЧКИТЕ си заглавия', async () => {
    mockDb.query.mockResolvedValueOnce([]);
    await request(app)
      .get('/api/time/report/entries?title_key=' + encodeURIComponent('cineland кп-18 - видео 3 - монтаж') +
           '&title_key=' + encodeURIComponent('cineland кп-18 - видео 3 - финален монтаж'))
      .set('Cookie', adminCookie);
    expect(keysPassed(0)).toEqual([
      'cineland кп-18 - видео 3 - монтаж',
      'cineland кп-18 - видео 3 - финален монтаж'
    ]);
  });

  it('филтрира по етап (седмият параметър стига до заявката)', async () => {
    mockDb.query.mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/time/report/entries?stage=' + encodeURIComponent('Pre-Production'))
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(mockDb.query.mock.calls[0][1][6]).toBe('Pre-Production');
  });

  it('без параметър „stage" няма филтър по етап', async () => {
    mockDb.query.mockResolvedValueOnce([]);
    await request(app).get('/api/time/report/entries').set('Cookie', adminCookie);
    expect(mockDb.query.mock.calls[0][1][6]).toBeNull();
  });

  it('клиентът включва и старите заглавия на преименуваните си задачи', async () => {
    mockDb.query.mockResolvedValueOnce(pairs).mockResolvedValueOnce([]);
    const res = await request(app)
      .get('/api/time/report/entries?client=Cineland')
      .set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(keysPassed(1)).toEqual([
      'cineland кп-18 - видео 3 - монтаж',
      'cineland кп-18 - видео 3 - финален монтаж',
      'cineland кп-19 - видео 1 - монтаж'
    ]);
  });

  it('клиент + КП стеснява до един контент план', async () => {
    mockDb.query.mockResolvedValueOnce(pairs).mockResolvedValueOnce([]);
    await request(app)
      .get('/api/time/report/entries?client=Cineland&kp=19')
      .set('Cookie', adminCookie);
    expect(keysPassed(1)).toEqual(['cineland кп-19 - видео 1 - монтаж']);
  });

  it('„Без клиент" хваща само заглавията без КП', async () => {
    mockDb.query.mockResolvedValueOnce(pairs).mockResolvedValueOnce([]);
    await request(app)
      .get('/api/time/report/entries?client=' + encodeURIComponent('Без клиент'))
      .set('Cookie', adminCookie);
    expect(keysPassed(1)).toEqual(['вътрешна задача']);
  });

  it('без филтър по задача не се подава списък заглавия', async () => {
    mockDb.query.mockResolvedValueOnce([]);
    await request(app).get('/api/time/report/entries').set('Cookie', adminCookie);
    expect(mockDb.query.mock.calls[0][1][5]).toBeNull();
  });
});
