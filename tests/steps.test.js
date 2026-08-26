// Производствените стъпки: нови имена, разпознаване на старите (преходен период)
// и правилата „дъска → префикс".
const steps = require('../src/services/steps');

describe('канонични стъпки', () => {
  test('четирите стъпки с отмесванията 16/11/6/1', () => {
    expect(steps.STEPS.map((s) => s.key)).toEqual(['idea', 'shoot', 'edit', 'upload']);
    expect(steps.STEPS.map((s) => s.offset)).toEqual([16, 11, 6, 1]);
  });

  test('всяко заглавие започва с името на своята колона', () => {
    for (const s of steps.STEPS) expect(s.title.startsWith(s.board)).toBe(true);
  });
});

describe('разпознаване на заглавия', () => {
  test('новите имена', () => {
    expect(steps.keyOfTitle('Pre-Production - Готов сценарий')).toBe('idea');
    expect(steps.keyOfTitle('Production - Заснет материал')).toBe('shoot');
    expect(steps.keyOfTitle('Post-Production - Приключен монтаж')).toBe('edit');
    expect(steps.keyOfTitle('Project Management - Качване/Насрочване')).toBe('upload');
  });

  test('старите имена продължават да се разпознават', () => {
    expect(steps.keyOfTitle('Измисляне на идея')).toBe('idea');
    expect(steps.keyOfTitle('Видеограф - Насрочване на снимачен ден')).toBe('shoot');
    expect(steps.keyOfTitle('Монтажист - Приключен монтаж')).toBe('edit');
    expect(steps.keyOfTitle('PM - Насрочване/Качване в социални мрежи')).toBe('upload');
  });

  test('непозната стъпка не се закача за нищо', () => {
    expect(steps.keyOfTitle('Приоритет')).toBe(null);
    expect(steps.keyOfTitle('')).toBe(null);
  });

  test('старото име се вдига до новото, чуждото остава непроменено', () => {
    expect(steps.canonicalTitle('Измисляне на идея')).toBe('Pre-Production - Готов сценарий');
    expect(steps.canonicalTitle('  монтажист - приключен монтаж ')).toBe('Post-Production - Приключен монтаж');
    expect(steps.canonicalTitle('Своя стъпка')).toBe('Своя стъпка');
  });
});

describe('префикси на дъските', () => {
  test('новият префикс е пръв, старият остава резервен', () => {
    expect(steps.prefixesForBoard('Pre-Production')).toEqual(['pre-production', 'измисляне', 'контент криейтър']);
    expect(steps.prefixesForBoard('Production')).toEqual(['production', 'видеограф']);
    expect(steps.prefixesForBoard('Акаунт Мениджмънт')).toEqual(['project management', 'pm']);
  });

  test('Pre/Post-Production не крадат стъпката на Production', () => {
    const prod = steps.prefixesForBoard('Production')[0];
    expect('Post-Production - Приключен монтаж'.toLowerCase().startsWith(prod)).toBe(false);
    expect('Pre-Production - Готов сценарий'.toLowerCase().startsWith(prod)).toBe(false);
    expect('Production - Заснет материал'.toLowerCase().startsWith(prod)).toBe(true);
  });

  test('дъска без правило няма префикси', () => {
    expect(steps.prefixesForBoard('Задачи')).toEqual([]);
  });
});

describe('„Приоритет" е отделно от производствените стъпки', () => {
  // Пази инварианта: влезе ли „Приоритет" в STEPS, авто-синхронът ще ѝ слага датата за
  // публикуване при всяка промяна на Due On, защото subtractWorkingDays(d, undefined)
  // връща самата дата. Затова тя нарочно стои отвън и без offset.
  test('не е в STEPS и няма отместване', () => {
    expect(steps.STEPS.some((s) => s.key === steps.PRIORITY_STEP.key)).toBe(false);
    expect(steps.PRIORITY_STEP.offset).toBeUndefined();
    expect(steps.PRIORITY_STEP.title).toBe('Приоритет');
  });

  test('авто-синхронът не я разпознава като производствена стъпка', () => {
    expect(steps.keyOfTitle(steps.PRIORITY_STEP.title)).toBe(null);
  });

  test('isPriorityTitle лови регистър, интервали и опашка след името', () => {
    expect(steps.isPriorityTitle('Приоритет')).toBe(true);
    expect(steps.isPriorityTitle('  приоритет  ')).toBe(true);
    expect(steps.isPriorityTitle('Приоритет - спешно')).toBe(true);
    expect(steps.isPriorityTitle('Pre-Production - Готов сценарий')).toBe(false);
    expect(steps.isPriorityTitle('')).toBe(false);
  });

  test('никоя дъска не следи „Приоритет" за срок', () => {
    for (const board of Object.keys(steps.BOARD_PREFIXES)) {
      const pfx = steps.prefixesForBoard(board);
      expect(pfx.some((p) => steps.PRIORITY_STEP.title.toLowerCase().startsWith(p))).toBe(false);
    }
  });
});

describe('контент план', () => {
  test('планът носи само стъпката за сценарий', () => {
    const s = steps.byKey(steps.PLAN_STEP_KEY);
    expect(s.title).toBe('Pre-Production - Готов сценарий');
    expect(s.offset).toBe(16);
  });
});
