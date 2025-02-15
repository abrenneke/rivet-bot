import { readFile, writeFile, stat } from 'node:fs/promises';
import type { MessageData } from './types.js';

export async function loadCache(channelId: string): Promise<MessageData[] | null> {
  const cacheFile = `messages-cache-${channelId}.json`;

  try {
    try {
      await stat(cacheFile);
    } catch (err) {
      // Cache file doesn't exist
      return null;
    }

    const cacheContent = await readFile(cacheFile, 'utf-8');
    const cache = JSON.parse(cacheContent);

    // Convert string dates back to Date objects
    return cache.messages.map((msg: any) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    }));
  } catch (error) {
    console.error('Error loading cache:', error);
    return null;
  }
}

export async function saveCache(channelId: string, messages: MessageData[]): Promise<void> {
  const cacheFile = `messages-cache-${channelId}.json`;
  await writeFile(cacheFile, JSON.stringify({ messages }, null, 2), 'utf-8');
}
