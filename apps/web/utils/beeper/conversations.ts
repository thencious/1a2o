import type {
  Chat,
  ChatListResponse,
} from "@beeper/desktop-api/resources/chats/chats";
import type { Account } from "@beeper/desktop-api/resources/accounts/accounts";
import type { Conversation } from "./types";

export function allowedConversation(
  chat: Pick<Chat, "network" | "type" | "id" | "accountID">,
  approvedGroups: string[] = [],
) {
  return (
    !isDiscordConversation(chat) ||
    chat.type === "single" ||
    approvedGroups.includes(chat.id)
  );
}
export function isDiscordConversation(
  chat: Pick<Chat, "network" | "accountID">,
) {
  return (
    chat.network.toLowerCase().includes("discord") ||
    chat.accountID.toLowerCase().startsWith("discord")
  );
}

export function uniqueConversations(pages: Conversation[][]) {
  const unique = new Map<string, Conversation>();
  for (const item of pages.flat()) {
    const previous = unique.get(item.id);
    if (!previous || Date.parse(item.time) >= Date.parse(previous.time))
      unique.set(item.id, item);
  }
  return [...unique.values()].sort(
    (a, b) =>
      Date.parse(b.time) - Date.parse(a.time) || a.id.localeCompare(b.id),
  );
}

export function conversationRow(
  chat: ChatListResponse,
  accounts: Account[],
  preview: string,
): Conversation {
  const account = accounts.find((item) => item.accountID === chat.accountID);
  return {
    id: chat.id,
    accountId: chat.accountID,
    account: account?.user.fullName || account?.user.username || chat.network,
    network: chat.network,
    title: chat.title || "Untitled conversation",
    group: chat.type === "group",
    unread: chat.unreadCount,
    time:
      chat.preview?.timestamp || chat.lastActivity || new Date(0).toISOString(),
    preview: `${chat.preview?.isSender ? "You: " : chat.type === "group" && chat.preview?.senderName ? `${chat.preview.senderName}: ` : ""}${preview}`,
    readOnly: Boolean(chat.isReadOnly),
  };
}
