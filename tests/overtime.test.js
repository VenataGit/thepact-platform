// Overtime (routes/overtime.js): всеки вижда само своите, админ — всички;
// часовете се смятат на сървъра; триене само на свои; редакция няма.
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
const calc = require('../public/js/overtime-calc');

const member = getAuthCookie(MEMBER_USER);
const admin = getAuthCookie(ADMIN_USER);

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue([]);
  mockDb.queryOne.mockResolvedValue(null);
});

describe('сметката', () => {
  it.each([
    ['2026-11-02', '18:00', '21:00', 120], // делник: само след 19:00
    ['2026-11-02', '07:00', '20:00', 240], // преди 10 и след 19
    ['2026-11-07', '09:00', '14:00', 300], // събота — всичко
    ['2026-11-03', '22:00', '02:00', 240], // през полунощ
    ['2026-11-06', '20:00', '11:00', 900], // петък → събота
    ['2026-11-02', '11:00', '15:00', 0],
    ['2026-12-28', '12:00', '13:00', 60]   // Коледа в събота → 28.12 почивен
  ])('%s %s–%s = %i мин', (d, a, b, ot) => {
    expect(calc.calc(d, a, b).ot).toBe(ot);
  });
  it('православен Великден', () => {
    expect(calc.easter(2026)).toBe('2026-04-12');
    expect(calc.easter(2027)).toBe('2027-05-02');
  });
});

describe('GET /api/overtime', () => {
  it('обикновен човек — само своите, дори да поиска друг', async () => {
    const res = await request(app).get('/api/overtime?user=1').set('Cookie', member);
    expect(res.status).toBe(200);
    expect(res.body.admin).toBe(false);
    const call = mockDb.query.mock.calls.find((c) => /FROM overtime_entries o/.test(c[0]) && /work_date BETWEEN/.test(c[0]));
    expect(call[1][2]).toBe(MEMBER_USER.id);
  });
  it('обикновен човек със scope=all — пак само своите', async () => {
    const res = await request(app).get('/api/overtime?scope=all').set('Cookie', member);
    expect(res.body.scope).toBe('mine');
    const call = mockDb.query.mock.calls.find((c) => /work_date BETWEEN/.test(c[0]));
    expect(call[1][2]).toBe(MEMBER_USER.id);
  });
  it('админ без scope — само своите', async () => {
    const res = await request(app).get('/api/overtime').set('Cookie', admin);
    expect(res.body.admin).toBe(true);
    expect(res.body.scope).toBe('mine');
    const call = mockDb.query.mock.calls.find((c) => /work_date BETWEEN/.test(c[0]));
    expect(call[1][2]).toBe(ADMIN_USER.id);
  });
  it('админ изглед (scope=all) — всички (null) и списък с хора', async () => {
    const res = await request(app).get('/api/overtime?scope=all').set('Cookie', admin);
    expect(res.body.scope).toBe('all');
    const call = mockDb.query.mock.calls.find((c) => /work_date BETWEEN/.test(c[0]));
    expect(call[1][2]).toBeNull();
    expect(mockDb.query.mock.calls.some((c) => /SELECT DISTINCT u.id/.test(c[0]))).toBe(true);
  });
});

describe('POST /api/overtime', () => {
  const ok = { date: '2026-10-08', from: '19:00', to: '22:30', client: 'Клиент А', kind: 'Събитие', note: 'репортаж', comp: 'pay' };
  it('записва със сметнатите от сървъра минути', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 5 });
    const res = await request(app).post('/api/overtime').set('Cookie', member).send({ ...ok, ot_minutes: 9999 });
    expect(res.status).toBe(200);
    expect(res.body.ot_minutes).toBe(210);
    const [sql, p] = mockDb.queryOne.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO overtime_entries/);
    expect(p).toEqual([MEMBER_USER.id, '2026-10-08', '19:00', '22:30', 210, 210, 'Клиент А', 'Събитие', 'репортаж', 'pay']);
  });
  it.each([
    [{ comp: '' }, /плащане или почивка/],
    [{ note: '' }, /какво/],
    [{ client: '' }, /за кого/],
    [{ from: '11:00', to: '15:00' }, /няма overtime/],
    [{ date: '2099-01-01' }, /бъдещето/]
  ])('отказва %o', async (patch, msg) => {
    const res = await request(app).post('/api/overtime').set('Cookie', member).send({ ...ok, ...patch });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(msg);
  });
});

describe('DELETE /api/overtime/:id', () => {
  it('чужд запис → 403', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ user_id: 99 });
    const res = await request(app).delete('/api/overtime/7').set('Cookie', member);
    expect(res.status).toBe(403);
    expect(mockDb.execute.mock.calls.some((c) => /SET deleted_at/.test(c[0]))).toBe(false);
  });
  it('свой запис → меко триене', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ user_id: MEMBER_USER.id });
    const res = await request(app).delete('/api/overtime/7').set('Cookie', member);
    expect(res.status).toBe(200);
    expect(mockDb.execute.mock.calls.find((c) => /SET deleted_at/.test(c[0]))[1]).toEqual([7]);
  });
  it('редакция няма', async () => {
    const res = await request(app).put('/api/overtime/7').set('Cookie', member).send({});
    expect(res.status).toBe(404);
  });
});

