// Контент стратегия агент (Венци, 12.11.2026) — чистите парчета: името на клиента и
// пакетът от името на проекта, папката в „Клиентски карти", връзката с КП-Автоматизация
// и документът за Basecamp.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
};
jest.mock('../src/db/pool', () => mockDb);

const store = require('../src/services/strategy-agent/store');
const { strategyDocHtml } = require('../src/services/strategy-agent/pipeline');

describe('името на клиента и пакетът от проекта', () => {
  test('клиентът е преди разделителя', () => {
    expect(store.clientNameFromProject('Altea Residence - SMM10 + Performance')).toBe('Altea Residence');
    expect(store.clientNameFromProject('MOE | Gameloft - SMM')).toBe('MOE');
    expect(store.clientNameFromProject(' Pulse Therme SMM 10 + Performance')).toBe('Pulse Therme');
    expect(store.clientNameFromProject('CoTransition')).toBe('CoTransition');
  });

  test('пакетът: видеа, статични, реклами', () => {
    expect(store.planFromProject('Rosberg - SMM 9 + Static 2')).toEqual({ videos: 9, statics: 2, performance: false, consulting: false });
    expect(store.planFromProject('Altea Residence - SMM10 + Performance')).toMatchObject({ videos: 10, performance: true });
    expect(store.planFromProject('Зографа - SMM Consulting')).toMatchObject({ videos: null, consulting: true });
  });
});

describe('папката в „Клиентски карти"', () => {
  const folders = [{ title: 'Pulse Gym Shop' }, { title: 'Pulse Fitness and Spa' }, { title: 'Re/Shape' }, { title: 'Aula' }];

  test('точно име', () => {
    expect(store.findClientFolder(folders, 'Aula', 'AULA.BG - SSM').title).toBe('Aula');
  });
  test('името на папката се съдържа в проекта', () => {
    expect(store.findClientFolder(folders, 'Dr.Denkov', 'Dr.Denkov - Re/Shape - SMM & Performance').title).toBe('Re/Shape');
    expect(store.findClientFolder(folders, 'Pulse GYM Shop', 'Pulse GYM Shop - SMM 10').title).toBe('Pulse Gym Shop');
  });
  test('няма съвпадение → null (агентът прави нова папка)', () => {
    expect(store.findClientFolder(folders, 'Altea Residence', 'Altea Residence - SMM10')).toBeNull();
  });
});

test('клиентът от КП-Автоматизация — първо по проекта, после по име (активният)', () => {
  const rows = [
    { id: 1, name: 'Sirvis', bc_project_id: '49188413', is_active: true },
    { id: 2, name: 'Ergon', bc_project_id: null, is_active: false },
    { id: 3, name: 'Ergon', bc_project_id: null, is_active: true },
  ];
  expect(store.matchKpClient(rows, 49188413, 'нещо').id).toBe(1);
  expect(store.matchKpClient(rows, 1, 'Ergon').id).toBe(3);
  expect(store.matchKpClient(rows, 1, 'Непознат')).toBeNull();
});

test('документът: раздели, без HTML от агента, с въпросите за срещата', () => {
  const html = strategyDocHtml({
    clientName: 'Altea <b>', projectName: 'Altea - SMM10',
    facts: { gaps: ['бюджет за реклами'] },
    strategy: {
      summary: 'Посока', pillars: [{ name: 'Зад кулисите', share_pct: 40, why: 'доверие', topics: ['екипът'] }],
      content_mix: { videos_per_month: 10, split: [{ type: 'Reels', count: 10, purpose: 'обхват' }] },
      questions_for_meeting: ['Кой ще е лицето?'],
    },
    stats: { messages: 1, comments: 2, docs: 3, files: 0, todos: 4, chat: 0, card_docs: 1 },
  });
  expect(html).toContain('<h1>Стълбове на съдържанието</h1>');
  expect(html).toContain('Зад кулисите');
  expect(html).toContain('Кой ще е лицето?');
  expect(html).toContain('бюджет за реклами');
  expect(html).toContain('Altea &lt;b&gt;');
  expect(html).not.toContain('<b>');
});
