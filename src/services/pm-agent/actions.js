// PM Agent — изпълнение на одобрени предложения (Фаза 3).
//
// Агентът само ПРЕДЛАГА (agent_proposals, status pending). Венци одобрява в
// чата → тук предложението се изпълнява в Basecamp като ThePactAlerts бота.
// Твърдо правило: всичко е САМО във Video Production проекта — клиентските
// проекти са недостъпни за писане (Фаза 5, отделно решение).
const config = require('../../config');
const { queryOne, execute } = require('../../db/pool');
const bc = require('../basecamp');
const { getServiceAuth } = require('../basecamp-token');
const agg = require('../bc-aggregate');
const { resolveReportDestination, resolveSubscriberIds } = require('./audit');

// Обикновен текст → безопасен Basecamp HTML (esc + нови редове).
function textToHtml(text) {
  const esc = String(text || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<div>${esc.replace(/\n/g, '<br>')}</div>`;
}

// Проверка, че recording-ът (карта/съобщение) е във Video Production.
async function assertTeamRecording(recordingId) {
  const teamId = String(config.BASECAMP_TEAM_PROJECT_ID);
  const card = await queryOne('SELECT project_id FROM bc_cards_snap WHERE card_id = $1', [recordingId]);
  if (card) {
    if (String(card.project_id) !== teamId) throw new Error('Извън Video Production — забранено (Фаза 5).');
    return;
  }
  const msg = await queryOne('SELECT project_id FROM bc_messages_snap WHERE message_id = $1', [recordingId]);
  if (msg) {
    if (String(msg.project_id) !== teamId) throw new Error('Извън Video Production — забранено (Фаза 5).');
    return;
  }
  throw new Error('Не намирам този recording в снапшота — не мога да проверя проекта му.');
}

async function executeKind(kind, payload, auth) {
  const teamId = config.BASECAMP_TEAM_PROJECT_ID;
  switch (kind) {
    case 'create_card': {
      if (!payload.column_id || !payload.title) throw new Error('create_card иска column_id и title.');
      const card = await bc.createCard(auth.token, auth.account, teamId, payload.column_id, {
        title: payload.title,
        content: payload.content ? textToHtml(payload.content) : undefined,
        due_on: payload.due_on || undefined,
      });
      if (payload.board_id) agg.invalidateBoard(payload.board_id);
      return { url: card.app_url, id: card.id };
    }
    case 'create_step': {
      if (!payload.card_id || !payload.title) throw new Error('create_step иска card_id и title.');
      await assertTeamRecording(payload.card_id);
      const step = await bc.createStep(auth.token, auth.account, teamId, payload.card_id, {
        title: payload.title, due_on: payload.due_on || undefined,
      });
      return { id: step.id };
    }
    case 'add_comment': {
      if (!payload.recording_id || !payload.content) throw new Error('add_comment иска recording_id и content.');
      await assertTeamRecording(payload.recording_id);
      const comment = await bc.createComment(auth.token, auth.account, teamId, payload.recording_id, textToHtml(payload.content));
      return { url: comment.app_url, id: comment.id };
    }
    case 'post_message': {
      if (!payload.subject || !payload.content) throw new Error('post_message иска subject и content.');
      const dest = await resolveReportDestination(); // VP message board
      const subs = await resolveSubscriberIds(auth);
      const message = await bc.createMessage(auth.token, auth.account, dest.projectId, dest.boardId, {
        subject: payload.subject, content: textToHtml(payload.content), subscriptions: subs,
      });
      return { url: message.app_url, id: message.id };
    }
    case 'move_card': {
      if (!payload.card_id || !payload.board_id || !payload.column_id) throw new Error('move_card иска card_id, board_id и column_id.');
      await assertTeamRecording(payload.card_id);
      await bc.moveCard(auth.token, auth.account, teamId, payload.board_id, payload.card_id, payload.column_id, payload.position || 0);
      agg.invalidateBoard(payload.board_id);
      return { moved: true };
    }
    default:
      throw new Error(`Непознат вид действие: ${kind}`);
  }
}

// Одобрение → изпълнение. Връща обновеното предложение.
async function approveProposal(id) {
  const p = await queryOne("SELECT * FROM agent_proposals WHERE id = $1 AND status = 'pending'", [id]);
  if (!p) throw new Error('Няма такова чакащо предложение.');
  await execute("UPDATE agent_proposals SET status = 'approved', decided_at = NOW() WHERE id = $1", [id]);
  try {
    const auth = await getServiceAuth(); // действаме като ThePactAlerts
    const payload = p.payload || {};
    const result = await executeKind(p.kind, payload, auth);
    await execute("UPDATE agent_proposals SET status = 'done', result = $2 WHERE id = $1",
      [id, JSON.stringify(result)]);
    return { ...p, status: 'done', result };
  } catch (err) {
    await execute("UPDATE agent_proposals SET status = 'error', result = $2 WHERE id = $1",
      [id, JSON.stringify({ error: err.message })]).catch(() => {});
    throw err;
  }
}

async function rejectProposal(id) {
  const p = await queryOne("SELECT * FROM agent_proposals WHERE id = $1 AND status = 'pending'", [id]);
  if (!p) throw new Error('Няма такова чакащо предложение.');
  await execute("UPDATE agent_proposals SET status = 'rejected', decided_at = NOW() WHERE id = $1", [id]);
  return { ...p, status: 'rejected' };
}

module.exports = { approveProposal, rejectProposal };
