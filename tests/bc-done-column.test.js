// Коя колона е „Done" в една Basecamp card table.
//
// Има значение, защото след разбиване на КП главната карта отива точно там
// (Венци, 22.08.2026). Първият опит с точно съвпадение по име не хвана колоната —
// оттам и това правило: типът е източникът на истината, името е само резерва и се
// търси СВОБОДНО в него.
const bc = require('../src/services/basecamp');

const col = (title, type) => ({ id: title.length, title, type });

describe('pickDoneColumn', () => {
  test('познава колоната по типа, без значение как е кръстена', () => {
    const lists = [
      col('Разпределение', 'Kanban::Column::Triage'),
      col('Измисляне', 'Kanban::Column'),
      col('Приключено обаче на български', 'Kanban::Column::DoneColumn'),
    ];
    expect(bc.pickDoneColumn(lists).title).toBe('Приключено обаче на български');
  });

  test('типът бие името — колона на име „Done" не краде мястото', () => {
    const lists = [
      col('Done ли е?', 'Kanban::Column'),
      col('Готово', 'Kanban::Column::DoneColumn'),
    ];
    expect(bc.pickDoneColumn(lists).title).toBe('Готово');
  });

  test('без тип пада на името, и то свободно, не с точно съвпадение', () => {
    expect(bc.pickDoneColumn([col('Измисляне', 'Kanban::Column'), col('Done', 'Kanban::Column')]).title).toBe('Done');
    expect(bc.pickDoneColumn([col('Done - Pre-Production', 'Kanban::Column')]).title).toBe('Done - Pre-Production');
    expect(bc.pickDoneColumn([col('Готово', 'Kanban::Column')]).title).toBe('Готово');
    expect(bc.pickDoneColumn([col('Приключени', 'Kanban::Column')]).title).toBe('Приключени');
  });

  test('няма такава колона → null, а не гадаене', () => {
    expect(bc.pickDoneColumn([col('Измисляне', 'Kanban::Column'), col('В продукция', 'Kanban::Column')])).toBeNull();
    expect(bc.pickDoneColumn([])).toBeNull();
    expect(bc.pickDoneColumn(null)).toBeNull();
  });
});

// Позициите в Basecamp се броят ОТ 1. Подадена 0 връща 400 „Position out of bounds"
// и картата изобщо не се мести — точно в това се спъна закриването на КП плана
// (Венци, 22.08.2026). Затова невалидна позиция вече просто не се праща.
describe('moveCardToColumn — позицията', () => {
  const realFetch = global.fetch;
  let sent;

  beforeEach(() => {
    sent = [];
    global.fetch = jest.fn(async (url, opts) => {
      sent.push({ url, body: JSON.parse(opts.body) });
      return { ok: true, status: 200, json: async () => ({}) };
    });
  });
  afterAll(() => { global.fetch = realFetch; });

  const move = (position) => bc.moveCardToColumn('tok', '5750544', 39396506, 111, 222, position);

  test('без подадена позиция не се праща position', async () => {
    await move(undefined);
    expect(sent[0].body).toEqual({ column_id: 222 });
  });

  test('0 НЕ се праща — това е грешката, която върна 400', async () => {
    await move(0);
    expect(sent[0].body).toEqual({ column_id: 222 });
    expect(sent[0].body.position).toBeUndefined();
  });

  test('отрицателна и нецяла позиция също отпадат', async () => {
    await move(-3);
    await move(1.5);
    expect(sent.every((s) => s.body.position === undefined)).toBe(true);
  });

  test('валидна позиция (>= 1) минава непокътната', async () => {
    await move(1);
    await move(7);
    expect(sent.map((s) => s.body.position)).toEqual([1, 7]);
  });

  test('удря правилния endpoint за карта', async () => {
    await move(1);
    expect(sent[0].url).toContain('/buckets/39396506/card_tables/cards/111/moves.json');
  });
});
