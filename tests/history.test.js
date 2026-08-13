// „История" (#/history) — дневникът само чете вече записаното и го привежда към
// един и същ вид. Тук се проверява това: нормализацията, обединеният таб, вратата
// (CRM само за хората с достъп), сървърните филтри и че един счупен източник не
// сваля целия изглед.
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
  disconnectUser: jest.fn(),
}));

jest.mock('../src/services/push', () => ({
  initPush: jest.fn(),
  sendPushToUser: jest.fn(),
  sendPushToUsers: jest.fn(),
  sendPushToAllExcept: jest.fn(),
}));

const request = require('supertest');
const app = require('../src/app');
const { ADMIN_USER, MEMBER_USER, getAuthCookie } = require('./setup');

const adminCookie = getAuthCookie(ADMIN_USER);
const memberCookie = getAuthCookie(MEMBER_USER);

// Коя таблица пита заявката — по нея се раздават подготвените редове.
function sourceOf(sql) {
  if (sql.includes('created_task_log')) return 'tasks';
  if (sql.includes('bc_card_text_log')) return 'text';
  if (sql.includes('kp_audit_log')) return 'kp';
  if (sql.includes('bc_production_calendar_log')) return 'calendar';
  if (sql.includes('card_date_changes')) return 'dates';
  if (sql.includes('card_events')) return 'cardEvents';
  if (sql.includes('activity_log')) return 'comments';
  if (sql.includes('crm_events')) return 'crm';
  return 'other';
}

// Стойност = масив с редове, или Error — за да се провери, че падне ли един
// източник, останалите продължават.
function serve(map) {
  mockDb.query.mockImplementation(async (sql) => {
    const val = map[sourceOf(sql)];
    if (val instanceof Error) throw val;
    return val || [];
  });
}

// SQL-ите, стигнали до базата за даден източник (без тези за филтърните менюта).
function sqlFor(source) {
  return mockDb.query.mock.calls
    .filter((c) => sourceOf(c[0]) === source && !/SELECT DISTINCT/.test(c[0]));
}

beforeEach(() => {
  mockDb.query.mockReset().mockResolvedValue([]);
  // getAccess пита crm_access през queryOne — null значи „няма достъп до CRM".
  mockDb.queryOne.mockReset().mockResolvedValue(null);
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => { console.error.mockRestore(); });

// ------------------------------------------------------------------- вратата

describe('достъп', () => {
  test('без сесия — 401', async () => {
    await request(app).get('/api/history').expect(401);
  });

  test('обикновен потребител вече влиза — страницата е за целия екип', async () => {
    await request(app).get('/api/history').set('Cookie', memberCookie).expect(200);
  });

  test('без достъп до CRM табът изобщо не се предлага', async () => {
    const res = await request(app).get('/api/history/filters').set('Cookie', memberCookie).expect(200);
    expect(res.body.tabs.map((t) => t.id)).not.toContain('crm');
    expect(res.body.crmAllowed).toBe(false);
  });

  test('поисканият таб CRM без достъп връща 403', async () => {
    await request(app).get('/api/history?tab=crm').set('Cookie', memberCookie).expect(403);
  });

  test('обединеният таб не пипа crm_events, ако човекът няма достъп', async () => {
    serve({});
    await request(app).get('/api/history').set('Cookie', memberCookie).expect(200);
    expect(sqlFor('crm')).toHaveLength(0);
  });

  test('пълният админ вижда CRM по право', async () => {
    serve({});
    const res = await request(app).get('/api/history/filters').set('Cookie', adminCookie).expect(200);
    expect(res.body.tabs.map((t) => t.id)).toContain('crm');
    await request(app).get('/api/history').set('Cookie', adminCookie).expect(200);
    expect(sqlFor('crm').length).toBeGreaterThan(0);
  });

  test('пуснат поименно човек също вижда CRM', async () => {
    mockDb.queryOne.mockResolvedValue({ can_grant: true, is_active: true });
    serve({});
    const res = await request(app).get('/api/history/filters').set('Cookie', memberCookie).expect(200);
    expect(res.body.crmAllowed).toBe(true);
  });
});

// ------------------------------------------------------------- нормализация

describe('таб „Задачи"', () => {
  test('показва поръчителя, а не бота, и сглобява детайлите', async () => {
    serve({
      tasks: [{
        id: 7, ts: '2026-08-10T09:00:00.000Z', kind: 'plan',
        title: 'Fornetti КП-5', card_url: 'https://3.basecamp.com/1/card/9',
        board_title: 'Pre-Production', column_title: 'Измисляне',
        video_count: 10, due_on: '2026-09-01', who: 'Мария', avatar_url: null,
      }],
    });
    const res = await request(app).get('/api/history?tab=tasks').set('Cookie', adminCookie).expect(200);
    expect(res.body.items).toHaveLength(1);
    const it = res.body.items[0];
    expect(it.who).toBe('Мария');
    expect(it.action).toContain('Измисляне');
    expect(it.title).toBe('Fornetti КП-5');
    expect(it.url).toBe('https://3.basecamp.com/1/card/9');
    expect(it.details).toBe('Pre-Production → Измисляне · 10 видеа · публикуване 01.09.2026');
  });

  test('единичната задача си има свой етикет', async () => {
    serve({ tasks: [{ id: 1, ts: '2026-08-10T09:00:00.000Z', kind: 'single', title: 'Реклама', who: 'Иван' }] });
    const res = await request(app).get('/api/history?tab=tasks').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].action).toBe('Поръча единична задача');
  });
});

