import { describe, expect, it } from "vitest";
import { requireCalendarEditingScope } from "./editing-permission";

describe("calendar editing grants", () => {
  it.each([
    undefined,
    "",
    "https://www.googleapis.com/auth/calendar.readonly",
    "Calendars.Read",
    "calendar.events",
  ])("rejects a missing or read-only grant: %s", (scope) => {
    expect(() => requireCalendarEditingScope("google", scope)).toThrow(
      "editing permission",
    );
    expect(() => requireCalendarEditingScope("microsoft", scope)).toThrow(
      "editing permission",
    );
  });
  it.each([
    "https://www.googleapis.com/auth/calendar.events",
    "openid https://www.googleapis.com/auth/calendar",
  ])("accepts a Google event write grant: %s", (scope) => {
    expect(() => requireCalendarEditingScope("google", scope)).not.toThrow();
  });
  it.each([
    "Calendars.ReadWrite",
    "openid Calendars.Read Calendars.ReadWrite",
    "https://graph.microsoft.com/Calendars.ReadWrite",
    "Calendars.ReadWrite.Shared",
  ])("accepts an Outlook event write grant: %s", (scope) => {
    expect(() => requireCalendarEditingScope("microsoft", scope)).not.toThrow();
  });
});
