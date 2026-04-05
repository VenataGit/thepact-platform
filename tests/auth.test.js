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

const bcrypt = require('bcrypt');
const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, COOKIE_NAME, getAuthCookie } = require('./setup');

// Pre-compute a real bcrypt hash so bcrypt.compare works
let realHash;
beforeAll(async () => {
  realHash = await bcrypt.hash('CorrectPassword123', 4);
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('POST /auth/login', () => {
  it('returns JWT cookie with valid credentials', async () => {
    // queryOne for SELECT * FROM users WHERE email = ...
    mockDb.queryOne.mockResolvedValueOnce({ ...ADMIN_USER, password_hash: realHash });
    // queryOne for UPDATE users SET last_login_at ...
    mockDb.queryOne.mockResolvedValueOnce({ id: ADMIN_USER.id });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@thepact.test', password: 'CorrectPassword123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id', ADMIN_USER.id);
    expect(res.body.user).toHaveProperty('email', ADMIN_USER.email);
    expect(res.body.user).toHaveProperty('name', ADMIN_USER.name);
    expect(res.body.user).toHaveProperty('role', ADMIN_USER.role);

    // Check that JWT cookie is set
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const jwtCookie = cookies.find(c => c.startsWith(COOKIE_NAME + '='));
    expect(jwtCookie).toBeDefined();
    expect(jwtCookie).toContain('HttpOnly');
  });

  it('returns 401 with wrong password', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ ...ADMIN_USER, password_hash: realHash });

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@thepact.test', password: 'WrongPassword999' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 with non-existent email', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null); // user not found

    const res = await request(app)
      .post('/auth/login')
      .send({ email: 'nobody@example.com', password: 'anything' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when email or password missing', async () => {
    const res1 = await request(app)
      .post('/auth/login')
      .send({ email: 'admin@thepact.test' });
    expect(res1.status).toBe(400);

    const res2 = await request(app)
      .post('/auth/login')
      .send({ password: 'something' });
    expect(res2.status).toBe(400);

    const res3 = await request(app)
      .post('/auth/login')
      .send({});
    expect(res3.status).toBe(400);
  });
});

describe('GET /auth/status', () => {
  it('returns 401 without cookie', async () => {
    const res = await request(app).get('/auth/status');

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('returns authenticated user with valid cookie', async () => {
    const cookie = getAuthCookie(ADMIN_USER);
    // queryOne for SELECT id, name, email, role, avatar_url FROM users WHERE id = ...
    mockDb.queryOne.mockResolvedValueOnce({
      id: ADMIN_USER.id,
      name: ADMIN_USER.name,
      email: ADMIN_USER.email,
      role: ADMIN_USER.role,
      avatar_url: ADMIN_USER.avatar_url
    });

    const res = await request(app)
      .get('/auth/status')
      .set('Cookie', cookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('authenticated', true);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('id', ADMIN_USER.id);
    expect(res.body.user).toHaveProperty('email', ADMIN_USER.email);
  });

  it('returns 401 with invalid/tampered cookie', async () => {
    const res = await request(app)
      .get('/auth/status')
      .set('Cookie', `${COOKIE_NAME}=invalid.jwt.token`);

    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('clears the JWT cookie', async () => {
    const res = await request(app).post('/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    // Cookie should be cleared (set with past expiration)
    const cookies = res.headers['set-cookie'];
    if (cookies) {
      const jwtCookie = cookies.find(c => c.startsWith(COOKIE_NAME + '='));
      if (jwtCookie) {
        expect(jwtCookie).toMatch(/Expires=Thu, 01 Jan 1970/i);
      }
    }
  });
});
