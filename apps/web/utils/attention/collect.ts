import "server-only";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { createEmailProvider } from "@/utils/email/provider";
import { beeperSession } from "@/utils/beeper/connection";
import { allowedConversation } from "@/utils/beeper/conversations";
import { networkName } from "@/utils/beeper/network";
import { getTodoState } from "@/utils/todo/storage";
import { getTodoIntegration } from "@/utils/todo/integration-store";
import { taskPolicy } from "@/utils/todo/task-rules";
import { taskReminderTime } from "@/utils/todo/reminder-time";
import { readAgentAttention } from "./agents";
import { convert } from "html-to-text";
import {
  enqueueAttention,
  eventId,
  observeAgent,
  attentionCounts,
  suppressViewedMessages,
} from "./policy";
import { readAttention, updateAttention } from "./store";
import type { AttentionState } from "./types";

const running = new Map<string, Promise<Awaited<ReturnType<typeof collect>>>>();
export async function collectAttention(userId: string, logger: Logger) {
  const pending = running.get(userId);
  if (pending) return pending;
  const job = collect(userId, logger).finally(() => running.delete(userId));
  running.set(userId, job);
  return job;
}
async function collect(userId: string, logger: Logger) {
  const state = await readAttention(userId);
  const now = Date.now();
  const accounts = await prisma.emailAccount.findMany({
    where: { userId, account: { refresh_token: { not: null, notIn: [""] } } },
    select: { id: true, email: true, account: { select: { provider: true } } },
  });
  const primary = accounts[0]?.id;
  const errors: string[] = [];
  const guard = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
    } catch {
      errors.push(`${name} notification source is temporarily unavailable.`);
    }
  };
  await Promise.all([
    ...accounts.map((account) =>
      guard("Mail", async () => {
        const source = `mail:${account.id}`;
        const cutoff = state.checkpoints[source] ?? state.startedAt;
        const provider = await createEmailProvider({
          emailAccountId: account.id,
          provider: account.account.provider,
          logger,
        });
        let pageToken: string | undefined;
        const cursors = new Set<string>();
        do {
          const page = await provider.getMessagesWithPagination({
            after: new Date(Math.max(state.startedAt, cutoff - 60_000)),
            before: new Date(now),
            inboxOnly: true,
            unreadOnly: true,
            includeDrafts: false,
            maxResults: 50,
            pageToken,
          });
          for (const mail of page.messages) {
            const at = Number(mail.internalDate) || Date.parse(mail.date);
            if (!Number.isFinite(at) || at < state.startedAt || at > now)
              continue;
            if (
              mail.labelIds?.some((label) =>
                ["SPAM", "TRASH", "DRAFT"].includes(label),
              )
            )
              continue;
            const path = `/${account.id}/mail?accountScope=all&thread-account-id=${encodeURIComponent(account.id)}&thread-id=${encodeURIComponent(mail.threadId || mail.id)}`;
            enqueueAttention(state, {
              id: eventId(source, mail.id),
              tab: "mail",
              title: clean(mail.headers.from || account.email, 160),
              body: clean(
                mail.subject || mail.headers.subject || "(no subject)",
                400,
              ),
              at,
              path,
            });
          }
          pageToken = page.nextPageToken;
          if (pageToken && cursors.has(pageToken))
            throw new Error("Mail pagination did not advance");
          if (pageToken) cursors.add(pageToken);
        } while (pageToken);
        state.checkpoints[source] = now;
      }),
    ),
    guard("Messages", () => collectMessages(userId, state, primary, now)),
    guard("Tasks", async () => {
      if (!primary) return;
      const [{ tasks }, settings] = await Promise.all([
        getTodoState(userId),
        getTodoIntegration(userId),
      ]);
      const policy = taskPolicy(settings.taskRules);
      for (const task of tasks) {
        const time = taskReminderTime(task, policy);
        if (
          !time ||
          time.at > now ||
          Math.max(time.at, Number(task.createdAt) || 0) < state.startedAt
        )
          continue;
        enqueueAttention(state, {
          id: eventId("todo", `${task.id}:${time.at}:${time.due}`),
          tab: "todo",
          title: "Time to start your task",
          body: clean(task.title, 400),
          path: `/${primary}/todo`,
          at: time.at,
        });
      }
    }),
    guard("Agents", async () => {
      if (!primary || process.env.LOCAL_AGENTS_ENABLED !== "true") return;
      for (const agent of await readAgentAttention())
        observeAgent(state, agent, `/${primary}/agents`, now);
    }),
  ]);
  return updateAttention(userId, (current) => {
    current.startedAt = Math.min(current.startedAt, state.startedAt);
    for (const [source, at] of Object.entries(state.checkpoints))
      current.checkpoints[source] = Math.max(
        current.checkpoints[source] ?? 0,
        at,
      );
    for (const event of Object.values(state.events))
      enqueueAttention(current, event);
    suppressViewedMessages(current, Date.now());
    current.agents = state.agents;
    return {
      enabled: true,
      counts: attentionCounts(current),
      events: Object.values(current.events)
        .filter((event) => !event.deliveredAt && !event.readAt)
        .sort((a, b) => a.at - b.at)
        .slice(0, 50),
      errors,
    };
  });
}
async function collectMessages(
  userId: string,
  state: AttentionState,
  primary: string | undefined,
  now: number,
) {
  if (!primary || process.env.LOCAL_BEEPER_ENABLED !== "true") return;
  const { client, settings } = await beeperSession(userId);
  const cutoff = state.checkpoints.messages ?? state.startedAt;
  // Search indexing can lag behind the live conversation feed. Read unread
  // conversations directly, with overlap for delayed bridge delivery.
  const since = Math.max(state.startedAt, cutoff - 15 * 60_000);
  let chatCursor: string | undefined;
  const chatCursors = new Set<string>();
  do {
    const chats = await client.chats.list({
      limit: 200,
      cursor: chatCursor,
      direction: "before",
    });
    for (const chat of chats.items) {
      if (
        !chat.unreadCount ||
        chat.isMuted ||
        chat.merge ||
        !allowedConversation(chat, settings.groups)
      )
        continue;
      let cursor: string | undefined;
      const cursors = new Set<string>();
      do {
        const page = await client.messages.list(chat.id, {
          cursor,
          direction: "before",
        });
        for (const message of page.items) {
          const at = Date.parse(message.timestamp);
          if (
            message.isSender ||
            message.isDeleted ||
            message.isHidden ||
            message.isUnread === false ||
            !Number.isFinite(at) ||
            at < since ||
            at > now
          )
            continue;
          enqueueAttention(state, {
            id: eventId("messages", message.id),
            tab: "messages",
            title: clean(
              `${chat.title || message.senderName || "New message"} \u00b7 ${networkName(chat.network)}`,
              160,
            ),
            body: clean(
              message.text ||
                (message.attachments?.length ? "Attachment" : "New message"),
              400,
            ),
            path: `/${primary}/messages?chatId=${encodeURIComponent(chat.id)}&notification=${encodeURIComponent(message.id)}`,
            at,
          });
        }
        if (
          !page.hasMore ||
          !page.items.some((message) => Date.parse(message.timestamp) >= since)
        )
          break;
        if (!page.oldestCursor || cursors.has(page.oldestCursor))
          throw new Error("Messages pagination did not advance");
        cursor = page.oldestCursor;
        cursors.add(cursor);
      } while (cursor);
    }
    if (!chats.hasMore) break;
    if (!chats.oldestCursor || chatCursors.has(chats.oldestCursor))
      throw new Error("Conversations pagination did not advance");
    chatCursor = chats.oldestCursor;
    chatCursors.add(chatCursor);
  } while (chatCursor);
  state.checkpoints.messages = now;
}
function clean(value: string, limit: number) {
  return convert(value, { wordwrap: false })
    .replace(
      // biome-ignore lint/suspicious/noControlCharactersInRegex: Remove control characters from untrusted notification text.
      /[\u0000-\u001f]/g,
      " ",
    )
    .trim()
    .slice(0, limit);
}
