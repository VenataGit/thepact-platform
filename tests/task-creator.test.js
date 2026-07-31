// Инструментът „Създаване на задачи" — чистата логика: шаблонът за задачата за
// измисляне и сметките за датите („попълни една, другите се смятат сами").
// Нищо тук не пипа мрежата или базата.

jest.mock('../src/db/pool', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }), end: jest.fn() },
  query: jest.fn().mockResolvedValue([]),
  queryOne: jest.fn().mockResolvedValue(null),
  execute: jest.fn().mockResolvedValue(undefined),
}));

const tc = require('../src/services/task-creator');
const workdays = require('../src/services/workdays');

const CFG = {
  mainTemplate: 'Дата за публикуване на първо видео: {first_publish_date}\n\n{video_sections}',
  videoTemplate: 'Видео {N} - ХХХ\nКопи: ХХХ',
};

describe('buildPlanText', () => {
  test('слага толкова видео секции, колкото са поискани', () => {
    const text = tc.buildPlanText(CFG, 'Fornetti КП-4', 3);
    expect(text).toContain('Видео 1 - ХХХ');
    expect(text).toContain('Видео 2 - ХХХ');
    expect(text).toContain('Видео 3 - ХХХ');
    expect(text).not.toContain('Видео 4');
    expect(text).not.toContain('{video_sections}');
    expect(text).not.toContain('{N}');
  });

  test('{клиент} става името на задачата, датите остават ХХХ', () => {
    const text = tc.buildPlanText({ ...CFG, mainTemplate: '{клиент}: {first_publish_date}\n{video_sections}' }, 'Cineland', 1);
    expect(text.startsWith('Cineland: ХХХ')).toBe(true);
  });
});

describe('parseSteps', () => {
  test('празна/счупена настройка → стъпките по подразбиране (11/6/1)', () => {
    expect(tc.parseSteps(null)).toBe(tc.DEFAULT_STEPS);
    expect(tc.parseSteps('не е json')).toBe(tc.DEFAULT_STEPS);
    expect(tc.parseSteps('[]')).toBe(tc.DEFAULT_STEPS);
    expect(tc.DEFAULT_STEPS.map((s) => s.offset)).toEqual([11, 6, 1]);
  });

  test('чете собствени стъпки и им дава ключ', () => {
    const steps = tc.parseSteps('[{"title":"Сценарий","offset":20},{"title":"","offset":3}]');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ key: 's1', title: 'Сценарий', offset: 20 });
  });
});

describe('deriveDates', () => {
  const steps = tc.DEFAULT_STEPS;

  test('от датата за публикуване смята всяка стъпка в работни дни назад', () => {
    const r = tc.deriveDates(steps, 'publish', '2026-09-30');
    expect(r.publish).toBe('2026-09-30');
    expect(r.steps.shoot).toBe(workdays.subtractWorkingDays('2026-09-30', 11));
    expect(r.steps.edit).toBe(workdays.subtractWorkingDays('2026-09-30', 6));
    expect(r.steps.upload).toBe(workdays.subtractWorkingDays('2026-09-30', 1));
  });

  test('от датата за заснемане смята напред датата за публикуване', () => {
    const r = tc.deriveDates(steps, 'shoot', '2026-09-15');
    expect(r.publish).toBe(workdays.addWorkingDays('2026-09-15', 11));
    // Въведената дата се връща точно каквато е — без обратно закръгляне.
    expect(r.steps.shoot).toBe('2026-09-15');
    expect(r.steps.edit).toBe(workdays.subtractWorkingDays(r.publish, 6));
  });

  test('въведеният почивен ден не се измества', () => {
    const r = tc.deriveDates(steps, 'shoot', '2026-09-19'); // събота
    expect(r.steps.shoot).toBe('2026-09-19');
  });

  test('непозната дата или поле → грешка', () => {
    expect(() => tc.deriveDates(steps, 'publish', '30.09.2026')).toThrow();
    expect(() => tc.deriveDates(steps, 'няма-такова', '2026-09-30')).toThrow();
  });
});
