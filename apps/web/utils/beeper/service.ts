import "server-only";
import { contactDirectory } from "@/utils/contacts/directory";
import { beeperDraftText } from "./draft-text";
import {
  conversationNameResolver,
  messagingAccountContacts,
} from "@/utils/contacts/conversation-names";
import {
  beeperConnection,
  beeperSession,
  saveBeeperConnection,
  beeperDirectory,
} from "./connection";
import { ensureBeeperSession } from "./session-recovery";
import type { Message } from "@beeper/desktop-api/resources/shared";
import type { Chat } from "@beeper/desktop-api/resources/chats/chats";
import { convert } from "html-to-text";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { SafeError } from "@/utils/error";
import { messageActionCapabilities } from "./message-actions";
import { nativeMentionText, type MessageMention } from "./mentions";
import { messagePreviewLinks, webLinkUrl } from "./message-links";
import { completeLinkPreview, fetchPreviewImage } from "./link-previews";
import {
  allowedConversation,
  conversationRow,
  isDiscordConversation,
} from "./conversations";
import type {
  BeeperStatus,
  ChatMessage,
  ConversationPage,
  MessagePage,
  MentionParticipants,
} from "./types";
export async function mentionParticipants(
  userId: string,
  chatId: string,
): Promise<MentionParticipants> {
  const { client, chat } = await allowedChat(userId, chatId);
  if (chat.isReadOnly || (chat.capabilities?.formatting?.user_link ?? 0) <= 0)
    return { supported: false, participants: [] };
  const full = chat.participants.hasMore
    ? await client.chats.retrieve(chat.id, { maxParticipantCount: -1 })
    : chat;
  if (full.id !== chat.id || full.participants.hasMore)
    throw new SafeError(
      "Could not load the complete participant list. Try again.",
    );
  return {
    supported: true,
    participants: full.participants.items
      .filter(
        (person) =>
          !person.isSelf &&
          !person.isPending &&
          /^@[^:\s]+:[^\s]+$/.test(person.id),
      )
      .map((person) => ({
        id: person.id,
        label: (
          person.fullName ||
          person.username ||
          person.phoneNumber ||
          person.id
        )
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 250),
        username: person.username || person.phoneNumber,
      }))
      .sort((a, b) => a.label.localeCompare(b.label)),
  };
}

export async function beeperStatus(userId: string): Promise<BeeperStatus> {
  const recovery = await ensureBeeperSession(userId);
  const value = await beeperConnection(userId);
  if (!value)
    return { configured: false, running: false, accounts: [], recovery };
  try {
    const { client } = await beeperSession(userId);
    const accounts = await client.accounts.list();
    return {
      configured: true,
      recovery,
      running: true,
      accounts: accounts.map((item) => ({
        id: item.accountID,
        name:
          item.user.fullName || item.user.username || item.network || "Account",
        network: item.network || item.bridge.type,
        status: item.status,
      })),
    };
  } catch {
    return {
      configured: true,
      recovery,
      running: false,
      accounts: [],
      error:
        recovery.message ||
        "Beeper is unavailable. Open Beeper Desktop and check its API connection.",
    };
  }
}
async function allowedChat(userId: string, chatId: string) {
  const result = await beeperSession(userId);
  const chat = await result.client.chats.retrieve(chatId);
  if (chat.merge || !allowedConversation(chat, result.settings.groups))
    throw new SafeError(
      "Discord servers and unapproved Discord groups are excluded.",
    );
  return { ...result, chat };
}
export async function listConversations(
  userId: string,
  cursor?: string,
): Promise<ConversationPage> {
  const { client, settings } = await beeperSession(userId);
  try {
    const [page, accounts, directory] = await Promise.all([
      client.chats.list({ limit: 200, cursor, direction: "before" }),
      client.accounts.list(),
      contactDirectory(userId).catch(() => ({ accounts: [] })),
    ]);
    const displayName = conversationNameResolver(
      directory.accounts,
      messagingAccountContacts(accounts),
    );
    return {
      items: page.items
        .filter(
          (chat) => !chat.merge && allowedConversation(chat, settings.groups),
        )
        .map((chat) =>
          conversationRow(
            { ...chat, title: displayName(chat) },
            accounts,
            previewText(chat.preview),
          ),
        ),
      cursor: page.oldestCursor,
      hasMore: page.hasMore,
    };
  } catch (error) {
    if (error instanceof SafeError) throw error;
    throw new SafeError(
      "Could not refresh conversations. Check Beeper Desktop.",
    );
  }
}
export async function listMessages(
  userId: string,
  chatId: string,
  cursor?: string,
): Promise<MessagePage> {
  const { client, chat } = await allowedChat(userId, chatId);
  const page = await client.messages.list(chatId, {
    cursor,
    direction: "before",
  });
  return {
    items: page.items
      .filter((message) => !message.isHidden)
      .map((message) => messageRow(message, chat)),
    allowedReactions: chat.capabilities?.allowedReactions,
    cursor: page.oldestCursor,
    hasMore: page.hasMore,
    scanned: [
      {
        chatId,
        oldestTime: page.items.at(-1)?.timestamp ?? null,
        hasMore: page.hasMore,
      },
    ],
  };
}
export async function getConversationMessage(
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { client, chat } = await allowedChat(userId, chatId);
  const message = await client.messages.retrieve(messageId, { chatID: chatId });
  if (message.chatID !== chatId)
    throw new SafeError("Message is not in this conversation.");
  return messageRow(message, chat);
}
export async function markConversationRead(userId: string, chatId: string) {
  const { client } = await allowedChat(userId, chatId);
  await client.chats.markRead(chatId);
  return { read: true };
}

