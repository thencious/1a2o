import { describe, expect, it } from "vitest";
import {
  eventOnDay,
  monthDays,
  deduplicateCalendars,
  compareMonthEvents,
  calendarColors,
} from "./month-utils";
import type { MonthCalendar, MonthEvent } from "./month-types";
import {
  calendarMonthRange,
  saveMonthEventBody,
} from "@/utils/actions/calendar-month.validation";

describe("unified calendar month", () => {
  it("gives more than eight calendars distinct hues in a stable order", () => {
    const calendars = Array.from({ length: 24 }, (_, index) => ({
      id: `calendar-${index}`,
      calendarId: `calendar-${index}@example.com`,
      accountEmail: "owner@example.com",
      provider: "google",
    })) as MonthCalendar[];
    const colors = calendarColors(calendars);
    const hues = Object.values(colors).sort((a, b) => a - b);
    expect(new Set(hues).size).toBe(calendars.length);
    for (const hue of hues) {
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
    expect(calendarColors([...calendars].reverse())).toEqual(colors);
    expect(calendarColors([])).toEqual({});
  });
  it("reserves no colors for archived calendars and spreads the palette over active ones", () => {
    const calendars = Array.from({ length: 10 }, (_, index) => ({
      id: `calendar-${index}`,
      calendarId: `calendar-${index}@example.com`,
      accountEmail: "owner@example.com",
      provider: "google",
    })) as MonthCalendar[];
    const active = calendars.filter((_, index) => index % 2 === 0);
    const archived = calendars.filter((_, index) => index % 2 !== 0);
    const colors = calendarColors(
      calendars,
      archived.map((item) => item.id),
    );
    expect(colors).toEqual(calendarColors(active));
    expect(Object.keys(colors).sort()).toEqual(
      active.map((item) => item.id).sort(),
    );
    expect(
      calendarColors(
        calendars,
        calendars.map((item) => item.id),
      ),
    ).toEqual({});
  });
  it("keeps a shared calendar's color when its owning connection changes", () => {
    const shared = {
      id: "reader",
      calendarId: "shared@example.com",
      accountEmail: "reader@example.com",
      provider: "google",
    } as MonthCalendar;
    const other = {
      ...shared,
      id: "other",
      calendarId: "other@example.com",
    };
    const owner = { ...shared, id: "owner", accountEmail: "owner@example.com" };
    expect(calendarColors([shared, other]).reader).toBe(
      calendarColors([owner, other]).owner,
    );
    expect(calendarColors([owner, shared, other]).owner).toBe(
      calendarColors([owner, shared, other]).reader,
    );
  });
  it("orders timed events by the actual instant across provider timezones", () => {
    const later = {
      start: "2026-10-30T17:00:00-07:00",
      allDay: false,
      title: "Later",
    } as MonthEvent;
    const earlier = {
      start: "2026-10-30T20:00:00Z",
      allDay: false,
      title: "Earlier",
    } as MonthEvent;
    expect([later, earlier].sort(compareMonthEvents)).toEqual([earlier, later]);
  });
  it("covers the full month with complete Sunday-to-Saturday weeks", () => {
    for (const month of [
      new Date(2026, 1, 1),
      new Date(2026, 7, 1),
      new Date(2026, 10, 1),
    ]) {
      const days = monthDays(month);
      expect(days[0].getDay()).toBe(0);
      expect(days.at(-1)?.getDay()).toBe(6);
      expect(days.length % 7).toBe(0);
      expect(
        days.filter((day) => day.getMonth() === month.getMonth()),
      ).toHaveLength(
        new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(),
      );
    }
  });
  it("treats all-day end dates as exclusive and ignores local UTC offsets", () => {
    const event = {
      allDay: true,
      start: "2026-10-29",
      end: "2026-10-31",
    } as MonthEvent;
    expect(eventOnDay(event, new Date(2026, 9, 29))).toBe(true);
    expect(eventOnDay(event, new Date(2026, 9, 30))).toBe(true);
    expect(eventOnDay(event, new Date(2026, 9, 31))).toBe(false);
  });
  it("places a timed overnight event on both days but excludes its midnight end", () => {
    const event = {
      allDay: false,
      start: new Date(2026, 9, 29, 23).toISOString(),
      end: new Date(2026, 9, 31).toISOString(),
    } as MonthEvent;
    expect(eventOnDay(event, new Date(2026, 9, 29))).toBe(true);
    expect(eventOnDay(event, new Date(2026, 9, 30))).toBe(true);
    expect(eventOnDay(event, new Date(2026, 9, 31))).toBe(false);
  });
  it("deduplicates shared Google calendars, preferring their writable owner", () => {
    const reader: MonthCalendar = {
      id: "reader",
      connectionId: "c1",
      calendarId: "shared@example.com",
      name: "Shared",
      provider: "google",
      accountEmail: "other@example.com",
      writable: false,
      primary: false,
    };
    const owner = {
      ...reader,
      id: "owner",
      connectionId: "c2",
      writable: true,
      primary: true,
    };
    expect(deduplicateCalendars([reader, owner])).toEqual([owner]);
    expect(deduplicateCalendars([owner, reader])).toEqual([owner]);
    expect(
      deduplicateCalendars([
        {
          ...reader,
          calendarId: "primary",
          accountEmail: "shared@example.com",
        },
        owner,
      ]),
    ).toEqual([owner]);
    expect(
      deduplicateCalendars([
        { ...reader, provider: "microsoft" },
        {
          ...owner,
          provider: "microsoft",
          accountEmail: "another@example.com",
        },
      ]),
    ).toHaveLength(2);
  });
  it("rejects invalid windows, backwards events, and updates without a revision", () => {
    expect(
      calendarMonthRange.safeParse({
        start: "2026-10-01T00:00:00Z",
        end: "2026-12-01T00:00:00Z",
      }).success,
    ).toBe(false);
    const input = {
      connectionId: "c",
      calendarId: "cal",
      requestId: "550e8400-e29b-41d4-a716-446655440000",
      title: "Test",
      description: "",
      location: "",
      start: "2026-10-29",
      end: "2026-10-30",
      allDay: true,
      guests: [],
    };
    expect(saveMonthEventBody.safeParse(input).success).toBe(true);
    expect(
      saveMonthEventBody.safeParse({ ...input, end: input.start }).success,
    ).toBe(false);
    expect(
      saveMonthEventBody.safeParse({ ...input, eventId: "event" }).success,
    ).toBe(false);
    expect(
      saveMonthEventBody.safeParse({ ...input, guests: ["not an email"] })
        .success,
    ).toBe(false);
  });
});
