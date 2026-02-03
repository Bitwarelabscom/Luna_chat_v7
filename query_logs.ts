import { pool } from './src/db/index.js';

async function checkLogs() {
  try {
    console.log('Checking turn_llm_calls for Ollama usage...');
    const layeredLogs = await pool.query(`
      SELECT provider, model, duration_ms, created_at 
      FROM turn_llm_calls 
      WHERE provider = 'ollama' 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    if (layeredLogs.rows.length > 0) {
      console.log('Found Layered Agent logs:', layeredLogs.rows);
    } else {
      console.log('No Layered Agent logs found for Ollama.');
    }

    console.log('\nChecking messages table for columns...');
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'messages'
    `);
    console.log('Messages table columns:', columns.rows.map(r => r.column_name).join(', '));

  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await pool.end();
  }
}

checkLogs();
