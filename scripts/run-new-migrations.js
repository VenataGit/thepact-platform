#!/usr/bin/env node
// Run only NEW database migrations that haven't been applied yet.
// Usage: node scripts/run-new-migrations.js
//
// Reads all SQL files in db/migrations/, checks schema_migrations table,
// and applies only those not yet recorded. Each applied migration is
// logged in schema_migrations so it won't run again.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    // 1. Ensure schema_migrations table exists (migration 009 creates it,
    //    but we bootstrap it here so the tracker itself can be tracked)
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // 2. Get already-applied migrations
    const { rows } = await client.query('SELECT version FROM schema_migrations');
    const applied = new Set(rows.map(r => r.version));

    // 3. Read and sort migration files
    const files = fs.readdirSync(MIGRATIONS_DIR)
      .filter(f => f.endsWith('.sql'))
      .sort(); // lexicographic sort keeps 001_, 002_, ... in order

    const pending = files.filter(f => !applied.has(f));

    if (pending.length === 0) {
      console.log('All migrations already applied. Nothing to do.');
      return;
    }

    console.log(`Found ${pending.length} new migration(s) to apply:\n`);

    // 4. Apply each pending migration inside a transaction
    for (const file of pending) {
      const filePath = path.join(MIGRATIONS_DIR, file);
      const sql = fs.readFileSync(filePath, 'utf8');

      console.log(`  Applying ${file} ...`);
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
          [file]
        );
        await client.query('COMMIT');
        console.log(`  ✓ ${file} applied.`);
      } catch (err) {
        await client.query('ROLLBACK');
        console.error(`  ✗ ${file} FAILED: ${err.message}`);
        console.error('Stopping. Fix the error and re-run.');
        process.exit(1);
      }
    }

    console.log(`\nDone — ${pending.length} migration(s) applied successfully.`);
  } catch (err) {
    console.error('Migration runner error:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
})();
