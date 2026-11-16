import { addDays, differenceInCalendarDays, format } from "date-fns";
import type { MonthCalendar, MonthEvent } from "./month-types";
import { saveMonthEventBody } from "@/utils/actions/calendar-month.validation";

export function calendarDropInput({
  event,
  calendar,
  from,
  to,
  copy,
  minute,
  requestId,
}: {
  event: MonthEvent;
  calendar: MonthCalendar;
  from: Date;
  to: Date;
  copy: boolean;
  minute?: number;
  requestId: string;
}) {
  if (!calendar.writable)
    throw new Error(
      "Choose a writable calendar for this copy in Calendar settings.",
    );
  if (
    !copy &&
    (!event.editable || !event.etag || calendar.id !== event.calendarKey)
  )
    throw new Error(
      `${event.readOnlyReason ?? "This calendar item is read-only."} Hold Alt while dragging to create an editable copy.`,
    );
  const days = differenceInCalendarDays(to, from);
  let start: string;
  let end: string;
  if (event.allDay) {
    start = format(
      addDays(new Date(`${event.start}T00:00:00`), days),
      "yyyy-MM-dd",
    );
    end = format(
      addDays(new Date(`${event.end}T00:00:00`), days),
      "yyyy-MM-dd",
    );
  } else {
    const moved =
      minute === undefined
        ? addDays(new Date(event.start), days)
        : new Date(to);
    if (minute !== undefined)
      moved.setHours(
        0,
        Math.max(0, Math.min(1425, Math.round(minute / 15) * 15)),
        0,
        0,
      );
    start = moved.toISOString();
    end = new Date(
      moved.getTime() + Date.parse(event.end) - Date.parse(event.start),
    ).toISOString();
  }
  if (
    calendar.id === event.calendarKey &&
    start === event.start &&
    end === event.end
  )
    return null;
  if (
    calendar.id === event.calendarKey &&
    Date.parse(start) === Date.parse(event.start) &&
    Date.parse(end) === Date.parse(event.end)
  )
    return null;
  return saveMonthEventBody.parse({
    connectionId: calendar.connectionId,
    calendarId: calendar.calendarId,
    eventId: copy ? undefined : event.id,
    etag: copy ? undefined : event.etag,
    requestId,
    title: copy ? `${event.title.slice(0, 505)} (copy)` : event.title,
    description: event.description,
    location: event.location,
    start,
    end,
    allDay: event.allDay,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    guests: copy ? [] : event.guests,
  });
}
