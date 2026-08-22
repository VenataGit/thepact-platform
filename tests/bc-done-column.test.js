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
