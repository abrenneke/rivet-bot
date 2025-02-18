import { config } from 'dotenv';
config();

export const MESSAGES_PER_PAGE = 100;
export const DB_PATH = 'discord_messages.db';

// src/db/index.ts
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import sql from 'sql-template-tag';
import * as sqliteVec from 'sqlite-vec';

export const CHANNELS = [
  '1149376304756564092', // #rivet-general
  '1149382713904746597', // #rivet-help
  '1170882289417343016', // #rivet-development
  '1149383013570969721', // #announcements
  '1152352793001218058', // #rivet-suggestions
  '1152111685054759033', // #rivet-plugins
] as const;

export const CHANNELS_MAP = {
  '1149376304756564092': 'rivet-general',
  '1149382713904746597': 'rivet-help',
  '1170882289417343016': 'rivet-development',
  '1149383013570969721': 'announcements',
  '1152352793001218058': 'rivet-suggestions',
  '1152111685054759033': 'rivet-plugins',
} as const;

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

    CREATE TABLE IF NOT EXISTS docs (
      id TEXT PRIMARY KEY,
      file_name TEXT NOT NULL,
      body TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS vec_docs_embeddings USING vec0(
      doc_id text primary key,
      embedding float[1536]
    );

    CREATE TABLE IF NOT EXISTS conversation_hashes (
      conversation_id TEXT PRIMARY KEY,
      hash TEXT NOT NULL
    );
  `);

  return db;
}
