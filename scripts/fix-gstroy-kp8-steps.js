#!/usr/bin/env node
// Еднократно осъвременяване на стъпките по GStroy КП-8 във „Video Production".
//
// Венци (20.08.2026): *„минеш през всички задачи във Video Production, които са на
// GStroy КП-8 и да ъпдейтнеш датите и събтасковете… сега е сложена датата за
// публикуване както трябва да бъде горе в Due On и от нея да съобразиш правилните
// дати в събтасковете. Като искаш също така да махнеш старите събтаскове и да
// добавиш само новите които слагаме."*
//
// Картите носеха стария 15-стъпков чеклист („Видеограф - …", „Монтажист - …",
// „PM - …") с дати, разминали се с Due On (при „Видео 8" монтажът беше 5 дни СЛЕД
// публикуването). Скриптът ги заменя с четирите стъпки от services/steps.js,
// сметнати назад от Due On през работни дни + БГ празници (16/11/6/1).
//
// Правила:
//   * пипа САМО карти „GStroy КП-8 - Видео N - …", които НЕ са завършени и не стоят
//     в колона Done — приключилите карти са история и не се пренаписват;
//   * „Приоритет" и „Фиксиран ден" НЕ се пипат — те са флагове за дъската
//     (виж bc-aggregate.js), а не част от чеклиста;
//   * отметките се пренасят: старо чекнато квадратче доказва, че етапът е минал, и
//     важи монотонно (минал ли е по-късен етап, минали са и по-ранните);
//   * НЕ е идемпотентен по отношение на отметките — доказателството идва от старите
//     стъпки, затова вече оправена карта се прескача (guard).
//
// Капани, проверени на живо срещу Basecamp:
//   * триене на стъпка = PUT /buckets/{p}/recordings/{id}/status/trashed.json;
//   * отмятане НЕ е .../card_tables/steps/{id}/completion.json (404). Вярното е
//     PUT <completion_url> (стъпката си го носи) с тяло {"completion":"on"} —
//     POST дава 404, а PUT без тяло връща 200 БЕЗ да отмята;
//   * `\b` в JS regex не хваща кирилица, затова старите стъпки се разпознават по
//     тирето след името на отдела, не по граница на дума.
//
// Употреба (от /opt/thepact-platform на VPS-а):
//   node scripts/fix-gstroy-kp8-steps.js                 # само показва какво би направил
//   DRY=0 node scripts/fix-gstroy-kp8-steps.js           # записва
//   DRY=0 ONLY=<cardId>[,<cardId>] node scripts/…        # само посочените карти
require('dotenv').config();
const config = require('../src/config');
const bc = require('../src/services/basecamp');
const { getServiceAuth } = require('../src/services/basecamp-token');
const { subtractWorkingDays } = require('../src/services/workdays');
const prodSteps = require('../src/services/steps');

const DRY = process.env.DRY !== '0';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

const OLD_RE = /^\s*(Видеограф|Монтажист|PM|Измисляне)\s*[-–—]/i;
const norm = (s) => String(s || '').trim().toLowerCase();
const isCanonical = (t) => prodSteps.STEPS.some((s) => norm(s.title) === norm(t));
const isOld = (t) => OLD_RE.test(t || '') || prodSteps.keyOfTitle(t) !== null;

// Кое старо отметнато квадратче доказва, че даден нов етап е минал.
const DONE_PROOF = {
  idea: ['Измисляне на идея'],
  shoot: ['Видеограф - Приключен запис', 'Видеограф - Насрочване на снимачен ден'],
  edit: ['Монтажист - Приключен монтаж'],
  upload: ['PM - Насрочване/Качване в социални мрежи'],
};

function headers(token, json) {
  const h = { Authorization: `Bearer ${token}`, 'User-Agent': config.BASECAMP_USER_AGENT, Accept: 'application/json' };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

async function trashStep(token, projectId, stepId) {
  const r = await fetch(
    `${bc.API_BASE}/${config.BASECAMP_ACCOUNT_ID}/buckets/${projectId}/recordings/${stepId}/status/trashed.json`,
    { method: 'PUT', headers: headers(token, false) }
  );
  return r.ok ? null : r.status;
}

async function completeStep(token, completionUrl) {
  const r = await fetch(bc.API_BASE + completionUrl, {
    method: 'PUT', headers: headers(token, true), body: JSON.stringify({ completion: 'on' }),
  });
  return r.ok ? null : r.status;
}

async function main() {
  const { token, account } = await getServiceAuth();
  const projectId = config.BASECAMP_TEAM_PROJECT_ID;
  const project = await bc.getProject(token, account, projectId);
  const tools = (project.dock || []).filter((t) => t.enabled && /kanban|card/i.test(t.name));

  const targets = [];
  for (const t of tools) {
    const table = (await bc.authedGet(t.url, token)).json;
    for (const l of (table.lists || [])) {
      for (const c of await bc.getColumnCards(token, account, projectId, l.id)) {
        if (!/^GStroy\s+КП-8\s*-\s*Видео\s+\d+/i.test(c.title || '')) continue;
        if (c.completed || /^done$/i.test(l.title || '')) continue;
        targets.push({ ...c, board: t.title || table.title, column: l.title });
      }
    }
  }

  for (const card of targets) {
    if (ONLY.length && !ONLY.includes(String(card.id))) continue;
    console.log('\n=== ' + card.title + '  [' + card.board + ' / ' + card.column + ']  id=' + card.id);
    if (!card.due_on) { console.log('  !! няма Due On — пропускам'); continue; }
    const steps = card.steps || [];

    const legacy = steps.filter((s) => isOld(s.title) && !isCanonical(s.title));
    if (!legacy.length && prodSteps.STEPS.every((s) => steps.some((x) => norm(x.title) === norm(s.title)))) {
      console.log('  вече е с новите стъпки — прескачам.');
      continue;
    }

    const proven = prodSteps.STEPS.map((s) => steps.some((old) =>
      old.completed && (DONE_PROOF[s.key] || []).some((p) => norm(p) === norm(old.title))));
    for (let i = proven.length - 1; i >= 0; i--) if (proven[i]) for (let j = 0; j < i; j++) proven[j] = true;

    const doomed = steps.filter((s) => isOld(s.title));
    console.log('  Due On (публикуване): ' + card.due_on);
    console.log('  махам ' + doomed.length + ' стари | оставям: '
      + (steps.filter((s) => !isOld(s.title)).map((s) => s.title).join(', ') || '—'));
    prodSteps.STEPS.forEach((s, i) => {
      console.log('  + ' + s.title + ' → ' + subtractWorkingDays(card.due_on, s.offset) + (proven[i] ? '  [отметната]' : ''));
    });
    if (DRY) continue;

    for (const s of doomed) {
      const err = await trashStep(token, projectId, s.id);
      if (err) console.log('  !! trash fail ' + s.id + ' ' + err);
    }
    for (let i = 0; i < prodSteps.STEPS.length; i++) {
      const s = prodSteps.STEPS[i];
      const created = await bc.createStep(token, account, projectId, card.id, {
        title: s.title, due_on: subtractWorkingDays(card.due_on, s.offset),
      });
      if (proven[i]) {
        const err = await completeStep(token, created.completion_url);
        if (err) console.log('  !! complete fail ' + created.id + ' ' + err);
      }
    }
    console.log('  готово.');
  }
}

main().catch((e) => { console.error('ERR', e.message); process.exit(1); });
