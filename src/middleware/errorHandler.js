const errors = [];
const MAX_ERRORS = 200;
// Освен в паметта, грешките отиват и в базата (app_errors) — system-watch закача sink-а при старт.
let sink = null;
function setErrorSink(fn) { sink = fn; }

function trackError(source, error, extra = {}) {
  const entry = {
    timestamp: new Date().toISOString(),
    source,
    message: error?.message || String(error),
    stack: error?.stack?.split('\n').slice(0, 5).join('\n'),
    ...extra
  };
  errors.unshift(entry);
  if (errors.length > MAX_ERRORS) errors.length = MAX_ERRORS;
  console.error(`[${entry.source}] ${entry.message}`);
  if (sink) { try { sink(entry.source, entry.message, entry.stack); } catch { /* никога не чупи */ } }
}

function getErrors(limit = 50) { return errors.slice(0, limit); }
function getErrorCount() { return errors.length; }

function errorHandler(err, req, res, next) {
  trackError('express', err, { url: req.originalUrl, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { trackError, getErrors, getErrorCount, errorHandler, setErrorSink };
