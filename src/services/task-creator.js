// Инструментът „Създаване на задачи" — чистата логика (шаблони + сметки за датите).
// Basecamp заявките живеят в routes/task-creator.js.
//
// Два вида задачи:
//   'plan'   — задача за измисляне: отива в Pre-Production → Измисляне и носи
//              шаблона на контент плана с N видео секции.
//   'single' — единична задача (Production / Post-Production / Project Management…)
//              със стъпките и датите, по които работи цялата система.
//
// Отмесванията на стъпките са СЪЩИТЕ като в kp-split.js и bc-date-sync.js (11/6/1
// работни дни преди датата за публикуване), за да не се разминават двата пътя.
// Могат да се пренастроят от Настройки → Създаване на задачи (settings.task_single_steps).
const { query } = require('../db/pool');
const kpc = require('./kp-create');
const workdays = require('./workdays');

const DEFAULT_STEPS = [
  { key: 'shoot', title: 'Видеограф - Насрочване на снимачен ден', offset: 11 },
  { key: 'edit', title: 'Монтажист - Приключен монтаж', offset: 6 },
  { key: 'upload', title: 'PM - Насрочване/Качване в социални мрежи', offset: 1 },
];

const MAX_VIDEOS_HARD = 60; // таван, който настройка не може да прескочи
const MAX_STEPS = 12;

// Стъпките от настройката: [{title, offset}] → нормализирани, с ключ за фронтенда.
function parseSteps(raw) {
  if (!raw) return DEFAULT_STEPS;
  let arr;
  try { arr = JSON.parse(raw); } catch { return DEFAULT_STEPS; }
  if (!Array.isArray(arr) || !arr.length) return DEFAULT_STEPS;
  const out = [];
  arr.slice(0, MAX_STEPS).forEach((s, i) => {
    const title = String((s && s.title) || '').trim();
    if (!title) return;
    const offset = Math.max(0, parseInt(s.offset, 10) || 0);
    out.push({ key: String(s.key || 's' + (i + 1)), title, offset });
  });
  return out.length ? out : DEFAULT_STEPS;
}

// Всички настройки на инструмента наведнъж. Празна стойност = падаме на КП настройките,
// после на авто-разпознаване по име — така инструментът работи още преди някой да е
// отварял админ панела.
async function loadTaskCfg() {
  const rows = await query(
    `SELECT key, value FROM settings WHERE key IN (
      'task_plan_board_id','task_plan_column_id','task_single_steps','task_max_videos',
      'task_default_videos','kp_bc_board_id','kp_bc_column_id','kp_default_videos'
    )`
  );
  const s = {};
  for (const r of rows) s[r.key] = r.value;

  const tplRows = await query(
    `SELECT key, value FROM app_settings WHERE key IN (
      'task_plan_template','task_plan_video_template','kp_template','kp_video_section_template'
    )`
  );
  const t = {};
  for (const r of tplRows) t[r.key] = r.value;

  const intOr = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
  const maxVideos = Math.min(MAX_VIDEOS_HARD, Math.max(1, intOr(s.task_max_videos, 30)));
  return {
    planBoardId: s.task_plan_board_id || s.kp_bc_board_id || null,
    planColumnId: s.task_plan_column_id || s.kp_bc_column_id || null,
    steps: parseSteps(s.task_single_steps),
    maxVideos,
    defaultVideos: Math.min(maxVideos, Math.max(1, intOr(s.task_default_videos, intOr(s.kp_default_videos, 10)))),
    mainTemplate: t.task_plan_template || t.kp_template || kpc.KP_DEFAULT_TEMPLATE,
    videoTemplate: t.task_plan_video_template || t.kp_video_section_template || kpc.KP_VIDEO_SECTION_TEMPLATE,
    // Кои шаблони реално се ползват — за да покаже админ панелът „наследен от КП".
    ownMainTemplate: !!t.task_plan_template,
    ownVideoTemplate: !!t.task_plan_video_template,
  };
}

// Текстът на задачата за измисляне: шаблонът на контент плана с N видео секции.
// {клиент} се пълни с името на задачата, а датите остават „ХХХ" — тук няма клиентски
// график, човекът ги попълва в самата карта.
function buildPlanText(cfg, title, videoCount) {
  const sections = [];
  for (let i = 1; i <= videoCount; i++) {
    sections.push(String(cfg.videoTemplate).replace(/\{N\}/g, String(i)));
  }
  return String(cfg.mainTemplate)
    .replace(/\{клиент\}|\{client\}/gi, title)
    .replace(/\{номер\}|\{number\}/gi, '')
    .replace(/\{first_publish_date\}/g, 'ХХХ')
    .replace(/\{publish_dates\}/g, '')
    .replace(/\{брой\}|\{count\}/gi, String(videoCount))
    .replace(/\{video_sections\}/g, sections.join('\n\n\n'))
    .trim();
}

const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);

// „Попълни една дата — другите се смятат сами."
// `field` е 'publish' или ключът на стъпка; връща датата за публикуване + дата за
// всяка стъпка. ВЪВЕДЕНАТА дата се връща точно каквато е (обратната сметка през
// работни дни не е огледална, ако човек посочи почивен ден).
function deriveDates(steps, field, date) {
  if (!isDate(date)) throw new Error('Невалидна дата.');
  let publish;
  if (field === 'publish') {
    publish = date;
  } else {
    const st = steps.find((s) => s.key === field);
    if (!st) throw new Error('Непознато поле за дата.');
    publish = st.offset > 0 ? workdays.addWorkingDays(date, st.offset) : date;
  }
  const out = { publish, steps: {} };
  steps.forEach((s) => {
    out.steps[s.key] = s.offset > 0 ? workdays.subtractWorkingDays(publish, s.offset) : publish;
  });
  if (field !== 'publish') out.steps[field] = date;
  return out;
}

module.exports = {
  DEFAULT_STEPS,
  MAX_VIDEOS_HARD,
  parseSteps,
  loadTaskCfg,
  buildPlanText,
  deriveDates,
  isDate,
};
