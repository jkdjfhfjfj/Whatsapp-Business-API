import { pool } from './client.js';

// Keep startup migrations additive and idempotent. Render can start the API from an existing
// database before a Blueprint build hook has had a chance to run, so compatibility columns that
// are required by the current server must be repaired before the first tenant query.
export async function runAutoMigrations() {
  await pool.query(`
    ALTER TABLE "ai_settings"
    ADD COLUMN IF NOT EXISTS "human_handoff_message"
    text NOT NULL DEFAULT 'A human agent has joined the conversation and will take over from here.'
  `);
}