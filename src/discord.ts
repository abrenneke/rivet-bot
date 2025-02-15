import { Client, Collection, Message, TextChannel, type FetchMessagesOptions, type User } from 'discord.js';
import { loadCache, saveCache } from './cache.js';
import type { DiscordUser, MessageData } from './types.js';

const client = new Client({
  intents: ['Guilds', 'GuildMessages', 'MessageContent'],
});

export async function login() {
  await client.login(process.env['DISCORD_TOKEN']);
}

export async function logout() {
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

export async function fetchAllMessages(channelId: string): Promise<MessageData[]> {
  // Try to load from cache first
  const cachedMessages = await loadCache(channelId);
  if (cachedMessages) {
    console.log('Using cached messages');
    return cachedMessages;
  }

  console.log('Fetching messages from Discord...');
  const channel = (await client.channels.fetch(channelId)) as TextChannel;
  if (!channel) {
    throw new Error('Channel not found');
  }

  const allMessages: Collection<string, Message<true>> = new Collection();
  let lastMessageId: string | undefined = undefined;

  while (true) {
    const options: FetchMessagesOptions = { limit: MESSAGES_PER_PAGE };
    if (lastMessageId) {
      options.before = lastMessageId;
    }

    const messages = await channel.messages.fetch(options);
    if (messages.size === 0) break;

    messages.forEach((message) => allMessages.set(message.id, message));
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

  // Sort by timestamp (oldest first)
  const sortedMessages = messageList.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  // Save to cache
  await saveCache(channelId, sortedMessages);

  return sortedMessages;
}

export function watchForMessages(callback: (message: MessageData) => void) {
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

export async function replyToMessage(message: MessageData, reply: string) {
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
