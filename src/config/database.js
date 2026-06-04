// src/config/database.js

require('dotenv').config();

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL no encontrada');
  process.exit(1);
}

console.log('📡 Iniciando conexión a Supabase...');

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('connect', () => {
  console.log('✅ Nueva conexión establecida');
});

pool.on('error', (err) => {
  console.error('❌ Error inesperado en PostgreSQL:', err);
});

async function testConnection() {
  try {
    const client = await pool.connect();

    const result = await client.query(`
      SELECT
        current_database(),
        current_user,
        NOW()
    `);

    console.log('✅ Conexión a Supabase exitosa');
    console.log(result.rows[0]);

    client.release();
  } catch (error) {
    console.error('❌ Error conectando a Supabase');
    console.error(error.message);
  }
}

testConnection();

module.exports = {
  pool,

  query: async (text, params) => {
    return pool.query(text, params);
  },

  getClient: async () => {
    return pool.connect();
  },
};