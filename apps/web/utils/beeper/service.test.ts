import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/utils/contacts/directory", () => ({
  contactDirectory: async () => ({ accounts: [] }),
}));

const { files, api, configuration } = vi.hoisted(() => ({
  files: new Map<string, string>(),
  configuration: {
    LOCAL_BEEPER_ENABLED: "true",
    LOCAL_BEEPER_OWNER_ID: "owner",
  },
  api: {
    info: { retrieve: vi.fn() },
    accounts: { list: vi.fn() },
    chats: {
      retrieve: vi.fn(),
      list: vi.fn(),
      markRead: vi.fn(),
      messages: { reactions: { add: vi.fn(), delete: vi.fn() } },
    },
    messages: {
      send: vi.fn(),
      retrieve: vi.fn(),
      list: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    assets: { uploadBase64: vi.fn(), serve: vi.fn() },
  },
}));
vi.mock("./session-recovery", () => ({
  ensureBeeperSession: async () => ({
    phase: "ready",
    message: "Beeper is ready.",
  }),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/env", () => ({ env: configuration }));
vi.mock("@/utils/encryption", () => ({
  encryptToken: () => "v1:encrypted",
  decryptToken: () => "synthetic-test-token",
}));
vi.mock("@beeper/desktop-api", () => ({
  default: vi.fn(function () {
    return api;
  }),
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(async (path: string) => {
    if (path.endsWith("connection.json"))
      return JSON.stringify({
        owner: "owner",
        token: "v1:encrypted",
        groups: [],
      });
    if (files.has(path)) return files.get(path);
    throw Object.assign(new Error("Missing"), { code: "ENOENT" });
  }),
  writeFile: vi.fn(
    async (path: string, content: string, options?: { flag?: string }) => {
      if (options?.flag === "wx" && files.has(path))
        throw Object.assign(new Error("Exists"), { code: "EEXIST" });
      files.set(path, content);
    },
  ),
  rename: vi.fn(),
}));
import {
  beeperStatus,
  listConversations,
  listMessages,
  messageAsset,
  sendMessage,
  recallMessage,
  reactToMessage,
  editMessage,
  messageLinkPreviews,
  mentionParticipants,
  getConversationInviteContext,
} from "./service";

const chat = {
  id: "chat",
  accountID: "account",
  network: "WhatsApp",
  type: "single",
  title: "Test",
  participants: { items: [], total: 2, hasMore: false },
  unreadCount: 0,
};
beforeEach(() => {
  vi.clearAllMocks();
  files.clear();
  configuration.LOCAL_BEEPER_ENABLED = "true";
  api.chats.retrieve.mockResolvedValue(chat);
  api.accounts.list.mockResolvedValue([]);
  api.messages.send.mockResolvedValue({
    pendingMessageID: "pending",
    chatID: "chat",
  });
});
describe("local Beeper integration", () => {
  it("protects literal outer quotes at the Beeper send boundary", async () => {
    await sendMessage("owner", {
      chatId: "chat",
      requestId: "67814386-9b49-4ca4-923b-5cc8abec1d56",
      text: '"clean"',
    });
    expect(api.messages.send).toHaveBeenCalledWith("chat", {
      text: JSON.stringify('<p>"clean"</p>'),
    });
  });
  it("uses the same verified account identity in conversation titles and imported participant context", async () => {
    const selfChat = {
      ...chat,
      title: "+1 (555) 555-0123",
      participants: {
        items: [
          {
            id: "peer-alias",
            fullName: "+1 (555) 555-0123",
            phoneNumber: "+15555550123",
            isSelf: false,
          },
        ],
        total: 1,
        hasMore: false,
      },
    };
    api.accounts.list.mockResolvedValue([
      {
        accountID: "account",
        network: "WhatsApp",
        user: {
          id: "15555550123",
          fullName: "Account Owner",
          phoneNumber: "+15555550123",
        },
      },
    ]);
    api.chats.retrieve.mockResolvedValue(selfChat);
    api.chats.list.mockResolvedValue({ items: [selfChat], hasMore: false });
    api.messages.list.mockResolvedValue({ items: [], hasMore: false });
    expect((await listConversations("owner")).items[0].title).toBe(
      "Account Owner",
    );
    expect(
      (await getConversationInviteContext("owner", "chat")).participants[0],
    ).toMatchObject({ name: "Account Owner", phoneNumber: "+15555550123" });
  });
  it("loads complete mention participants and sends a selected native WhatsApp mention without changing visible text", async () => {
    const participant = { id: "@whatsapp_123:beeper.com", fullName: "Alex" };
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { formatting: { user_link: 2 } },
      participants: {
        items: [
          participant,
          { id: "@self:beeper.com", fullName: "Me", isSelf: true },
        ],
        hasMore: false,
        total: 2,
      },
    });
    expect(await mentionParticipants("owner", "chat")).toEqual({
      supported: true,
      participants: [
        { id: participant.id, label: "Alex", username: undefined },
      ],
    });
    const input = {
      chatId: "chat",
      requestId: "ca5e1422-d5e1-4bcc-8c3e-c730c1932789",
      text: "Hi @Alex",
      mentions: [{ userId: participant.id, label: "Alex", start: 3, end: 8 }],
    };
    await sendMessage("owner", input);
    expect(api.messages.send).toHaveBeenCalledWith("chat", {
      text: "Hi [@Alex](https://matrix.to/#/@whatsapp_123%3Abeeper.com)",
    });
    expect(input.text).toBe("Hi @Alex");
  });
  it("requests every participant beyond Beeper's default page and blocks unsupported or forged native mentions", async () => {
    const base = {
      ...chat,
      capabilities: { formatting: { user_link: 2 } },
      participants: { items: [], hasMore: true, total: 101 },
    };
    api.chats.retrieve.mockResolvedValueOnce(base).mockResolvedValueOnce({
      ...base,
      participants: {
        ...base.participants,
        hasMore: false,
        items: [{ id: "@whatsapp_999:beeper.com", fullName: "Last member" }],
      },
    });
    const result = await mentionParticipants("owner", "chat");
    expect(result.participants[0].label).toBe("Last member");
    expect(api.chats.retrieve).toHaveBeenCalledWith("chat", {
      maxParticipantCount: -1,
    });
    const input = {
      chatId: "chat",
      requestId: "ca5e1422-d5e1-4bcc-8c3e-c730c1932789",
      text: "@Someone",
      mentions: [
        { userId: "@other:beeper.com", label: "Someone", start: 0, end: 8 },
      ],
    };
    api.chats.retrieve.mockResolvedValue(chat);
    await expect(sendMessage("owner", input)).rejects.toThrow(
      "does not support mentions",
    );
    api.chats.retrieve.mockResolvedValue({
      ...base,
      participants: { items: [], hasMore: false, total: 0 },
    });
    await expect(sendMessage("owner", input)).rejects.toThrow(
      "selected mention changed",
    );
    expect(api.messages.send).not.toHaveBeenCalled();
  });
  it("edits supported outgoing text using the native API and returns the provider's edited timestamp", async () => {
    const message = {
      id: "edit-me",
      chatID: "chat",
      senderID: "self",
      text: "Original text",
      isSender: true,
      timestamp: new Date().toISOString(),
    };
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      network: "Discord",
      capabilities: { edit: 2 },
    });
    api.messages.list.mockResolvedValue({ items: [message], hasMore: false });
    api.messages.retrieve.mockResolvedValue(message);
    const row = (await listMessages("owner", "chat")).items[0];
    expect(row.canEdit).toBe(true);
    const editedTimestamp = new Date().toISOString();
    api.messages.update.mockResolvedValue({
      ...message,
      text: "Corrected text",
      editedTimestamp,
    });
    const result = await editMessage("owner", {
      chatId: "chat",
      messageId: message.id,
      text: "Corrected text",
      revision: row.editRevision!,
    });
    expect(result).toMatchObject({
      id: message.id,
      text: "Corrected text",
      editedAt: editedTimestamp,
    });
    expect(result.editRevision).not.toBe(row.editRevision);
    expect(api.messages.update).toHaveBeenCalledWith(
      message.id,
      { chatID: "chat", text: "Corrected text" },
      { maxRetries: 0 },
    );
    expect(api.messages.send).not.toHaveBeenCalled();
  });
  it("rejects edits when ownership, supported features, or the provider's edit window no longer allow them", async () => {
    const message = {
      id: "m",
      chatID: "chat",
      senderID: "self",
      text: "Original",
      isSender: true,
      timestamp: new Date().toISOString(),
    };
    for (const [extra, capabilities, readOnly] of [
      [{ isSender: false }, { edit: 2 }, false],
      [{ attachments: [{}] }, { edit: 2 }, false],
      [{ isDeleted: true }, { edit: 2 }, false],
      [{}, { edit: 0 }, false],
      [
        { timestamp: new Date(Date.now() - 120_000).toISOString() },
        { edit: 2, editMaxAge: 60 },
        false,
      ],
      [{}, { edit: 2 }, true],
    ] as const) {
      api.chats.retrieve.mockResolvedValue({
        ...chat,
        capabilities,
        isReadOnly: readOnly,
      });
      api.messages.retrieve.mockResolvedValue({ ...message, ...extra });
      await expect(
        editMessage("owner", {
          chatId: "chat",
          messageId: "m",
          text: "Change",
          revision: "a".repeat(64),
        }),
      ).rejects.toThrow("can’t be edited");
    }
    expect(api.messages.update).not.toHaveBeenCalled();
  });
  it("preserves concurrent edits and rejects mismatched conversations and other users", async () => {
    const message = {
      id: "m",
      chatID: "chat",
      senderID: "self",
      text: "Original",
      isSender: true,
      timestamp: new Date().toISOString(),
    };
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { edit: 2 },
    });
    api.messages.list.mockResolvedValue({ items: [message], hasMore: false });
    const row = (await listMessages("owner", "chat")).items[0],
      input = {
        chatId: "chat",
        messageId: "m",
        text: "My edit",
        revision: row.editRevision!,
      };
    api.messages.retrieve.mockResolvedValue({
      ...message,
      text: "Changed on phone",
    });
    await expect(editMessage("owner", input)).rejects.toThrow(
      "changed elsewhere",
    );
    api.messages.retrieve.mockResolvedValue({
      ...message,
      chatID: "other-chat",
    });
    await expect(editMessage("owner", input)).rejects.toThrow(
      "not in this conversation",
    );
    await expect(editMessage("someone-else", input)).rejects.toThrow(
      "configured owner",
    );
    expect(api.messages.update).not.toHaveBeenCalled();
  });
  it("avoids unchanged edits, enforces text limits, and reports unconfirmed edits without retrying or sending a new message", async () => {
    const message = {
      id: "m",
      chatID: "chat",
      senderID: "self",
      text: "Original",
      isSender: true,
      timestamp: new Date().toISOString(),
    };
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { edit: 2, maxTextLength: 20 },
    });
    api.messages.list.mockResolvedValue({ items: [message], hasMore: false });
    api.messages.retrieve.mockResolvedValue(message);
    const row = (await listMessages("owner", "chat")).items[0],
      input = {
        chatId: "chat",
        messageId: "m",
        text: "Original",
        revision: row.editRevision!,
      };
    await editMessage("owner", input);
    expect(api.messages.update).not.toHaveBeenCalled();
    await expect(
      editMessage("owner", { ...input, text: "a".repeat(21) }),
    ).rejects.toThrow("text limit");
    api.messages.update.mockRejectedValue(new Error("Network timeout"));
    await expect(
      editMessage("owner", { ...input, text: "An edit" }),
    ).rejects.toThrow("could not be confirmed");
    expect(api.messages.update).toHaveBeenCalledTimes(1);
    expect(api.messages.send).not.toHaveBeenCalled();
  });
  it("preserves native link cards and formatted link destinations", async () => {
    api.messages.list.mockResolvedValue({
      items: [
        {
          id: "m",
          chatID: "chat",
          senderID: "someone",
          timestamp: new Date().toISOString(),
          text: '<p>See <a href="https://example.org/article">this article</a></p>',
          links: [
            {
              url: "https://example.org/article",
              title: "Article",
              summary: "Summary",
              img: "https://cdn.example.org/card.png",
            },
          ],
        },
      ],
      hasMore: false,
    });
    const row = (await listMessages("owner", "chat")).items[0];
    expect(row.text).toContain("https://example.org/article");
    expect(row.links).toEqual([
      {
        url: "https://example.org/article",
        title: "Article",
        description: "Summary",
        image: "https://cdn.example.org/card.png",
      },
    ]);
  });
  it("does not fetch previews from deleted messages or another user's chats", async () => {
    api.messages.retrieve.mockResolvedValue({ isDeleted: true });
    expect(await messageLinkPreviews("owner", "chat", "deleted")).toEqual([]);
    await expect(
      messageLinkPreviews("other-user", "chat", "message"),
    ).rejects.toThrow("configured owner");
    expect(api.messages.retrieve).toHaveBeenCalledTimes(1);
  });
  it("preserves actual read receipts and hides explicitly unsupported read status", async () => {
    const message = {
      id: "message",
      chatID: "chat",
      senderID: "self",
      isSender: true,
      timestamp: new Date().toISOString(),
      seen: true,
    };
    api.messages.list.mockResolvedValue({ items: [message], hasMore: false });
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { readReceipts: true },
    });
    expect((await listMessages("owner", "chat")).items[0].seen).toBe(true);
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { readReceipts: false },
    });
    expect((await listMessages("owner", "chat")).items[0].seen).toBeUndefined();
    api.chats.retrieve.mockResolvedValue(chat);
    expect((await listMessages("owner", "chat")).items[0].seen).toBeUndefined();
  });
  it("excludes the sender and all self profiles from read receipts, preserving recipient receipts", async () => {
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { readReceipts: true },
      participants: {
        items: [
          { id: "self-device", isSelf: true },
          { id: "recipient", isSelf: false },
        ],
      },
    });
    const base = {
      id: "message",
      chatID: "chat",
      senderID: "sender",
      isSender: true,
      timestamp: new Date().toISOString(),
    };
    api.messages.list.mockResolvedValue({
      items: [
        {
          ...base,
          seen: { sender: true, "self-device": "2026-11-12T10:00:00Z" },
        },
      ],
      hasMore: false,
    });
    expect((await listMessages("owner", "chat")).items[0].seen).toEqual({});
    api.messages.list.mockResolvedValue({
      items: [
        {
          ...base,
          seen: {
            sender: true,
            "self-device": true,
            recipient: "2026-11-12T11:00:00Z",
          },
        },
      ],
      hasMore: false,
    });
    expect((await listMessages("owner", "chat")).items[0].seen).toEqual({
      recipient: "2026-11-12T11:00:00Z",
    });
    api.messages.list.mockResolvedValue({
      items: [
        {
          ...base,
          isSender: false,
          senderID: "recipient",
          seen: { recipient: true, "self-device": true },
        },
      ],
      hasMore: false,
    });
    expect((await listMessages("owner", "chat")).items[0].seen).toEqual({
      recipient: true,
    });
  });
  it("recalls only the sender's supported message, for everyone", async () => {
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { delete: 2, deleteMaxAge: 60 },
    });
    api.messages.retrieve.mockResolvedValue({
      id: "final-id",
      isSender: true,
      timestamp: new Date().toISOString(),
    });
    await recallMessage("owner", { chatId: "chat", messageId: "final-id" });
    expect(api.messages.delete).toHaveBeenCalledWith("final-id", {
      chatID: "chat",
      forEveryone: true,
    });
    api.messages.retrieve.mockResolvedValue({
      id: "incoming",
      isSender: false,
      timestamp: new Date().toISOString(),
    });
    await expect(
      recallMessage("owner", { chatId: "chat", messageId: "incoming" }),
    ).rejects.toThrow("can’t be recalled");
    expect(api.messages.delete).toHaveBeenCalledTimes(1);
  });
  it("enforces reaction support and allowed emoji, and removes only the user's reaction", async () => {
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { reaction: 2, allowedReactions: ["👍"] },
    });
    api.messages.retrieve.mockResolvedValue({
      id: "message",
      timestamp: new Date().toISOString(),
    });
    const input = {
      chatId: "chat",
      messageId: "message",
      reactionKey: "👍",
      requestId: "request",
      remove: false,
    };
    await reactToMessage("owner", input);
    expect(api.chats.messages.reactions.add).toHaveBeenCalledWith("message", {
      chatID: "chat",
      reactionKey: "👍",
      transactionID: "request",
    });
    await reactToMessage("owner", { ...input, remove: true });
    expect(api.chats.messages.reactions.delete).toHaveBeenCalledWith("👍", {
      chatID: "chat",
      messageID: "message",
    });
    await expect(
      reactToMessage("owner", { ...input, reactionKey: "❤️" }),
    ).rejects.toThrow("does not support");
    api.chats.retrieve.mockResolvedValue(chat);
    await expect(reactToMessage("owner", input)).rejects.toThrow(
      "not available",
    );
    expect(api.chats.messages.reactions.add).toHaveBeenCalledTimes(1);
  });
  it("rejects other app users before accessing Beeper or local credentials", async () => {
    await expect(beeperStatus("other-user")).rejects.toThrow(
      "configured owner",
    );
    expect(api.accounts.list).not.toHaveBeenCalled();
  });
  it("filters server channels from lists and rejects direct thread access", async () => {
    const server = {
      ...chat,
      id: "server",
      accountID: "discordgo",
      network: "Renamed account",
      type: "group",
    };
    api.chats.list.mockResolvedValue({
      items: [chat, server, { ...chat, id: "group", type: "group" }],
      hasMore: false,
      oldestCursor: null,
    });
    expect(
      (await listConversations("owner")).items.map((item) => item.id),
    ).toEqual(["chat", "group"]);
    api.chats.retrieve.mockResolvedValue(server);
    await expect(listMessages("owner", "server")).rejects.toThrow("excluded");
    expect(api.messages.list).not.toHaveBeenCalled();
  });
  it("deduplicates repeated send requests using a durable receipt", async () => {
    const input = {
      chatId: "chat",
      requestId: "b75fe6a5-3c73-4d42-8fd5-0fd1295d8dc4",
      text: "Synthetic test",
    };
    const first = await sendMessage("owner", input);
    expect(await sendMessage("owner", input)).toEqual(first);
    expect(api.messages.send).toHaveBeenCalledTimes(1);
    await expect(
      sendMessage("owner", { ...input, text: "Different" }),
    ).rejects.toThrow("another message");
  });
  it("never retries an ambiguous network submission", async () => {
    const input = {
      chatId: "chat",
      requestId: "b75fe6a5-3c73-4d42-8fd5-0fd1295d8dc4",
      text: "Synthetic test",
    };
    api.messages.send.mockRejectedValueOnce(
      new Error("Connection lost after submission"),
    );
    await expect(sendMessage("owner", input)).rejects.toThrow(
      "could not be confirmed",
    );
    await expect(sendMessage("owner", input)).rejects.toThrow(
      "could not be confirmed",
    );
    expect(api.messages.send).toHaveBeenCalledTimes(1);
  });
  it("sends replies with the native reply target and preserves send deduplication", async () => {
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { reply: 2 },
    });
    api.messages.retrieve.mockResolvedValue({ id: "original", chatID: "chat" });
    const input = {
      chatId: "chat",
      requestId: "7627ce84-d02e-49a3-897e-c608b95958e8",
      text: "Synthetic reply",
      replyToMessageId: "original",
    };
    await sendMessage("owner", input);
    await sendMessage("owner", input);
    expect(api.messages.send).toHaveBeenCalledExactlyOnceWith("chat", {
      text: "Synthetic reply",
      replyToMessageID: "original",
    });
  });
  it("rejects unsupported replies and targets outside the conversation before sending", async () => {
    const input = {
      chatId: "chat",
      requestId: "7627ce84-d02e-49a3-897e-c608b95958e8",
      text: "Synthetic reply",
      replyToMessageId: "original",
    };
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { reply: 0 },
    });
    api.messages.retrieve.mockResolvedValue({ id: "original", chatID: "chat" });
    await expect(sendMessage("owner", input)).rejects.toThrow("not supported");
    api.chats.retrieve.mockResolvedValue({
      ...chat,
      capabilities: { reply: 2 },
    });
    api.messages.retrieve.mockResolvedValue({
      id: "original",
      chatID: "another-chat",
    });
    await expect(sendMessage("owner", input)).rejects.toThrow("not supported");
    expect(api.messages.send).not.toHaveBeenCalled();
  });
  it("resolves media only from an authorized message's actual attachments", async () => {
    api.messages.retrieve.mockResolvedValue({ attachments: [] });
    await expect(
      messageAsset("owner", "chat", "message", 0, null),
    ).rejects.toThrow("not available");
    expect(api.assets.serve).not.toHaveBeenCalled();
  });
  it("does not expose local files through attachment metadata", async () => {
    api.messages.retrieve.mockResolvedValue({
      attachments: [{ id: "file:///C:/private/secret.txt" }],
    });
    await expect(
      messageAsset("owner", "chat", "message", 0, null),
    ).rejects.toThrow("not available");
    expect(api.assets.serve).not.toHaveBeenCalled();
  });
});
