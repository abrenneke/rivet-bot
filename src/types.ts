export type DiscordUser = {
  id: string;
  displayName: string;
};

export type MessageData = {
  id: string;
  content: string;
  timestamp: Date;
  user: DiscordUser;
  replyTo: string | undefined;
  channelId: string;
};

export type MessageNode = {
  id: string;
  replyTo: string | null;
  timestamp: Date;
};

export type Conversation = {
  id: string;
  messages: string[];
  startTime: Date;
  endTime: Date;
};
