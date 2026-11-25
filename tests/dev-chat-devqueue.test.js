// Отделният акаунт на личния проект (25.11.2026): Ping с Венци към него → Claude (reply_as=devqueue);
// Венци в Ping-а на ThePactAlerts → само кратко пренасочване, без опашка; чужди Pings към акаунта — тишина.
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
jest.mock('../src/services/basecamp-token', () => ({ getServiceAuth: jest.fn(async () => ({ token: 'svc', account: 1 })) }));
jest.mock('../src/services/devqueue-account', () => ({
  getDevQueueOnlyAuth: jest.fn(async () => ({ token: 'dq', account: 1, devqueue: true })),
  getDevQueueAuth: jest.fn(async () => ({ token: 'dq', account: 1, devqueue: true })),
  isBotCreator: (c) => [1, 2].includes(Number(c?.id)),
}));
const mockLines = {};
jest.mock('../src/services/basecamp', () => ({
  getPings: jest.fn(async (token) => token === 'dq'
    ? [
      { id: 30, updated_at: 'u2', links: { lines: 'https://x/1/buckets/30/chats/300/lines.json' }, people: [{ id: 45460211 }] },
      { id: 40, updated_at: 'u2', links: { lines: 'https://x/1/buckets/40/chats/400/lines.json' }, people: [{ id: 777 }] },
    ]
    : [{ id: 10, updated_at: 'u2', links: { lines: 'https://x/1/buckets/10/chats/100/lines.json' }, people: [{ id: 45460211 }] }]),
  getCampfireLines: jest.fn(async (t, a, bucket) => mockLines[bucket] || []),
  createCampfireLine: jest.fn(async () => ({})),
}));
jest.mock('../src/services/dev-queue', () => ({ notifyWork: jest.fn() }));
jest.mock('../src/services/comment-reminders', () => ({ handlePingLine: jest.fn(async () => false) }));
jest.mock('../src/config', () => ({ BASECAMP_SERVICE_EMAIL: 'bot@x' }));

const bc = require('../src/services/basecamp');
const dc = require('../src/services/dev-chat');

test('venata движи Ping-а с Венци; ThePactAlerts само пренасочва', async () => {
  mockSettings.dev_ping_state = JSON.stringify({ 10: { last: 5, upd: 'u1' } });
  mockSettings.dev_ping_state_devqueue = JSON.stringify({ 30: { last: 5, upd: 'u1' }, 40: { last: 5, upd: 'u1' } });
  mockLines[10] = [{ id: 8, content: 'към стария бот', creator: { id: 45460211 } }];
  mockLines[30] = [{ id: 9, content: '<p>Направи X</p>', creator: { id: 45460211 } }];
  mockLines[40] = [{ id: 7, content: 'здрасти', creator: { id: 777 } }];
  await dc.pollPings();
  const ins = mockExec.filter((e) => /INSERT INTO dev_chat/.test(e.sql));
  expect(ins).toHaveLength(1);
  expect(ins[0].params).toEqual([9, 'Направи X', 30, 300, 'devqueue']);
  // Единственият изпратен ред: пренасочването в Ping-а на ThePactAlerts (с неговия токен).
  expect(bc.createCampfireLine).toHaveBeenCalledTimes(1);
  expect(bc.createCampfireLine.mock.calls[0][0]).toBe('svc');
  expect(bc.createCampfireLine.mock.calls[0].slice(2, 4)).toEqual([10, 100]);
});
