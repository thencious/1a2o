import {
  addDays,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  endOfWeek,
} from "date-fns";
import type { MonthCalendar, MonthEvent } from "./month-types";

export function monthDays(month: Date) {
  const start = startOfWeek(startOfMonth(month));
  const end = endOfWeek(endOfMonth(month));
  const days: Date[] = [];
  for (let day = start; day <= end; day = addDays(day, 1)) days.push(day);
  return days;
}

export function eventOnDay(event: MonthEvent, day: Date) {
  if (event.allDay) {
    const date = format(day, "yyyy-MM-dd");
    return event.start.slice(0, 10) <= date && event.end.slice(0, 10) > date;
  }
  return (
    Date.parse(event.start) < addDays(day, 1).getTime() &&
    Date.parse(event.end) > day.getTime()
  );
}

export function calendarIdentity(calendar: MonthCalendar) {
  const identity =
    calendar.calendarId === "primary"
      ? calendar.accountEmail.toLowerCase()
      : calendar.calendarId;
  return JSON.stringify([
    calendar.provider,
    ...(calendar.provider === "microsoft"
      ? [calendar.accountEmail.toLowerCase()]
      : []),
    identity,
  ]);
}

export function compareMonthEvents(a: MonthEvent, b: MonthEvent) {
  return (
    Number(b.allDay) - Number(a.allDay) ||
    Date.parse(a.start) - Date.parse(b.start) ||
    a.title.localeCompare(b.title)
  );
}

export function deduplicateCalendars(calendars: MonthCalendar[]) {
  const unique = new Map<string, MonthCalendar>();
  for (const calendar of calendars) {
    const key = calendarIdentity(calendar);
    const previous = unique.get(key);
    const rank = (item: MonthCalendar) =>
      Number(item.writable) * 2 + Number(item.primary);
    if (!previous || rank(calendar) > rank(previous)) unique.set(key, calendar);
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.accountEmail.localeCompare(b.accountEmail) ||
      a.name.localeCompare(b.name),
  );
}

export function calendarColors(
  calendars: MonthCalendar[],
  archived: string[] = [],
) {
  const excluded = new Set(archived);
  const active = calendars.filter((calendar) => !excluded.has(calendar.id));
  const identities = [...new Set(active.map(calendarIdentity))].sort();
  const palette = [0, 55, 215, 135, 280, 28, 185, 325];
  while (palette.length < identities.length) {
    const sorted = [...palette].sort((a, b) => a - b);
    let gap = 0;
    let midpoint = 0;
    sorted.forEach((hue, index) => {
      const distance = (sorted[(index + 1) % sorted.length] - hue + 360) % 360;
      if (distance > gap) {
        gap = distance;
        midpoint = (hue + distance / 2) % 360;
      }
    });
    palette.push(midpoint);
  }
  const hues = new Map(
    identities.map((identity, index) => [identity, palette[index]]),
  );
  return Object.fromEntries(
    active.map((calendar) => [
      calendar.id,
      hues.get(calendarIdentity(calendar))!,
    ]),
  );
}
