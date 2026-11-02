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
  it('админ — всички (null) и списък с хора', async () => {
    const res = await request(app).get('/api/overtime').set('Cookie', admin);
    expect(res.body.admin).toBe(true);
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
