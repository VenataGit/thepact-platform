// Кога клиентът има „активен контент план" — правилото, което решава дали авто-графикът
// пуска следващия КП (services/kp-create.js).
//
// Регресията, която тези тестове пазят (Credissimo, 30.07.2026): върнатата за корекции
// карта „Credissimo КП-11 - Видео 1 - …" в „Към Клиент" държеше клиента зает, а главните
// КП-10/КП-11 отдавна бяха в Done → следващият план не се пускаше никога.
const mockDb = {
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined)
};
jest.mock('../src/db/pool', () => mockDb);

const mockAgg = {
  loadStructure: jest.fn(),
  loadBoardCards: jest.fn(),
  invalidateBoard: jest.fn(),
};
jest.mock('../src/services/bc-aggregate', () => mockAgg);

const kpc = require('../src/services/kp-create');

const CFG = { titleTemplate: '{клиент} КП-{номер}', checkScope: 'ready', readyColumnId: null };
const AUTH = { token: 't', account: '1' };

// Реалната Pre-Production дъска, в реда от Basecamp.
const COLUMNS = [
  { id: 'c1', title: 'Измисляне' },
  { id: 'c2', title: 'Към Клиент' },
  { id: 'c3', title: 'В продукция' },
  { id: 'c4', title: 'Not now' },
  { id: 'c5', title: 'Done', isDone: true },
];

function mockBoard(columns = COLUMNS) {
  mockAgg.loadStructure.mockResolvedValue({
    projectId: '39396506',
    boards: [{ id: 'b1', title: 'Pre-Production', columns }],
  });
}

// cardsByColumn: { columnId: [{ title, completed? }] }
function mockCards(cardsByColumn) {
  mockAgg.loadBoardCards.mockResolvedValue({
    columns: Object.entries(cardsByColumn).map(([id, cards]) => ({
      id,
      cards: cards.map((c, i) => ({ id: `${id}-${i}`, url: `https://bc/${id}/${i}`, completed: false, ...c })),
      onHoldCards: [],
    })),
  });
}

beforeEach(() => {
  mockAgg.loadStructure.mockReset();
  mockAgg.loadBoardCards.mockReset();
  mockBoard();
});

describe('kpMainTitleRegex — само главната КП карта', () => {
  const re = (client, tpl) => kpc.kpMainTitleRegex(tpl ? { titleTemplate: tpl } : CFG, client);

  test('хваща главната карта', () => {
    expect(re('Credissimo').test('Credissimo КП-11')).toBe(true);
    expect(re('Credissimo').test('  Credissimo КП-9  ')).toBe(true);
  });

  test('НЕ хваща картите за отделните видеа', () => {
    expect(re('Credissimo').test('Credissimo КП-11 - Видео 1 - Скреч карти Credissimo')).toBe(false);
    expect(re('Credissimo').test('Credissimo КП-11 - Резултати')).toBe(false);
  });

  test('НЕ хваща други карти на клиента', () => {
    expect(re('Credissimo').test('Credissimo UGC/SEO видеа')).toBe(false);
  });

  test('не бърка клиентите', () => {
    expect(re('ЕКОПАК').test('Credissimo КП-11')).toBe(false);
  });

  test('работи и с шаблон с текст след номера', () => {
    const r = re('Cineland', '{клиент} КП-{номер} контент план');
    expect(r.test('Cineland КП-4 контент план')).toBe(true);
    expect(r.test('Cineland КП-4')).toBe(false);
  });
});

describe('resolveKpDestination — колоната „готово за продукция"', () => {
  test('авто-разпознава „В продукция" и колоните преди нея', async () => {
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    expect(dest.readyColumnTitle).toBe('В продукция');
    expect(dest.blockingColumnIds).toEqual(['c1', 'c2']);
    expect(dest.columnTitles.c2).toBe('Към Клиент');
  });

  test('изрично зададена колона печели', async () => {
    const dest = await kpc.resolveKpDestination(AUTH, { ...CFG, readyColumnId: 'c2' });
    expect(dest.readyColumnTitle).toBe('Към Клиент');
    expect(dest.blockingColumnIds).toEqual(['c1']);
  });

  test('дъска без „В продукция" → няма задържащи колони (пада на старото поведение)', async () => {
    mockBoard([{ id: 'c1', title: 'Измисляне' }, { id: 'c5', title: 'Done', isDone: true }]);
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    expect(dest.readyColumnTitle).toBeNull();
    expect(dest.blockingColumnIds).toEqual([]);
  });
});

