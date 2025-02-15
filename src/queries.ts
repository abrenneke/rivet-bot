import { Database } from 'sqlite';
import sql from 'sql-template-tag';
import type { DiscordUser, MessageData } from './types.js';

export async function storeUser(db: Database, user: DiscordUser) {
  await db.run(sql`INSERT OR REPLACE INTO users (id, display_name) VALUES (${user.id}, ${user.displayName})`);
}

export async function storeMessage(db: Database, message: MessageData) {
  await db.run(
    sql`INSERT OR REPLACE INTO messages (id, content, timestamp, user_id, reply_to, channel_id) VALUES (
      ${message.id},
      ${message.content},
      ${message.timestamp.toISOString()},
      ${message.user.id},
      ${message.replyTo},
      ${message.channelId}
    )`,
  );
}

export async function storeConversationEmbedding(
  db: Database,
  conversationId: string,
  embedding: number[],
): Promise<void> {
  await db.run(sql`
    INSERT OR REPLACE INTO vec_conversation_embeddings (conversation_id, embedding) VALUES (
      ${conversationId},
      ${new Float32Array(embedding)}
    );
  `);
}

export async function isConversationEmbedded(db: Database, conversationId: string): Promise<boolean> {
  const result = await db.get(sql`
    SELECT conversation_id
    FROM vec_conversation_embeddings
    WHERE conversation_id = ${conversationId}
  `);

  return !!result;
}

export async function isMessageProcessed(db: Database, messageId: string): Promise<boolean> {
  const result = await db.get(sql`SELECT id FROM messages WHERE id = ${messageId}`);
  return !!result;
}

export async function knnConversationEmbeddings(
  db: Database,
  query: Float32Array,
  k: number,
): Promise<{ conversationId: string; distance: number }[]> {
  const result = await db.all(sql`
    SELECT conversation_id, distance
    FROM vec_conversation_embeddings
    WHERE embedding MATCH ${query}
    LIMIT ${k}
  `);

  return result.map((row) => ({
    conversationId: row.conversation_id,
    distance: row.distance,
  }));
}
