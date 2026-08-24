// Коя дата показва картата в дадена дъска (services/bc-aggregate.stepDueOf).
//
// Правилото (Венци, 24.08.2026): Due On значи само „дата за публикуване"; всяка колона
// следи СВОЯТА стъпка. Тестваме четирите изхода: чакаща стъпка, чекната стъпка, стъпка
// без дата и дъска без такава стъпка.
jest.mock('../src/db/pool', () => ({
  pool: { query: jest.fn(), end: jest.fn().mockResolvedValue(undefined) },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
}));

const agg = require('../src/services/bc-aggregate');
const steps = require('../src/services/steps');

const POST = steps.prefixesForBoard('Post-Production');
const PRE = steps.prefixesForBoard('Pre-Production');

describe('stepDueOf — датата на дъската идва от нейната стъпка', () => {
  test('чакаща стъпка с дата → нейната дата, не Due On', () => {
    const r = agg.stepDueOf(
      [
        { title: 'Production - Заснет материал', due_on: '2026-09-10', completed: false },
        { title: 'Post-Production - Приключен монтаж', due_on: '2026-09-17', completed: false },
      ],
      POST
    );
    expect(r).toEqual({ due: '2026-09-17', title: 'Post-Production - Приключен монтаж', done: false });
  });

  test('чекната стъпка → пак нейната дата, но отбелязана като приключена', () => {
    const r = agg.stepDueOf(
      [{ title: 'Монтажист - Приключен монтаж', due_on: '2026-08-14', completed: true }],
      POST
    );
    expect(r).toEqual({ due: '2026-08-14', title: 'Монтажист - Приключен монтаж', done: true });
  });

  test('стъпката е без дата → картата остава без дата, а НЕ на Due On', () => {
    const r = agg.stepDueOf(
      [{ title: 'Монтажист - Приключен монтаж', due_on: null, completed: false }],
      POST
    );
    expect(r.due).toBe(null);
    expect(r.title).toBe('Монтажист - Приключен монтаж');
  });

  test('дъската няма своя стъпка → null (картата си остава на Due On)', () => {
    expect(agg.stepDueOf([{ title: 'Приоритет', due_on: null, completed: false }], POST)).toBe(null);
    expect(agg.stepDueOf([], POST)).toBe(null);
  });

  test('чакащата стъпка бие чекнатата, ако и двете са на дъската', () => {
    const r = agg.stepDueOf(
      [
        { title: 'Монтажист - Започнат монтаж', due_on: '2026-08-01', completed: true },
        { title: 'Монтажист - Приключен монтаж', due_on: '2026-08-20', completed: false },
      ],
      POST
    );
    expect(r.due).toBe('2026-08-20');
    expect(r.done).toBe(false);
  });

  test('Pre-Production разпознава и старото „Контент Криейтър - Измисляне"', () => {
    const r = agg.stepDueOf(
      [{ title: 'Контент Криейтър - Измисляне', due_on: '2026-08-17', completed: false }],
      PRE
    );
    expect(r.due).toBe('2026-08-17');
  });

  test('Post-Production не краде стъпката на Production и обратно', () => {
    const only = [{ title: 'Post-Production - Приключен монтаж', due_on: '2026-09-17', completed: false }];
    expect(agg.stepDueOf(only, steps.prefixesForBoard('Production'))).toBe(null);
  });
});

describe('mapCard — какво стига до Таблото', () => {
  const card = (steps_) => ({ id: 1, title: 'Клиент КП-1 - Видео 1', due_on: '2026-09-25', steps: steps_ });

  test('чакаща стъпка: dueOn е на стъпката, Due On се пази в cardDueOn', () => {
    const m = agg.mapCard(card([{ title: 'Post-Production - Приключен монтаж', due_on: '2026-09-17', completed: false }]), POST);
    expect(m.dueOn).toBe('2026-09-17');
    expect(m.dueFromStep).toBe(true);
    expect(m.dueStepDone).toBe(false);
    expect(m.cardDueOn).toBe('2026-09-25');
  });

  test('стъпка без дата: картата е без дата, а не с датата за публикуване', () => {
    const m = agg.mapCard(card([{ title: 'Монтажист - Приключен монтаж', due_on: null, completed: false }]), POST);
    expect(m.dueOn).toBe(null);
    expect(m.cardDueOn).toBe('2026-09-25');
  });

  test('няма стъпка за тази дъска: пада на Due On', () => {
    const m = agg.mapCard(card([{ title: 'Приоритет', due_on: null, completed: false }]), POST);
    expect(m.dueOn).toBe('2026-09-25');
    expect(m.dueFromStep).toBeUndefined();
  });
});