export async function getConversationInviteContext(
  userId: string,
  chatId: string,
  lineLimit = 50,
) {
  const { client, chat } = await allowedChat(userId, chatId);
  const accounts = await client.accounts.list();
  const identityName = conversationNameResolver(
    [],
    messagingAccountContacts(accounts),
  );
  const messages = new Map<
    string,
    {
      id: string;
      senderId: string;
      sender: string;
      text: string;
      time: string;
      outgoing: boolean;
    }
  >();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let pageIndex = 0; pageIndex < 10 && lineLimit > 0; pageIndex++) {
    const page = await client.messages.list(chatId, {
      direction: "before",
      cursor,
    });
    for (const message of page.items) {
      if (message.isHidden || message.isDeleted || !message.text) continue;
      messages.set(message.id, {
        id: message.id,
        senderId: message.senderID,
        sender: message.senderName || message.senderID,
        text: plainText(message.text, true),
        time: message.timestamp,
        outgoing: Boolean(message.isSender),
      });
    }
    if (
      [...messages.values()].reduce(
        (count, message) =>
          count +
          message.text.split(/\r?\n/).filter((line) => line.trim()).length,
        0,
      ) >= lineLimit ||
      !page.hasMore
    )
      break;
    if (!page.oldestCursor || cursors.has(page.oldestCursor))
      throw new SafeError("Conversation history pagination did not advance.");
    cursor = page.oldestCursor;
    cursors.add(cursor);
  }
  return {
    title: chat.title,
    network: chat.network,
    time: chat.lastActivity || new Date(0).toISOString(),
    preview:
      [...messages.values()]
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time))
        .at(-1)?.text ?? "",
    readOnly: Boolean(chat.isReadOnly),
    accountId: chat.accountID,
    account:
      accounts.find((account) => account.accountID === chat.accountID)?.user
        .fullName || chat.accountID,
    type: chat.type,
    messages: [...messages.values()],
    participants: chat.participants.items.map((person) => ({
      id: person.id,
      name: identityName({
        type: "single",
        title: person.fullName || person.username || person.id,
        accountID: chat.accountID,
        participants: { items: [person] },
      }),
      email: person.email,
      phoneNumber: person.phoneNumber,
      username: person.username,
      self: Boolean(person.isSelf),
    })),
  };
}
export async function messageReceipt(
  userId: string,
  chatId: string,
  pendingId: string,
) {
  const { client, chat } = await allowedChat(userId, chatId);
  return messageRow(
    await client.messages.retrieve(pendingId, { chatID: chatId }),
    chat,
  );
}

export async function messageLinkPreviews(
  userId: string,
  chatId: string,
  messageId: string,
) {
  const { client, chat } = await allowedChat(userId, chatId);
  const message = await client.messages.retrieve(messageId, {
    chatID: chat.id,
  });
  if (message.isDeleted || message.isHidden) return [];
  const row = messageRow(message, chat);
  return Promise.all(
    messagePreviewLinks(row.text, row.links).map(completeLinkPreview),
  );
}

