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

describe('допълнителна информация', () => {
  test('сменя ХХХ-то на реда „Допълнителна информация" в шаблона', () => {
    const cfg = { ...CFG, mainTemplate: 'Начало\nДопълнителна информация от акаунт – ХХХ\n\n{video_sections}' };
    const text = tc.buildPlanText(cfg, 'Fornetti', 1, 'Снимаме в новия обект');
    expect(text).toContain('Допълнителна информация от акаунт – Снимаме в новия обект');
    expect(text).not.toContain('от акаунт – ХХХ');
  });

  test('изричният плейсхолдър печели', () => {
    const cfg = { ...CFG, mainTemplate: 'A {доп_информация} Б\n{video_sections}' };
    expect(tc.buildPlanText(cfg, 'X', 1, 'ТЕКСТ')).toContain('A ТЕКСТ Б');
  });

  test('няма ли къде — добавя блок най-отдолу', () => {
    const text = tc.buildPlanText(CFG, 'X', 1, 'Само това');
    expect(text).toContain('Допълнителна информация:\nСамо това');
  });

  test('празно поле не променя нищо', () => {
    const cfg = { ...CFG, mainTemplate: 'Допълнителна информация от акаунт – ХХХ\n{video_sections}' };
    expect(tc.buildPlanText(cfg, 'X', 1, '   ')).toContain('от акаунт – ХХХ');
  });

  test('не хваща „Допълнителна информация" вътре във видео секция', () => {
    const cfg = {
      mainTemplate: 'Начало\n{video_sections}',
      videoTemplate: 'Видео {N} - ХХХ\nДопълнителна информация - ХХХ',
    };
    const text = tc.buildPlanText(cfg, 'X', 2, 'ново');
    expect(text).toContain('Допълнителна информация:\nново'); // отделен блок, не в секцията
    expect((text.match(/Допълнителна информация - ХХХ/g) || [])).toHaveLength(2); // секциите са непокътнати
  });
});

describe('defaultSingleTemplate', () => {
  test('маха реда „Видео {N} - …", защото той е името на задачата', () => {
    const t = tc.defaultSingleTemplate('Видео {N} - ХХХ\n/Локация - ХХХ/\nКопи: ХХХ');
    expect(t).toBe('/Локация - ХХХ/\nКопи: ХХХ');
  });

  test('шаблон без такъв ред остава цял', () => {
    expect(tc.defaultSingleTemplate('Копи: ХХХ')).toBe('Копи: ХХХ');
  });
});

describe('parseSteps', () => {
  test('празна/счупена настройка → стъпките по подразбиране (16/11/6/1)', () => {
    expect(tc.parseSteps(null)).toBe(tc.DEFAULT_STEPS);
    expect(tc.parseSteps('не е json')).toBe(tc.DEFAULT_STEPS);
    expect(tc.parseSteps('[]')).toBe(tc.DEFAULT_STEPS);
    expect(tc.DEFAULT_STEPS.map((s) => s.offset)).toEqual([16, 11, 6, 1]);
    expect(tc.DEFAULT_STEPS.map((s) => s.label)).toEqual([
      'Дата за измисляне', 'Дата за заснемане', 'Дата за монтаж', 'Дата за насрочване',
    ]);
  });

  test('чете собствени стъпки и им дава ключ; липсващ етикет пада на заглавието', () => {
    const steps = tc.parseSteps('[{"title":"Сценарий","offset":20},{"title":"","offset":3}]');
    expect(steps).toHaveLength(1);
    expect(steps[0]).toEqual({ key: 's1', title: 'Сценарий', label: 'Сценарий', offset: 20 });
  });

  test('подрежда по реда на процеса — най-отдалеченото от публикуването е първо', () => {
    const steps = tc.parseSteps('[{"title":"Б","offset":2},{"title":"А","offset":9},{"title":"В","offset":5}]');
    expect(steps.map((s) => s.title)).toEqual(['А', 'В', 'Б']);
  });
});

describe('deriveDates', () => {
  const steps = tc.DEFAULT_STEPS;

  test('измислянето пада преди заснемането', () => {
    const r = tc.deriveDates(steps, 'publish', '2026-09-30');
    expect(r.steps.idea < r.steps.shoot).toBe(true);
    expect(r.steps.shoot < r.steps.edit).toBe(true);
    expect(r.steps.edit < r.steps.upload).toBe(true);
    expect(r.steps.upload < r.publish).toBe(true);
  });

  test('от датата за публикуване смята всяка стъпка в работни дни назад', () => {
    const r = tc.deriveDates(steps, 'publish', '2026-09-30');
    expect(r.publish).toBe('2026-09-30');
    expect(r.steps.idea).toBe(workdays.subtractWorkingDays('2026-09-30', 16));
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

// Каноничната подредба на дъските (services/bc-aggregate.js) — редът, по който
// задачите минават. Венци го иска еднакъв във всеки изглед, затова се пази тук.
describe('sortBoards', () => {
  const agg = require('../src/services/bc-aggregate');
  const titles = (bs) => agg.sortBoards(bs).map((b) => b.title);

  test('Pre → Production → Post → Project Management, каквото и да е подаването', () => {
    const boards = [
      { title: 'Post-Production' }, { title: 'Project Management' },
      { title: 'Production' }, { title: 'Pre-Production' },
    ];
    expect(titles(boards)).toEqual(['Pre-Production', 'Production', 'Post-Production', 'Project Management']);
  });

  test('старото име „Акаунт Мениджмънт" се нарежда на същото място', () => {
    const boards = [{ title: 'Акаунт Мениджмънт' }, { title: 'Production' }, { title: 'Pre-Production' }];
    expect(titles(boards)).toEqual(['Pre-Production', 'Production', 'Акаунт Мениджмънт']);
  });

  test('непознати дъски отиват най-отзад, в реда от Basecamp', () => {
    const boards = [{ title: 'Идеи' }, { title: 'Архив' }, { title: 'Production' }];
    expect(titles(boards)).toEqual(['Production', 'Идеи', 'Архив']);
  });
});
