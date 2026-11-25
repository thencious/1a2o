import "server-only";
import prisma from "@/utils/prisma";
import type { Logger } from "@/utils/logger";
import { createEmailProvider } from "@/utils/email/provider";
import { createMonthProvider } from "@/utils/calendar/month-provider";
import { recoverCalendarFromMailbox } from "@/utils/calendar/mailbox-grant";

const checking = new Set<string>();

export async function checkExpiredConnections(userId: string, logger: Logger) {
  if (checking.has(userId)) return;
  checking.add(userId);
  try {
    const now = new Date();
    const [mailboxes, calendars, disconnectedCalendars] = await Promise.all([
      prisma.emailAccount.findMany({
        where: {
          userId,
          account: {
            provider: { in: ["google", "microsoft"] },
            disconnectedAt: null,
            refresh_token: { not: null },
            expires_at: { lte: now },
          },
        },
        select: { id: true, account: { select: { provider: true } } },
      }),
      prisma.calendarConnection.findMany({
        where: {
          emailAccount: { userId },
          provider: { in: ["google", "microsoft"] },
          isConnected: true,
          refreshToken: { not: null },
          expiresAt: { lte: now },
        },
        select: {
          id: true,
          email: true,
          provider: true,
          emailAccountId: true,
          expiresAt: true,
          accessToken: true,
          refreshToken: true,
        },
      }),
      prisma.calendarConnection.findMany({
        where: {
          emailAccount: { userId, account: { disconnectedAt: null } },
          provider: { in: ["google", "microsoft"] },
          isConnected: false,
        },
        select: {
          id: true,
          email: true,
          provider: true,
          emailAccountId: true,
          expiresAt: true,
          updatedAt: true,
          accessToken: true,
          refreshToken: true,
          emailAccount: {
            select: {
              email: true,
              account: {
                select: {
                  provider: true,
                  scope: true,
                  access_token: true,
                  refresh_token: true,
                  expires_at: true,
                  disconnectedAt: true,
                },
              },
            },
          },
        },
      }),
    ]);
    const checks = [
      ...mailboxes.map(
        ({ id, account }) =>
          () =>
            createEmailProvider({
              emailAccountId: id,
              provider: account.provider,
              logger,
            }),
      ),
      ...calendars.map(
        (connection) => () => createMonthProvider(connection, logger),
      ),
      ...disconnectedCalendars.map(
        ({ emailAccount, ...connection }) =>
          () =>
            recoverCalendarFromMailbox({
              connection,
              mailbox: emailAccount,
              logger,
            }),
      ),
    ];
    for (let index = 0; index < checks.length; index += 4) {
      await Promise.allSettled(
        checks.slice(index, index + 4).map((check) => check()),
      );
    }
  } catch (error) {
    logger.warn("Could not check expired account connections", { error });
  } finally {
    // Leave temporary failures time to recover before trying the same grant.
    setTimeout(() => checking.delete(userId), 60_000).unref();
  }
}
