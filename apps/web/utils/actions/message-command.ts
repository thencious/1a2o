"use server";

import { z } from "zod";
import { actionClient, actionClientUser } from "./safe-action";
import { aiProcessAssistantChat } from "@/utils/ai/assistant/chat";
import { assertBeeperOwner } from "@/utils/beeper/connection";
import { SafeError } from "@/utils/error";
import { commandOriginText } from "@/utils/messages/slash-context";
import {
  cancelScheduledMessage,
  findScheduledMessage,
  scheduleConversationMessage,
} from "@/utils/messages/scheduled";
import { getEmailAccountWithAi } from "@/utils/user/get";
import prisma from "@/utils/prisma";

export const runMessageCommandAction = actionClient
  .metadata({ name: "runMessageCommand" })
  .inputSchema(
    z.object({
      command: z.string().trim().min(2).max(12_000).startsWith("/"),
      chatId: z.string().min(1).max(2000),
      title: z.string().max(2000),
      network: z.string().max(200),
      timezone: z.string().min(1).max(120),
      requestId: z.uuid(),
    }),
  )
  .action(async ({ ctx: { userId, emailAccountId, logger }, parsedInput }) => {
    assertBeeperOwner(userId);
    const { command, chatId, title, network, timezone, requestId } =
      parsedInput;
    try {
      new Intl.DateTimeFormat("en", { timeZone: timezone });
    } catch {
      throw new SafeError("Could not determine your time zone.");
    }
    const [existing, continuation] = await Promise.all([
      findScheduledMessage(userId, chatId, requestId),
      prisma.chat.findFirst({
        where: { id: requestId, emailAccountId, deletedAt: null },
        select: { id: true },
      }),
    ]);
    if (existing || continuation)
      return { scheduled: existing, assistantChatId: continuation?.id };
    const user = await getEmailAccountWithAi({ emailAccountId });
    if (!user || user.userId !== userId)
      throw new SafeError("The workspace account is unavailable.");
    let answer = "";
    let reply = "";
    const sourceContext = {
      tab: "messages",
      pathname: `/${emailAccountId}/messages`,
      field: "Reply to conversation",
      timezone,
      capturedAt: new Date().toISOString(),
      selection: { chatId, title, network },
    };
    try {
      const stream = await aiProcessAssistantChat({
        emailAccountId,
        user,
        messages: [
          {
            role: "user",
            content: `${command.slice(1)}\n\n${commandOriginText(sourceContext)}`,
          },
        ],
        messageCommand: {
          timezone,
          schedule: (input) =>
            scheduleConversationMessage({
              ...input,
              id: requestId,
              userId,
              chatId,
              timezone,
            }),
          continueInChat: (text) => {
            reply = text;
          },
        },
        abortSignal: AbortSignal.timeout(90_000),
        logger,
      });
      answer = (await stream.text).trim();
    } catch (error) {
      logger.warn("Message command did not finish", { error });
    }
    const scheduled = await findScheduledMessage(userId, chatId, requestId);
    if (reply) {
      const continuation = await prisma.chat.upsert({
        where: { id: requestId, emailAccountId },
        update: {},
        create: {
          id: requestId,
          emailAccountId,
          name: command.slice(1, 91),
          messages: {
            create: [
              {
                role: "user",
                parts: [{ type: "text", text: command }],
                metadata: { sourceContext },
              },
              {
                role: "assistant",
                parts: [{ type: "text", text: reply }],
                createdAt: new Date(Date.now() + 1),
              },
            ],
          },
        },
        select: { id: true },
      });
      return { assistantChatId: continuation.id, scheduled };
    }
    if (scheduled) return { scheduled };
    if (!answer)
      throw new SafeError("The AI command did not finish. Try it again.");
    return { answer };
  });

export const cancelScheduledMessageAction = actionClientUser
  .metadata({ name: "cancelScheduledMessage" })
  .inputSchema(z.object({ id: z.uuid() }))
  .action(({ ctx: { userId }, parsedInput }) =>
    cancelScheduledMessage(userId, parsedInput.id),
  );
