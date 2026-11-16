import { describe, expect, it } from "vitest";
import { calendarDropInput } from "./event-drop";
import type { MonthCalendar, MonthEvent } from "./month-types";

const calendar: MonthCalendar = {
  id: "cal",
  connectionId: "connection",
  calendarId: "calendar",
  name: "Work",
  accountEmail: "owner@example.com",
  provider: "google",
  writable: true,
  primary: true,
};
const event: MonthEvent = {
  id: "event",
  calendarKey: "cal",
  title: "Proposal",
  description: "Keep these notes",
  location: "Room",
  start: new Date(2026, 2, 7, 10).toISOString(),
  end: new Date(2026, 2, 7, 11, 30).toISOString(),
  allDay: false,
  guests: ["guest@example.com"],
  etag: "v1",
  editable: true,
  recurring: true,
  descriptionLocked: false,
};
const requestId = "550e8400-e29b-41d4-a716-446655440000";
const base = {
  event,
  calendar,
  from: new Date(2026, 2, 7),
  to: new Date(2026, 2, 8),
  copy: false,
  requestId,
};

describe("calendar drag and Alt-drag", () => {
  it("moves to a local date preserving wall-clock time and duration across daylight-saving changes", () => {
    const moved = calendarDropInput(base)!;
    expect(new Date(moved.start).getDate()).toBe(8);
    expect(new Date(moved.start).getHours()).toBe(10);
    expect(Date.parse(moved.end) - Date.parse(moved.start)).toBe(90 * 60_000);
    expect(moved).toMatchObject({
      eventId: event.id,
      etag: "v1",
      guests: event.guests,
      description: event.description,
      location: event.location,
    });
    expect(event.start).toBe(new Date(2026, 2, 7, 10).toISOString());
  });
  it("duplicates independently and leaves the source and its invitation list unchanged", () => {
    const copied = calendarDropInput({ ...base, copy: true })!;
    expect(copied).toMatchObject({
      title: "Proposal (copy)",
      guests: [],
      requestId,
    });
    expect(copied.eventId).toBeUndefined();
    expect(copied.etag).toBeUndefined();
    expect(new Date(copied.start).getDate()).toBe(8);
    expect(new Date(copied.start).getHours()).toBe(10);
    expect(Date.parse(copied.end) - Date.parse(copied.start)).toBe(90 * 60_000);
    expect(event.guests).toEqual(["guest@example.com"]);
  });
  it("ignores Alt-drops back into the original slot for month, all-day and timeline events", () => {
    expect(
      calendarDropInput({ ...base, copy: true, to: base.from }),
    ).toBeNull();
    expect(
      calendarDropInput({
        ...base,
        copy: true,
        to: base.from,
        minute: 600,
        event: {
          ...event,
          start: event.start.replace("Z", "+00:00"),
          end: event.end.replace("Z", "+00:00"),
        },
      }),
    ).toBeNull();
    expect(
      calendarDropInput({
        ...base,
        copy: true,
        to: base.from,
        event: {
          ...event,
          allDay: true,
          start: "2026-03-06",
          end: "2026-03-09",
        },
      }),
    ).toBeNull();
  });
  it("still allows Alt-copying to another time or another calendar", () => {
    const later = calendarDropInput({
      ...base,
      copy: true,
      to: base.from,
      minute: 720,
    })!;
    expect(new Date(later.start).getHours()).toBe(12);
    expect(later.eventId).toBeUndefined();
    const other = calendarDropInput({
      ...base,
      copy: true,
      to: base.from,
      calendar: { ...calendar, id: "other", calendarId: "other-calendar" },
    })!;
    expect(other).toMatchObject({
      calendarId: "other-calendar",
      start: event.start,
      end: event.end,
    });
  });
  it("moves a multi-day item relative to the day grabbed, preserving exclusive all-day ends", () => {
    const moved = calendarDropInput({
      ...base,
      event: { ...event, allDay: true, start: "2026-03-06", end: "2026-03-09" },
    })!;
    expect(moved.start).toBe("2026-03-07");
    expect(moved.end).toBe("2026-03-10");
  });
  it("snaps timeline moves to quarter hours and preserves timed overnight duration", () => {
    const overnight = {
      ...event,
      start: new Date(2026, 2, 7, 23, 45).toISOString(),
      end: new Date(2026, 2, 8, 1, 15).toISOString(),
    };
    const moved = calendarDropInput({
      ...base,
      event: overnight,
      minute: 623,
    })!;
    expect(new Date(moved.start).getDate()).toBe(8);
    expect(new Date(moved.start).getHours()).toBe(10);
    expect(new Date(moved.start).getMinutes()).toBe(30);
    expect(Date.parse(moved.end) - Date.parse(moved.start)).toBe(
      Date.parse(overnight.end) - Date.parse(overnight.start),
    );
  });
  it("ignores an unchanged drop and blocks missing edit permissions or stale identity", () => {
    expect(calendarDropInput({ ...base, to: base.from })).toBeNull();
    expect(() =>
      calendarDropInput({ ...base, event: { ...event, editable: false } }),
    ).toThrow("read-only");
    expect(() =>
      calendarDropInput({
        ...base,
        calendar: { ...calendar, writable: false },
        copy: true,
      }),
    ).toThrow("writable calendar");
    expect(() =>
      calendarDropInput({ ...base, event: { ...event, etag: "" } }),
    ).toThrow("read-only");
  });
  it("copies read-only invitations and shared-calendar items into a writable calendar without changing the source", () => {
    const source = {
      ...event,
      calendarKey: "read-only-calendar",
      editable: false,
      etag: "",
      readOnlyReason: "The organizer does not allow edits.",
    };
    const copied = calendarDropInput({ ...base, event: source, copy: true })!;
    expect(copied).toMatchObject({
      connectionId: calendar.connectionId,
      calendarId: calendar.calendarId,
      title: "Proposal (copy)",
      guests: [],
    });
    expect(copied.eventId).toBeUndefined();
    expect(copied.etag).toBeUndefined();
    expect(source.calendarKey).toBe("read-only-calendar");
    expect(() => calendarDropInput({ ...base, event: source })).toThrow(
      "Hold Alt",
    );
  });
});
