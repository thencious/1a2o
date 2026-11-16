import { beforeEach, expect, it, vi } from "vitest";
import { createScopedLogger } from "@/utils/logger";
const state = vi.hoisted(() => ({
  saved: vi.fn(),
  get: vi.fn(),
  mail: vi.fn(),
  query: vi.fn(),
  sync: vi.fn(),
  source: vi.fn(),
  asset: vi.fn(),
  send: vi.fn(),
  append: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma", () => ({
  default: {
    emailAccount: { findMany: vi.fn(async () => []), findFirst: state.query },
  },
}));
vi.mock("@/utils/todo/storage", () => ({
  getTodoState: state.get,
  saveTodoState: state.saved,
  appendWorkspaceItem: state.append,
}));
vi.mock("@/utils/todo/preferences", () => ({
  getTodoPreferences: async () => ({
    ntfyTopic: "private-topic",
    timezone: "UTC",
  }),
  saveTodoPreferences: vi.fn(),
}));
vi.mock("@/utils/todo/integration-store", () => ({
  getTodoIntegration: async () => ({
    rulesRevision: "rules-v1",
    taskRules: [],
  }),
  updateTodoIntegration: vi.fn(),
}));
vi.mock("@/utils/todo/calendar-service", () => ({
  syncTodoCalendar: state.sync,
}));
vi.mock("@/utils/todo/reminders", () => ({ runTodoReminders: vi.fn() }));
vi.mock("@/utils/todo/ai", () => ({ requestTodoAnalysis: vi.fn() }));
vi.mock("@/utils/contacts/directory", () => ({
  contactDirectory: async () => ({ accounts: [] }),
}));
vi.mock("@/utils/contacts/local-store", () => ({
  updateSavedContacts: vi.fn(),
}));
vi.mock("@/utils/contacts/email-store", () => ({ syncEmailContacts: vi.fn() }));
vi.mock("@/utils/beeper/contacts", () => ({ syncBeeperContacts: vi.fn() }));
vi.mock("@/utils/linkedin/contacts", () => ({ syncLinkedInContacts: vi.fn() }));
vi.mock("@/utils/beeper/service", () => ({
  listConversations: vi.fn(),
  getConversationMessage: state.source,
  messageAsset: state.asset,
  listMessages: vi.fn(),
  markConversationRead: vi.fn(),
  sendMessage: state.send,
  recallMessage: vi.fn(),
  reactToMessage: vi.fn(),
  messageReceipt: vi.fn(),
  discordGroups: vi.fn(),
  setDiscordGroup: vi.fn(),
  messageLinkPreviews: vi.fn(),
}));
vi.mock("@/utils/messages/add-contacts-service", () => ({
  addConversationContacts: vi.fn(),
}));
vi.mock("@/utils/messages/invite-service", () => ({
  prepareConversationInvite: vi.fn(),
}));
vi.mock("@/utils/calendar/month-service", () => ({
  getCalendarCatalog: vi.fn(),
  getCalendarMonth: vi.fn(),
  saveMonthEvent: vi.fn(),
  deleteMonthEvent: vi.fn(),
}));
vi.mock("@/utils/calendar/defaults-store", () => ({
  getCalendarDefaults: vi.fn(),
  setCalendarDefaults: vi.fn(),
}));
vi.mock("@/utils/calendar/visibility-store", () => ({
  getCalendarVisibility: vi.fn(),
  setCalendarVisibility: vi.fn(),
}));
vi.mock("@/utils/automation/local-rules-service", () => ({
  getLocalRules: vi.fn(),
  setLocalRules: vi.fn(),
  testLocalRules: vi.fn(),
}));
vi.mock("@/utils/agents/service", () => ({ localAgentsRequest: vi.fn() }));
vi.mock("@/utils/attention/agents", () => ({ readAgentAttention: vi.fn() }));
vi.mock("@/utils/openrouter-usage", () => ({ getOpenRouterUsage: vi.fn() }));
vi.mock("./chat-inbox-tools", async () => {
  const { z } = await import("zod");
  const factory = () => ({
    inputSchema: z.object({ query: z.string() }),
    execute: state.mail,
  });
  return {
    getAccountOverviewTool: factory,
    searchInboxTool: factory,
    readEmailTool: factory,
    readAttachmentTool: factory,
  };
});
import { zenroTools } from "./zenro-tools";
const options = { toolCallId: "test", messages: [] };
beforeEach(() => {
  vi.clearAllMocks();
  state.get.mockResolvedValue({
    revision: "v1",
    tasks: [
      {
        id: "task",
        title: "Original",
        notes: "Details",
        createdAt: 1,
        completedAt: null,
        customMetadata: "preserve",
      },
      { id: "other", title: "Other", notes: "", createdAt: 2 },
    ],
  });
  state.saved.mockResolvedValue({ revision: "v2" });
});
it("discovers every app domain and supplies validated per-domain schemas, including Notes", async () => {
  const tools = zenroTools("owner", createScopedLogger("test"));
  const catalog = await tools.discoverZenroTools.execute!({}, options);
  if (!Array.isArray(catalog)) throw new Error("Expected a tool catalog.");
  expect(new Set(catalog.map((action) => action.domain))).toEqual(
    new Set([
      "mail",
      "tasks",
      "messages",
      "contacts",
      "calendars",
      "settings",
      "rules",
      "agents",
      "usage",
    ]),
  );
  const notes = await tools.discoverZenroTools.execute!(
    { domain: "notes" },
    options,
  );
  if (!Array.isArray(notes)) throw new Error("Expected a Notes catalog.");
  expect(notes.some((action) => action.name === "workspace.mutate")).toBe(true);
  expect(notes.every((action) => "inputSchema" in action)).toBe(true);
  expect(JSON.stringify(notes)).not.toContain("private-topic");
});
it("edits a single item without dropping unrelated data and rejects stale revisions", async () => {
  const tools = zenroTools("owner", createScopedLogger("test"));
  const input = {
    workspace: "notes",
    operation: "update",
    revision: "v1",
    id: "task",
    title: "Updated",
    userId: "intruder",
  };
  const result = await tools.runZenroTool.execute!(
    { name: "workspace.mutate", input: JSON.stringify(input) },
    options,
  );
  expect(result).toMatchObject({
    changed: true,
    data: { id: "task", revision: "v2" },
  });
  expect(state.get).toHaveBeenCalledWith("owner", "notes");
  const args = state.saved.mock.calls[0];
  expect(args[0]).toBe("owner");
  expect(args[2]).toHaveLength(2);
  expect(args[2][0]).toMatchObject({
    title: "Updated",
    notes: "Details",
    customMetadata: "preserve",
  });
  state.saved.mockClear();
  const failed = await tools.runZenroTool.execute!(
    {
      name: "workspace.mutate",
      input: JSON.stringify({ ...input, revision: "stale" }),
    },
    options,
  );
  expect(failed).toHaveProperty("error");
  expect(state.saved).not.toHaveBeenCalled();
});
it("enforces mailbox ownership, rejects unknown actions and keeps notification credentials out of settings", async () => {
  const tools = zenroTools("owner", createScopedLogger("test"));
  state.query.mockResolvedValue(null);
  const denied = await tools.runZenroTool.execute!(
    {
      name: "mail.read",
      input: JSON.stringify({
        emailAccountId: "other-owner",
        operation: "search",
        input: { query: "anything" },
      }),
    },
    options,
  );
  expect(denied).toHaveProperty("error");
  expect(state.mail).not.toHaveBeenCalled();
  expect(state.query.mock.calls[0][0].where).toEqual({
    id: "other-owner",
    userId: "owner",
  });
  expect(
    await tools.runZenroTool.execute!(
      { name: "__proto__", input: "{}" },
      options,
    ),
  ).toHaveProperty("error");
  expect(
    await tools.runZenroTool.execute!(
      { name: "workspace.list", input: "invalid" },
      options,
    ),
  ).toHaveProperty("error");
  const settings = await tools.runZenroTool.execute!(
    { name: "tasks.settings", input: "{}" },
    options,
  );
  expect(JSON.stringify(settings)).not.toContain("private-topic");
});
it("preserves duplicate-calendar prompts and denies global agent status to non-owners", async () => {
  const tools = zenroTools("not-owner", createScopedLogger("test"));
  state.sync.mockResolvedValue({
    kind: "duplicate",
    prompt: { hash: "fixture", taskId: "task" },
  });
  expect(
    await tools.runZenroTool.execute!(
      { name: "tasks.syncCalendar", input: '{"taskId":"task"}' },
      options,
    ),
  ).toMatchObject({ data: { kind: "duplicate" } });
  expect(
    await tools.runZenroTool.execute!(
      { name: "agents.attention", input: "{}" },
      options,
    ),
  ).toHaveProperty("error");
});

