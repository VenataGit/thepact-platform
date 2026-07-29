// POST /api/bc-board/move — местене на карта в Basecamp.
// В рамките на една дъска е обикновено местене. Между две дъски Basecamp иска
// „портал" (wormhole) на изходната дъска — създаваме го, телепортираме картата
// и после го махаме. Тестваме точно тази последователност, без реален Basecamp.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

jest.mock('../src/ws/broadcast', () => ({
  setupWebSocket: jest.fn(),
  broadcast: jest.fn(),
  sendToUser: jest.fn(),
  getConnectedCount: jest.fn().mockReturnValue(0),
  getOnlineUserIds: jest.fn().mockReturnValue([]),
  getCardEditor: jest.fn().mockReturnValue(null),
}));

jest.mock('../src/services/basecamp-token', () => ({
  getUserAuth: jest.fn().mockResolvedValue({ token: 'tok', account: '5750544' }),
  getServiceAuth: jest.fn(),
}));

jest.mock('../src/services/basecamp', () => {
  const actual = jest.requireActual('../src/services/basecamp');
  return {
    ...actual,
    getCardTable: jest.fn(),
    moveCard: jest.fn().mockResolvedValue(true),
    createWormhole: jest.fn(),
    deleteWormhole: jest.fn().mockResolvedValue(true),
    moveCardToColumn: jest.fn().mockResolvedValue(true),
  };
});

const request = require('supertest');
const app = require('../src/app');
const bc = require('../src/services/basecamp');
const { MEMBER_USER, getAuthCookie } = require('./setup');

const cookie = getAuthCookie(MEMBER_USER);
const PRODUCTION = 111, PREPRODUCTION = 222, COL = 999, CARD = 555;

// Порталите, които платформата е направила, се пазят в app_settings.
const ownWormholesRow = (map) => ({ value: JSON.stringify(map) });

beforeEach(() => {
  jest.clearAllMocks();
  mockDb.queryOne.mockResolvedValue(null);
  mockDb.execute.mockResolvedValue(undefined);
  bc.moveCard.mockResolvedValue(true);
  bc.deleteWormhole.mockResolvedValue(true);
  bc.moveCardToColumn.mockResolvedValue(true);
});

describe('в рамките на една дъска', () => {
  it('без auth връща 401', async () => {
    const res = await request(app).post('/api/bc-board/move').send({});
    expect(res.status).toBe(401);
  });

  it('иска cardTableId, cardId и targetColumnId', async () => {
    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie).send({ cardId: CARD });
    expect(res.status).toBe(400);
  });

  it('прави обикновено местене, без портали', async () => {
    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PRODUCTION, fromCardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(bc.moveCard).toHaveBeenCalledTimes(1);
    expect(bc.createWormhole).not.toHaveBeenCalled();
  });

  it('без fromCardTableId (стар клиент) също е обикновено местене', async () => {
    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });
    expect(res.status).toBe(200);
    expect(bc.moveCard).toHaveBeenCalledTimes(1);
    expect(bc.createWormhole).not.toHaveBeenCalled();
  });
});

