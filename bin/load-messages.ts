import * as Rivet from '@ironclad/rivet-node';
import { getError } from '../src/utils.js';
import { fetchAllMessages, login, logout } from '../src/discord.js';
import { CHANNELS, CHANNELS_MAP, initializeDatabase } from '../src/config.js';
import { analyzeConversations, processMessagesForConversations } from '../src/conversation.js';

Rivet.globalRivetNodeRegistry.registerPlugin(Rivet.plugins.anthropic);

async function main() {
  try {
    await login();
    console.log('Logged into Discord');
    const db = await initializeDatabase();
    console.log('Database initialized');

    for (const channel of CHANNELS) {
      console.log(`Processing channel ${CHANNELS_MAP[channel]}`);

      const messages = await fetchAllMessages(channel, CHANNELS_MAP[channel]);
      console.log(`Found ${messages.length} messages`);

      await processMessagesForConversations(db, messages);

      await analyzeConversations(db, channel);
    }

    await db.close();
    console.log('Database connection closed');
  } catch (error) {
    const err = getError(error);

    console.error('\n');
    console.error(err.message);
    console.error(err.stack);

    process.exit(1);
  } finally {
    await logout();
  }
}

main();