describe('isBlockingColumn — по обхват', () => {
  let dest;
  beforeEach(async () => { dest = await kpc.resolveKpDestination(AUTH, CFG); });

  test('ready: задържат само колоните преди „В продукция"', () => {
    const scope = { checkScope: 'ready' };
    expect(kpc.isBlockingColumn(scope, dest, 'c1')).toBe(true);
    expect(kpc.isBlockingColumn(scope, dest, 'c2')).toBe(true);
    expect(kpc.isBlockingColumn(scope, dest, 'c3')).toBe(false);
    expect(kpc.isBlockingColumn(scope, dest, 'c5')).toBe(false);
  });

  test('column: само колоната за създаване', () => {
    const scope = { checkScope: 'column' };
    expect(kpc.isBlockingColumn(scope, dest, 'c1')).toBe(true);
    expect(kpc.isBlockingColumn(scope, dest, 'c2')).toBe(false);
  });

  test('board: всичко извън Done', () => {
    const scope = { checkScope: 'board' };
    expect(kpc.isBlockingColumn(scope, dest, 'c3')).toBe(true);
    expect(kpc.isBlockingColumn(scope, dest, 'c5')).toBe(false);
  });

  test('ready без намерена колона → пада на „всичко извън Done"', () => {
    const bare = { columnId: 'c1', doneColumnIds: ['c5'], blockingColumnIds: [] };
    expect(kpc.isBlockingColumn({ checkScope: 'ready' }, bare, 'c2')).toBe(true);
    expect(kpc.isBlockingColumn({ checkScope: 'ready' }, bare, 'c5')).toBe(false);
  });
});

describe('findExistingKpCards — реалният случай Credissimo', () => {
  const clients = [{ name: 'Credissimo' }, { name: 'ЕКОПАК' }];

  test('видео карта от стар КП в „Към Клиент" НЕ задържа следващия план', async () => {
    mockCards({
      c2: [
        { title: 'Credissimo КП-11 - Видео 1 - Скреч карти Credissimo' },
        { title: 'Credissimo UGC/SEO видеа' },
      ],
      c5: [{ title: 'Credissimo КП-11', completed: true }],
    });
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    const found = await kpc.findExistingKpCards(AUTH, CFG, dest, clients);
    expect(found.has('credissimo')).toBe(false);
  });

  test('старото поведение (board + само префикс) щеше да го блокира', async () => {
    // Същите карти, но по стария начин: префиксът „Credissimo КП-" хваща и видео картата.
    const prefix = kpc.kpTitlePrefix(CFG, 'Credissimo').toLowerCase();
    expect('Credissimo КП-11 - Видео 1 - Скреч карти Credissimo'.toLowerCase().startsWith(prefix)).toBe(true);
  });

  test('главната карта в „Измисляне" задържа', async () => {
    mockCards({ c1: [{ title: 'Credissimo КП-12' }] });
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    const found = await kpc.findExistingKpCards(AUTH, CFG, dest, clients);
    expect(found.get('credissimo').columnTitle).toBe('Измисляне');
  });

  test('главната карта в „Към Клиент" още задържа', async () => {
    mockCards({ c2: [{ title: 'Credissimo КП-12' }] });
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    const found = await kpc.findExistingKpCards(AUTH, CFG, dest, clients);
    expect(found.has('credissimo')).toBe(true);
  });

  test('главната карта в „В продукция" → готови сме за следващия', async () => {
    mockCards({ c3: [{ title: 'Credissimo КП-12' }] });
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    const found = await kpc.findExistingKpCards(AUTH, CFG, dest, clients);
    expect(found.has('credissimo')).toBe(false);
  });

  test('завършена карта в задържаща колона не се брои', async () => {
    mockCards({ c1: [{ title: 'Credissimo КП-12', completed: true }] });
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    const found = await kpc.findExistingKpCards(AUTH, CFG, dest, clients);
    expect(found.has('credissimo')).toBe(false);
  });

  test('всеки клиент се брои сам за себе си', async () => {
    mockCards({ c1: [{ title: 'ЕКОПАК КП-3' }], c2: [{ title: 'Credissimo КП-11 - Видео 1 - х' }] });
    const dest = await kpc.resolveKpDestination(AUTH, CFG);
    const found = await kpc.findExistingKpCards(AUTH, CFG, dest, clients);
    expect(found.has('екопак')).toBe(true);
    expect(found.has('credissimo')).toBe(false);
  });
});
