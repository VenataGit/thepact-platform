// Стабилност (04.11.2026): обща врата към Basecamp — 429 → изчакване и повторение,
// таймаут, без повторение на POST при мрежова грешка, фоновите заявки отстъпват.
const bc = require('../src/services/basecamp');

const resp = (status, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => headers[k] ?? null }, json: async () => ({}) });

afterEach(() => { delete global.fetch; });

it('429 с Retry-After → изчаква и повтаря, после връща успешния отговор', async () => {
  const calls = [];
  global.fetch = jest.fn(async () => { calls.push(Date.now()); return calls.length === 1 ? resp(429, { 'Retry-After': '1' }) : resp(200); });
  const r = await bc.bcFetch('https://3.basecampapi.com/x.json');
  expect(r.status).toBe(200);
  expect(global.fetch).toHaveBeenCalledTimes(2);
  expect(calls[1] - calls[0]).toBeGreaterThanOrEqual(950);
  expect(bc.getBcStats().r429).toBeGreaterThanOrEqual(1);
});

it('мрежова грешка при GET → един повторен опит', async () => {
  let n = 0;
  global.fetch = jest.fn(async () => { if (++n === 1) throw new TypeError('fetch failed'); return resp(200); });
  const r = await bc.bcFetch('https://3.basecampapi.com/y.json');
  expect(r.status).toBe(200);
  expect(n).toBe(2);
});

it('мрежова грешка при POST → НЕ се повтаря (може вече да е минал)', async () => {
  global.fetch = jest.fn(async () => { throw new TypeError('fetch failed'); });
  await expect(bc.bcFetch('https://3.basecampapi.com/z.json', { method: 'POST' })).rejects.toThrow('fetch failed');
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

it('таймаут — заявката не виси вечно', async () => {
  global.fetch = jest.fn((url, opts) => new Promise((_, rej) => opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('timeout'), { name: 'TimeoutError' })))));
  await expect(bc.bcFetch('https://3.basecampapi.com/slow.json', { method: 'POST' }, { timeoutMs: 200 })).rejects.toThrow('timeout');
  expect(bc.getBcStats().timeouts).toBeGreaterThanOrEqual(1);
});

it('фоновите заявки имат по-нисък таван от тези на хората', async () => {
  global.fetch = jest.fn(async () => resp(200));
  // 20 фонови заявки запълват своя таван; следващата фонова чака, а човешката минава веднага
  await bc.background(() => Promise.all(Array.from({ length: 20 }, (_, i) => bc.bcFetch('https://3.basecampapi.com/bg' + i))));
  let bgDone = false;
  const bgP = bc.background(() => bc.bcFetch('https://3.basecampapi.com/bg-extra')).then(() => { bgDone = true; });
  const t0 = Date.now();
  await bc.bcFetch('https://3.basecampapi.com/human');
  expect(Date.now() - t0).toBeLessThan(500);
  expect(bgDone).toBe(false);
  await bgP; // излиза, когато прозорецът се освободи
}, 20000);
