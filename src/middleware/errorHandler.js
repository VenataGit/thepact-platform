const errors = [];
const MAX_ERRORS = 200;

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
}

function getErrors(limit = 50) { return errors.slice(0, limit); }
function getErrorCount() { return errors.length; }

function errorHandler(err, req, res, next) {
  trackError('express', err, { url: req.originalUrl, method: req.method });
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { trackError, getErrors, getErrorCount, errorHandler };
