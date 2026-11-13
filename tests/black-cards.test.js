// Черни карти — дневният анализ (services/black-cards.js).
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);

const { blackInfo, buildMessage, isWorkday } = require('../src/services/black-cards');

const RULES = { 'post-production': ['post-production', 'монтажист'] };
const card = (o) => ({ card_id: 1, board_title: 'Post-Production', column_title: 'Калоян', title: 'X КП-1 - Видео 1',
  completed: false, due_on: '2026-11-20', app_url: 'https://app.basecamp.com/1/x', assignees: [], steps: [], ...o });

describe('blackInfo', () => {
  const today = '2026-11-13';
  it('стъпката на отдела е минала → черна', () => {
    const r = blackInfo(card({ steps: [{ title: 'Post-Production - Приключен монтаж', due_on: '2026-11-10', completed: false }] }), RULES, today);
    expect(r).toMatchObject({ due: '2026-11-10', overdue: 3, stepDone: false });
  });
  it('чекната стъпка не я изчиства (като цвета в Таблото)', () => {
    const r = blackInfo(card({ steps: [{ title: 'Post-Production - Приключен монтаж', due_on: '2026-11-10', completed: true }] }), RULES, today);
    expect(r).toMatchObject({ stepDone: true });
  });
  it('дъска без стъпка → Due On', () => {
    expect(blackInfo(card({ board_title: 'Друго', due_on: '2026-11-12' }), RULES, today)).toMatchObject({ overdue: 1 });
    expect(blackInfo(card({ board_title: 'Друго', due_on: '2026-11-13' }), RULES, today)).toBeNull();
  });
  it('стъпка без дата не пада на Due On', () => {
    expect(blackInfo(card({ due_on: '2026-11-01', steps: [{ title: 'Post-Production - Приключен монтаж', due_on: null, completed: false }] }), RULES, today)).toBeNull();
  });
  it('Done / Not now / завършена / приоритет не се броят', () => {
    const st = [{ title: 'Post-Production - Приключен монтаж', due_on: '2026-11-01', completed: false }];
    expect(blackInfo(card({ steps: st, column_title: 'Not now' }), RULES, today)).toBeNull();
    expect(blackInfo(card({ steps: st, column_title: 'Done' }), RULES, today)).toBeNull();
    expect(blackInfo(card({ steps: st, completed: true }), RULES, today)).toBeNull();
    expect(blackInfo(card({ steps: [...st, { title: 'Приоритет', completed: true }] }), RULES, today)).toBeNull();
  });
});

describe('buildMessage', () => {
  it('изчистените са най-отгоре, тагове по sgid, анализът под картата', () => {
    const people = [{ person_id: '5', name: 'Ivo Ivanov', attachable_sgid: 'SG5', active: true }];
    const row = card({ card_id: 7, title: 'Клиент <1>' });
    const m = buildMessage({
      today: '2026-11-13',
      black: [{ row, due: '2026-11-10', step: 'Post-Production - Приключен монтаж', stepDone: false, overdue: 3 }],
      cleared: [{ id: 9, title: 'Готова', url: 'https://app.basecamp.com/1/y', how: 'приключена', whoId: '5', whoName: 'Ivo Ivanov' }],
      analysis: { byId: new Map([['7', { who: ['Ivo Ivanov'], status: 'чака монтаж', next: ['да се монтира'], missing: '' }]]), summaries: new Map() },
      people, team: people,
    });
    expect(m.subject).toBe('⬛ Черни карти — 13.11: 1, изчистени 1');
    expect(m.content.indexOf('Изчистено')).toBeLessThan(m.content.indexOf('Черни карти днес'));
    expect(m.content).toContain('sgid="SG5"');
    expect(m.content).toContain('https://3.basecamp.com/1/x');
    expect(m.content).toContain('Клиент &lt;1&gt;');
    expect(m.content).toContain('➡️ Следващи стъпки: да се монтира');
  });
});

describe('isWorkday', () => {
  it('без уикенди и празници', () => {
    expect(isWorkday('2026-11-13')).toBe(true);   // петък
    expect(isWorkday('2026-11-14')).toBe(false);  // събота
    expect(isWorkday('2026-12-24')).toBe(false);  // Бъдни вечер
  });
});

describe('parseJson', () => {
  const { parseJson } = require('../src/services/black-cards');
  it('поправя „…" със затваряща ASCII кавичка', () => {
    const j = parseJson('ето: {"summary": "висят в „Към Клиент" и „Качване"", "cards": []} край');
    expect(j).toEqual({ summary: 'висят в „Към Клиент“ и „Качване“', cards: [] });
  });
  it('нормален JSON минава', () => { expect(parseJson('{"a":1}')).toEqual({ a: 1 }); });
});
