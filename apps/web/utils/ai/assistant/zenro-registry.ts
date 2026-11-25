import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { asSchema, type Tool } from "ai";
import type { Logger } from "@/utils/logger";
import type { BeeperContact } from "@/utils/beeper/contact-types";
import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import {
  getTodoState,
  saveTodoState,
  appendWorkspaceItem,
} from "@/utils/todo/storage";
import { prepareMessageForward } from "@/utils/beeper/message-forward";
import {
  todoTask,
  saveTodo,
  todoCalendarChoice,
  todoPreferences,
  analyzeTodo,
} from "@/utils/actions/todo.validation";
import { requestTodoAnalysis } from "@/utils/todo/ai";
import {
  getTodoPreferences,
  saveTodoPreferences,
} from "@/utils/todo/preferences";
import {
  getTodoIntegration,
  updateTodoIntegration,
} from "@/utils/todo/integration-store";
import { taskRuleList } from "@/utils/todo/task-rules";
import { syncTodoCalendar } from "@/utils/todo/calendar-service";
import { runTodoReminders } from "@/utils/todo/reminders";
import { contactDirectory } from "@/utils/contacts/directory";
import { mergeContacts, contactValues } from "@/utils/contacts/merge";
import { contactName } from "@/utils/contacts/conversation-extraction";
import { updateSavedContacts } from "@/utils/contacts/local-store";
import { syncEmailContacts } from "@/utils/contacts/email-store";
import { syncBeeperContacts } from "@/utils/beeper/contacts";
import { syncLinkedInContacts } from "@/utils/linkedin/contacts";
import {
  listConversations,
  getConversationMessage,
  messageAsset,
  listMessages,
  mentionParticipants,
  markConversationRead,
  sendMessage,
  recallMessage,
  reactToMessage,
  editMessage,
  messageReceipt,
  discordGroups,
  setDiscordGroup,
  messageLinkPreviews,
} from "@/utils/beeper/service";
import {
  beeperSend,
  beeperReaction,
  beeperEdit,
  beeperMessage,
  beeperChat,
  beeperGroup,
} from "@/utils/actions/beeper.validation";
import { addConversationContacts } from "@/utils/messages/add-contacts-service";
import { prepareConversationInvite } from "@/utils/messages/invite-service";
import { scheduleConversationMessage } from "@/utils/messages/scheduled";
import {
  getCalendarCatalog,
  getCalendarMonth,
  saveMonthEvent,
  deleteMonthEvent,
} from "@/utils/calendar/month-service";
import {
  calendarMonthRange,
  saveMonthEventBody,
  calendarEventTarget,
} from "@/utils/actions/calendar-month.validation";
import {
  getCalendarDefaults,
  setCalendarDefaults,
} from "@/utils/calendar/defaults-store";
import { calendarDefaults } from "@/utils/calendar/defaults";
import {
  getCalendarVisibility,
  setCalendarVisibility,
} from "@/utils/calendar/visibility-store";
import { changeCalendarVisibility } from "@/utils/calendar/visibility";
import {
  getLocalRules,
  setLocalRules,
  testLocalRules,
} from "@/utils/automation/local-rules-service";
import { ruleDomain, saveLocalRules } from "@/utils/automation/local-rules";
import { localAgentsRequest } from "@/utils/agents/service";
import { agentCommand } from "@/utils/actions/agents.validation";
import { readAgentAttention } from "@/utils/attention/agents";
import { getOpenRouterUsage } from "@/utils/openrouter-usage";
import {
  getAccountOverviewTool,
  searchInboxTool,
  readEmailTool,
  readAttachmentTool,
} from "./chat-inbox-tools";

