/* eslint-disable no-console */
import fs from 'fs';
import path from 'path';
import { pool } from './postgres.js';

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Create migrations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        executed_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);

    // Get executed migrations
    const { rows: executed } = await client.query('SELECT name FROM migrations');
    const executedNames = new Set(executed.map(row => row.name));

    // Get migration files
    const migrationsDir = path.join(process.cwd(), 'src', 'db', 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      if (!executedNames.has(file)) {
        console.log(`Executing migration: ${file}`);
        const content = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
        try {
            await client.query(content);
            await client.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
        } catch (e) {
            console.error(`Error executing migration ${file}:`, e);
            throw e;
        }
      }
    }

    await client.query('COMMIT');
    console.log('Migrations completed successfully');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
