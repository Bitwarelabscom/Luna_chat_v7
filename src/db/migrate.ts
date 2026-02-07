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
    // If src/db/migrations doesn't exist (prod), check dist/db/migrations or just rely on the host mapping if volumes used
    // However, the Dockerfile doesn't copy src to prod runner, it only copies dist.
    // Let's make it robust.
    let finalMigrationsDir = migrationsDir;
    if (!fs.existsSync(finalMigrationsDir)) {
      finalMigrationsDir = path.join(process.cwd(), 'dist', 'db', 'migrations');
    }
    
    // In our case, the .sql files are in src/db/migrations on the host.
    // If the container doesn't have src/, we need to make sure migrations are available.
    
    const files = fs.readdirSync(finalMigrationsDir)
      .filter(f => f.endsWith('.sql'))
      .sort();

    // Release the initial connection so each migration can manage its own client/transaction
    client.release();

    for (const file of files) {
      if (!executedNames.has(file)) {
        console.log(`Executing migration: ${file}`);
        const content = fs.readFileSync(path.join(finalMigrationsDir, file), 'utf-8');
        
        const migrationClient = await pool.connect();
        try {
            await migrationClient.query('BEGIN');
            await migrationClient.query(content);
            await migrationClient.query('INSERT INTO migrations (name) VALUES ($1)', [file]);
            await migrationClient.query('COMMIT');
            console.log(`Migration ${file} completed successfully`);
        } catch (e) {
            await migrationClient.query('ROLLBACK');
            console.error(`Error executing migration ${file}, skipping:`, (e as Error).message);
        } finally {
            migrationClient.release();
        }
      }
    }

    console.log('Migration process finished');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

migrate();
