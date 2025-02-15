import { config } from 'dotenv';
config();

export const MESSAGES_PER_PAGE = 100;
export const DB_PATH = 'discord_messages.db';

// src/db/index.ts
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import sql from 'sql-template-tag';
import * as sqliteVec from 'sqlite-vec';

export async function initializeDatabase(): Promise<Database> {
  const db = await open({
    filename: DB_PATH,
    driver: sqlite3.Database,
  });

  sqliteVec.load(db);

  // Create regular tables
  await db.exec(sql`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      content TEXT NOT NULL,
      timestamp DATETIME NOT NULL,
      user_id TEXT NOT NULL,
      reply_to TEXT,
      channel_id TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (reply_to) REFERENCES messages(id)
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_conversation_embeddings USING vec0(
      conversation_id text primary key,
      embedding float[1536]
    );
  `);

  return db;
}
