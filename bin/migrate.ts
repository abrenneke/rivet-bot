import type { Database } from 'sqlite';
import { initializeDatabase } from '../src/config.js';
import sql from 'sql-template-tag';

const db = await initializeDatabase();

export async function createConversationHashesTable(db: Database): Promise<void> {
  await db.exec(sql`
    CREATE TABLE IF NOT EXISTS conversation_hashes (
      conversation_id TEXT PRIMARY KEY,
      hash TEXT NOT NULL
    );
  `);
}

await createConversationHashesTable(db);
