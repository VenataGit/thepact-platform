require('dotenv').config();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

// Hard-fail if production is missing JWT_SECRET — prevents accidentally deploying with the
// well-known dev fallback (which would let anyone forge tokens).
if (IS_PRODUCTION && !process.env.JWT_SECRET) {
  // eslint-disable-next-line no-console
  console.error('[FATAL] JWT_SECRET environment variable is required in production. Aborting startup.');
  process.exit(1);
}

module.exports = {
  PORT: parseInt(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION,
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://thepact:thepact@localhost:5432/thepact',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  JWT_EXPIRES_IN: '7d',
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  BOARD_ORDER: ['Pre-Production', 'Production', 'Post-Production', 'Акаунт Мениджмънт', 'Задачи'],
  DEPLOY_SECRET: process.env.DEPLOY_SECRET || null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
  // Basecamp OAuth ("Connect with Basecamp" login)
  BASECAMP_CLIENT_ID: process.env.BASECAMP_CLIENT_ID || null,
  BASECAMP_CLIENT_SECRET: process.env.BASECAMP_CLIENT_SECRET || null,
  BASECAMP_REDIRECT_URI: process.env.BASECAMP_REDIRECT_URI || 'https://thepact.pro/auth/basecamp/callback',
  BASECAMP_USER_AGENT: process.env.BASECAMP_USER_AGENT || 'The Pact Platform (kalchev@thepact.bg)',
  // The ThePactAlerts bot — only this Basecamp identity may be stored as the service token.
  BASECAMP_SERVICE_EMAIL: (process.env.BASECAMP_SERVICE_EMAIL || 'automation@thepact.bg').toLowerCase(),
  // Login is granted to any member of this Basecamp project (Video Production) OR any
  // non-client (internal The Pact team) — checked live against Basecamp on each login.
  BASECAMP_TEAM_PROJECT_ID: parseInt(process.env.BASECAMP_TEAM_PROJECT_ID) || 39396506,
  // Secret embedded in the Basecamp webhook URL path — only Basecamp (told the URL) can POST.
  BASECAMP_WEBHOOK_SECRET: process.env.BASECAMP_WEBHOOK_SECRET || null,
  // Card ids the date-sync is ALLOWED to modify. Empty = all cards with a Due date.
  // Keep this set to ONLY the test card during testing so nothing else is ever touched.
  BASECAMP_DATESYNC_CARD_IDS: (process.env.BASECAMP_DATESYNC_CARD_IDS || '').split(',').map((s) => s.trim()).filter(Boolean),
  // Password login is OFF by default — Basecamp OAuth only. Emergency hatch: set 'true'.
  ALLOW_PASSWORD_LOGIN: process.env.ALLOW_PASSWORD_LOGIN === 'true',
  // Web Push (optional — generate keys with: node scripts/generate-vapid-keys.js)
  VAPID_PUBLIC_KEY: process.env.VAPID_PUBLIC_KEY || null,
  VAPID_PRIVATE_KEY: process.env.VAPID_PRIVATE_KEY || null,
  VAPID_EMAIL: process.env.VAPID_EMAIL || 'mailto:admin@thepact.pro',
  // Email (optional)
  SMTP_HOST: process.env.SMTP_HOST || null,
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || null,
  SMTP_PASS: process.env.SMTP_PASS || null,
  SMTP_FROM: process.env.SMTP_FROM || null,
};
