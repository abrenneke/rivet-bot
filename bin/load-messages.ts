import * as Rivet from '@ironclad/rivet-node';
import { getError } from '../src/utils.js';
import { fetchAllMessages, login, logout } from '../src/discord.js';
import { initializeDatabase } from '../src/config.js';
import { analyzeConversations, processMessagesForConversations } from '../src/conversation.js';

Rivet.globalRivetNodeRegistry.registerPlugin(Rivet.plugins.anthropic);

const CHANNELS = [
  '1149376304756564092', // #rivet-general
  '1149382713904746597', // #rivet-help
  '1170882289417343016', // #rivet-development
  '1149383013570969721', // #announcements
  '1152352793001218058', // #rivet-suggestions
  '1152111685054759033', // #rivet-plugins
];

async function main() {
  try {
    await login();
    console.log('Logged into Discord');
    const db = await initializeDatabase();
    console.log('Database initialized');

    for (const channel of CHANNELS) {
      console.log(`Processing channel ${channel}`);

      const messages = await fetchAllMessages(channel);
      console.log(`Found ${messages.length} messages`);

      await processMessagesForConversations(db, messages);

      await analyzeConversations(db);
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
