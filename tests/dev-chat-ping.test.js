// Чат ботът през Basecamp Pings: личният Ping на Венци → опашката; другите → „аз съм бот“.
let mockSettings = {};
const mockExec = [];
jest.mock('../src/db/pool', () => ({
  query: jest.fn(async () => Object.entries(mockSettings).map(([key, value]) => ({ key, value }))),
  queryOne: jest.fn(async () => null),
  execute: jest.fn(async (sql, params) => {
    mockExec.push({ sql, params });
    if (/INSERT INTO settings/.test(sql)) mockSettings[params[0]] = params[1];
    return {};
  }),
}));
jest.mock('../src/services/basecamp-token', () => ({ getServiceAuth: jest.fn(async () => ({ token: 't', account: 1 })) }));
const mockLines = {};
jest.mock('../src/services/basecamp', () => ({
  getPings: jest.fn(async () => [
    { id: 10, updated_at: 'u2', links: { lines: 'https://x/1/buckets/10/chats/100/lines.json' }, people: [{ id: 45460211 }] },
    { id: 20, updated_at: 'u2', links: { lines: 'https://x/1/buckets/20/chats/200/lines.json' }, people: [{ id: 777 }] },
  ]),
  getCampfireLines: jest.fn(async (t, a, bucket) => mockLines[bucket] || []),
  createCampfireLine: jest.fn(async () => ({})),
}));
jest.mock('../src/config', () => ({ BASECAMP_SERVICE_EMAIL: 'bot@x' }));

const bc = require('../src/services/basecamp');
const dc = require('../src/services/dev-chat');

beforeEach(() => { mockSettings = {}; mockExec.length = 0; bc.createCampfireLine.mockClear(); });

test('първият полл е baseline — нищо не се отговаря', async () => {
  mockLines[10] = [{ id: 5, content: 'старо', creator: { id: 45460211 } }];
  mockLines[20] = [{ id: 6, content: 'старо', creator: { id: 777 } }];
  await dc.pollPings();
  expect(bc.createCampfireLine).not.toHaveBeenCalled();
  expect(mockExec.some((e) => /INSERT INTO dev_chat/.test(e.sql))).toBe(false);
  expect(JSON.parse(mockSettings.dev_ping_state)['10'].last).toBe(5);
});

test('ново от Венци → опашката с адреса на Ping-а; ново от колега → „аз съм бот“ веднъж', async () => {
  mockSettings.dev_ping_state = JSON.stringify({ 10: { last: 5, upd: 'u1' }, 20: { last: 6, upd: 'u1' } });
  mockLines[10] = [{ id: 8, content: '<p>Здрасти</p>', creator: { id: 45460211 } }, { id: 5, content: 'старо', creator: { id: 45460211 } }];
  mockLines[20] = [{ id: 9, content: 'ей', creator: { id: 777 } }, { id: 6, content: 'старо', creator: { id: 777 } }];
  await dc.pollPings();
  const ins = mockExec.filter((e) => /INSERT INTO dev_chat/.test(e.sql));
  expect(ins).toHaveLength(1);
  expect(ins[0].params).toEqual([8, 'Здрасти', 10, 100]);
  expect(bc.createCampfireLine).toHaveBeenCalledTimes(1);
  expect(bc.createCampfireLine.mock.calls[0].slice(2, 4)).toEqual([20, 200]);

  // Колегата пише пак веднага → без второ „аз съм бот“ (лимит 6 ч.)
  const st = JSON.parse(mockSettings.dev_ping_state); st['20'].upd = 'old';
  mockSettings.dev_ping_state = JSON.stringify(st);
  mockLines[20] = [{ id: 11, content: 'ало', creator: { id: 777 } }];
  await dc.pollPings();
  expect(bc.createCampfireLine).toHaveBeenCalledTimes(1);
});
