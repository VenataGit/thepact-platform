#!/usr/bin/env node
require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  try {
    await pool.query(`
      ALTER TABLE cards
        ADD COLUMN IF NOT EXISTS brainstorm_date DATE,
        ADD COLUMN IF NOT EXISTS filming_date    DATE,
        ADD COLUMN IF NOT EXISTS editing_date    DATE,
        ADD COLUMN IF NOT EXISTS upload_date     DATE
    `);
    console.log('cards columns OK');

    await pool.query(`
      CREATE TABLE IF NOT EXISTS card_date_changes (
        id              SERIAL PRIMARY KEY,
        card_id         INTEGER NOT NULL REFERENCES cards(id) ON DELETE CASCADE,
        field_name      TEXT NOT NULL,
        old_value       DATE,
        new_value       DATE,
        changed_by      INTEGER REFERENCES users(id),
        changed_by_name TEXT,
        changed_at      TIMESTAMPTZ DEFAULT NOW()
      )
    `);
    console.log('card_date_changes table OK');

    await pool.query('CREATE INDEX IF NOT EXISTS idx_card_date_changes_card ON card_date_changes(card_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_card_date_changes_at ON card_date_changes(changed_at)');
    console.log('indexes OK');
    console.log('DONE');
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
})();
