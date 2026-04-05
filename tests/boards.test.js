// Mock the DB pool before any requires
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
  getCardEditor: jest.fn().mockReturnValue(null)
}));

const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');

const adminCookie = getAuthCookie(ADMIN_USER);
const memberCookie = getAuthCookie(MEMBER_USER);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/boards', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/boards');
    expect(res.status).toBe(401);
  });

  it('returns array of boards when authenticated', async () => {
    const mockBoards = [
      { id: 1, title: 'Pre-Production', position: 0, color: '#4a6d5d' },
      { id: 2, title: 'Production', position: 1, color: '#5d7a8c' }
    ];
    // First query call: SELECT * FROM boards
    mockDb.query.mockResolvedValueOnce(mockBoards);
    // Second query call: SELECT * FROM columns
    mockDb.query.mockResolvedValueOnce([
      { id: 10, board_id: 1, title: 'Ideas', position: 0 },
      { id: 11, board_id: 2, title: 'Shooting', position: 0 }
    ]);

    const res = await request(app)
      .get('/api/boards')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('title', 'Pre-Production');
    expect(res.body[0]).toHaveProperty('columns');
    expect(Array.isArray(res.body[0].columns)).toBe(true);
  });
});

describe('POST /api/boards', () => {
  it('creates a board (admin)', async () => {
    // queryOne for MAX(position)
    mockDb.queryOne.mockResolvedValueOnce({ pos: 5 });
    // queryOne for INSERT ... RETURNING *
    mockDb.queryOne.mockResolvedValueOnce({
      id: 99, title: 'New Board', color: '#4a6d5d', position: 5, created_at: new Date().toISOString()
    });

    const res = await request(app)
      .post('/api/boards')
      .set('Cookie', adminCookie)
      .send({ title: 'New Board', color: '#4a6d5d' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 99);
    expect(res.body).toHaveProperty('title', 'New Board');
    expect(res.body).toHaveProperty('color', '#4a6d5d');
  });

  it('returns 403 for regular member (requires moderator)', async () => {
    const res = await request(app)
      .post('/api/boards')
      .set('Cookie', memberCookie)
      .send({ title: 'Blocked Board' });

    expect(res.status).toBe(403);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/boards')
      .send({ title: 'No Auth Board' });

    expect(res.status).toBe(401);
  });

  it('returns 400 without title', async () => {
    const res = await request(app)
      .post('/api/boards')
      .set('Cookie', adminCookie)
      .send({ color: '#ff0000' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('PUT /api/boards/:id', () => {
  it('updates board title and color', async () => {
    mockDb.queryOne.mockResolvedValueOnce({
      id: 1, title: 'Updated Board', color: '#222222', position: 0
    });

    const res = await request(app)
      .put('/api/boards/1')
      .set('Cookie', adminCookie)
      .send({ title: 'Updated Board', color: '#222222' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('title', 'Updated Board');
    expect(res.body).toHaveProperty('color', '#222222');
  });

  it('returns 404 for non-existent board', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .put('/api/boards/999999')
      .set('Cookie', adminCookie)
      .send({ title: 'nope' });

    expect(res.status).toBe(404);
  });

  it('returns 403 for regular member', async () => {
    const res = await request(app)
      .put('/api/boards/1')
      .set('Cookie', memberCookie)
      .send({ title: 'hack' });

    expect(res.status).toBe(403);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/boards/1')
      .send({ title: 'no auth' });

    expect(res.status).toBe(401);
  });
});

describe('GET /api/boards/:id', () => {
  it('returns board with columns', async () => {
    mockDb.queryOne.mockResolvedValueOnce({
      id: 1, title: 'Pre-Production', position: 0, color: '#4a6d5d'
    });
    mockDb.query.mockResolvedValueOnce([
      { id: 10, board_id: 1, title: 'Ideas', position: 0 },
      { id: 11, board_id: 1, title: 'Research', position: 1 }
    ]);

    const res = await request(app)
      .get('/api/boards/1')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 1);
    expect(res.body).toHaveProperty('title', 'Pre-Production');
    expect(res.body).toHaveProperty('columns');
    expect(Array.isArray(res.body.columns)).toBe(true);
    expect(res.body.columns).toHaveLength(2);
  });

  it('returns 404 for non-existent board', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/boards/999999')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/boards/:id', () => {
  it('deletes a board (admin)', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ id: 50, title: 'Deleted Board' });

    const res = await request(app)
      .delete('/api/boards/50')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
  });

  it('returns 404 when board does not exist', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/api/boards/999999')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  it('returns 403 for regular member', async () => {
    const res = await request(app)
      .delete('/api/boards/1')
      .set('Cookie', memberCookie);

    expect(res.status).toBe(403);
  });
});
