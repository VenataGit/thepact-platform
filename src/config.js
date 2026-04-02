require('dotenv').config();

module.exports = {
  PORT: parseInt(process.env.PORT) || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development',
  IS_PRODUCTION: process.env.NODE_ENV === 'production',
  DATABASE_URL: process.env.DATABASE_URL || 'postgresql://thepact:thepact@localhost:5432/thepact',
  JWT_SECRET: process.env.JWT_SECRET || 'dev-secret-change-in-production',
  JWT_EXPIRES_IN: '7d',
  BCRYPT_ROUNDS: parseInt(process.env.BCRYPT_ROUNDS) || 12,
  BOARD_ORDER: ['Pre-Production', 'Production', 'Post-Production', 'Акаунт Мениджмънт', 'Задачи'],
  DEPLOY_SECRET: process.env.DEPLOY_SECRET || null,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY || null,
  // Email (optional)
  SMTP_HOST: process.env.SMTP_HOST || null,
  SMTP_PORT: parseInt(process.env.SMTP_PORT) || 587,
  SMTP_USER: process.env.SMTP_USER || null,
  SMTP_PASS: process.env.SMTP_PASS || null,
  SMTP_FROM: process.env.SMTP_FROM || null,
};