describe('таб „КП"', () => {
  test('JSON детайлите стават четим ред, а линкът се вади отделно', async () => {
    serve({
      kp: [{
        id: 3, ts: '2026-08-09T10:00:00.000Z', who: 'Венци',
        action: 'create_kp_card', client_name: 'Cineland',
        details: 'Basecamp карта: Cineland КП-4 → Pre-Production / Измисляне (https://3.basecamp.com/1/c/4)',
      }, {
        id: 2, ts: '2026-08-08T10:00:00.000Z', who: 'Венци',
        action: 'create_client', client_name: 'Fornetti',
        details: JSON.stringify({ name: 'Fornetti', videos_per_month: 8, notes: '' }),
      }],
    });
    const res = await request(app).get('/api/history?tab=kp').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].action).toBe('Създаде КП карта');
    expect(res.body.items[0].url).toBe('https://3.basecamp.com/1/c/4');
    expect(res.body.items[1].action).toBe('Добави КП клиент');
    expect(res.body.items[1].details).toBe('name: Fornetti · videos_per_month: 8');
  });
});

describe('таб „Карти"', () => {
  test('събира събитията по картите и коментарите в една лента', async () => {
    serve({
      cardEvents: [{
        id: 5, ts: '2026-08-11T08:00:00.000Z', event_type: 'moved', metadata: null,
        card_id: 42, card_title: 'Видео 3', who: 'Мария',
        from_board: 'Pre', from_col: 'Измисляне', to_board: 'Prod', to_col: 'Снимане',
      }, {
        id: 4, ts: '2026-08-11T07:00:00.000Z', event_type: 'assignee_added',
        metadata: { assignee_name: 'Иван', user_name: 'Мария' },
        card_id: 42, card_title: 'Видео 3', who: null,
      }],
      comments: [{
        id: 9, ts: '2026-08-11T09:00:00.000Z', target_id: 42,
        target_title: 'Видео 3', board_name: 'Prod', who: 'Венци',
      }],
    });
    const res = await request(app).get('/api/history?tab=cards').set('Cookie', adminCookie).expect(200);
    const items = res.body.items;
    expect(items.map((i) => i.action)).toEqual(['Коментира по карта', 'Премести карта', 'Назначи човек по карта']);
    expect(items[1].details).toBe('Pre / Измисляне → Prod / Снимане');
    // Името идва от metadata, когато потребителят е изтрит.
    expect(items[2].who).toBe('Мария');
    expect(items[2].details).toBe('Иван');
    expect(items[0].url).toBe('#/card/42');
  });

  test('промяна на поле показва старата и новата стойност', async () => {
    serve({
      cardEvents: [{
        id: 1, ts: '2026-08-11T08:00:00.000Z', event_type: 'field_changed',
        metadata: { field: 'due_on', old_value: null, new_value: '2026-08-20', user_name: 'Венци' },
        card_id: 7, card_title: 'Карта', who: 'Венци',
      }],
    });
    const res = await request(app).get('/api/history?tab=cards').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].action).toBe('Промени крайния срок');
    expect(res.body.items[0].details).toBe('(празно) → 20.08.2026');
  });
});

describe('таб „Срокове"', () => {
  test('датите излизат в четим вид', async () => {
    serve({
      dates: [{
        id: 1, ts: '2026-08-11T08:00:00.000Z', field_name: 'filming_date',
        old_value: '2026-08-14', new_value: '2026-08-18', card_id: 3,
        who: 'Иван', card_title: 'Fornetti Видео 2',
      }],
    });
    const res = await request(app).get('/api/history?tab=dates').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].action).toBe('Промени датата за снимане');
    expect(res.body.items[0].details).toBe('14.08.2026 → 18.08.2026');
  });
});

