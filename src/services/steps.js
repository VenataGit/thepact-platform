// ЕДИНСТВЕНИЯТ източник за производствените стъпки: имена, отмествания и старите
// имена за преходния период. Разбиването на КП, инструментът „Създаване на задачи",
// авто-синхронът на датите, производственият календар и правилата на дъските четат
// оттук — за да не се разминават имената на пет места.
//
// Правилото (Венци, 16.08.2026): заглавието на стъпката започва с ИМЕТО НА КОЛОНАТА,
// а датата в нея значи „докога това трябва да е НАПЪЛНО готово". Due On на картата
// си остава датата за публикуване, но вече НИКОЯ дъска не я следи за срок — всеки
// отдел гледа своята стъпка. Така върнато в Pre-Production видео вече не показва
// датата за публикуване като срок за сценария.
//
// Преходен период: старите имена продължават да се разпознават (legacy), но всичко
// ново се създава с новите. Затова всяка стъпка носи и списък с предишните си имена.

const STEPS = [
  {
    key: 'idea',
    title: 'Pre-Production - Готов сценарий',
    label: 'Дата за сценарий',
    offset: 16,
    board: 'Pre-Production',
    legacy: ['Измисляне на идея'],
  },
  {
    key: 'shoot',
    title: 'Production - Заснет материал',
    label: 'Дата за заснемане',
    offset: 11,
    board: 'Production',
    legacy: ['Видеограф - Насрочване на снимачен ден'],
  },
  {
    key: 'edit',
    title: 'Post-Production - Приключен монтаж',
    label: 'Дата за монтаж',
    offset: 6,
    board: 'Post-Production',
    legacy: ['Монтажист - Приключен монтаж'],
  },
  {
    key: 'upload',
    title: 'Project Management - Качване/Насрочване',
    label: 'Дата за качване',
    offset: 1,
    board: 'Project Management',
    legacy: ['PM - Насрочване/Качване в социални мрежи'],
  },
];

// Стъпката, която контент план задачите получават сама (без заснемане/монтаж/PM —
// за план е достатъчна датата, докога сценарият трябва да е готов).
const PLAN_STEP_KEY = 'idea';

const norm = (s) => String(s || '').trim().toLowerCase();

const byKey = (key) => STEPS.find((s) => s.key === key) || null;

// Всички имена (ново + стари) на една стъпка.
const namesOf = (step) => [step.title, ...(step.legacy || [])];

// Заглавие на стъпка → нейният ключ (или null). Разпознава и старите имена, за да
// продължат да работят живите карти, докато не бъдат преименувани.
function keyOfTitle(title) {
  const t = norm(title);
  if (!t) return null;
  for (const step of STEPS) {
    if (namesOf(step).some((n) => norm(n) === t)) return step.key;
  }
  return null;
}

// Старо заглавие → новото канонично (иначе връща подаденото непроменено).
function canonicalTitle(title) {
  const key = keyOfTitle(title);
  return key ? byKey(key).title : String(title || '').trim();
}

// Префиксите, по които една дъска намира своята стъпка. Първи е новият (основният),
// следват старите — точно както поиска Венци: „основно по новия начин, но нека
// следи и старите". Ключът е нормализирано заглавие на дъската.
//
// Внимание: съвпадението е по НАЧАЛОТО на заглавието, а „Post-Production …" не
// започва с „Production", така че двете дъски не се крадат една друга.
const BOARD_PREFIXES = {
  'pre-production': ['Pre-Production', 'Измисляне'],
  'production': ['Production', 'Видеограф'],
  'post-production': ['Post-Production', 'Монтажист'],
  'project management': ['Project Management', 'PM'],
  'акаунт мениджмънт': ['Project Management', 'PM'],
  'акаунт / project management': ['Project Management', 'PM'],
};

// Нормализиран списък с префикси за дъска (празен, ако дъската няма правило).
function prefixesForBoard(boardTitle) {
  return (BOARD_PREFIXES[norm(boardTitle)] || []).map(norm);
}

// Регулярка, която лови стъпка по ключ — ново И старо име. Ползва се там, където
// вече се търсеше по regex (авто-синхрон, производствен календар).
function titleMatchesKey(title, key) {
  return keyOfTitle(title) === key;
}

module.exports = {
  STEPS,
  PLAN_STEP_KEY,
  byKey,
  namesOf,
  keyOfTitle,
  canonicalTitle,
  titleMatchesKey,
  prefixesForBoard,
  BOARD_PREFIXES,
};
