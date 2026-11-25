import "server-only";
import prisma from "@/utils/prisma";
import {
  ACCOUNT_DISCONNECTED_ERROR_TYPE,
  CALENDAR_DISCONNECTED_ERROR_TYPE,
} from "@/utils/config";
import { calendarSettingsPath } from "@/utils/calendar/settings-path";

type Warning = {
  message: string;
  timestamp: string;
  actionUrl: string;
  actionLabel: string;
};

export async function readConnectionWarnings(
  userId: string,
  lastMailboxError?: { message: string; actionUrl?: string },
) {
  const [mailboxes, calendars] = await Promise.all([
    prisma.emailAccount.findMany({
      where: {
        userId,
        account: {
          OR: [{ disconnectedAt: { not: null } }, { refresh_token: null }],
        },
      },
      select: {
        id: true,
        email: true,
        account: { select: { disconnectedAt: true, updatedAt: true } },
      },
      orderBy: { email: "asc" },
    }),
    prisma.calendarConnection.findMany({
      where: { emailAccount: { userId } },
      select: {
        email: true,
        emailAccountId: true,
        provider: true,
        isConnected: true,
        updatedAt: true,
        emailAccount: {
          select: { email: true, account: { select: { provider: true } } },
        },
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);
  const warnings: Record<string, Warning> = {};
  const mailbox = mailboxes[0];
  if (mailbox) {
    const actionUrl = `/${mailbox.id}/permissions/consent`;
    const matchingMessage =
      lastMailboxError?.actionUrl === actionUrl ||
      lastMailboxError?.message.includes(mailbox.email);
    warnings[ACCOUNT_DISCONNECTED_ERROR_TYPE] = {
      message:
        mailboxes.length > 1
          ? `${mailboxes.length} mailboxes need to reconnect.`
          : matchingMessage && lastMailboxError
            ? lastMailboxError.message
            : `${mailbox.email} needs to reconnect to resume mail sync.`,
      timestamp: (
        mailbox.account.disconnectedAt ?? mailbox.account.updatedAt
      ).toISOString(),
      actionUrl: mailboxes.length > 1 ? "/accounts" : actionUrl,
      actionLabel:
        mailboxes.length > 1 ? "Manage accounts" : "Reconnect account",
    };
  }

  // One provider account can be authorized under more than one mailbox.
  const identity = (calendar: (typeof calendars)[number]) =>
    JSON.stringify([calendar.provider, calendar.email.trim().toLowerCase()]);
  const available = new Set(
    calendars.filter((entry) => entry.isConnected).map(identity),
  );
  const broken = new Map(
    calendars
      .filter(
        (entry) =>
          !available.has(identity(entry)) &&
          !(
            isMailboxCalendar(entry) &&
            mailboxes.some(({ id }) => id === entry.emailAccountId)
          ),
      )
      .map((entry) => [identity(entry), entry]),
  );
  const calendar = broken.values().next().value;
  if (calendar) {
    const reconnectMailbox = broken.size === 1 && isMailboxCalendar(calendar);
    warnings[CALENDAR_DISCONNECTED_ERROR_TYPE] = {
      message:
        broken.size > 1
          ? `${broken.size} calendar accounts need to reconnect.`
          : `${calendar.email} needs to reconnect to resume calendar sync.`,
      timestamp: calendar.updatedAt.toISOString(),
      actionUrl: reconnectMailbox
        ? `/${calendar.emailAccountId}/permissions/consent`
        : calendarSettingsPath(
            broken.size === 1 ? calendar.emailAccountId : undefined,
          ),
      actionLabel: reconnectMailbox ? "Reconnect account" : "Calendar settings",
    };
  }
  return warnings;
}

function isMailboxCalendar(calendar: {
  email: string;
  provider: string;
  emailAccount: { email: string; account: { provider: string } };
}) {
  return (
    calendar.emailAccount.account.provider === calendar.provider &&
    calendar.emailAccount.email.trim().toLowerCase() ===
      calendar.email.trim().toLowerCase()
  );
}
