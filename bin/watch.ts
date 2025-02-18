import { CHANNELS_MAP, initializeDatabase } from '../src/config.js';
import {
  analyzeConversations,
  helpfulMessageFromPastConversations,
  processMessagesForConversations,
} from '../src/conversation.js';
import { fetchAllMessages, fetchLast10Messages, login, replyToMessage, watchForMessages } from '../src/discord.js';
import { getError } from '../src/utils.js';

const db = await initializeDatabase();

await login();

const BOT_ID = '1339820818250727434';

watchForMessages(async (message) => {
  try {
    const lastMessagesInDiscord = await fetchLast10Messages(message.channelId);

    const result = await helpfulMessageFromPastConversations(db, lastMessagesInDiscord);
    const lastMessage = lastMessagesInDiscord.at(-1);

    if (!result || !lastMessage) {
      return;
    }

    console.log(`Received a message from ${lastMessage.user.displayName}`);

    console.dir({ result, lastMessage });

    const shouldReply = result.shouldReply || result.helpfulness >= 7 || lastMessage.content.includes(BOT_ID);

    if (shouldReply) {
      await replyToMessage(lastMessage, result.reply || '(no helpful message found)');
    }

    // Process the message and store it in the database
    const allChannelMessages = await fetchAllMessages(
      message.channelId,
      CHANNELS_MAP[message.channelId as keyof typeof CHANNELS_MAP],
    );

    await processMessagesForConversations(db, allChannelMessages);
    await analyzeConversations(db, message.channelId);
  } catch (err) {
    const error = getError(err);

    console.error(error.message);
    console.error(error.stack);
  }
});