export async function messagePreviewImage(
  userId: string,
  chatId: string,
  messageId: string,
  index: number,
) {
  const previews = await messageLinkPreviews(userId, chatId, messageId);
  const image = previews[index]?.image;
  if (!image) return new Response(null, { status: 404 });
  try {
    return await fetchPreviewImage(image);
  } catch {
    return new Response(null, { status: 404 });
  }
}

export async function recallMessage(
  userId: string,
  input: { chatId: string; messageId: string },
) {
  const { client, chat } = await allowedChat(userId, input.chatId);
  const message = await client.messages.retrieve(input.messageId, {
    chatID: chat.id,
  });
  if (
    !messageActionCapabilities(message, chat.capabilities, chat.isReadOnly)
      .canRecall
  )
    throw new SafeError(
      "This message can’t be recalled. The app may not support recall, or its time limit has passed.",
    );
  await client.messages.delete(message.id, {
    chatID: chat.id,
    forEveryone: true,
  });
  return { recalled: true };
}

export async function editMessage(
  userId: string,
  input: { chatId: string; messageId: string; text: string; revision: string },
) {
  const { client, chat } = await allowedChat(userId, input.chatId);
  const message = await client.messages.retrieve(input.messageId, {
    chatID: chat.id,
  });
  if (message.chatID !== chat.id || message.id !== input.messageId)
    throw new SafeError("Message is not in this conversation.");
  const current = messageRow(message, chat);
  if (!current.canEdit)
    throw new SafeError(
      "This message can’t be edited. Editing may be unsupported, its time limit may have passed, or it may contain an attachment.",
    );
  if (current.editRevision !== input.revision)
    throw new SafeError(
      "This message changed elsewhere. Cancel editing and reopen it to load the latest version.",
    );
  if (
    !input.text.trim() ||
    input.text.length >
      Math.min(chat.capabilities?.maxTextLength ?? 20_000, 20_000)
  )
    throw new SafeError(
      "The edited message is empty or exceeds this app’s text limit.",
    );
  if (current.text === input.text) return current;
  let updated: Message;
  try {
    updated = await client.messages.update(
      message.id,
      { chatID: chat.id, text: beeperDraftText(input.text) },
      { maxRetries: 0 },
    );
  } catch {
    throw new SafeError(
      "The edit could not be confirmed. Your text is still here. Check the message before retrying; the app may also have reached its edit limit.",
    );
  }
  if (updated.id !== message.id || updated.chatID !== chat.id)
    throw new SafeError(
      "The edit could not be confirmed. Check the conversation before retrying.",
    );
  return messageRow(updated, chat);
}