describe('бележки на админа', () => {
  it('обикновен човек → 403 за четене и писане', async () => {
    expect((await request(app).get('/api/overtime/notes').set('Cookie', member)).status).toBe(403);
    expect((await request(app).post('/api/overtime/notes').set('Cookie', member).send({ text: 'x' })).status).toBe(403);
    expect((await request(app).delete('/api/overtime/notes/1').set('Cookie', member)).status).toBe(403);
  });
  it('админ записва бележка за човек', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 3 });
    const res = await request(app).post('/api/overtime/notes').set('Cookie', admin)
      .send({ about_user_id: 2, date: '2026-10-09', text: '  дойде в 13:00  ' });
    expect(res.status).toBe(200);
    const [sql, p] = mockDb.queryOne.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO overtime_admin_notes/);
    expect(p).toEqual([ADMIN_USER.id, 2, '2026-10-09', 'дойде в 13:00']);
  });
  it('празна бележка → 400', async () => {
    const res = await request(app).post('/api/overtime/notes').set('Cookie', admin).send({ text: ' ' });
    expect(res.status).toBe(400);
  });
  it('филтър по човек', async () => {
    await request(app).get('/api/overtime/notes?user=2').set('Cookie', admin);
    const call = mockDb.query.mock.calls.find((c) => /FROM overtime_admin_notes/.test(c[0]));
    expect(call[1]).toEqual([2]);
  });
});

describe('поименен достъп (overtime_access)', () => {
  const grantMember = () => mockDb.queryOne.mockImplementation(async (sql, p) =>
    (/FROM overtime_access WHERE user_id/.test(sql) && p[0] === MEMBER_USER.id ? { '?column?': 1 } : null));

  it('/me — обикновен човек: не; пуснат: да; админ: да', async () => {
    expect((await request(app).get('/api/overtime/me').set('Cookie', member)).body.manager).toBe(false);
    grantMember();
    expect((await request(app).get('/api/overtime/me').set('Cookie', member)).body).toEqual({ manager: true, fullAdmin: false });
    expect((await request(app).get('/api/overtime/me').set('Cookie', admin)).body).toEqual({ manager: true, fullAdmin: true });
  });
  it('пуснатият вижда всички (scope=all) и пише бележки', async () => {
    grantMember();
    const res = await request(app).get('/api/overtime?scope=all').set('Cookie', member);
    expect(res.body.scope).toBe('all');
    const call = mockDb.query.mock.calls.find((c) => /work_date BETWEEN/.test(c[0]));
    expect(call[1][2]).toBeNull();
    mockDb.queryOne.mockImplementation(async (sql) => (/overtime_access/.test(sql) ? { x: 1 } : (/INSERT INTO overtime_admin_notes/.test(sql) ? { id: 8 } : null)));
    const n = await request(app).post('/api/overtime/notes').set('Cookie', member).send({ text: 'закъсня' });
    expect(n.status).toBe(200);
  });
  it('пуснатият може да трие чужд запис', async () => {
    mockDb.queryOne.mockImplementation(async (sql) => (/overtime_access/.test(sql) ? { x: 1 } : (/SELECT user_id FROM overtime_entries/.test(sql) ? { user_id: 99 } : null)));
    const res = await request(app).delete('/api/overtime/7').set('Cookie', member);
    expect(res.status).toBe(200);
  });
  it('достъп дава/отнема САМО пълен админ — пуснатият получава 403', async () => {
    grantMember();
    expect((await request(app).get('/api/overtime/access').set('Cookie', member)).status).toBe(403);
    expect((await request(app).put('/api/overtime/access/5').set('Cookie', member).send({ granted: true })).status).toBe(403);
  });
  it('админ пуска човек', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 5 });
    const res = await request(app).put('/api/overtime/access/5').set('Cookie', admin).send({ granted: true });
    expect(res.status).toBe(200);
    const ins = mockDb.execute.mock.calls.find((c) => /INSERT INTO overtime_access/.test(c[0]));
    expect(ins[1]).toEqual([5, ADMIN_USER.id]);
  });
  it('админ пуска несъществуващ/неактивен → 404', async () => {
    const res = await request(app).put('/api/overtime/access/5').set('Cookie', admin).send({ granted: true });
    expect(res.status).toBe(404);
  });
  it('админ отнема достъп', async () => {
    const res = await request(app).put('/api/overtime/access/5').set('Cookie', admin).send({ granted: false });
    expect(res.status).toBe(200);
    expect(mockDb.execute.mock.calls.find((c) => /DELETE FROM overtime_access/.test(c[0]))[1]).toEqual([5]);
  });
  it('админ вижда списъка с хора', async () => {
    mockDb.query.mockResolvedValueOnce([{ id: 2, name: 'Иво', role: 'member', granted: true }]);
    const res = await request(app).get('/api/overtime/access').set('Cookie', admin);
    expect(res.status).toBe(200);
    expect(res.body.people[0].granted).toBe(true);
  });
});
