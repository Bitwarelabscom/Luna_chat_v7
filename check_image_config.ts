import { pool } from './src/db/index.js';
import dotenv from 'dotenv';
dotenv.config();

async function checkConfig() {
  try {
    const userId = '727e0045-3858-4e42-b81e-4d48d980a59d';
    const taskType = 'image_generation';
    
    console.log(`Checking config for user ${userId}, task ${taskType}...`);
    
    const res = await pool.query(
      `SELECT provider, model, updated_at FROM user_model_config 
       WHERE user_id = $1 AND task_type = $2`,
      [userId, taskType]
    );

    if (res.rows.length > 0) {
      console.log('Found custom config:');
      console.log(JSON.stringify(res.rows[0], null, 2));
    } else {
      console.log('No custom config found in database. Defaults apply.');
    }
  } catch (err) {
    console.error('Error querying database:', err);
  } finally {
    await pool.end();
  }
}

checkConfig();
