// CRM — чистата логика (услугата) + вратата (кой има право да влезе).
// Нищо тук не пипа истинска база или Basecamp.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(),
  broadcast: jest.fn(),
  sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0),
  getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null),
  disconnectUser: jest.fn(),
}));

jest.mock('../src/services/push', () => ({
  initPush: jest.fn(),
  sendPushToUser: jest.fn(),
  sendPushToUsers: jest.fn(),
  sendPushToAllExcept: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const crm = require('../src/services/crm');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');

const adminCookie = getAuthCookie(ADMIN_USER);
const memberCookie = getAuthCookie(MEMBER_USER);

const DAY = 86400000;
const NOW = Date.UTC(2026, 6, 31, 12, 0, 0); // 31.07.2026
const iso = (offsetDays) => new Date(NOW + offsetDays * DAY).toISOString().slice(0, 10);

const STAGES = [
  { id: 1, title: 'Нов контакт', kind: 'open', probability: 10, rot_days: 7 },
  { id: 2, title: 'Изпратено КП', kind: 'open', probability: 50, rot_days: 10 },
  { id: 3, title: 'Спечелена', kind: 'won', probability: 100, rot_days: 90 },
  { id: 4, title: 'Загубена', kind: 'lost', probability: 0, rot_days: 90 },
];

beforeEach(() => {
  mockDb.query.mockReset().mockResolvedValue([]);
  mockDb.queryOne.mockReset().mockResolvedValue(null);
  mockDb.execute.mockReset().mockResolvedValue(undefined);
});

// ---------------------------------------------------------------- валидация

describe('normalizeDeal', () => {
  test('без име не минава', () => {
    expect(() => crm.normalizeDeal({ stage_id: 1 }, false)).toThrow(/име/i);
  });

  test('стойност с интервали и запетая става число', () => {
    const f = crm.normalizeDeal({ title: 'Пакет', stage_id: 1, value: '4 500,50' }, false);
    expect(f.value).toBe(4500.5);
  });

  test('отрицателна стойност и невалидна дата не минават', () => {
    expect(() => crm.normalizeDeal({ title: 'X', stage_id: 1, value: '-10' }, false)).toThrow(/число/i);
    expect(() => crm.normalizeDeal({ title: 'X', stage_id: 1, next_step_at: '31.07.2026' }, false)).toThrow(/дата/i);
  });

  test('частична редакция пипа само подадените полета', () => {
    const f = crm.normalizeDeal({ next_step: 'Обаждане' }, true);
    expect(Object.keys(f)).toEqual(['next_step']);
    expect(f.next_step).toBe('Обаждане');
  });

  test('празен отговорник става null, а не 0', () => {
    expect(crm.normalizeDeal({ owner_id: '' }, true).owner_id).toBeNull();
    expect(crm.normalizeDeal({ owner_id: '7' }, true).owner_id).toBe(7);
  });
});

// ------------------------------------------------------------- здраве и сигнали

describe('dealHealth', () => {
  test('просрочена следваща стъпка светва, но само за отворена сделка', () => {
    const deal = { status: 'open', next_step_at: iso(-1), stage_since: new Date(NOW).toISOString() };
    expect(crm.dealHealth(deal, STAGES[0], NOW).nextStepOverdue).toBe(true);
    expect(crm.dealHealth({ ...deal, status: 'won' }, STAGES[0], NOW).nextStepOverdue).toBe(false);
  });

  test('днешната стъпка не е просрочена', () => {
    const deal = { status: 'open', next_step_at: iso(0), stage_since: new Date(NOW).toISOString() };
    const h = crm.dealHealth(deal, STAGES[0], NOW);
    expect(h.nextStepOverdue).toBe(false);
    expect(h.nextStepToday).toBe(true);
  });

  test('застояване се мери спрямо нормата на етапа', () => {
    const deal = { status: 'open', stage_since: new Date(NOW - 9 * DAY).toISOString() };
    expect(crm.dealHealth(deal, STAGES[0], NOW).rotting).toBe(true);  // норма 7 дни
    expect(crm.dealHealth(deal, STAGES[1], NOW).rotting).toBe(false); // норма 10 дни
    expect(crm.dealHealth(deal, STAGES[0], NOW).daysInStage).toBe(9);
  });

  test('сделка без следваща стъпка се хваща', () => {
    const deal = { status: 'open', stage_since: new Date(NOW).toISOString() };
    expect(crm.dealHealth(deal, STAGES[0], NOW).noNextStep).toBe(true);
  });
});

// ------------------------------------------------------------------ показатели

describe('computeMetrics', () => {
  const deals = [
    { id: 1, status: 'open', stage_id: 1, value: 1000, stage_since: new Date(NOW).toISOString(), next_step_at: iso(2) },
    { id: 2, status: 'open', stage_id: 2, value: 2000, stage_since: new Date(NOW).toISOString(), next_step_at: iso(-3) },
    { id: 3, status: 'won', stage_id: 3, value: 5000, created_at: new Date(NOW - 20 * DAY).toISOString(), closed_at: new Date(NOW - 10 * DAY).toISOString() },
    { id: 4, status: 'lost', stage_id: 4, value: 800, created_at: new Date(NOW - 40 * DAY).toISOString(), closed_at: new Date(NOW - 35 * DAY).toISOString() },
    { id: 5, status: 'open', stage_id: 1, value: 999, archived: true, stage_since: new Date(NOW).toISOString() },
  ];

  test('архивираните не се броят никъде', () => {
    const m = crm.computeMetrics(deals, STAGES, NOW);
    expect(m.openCount).toBe(2);
    expect(m.pipelineValue).toBe(3000);
  });

  test('претеглената прогноза е по вероятността на етапа', () => {
    const m = crm.computeMetrics(deals, STAGES, NOW);
    expect(m.weighted).toBe(1000 * 0.1 + 2000 * 0.5); // 1100
  });

  test('успеваемост и среден цикъл се смятат само по затворените', () => {
    const m = crm.computeMetrics(deals, STAGES, NOW);
    expect(m.winRate).toBe(50);       // 1 спечелена от 2 затворени
    expect(m.avgDaysToWin).toBe(10);  // 20 дни живот - затворена преди 10
  });

  test('прозорецът за „спечелени напоследък" реже старите', () => {
    const m = crm.computeMetrics(deals, STAGES, NOW, 30);
    expect(m.wonRecentCount).toBe(1);
    expect(m.wonRecentValue).toBe(5000);
    expect(m.lostRecentCount).toBe(0); // загубената е отпреди 35 дни
  });

  test('няма затворени сделки → успеваемостта е неизвестна, не 0%', () => {
    const m = crm.computeMetrics([deals[0]], STAGES, NOW);
    expect(m.winRate).toBeNull();
    expect(m.avgDaysToWin).toBeNull();
  });

  test('броячът „чакат те" вижда просрочената и липсващите стъпки', () => {
    const m = crm.computeMetrics(deals, STAGES, NOW);
    expect(m.needAttention.overdue).toBe(1);
    expect(m.needAttention.noNext).toBe(0);
  });
});

describe('funnel', () => {
  test('брой и пари по етапи, без архивираните', () => {
    const f = crm.funnel(STAGES, [
      { stage_id: 1, value: 100, status: 'open' },
      { stage_id: 1, value: 200, status: 'open' },
      { stage_id: 1, value: 900, status: 'open', archived: true },
      { stage_id: 2, value: 50, status: 'open' },
    ]);
    expect(f[0]).toMatchObject({ id: 1, count: 2, value: 300 });
    expect(f[1]).toMatchObject({ id: 2, count: 1, value: 50 });
    expect(f[2].count).toBe(0);
  });
});

// ----------------------------------------------------------------- достъпът

describe('достъп до CRM', () => {
  test('без сесия → 401', async () => {
    const res = await request(app).get('/api/crm/board');
    expect(res.status).toBe(401);
  });

  test('обикновен потребител без запис в crm_access → 403', async () => {
    mockDb.queryOne.mockResolvedValue(null);
    const res = await request(app).get('/api/crm/board').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });

  test('пуснат потребител влиза, без да пита базата за роля', async () => {
    mockDb.queryOne.mockResolvedValue({ can_grant: true });
    mockDb.query.mockResolvedValue([]);
    const res = await request(app).get('/api/crm/board').set('Cookie', memberCookie);
    expect(res.status).toBe(200);
    expect(res.body.access).toMatchObject({ access: true, canGrant: true, isAdmin: false });
  });

  test('пълният админ влиза по право (няма ред в crm_access)', async () => {
    mockDb.queryOne.mockResolvedValue(null);
    const res = await request(app).get('/api/crm/me').set('Cookie', adminCookie);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ access: true, canGrant: true, isAdmin: true });
  });

  test('човек без право да пуска не може да дава достъп', async () => {
    mockDb.queryOne.mockResolvedValue({ can_grant: false });
    const res = await request(app).post('/api/crm/access').set('Cookie', memberCookie).send({ userId: 5 });
    expect(res.status).toBe(403);
  });

  test('достъп не се дава на пълен админ (той и без това го има)', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ can_grant: true })                    // проверката за мен
      .mockResolvedValueOnce({ id: 9, name: 'Шеф', role: 'admin' }); // целевият човек
    const res = await request(app).post('/api/crm/access').set('Cookie', memberCookie).send({ userId: 9 });
    expect(res.status).toBe(400);
  });

  test('не-админ отнема достъп само на свои хора', async () => {
    mockDb.queryOne
      .mockResolvedValueOnce({ can_grant: true })              // аз имам достъп
      .mockResolvedValueOnce({ user_id: 7, granted_by: 99 });  // но не аз съм го пуснал
    const res = await request(app).delete('/api/crm/access/7').set('Cookie', memberCookie);
    expect(res.status).toBe(403);
  });

  test('етапите се пипат само от пълен админ', async () => {
    mockDb.queryOne.mockResolvedValue({ can_grant: true });
    const res = await request(app).put('/api/crm/stages').set('Cookie', memberCookie).send({ stages: [{ title: 'X' }] });
    expect(res.status).toBe(403);
  });

  test('фуния без нито един етап не се приема', async () => {
    const res = await request(app).put('/api/crm/stages').set('Cookie', adminCookie).send({ stages: [] });
    expect(res.status).toBe(400);
  });
});
