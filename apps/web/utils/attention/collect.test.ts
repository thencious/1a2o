import { beforeEach, afterEach, expect, it, vi } from "vitest";
import type { AttentionState } from "./types";
const mocks = vi.hoisted(() => ({
  state: {} as AttentionState,
  mail: vi.fn(),
  messages: vi.fn(),
  tasks: vi.fn(),
  agents: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma", () => ({
  default: {
    emailAccount: {
      findMany: async () => [
        {
          id: "account",
          email: "owner@example.test",
          account: { provider: "google" },
        },
      ],
    },
  },
}));
vi.mock("@/utils/email/provider", () => ({
  createEmailProvider: async () => ({ getMessagesWithPagination: mocks.mail }),
}));
vi.mock("@/utils/beeper/connection", () => ({
  beeperSession: async () => ({
    settings: { groups: [] },
    client: {
      messages: { search: mocks.messages },
      chats: {
        retrieve: async () => ({
          id: "chat",
          title: "Sample chat",
          accountID: "whatsapp",
          network: "WhatsApp",
          type: "single",
        }),
      },
    },
  }),
}));
vi.mock("@/utils/todo/storage", () => ({ getTodoState: mocks.tasks }));
vi.mock("@/utils/todo/integration-store", () => ({
  getTodoIntegration: async () => ({}),
}));
vi.mock("./agents", () => ({ readAgentAttention: mocks.agents }));
vi.mock("./store", () => ({
  readAttention: async () => structuredClone(mocks.state),
  updateAttention: async (
    _user: string,
    change: (value: AttentionState) => unknown,
  ) => change(mocks.state),
}));
import { createScopedLogger } from "@/utils/logger";
import { collectAttention } from "./collect";
const now = Date.parse("2026-11-02T12:00:00Z");
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
  vi.stubEnv("LOCAL_BEEPER_ENABLED", "true");
  vi.stubEnv("LOCAL_AGENTS_ENABLED", "true");
  mocks.state = {
    startedAt: now - 60_000,
    checkpoints: {},
    events: {},
    agents: {},
  };
  mocks.mail.mockReset().mockResolvedValue({ messages: [] });
  mocks.messages.mockReset().mockResolvedValue({ items: [], hasMore: false });
  mocks.tasks.mockReset().mockResolvedValue({ tasks: [] });
  mocks.agents.mockReset().mockResolvedValue([]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
it("collects new incoming events and due tasks once without replaying old mail or sent messages", async () => {
  const mail = {
    id: "mail",
    threadId: "thread",
    internalDate: String(now - 1000),
    headers: { from: "Sender" },
    subject: "Subject",
  };
  mocks.mail.mockResolvedValue({
    messages: [
      mail,
      { ...mail, id: "old", internalDate: String(now - 120_000) },
      { ...mail, id: "spam", labelIds: ["SPAM"] },
    ],
  });
  const message = {
    id: "message",
    chatID: "chat",
    timestamp: new Date(now - 1000).toISOString(),
    text: "Hello",
  };
  mocks.messages.mockResolvedValue({
    items: [
      message,
      { ...message, id: "sent", isSender: true },
      { ...message, id: "read", isUnread: false },
    ],
    hasMore: false,
  });
  mocks.tasks.mockResolvedValue({
    tasks: [
      {
        id: "task",
        title: "Sample task",
        createdAt: now - 30_000,
        deadline: { at: now + 3_600_000 },
        estimatedSeconds: 3601,
      },
    ],
  });
  const logger = createScopedLogger("attention-test");
  const first = await collectAttention("owner", logger);
  expect(first.counts).toMatchObject({ mail: 1, messages: 1, todo: 1 });
  expect(first.events).toHaveLength(3);
  const again = await collectAttention("owner", logger);
  expect(again.events).toHaveLength(3);
  mocks.state.events[first.events[0].id].deliveredAt = now;
  expect((await collectAttention("owner", logger)).events).toHaveLength(2);
});
it("ignores stale unread messages returned outside the requested checkpoint window", async () => {
  mocks.state.startedAt = now - 24 * 60 * 60_000;
  mocks.state.checkpoints.messages = now - 5000;
  mocks.messages.mockResolvedValue({
    items: [
      {
        id: "stale-unread",
        chatID: "chat",
        timestamp: new Date(now - 3_600_000).toISOString(),
        isUnread: true,
        text: "Old",
      },
    ],
    hasMore: false,
  });
  const result = await collectAttention(
    "owner",
    createScopedLogger("attention-test"),
  );
  expect(result.events).toEqual([]);
  expect(result.counts.messages).toBe(0);
});
it("keeps the failed source's checkpoint so delivery can catch up", async () => {
  mocks.state.checkpoints["mail:account"] = now - 30_000;
  mocks.mail.mockRejectedValue(new Error("temporarily unavailable"));
  const result = await collectAttention(
    "owner",
    createScopedLogger("attention-test"),
  );
  expect(result.errors).toContain(
    "Mail notification source is temporarily unavailable.",
  );
  expect(mocks.state.checkpoints["mail:account"]).toBe(now - 30_000);
  expect(mocks.state.checkpoints.messages).toBe(now);
});
it("uses the latest focused conversation even when it changes during provider collection", async () => {
  mocks.messages.mockImplementation(async () => {
    mocks.state.messageViews = {
      window: { chatId: "chat", active: true, sequence: 1, at: now },
    };
    return {
      items: [
        {
          id: "incoming",
          chatID: "chat",
          timestamp: new Date(now - 1000).toISOString(),
          text: "Hello",
        },
      ],
      hasMore: false,
    };
  });
  const result = await collectAttention(
    "owner",
    createScopedLogger("attention-test"),
  );
  expect(result.events).toEqual([]);
  expect(result.counts.messages).toBe(0);
  expect(Object.values(mocks.state.events)).toHaveLength(1);
  expect(Object.values(mocks.state.events)[0].readAt).toBe(now);
});
