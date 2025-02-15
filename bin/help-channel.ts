import { initializeDatabase } from '../src/config.js';
import { helpfulMessageFromPastConversations } from '../src/conversation.js';
import { fetchLast10Messages, login, logout } from '../src/discord.js';

const db = await initializeDatabase();

await login();

const lastMessagesInDiscord = await fetchLast10Messages('1149376304756564092');

console.log(JSON.stringify(lastMessagesInDiscord));

const result = await helpfulMessageFromPastConversations(db, lastMessagesInDiscord);
console.log(result);

await logout();
