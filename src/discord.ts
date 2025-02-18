import { Client, Collection, Message, TextChannel, type FetchMessagesOptions, type User } from 'discord.js';
import { loadCache, saveCache } from './cache.js';
import type { DiscordUser, MessageData } from './types.js';

const client = new Client({
  intents: ['Guilds', 'GuildMessages', 'MessageContent'],
});

export async function login(): Promise<void> {
  await client.login(process.env['DISCORD_TOKEN']);
}

export async function logout(): Promise<void> {
  await client.destroy();
}

const MESSAGES_PER_PAGE = 100;

async function getUserInfo(user: User): Promise<DiscordUser> {
  return {
    id: user.id,
    displayName: user.displayName,
  };
}

export async function fetchLast10Messages(channelId: string): Promise<MessageData[]> {
  const channel = (await client.channels.fetch(channelId)) as TextChannel;
  if (!channel) {
    throw new Error('Channel not found');
  }

  const messages = await channel.messages.fetch({ limit: 10 });
  let messagesWithUser = await Promise.all(
    Array.from(messages.values()).map(async (message) => ({
      id: message.id,
      content: message.content,
      timestamp: message.createdAt,
      user: await getUserInfo(message.author),
      replyTo: message.reference?.messageId,
      channelId: channel.id,
    })),
  );

  messagesWithUser.reverse(); // Reverse to get oldest first so it looks like a conversation

  // messagesWithUser = messagesWithUser.slice(0, -12);

  return messagesWithUser.slice(-10);
}

export async function fetchAllMessages(channelId: string, channelName: string): Promise<MessageData[]> {
  console.log(`Fetching all messages for #${channelName}...`);

  // Try to load from cache first
  const cachedMessages = await loadCache(channelId);
  let latestTimestamp: Date | undefined;

  if (cachedMessages && cachedMessages.length > 0) {
    console.log('Using cached messages');
    latestTimestamp = cachedMessages.at(-1)!.timestamp;
  } else {
    console.log('No cache found, fetching all messages from Discord...');
  }

  const channel = (await client.channels.fetch(channelId)) as TextChannel;
  if (!channel) {
    throw new Error('Channel not found');
  }

  const allMessages: Collection<string, Message<true>> = new Collection();
  let lastMessageId: string | undefined = undefined;
  let fetching = true;

  while (fetching) {
    const options: FetchMessagesOptions = { limit: MESSAGES_PER_PAGE };
    if (lastMessageId) {
      options.before = lastMessageId;
    }

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    messages.forEach((message) => {
      if (!latestTimestamp || message.createdAt > latestTimestamp) {
        allMessages.set(message.id, message);
      } else {
        fetching = false; // Stop fetching if we reach messages that are already cached
      }
    });

    lastMessageId = messages.last()?.id;
    console.log(`Fetched ${allMessages.size} messages so far...`);
  }

  // Convert to our MessageData format
  const messageList: MessageData[] = await Promise.all(
    Array.from(allMessages.values()).map(async (message) => ({
      id: message.id,
      content: message.content,
      timestamp: message.createdAt,
      user: await getUserInfo(message.author),
      replyTo: message.reference?.messageId,
      channelId: channel.id,
    })),
  );

  // Combine cached messages with newly fetched messages
  const combinedMessages = cachedMessages ? [...cachedMessages, ...messageList] : messageList;

  // Sort by timestamp (oldest first)
  const sortedMessages = combinedMessages.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Save to cache
  await saveCache(channelId, sortedMessages);

  return sortedMessages;
}

export function watchForMessages(callback: (message: MessageData) => void): void {
  client.on('messageCreate', async (message) => {
    if (message.author.bot) return;

    const channel = message.channel as TextChannel;
    callback({
      id: message.id,
      content: message.content,
      timestamp: message.createdAt,
      user: await getUserInfo(message.author),
      replyTo: message.reference?.messageId,
      channelId: channel.id,
    });
  });
}

export async function replyToMessage(message: MessageData, reply: string): Promise<void> {
  const channel = (await client.channels.fetch(message.channelId)) as TextChannel;
  if (!channel) {
    console.error('Channel not found');
    return;
  }

  await channel.send({
    content: reply,
    reply: {
      messageReference: message.id,
    },
  });
}
