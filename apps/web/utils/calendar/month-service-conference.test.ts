import { beforeEach, expect, it, vi } from "vitest";
const { save, preferences, calendar } = vi.hoisted(() => ({
  save: vi.fn(),
  preferences: vi.fn(),
  calendar: {
    id: "calendar",
    connectionId: "connection",
    calendarId: "calendar",
    name: "Calendar",
    provider: "google",
    accountEmail: "owner@example.org",
    writable: true,
    primary: true,
  },
}));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma", () => ({
  default: {
    calendarConnection: { findFirst: async () => ({ id: "connection" }) },
  },
}));
vi.mock("./month-provider", () => ({
  createMonthProvider: async () => ({ calendar: async () => calendar, save }),
}));
vi.mock("./defaults-store", () => ({ getCalendarDefaults: preferences }));
import { saveMonthEvent } from "./month-service";
import { createScopedLogger } from "@/utils/logger";
import type { SaveMonthEvent } from "@/utils/actions/calendar-month.validation";
const logger = createScopedLogger("meeting-conference-test");
const input: SaveMonthEvent = {
  connectionId: "connection",
  calendarId: "calendar",
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  title: "Meeting",
  description: "Notes",
  start: "2026-11-10T18:00:00Z",
  end: "2026-11-10T19:00:00Z",
  allDay: false,
  guests: ["guest@example.org"],
  location: "",
};
beforeEach(() => {
  vi.clearAllMocks();
  calendar.provider = "google";
  save.mockResolvedValue({ id: "created" });
  preferences.mockResolvedValue({
    defaultCalendarId: null,
    meetingProvider: "zoom",
    zoomMeetingUrl: "https://zoom.us/j/123456789",
  });
});
it("uses the server-saved Zoom room without accepting a fabricated Zoom URL from AI", async () => {
  await saveMonthEvent(
    "owner",
    { ...input, conference: "zoom", location: "not-a-meeting-link" },
    logger,
  );
  expect(save).toHaveBeenCalledWith(
    calendar,
    expect.objectContaining({
      location: "https://zoom.us/j/123456789",
      guests: ["guest@example.org"],
    }),
  );
});
it("does not create an event when Zoom is selected without a configured link", async () => {
  preferences.mockResolvedValue({ zoomMeetingUrl: "" });
  await expect(
    saveMonthEvent("owner", { ...input, conference: "zoom" }, logger),
  ).rejects.toThrow("Zoom meeting link");
  expect(save).not.toHaveBeenCalled();
});
it("does not silently replace Google Meet with a different service on Outlook", async () => {
  calendar.provider = "microsoft";
  await expect(
    saveMonthEvent("owner", { ...input, conference: "google_meet" }, logger),
  ).rejects.toThrow("Google calendar");
  expect(save).not.toHaveBeenCalled();
});
