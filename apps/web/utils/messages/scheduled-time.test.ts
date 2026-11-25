import { describe, expect, it } from "vitest";
import { resolveMessageSendTime } from "./scheduled-time";

describe("scheduled message time", () => {
  it("schedules 7 in the morning using the conversation's local timezone", () => {
    expect(
      resolveMessageSendTime(
        "2026-11-25T07:00",
        "America/Los_Angeles",
        new Date("2026-11-25T03:00:00Z"),
      ).toISOString(),
    ).toBe("2026-11-25T15:00:00.000Z");
  });

  it("rejects a nonexistent DST time rather than silently changing it", () => {
    expect(() =>
      resolveMessageSendTime(
        "2027-03-14T02:30",
        "America/Los_Angeles",
        new Date("2027-03-13T12:00:00Z"),
      ),
    ).toThrow("does not exist");
  });

  it("never turns a past schedule into an immediate send", () => {
    expect(() =>
      resolveMessageSendTime(
        "2026-11-25T07:00",
        "America/Los_Angeles",
        new Date("2026-11-25T15:00:00Z"),
      ),
    ).toThrow("future time");
  });
});
