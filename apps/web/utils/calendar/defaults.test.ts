import { expect, it } from "vitest";
import {
  calendarDefaults,
  initialCalendarDefaults,
  preferredCalendar,
} from "./defaults";
import type { MonthCalendar } from "./month-types";
it("prefers the configured writable calendar over the primary calendar", () => {
  const base = {
    connectionId: "connection",
    calendarId: "calendar",
    name: "Calendar",
    accountEmail: "owner@example.org",
    provider: "google",
    writable: true,
  };
  const calendars: MonthCalendar[] = [
    { ...base, id: "primary", primary: true },
    { ...base, id: "chosen", primary: false },
  ];
  expect(preferredCalendar(calendars, "chosen")?.id).toBe("chosen");
  expect(preferredCalendar(calendars, null)?.id).toBe("primary");
  expect(
    preferredCalendar(
      calendars.map((calendar) => ({ ...calendar, writable: false })),
      "chosen",
    ),
  ).toBeUndefined();
});
it("accepts Zoom meeting links but refuses insecure, unrelated, or credential-bearing URLs", () => {
  expect(
    calendarDefaults.safeParse({
      ...initialCalendarDefaults,
      meetingProvider: "zoom",
    }).success,
  ).toBe(false);
  expect(
    calendarDefaults.safeParse({
      ...initialCalendarDefaults,
      zoomMeetingUrl: "https://us02web.zoom.us/j/123?pwd=example",
    }).success,
  ).toBe(true);
  for (const zoomMeetingUrl of [
    "http://zoom.us/j/123",
    "https://zoom.us.example.org/j/123",
    "https://user:password@zoom.us/j/123",
    "javascript:alert(1)",
  ])
    expect(
      calendarDefaults.safeParse({ ...initialCalendarDefaults, zoomMeetingUrl })
        .success,
    ).toBe(false);
});