export type ZenroAction = {
  domain: string;
  description: string;
  writes: boolean;
  schema: z.ZodType;
  run: (input: unknown) => Promise<unknown>;
};
export function zenroRegistry(userId: string, logger: Logger) {
  const registry: Record<string, ZenroAction> = Object.create(null);
  function add<T extends z.ZodType>(
    name: string,
    domain: string,
    description: string,
    writes: boolean,
    schema: T,
    run: (input: z.output<T>) => Promise<unknown>,
  ) {
    registry[name] = {
      domain,
      description,
      writes,
      schema,
      run: (input) => run(schema.parse(input)),
    };
  }
  const empty = z.object({});
  const page = z.object({
    query: z.string().max(500).optional(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(100).default(30),
  });
  const workspace = z.enum(["tasks", "notes"]);
  add(
    "workspace.analyze",
    "tasks",
    "Run the existing task deadline/work-estimate or note-to-task summary analysis using the application's time-picking instructions, configured rules and original sender timezone. request contains messages and tools in the same structured format used by Tasks. Returns a proposal; does not save it. Uses the existing OpenRouter quota.",
    false,
    analyzeTodo.extend({ workspace }),
    (input) => requestTodoAnalysis(userId, input.request, input.workspace),
  );
  add(
    "workspace.copy",
    "tasks",
    "Copy a task to Notes or a note to Tasks using existing transfer IDs and links, without removing the original. For note-to-task, supply a brief summarized title. Scheduling fields may be supplied; sync the returned task ID to the calendar separately and resolve duplicates with the user.",
    true,
    z.object({
      source: workspace,
      id: z.string(),
      title: z.string().max(250).optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
    }),
    async (input) => {
      const state = await getTodoState(userId, input.source),
        original = state.tasks.find((item) => item.id === input.id);
      if (!original) throw new SafeError("Task or note not found.");
      const target = input.source === "tasks" ? "notes" : "tasks",
        id =
          input.source === "tasks"
            ? `task-note-${input.id}`
            : `note-task-${input.id}`;
      const title = input.title ?? original.title;
      const result = await appendWorkspaceItem(
        userId,
        todoTask.parse({
          ...input.fields,
          id,
          title,
          notes:
            target === "notes"
              ? `# ${title}\n\n${original.notes}`
              : original.notes,
          createdAt: Date.now(),
          completedAt: null,
          ...(target === "notes"
            ? { sourceTaskId: input.id }
            : { sourceNoteId: input.id }),
        }),
        target,
      );
      return {
        id,
        workspace: target,
        revision: result.revision,
        existing: result.existing,
      };
    },
  );
  add(
    "messages.forward",
    "messages",
    "Forward a specific message and all of its locally available attachments to a chosen conversation. This sends immediately and requires explicit user intent and an unambiguous target. Supply one stable request UUID per attachment (or one for text-only), reuse them on retries. All media is prepared before sending; partial results identify completed and unconfirmed requests.",
    true,
    z.object({
      chatId: z.string(),
      messageId: z.string(),
      targetChatId: z.string(),
      requestIds: z
        .array(z.uuid())
        .min(1)
        .max(20)
        .refine(
          (ids) => new Set(ids).size === ids.length,
          "Use a distinct request ID for each attachment.",
        ),
    }),
    async (input) => {
      const message = await getConversationMessage(
        userId,
        input.chatId,
        input.messageId,
      );
      if (input.requestIds.length !== Math.max(1, message.attachments.length))
        throw new SafeError(
          "Supply one request ID per attachment, or one for a text-only message.",
        );
      const prepared = await prepareMessageForward(
        message,
        AbortSignal.timeout(45_000),
        async (resource) => {
          const query = new URL(String(resource), "http://127.0.0.1")
            .searchParams;
          return messageAsset(
            userId,
            input.chatId,
            input.messageId,
            Number(query.get("index")),
            null,
          );
        },
      );
      const completed: unknown[] = [];
      for (let index = 0; index < input.requestIds.length; index++) {
        const attachment = prepared.attachments[index];
        try {
          completed.push(
            await sendMessage(userId, {
              chatId: input.targetChatId,
              requestId: input.requestIds[index],
              text: index === 0 ? prepared.text : "",
              ...(attachment
                ? {
                    attachment: {
                      name: attachment.name,
                      mime: attachment.type,
                      content: Buffer.from(
                        await attachment.arrayBuffer(),
                      ).toString("base64"),
                    },
                  }
                : {}),
            }),
          );
        } catch {
          return {
            completed,
            unconfirmedRequestId: input.requestIds[index],
            warning:
              "Delivery could not be confirmed. Check the target conversation before retrying. Later attachments were not sent.",
          };
        }
      }
      return { completed };
    },
  );
  add(
    "accounts.list",
    "mail",
    "List all the signed-in user's connected mailboxes with IDs and providers; never credentials.",
    false,
    empty,
    () =>
      prisma.emailAccount.findMany({
        where: { userId },
        select: {
          id: true,
          email: true,
          account: { select: { provider: true } },
        },
      }),
  );
  const mailOperation = z.enum(["overview", "search", "read", "attachment"]);
  const mailbox = z.object({
    emailAccountId: z.string(),
    operation: mailOperation,
  });
  async function mailboxTool(input: z.infer<typeof mailbox>) {
    const account = await prisma.emailAccount.findFirst({
      where: { id: input.emailAccountId, userId },
      select: { email: true, account: { select: { provider: true } } },
    });
    if (!account) throw new SafeError("Mailbox not found or not accessible.");
    const options = {
      email: account.email,
      emailAccountId: input.emailAccountId,
      provider: account.account.provider,
      logger,
    };
    const factories = {
      overview: getAccountOverviewTool,
      search: searchInboxTool,
      read: readEmailTool,
      attachment: readAttachmentTool,
    };
    return factories[input.operation](options) as Tool;
  }
  add(
    "mail.toolSchema",
    "mail",
    "Get the existing provider-specific schema for reading/searching any owned mailbox. Choose an account ID from accounts.list. This enables Gmail/Outlook cross-account reading without changing the mailbox selected in the UI.",
    false,
    mailbox,
    async (input) => {
      const selected = await mailboxTool(input);
      return {
        description: selected.description,
        inputSchema: await asSchema(selected.inputSchema).jsonSchema,
      };
    },
  );
  add(
    "mail.read",
    "mail",
    "Execute a read-only native mailbox tool for an owned account, using the input object from mail.toolSchema. Existing send/reply/rule tools remain available for the active mailbox and keep their confirmation UI.",
    false,
    mailbox.extend({ input: z.record(z.string(), z.unknown()) }),
    async (input) => {
      const selected = await mailboxTool(input);
      const schema = asSchema(selected.inputSchema);
      if (!schema.validate || !selected.execute)
        throw new SafeError("Mailbox tool is unavailable.");
      const parsed = await schema.validate(input.input);
      if (!parsed.success)
        throw new SafeError(
          "Invalid mailbox tool input. Read mail.toolSchema first.",
        );
      return selected.execute(parsed.value, {
        toolCallId: randomUUID(),
        messages: [],
        context: {},
      });
    },
  );
  add(
    "workspace.list",
    "tasks",
    "List tasks or notes with IDs, titles, completion and revision. Query searches titles and notes. Paginate to cover the whole workspace.",
    false,
    page.extend({ workspace }),
    async (input) => {
      const state = await getTodoState(userId, input.workspace);
      const matches = state.tasks.filter(
        (item) =>
          !input.query ||
          `${item.title} ${item.notes}`
            .toLowerCase()
            .includes(input.query.toLowerCase()),
      );
      return {
        revision: state.revision,
        total: matches.length,
        nextOffset:
          input.offset + input.limit < matches.length
            ? input.offset + input.limit
            : null,
        items: matches
          .slice(input.offset, input.offset + input.limit)
          .map(({ notes, ...item }) => ({
            ...item,
            notesLength: notes.length,
          })),
      };
    },
  );
  add(
    "workspace.read",
    "tasks",
    "Read one task or note including all scheduling metadata. Notes are paged by character offset; use nextOffset for long notes.",
    false,
    z.object({
      workspace,
      id: z.string(),
      offset: z.number().int().min(0).default(0),
      limit: z.number().int().min(1).max(30_000).default(15_000),
    }),
    async (input) => {
      const state = await getTodoState(userId, input.workspace),
        item = state.tasks.find((item) => item.id === input.id);
      if (!item) throw new SafeError("Task or note not found.");
      return {
        revision: state.revision,
        item: {
          ...item,
          notes: item.notes.slice(input.offset, input.offset + input.limit),
        },
        notesLength: item.notes.length,
        nextOffset:
          input.offset + input.limit < item.notes.length
            ? input.offset + input.limit
            : null,
      };
    },
  );
  add(
    "workspace.save",
    "tasks",
    "Save task or note changes using the current revision and complete items array from workspace reads. Preserve unrelated items and metadata. Existing revision protection prevents overwriting unsaved changes. Use workspace.mutate for a single item instead.",
    true,
    saveTodo.extend({ workspace }),
    (input) =>
      saveTodoState(userId, input.revision, input.tasks, input.workspace),
  );
  add(
    "workspace.mutate",
    "tasks",
    "Create, update, complete, or delete one task/note. First read its workspace revision. fields merges task metadata such as deadline/estimate/timeContext with the existing item; preserve original time reference, timezone and configured late-night cutoff. New notes should start with # title. Setting a deadline alone does not create a calendar event; use tasks.syncCalendar afterwards and resolve any duplicate prompt with the user.",
    true,
    z.object({
      workspace,
      operation: z.enum(["create", "update", "delete"]),
      revision: z.string(),
      id: z.string().optional(),
      title: z.string().max(250).optional(),
      notes: z.string().max(250_000).optional(),
      completed: z.boolean().optional(),
      fields: z.record(z.string(), z.unknown()).optional(),
    }),
    async (input) => {
      const state = await getTodoState(userId, input.workspace);
      if (state.revision !== input.revision)
        throw new SafeError(
          "The workspace changed. Read the latest version before saving.",
        );
      const existing = state.tasks.find((item) => item.id === input.id);
      if (input.operation !== "create" && !existing)
        throw new SafeError("Task or note not found.");
      const id = existing?.id ?? randomUUID();
      if (input.operation === "delete")
        return saveTodoState(
          userId,
          state.revision,
          state.tasks.filter((item) => item.id !== id),
          input.workspace,
        );
      const item = todoTask.parse({
        ...(existing ?? {
          id,
          title: "",
          notes: "",
          createdAt: Date.now(),
          completedAt: null,
        }),
        ...input.fields,
        id,
        ...(input.title === undefined ? {} : { title: input.title }),
        ...(input.notes === undefined ? {} : { notes: input.notes }),
        ...(input.completed === undefined
          ? {}
          : { completedAt: input.completed ? Date.now() : null }),
      });
      if (!item.title.trim()) throw new SafeError("A title is required.");
      const saved = await saveTodoState(
        userId,
        state.revision,
        existing
          ? state.tasks.map((current) => (current.id === id ? item : current))
          : [item, ...state.tasks],
        input.workspace,
      );
      return { ...saved, id };
    },
  );
  add(
    "tasks.settings",
    "tasks",
    "Read task calendar defaults, timing rules, timezone, notification health and pending duplicate-event prompts. Notification credentials and private topic URLs are excluded.",
    false,
    empty,
    async () => {
      const { ntfyTopic, ...settings } = await getTodoPreferences(userId);
      const state = await getTodoIntegration(userId);
      return {
        ...settings,
        notificationTopicConfigured: Boolean(ntfyTopic),
        rulesRevision: state.rulesRevision,
        rules: state.taskRules,
      };
    },
  );
  add(
    "tasks.saveSettings",
    "settings",
    "Change task defaults, timezone and notification preferences. Preserve unspecified settings. Credentials can only be supplied by the user; never extract secrets from other sources.",
    true,
    todoPreferences.omit({ calendarMode: true }),
    (input) => saveTodoPreferences(userId, input, logger),
  );
  add(
    "tasks.syncCalendar",
    "tasks",
    "Sync a task's date/deadline to its configured calendar. Returns a prompt on duplicates; do not choose update/create on behalf of the user without their explicit decision.",
    true,
    z.object({ taskId: z.string() }),
    (input) => syncTodoCalendar(userId, input.taskId, logger),
  );
  add(
    "tasks.resolveCalendar",
    "tasks",
    "Apply the user's explicit decision to a pending duplicate-event prompt. Use its hash and event details; do not invent a decision.",
    true,
    todoCalendarChoice.omit({ target: true }),
    (input) => syncTodoCalendar(userId, input.taskId, logger, input),
  );
  add(
    "tasks.runReminders",
    "tasks",
    "Check due task reminders using the existing phone/Windows notification pipeline. May send due notifications.",
    true,
    empty,
    () => runTodoReminders(userId),
  );
  add(
    "tasks.saveRules",
    "rules",
    "Save task timing/AI rules with the current rulesRevision. Read tasks.settings first; preserve rules the user did not ask to change.",
    true,
    z.object({ revision: z.string(), rules: taskRuleList }),
    (input) =>
      updateTodoIntegration(userId, async (state) => {
        if (state.rulesRevision !== input.revision)
          throw new SafeError("Task rules changed. Reload before saving.");
        state.taskRules = input.rules;
        state.rulesRevision = randomUUID();
        return { revision: state.rulesRevision };
      }),
  );
  add(
    "messages.list",
    "messages",
    "List newest conversations across messaging accounts, including allowed groups and excluding Discord servers. Follow cursor to reach more conversations.",
    false,
    z.object({ cursor: z.string().optional() }),
    (input) => listConversations(userId, input.cursor),
  );
  add(
    "messages.read",
    "messages",
    "Read a conversation page including text, attachments, reply targets and supported reaction/recall capabilities. Follow cursor for older messages.",
    false,
    beeperChat.extend({ cursor: z.string().optional() }),
    (input) => listMessages(userId, input.chatId, input.cursor),
  );
  add(
    "messages.send",
    "messages",
    "Send a new message or reply immediately, including supported attachment data. Require a direct user instruction with a concrete recipient and content. For future delivery use messages.schedule. Reuse requestId on retries, inspect receipt before resending. Read the target conversation first to disambiguate names and capability support.",
    true,
    beeperSend,
    (input) => sendMessage(userId, input),
  );
  add(
    "messages.schedule",
    "messages",
    "Queue an explicitly requested future text message. Use the original conversation ID when continuing a Messages command, and the original message text without the timing instructions. Use localTime in YYYY-MM-DDTHH:mm with the user's IANA time zone. If the date, time or destination is still ambiguous, ask. Provide a stable request UUID and reuse it on retries. Confirm scheduling only from the returned record.",
    true,
    beeperChat.extend({
      requestId: z.uuid(),
      text: z
        .string()
        .max(20_000)
        .refine((value) => !!value.trim()),
      localTime: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
      timezone: z.string().min(1).max(120),
    }),
    ({ requestId, ...input }) =>
      scheduleConversationMessage({ ...input, id: requestId, userId }),
  );
  add(
    "messages.receipt",
    "messages",
    "Check the provider status of a pending message before retrying a send.",
    false,
    beeperChat.extend({ pendingId: z.string() }),
    (input) => messageReceipt(userId, input.chatId, input.pendingId),
  );
  add(
    "messages.markRead",
    "messages",
    "Mark a conversation read when requested.",
    true,
    beeperChat,
    (input) => markConversationRead(userId, input.chatId),
  );
  add(
    "messages.participants",
    "messages",
    "Read native mention support and all mentionable participants in a conversation. To mention a person with messages.send, use the returned exact user ID and label with the selected @label span's zero-based UTF-16 start/end offsets in text. Never guess an ID or add unrequested mentions.",
    false,
    beeperChat,
    (input) => mentionParticipants(userId, input.chatId),
  );
  add(
    "messages.recall",
    "messages",
    "Recall a specific outgoing message only when directly requested. The provider enforces capability and recall limits.",
    true,
    beeperMessage,
    (input) => recallMessage(userId, input),
  );
  add(
    "messages.edit",
    "messages",
    "Edit a specific outgoing text message only when directly requested. First read the message to obtain its editRevision and canEdit; provide that revision and the user's replacement text. Attachments, ownership, edit windows and concurrent changes are checked before writing.",
    true,
    beeperEdit,
    (input) => editMessage(userId, input),
  );
  add(
    "messages.react",
    "messages",
    "Add/remove a reaction to a specific message using a supported reaction key. The provider enforces capability support.",
    true,
    beeperReaction,
    (input) => reactToMessage(userId, input),
  );
  add(
    "messages.linkPreviews",
    "messages",
    "Read the standard link previews for a message.",
    false,
    beeperMessage,
    (input) => messageLinkPreviews(userId, input.chatId, input.messageId),
  );
  add(
    "messages.groups",
    "messages",
    "List Discord private groups and their inclusion settings; Discord servers remain excluded.",
    false,
    z.object({ cursor: z.string().optional() }),
    (input) => discordGroups(userId, input.cursor),
  );
  add(
    "messages.setGroup",
    "messages",
    "Include/exclude a Discord private group in the unified Messages view.",
    true,
    beeperGroup,
    (input) => setDiscordGroup(userId, input.chatId, input.include),
  );
  add(
    "messages.addContacts",
    "contacts",
    "Run /add: extract contact information from the last 100 lines, merge exact names and create unmatched contacts. Uses one quota-limited OpenRouter request.",
    true,
    beeperChat,
    (input) => addConversationContacts(userId, input.chatId),
  );
  add(
    "messages.prepareInvite",
    "calendars",
    "Run /invite: inspect the last 50 lines and prepare a proposal or an unsent email-request draft. Does not create an event or send a message; review returned details with the user before calendars.saveEvent.",
    false,
    beeperChat.extend({ timezone: z.string() }),
    (input) => prepareConversationInvite(userId, input.chatId, input.timezone),
  );
  add(
    "contacts.search",
    "contacts",
    "Search the full unified directory, including email, messaging and LinkedIn profiles, aliases, addresses and saved conversation details. Exact-name duplicates are merged automatically; preserve links to all source profiles.",
    false,
    page,
    async (input) => {
      const data = await contactDirectory(userId);
      const people = mergeContacts(data.accounts).filter(
        (person) =>
          !input.query ||
          JSON.stringify(person)
            .toLowerCase()
            .includes(input.query.toLowerCase()),
      );
      return {
        total: people.length,
        nextOffset:
          input.offset + input.limit < people.length
            ? input.offset + input.limit
            : null,
        people: people.slice(input.offset, input.offset + input.limit),
        sources: data.accounts.map(({ contacts, ...account }) => ({
          ...account,
          count: contacts.length,
        })),
      };
    },
  );
  add(
    "contacts.refresh",
    "contacts",
    "Refresh email, messaging and LinkedIn contacts independently, preserving cached data on failure and rerunning duplicate checks.",
    true,
    empty,
    async () => {
      const results = await Promise.allSettled([
        syncEmailContacts(userId, true),
        syncBeeperContacts(userId),
        syncLinkedInContacts(userId, true),
      ]);
      return {
        sources: results.map((result) => ({
          refreshed: result.status === "fulfilled",
        })),
      };
    },
  );
  add(
    "contacts.save",
    "contacts",
    "Add user-provided contact information in 1a2o, merging exact-name matches and preserving unique details. Ambiguous names are rejected. Does not overwrite provider address books.",
    true,
    z.object({
      name: z.string().trim().min(1).max(200),
      emails: z.array(z.email()).optional(),
      phoneNumbers: z.array(z.string().max(200)).optional(),
      companies: z.array(z.string().max(500)).optional(),
      positions: z.array(z.string().max(500)).optional(),
      profileUrls: z
        .array(z.url().refine((value) => /^https?:/.test(value)))
        .optional(),
      details: z.record(z.string(), z.array(z.string().max(2000))).optional(),
    }),
    async (input) =>
      updateSavedContacts(userId, async (contacts) => {
        const directory = await contactDirectory(userId),
          matches = mergeContacts(directory.accounts).filter((person) =>
            contactValues(person, "name").some(
              (name) => contactName(name) === contactName(input.name),
            ),
          );
        if (matches.length > 1 || matches[0]?.ambiguous)
          throw new SafeError(
            "More than one contact has this name. Specify the correct profile before editing.",
          );
        const existing = contacts.find(
          (contact) => contactName(contact.name) === contactName(input.name),
        );
        const contact: BeeperContact = existing ?? {
          id: `name:${contactName(input.name)}`,
          name: input.name,
        };
        for (const field of [
          "emails",
          "phoneNumbers",
          "companies",
          "positions",
          "profileUrls",
        ] as const)
          contact[field] = [
            ...new Set([...(contact[field] ?? []), ...(input[field] ?? [])]),
          ];
        contact.details = { ...contact.details };
        for (const [label, values] of Object.entries(input.details ?? {}))
          contact.details[label] = [
            ...new Set([...(contact.details[label] ?? []), ...values]),
          ];
        return {
          contacts: existing ? contacts : [...contacts, contact],
          saved: true,
        };
      }).then(({ saved }) => ({ saved })),
  );
  add(
    "calendars.list",
    "calendars",
    "Discover calendars across all connected accounts with writable flags and IDs. Includes hidden calendars; get settings before changing visibility.",
    false,
    empty,
    () => getCalendarCatalog(userId, logger),
  );
  add(
    "calendars.events",
    "calendars",
    "Read unified calendar events across accounts for an ISO date range of up to 45 days. Use event etags for edits; provider failures preserve cached events.",
    false,
    calendarMonthRange,
    (input) => getCalendarMonth(userId, input.start, input.end, logger),
  );
  add(
    "calendars.saveEvent",
    "calendars",
    "Create/update a calendar event with native permission and concurrency checks. Guests receive invitations. First inspect existing events to avoid duplicates; use a writable calendar and reuse requestId on retries. Respect user defaults and timezone. Require the user's concrete intent for guests and event details.",
    true,
    saveMonthEventBody,
    (input) => saveMonthEvent(userId, input, logger),
  );
  add(
    "calendars.deleteEvent",
    "calendars",
    "Delete a specific event only on explicit user instruction, using its current etag and original calendar.",
    true,
    calendarEventTarget,
    (input) => deleteMonthEvent(userId, input, logger),
  );
  add(
    "calendars.settings",
    "settings",
    "Read unified calendar defaults, Google Meet/Zoom preference and persistent visible/archived calendar selection.",
    false,
    empty,
    async () => ({
      defaults: await getCalendarDefaults(userId),
      visibility: await getCalendarVisibility(userId),
    }),
  );
  add(
    "calendars.saveDefaults",
    "settings",
    "Save default calendar and meeting service preferences. Read settings first and preserve unrelated values.",
    true,
    calendarDefaults,
    (input) => setCalendarDefaults(userId, input),
  );
  add(
    "calendars.visibility",
    "settings",
    "Persist selected/archived calendars via initialize/replace/toggle. Read current visibility first to preserve unrelated selections.",
    true,
    changeCalendarVisibility,
    (input) => setCalendarVisibility(userId, input),
  );
  add(
    "rules.read",
    "rules",
    "Read message/calendar automation rules, revision, classification results and test history. Task timing rules live in tasks.settings; email rules use the existing mail rule tools.",
    false,
    z.object({ domain: ruleDomain }),
    (input) => getLocalRules(userId, input.domain),
  );
  add(
    "rules.save",
    "rules",
    "Save message/calendar automation using the same schema and revision checks as Tools > Rules. Preserve rules not requested to change.",
    true,
    saveLocalRules,
    (input) => setLocalRules(userId, input),
  );
  add(
    "rules.test",
    "rules",
    "Run the real rule test on user-provided text. May use OpenRouter quota and records test history.",
    false,
    z.object({ domain: ruleDomain, text: z.string().min(1).max(16_000) }),
    (input) => testLocalRules(userId, input.domain, input.text),
  );
  add(
    "agents.state",
    "agents",
    "Read configured agent panels and schedules. Does not start conversations or send prompts.",
    false,
    empty,
    () => localAgentsRequest(userId, "/state"),
  );
  add(
    "agents.metadata",
    "agents",
    "List available CLI conversations, models and scheduler defaults using the agent service.",
    false,
    empty,
    () => localAgentsRequest(userId, "/metadata"),
  );
  add(
    "agents.attention",
    "agents",
    "Read task-completion and waiting-for-input status for configured agents.",
    false,
    empty,
    async () => {
      if (userId !== process.env.LOCAL_AGENTS_OWNER_ID)
        throw new SafeError(
          "Agent access is restricted to this installation's owner.",
        );
      return readAgentAttention();
    },
  );
  add(
    "agents.command",
    "agents",
    "Use the existing agent controls: add/configure/new/remove/connect/restart/send/timer/pause/cancel/edit_schedule/cancel_all. Read state/metadata first. send executes immediately; timer schedules. Do not send now when the user asked to schedule. Require explicit user instruction for prompts, cancellation or closing an agent; use only IDs returned by this installation.",
    true,
    agentCommand,
    (input) => localAgentsRequest(userId, "/command", input),
  );
  add(
    "usage.read",
    "usage",
    "Read historical OpenRouter usage, outcomes, per-feature spending and daily/hourly counts for a UTC YYYY-MM-DD date. These are OpenRouter totals, not ChatGPT plan usage.",
    false,
    z.object({ day: z.iso.date() }),
    (input) => getOpenRouterUsage(userId, input.day),
  );
  return registry;
}
