// Test setup — shared mocks and helpers for all test suites
//
// Strategy: mock the DB pool module so all route handlers get controlled
// return values. This lets us test the HTTP/Express layer (status codes,
// auth checks, request validation) without a live PostgreSQL instance.

const jwt = require('jsonwebtoken');

const JWT_SECRET = 'dev-secret-change-in-production';
const COOKIE_NAME = '__pact_jwt';

// ----- Mock data -----

const ADMIN_USER = {
  id: 1,
  email: 'admin@thepact.test',
  name: 'Test Admin',
  role: 'admin',
  avatar_url: null,
  is_active: true,
  password_hash: '$2b$04$mock_hash_admin' // not used directly; bcrypt.compare is mocked per test
};

const MEMBER_USER = {
  id: 2,
  email: 'member@thepact.test',
  name: 'Test Member',
  role: 'member',
  avatar_url: null,
  is_active: true,
  password_hash: '$2b$04$mock_hash_member'
};

// ----- Token helpers -----

function generateToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, name: user.name },
    JWT_SECRET,
    { expiresIn: '1h' }
  );
}

function getAuthCookie(user) {
  return `${COOKIE_NAME}=${generateToken(user)}`;
}

// ----- DB pool mock factory -----
// Each test file should call jest.mock('../src/db/pool') and then use
// the helpers below to configure return values.

/**
 * Create default mock implementations for pool, query, queryOne, execute.
 * Callers can override individual mocks per test via mockReturnValueOnce / mockResolvedValueOnce.
 */
function createPoolMocks() {
  return {
    pool: {
      query: jest.fn().mockResolvedValue({ rows: [] }),
      end: jest.fn().mockResolvedValue(undefined)
    },
    query: jest.fn().mockResolvedValue([]),
    queryOne: jest.fn().mockResolvedValue(null),
    execute: jest.fn().mockResolvedValue(undefined)
  };
}

module.exports = {
  JWT_SECRET,
  COOKIE_NAME,
  ADMIN_USER,
  MEMBER_USER,
  generateToken,
  getAuthCookie,
  createPoolMocks
};