describe('между различни дъски', () => {
  it('създава портал, телепортира картата и го маха след това', async () => {
    jest.useFakeTimers();
    bc.getCardTable.mockResolvedValue({ id: PRODUCTION, wormholes: [] });
    bc.createWormhole.mockResolvedValue({ id: 7001, linked: true });

    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PREPRODUCTION, fromCardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, teleported: true });
    // порталът се прави на ИЗХОДНАТА дъска и сочи целевата колона
    expect(bc.createWormhole).toHaveBeenCalledWith('tok', '5750544', expect.anything(), PRODUCTION, COL);
    // картата се мести върху портала, не върху колоната
    expect(bc.moveCardToColumn).toHaveBeenCalledWith('tok', '5750544', expect.anything(), CARD, 7001);
    expect(bc.moveCard).not.toHaveBeenCalled();
    // чистенето е отложено — телепортът е асинхронен
    expect(bc.deleteWormhole).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(15_000);
    expect(bc.deleteWormhole).toHaveBeenCalledWith('tok', '5750544', expect.anything(), 7001);
    jest.useRealTimers();
  });

  it('преизползва вече наличен портал към същата колона', async () => {
    bc.getCardTable.mockResolvedValue({
      id: PRODUCTION,
      wormholes: [{ id: 7002, linked: true, destination_recording_id: COL }],
    });
    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PREPRODUCTION, fromCardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });

    expect(res.status).toBe(200);
    expect(bc.createWormhole).not.toHaveBeenCalled();
    expect(bc.moveCardToColumn).toHaveBeenCalledWith('tok', '5750544', expect.anything(), CARD, 7002);
  });

  it('измита наш забравен портал към друга колона, преди да прави нов', async () => {
    // Сценарий: деплой в 15-те секунди за чистене е оставил портал 8001 да виси.
    mockDb.queryOne.mockResolvedValue(ownWormholesRow({ [PRODUCTION]: ['8001'] }));
    bc.getCardTable.mockResolvedValue({
      id: PRODUCTION,
      wormholes: [{ id: 8001, linked: true, destination_recording_id: 4242 }],
    });
    bc.createWormhole.mockResolvedValue({ id: 8002, linked: true });

    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PREPRODUCTION, fromCardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });

    expect(res.status).toBe(200);
    expect(bc.deleteWormhole).toHaveBeenCalledWith('tok', '5750544', expect.anything(), 8001);
    expect(bc.createWormhole).toHaveBeenCalledWith('tok', '5750544', expect.anything(), PRODUCTION, COL);
  });

  it('не мете наш портал, който вече сочи точно накъдето трябва', async () => {
    mockDb.queryOne.mockResolvedValue(ownWormholesRow({ [PRODUCTION]: ['8003'] }));
    bc.getCardTable.mockResolvedValue({
      id: PRODUCTION,
      wormholes: [{ id: 8003, linked: true, destination_recording_id: COL }],
    });
    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PREPRODUCTION, fromCardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });

    expect(res.status).toBe(200);
    expect(bc.deleteWormhole).not.toHaveBeenCalled();
    expect(bc.createWormhole).not.toHaveBeenCalled();
    expect(bc.moveCardToColumn).toHaveBeenCalledWith('tok', '5750544', expect.anything(), CARD, 8003);
  });

  it('не пипа чужд портал и връща разбираема грешка при 4 налични', async () => {
    bc.getCardTable.mockResolvedValue({
      id: PRODUCTION,
      wormholes: [1, 2, 3, 4].map((n) => ({ id: 8000 + n, linked: true, destination_recording_id: 1000 + n })),
    });
    const res = await request(app).post('/api/bc-board/move').set('Cookie', cookie)
      .send({ cardTableId: PREPRODUCTION, fromCardTableId: PRODUCTION, cardId: CARD, targetColumnId: COL });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/4 портала/);
    expect(res.body.error).toMatch(/Basecamp/);
    expect(bc.deleteWormhole).not.toHaveBeenCalled();
    expect(bc.createWormhole).not.toHaveBeenCalled();
    expect(bc.moveCardToColumn).not.toHaveBeenCalled();
  });
});

describe('wormholeDestinationId', () => {
  const { wormholeDestinationId } = jest.requireActual('../src/services/basecamp');
  it('чете destination_recording_id', () => {
    expect(wormholeDestinationId({ destination_recording_id: 12 })).toBe('12');
  });
  it('чете и вложен destination.id', () => {
    expect(wormholeDestinationId({ destination: { id: 34 } })).toBe('34');
  });
  it('връща null, когато няма дестинация', () => {
    expect(wormholeDestinationId({})).toBeNull();
    expect(wormholeDestinationId(null)).toBeNull();
  });
});
