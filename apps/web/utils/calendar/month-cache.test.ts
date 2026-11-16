import { describe, expect, it } from "vitest";
import {
  mergeCalendarMonth,
  readCalendarMonthCache,
  updateCalendarMonthCache,
} from "./month-cache";
import type { CalendarMonth } from "./month-types";

const now = Date.UTC(2026, 9, 30);
const month: CalendarMonth = { calendars: [], events: [], warnings: [] };

describe("persistent calendar months", () => {
  it("restores the requested month after a new storage read, never another month's events", () => {
    const first = updateCalendarMonthCache(null, "october", month, now);
    const second = updateCalendarMonthCache(
      first,
      "november",
      { ...month, warnings: ["November"] },
      now + 1,
    );
    expect(readCalendarMonthCache(second, "october", now + 2)).toEqual(month);
    expect(
      readCalendarMonthCache(second, "november", now + 2)?.warnings,
    ).toEqual(["November"]);
    expect(readCalendarMonthCache(second, "december", now + 2)).toBeUndefined();
  });
  it("replaces refreshed snapshots, including deleting stale events and empty calendars", () => {
    const old = updateCalendarMonthCache(
      null,
      "october",
      { ...month, warnings: ["Old"] },
      now,
    );
    const refreshed = updateCalendarMonthCache(old, "october", month, now + 1);
    expect(readCalendarMonthCache(refreshed, "october", now + 2)).toEqual(
      month,
    );
    expect(JSON.parse(refreshed)).toHaveLength(1);
  });
  it("ignores corrupt, incompatible, expired and future snapshots", () => {
    for (const raw of [
      "{",
      "{}",
      '[{"range":"october","savedAt":1,"data":{"events":[{}]}}]',
    ]) {
      expect(readCalendarMonthCache(raw, "october", now)).toBeUndefined();
    }
    const raw = updateCalendarMonthCache(null, "october", month, now);
    expect(readCalendarMonthCache(raw, "october", now - 1)).toBeUndefined();
    expect(
      readCalendarMonthCache(raw, "october", now + 31 * 86_400_000),
    ).toBeUndefined();
  });
  it("bounds storage to the twelve most recently refreshed ranges", () => {
    let raw: string | null = null;
    for (let index = 0; index < 15; index++)
      raw = updateCalendarMonthCache(raw, String(index), month, now + index);
    expect(JSON.parse(raw!)).toHaveLength(12);
    expect(readCalendarMonthCache(raw, "0", now + 15)).toBeUndefined();
    expect(readCalendarMonthCache(raw, "14", now + 15)).toEqual(month);
  });
});

describe("partial calendar refreshes", () => {
  const calendar = {
    id: "google-work",
    connectionId: "connection",
    calendarId: "work",
    name: "Work",
    accountEmail: "work@example.com",
    provider: "google",
    writable: true,
    primary: true,
  };
  const event = {
    id: "meeting",
    calendarKey: calendar.id,
    title: "Meeting",
    description: "",
    location: "",
    start: "2026-11-06T10:00:00Z",
    end: "2026-11-06T11:00:00Z",
    allDay: false,
    guests: [],
    etag: "1",
    editable: true,
    deletable: true,
    recurring: false,
    descriptionLocked: false,
  };
  const previous: CalendarMonth = {
    calendars: [calendar],
    events: [event],
    warnings: [],
  };
  it("keeps saved events read-only when their account cannot reconnect", () => {
    const refreshed = {
      ...month,
      warnings: ["Access failed"],
      unavailableAccounts: [{ provider: "google", email: "WORK@example.com" }],
    };
    const merged = mergeCalendarMonth(previous, refreshed);
    expect(merged.calendars).toHaveLength(1);
    expect(merged.calendars[0].writable).toBe(false);
    expect(merged.events[0]).toMatchObject({
      id: "meeting",
      editable: false,
      deletable: false,
    });
    expect(merged.warnings.join(" ")).toContain("saved");
    const cached = updateCalendarMonthCache(null, "november", merged, now);
    expect(
      readCalendarMonthCache(cached, "november", now)?.events,
    ).toHaveLength(1);
  });
  it("retains events only for the calendar whose event request failed", () => {
    const refreshed = {
      ...previous,
      events: [],
      unavailableCalendarIds: [calendar.id],
      warnings: ["Events failed"],
    };
    expect(mergeCalendarMonth(previous, refreshed).events).toHaveLength(1);
    expect(
      mergeCalendarMonth(previous, { ...previous, events: [] }).events,
    ).toEqual([]);
  });
  it("does not resurrect removed accounts or leak saved events without an explicit failure", () => {
    expect(mergeCalendarMonth(previous, month)).toEqual(month);
    expect(mergeCalendarMonth(undefined, month)).toEqual(month);
  });
  it("replaces the saved copy on recovery and restores live editing", () => {
    const stale = mergeCalendarMonth(previous, {
      ...month,
      unavailableCalendarIds: [calendar.id],
    });
    const recovered = mergeCalendarMonth(stale, previous);
    expect(recovered).toEqual(previous);
  });
});
