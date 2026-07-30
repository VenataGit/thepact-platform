// Premiere Pro downgrader — covers the local (PP2025-and-older) conversion path.
// The PP2026 path proxies to an external engine, so only its pre-flight guards
// are tested here; nothing in this file touches the network.

const mockPool = {
  query: jest.fn().mockResolvedValue({ rows: [] }),
  end: jest.fn().mockResolvedValue(undefined)
};

jest.mock('../src/db/pool', () => ({
  pool: mockPool,
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue({ id: 1, is_active: true }),
  execute: jest.fn().mockResolvedValue(undefined)
}));

jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(),
  broadcast: jest.fn(),
  sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0),
  getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null)
}));

const zlib = require('zlib');
const crypto = require('crypto');
const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, getAuthCookie } = require('./setup');

const CLASS_ID = '62ad66dd-0dcd-42da-a660-6d8fbde94876';
const cookie = getAuthCookie(ADMIN_USER);

// A .prproj shaped like the real thing: a bare <Project ObjectRef> stub with no
// ClassID, the real <Project> object, and an unrelated node with its own Version.
function makeProject(schemaVersion, filler) {
  return '<?xml version="1.0" encoding="UTF-8" ?>\n'
    + '<PremiereData Version="3">\n'
    + '\t<Project ObjectRef="1"/>\n'
    + '\t<Project ObjectID="1" ClassID="' + CLASS_ID + '" Version="' + schemaVersion + '">\n'
    + '\t\t<Node Version="1"><Properties Version="1"/></Node>\n'
    + '\t</Project>\n'
    + '\t<Sequence ObjectID="9" ClassID="aaaaaaaa-1111-2222-3333-444444444444" Version="12"><Name>Seq 01</Name></Sequence>\n'
    + (filler || '')
    + '</PremiereData>\n';
}

function gzipProject(schemaVersion, filler) {
  return zlib.gzipSync(Buffer.from(makeProject(schemaVersion, filler), 'utf8'));
}

// Filler that survives gzip — real projects are full of unique GUIDs and paths,
// so repetitive text would compress far smaller than anything Premiere writes.
function bigFiller(clips) {
  let out = '';
  for (let i = 0; i < clips; i++) {
    out += '\t<Clip ObjectID="' + (i + 100) + '" Version="3" UID="'
      + crypto.randomBytes(16).toString('hex') + '"><Name>Shot ' + i + '</Name></Clip>\n';
  }
  return out;
}

function post(path, buf, fields) {
  const req = request(app).post(path).set('Cookie', cookie)
    .attach('project', buf, 'My Edit.prproj');
  Object.entries(fields || {}).forEach(([k, v]) => req.field(k, String(v)));
  return req;
}

describe('POST /api/premiere/inspect', () => {
  it('reports the schema version of a PP2025 project and needs no engine', async () => {
    const res = await post('/api/premiere/inspect', gzipProject(43));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(43);
    expect(res.body.needsEngine).toBe(false);
  });

  it('flags a PP2026 project as needing the schema engine', async () => {
    const res = await post('/api/premiere/inspect', gzipProject(45));
    expect(res.status).toBe(200);
    expect(res.body.version).toBe(45);
    expect(res.body.needsEngine).toBe(true);
  });

  it('rejects a file that is not a Premiere project', async () => {
    const res = await post('/api/premiere/inspect', Buffer.from('just some text', 'utf8'));
    expect(res.status).toBe(422);
    expect(res.body.error).toBeTruthy();
  });

  it('requires authentication', async () => {
    const res = await request(app).post('/api/premiere/inspect')
      .attach('project', gzipProject(43), 'x.prproj');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/premiere/convert — local path (PP2025 and older)', () => {
  it('rewrites only the project schema version and keeps the rest byte-identical', async () => {
    const res = await post('/api/premiere/convert', gzipProject(43), { target: 2022 });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.name).toBe('My Edit_PP2022.prproj');

    const out = Buffer.from(res.body.data, 'base64');
    expect(out[0]).toBe(0x1f);          // still gzip
    expect(out[1]).toBe(0x8b);
    const xml = zlib.gunzipSync(out).toString('utf8');

    // 2022 -> schema 40
    expect(xml).toContain('ClassID="' + CLASS_ID + '" Version="40"');
    // everything else survived untouched
    expect(xml).toContain('<Project ObjectRef="1"/>');
    expect(xml).toContain('<Sequence ObjectID="9" ClassID="aaaaaaaa-1111-2222-3333-444444444444" Version="12">');
    expect(xml).toContain('<Node Version="1">');
    expect(xml).toBe(makeProject(40));
  });

  it('maps every offered year to its documented schema number', async () => {
    const expected = { 2019: 37, 2020: 38, 2021: 39, 2022: 40, 2023: 41, 2024: 42 };
    for (const [year, schema] of Object.entries(expected)) {
      const res = await post('/api/premiere/convert', gzipProject(43), { target: year });
      expect(res.status).toBe(200);
      const xml = zlib.gunzipSync(Buffer.from(res.body.data, 'base64')).toString('utf8');
      expect(xml).toContain('ClassID="' + CLASS_ID + '" Version="' + schema + '"');
    }
  });

  it('handles a project well over the external engine 500 KB limit', async () => {
    const buf = gzipProject(43, bigFiller(20000));
    expect(buf.length).toBeGreaterThan(500 * 1024);

    const res = await post('/api/premiere/convert', buf, { target: 2021 });
    expect(res.status).toBe(200);
    const xml = zlib.gunzipSync(Buffer.from(res.body.data, 'base64')).toString('utf8');
    expect(xml).toContain('ClassID="' + CLASS_ID + '" Version="39"');
    expect(xml).toContain('<Name>Shot 19999</Name>');
  });

  it('accepts an uncompressed project and returns it uncompressed', async () => {
    const plain = Buffer.from(makeProject(43), 'utf8');
    const res = await post('/api/premiere/convert', plain, { target: 2023 });
    expect(res.status).toBe(200);
    const out = Buffer.from(res.body.data, 'base64');
    expect(out[0]).not.toBe(0x1f);
    expect(out.toString('utf8')).toBe(makeProject(41));
  });

  it('refuses to "downgrade" to a version the project already opens in', async () => {
    const res = await post('/api/premiere/convert', gzipProject(41), { target: 2024 });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('вече е версия 41');
  });

  it('rejects an unknown target year', async () => {
    const res = await post('/api/premiere/convert', gzipProject(43), { target: 2018 });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/premiere/convert — PP2026 source', () => {
  it('explains the engine size limit instead of failing obscurely', async () => {
    const buf = gzipProject(45, bigFiller(20000));
    expect(buf.length).toBeGreaterThan(500 * 1024);

    const res = await post('/api/premiere/convert', buf, { target: 2025 });
    expect(res.status).toBe(413);
    expect(res.body.error).toContain('2026');
    expect(res.body.error).toContain('500 KB');
  });
});
