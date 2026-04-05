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
const { ADMIN_USER, getAuthCookie } = require('./setup');

const adminCookie = getAuthCookie(ADMIN_USER);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('GET /api/cards', () => {
  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/cards');
    expect(res.status).toBe(401);
  });

  it('returns array of cards when authenticated', async () => {
    const mockCards = [
      { id: 1, board_id: 1, column_id: 10, title: 'Video concept', board_title: 'Pre-Prod', column_title: 'Ideas', assignees: [] },
      { id: 2, board_id: 1, column_id: 10, title: 'Script draft', board_title: 'Pre-Prod', column_title: 'Ideas', assignees: [] }
    ];
    mockDb.query.mockResolvedValueOnce(mockCards);

    const res = await request(app)
      .get('/api/cards')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(2);
    expect(res.body[0]).toHaveProperty('title', 'Video concept');
  });

  it('supports board_id filter query param', async () => {
    mockDb.query.mockResolvedValueOnce([
      { id: 5, board_id: 3, title: 'Filtered card', board_title: 'Post-Prod', column_title: 'Editing', assignees: [] }
    ]);

    const res = await request(app)
      .get('/api/cards?board_id=3')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    // Verify the SQL query received the board_id parameter
    const queryCall = mockDb.query.mock.calls[0];
    expect(queryCall[0]).toContain('board_id');
    expect(queryCall[1]).toContain(3);
  });
});

describe('POST /api/cards', () => {
  it('creates a card with required fields', async () => {
    const now = new Date().toISOString();
    // queryOne for MAX(position)
    mockDb.queryOne.mockResolvedValueOnce({ pos: 0 });
    // queryOne for INSERT ... RETURNING *
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100, board_id: 1, column_id: 10, title: 'New Card', content: null,
      priority: 'normal', creator_id: ADMIN_USER.id, position: 0, created_at: now
    });
    // execute for card_events INSERT
    mockDb.execute.mockResolvedValueOnce(undefined);
    // execute for activity_log INSERT
    mockDb.execute.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .post('/api/cards')
      .set('Cookie', adminCookie)
      .send({ board_id: 1, column_id: 10, title: 'New Card' });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id', 100);
    expect(res.body).toHaveProperty('title', 'New Card');
    expect(res.body).toHaveProperty('board_id', 1);
    expect(res.body).toHaveProperty('column_id', 10);
    expect(res.body).toHaveProperty('creator_id', ADMIN_USER.id);
  });

  it('creates a card with optional fields', async () => {
    mockDb.queryOne.mockResolvedValueOnce({ pos: 1 });
    mockDb.queryOne.mockResolvedValueOnce({
      id: 101, board_id: 1, column_id: 10, title: 'Full Card',
      content: 'Some description', priority: 'high', creator_id: ADMIN_USER.id,
      client_name: 'Test Client', kp_number: 5, video_number: 3, video_title: 'Test Video',
      position: 1
    });
    mockDb.execute.mockResolvedValue(undefined);

    const res = await request(app)
      .post('/api/cards')
      .set('Cookie', adminCookie)
      .send({
        board_id: 1,
        column_id: 10,
        title: 'Full Card',
        content: 'Some description',
        priority: 'high',
        client_name: 'Test Client',
        kp_number: 5,
        video_number: 3,
        video_title: 'Test Video'
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('priority', 'high');
    expect(res.body).toHaveProperty('client_name', 'Test Client');
    expect(res.body).toHaveProperty('kp_number', 5);
    expect(res.body).toHaveProperty('video_number', 3);
    expect(res.body).toHaveProperty('video_title', 'Test Video');
  });

  it('returns 400 without required fields', async () => {
    // Missing title
    const res1 = await request(app)
      .post('/api/cards')
      .set('Cookie', adminCookie)
      .send({ board_id: 1, column_id: 10 });
    expect(res1.status).toBe(400);
    expect(res1.body).toHaveProperty('error');

    // Missing board_id
    const res2 = await request(app)
      .post('/api/cards')
      .set('Cookie', adminCookie)
      .send({ column_id: 10, title: 'test' });
    expect(res2.status).toBe(400);

    // Missing column_id
    const res3 = await request(app)
      .post('/api/cards')
      .set('Cookie', adminCookie)
      .send({ board_id: 1, title: 'test' });
    expect(res3.status).toBe(400);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .post('/api/cards')
      .send({ board_id: 1, column_id: 10, title: 'hack' });
    expect(res.status).toBe(401);
  });
});

