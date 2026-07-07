// PM Agent — Claude API helper (raw https, като routes/transcribe.js — без SDK).
// Opus 4.8 с adaptive thinking + effort high; дълъг timeout за големи анализи.
const https = require('https');
const config = require('../../config');

const MODEL = process.env.PM_AGENT_MODEL || 'claude-opus-4-8';
const TIMEOUT_MS = 600_000; // дълбок анализ с thinking може да отнеме минути

// Извиква /v1/messages и връща { text, usage, model, stopReason }.
function callClaude({ system, messages, maxTokens = 12000, effort = 'high' }) {
  return new Promise((resolve, reject) => {
    if (!config.ANTHROPIC_API_KEY) {
      return reject(new Error('ANTHROPIC_API_KEY не е конфигуриран.'));
    }
    const payload = JSON.stringify({
      model: MODEL,
      max_tokens: maxTokens,
      system,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort },
    });
    const req = https.request({
      host: 'api.anthropic.com',
      port: 443,
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        'x-api-key': config.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      timeout: TIMEOUT_MS,
    }, (resp) => {
      let body = '';
      resp.setEncoding('utf8');
      resp.on('data', (c) => { body += c; });
      resp.on('end', () => {
        let parsed;
        try { parsed = JSON.parse(body); } catch {
          return reject(new Error(`Claude API: невалиден отговор (${resp.statusCode}): ${body.slice(0, 200)}`));
        }
        if (resp.statusCode !== 200) {
          return reject(new Error(`Claude API ${resp.statusCode}: ${(parsed.error && parsed.error.message) || body.slice(0, 300)}`));
        }
        if (parsed.stop_reason === 'refusal') {
          return reject(new Error('Claude API: заявката беше отказана (refusal).'));
        }
        const text = (parsed.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
        resolve({
          text,
          usage: parsed.usage || {},
          model: parsed.model,
          stopReason: parsed.stop_reason,
        });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Claude API: timeout.')); });
    req.on('error', (e) => reject(e));
    req.write(payload);
    req.end();
  });
}

module.exports = { callClaude, MODEL };
