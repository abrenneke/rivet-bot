import type { MessageData } from './types.js';
import * as crypto from 'node:crypto';

export function hashMessage(message: MessageData): string {
  const hash = crypto.createHash('sha256');

  // Add all relevant message fields to the hash
  hash.update(message.id);
  hash.update(message.content);
  hash.update(message.timestamp.toISOString());
  hash.update(message.user.id);
  hash.update(message.user.displayName);
  if (message.replyTo) {
    hash.update(message.replyTo);
  }
  if (message.channelId) {
    hash.update(message.channelId);
  }

  return hash.digest('hex');
}

export function hashConversation(messages: MessageData[]): string {
  // Sort messages by timestamp to ensure consistent ordering
  const sortedMessages = [...messages].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Create a hash combining all message hashes
  const conversationHash = crypto.createHash('sha256');

  for (const message of sortedMessages) {
    conversationHash.update(hashMessage(message));
  }

  return conversationHash.digest('hex');
}