describe('таб „CRM"', () => {
  test('смяната на етап показва откъде накъде', async () => {
    serve({
      crm: [{
        id: 1, ts: '2026-08-11T08:00:00.000Z', kind: 'stage', body: '',
        from_stage: 'Нов контакт', to_stage: 'Изпратено КП', deal_id: 12,
        who: 'Венци', deal_title: 'Ресторант', company: 'ООД',
      }],
    });
    const res = await request(app).get('/api/history?tab=crm').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].action).toBe('Премести сделка');
    expect(res.body.items[0].title).toBe('Ресторант · ООД');
    expect(res.body.items[0].details).toBe('Нов контакт → Изпратено КП');
    expect(res.body.items[0].url).toBe('#/crm/12');
  });
});

describe('таб „Текст"', () => {
  const row = {
    id: 4, ts: '2026-08-13T08:00:00.000Z', card_id: 99,
    card_title: 'Fornetti КП-5', board_title: 'Pre-Production',
    app_url: 'https://3.basecamp.com/c/99', field: 'content',
    who: 'Мария', old_text: 'Първа версия', new_text: 'Втора версия',
    old_len: 13, new_len: 13,
  };

  test('на собствения си таб носи целите текстове', async () => {
    serve({ text: [row] });
    const res = await request(app).get('/api/history?tab=text').set('Cookie', adminCookie).expect(200);
    const it = res.body.items[0];
    expect(it.action).toBe('Промени текста на задача');
    expect(it.who).toBe('Мария');
    expect(it.diff).toEqual({ field: 'content', old: 'Първа версия', new: 'Втора версия' });
    expect(it.details).toContain('беше 13 знака, стана 13');
  });

  test('в обединения таб текстовете не се пращат', async () => {
    serve({ text: [row] });
    const res = await request(app).get('/api/history').set('Cookie', adminCookie).expect(200);
    const it = res.body.items.find((x) => x.source === 'text');
    expect(it).toBeTruthy();
    expect(it.diff).toBeUndefined();
    // Тежките колони не се и селектират, не просто се изрязват после.
    expect(sqlFor('text')[0][0]).not.toMatch(/t\.old_text,/);
  });

  test('преименуването си има свой етикет', async () => {
    serve({ text: [{ ...row, field: 'title', old_text: 'Старо име', new_text: 'Ново име' }] });
    const res = await request(app).get('/api/history?tab=text').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].action).toBe('Преименува задача');
  });

  test('без открит автор пише „не се знае", вместо да мълчи', async () => {
    serve({ text: [{ ...row, who: '' }] });
    const res = await request(app).get('/api/history?tab=text').set('Cookie', adminCookie).expect(200);
    expect(res.body.items[0].who).toBe('не се знае');
  });
});

// ---------------------------------------------------------------- филтрите

describe('филтрите се прилагат в SQL-а', () => {
  beforeEach(() => serve({}));

  test('периодът става условие по време с истинска дата', async () => {
    await request(app).get('/api/history?tab=tasks&range=24h').set('Cookie', adminCookie).expect(200);
    const [sql, params] = sqlFor('tasks')[0];
    expect(sql).toMatch(/l\.created_at >= \$1/);
    const since = new Date(params[0]).getTime();
    const expected = Date.now() - 24 * 3600 * 1000;
    expect(Math.abs(since - expected)).toBeLessThan(60_000);
  });

  test('„целият период" не слага условие по време', async () => {
    await request(app).get('/api/history?tab=tasks&range=all').set('Cookie', adminCookie).expect(200);
    expect(sqlFor('tasks')[0][0]).not.toMatch(/>= \$/);
  });

  test('измислен период не минава за филтър', async () => {
    const res = await request(app).get('/api/history?tab=tasks&range=100y').set('Cookie', adminCookie).expect(200);
    expect(res.body.range).toBe('all');
    expect(sqlFor('tasks')[0][0]).not.toMatch(/>= \$/);
  });

  test('човек се търси с точно съвпадение, задача — с частично', async () => {
    await request(app).get('/api/history?tab=tasks&who=Мария&card=Fornetti')
      .set('Cookie', adminCookie).expect(200);
    const [sql, params] = sqlFor('tasks')[0];
    expect(sql).toMatch(/= \$1/);
    expect(sql).toMatch(/l\.title ILIKE \$2/);
    expect(params[0]).toBe('Мария');
    expect(params[1]).toBe('%Fornetti%');
  });

  test('търсенето минава през няколко колони наведнъж', async () => {
    await request(app).get('/api/history?tab=tasks&q=реклама').set('Cookie', adminCookie).expect(200);
    const [sql, params] = sqlFor('tasks')[0];
    expect(sql).toMatch(/l\.title ILIKE \$1 OR/);
    expect(sql).toMatch(/l\.board_title ILIKE \$1/);
    expect(params[0]).toBe('%реклама%');
  });

  test('филтрите важат за ВСЕКИ източник в обединения таб', async () => {
    await request(app).get('/api/history?range=7d').set('Cookie', adminCookie).expect(200);
    ['tasks', 'kp', 'calendar', 'dates', 'cardEvents', 'comments', 'crm']
      .forEach((s) => expect(sqlFor(s)[0][0]).toMatch(/>= \$1/));
  });

  test('коментарите пазят и собственото си условие покрай филтрите', async () => {
    await request(app).get('/api/history?tab=cards&range=7d').set('Cookie', adminCookie).expect(200);
    const sql = sqlFor('comments')[0][0];
    expect(sql).toMatch(/a\.action = 'commented'/);
    expect(sql).toMatch(/a\.created_at >= \$1/);
  });
});

