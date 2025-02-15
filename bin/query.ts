import { initializeDatabase } from '../src/config.js';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { helpfulMessageFromPastConversations, knnConversations } from '../src/conversation.js';
import { fetchLast10Messages, login, logout } from '../src/discord.js';
import type { MessageData } from '../src/types.js';

const db = await initializeDatabase();

await login();

await yargs(hideBin(process.argv))
  .command(
    '$0 <query>',
    'Find helpful messages from past conversations',
    (y) =>
      y
        .positional('query', {
          describe: 'The query to search for',
          type: 'string',
          demandOption: true,
        })
        .option('k', {
          describe: 'The number of nearest neighbors to retrieve',
          type: 'number',
          default: 10,
        }),
    async ({ query, k }) => {
      const lastMessagesInDiscord = await fetchLast10Messages('1149376304756564092');

      const result = await helpfulMessageFromPastConversations(db, [
        ...lastMessagesInDiscord,
        {
          id: 'test',
          content: query,
          timestamp: new Date(),
          user: {
            id: 'test',
            displayName: 'test',
          },
          replyTo: undefined,
          channelId: '1149376304756564092',
        },
      ] satisfies MessageData[]);
      console.log(result);
    },
  )
  .parseAsync();

await logout();
