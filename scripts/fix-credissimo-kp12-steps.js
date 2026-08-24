#!/usr/bin/env node
// Еднократно осъвременяване на стъпките по десет карти във „Video Production", които
// още носят стария чеклист.
//
// Венци (24.08.2026): *„Има няколко задачи, които са със стари subtask-ове и искам да
// минеш през тях и да ги оправиш на новите, като също така трябва да съобразиш датите
// и да ги сложиш. Гледаш си датата за публикуване от Due on и от нея си смяташ какви
// дати трябва да сложиш на subtask-овете."*
//
// Същата операция като scripts/fix-gstroy-kp8-steps.js, но там картите се намираха по
// заглавие (цял КП), а тук Венци даде десет конкретни линка — затова списъкът е от ID-та.
// Картите са Credissimo КП-12 „Видео 2…10" плюс ЕКОПАК КП-5 „Видео 10".
//
// Какво заварваме: трите стари стъпки („Видеограф - Насрочване на снимачен ден",
// „Монтажист - Приключен монтаж", „PM - Насрочване/Качване в социални мрежи") — без
// идейната стъпка. Датите по тях случайно вече отговарят на отместванията 11/6/1, но
// имената са старите и Pre-Production изобщо липсва, тоест дъската няма своя срок за
// сценарий. Скриптът ги заменя с четирите стъпки от services/steps.js, сметнати назад
// от Due On през работни дни + БГ празници (16/11/6/1).
//
// Правила (както при GStroy КП-8):
//   * пипа само незавършени карти извън колона Done — приключилите са история;
//   * „Приоритет" и „Фиксиран ден" не се пипат — те са флагове за дъската
//     (виж bc-aggregate.js), а не част от чеклиста;
//   * отметките се пренасят: старо чекнато квадратче доказва, че етапът е минал, и
//     важи монотонно (минал ли е по-късен етап, минали са и по-ранните);
//   * НЕ е идемпотентен по отношение на отметките — доказателството идва от старите
//     стъпки, затова вече оправена карта се прескача (guard).
//
// Капани, проверени на живо срещу Basecamp (пренесени от предишния скрипт):
//   * триене на стъпка = PUT /buckets/{p}/recordings/{id}/status/trashed.json;
//   * отмятане НЕ е .../card_tables/steps/{id}/completion.json (404). Вярното е
//     PUT <completion_url> (стъпката си го носи) с тяло {"completion":"on"} —
//     POST дава 404, а PUT без тяло връща 200 БЕЗ да отмята;
//   * `\b` в JS regex не хваща кирилица, затова старите стъпки се разпознават по
//     тирето след името на отдела, не по граница на дума.
//
// Употреба (от /opt/thepact-platform на VPS-а):
//   node scripts/fix-credissimo-kp12-steps.js                 # само показва какво би направил
//   DRY=0 node scripts/fix-credissimo-kp12-steps.js           # записва
//   DRY=0 ONLY=<cardId>[,<cardId>] node scripts/…             # само посочените карти
require('dotenv').config();
const config = require('../src/config');
const bc = require('../src/services/basecamp');
const { getServiceAuth } = require('../src/services/basecamp-token');
const { subtractWorkingDays } = require('../src/services/workdays');
const prodSteps = require('../src/services/steps');

const DRY = process.env.DRY !== '0';
const ONLY = (process.env.ONLY || '').split(',').map((s) => s.trim()).filter(Boolean);

// Десетте карти от списъка на Венци, в неговия ред.
const CARD_IDS = [
  10203458084, // Credissimo КП-12 - Видео 2 - Ако можеше да прекараш 24 часа
  10203458108, // Credissimo КП-12 - Видео 3 - Покупка за която съжаляваш
  10203458139, // Credissimo КП-12 - Видео 4 - Без социални мрежи
  10203458171, // Credissimo КП-12 - Видео 5 - Интервю
  10203458214, // Credissimo КП-12 - Видео 6 - Познай числото
  10203458241, // Credissimo КП-12 - Видео 7 - Кой ще се засмее
  10203458310, // Credissimo КП-12 - Видео 8 - Волейбол анкета
  10203458356, // Credissimo КП-12 - Видео 9 - 5 секунди
  10203458400, // Credissimo КП-12 - Видео 10 - Нарисувай бързо
  10226627810, // ЕКОПАК КП-5 - Видео 10 - Кой отпадък съм аз?
];

const OLD_RE = /^\s*(Видеограф|Монтажист|PM|Измисляне|Контент\s+Криейтър)\s*[-–—]/i;
const norm = (s) => String(s || '').trim().toLowerCase();
const isCanonical = (t) => prodSteps.STEPS.some((s) => norm(s.title) === norm(t));
const isOld = (t) => OLD_RE.test(t || '') || prodSteps.keyOfTitle(t) !== null;

// Кое старо отметнато квадратче доказва, че даден нов етап е минал.
const DONE_PROOF = {
  idea: ['Измисляне на идея', 'Контент Криейтър - Измисляне'],
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

  for (const id of CARD_IDS) {
    if (ONLY.length && !ONLY.includes(String(id))) continue;

    let card;
    try {
      card = await bc.getCard(token, account, projectId, id);
    } catch (e) {
      console.log('\n=== ' + id + '  !! не се чете: ' + e.message);
      continue;
    }

    const column = (card.parent && card.parent.title) || '';
    console.log('\n=== ' + card.title + '  [' + column + ']  id=' + card.id);

    if (card.completed || /^done$/i.test(column)) { console.log('  завършена/в Done — не я пипам.'); continue; }
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
