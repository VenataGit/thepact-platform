// Mock the DB pool before any requires
const mockPool = {
  query: jest.fn(),
  end: jest.fn().mockResolvedValue(undefined)
};

jest.mock('../src/db/pool', () => ({
  pool: mockPool,
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
}));

// Mock broadcast (no WS server in tests)
jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(),
  broadcast: jest.fn(),
  sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0),
  getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null)
}));

const request = require('supertest');
const app = require('../src/app');

describe('GET /api/health', () => {
  it('returns status ok when database is reachable', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('status', 'ok');
    expect(res.body.checks).toHaveProperty('server', true);
    expect(res.body.checks).toHaveProperty('database', true);
    expect(res.body).toHaveProperty('uptime');
    expect(typeof res.body.uptime).toBe('number');
    expect(res.body).toHaveProperty('wsClients', 0);
  });

  it('returns degraded when database is unreachable', async () => {
    mockPool.query.mockRejectedValueOnce(new Error('connection refused'));

    const res = await request(app).get('/api/health');

    expect(res.status).toBe(503);
    expect(res.body).toHaveProperty('status', 'degraded');
    expect(res.body.checks).toHaveProperty('server', true);
    expect(res.body.checks).toHaveProperty('database', false);
  });

  it('does not require authentication', async () => {
    mockPool.query.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });

    const res = await request(app).get('/api/health');
    // Should NOT return 401
    expect(res.status).not.toBe(401);
  });
});
