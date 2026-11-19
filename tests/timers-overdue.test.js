// Таймерът „Без просрочена" — сървърът решава дали дъската има черна карта.
const { boardHasOverdue } = require('../src/routes/timers');

const T = '2026-11-19';
const c = (dueOn, x = {}) => ({ dueOn, ...x });

test('скритите колони, приоритетните и завършените не спират таймера', () => {
  expect(boardHasOverdue([
    { title: 'Not now', cards: [c('2026-01-01')] },
    { title: 'Done', isDone: true, cards: [c('2026-01-01')] },
    { title: 'В монтаж', cards: [c('2026-11-19'), c('2026-11-10', { priority: true }), c('2026-11-01', { completed: true })] },
  ], T)).toBe(false);
});

test('карта с минала дата в нормална колона спира таймера', () => {
  expect(boardHasOverdue([{ title: 'В монтаж', cards: [c('2026-11-18')] }], T)).toBe(true);
  expect(boardHasOverdue([{ title: 'В монтаж', cards: [c('2026-11-18T10:00:00Z')] }], T)).toBe(true);
});
