#!/usr/bin/env node
// Run database migrations: node scripts/migrate.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    console.log('Running schema...');
    const schema = fs.readFileSync(path.join(__dirname, '..', 'db', 'schema.sql'), 'utf8');
    await pool.query(schema);
    console.log('Schema applied.');

    console.log('Running seed...');
    const seed = fs.readFileSync(path.join(__dirname, '..', 'db', 'seed.sql'), 'utf8');
    await pool.query(seed);
    console.log('Seed applied.');

    console.log('Done!');
  } catch (err) {
    console.error('Migration error:', err.message);
  } finally {
    await pool.end();
  }
})();
