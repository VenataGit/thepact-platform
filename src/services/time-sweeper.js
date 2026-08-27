// Затваря "осиротели" таймери — записи без heartbeat от 5+ минути (затворен
// таб, забил браузър, спрял лаптоп). Времето се реже до последния получен пулс,
// така че отчетът никога не съдържа фантомни часове. Крайният гарант на модела.
//
// 5 минути, а не 2,5: пулсът идва от chrome.alarms, а Chrome го разтяга, когато
// прозорецът е скрит или машината пести батерия. При по-къс праг таймерът се
// затваряше, докато човек работи в друг прозорец. Отчетеното време не страда —
// то и без това се реже до последния пулс.
const { query } = require('../db/pool');
const { broadcast } = require('../ws/broadcast');

const STALE_AFTER = '300 seconds';
const SWEEP_EVERY_MS = 60 * 1000;

async function sweepStaleTimers() {
  try {
    const closed = await query(
      `UPDATE time_entries
          SET ended_at = GREATEST(last_beat, started_at),
              duration_seconds = GREATEST(0, EXTRACT(EPOCH FROM (GREATEST(last_beat, started_at) - started_at)))::int,
              stopped_by = 'sweeper'
        WHERE ended_at IS NULL AND last_beat < NOW() - INTERVAL '${STALE_AFTER}'
        RETURNING id, user_id, bc_recording_id`
    );
    for (const e of closed) {
      broadcast({
        type: 'time:working:stop',
        entryId: e.id,
        userId: e.user_id,
        bcRecordingId: e.bc_recording_id ? String(e.bc_recording_id) : null
      });
    }
    if (closed.length) console.log(`[time-sweeper] closed ${closed.length} stale timer(s)`);
  } catch (err) {
    console.error('[time-sweeper]', err.message);
  }
}

function initTimeSweeper() {
  sweepStaleTimers();
  setInterval(sweepStaleTimers, SWEEP_EVERY_MS);
  console.log('  Time sweeper ready (stale timers close at last heartbeat)');
}

module.exports = { initTimeSweeper };
