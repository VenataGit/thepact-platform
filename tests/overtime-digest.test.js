// Дневното обобщение на overtime-а (services/overtime-digest.js).
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);
jest.mock('../src/services/basecamp', () => ({ createMessage: jest.fn().mockResolvedValue({ id: 1 }) }));
jest.mock('../src/services/basecamp-token', () => ({ getServiceAuth: jest.fn().mockResolvedValue({ token: 't', account: 5750544 }) }));

const bc = require('../src/services/basecamp');
const { runDigest, buildDigest } = require('../src/services/overtime-digest');

const E = (o) => ({ user_id: 2, name: 'Иво', work_date: '2026-11-02', time_from: '19:00', time_to: '22:30', ot_minutes: 210,
  client: 'Клиент <А>', kind: 'Събитие', note: 'репортаж', comp: 'pay', added_date: '2026-11-02', month_total: 400, ...o });

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.query.mockResolvedValue([]);
  mockDb.queryOne.mockResolvedValue(null);
});

describe('buildDigest', () => {
  it('няма нищо → null', () => {
    expect(buildDigest([], [])).toBeNull();
  });
  it('по човек, със сбора за месеца, късно въвеждане и изтрити', () => {
    const now = new Date('2026-11-03T07:00:00Z'); // 09:00 в София
    const m = buildDigest([
      E({}),
      E({ work_date: '2026-10-31', time_from: '20:00', time_to: '01:00', ot_minutes: 300, added_date: '2026-11-02' }),
      E({ user_id: 3, name: 'Мира', comp: 'rest', month_total: 120, ot_minutes: 120, note: '' })
    ], [E({ name: 'Ники', added_date: '2026-11-01', deleted_date: '2026-11-02' })], now);
    expect(m.subject).toBe('⏱ Overtime — вторник 03.11: 3 нови записа, 10 ч 30 мин, 1 изтрит');
    expect(m.content).toMatch(/<strong>Иво<\/strong> — общо за месеца: 6 ч 40 мин/);
    expect(m.content).toMatch(/събота 31\.10<\/strong> · 20:00–01:00 \(след полунощ\) · <strong>5 ч<\/strong> <em>\(въведено на 02\.11\)<\/em>/);
    expect(m.content).toMatch(/Клиент &lt;А&gt;/);
    expect(m.content).toMatch(/🏖 почивка/);
    expect(m.content).toMatch(/Изтрити записи.*Ники.*изтрит на 02\.11/s);
    expect(m.content).toMatch(/#\/overtime\/admin/);
  });
});

describe('runDigest', () => {
  it('изпраща в Message Board на личния проект, абонат само Венци, и мести „последно"', async () => {
    mockDb.queryOne.mockImplementation(async (sql, p) => (p && p[0] === 'overtime_digest_last' ? { value: '2026-11-02T07:00:00.000Z' } : null));
    mockDb.query.mockImplementation(async (sql) => (/deleted_at IS NULL AND o.created_at/.test(sql) ? [E({})] : []));
    const now = new Date('2026-11-03T07:00:00Z');
    const r = await runDigest(now);
    expect(r).toEqual({ added: 1, removed: 0, sent: true });
    const [, , project, board, msg] = bc.createMessage.mock.calls[0];
    expect([project, board]).toEqual([47742842, 10404218914]);
    expect(msg.subscriptions).toEqual([45460211]);
    const sel = mockDb.query.mock.calls.find((c) => /deleted_at IS NULL AND o.created_at/.test(c[0]));
    expect(sel[1]).toEqual(['2026-11-02T07:00:00.000Z', '2026-11-03T07:00:00.000Z']);
    expect(mockDb.execute.mock.calls.some((c) => /INSERT INTO settings/.test(c[0]) && c[1][0] === 'overtime_digest_last' && c[1][1] === now.toISOString())).toBe(true);
  });
  it('няма нищо ново → не праща', async () => {
    const r = await runDigest(new Date('2026-11-03T07:00:00Z'));
    expect(r.sent).toBe(false);
    expect(bc.createMessage).not.toHaveBeenCalled();
  });
  it('изключено → нищо', async () => {
    mockDb.queryOne.mockImplementation(async (sql, p) => (p && p[0] === 'overtime_digest_enabled' ? { value: 'false' } : null));
    expect(await runDigest()).toEqual({ skipped: 'disabled' });
    expect(bc.createMessage).not.toHaveBeenCalled();
  });
  it('Basecamp отказва → „последно" не се мести', async () => {
    mockDb.query.mockImplementation(async (sql) => (/deleted_at IS NULL AND o.created_at/.test(sql) ? [E({})] : []));
    bc.createMessage.mockRejectedValueOnce(new Error('500'));
    await expect(runDigest(new Date('2026-11-03T07:00:00Z'))).rejects.toThrow('500');
    expect(mockDb.execute.mock.calls.some((c) => c[1] && c[1][0] === 'overtime_digest_last')).toBe(false);
  });
});
