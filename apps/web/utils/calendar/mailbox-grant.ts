import "server-only";
import { after } from "next/server";
import prisma from "@/utils/prisma";
import { createScopedLogger, type Logger } from "@/utils/logger";
import { createCalendarConnection } from "./oauth-callback-helpers";
import { createGoogleCalendarProvider } from "./providers/google";
import { createMicrosoftCalendarProvider } from "./providers/microsoft";
import { createMonthProvider, type MonthConnection } from "./month-provider";

const calendarLogger = createScopedLogger("calendar/mailbox-grant");

export async function connectCalendarFromMailboxGrant({
  accountId,
  provider,
  grantedScope,
  logger = calendarLogger,
}: {
  accountId: string;
  provider: string;
  grantedScope?: string | null;
  logger?: Logger;
}) {
  if (provider !== "google" && provider !== "microsoft") return;

  // Better Auth stores comma-delimited scopes. The provider APIs use spaces.
  const { canList, canEdit } = getCalendarGrant(provider, grantedScope);
  if (!canList) return;

  try {
    const account = await prisma.account.findUnique({
      where: { id: accountId },
      select: {
        scope: true,
        provider: true,
        access_token: true,
        refresh_token: true,
        expires_at: true,
        emailAccount: { select: { id: true, email: true } },
      },
    });
    if (
      !account?.emailAccount ||
      !account.access_token ||
      !account.refresh_token ||
      account.scope !== grantedScope ||
      account.provider !== provider
    )
      return;

    const emailAccountId = account.emailAccount.id;
    const email = account.emailAccount.email.trim().toLowerCase();
    const tokens = {
      accessToken: account.access_token,
      refreshToken: account.refresh_token,
      expiresAt: account.expires_at,
    };
    const existing = await prisma.calendarConnection.findFirst({
      where: {
        emailAccountId,
        provider,
        email: { equals: email, mode: "insensitive" },
      },
      select: { id: true, isConnected: true, updatedAt: true },
    });

    let connectionId: string;
    if (existing) {
      // A partial consent must not downgrade a working calendar connection.
      if (existing.isConnected && !canEdit) return;
      const updated = await prisma.calendarConnection.updateMany({
        where: { id: existing.id, updatedAt: existing.updatedAt },
        data: { ...tokens, isConnected: true },
      });
      if (!updated.count) return;
      connectionId = existing.id;
    } else {
      const connection = await createCalendarConnection({
        ...tokens,
        emailAccountId,
        email,
        provider,
      });
      connectionId = connection.id;
    }

    const calendarProvider =
      provider === "google"
        ? createGoogleCalendarProvider(logger)
        : createMicrosoftCalendarProvider(logger);
    after(() =>
      calendarProvider
        .syncCalendars(
          connectionId,
          tokens.accessToken,
          tokens.refreshToken,
          emailAccountId,
          tokens.expiresAt,
        )
        .catch((error) => {
          logger.warn("Could not sync calendars after connecting mailbox", {
            connectionId,
            error,
          });
        }),
    );
  } catch (error) {
    logger.warn("Could not connect calendar from mailbox grant", {
      accountId,
      provider,
      error,
    });
  }
}

export async function recoverCalendarFromMailbox({
  connection,
  mailbox,
  logger,
}: {
  connection: MonthConnection & { updatedAt: Date };
  mailbox: {
    email: string;
    account: {
      provider: string;
      scope: string | null;
      access_token: string | null;
      refresh_token: string | null;
      expires_at: Date | null;
      disconnectedAt: Date | null;
    };
  };
  logger: Logger;
}) {
  const { provider } = connection;
  const { account } = mailbox;
  if (
    (provider !== "google" && provider !== "microsoft") ||
    account.provider !== provider ||
    mailbox.email.trim().toLowerCase() !==
      connection.email.trim().toLowerCase() ||
    account.disconnectedAt ||
    !account.access_token ||
    !account.refresh_token ||
    account.refresh_token === connection.refreshToken ||
    !account.expires_at ||
    account.expires_at.getTime() <= Date.now() + 11 * 60_000 ||
    !getCalendarGrant(provider, account.scope).canList
  )
    return;

  const tokens = {
    accessToken: account.access_token,
    refreshToken: account.refresh_token,
    expiresAt: account.expires_at,
  };

  // Verify the alternative credential before reporting recovery.
  const client = await createMonthProvider(
    { ...connection, ...tokens },
    logger,
  );
  await client.calendars();
  await prisma.calendarConnection.updateMany({
    where: {
      id: connection.id,
      updatedAt: connection.updatedAt,
      isConnected: false,
    },
    data: { ...tokens, isConnected: true },
  });
}

function getCalendarGrant(
  provider: "google" | "microsoft",
  grantedScope?: string | null,
) {
  const scopes = new Set(grantedScope?.toLowerCase().split(/[\s,]+/));
  if (provider === "google") {
    const prefix = "https://www.googleapis.com/auth/";
    const fullAccess = scopes.has(`${prefix}calendar`);
    const canReadCalendarList =
      fullAccess ||
      scopes.has(`${prefix}calendar.readonly`) ||
      scopes.has(`${prefix}calendar.calendarlist.readonly`);
    return {
      canList:
        canReadCalendarList &&
        (fullAccess ||
          scopes.has(`${prefix}calendar.readonly`) ||
          scopes.has(`${prefix}calendar.events`) ||
          scopes.has(`${prefix}calendar.events.readonly`)),
      canEdit: fullAccess || scopes.has(`${prefix}calendar.events`),
    };
  }

  const canEdit = [...scopes].some((scope) =>
    /(?:^|\/)calendars\.readwrite(?:\.shared)?$/.test(scope),
  );
  return {
    canEdit,
    canList:
      canEdit ||
      [...scopes].some((scope) =>
        /(?:^|\/)calendars\.read(?:\.shared)?$/.test(scope),
      ),
  };
}
