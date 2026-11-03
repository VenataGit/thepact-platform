// Сигурност (03.11.2026): ролята и активността идват живо от базата, не от токена;
// сесията има абсолютен срок 30 дни; машинните ключове се сравняват timing-safe.
process.env.AUTH_LIVE_CHECK = '1';

const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

const jwt = require('jsonwebtoken');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const { requireAuth, requireAdmin, refreshUserCache } = require('../src/middleware/auth');
const { keyMatches } = require('../src/middleware/machine-key');
const { JWT_SECRET } = require('./setup');

const app = express();
app.use(cookieParser());
app.get('/admin-only', requireAuth, requireAdmin, (req, res) => res.json({ ok: true, role: req.user.role }));
app.get('/me', requireAuth, (req, res) => res.json(req.user));

const cookie = (payload, opts = { expiresIn: '1h' }) => `__pact_jwt=${jwt.sign(payload, JWT_SECRET, opts)}`;

beforeEach(() => { mockDb.queryOne.mockReset(); refreshUserCache(7); refreshUserCache(8); });

describe('живата роля', () => {
  it('понижен админ (в токена пише admin, в базата — member) НЕ минава админ проверка', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ is_active: true, role: 'member', name: 'Иван' });
    const res = await request(app).get('/admin-only').set('Cookie', cookie({ userId: 7, role: 'admin', name: 'Иван' }));
    expect(res.status).toBe(403);
  });

  it('истински админ минава', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ is_active: true, role: 'admin', name: 'Венци' });
    const res = await request(app).get('/admin-only').set('Cookie', cookie({ userId: 8, role: 'admin', name: 'Венци' }));
    expect(res.status).toBe(200);
  });

  it('деактивиран човек е спрян още на първата заявка', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ is_active: false, role: 'member', name: 'Иван' });
    const res = await request(app).get('/me').set('Cookie', cookie({ userId: 7, role: 'member', name: 'Иван' }));
    expect(res.status).toBe(401);
  });

  it('изтрит потребител е спрян', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);
    const res = await request(app).get('/me').set('Cookie', cookie({ userId: 7, role: 'admin', name: 'X' }));
    expect(res.status).toBe(401);
  });
});

describe('абсолютен срок на сесията', () => {
  it('сесия с вход преди 31 дни → 401, дори токенът да е опресняван', async () => {
    const oiat = Math.floor(Date.now() / 1000) - 31 * 24 * 3600;
    const res = await request(app).get('/me').set('Cookie', cookie({ userId: 7, role: 'member', name: 'Иван', oiat }));
    expect(res.status).toBe(401);
    expect(mockDb.queryOne).not.toHaveBeenCalled();
  });

  it('опресняването пренася oiat и живата роля', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ is_active: true, role: 'moderator', name: 'Иван' });
    const oiat = Math.floor(Date.now() / 1000) - 3 * 24 * 3600;
    const res = await request(app).get('/me').set('Cookie', cookie({ userId: 7, role: 'member', name: 'Иван', oiat }, { expiresIn: '1h' }));
    expect(res.status).toBe(200);
    const set = (res.headers['set-cookie'] || []).find((c) => c.startsWith('__pact_jwt='));
    expect(set).toBeTruthy();
    const p = jwt.verify(set.split(';')[0].split('=')[1], JWT_SECRET);
    expect(p.oiat).toBe(oiat);
    expect(p.role).toBe('moderator');
  });
});

describe('машинни ключове', () => {
  it('keyMatches', () => {
    expect(keyMatches('abc', 'abc')).toBe(true);
    expect(keyMatches('abd', 'abc')).toBe(false);
    expect(keyMatches('', 'abc')).toBe(false);
    expect(keyMatches('abc', null)).toBe(false);
    expect(keyMatches(undefined, undefined)).toBe(false);
  });
});