describe('менютата за филтри', () => {
  test('вадят хора и задачи от самите дневници', async () => {
    mockDb.query.mockImplementation(async (sql) => {
      if (!/SELECT DISTINCT/.test(sql)) return [];
      if (/user_name|u\.name|who_name|changed_by_name/.test(sql)) return [{ v: 'Мария' }, { v: 'Система' }];
      return [{ v: 'Fornetti КП-5' }];
    });
    const res = await request(app).get('/api/history/filters?tab=tasks').set('Cookie', adminCookie).expect(200);
    expect(res.body.people).toEqual(['Мария', 'Система']);
    expect(res.body.cards).toEqual(['Fornetti КП-5']);
  });

  test('избраният човек не стеснява менюто с хора — иначе няма как да смениш', async () => {
    serve({});
    await request(app).get('/api/history/filters?tab=tasks&who=Мария&range=7d')
      .set('Cookie', adminCookie).expect(200);
    const distinct = mockDb.query.mock.calls.filter((c) => /SELECT DISTINCT/.test(c[0]));
    expect(distinct.length).toBeGreaterThan(0);
    distinct.forEach(([sql]) => {
      expect(sql).toMatch(/>= \$1/);      // периодът важи
      expect(sql).not.toMatch(/= \$2/);   // човекът — не
    });
  });
});

// --------------------------------------------------------------- обединено

describe('таб „Всичко"', () => {
  test('слива източниците и подрежда най-новото отгоре', async () => {
    serve({
      tasks: [{ id: 1, ts: '2026-08-10T09:00:00.000Z', kind: 'single', title: 'Задача', who: 'Мария' }],
      kp: [{ id: 2, ts: '2026-08-12T09:00:00.000Z', who: 'Венци', action: 'create_kp_card', client_name: 'Cineland', details: '' }],
      calendar: [{ id: 3, ts: '2026-08-11T09:00:00.000Z', who: 'Иван', action: 'add', card_title: 'Снимки', details: 'за 14.08' }],
    });
    const res = await request(app).get('/api/history').set('Cookie', adminCookie).expect(200);
    expect(res.body.tab).toBe('all');
    expect(res.body.items.map((i) => i.source)).toEqual(['kp', 'calendar', 'tasks']);
    expect(res.body.items[1].action).toBe('Насрочи снимки');
  });

  test('счупен източник не сваля останалите', async () => {
    serve({
      calendar: new Error('relation "bc_production_calendar_log" does not exist'),
      tasks: [{ id: 1, ts: '2026-08-10T09:00:00.000Z', kind: 'single', title: 'Задача', who: 'Мария' }],
    });
    const res = await request(app).get('/api/history').set('Cookie', adminCookie).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].source).toBe('tasks');
  });

  test('непознат таб пада към „Всичко"', async () => {
    serve({});
    const res = await request(app).get('/api/history?tab=глупост').set('Cookie', adminCookie).expect(200);
    expect(res.body.tab).toBe('all');
  });
});

// ------------------------------------------------------------- „Покажи още"

describe('брой редове', () => {
  const rows = (n) => Array.from({ length: n }, (_, i) => ({
    id: i, ts: new Date(Date.UTC(2026, 7, 1, 0, i)).toISOString(),
    kind: 'single', title: 'Задача ' + i, who: 'Мария',
  }));

  test('над лимита → hasMore и рязане до лимита', async () => {
    serve({ tasks: rows(6) });
    const res = await request(app).get('/api/history?tab=tasks&limit=5').set('Cookie', adminCookie).expect(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.hasMore).toBe(true);
  });

  test('точно до лимита → няма още', async () => {
    serve({ tasks: rows(5) });
    const res = await request(app).get('/api/history?tab=tasks&limit=5').set('Cookie', adminCookie).expect(200);
    expect(res.body.items).toHaveLength(5);
    expect(res.body.hasMore).toBe(false);
  });

  test('лимитът е с таван и не приема боклук', async () => {
    serve({ tasks: [] });
    const big = await request(app).get('/api/history?tab=tasks&limit=99999').set('Cookie', adminCookie).expect(200);
    expect(big.body.limit).toBe(500);
    const junk = await request(app).get('/api/history?tab=tasks&limit=abc').set('Cookie', adminCookie).expect(200);
    expect(junk.body.limit).toBe(60);
  });
});
