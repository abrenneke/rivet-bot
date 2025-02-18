import type { Database } from 'sqlite';
import type { Conversation, MessageData, MessageNode } from './types.js';
import sql from 'sql-template-tag';
import { SingleBar } from 'cli-progress';
import {
  isMessageProcessed,
  knnConversationEmbeddings,
  storeConversationEmbedding,
  storeMessage,
  storeUser,
} from './queries.js';
import PQueue from 'p-queue';
import * as Rivet from '@ironclad/rivet-node';
import { writeFile } from 'node:fs/promises';
import { getManyDocs, knnDocsEmbeddings } from './docs.js';
import { hashConversation } from './hashing.js';

export async function processMessagesForConversations(db: Database, messages: MessageData[]): Promise<void> {
  const processingTimes: number[] = [];
  const ROLLING_WINDOW = 25;

  const progressBar = new SingleBar({
    format:
      'Processing messages |{bar}| {percentage}% | {value}/{total} messages | Cost: ${cost} | ETA: {calculatedEta}',
    linewrap: true,
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
    hideCursor: true,
  });

  const queue = new PQueue({ concurrency: 20 });
  let runningCost = 0;
  let processedMessages = 0;
  const totalMessages = messages.length;
  let lastUpdateTime = Date.now();

  progressBar.start(totalMessages, 0, {
    cost: runningCost.toFixed(2),
    calculatedEta: 'calculating...',
  });

  // Function to calculate rolling ETA
  function calculateRollingETA(currentTime: number): string {
    const timeTaken = currentTime - lastUpdateTime;
    processingTimes.push(timeTaken);

    if (processingTimes.length > ROLLING_WINDOW) {
      processingTimes.shift();
    }

    if (processingTimes.length < 5) {
      return 'calculating...';
    }

    const averageTimePerMessage = processingTimes.reduce((sum, time) => sum + time, 0) / processingTimes.length;
    const remainingMessages = totalMessages - processedMessages;
    const estimatedMillisecondsRemaining = remainingMessages * averageTimePerMessage;

    const totalSeconds = Math.floor(estimatedMillisecondsRemaining / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;

    lastUpdateTime = currentTime;
    return `${minutes}m ${seconds}s`;
  }

  // Create a function to process a single message
  async function processMessage(message: MessageData): Promise<void> {
    if (await isMessageProcessed(db, message.id)) {
      processedMessages++;
      progressBar.update(processedMessages, {
        cost: runningCost.toFixed(2),
        calculatedEta: calculateRollingETA(Date.now()),
      });
      return;
    }

    await storeUser(db, message.user);

    if (!message.replyTo) {
      const messageIndex = messages.findIndex((m) => m.id === message.id);
      const previousMessages = messages.slice(Math.max(0, messageIndex - 15), messageIndex);

      const { output, cost } = await Rivet.runGraphInFile('./bot.rivet-project', {
        graph: 'Get Parent Message',
        inputs: {
          messages: {
            type: 'object[]',
            value: [...previousMessages, message],
          },
        },
        pluginSettings: {
          anthropic: {
            anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
          },
        },
      });

      runningCost += Rivet.coerceType(cost, 'number');

      const outputString = Rivet.coerceType(output, 'string');
      if (outputString !== 'NULL') {
        message.replyTo = outputString;
      }
    }

    await storeMessage(db, message);

    processedMessages++;
    progressBar.update(processedMessages, {
      cost: runningCost.toFixed(2),
      calculatedEta: calculateRollingETA(Date.now()),
    });
  }

  // Process messages from newest to oldest
  await Promise.all(
    messages
      .slice()
      .reverse()
      .map((message) => queue.add(() => processMessage(message))),
  );

  await queue.onIdle();
  progressBar.stop();
}

export type ConversationDetails = {
  messages: MessageData[];
};

// Helper function to get conversation details including message content
export async function getConversationDetails(db: Database, conversationId: string): Promise<ConversationDetails> {
  const messages = await db.all(sql`
    SELECT
      m.id,
      m.content,
      datetime(m.timestamp) as timestamp,
      m.user_id as userId,
      u.display_name as userName,
      m.reply_to as replyTo,
      m.channel_id as channelId
    FROM messages m
    JOIN users u ON m.user_id = u.id
    WHERE m.id IN (
      WITH RECURSIVE conversation_messages(id) AS (
        SELECT id FROM messages WHERE id = ${conversationId}
        UNION
        SELECT m.id
        FROM messages m
        JOIN conversation_messages c ON m.reply_to = c.id
      )
      SELECT id FROM conversation_messages
    )
    ORDER BY m.timestamp ASC
  `);

  return {
    messages: messages.map(
      (msg): MessageData => ({
        ...msg,
        user: { id: msg.userId, displayName: msg.userName },
        timestamp: new Date(msg.timestamp),
      }),
    ),
  };
}

export async function groupMessagesByConversation(db: Database, channelId: string): Promise<Conversation[]> {
  // First, get all messages with their reply_to references
  const rawMessages = await db.all<
    {
      id: string;
      replyTo: string | null;
      timestamp: string; // SQLite returns timestamps as strings
    }[]
  >(sql`
    SELECT
      id,
      reply_to as replyTo,
      datetime(timestamp) as timestamp
    FROM messages
    WHERE channel_id = ${channelId}
    ORDER BY timestamp ASC
  `);

  // Convert to MessageNode format
  const messages: MessageNode[] = rawMessages.map((msg) => ({
    id: msg.id,
    replyTo: msg.replyTo,
    timestamp: new Date(msg.timestamp),
  }));

  // Create a map for quick message lookup
  const messageMap = new Map<string, MessageNode>();
  messages.forEach((msg) => messageMap.set(msg.id, msg));

  // Create a map to track which conversation each message belongs to
  const messageToConversation = new Map<string, string>();

  // Function to find the root message of a conversation
  function findConversationRoot(messageId: string, visited = new Set<string>()): string {
    if (visited.has(messageId)) {
      // We found a cycle, use the first message in the cycle as the root
      return messageId;
    }

    visited.add(messageId);
    const message = messageMap.get(messageId);

    if (!message || !message.replyTo) {
      return messageId; // This is the root
    }

    // If we already know this message's conversation, return its root
    if (messageToConversation.has(messageId)) {
      return messageToConversation.get(messageId)!;
    }

    return findConversationRoot(message.replyTo, visited);
  }

  // Group messages into conversations
  const conversationMessages = new Map<string, Set<string>>();
  const conversationTimes = new Map<string, { start: Date; end: Date }>();

  // Process each message
  for (const message of messages) {
    const rootId = findConversationRoot(message.id);
    messageToConversation.set(message.id, rootId);

    // Initialize or update conversation
    if (!conversationMessages.has(rootId)) {
      conversationMessages.set(rootId, new Set());
      conversationTimes.set(rootId, {
        start: new Date(message.timestamp),
        end: new Date(message.timestamp),
      });
    }

    // Add message to conversation
    conversationMessages.get(rootId)!.add(message.id);

    // Update conversation times
    const times = conversationTimes.get(rootId)!;
    const msgTime = new Date(message.timestamp);
    if (msgTime < times.start) times.start = msgTime;
    if (msgTime > times.end) times.end = msgTime;
  }

  // Convert to final format
  const conversations: Conversation[] = [];
  for (const [rootId, messageSet] of conversationMessages) {
    const times = conversationTimes.get(rootId)!;
    conversations.push({
      id: rootId,
      messages: Array.from(messageSet),
      startTime: times.start,
      endTime: times.end,
    });
  }

  // Sort conversations by start time
  return conversations.sort((a, b) => a.startTime.getTime() - b.startTime.getTime());
}

export async function processConversation(
  db: Database,
  conversation: Conversation,
  options?: {
    onError?: (error: Error) => void;
  },
): Promise<boolean> {
  try {
    // Get conversation details
    const details = await getConversationDetails(db, conversation.id);

    // Compute the hash for the conversation
    const newHash = hashConversation(details.messages);

    // Check if the conversation has changed
    const storedHashResult = await db.get(sql`
      SELECT hash FROM conversation_hashes WHERE conversation_id = ${conversation.id}
    `);

    const storedHash = storedHashResult ? storedHashResult.hash : null;

    if (storedHash && storedHash === newHash) {
      return false; // No changes, skip processing
    }

    if (storedHash && storedHash !== newHash) {
      console.log(`Conversation ${conversation.id} has changed`);
    }

    // Delete any old embedding
    await db.run(sql`
      DELETE FROM vec_conversation_embeddings WHERE conversation_id = ${conversation.id}
    `);

    // Run the embedding graph
    const { vector } = await Rivet.runGraphInFile('./bot.rivet-project', {
      graph: 'Embed Conversation',
      inputs: {
        conversation_messages: {
          type: 'object[]',
          value: details.messages,
        },
      },
      pluginSettings: {
        anthropic: {
          anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
        },
      },
    });

    // Store the embedding
    await storeConversationEmbedding(db, conversation.id, Rivet.coerceType(vector, 'vector'));

    // Store the new hash
    await db.run(sql`
      INSERT OR REPLACE INTO conversation_hashes (conversation_id, hash) VALUES (
        ${conversation.id},
        ${newHash}
      )
    `);

    return true;
  } catch (error) {
    if (options?.onError) {
      options.onError(error as Error);
    } else {
      console.error(`Error processing conversation ${conversation.id}:`, error);
    }
    return false;
  }
}

export async function analyzeConversations(db: Database, channelId: string): Promise<void> {
  const conversations = await groupMessagesByConversation(db, channelId);
  console.log(`Found ${conversations.length} conversations`);

  const progressBar = new SingleBar({
    format: 'Processing embeddings |{bar}| {percentage}% | {value}/{total} conversations',
    barCompleteChar: '\u2588',
    barIncompleteChar: '\u2591',
  });

  progressBar.start(conversations.length, 0);
  let processed = 0;

  const queue = new PQueue({ concurrency: 20 });

  // Process each conversation
  await Promise.all(
    conversations.map((conv) =>
      queue.add(async () => {
        const wasProcessed = await processConversation(db, conv, {
          onError: (error) => console.error(`Error processing conversation ${conv.id}:`, error),
        });
        if (wasProcessed) {
          processed++;
        }
        progressBar.increment();
      }),
    ),
  );

  await queue.onIdle();
  progressBar.stop();

  console.log(`Processed ${processed} conversations`);
}

export async function embedQuery(messages: MessageData[]): Promise<{
  embedding: Float32Array;
  rephrased: string;
}> {
  const recorder = new Rivet.ExecutionRecorder();
  const { run, processor } = Rivet.createProcessor(await Rivet.loadProjectFromFile('./bot.rivet-project'), {
    graph: 'Embed Query',
    inputs: {
      messages: {
        type: 'object[]',
        value: messages,
      },
    },
  });

  recorder.record(processor);

  try {
    const { output: queryEmbedding, rephrased } = await run();
    return {
      embedding: new Float32Array(Rivet.coerceType(queryEmbedding, 'vector')),
      rephrased: Rivet.coerceType(rephrased, 'string'),
    };
  } finally {
    const recording = recorder.serialize();
    await writeFile('embed-query-recording.rivet-recording', recording);
  }
}

export async function knnConversations(
  db: Database,
  embedding: {
    embedding: Float32Array;
    rephrased: string;
  },
  k: number,
): Promise<(ConversationDetails & { distance: number })[]> {
  console.log(`Rephrased query as "${embedding.rephrased}"`);

  const results = await knnConversationEmbeddings(db, embedding.embedding, k);

  const conversations: (ConversationDetails & { distance: number })[] = await Promise.all(
    results.map(async ({ conversationId, distance }) => {
      const details = await getConversationDetails(db, conversationId);
      return { ...details, distance };
    }),
  );

  return conversations.filter((c) => c.messages.length > 0);
}

export async function helpfulMessageFromPastConversations(
  db: Database,
  lastMessages: MessageData[],
): Promise<
  | {
      internalThoughts: string;
      reply: string;
      helpfulness: number;
      shouldReply: boolean;
    }
  | undefined
> {
  const queryEmbedding = await embedQuery(lastMessages);

  const [conversationKnnResults, docsKnnResults] = await Promise.all([
    knnConversations(db, queryEmbedding, 20),
    knnDocsEmbeddings(db, queryEmbedding, 5),
  ]);

  if (conversationKnnResults.length === 0) {
    return undefined;
  }

  console.log(`Found similar documents: ${docsKnnResults.map((r) => r.docId).join(', ')}`);

  const docs = await getManyDocs(
    db,
    docsKnnResults.map((r) => r.docId),
  );

  const recorder = new Rivet.ExecutionRecorder();

  const { run, processor } = Rivet.createProcessor(await Rivet.loadProjectFromFile('./bot.rivet-project'), {
    graph: 'Helpful Message From Past Conversations',
    inputs: {
      conversations: {
        type: 'object[]',
        value: conversationKnnResults,
      },
      messages: {
        type: 'object[]',
        value: lastMessages,
      },
      docs: {
        type: 'object[]',
        value: docs,
      },
    },
    pluginSettings: {
      anthropic: {
        anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
      },
    },
  });

  recorder.record(processor);

  const { internalThoughts, reply, helpfulness, shouldReply } = await run();

  console.dir({ internalThoughts, reply, helpfulness, shouldReply });

  const recording = recorder.serialize();
  await writeFile('helpful-message-recording.rivet-recording', recording);

  return {
    internalThoughts: Rivet.coerceType(internalThoughts, 'string'),
    reply: Rivet.coerceType(reply, 'string'),
    helpfulness: Rivet.coerceType(helpfulness, 'number'),
    shouldReply: Rivet.coerceType(shouldReply, 'boolean'),
  };
}
