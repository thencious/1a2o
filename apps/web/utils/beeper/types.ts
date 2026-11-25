export type ChatAttachment = {
  name: string;
  type: string;
  mime: string;
  index: number;
};
export type ChatLinkPreview = {
  url: string;
  title: string;
  description?: string;
  image?: string;
};
export type ChatMessage = {
  id: string;
  chatId: string;
  sender: string;
  text: string;
  time: string;
  outgoing: boolean;
  deleted: boolean;
  status?: string;
  seen?: boolean | string | Record<string, boolean | string>;
  readReceipts?: boolean;
  canReact?: boolean;
  canRecall?: boolean;
  canReply?: boolean;
  canEdit?: boolean;
  editRevision?: string;
  editedAt?: string;
  replyToMessageId?: string;
  replyToPreview?: { sender: string; text: string };
  reactions?: { key: string; count: number; mine: boolean }[];
  links?: ChatLinkPreview[];
  attachments: ChatAttachment[];
};
export type Conversation = {
  members?: Conversation[];
  ruleLabel?: string | null;
  id: string;
  accountId: string;
  account: string;
  network: string;
  title: string;
  group: boolean;
  unread: number;
  time: string;
  preview: string;
  readOnly: boolean;
};
export type ConversationPage = {
  items: Conversation[];
  cursor: string | null;
  hasMore: boolean;
};
export type MessagePage = {
  allowedReactions?: string[];
  items: ChatMessage[];
  cursor: string | null;
  hasMore: boolean;
  scanned?: {
    chatId: string;
    oldestTime: string | null;
    hasMore: boolean;
  }[];
};
export type ChatParticipant = { id: string; label: string; username?: string };
export type MentionParticipants = {
  supported: boolean;
  participants: ChatParticipant[];
};
export type BeeperStatus = {
  recovery?: import("./recovery-policy").BeeperRecoveryStatus;
  configured: boolean;
  running: boolean;
  accounts: { id: string; name: string; network: string; status: string }[];
  error?: string;
};
