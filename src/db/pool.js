const { Pool } = require('pg');
const config = require('../config');

const pool = new Pool({ connectionString: config.DATABASE_URL });

pool.on('error', (err) => {
  console.error('[DB] Unexpected error on idle client:', err.message);
});

// Helper: query with params
async function query(text, params) {
  const result = await pool.query(text, params);
  return result.rows;
}

// Helper: single row
async function queryOne(text, params) {
  const rows = await query(text, params);
  return rows[0] || null;
}

// Helper: execute (no return)
async function execute(text, params) {
  await pool.query(text, params);
}

module.exports = { pool, query, queryOne, execute };
