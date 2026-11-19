// Почти мигновен режим на dev-опашката: webhook → kick, long-poll събуждане.
let mockPending = false;
jest.mock('../src/db/pool', () => ({
  query: jest.fn(async () => []),
  queryOne: jest.fn(async (sql) => (/status = 'pending' LIMIT 1/.test(sql) && mockPending ? { x: 1 } : null)),
  execute: jest.fn(async () => ({})),
}));
jest.mock('../src/services/basecamp-token', () => ({ getServiceAuth: jest.fn(async () => ({ token: 't', account: 1 })) }));
jest.mock('../src/services/basecamp', () => ({ getTodoLists: jest.fn(async () => []), getComments: jest.fn(async () => []) }));

const dq = require('../src/services/dev-queue');

afterEach(() => { mockPending = false; });

test('onWebhook реагира само на проекта на опашката', () => {
  expect(dq.onWebhook(null)).toBe(false);
  expect(dq.onWebhook(123)).toBe(false);
  expect(dq.onWebhook(47742842)).toBe(true);
});

test('waitForWork връща true веднага при чакаща задача', async () => {
  mockPending = true;
  await expect(dq.waitForWork(5000)).resolves.toBe(true);
});

test('waitForWork изтича с false без работа', async () => {
  await expect(dq.waitForWork(50)).resolves.toBe(false);
});

test('waitForWork се събужда, когато полл намери задача', async () => {
  const p = dq.waitForWork(5000);
  await new Promise((r) => setTimeout(r, 20));
  mockPending = true;
  await dq.pollOnce();
  await expect(p).resolves.toBe(true);
});