export async function reactToMessage(
  userId: string,
  input: {
    chatId: string;
    messageId: string;
    reactionKey: string;
    remove: boolean;
    requestId: string;
  },
) {
  const { client, chat } = await allowedChat(userId, input.chatId);
  const message = await client.messages.retrieve(input.messageId, {
    chatID: chat.id,
  });
  if (
    !messageActionCapabilities(message, chat.capabilities, chat.isReadOnly)
      .canReact
  )
    throw new SafeError("Reactions are not available for this message.");
  if (
    chat.capabilities?.allowedReactions &&
    !chat.capabilities.allowedReactions.includes(input.reactionKey)
  )
    throw new SafeError("This app does not support that reaction.");
  if (input.remove)
    await client.chats.messages.reactions.delete(input.reactionKey, {
      chatID: chat.id,
      messageID: message.id,
    });
  else
    await client.chats.messages.reactions.add(message.id, {
      chatID: chat.id,
      reactionKey: input.reactionKey,
      transactionID: input.requestId,
    });
  return { updated: true };
}
export async function discordGroups(userId: string, cursor?: string) {
  const { client, settings } = await beeperSession(userId);
  const items: { id: string; title: string; approved: boolean }[] = [];
  const page = await client.chats.list({
    limit: 200,
    cursor,
    direction: "before",
  });
  for (const chat of page.items)
    if (isDiscordConversation(chat) && chat.type === "group")
      items.push({
        id: chat.id,
        title: chat.title,
        approved: settings.groups.includes(chat.id),
      });
  return { items, hasMore: page.hasMore, cursor: page.oldestCursor };
}
export async function setDiscordGroup(
  userId: string,
  chatId: string,
  include: boolean,
) {
  const { client, settings } = await beeperSession(userId);
  const chat = await client.chats.retrieve(chatId);
  if (!isDiscordConversation(chat) || chat.type !== "group")
    throw new SafeError("Select a Discord private group.");
  settings.groups = include
    ? [...new Set([...settings.groups, chatId])]
    : settings.groups.filter((id) => id !== chatId);
  await saveBeeperConnection(settings);
  return { saved: true };
}
export async function sendMessage(
  userId: string,
  input: {
    chatId: string;
    requestId: string;
    text: string;
    replyToMessageId?: string;
    mentions?: MessageMention[];
    attachment?: { name: string; mime: string; content: string };
  },
) {
  const { client, chat } = await writableBeeperChat(userId, input.chatId);
  let text = input.text;
  if (input.mentions?.length) {
    const people = await mentionParticipants(userId, chat.id);
    if (!people.supported)
      throw new SafeError(
        "This app does not support mentions in this conversation.",
      );
    try {
      text = nativeMentionText(input.text, input.mentions, people.participants);
    } catch (error) {
      throw new SafeError(
        error instanceof Error ? error.message : "Choose the mention again.",
      );
    }
  }
  if (input.replyToMessageId) {
    const target = await client.messages.retrieve(input.replyToMessageId, {
      chatID: chat.id,
    });
    if (
      target.chatID !== chat.id ||
      !messageActionCapabilities(target, chat.capabilities, chat.isReadOnly)
        .canReply
    )
      throw new SafeError(
        "Replying to this message is not supported or the original message is no longer available.",
      );
  }
  await mkdir(resolve(beeperDirectory(), "receipts"), { recursive: true });
  const file = resolve(
    beeperDirectory(),
    "receipts",
    `${input.requestId}.json`,
  );
  const digest = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  try {
    await writeFile(file, JSON.stringify({ digest, phase: "attempted" }), {
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let receipt: {
      digest: string;
      result?: { pendingMessageID: string; chatID: string };
    };
    try {
      receipt = JSON.parse(await readFile(file, "utf8"));
    } catch {
      throw new SafeError(
        "This message is already being submitted. Wait and check the conversation before retrying.",
      );
    }
    if (receipt.digest !== digest)
      throw new SafeError(
        "This send request already belongs to another message.",
      );
    if (receipt.result)
      return receipt.result as { pendingMessageID: string; chatID: string };
    throw new SafeError(
      "Delivery could not be confirmed. Check the conversation before trying again.",
    );
  }
  try {
    let uploadID: string | undefined;
    if (input.attachment) {
      const result = await client.assets.uploadBase64({
        content: input.attachment.content,
        fileName: input.attachment.name,
        mimeType: input.attachment.mime,
      });
      if (!result.uploadID || result.error)
        throw new SafeError("The attachment could not be uploaded.");
      uploadID = result.uploadID;
    }
    const result = await client.messages.send(input.chatId, {
      text: text
        ? beeperDraftText(text, Boolean(input.mentions?.length))
        : undefined,
      ...(input.replyToMessageId
        ? { replyToMessageID: input.replyToMessageId }
        : {}),
      ...(uploadID ? { attachment: { uploadID } } : {}),
    });
    await writeFile(
      file,
      JSON.stringify({ digest, phase: "submitted", result }),
      { mode: 0o600 },
    );
    return result;
  } catch {
    throw new SafeError(
      "Delivery could not be confirmed. Check the conversation before trying again. Your draft is still here.",
    );
  }
}

export async function writableBeeperChat(userId: string, chatId: string) {
  const result = await allowedChat(userId, chatId);
  if (result.chat.isReadOnly)
    throw new SafeError("This conversation is read-only.");
  return result;
}
export async function messageAsset(
  userId: string,
  chatId: string,
  messageId: string,
  index: number,
  range: string | null,
) {
  const { client } = await allowedChat(userId, chatId);
  const message = await client.messages.retrieve(messageId, { chatID: chatId });
  const attachment = message.attachments?.[index];
  const url = [attachment?.id, attachment?.srcURL].find(
    (value) => value && /^(mxc|localmxc):\/\//.test(value),
  );
  if (!attachment || !url)
    throw new SafeError("This attachment is not available locally.");
  const result = await client.assets.serve(
    { url },
    { headers: range && /^bytes=\d*-\d*$/.test(range) ? { Range: range } : {} },
  );
  const mime =
    attachment.mimeType?.split(";")[0].trim().toLowerCase() ||
    "application/octet-stream";
  const inline =
    /^(image\/(png|jpeg|gif|webp|avif)|audio\/[a-z0-9.+-]+|video\/[a-z0-9.+-]+)$/i.test(
      mime,
    );
  const headers = new Headers({
    "Content-Type": inline ? mime : "application/octet-stream",
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(attachment.fileName || "attachment")}`,
  });
  for (const key of ["content-range", "accept-ranges", "content-length"]) {
    const value = result.headers.get(key);
    if (value) headers.set(key, value);
  }
  return new Response(result.body, { status: result.status, headers });
}
function plainText(text?: string, includeLinks = false) {
  return text
    ? convert(text, {
        wordwrap: false,
        selectors: [
          {
            selector: "a",
            options: {
              ignoreHref: !includeLinks,
              hideLinkHrefIfSameAsText: true,
            },
          },
        ],
      })
    : "";
}
function previewText(message?: Message) {
  if (!message) return "No messages yet";
  if (message.isDeleted) return "Message deleted";
  return (
    plainText(message.text) ||
    message.attachments
      ?.map((item) =>
        item.isVoiceNote ? "Voice message" : item.fileName || item.type,
      )
      .join(", ") ||
    "Message"
  );
}
function messageRow(message: Message, chat?: Chat): ChatMessage {
  const self = new Set(
    (chat?.participants?.items ?? [])
      .filter((person) => person.isSelf)
      .map((person) => person.id),
  );
  // Beeper includes the sender's own read marker in outgoing receipt maps.
  // Only another participant can confirm that an outgoing message was read.
  const seen =
    typeof message.seen === "object" && message.seen
      ? Object.fromEntries(
          Object.entries(message.seen).filter(
            ([id]) =>
              !self.has(id) && (!message.isSender || id !== message.senderID),
          ),
        )
      : message.seen;
  const reactions = new Map<
    string,
    { key: string; count: number; mine: boolean }
  >();
  for (const reaction of message.reactions ?? []) {
    const entry = reactions.get(reaction.reactionKey) ?? {
      key: reaction.reactionKey,
      count: 0,
      mine: false,
    };
    entry.count++;
    entry.mine ||= self.has(reaction.participantID);
    reactions.set(entry.key, entry);
  }
  return {
    id: message.id,
    chatId: message.chatID,
    sender: message.senderName || message.senderID,
    text: plainText(message.text, true),
    editRevision: createHash("sha256")
      .update(
        JSON.stringify([
          message.id,
          message.text ?? "",
          message.editedTimestamp ?? null,
        ]),
      )
      .digest("hex"),
    editedAt: message.editedTimestamp,
    replyToMessageId: message.linkedMessageID,
    time: message.timestamp,
    outgoing: Boolean(message.isSender),
    deleted: Boolean(message.isDeleted),
    status: message.sendStatus?.status,
    readReceipts: chat?.capabilities?.readReceipts === true,
    seen: chat?.capabilities?.readReceipts === true ? seen : undefined,
    ...messageActionCapabilities(message, chat?.capabilities, chat?.isReadOnly),
    reactions: [...reactions.values()],
    links: (message.links ?? [])
      .flatMap((link) => {
        const url = webLinkUrl(link.originalURL || link.url);
        return url
          ? [
              {
                url,
                title: (link.title || "").slice(0, 500),
                description: link.summary?.slice(0, 1000),
                image: link.img
                  ? (webLinkUrl(link.img) ?? undefined)
                  : undefined,
              },
            ]
          : [];
      })
      .slice(0, 3),
    attachments: (message.attachments ?? []).map((item, index) => ({
      name: item.fileName || "Attachment",
      mime: item.mimeType || "",
      type: item.type,
      index,
    })),
  };
}