describe('PUT /api/cards/:id', () => {
  it('updates card title', async () => {
    // queryOne #1: fetch old values (title is in LOG_FIELDS, so needOldValues = true)
    mockDb.queryOne.mockResolvedValueOnce({
      publish_date: null, brainstorm_date: null, filming_date: null, editing_date: null, upload_date: null,
      title: 'Old Title', priority: 'normal', is_on_hold: false, due_on: null
    });
    // queryOne #2: UPDATE ... RETURNING *
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100, board_id: 1, column_id: 10, title: 'Updated Title',
      priority: 'normal', content: null
    });
    // execute for card_events field_changed log
    mockDb.execute.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .put('/api/cards/100')
      .set('Cookie', adminCookie)
      .send({ title: 'Updated Title' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('title', 'Updated Title');
  });

  it('updates card priority', async () => {
    // queryOne for fetching old values (because priority is in LOG_FIELDS)
    mockDb.queryOne.mockResolvedValueOnce({
      publish_date: null, brainstorm_date: null, filming_date: null, editing_date: null, upload_date: null,
      title: 'Card', priority: 'normal', is_on_hold: false, due_on: null
    });
    // queryOne for UPDATE ... RETURNING *
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100, title: 'Card', priority: 'urgent'
    });
    // execute for card_events field_changed
    mockDb.execute.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .put('/api/cards/100')
      .set('Cookie', adminCookie)
      .send({ priority: 'urgent' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('priority', 'urgent');
  });

  it('returns 404 for non-existent card', async () => {
    // The route fetches old values only for certain fields; title alone does NOT trigger old-value fetch
    mockDb.queryOne.mockResolvedValueOnce(null); // UPDATE returns null

    const res = await request(app)
      .put('/api/cards/999999')
      .set('Cookie', adminCookie)
      .send({ title: 'nope' });

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app)
      .put('/api/cards/100')
      .send({ title: 'hack' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/cards/:id', () => {
  it('returns single card with steps, assignees and notes', async () => {
    // queryOne for the card
    mockDb.queryOne
      .mockResolvedValueOnce({
        id: 100, board_id: 1, column_id: 10, title: 'Test Card',
        board_title: 'Pre-Prod', column_title: 'Ideas'
      })
      // queryOne for user_card_pins
      .mockResolvedValueOnce(null);
    // query for steps, assignees, notes (Promise.all)
    mockDb.query
      .mockResolvedValueOnce([]) // steps
      .mockResolvedValueOnce([]) // assignees
      .mockResolvedValueOnce([]); // notes

    const res = await request(app)
      .get('/api/cards/100')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id', 100);
    expect(res.body).toHaveProperty('title', 'Test Card');
    expect(res.body).toHaveProperty('steps');
    expect(res.body).toHaveProperty('assignees');
    expect(res.body).toHaveProperty('notes');
    expect(Array.isArray(res.body.steps)).toBe(true);
    expect(Array.isArray(res.body.assignees)).toBe(true);
  });

  it('returns 404 for non-existent card', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .get('/api/cards/999999')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).get('/api/cards/100');
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/cards/:id', () => {
  it('soft-deletes a card (sets trashed_at)', async () => {
    // queryOne for UPDATE cards SET trashed_at ... RETURNING *
    mockDb.queryOne.mockResolvedValueOnce({
      id: 100, title: 'Trashed Card', trashed_at: new Date().toISOString()
    });
    // execute for card_events
    mockDb.execute.mockResolvedValueOnce(undefined);

    const res = await request(app)
      .delete('/api/cards/100')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('ok', true);

    // Verify the query used trashed_at (soft delete, not hard delete)
    const queryCall = mockDb.queryOne.mock.calls[0];
    expect(queryCall[0]).toContain('trashed_at');
    expect(queryCall[0]).not.toMatch(/DELETE\s+FROM/i);
  });

  it('returns 404 when card does not exist or is already trashed', async () => {
    mockDb.queryOne.mockResolvedValueOnce(null);

    const res = await request(app)
      .delete('/api/cards/999999')
      .set('Cookie', adminCookie);

    expect(res.status).toBe(404);
  });

  it('returns 401 without auth', async () => {
    const res = await request(app).delete('/api/cards/100');
    expect(res.status).toBe(401);
  });
});
