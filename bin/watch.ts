import { initializeDatabase } from '../src/config.js';
import { helpfulMessageFromPastConversations } from '../src/conversation.js';
import { fetchLast10Messages, login, replyToMessage, watchForMessages } from '../src/discord.js';

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

    const shouldReply = (result.shouldReply && result.helpfulness >= 8) || lastMessage.content.includes(BOT_ID);

    if (shouldReply) {
      await replyToMessage(lastMessage, result.reply || '(no helpful message found)');
    }
  } catch (err) {
    console.error(err);
  }
});
