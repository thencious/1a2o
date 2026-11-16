import prisma from "@/utils/prisma";
import { SafeError } from "@/utils/error";
import type { Logger } from "@/utils/logger";
import { createMonthProvider, type MonthProvider } from "./month-provider";
import { calendarIdentity, deduplicateCalendars } from "./month-utils";
import type { CalendarMonth, MonthCalendar } from "./month-types";
import type { SaveMonthEvent } from "@/utils/actions/calendar-month.validation";
import { getCalendarDefaults } from "./defaults-store";

export async function getCalendarCatalog(userId: string, logger: Logger) {
  const { calendars, warnings } = await discoverCalendars(userId, logger);
  return { calendars, warnings };
}

export async function getCalendarMonth(
  userId: string,
  start: string,
  end: string,
  logger: Logger,
): Promise<CalendarMonth> {
  const {
    calendars: deduplicated,
    warnings,
    providers,
    unavailableAccounts,
  } = await discoverCalendars(userId, logger);
  const events: CalendarMonth["events"] = [];
  const unavailableCalendarIds: string[] = [];
  // Bound provider concurrency so a large shared-calendar list does not flood Google or Graph.
  for (let index = 0; index < deduplicated.length; index += 4) {
    const batch = deduplicated.slice(index, index + 4);
    const results = await Promise.allSettled(
      batch.map((calendar) =>
        providers.get(calendar.connectionId)!.events(calendar, start, end),
      ),
    );
    results.forEach((result, offset) => {
      if (result.status === "fulfilled") events.push(...result.value);
      else {
        unavailableCalendarIds.push(batch[offset].id);
        warnings.push(
          `${batch[offset].name} (${batch[offset].accountEmail}): events could not be loaded. Refresh to retry.`,
        );
      }
    });
  }
  events.sort(
    (a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title),
  );
  return {
    calendars: deduplicated,
    events,
    warnings,
    unavailableAccounts,
    unavailableCalendarIds,
  };
}

export async function getMonthWriteTarget(
  userId: string,
  connectionId: string,
  calendarId: string,
  logger: Logger,
) {
  const connection = await prisma.calendarConnection.findFirst({
    where: { id: connectionId, emailAccount: { userId }, isConnected: true },
    select: {
      id: true,
      provider: true,
      email: true,
      emailAccountId: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  });
  if (!connection) throw new SafeError("Calendar connection not found.");
  const provider = await createMonthProvider(connection, logger);
  const calendar = await provider.calendar(calendarId);
  if (!calendar.writable) throw new SafeError("This calendar is read-only.");
  return { provider, calendar };
}

export async function saveMonthEvent(
  userId: string,
  input: SaveMonthEvent,
  logger: Logger,
) {
  const { provider, calendar } = await getMonthWriteTarget(
    userId,
    input.connectionId,
    input.calendarId,
    logger,
  );
  let writeInput = input;
  if (input.conference === "google_meet" && calendar.provider !== "google")
    throw new SafeError(
      "Choose a Google calendar to create a Google Meet link, or use an existing meeting link in Location.",
    );
  if (input.conference === "zoom") {
    const preferences = await getCalendarDefaults(userId);
    if (!preferences.zoomMeetingUrl)
      throw new SafeError(
        "Add your Zoom meeting link in Settings → Calendars first.",
      );
    writeInput = { ...input, location: preferences.zoomMeetingUrl };
  }
  return calendarWrite(() => provider.save(calendar, writeInput));
}

export async function deleteMonthEvent(
  userId: string,
  input: {
    connectionId: string;
    calendarId: string;
    eventId: string;
    etag: string;
  },
  logger: Logger,
) {
  const { provider, calendar } = await getMonthWriteTarget(
    userId,
    input.connectionId,
    input.calendarId,
    logger,
  );
  await calendarWrite(() =>
    provider.remove(calendar, input.eventId, input.etag),
  );
  return { success: true };
}

async function calendarWrite<T>(write: () => Promise<T>) {
  try {
    return await write();
  } catch (error) {
    const response = error as {
      statusCode?: number;
      code?: number | string;
      response?: { status?: number };
    };
    const status = Number(
      response.statusCode ?? response.response?.status ?? response.code,
    );
    if (status === 412)
      throw new SafeError(
        "This event changed elsewhere. Your edits are still here. Close it, refresh, and reopen it before saving.",
      );
    if (status === 403)
      throw new SafeError(
        "Calendar access was denied. Reconnect the calendar with editing permission or open the event with its provider.",
      );
    throw error;
  }
}

async function discoverCalendars(userId: string, logger: Logger) {
  const connections = await prisma.calendarConnection.findMany({
    where: { emailAccount: { userId }, isConnected: true },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      provider: true,
      email: true,
      emailAccountId: true,
      accessToken: true,
      refreshToken: true,
      expiresAt: true,
    },
  });
  // Keep backup credentials: the latest-updated copy can contain a revoked grant.
  const grouped = new Map<string, typeof connections>();
  for (const connection of connections) {
    const key = JSON.stringify([
      connection.provider,
      connection.email.toLowerCase(),
    ]);
    const copies = grouped.get(key) ?? [];
    copies.push(connection);
    grouped.set(key, copies);
  }
  const groups = [...grouped.values()];
  const providers = new Map<string, MonthProvider>();
  const calendars: MonthCalendar[] = [];
  const warnings: string[] = [];
  const unavailableAccounts: NonNullable<CalendarMonth["unavailableAccounts"]> =
    [];
  await Promise.all(
    groups.map(async (copies) => {
      for (const connection of copies) {
        try {
          const provider = await createMonthProvider(connection, logger);
          const listed = await provider.calendars();
          providers.set(connection.id, provider);
          calendars.push(...listed);
          return;
        } catch {
          logger.warn(
            "Unified calendar connection failed; trying remaining copies",
            {
              connectionId: connection.id,
            },
          );
        }
      }
      unavailableAccounts.push({
        provider: copies[0].provider,
        email: copies[0].email,
      });
      warnings.push(
        `${copies[0].email}: calendar access failed. Reconnect this account in calendar settings.`,
      );
    }),
  );
  const deduplicated = deduplicateCalendars(calendars).map((calendar) => ({
    ...calendar,
    id: calendarIdentity(calendar),
  }));
  return { calendars: deduplicated, warnings, providers, unavailableAccounts };
}
