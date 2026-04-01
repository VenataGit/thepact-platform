#!/usr/bin/env node
// Create admin user: node scripts/create-admin.js <email> <name> <password>
require('dotenv').config();
const bcrypt = require('bcrypt');
const { Pool } = require('pg');

const [,, email, name, password] = process.argv;

if (!email || !name || !password) {
  console.log('Usage: node scripts/create-admin.js <email> <name> <password>');
  console.log('Example: node scripts/create-admin.js ventsi@thepact.bg "Ventsislav Kalchev" mypassword');
  process.exit(1);
}

(async () => {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const hash = await bcrypt.hash(password, 12);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, name, role) VALUES ($1, $2, $3, 'admin')
       ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, role = 'admin'
       RETURNING id, email, name, role`,
      [email.toLowerCase().trim(), hash, name]
    );
    console.log('Admin created:', result.rows[0]);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await pool.end();
  }
})();