it("copies a task into Notes using the existing transfer IDs, leaving the source unchanged", async () => {
  state.append.mockResolvedValue({ revision: "v2", existing: false });
  const tools = zenroTools("owner", createScopedLogger("test"));
  expect(
    await tools.runZenroTool.execute!(
      {
        name: "workspace.copy",
        input: JSON.stringify({ source: "tasks", id: "task" }),
      },
      options,
    ),
  ).toMatchObject({ data: { id: "task-note-task", workspace: "notes" } });
  expect(state.append.mock.calls[0][1]).toMatchObject({
    sourceTaskId: "task",
    notes: "# Original\n\nDetails",
  });
  expect(state.saved).not.toHaveBeenCalled();
});
it("forwards original text and all media through the existing send service", async () => {
  state.source.mockResolvedValue({
    id: "message",
    chatId: "source",
    text: "Original content",
    deleted: false,
    attachments: [{ name: "test.txt", mime: "text/plain", index: 0 }],
  });
  state.asset.mockResolvedValue(
    new Response("Media", { headers: { "content-type": "text/plain" } }),
  );
  state.send.mockResolvedValue({
    pendingMessageID: "pending",
    chatID: "target",
  });
  const tools = zenroTools("owner", createScopedLogger("test"));
  const id = "00000000-0000-4000-8000-000000000001";
  const result = await tools.runZenroTool.execute!(
    {
      name: "messages.forward",
      input: JSON.stringify({
        chatId: "source",
        messageId: "message",
        targetChatId: "target",
        requestIds: [id],
      }),
    },
    options,
  );
  expect(result).toMatchObject({
    data: { completed: [{ pendingMessageID: "pending" }] },
  });
  expect(state.send.mock.calls[0][0]).toBe("owner");
  expect(state.send.mock.calls[0][1]).toMatchObject({
    chatId: "target",
    requestId: id,
    text: "Original content",
    attachment: {
      name: "test.txt",
      content: Buffer.from("Media").toString("base64"),
    },
  });
});
