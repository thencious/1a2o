import "server-only";
import { APIError } from "@beeper/desktop-api";
import { assertBeeperOwner } from "@/utils/beeper/connection";
import { sendMessage, writableBeeperChat } from "@/utils/beeper/service";
import { SafeError } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import prisma from "@/utils/prisma";
import { resolveMessageSendTime } from "./scheduled-time";

export function findScheduledMessage(
  userId: string,
  chatId: string,
  id: string,
) {
  return prisma.scheduledMessage.findFirst({
    where: { id, userId, chatId },
    select: {
      id: true,
      text: true,
      sendAt: true,
      timezone: true,
      status: true,
    },
  });
}

export async function scheduleConversationMessage({
  userId,
  chatId,
  id,
  text,
  localTime,
  timezone,
}: {
  userId: string;
  chatId: string;
  id: string;
  text: string;
  localTime: string;
  timezone: string;
}) {
  assertBeeperOwner(userId);
  const existing = await findScheduledMessage(userId, chatId, id);
  if (existing) return existing;
  const sendAt = resolveMessageSendTime(localTime, timezone);
  await writableBeeperChat(userId, chatId);
  const saved = await prisma.scheduledMessage.upsert({
    where: { id },
    update: {},
    create: {
      id,
      userId,
      chatId,
      text,
      sendAt,
      nextAttemptAt: sendAt,
      timezone,
    },
  });
  if (saved.userId !== userId || saved.chatId !== chatId)
    throw new SafeError(
      "This scheduling request belongs to another conversation.",
    );
  return {
    id: saved.id,
    text: saved.text,
    sendAt: saved.sendAt,
    timezone: saved.timezone,
    status: saved.status,
  };
}

export function listScheduledMessages(userId: string, chatId: string) {
  assertBeeperOwner(userId);
  return prisma.scheduledMessage.findMany({
    where: { userId, chatId, status: { in: ["PENDING", "SENDING", "FAILED"] } },
    orderBy: { sendAt: "asc" },
    select: {
      id: true,
      text: true,
      sendAt: true,
      timezone: true,
      status: true,
      failure: true,
    },
  });
}

export async function cancelScheduledMessage(userId: string, id: string) {
  assertBeeperOwner(userId);
  const result = await prisma.scheduledMessage.updateMany({
    where: { id, userId, status: "PENDING" },
    data: { status: "CANCELED" },
  });
  if (!result.count)
    throw new SafeError("This message is no longer waiting to send.");
  return { canceled: true };
}

export async function processDueScheduledMessages(
  userId: string,
  logger: Logger,
) {
  assertBeeperOwner(userId);
  const now = new Date();
  const due = await prisma.scheduledMessage.findMany({
    where: {
      userId,
      status: { in: ["PENDING", "SENDING"] },
      sendAt: { lte: now },
      nextAttemptAt: { lte: now },
    },
    orderBy: { nextAttemptAt: "asc" },
    take: 5,
  });
  const results = await Promise.all(
    due.map(async (message) => {
      const lease = new Date(Date.now() + 5 * 60_000);
      const claim = await prisma.scheduledMessage.updateMany({
        where: {
          id: message.id,
          status: message.status,
          nextAttemptAt: message.nextAttemptAt,
        },
        data: { status: "SENDING", nextAttemptAt: lease },
      });
      if (!claim.count) return "skipped";
      const where = {
        id: message.id,
        status: "SENDING" as const,
        nextAttemptAt: lease,
      };
      try {
        await sendMessage(userId, {
          chatId: message.chatId,
          requestId: message.id,
          text: message.text,
        });
      } catch (error) {
        // The existing Beeper receipt prevents duplicate sends across retries and restarts.
        const retry =
          error instanceof APIError &&
          (error.status === undefined ||
            error.status === 401 ||
            error.status === 429 ||
            error.status >= 500);
        await prisma.scheduledMessage.updateMany({
          where,
          data: retry
            ? {
                status: "PENDING",
                nextAttemptAt: new Date(Date.now() + 60_000),
              }
            : {
                status: "FAILED",
                failure:
                  error instanceof SafeError
                    ? error.message
                    : "Delivery could not be confirmed. Check the conversation before sending again.",
              },
        });
        logger.warn("Scheduled message was not submitted", {
          scheduledMessageId: message.id,
          retry,
        });
        return retry ? "retry" : "failed";
      }
      await prisma.scheduledMessage.updateMany({
        where,
        data: { status: "SUBMITTED", failure: null },
      });
      return "submitted";
    }),
  );
  return {
    submitted: results.filter((result) => result === "submitted").length,
  };
}
