import { z } from "zod";
import type { CalendarMonth } from "./month-types";

export const CALENDAR_CACHE_PREFIX = "inbox-zero:calendar-month:v1:";
const maxAge = 30 * 24 * 60 * 60 * 1000;
const monthSchema = z.object({
  unavailableAccounts: z
    .array(z.object({ provider: z.string(), email: z.string() }))
    .optional(),
  unavailableCalendarIds: z.array(z.string()).optional(),
  calendars: z.array(
    z.object({
      id: z.string(),
      connectionId: z.string(),
      calendarId: z.string(),
      name: z.string(),
      accountEmail: z.string(),
      provider: z.string(),
      writable: z.boolean(),
      primary: z.boolean(),
    }),
  ),
  events: z.array(
    z.object({
      ruleLabel: z.string().nullable().optional(),
      id: z.string(),
      calendarKey: z.string(),
      title: z.string(),
      description: z.string(),
      location: z.string(),
      start: z.string(),
      end: z.string(),
      allDay: z.boolean(),
      guests: z.array(z.string()),
      etag: z.string(),
      editable: z.boolean(),
      deletable: z.boolean().optional(),
      readOnlyReason: z.string().optional(),
      recurring: z.boolean(),
      descriptionLocked: z.boolean(),
      url: z.string().optional(),
      conferenceUrl: z.string().optional(),
    }),
  ),
  warnings: z.array(z.string()),
});
const cacheSchema = z.array(
  z.object({
    range: z.string(),
    savedAt: z.number(),
    data: monthSchema,
  }),
);

export function readCalendarMonthCache(
  raw: string | null,
  range: string,
  now = Date.now(),
): CalendarMonth | undefined {
  return readEntries(raw, now).find((entry) => entry.range === range)?.data;
}

export function updateCalendarMonthCache(
  raw: string | null,
  range: string,
  data: CalendarMonth,
  now = Date.now(),
) {
  const entries = readEntries(raw, now).filter(
    (entry) => entry.range !== range,
  );
  entries.push({ range, savedAt: now, data });
  return JSON.stringify(
    entries.sort((a, b) => b.savedAt - a.savedAt).slice(0, 12),
  );
}

function readEntries(raw: string | null, now: number) {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(raw ?? "null"));
    return parsed.success
      ? parsed.data.filter(
          (entry) => entry.savedAt <= now && now - entry.savedAt < maxAge,
        )
      : [];
  } catch {
    return [];
  }
}

export function mergeCalendarMonth(
  previous: CalendarMonth | undefined,
  fresh: CalendarMonth,
): CalendarMonth {
  if (!previous) return fresh;
  const failedAccounts = new Set(
    (fresh.unavailableAccounts ?? []).map((account) =>
      JSON.stringify([account.provider, account.email.toLowerCase()]),
    ),
  );
  const failedCalendars = new Set(fresh.unavailableCalendarIds ?? []);
  const savedCalendars = previous.calendars.filter((calendar) =>
    failedAccounts.has(
      JSON.stringify([calendar.provider, calendar.accountEmail.toLowerCase()]),
    ),
  );
  for (const calendar of savedCalendars) failedCalendars.add(calendar.id);
  const liveIds = new Set(
    fresh.events.map((event) => JSON.stringify([event.calendarKey, event.id])),
  );
  const savedEvents = previous.events.filter(
    (event) =>
      failedCalendars.has(event.calendarKey) &&
      !liveIds.has(JSON.stringify([event.calendarKey, event.id])),
  );
  if (!savedCalendars.length && !savedEvents.length) return fresh;
  const calendars = new Map(
    fresh.calendars.map((calendar) => [calendar.id, calendar]),
  );
  for (const calendar of savedCalendars) {
    if (!calendars.has(calendar.id))
      calendars.set(calendar.id, { ...calendar, writable: false });
  }
  return {
    ...fresh,
    calendars: [...calendars.values()],
    events: [
      ...fresh.events,
      ...savedEvents.map((event) => ({
        ...event,
        editable: false,
        deletable: false,
        readOnlyReason:
          "Saved event: calendar sync is unavailable. Reconnect or refresh before editing.",
      })),
    ],
    warnings: [
      ...fresh.warnings,
      "Showing saved calendars and events for accounts that could not sync. Saved events are read-only until access is restored.",
    ],
  };
}
