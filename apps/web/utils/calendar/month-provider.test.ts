import { beforeEach, describe, expect, it, vi } from "vitest";
import { getCalendarClientWithRefresh as googleClient } from "./client";
import { getCalendarClientWithRefresh as graphClient } from "@/utils/outlook/calendar-client";
import { createScopedLogger } from "@/utils/logger";
import { createMonthProvider, type MonthConnection } from "./month-provider";
import type { SaveMonthEvent } from "@/utils/actions/calendar-month.validation";
import type { MonthCalendar } from "./month-types";

vi.mock("./client", () => ({ getCalendarClientWithRefresh: vi.fn() }));
vi.mock("@/utils/outlook/calendar-client", () => ({
  getCalendarClientWithRefresh: vi.fn(),
}));
const logger = createScopedLogger("month-provider-test");
const connection: MonthConnection = {
  id: "connection",
  provider: "google",
  email: "owner@example.com",
  emailAccountId: "mailbox",
  accessToken: "token",
  refreshToken: "refresh",
  expiresAt: null,
};
const calendar: MonthCalendar = {
  id: "calendar",
  calendarId: "shared@example.com",
  connectionId: "connection",
  name: "Shared",
  accountEmail: "owner@example.com",
  provider: "google",
  writable: true,
  primary: false,
};
const input: SaveMonthEvent = {
  connectionId: "connection",
  calendarId: calendar.calendarId,
  requestId: "550e8400-e29b-41d4-a716-446655440000",
  title: "Edited",
  description: "Notes",
  location: "Room",
  start: "2026-10-29T18:00:00Z",
  end: "2026-10-29T19:00:00Z",
  allDay: false,
  guests: [],
};
const google = {
  calendarList: { list: vi.fn(), get: vi.fn() },
  events: {
    list: vi.fn(),
    get: vi.fn(),
    patch: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  },
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(googleClient).mockResolvedValue(google as never);
});

it("creates a Google Meet conference with stable retry identity and notifies calendar guests", async () => {
  google.events.insert.mockResolvedValue({ data: { id: "created" } });
  const provider = await createMonthProvider(connection, logger);
  await provider.save(calendar, {
    ...input,
    conference: "google_meet",
    guests: ["guest@example.org"],
  });
  expect(google.events.insert).toHaveBeenCalledWith(
    expect.objectContaining({
      conferenceDataVersion: 1,
      sendUpdates: "all",
      requestBody: expect.objectContaining({
        attendees: [{ email: "guest@example.org" }],
        conferenceData: {
          createRequest: {
            requestId: input.requestId,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      }),
    }),
    expect.anything(),
  );
});

describe("Google month events", () => {
  it("treats subscription calendars as read-only even if Google reports owner access", async () => {
    google.calendarList.list.mockResolvedValue({
      data: {
        items: [
          {
            id: "contacts@group.v.calendar.google.com",
            summary: "Birthdays",
            accessRole: "owner",
          },
        ],
      },
    });
    const provider = await createMonthProvider(connection, logger);
    expect((await provider.calendars())[0].writable).toBe(false);
  });
  it("reads secondary calendars and every page, preserving recurring instance IDs and all-day boundaries", async () => {
    google.events.list
      .mockResolvedValueOnce({
        data: {
          items: [
            {
              id: "instance",
              recurringEventId: "series",
              start: { date: "2026-10-29" },
              end: { date: "2026-10-31" },
              etag: "v1",
              organizer: { self: true },
            },
          ],
          nextPageToken: "next",
        },
      })
      .mockResolvedValueOnce({
        data: { items: [{ id: "cancelled", status: "cancelled" }] },
      });
    const provider = await createMonthProvider(connection, logger);
    const events = await provider.events(calendar, input.start, input.end);
    expect(google.events.list).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        calendarId: "shared@example.com",
        pageToken: "next",
        singleEvents: true,
      }),
      expect.anything(),
    );
    expect(events).toEqual([
      expect.objectContaining({
        id: "instance",
        recurring: true,
        allDay: true,
        start: "2026-10-29",
        end: "2026-10-31",
      }),
    ]);
  });
  it("patches only the requested occurrence with its revision and preserves guest response metadata", async () => {
    google.events.get.mockResolvedValue({
      data: {
        id: "instance",
        etag: "v1",
        organizer: { self: true },
        attendees: [{ email: "guest@example.com", responseStatus: "accepted" }],
      },
    });
    google.events.patch.mockResolvedValue({ data: { id: "instance" } });
    const provider = await createMonthProvider(connection, logger);
    await provider.save(calendar, {
      ...input,
      eventId: "instance",
      etag: "v1",
      guests: ["guest@example.com"],
    });
    expect(google.events.patch).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: "instance",
        requestBody: expect.objectContaining({
          attendees: [
            { email: "guest@example.com", responseStatus: "accepted" },
          ],
        }),
      }),
      expect.objectContaining({ headers: { "If-Match": "v1" } }),
    );
  });
  it("rejects stale revisions and invitations before writing", async () => {
    google.events.get
      .mockResolvedValueOnce({
        data: { etag: "newer", organizer: { self: true } },
      })
      .mockResolvedValueOnce({
        data: { etag: "v1", organizer: { email: "someone@example.com" } },
      });
    const provider = await createMonthProvider(connection, logger);
    await expect(
      provider.save(calendar, { ...input, eventId: "instance", etag: "v1" }),
    ).rejects.toThrow("changed elsewhere");
    await expect(
      provider.save(calendar, { ...input, eventId: "instance", etag: "v1" }),
    ).rejects.toThrow("organizer");
    expect(google.events.patch).not.toHaveBeenCalled();
    expect(google.events.delete).not.toHaveBeenCalled();
  });
  it("deletes an owned Gmail-generated event using its revision even when its details are read-only", async () => {
    google.events.get.mockResolvedValue({
      data: {
        id: "gmail-event",
        eventType: "fromGmail",
        etag: "v1",
        organizer: { self: true },
      },
    });
    google.events.delete.mockResolvedValue({});
    const provider = await createMonthProvider(connection, logger);
    await provider.remove(calendar, "gmail-event", "v1");
    expect(google.events.delete).toHaveBeenCalledWith(
      {
        calendarId: calendar.calendarId,
        eventId: "gmail-event",
        sendUpdates: "none",
      },
      expect.objectContaining({ headers: { "If-Match": "v1" } }),
    );
  });
  it("removes an unwanted invitation without emailing its organizer or guests", async () => {
    google.events.get.mockResolvedValue({
      data: {
        id: "spam-invitation",
        etag: "v1",
        organizer: { email: "someone@example.com" },
      },
    });
    google.events.delete.mockResolvedValue({});
    const provider = await createMonthProvider(connection, logger);
    await provider.remove(calendar, "spam-invitation", "v1");
    expect(google.events.delete).toHaveBeenCalledWith(
      expect.objectContaining({ sendUpdates: "none" }),
      expect.anything(),
    );
  });
  it("uses a stable creation ID so retrying an uncertain result does not duplicate the event", async () => {
    google.events.insert.mockRejectedValue({ code: 409 });
    google.events.get.mockResolvedValue({
      data: { id: input.requestId.replaceAll("-", "") },
    });
    const provider = await createMonthProvider(connection, logger);
    await expect(provider.save(calendar, input)).resolves.toEqual({
      id: input.requestId.replaceAll("-", ""),
    });
    expect(google.events.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          id: input.requestId.replaceAll("-", ""),
        }),
      }),
      expect.anything(),
    );
  });
});

describe("Outlook month events", () => {
  function mockGraph() {
    const request = {
      header: vi.fn().mockReturnThis(),
      get: vi.fn(),
      patch: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    };
    const api = vi.fn().mockReturnValue(request);
    vi.mocked(graphClient).mockResolvedValue({ api } as never);
    return { api, request };
  }
  it("can remove an invitation from the user's writable calendar without organizer edit privileges", async () => {
    const { request } = mockGraph();
    request.get.mockResolvedValue({
      id: "invitation",
      isOrganizer: false,
      "@odata.etag": "v1",
    });
    const provider = await createMonthProvider(
      { ...connection, provider: "microsoft" },
      logger,
    );
    await provider.remove(calendar, "invitation", "v1");
    expect(request.delete).toHaveBeenCalledOnce();
  });
  it("follows calendarView pagination and keeps explicitly UTC timed events", async () => {
    const { api, request } = mockGraph();
    request.get
      .mockResolvedValueOnce({
        value: [
          {
            id: "event",
            start: { dateTime: "2026-10-29T18:00:00" },
            end: { dateTime: "2026-10-29T19:00:00" },
            isOrganizer: true,
            "@odata.etag": "v1",
          },
        ],
        "@odata.nextLink": "https://graph.microsoft.com/v1.0/next",
      })
      .mockResolvedValueOnce({ value: [] });
    const provider = await createMonthProvider(
      { ...connection, provider: "microsoft" },
      logger,
    );
    const events = await provider.events(
      { ...calendar, provider: "microsoft" },
      input.start,
      input.end,
    );
    expect(api.mock.calls[0][0]).toContain(
      "/me/calendars/shared%40example.com/calendarView",
    );
    expect(api).toHaveBeenLastCalledWith(
      "https://graph.microsoft.com/v1.0/next",
    );
    expect(events[0].start).toBe("2026-10-29T18:00:00Z");
    expect(graphClient).toHaveBeenCalledWith(
      expect.objectContaining({ connectionId: "connection" }),
    );
  });
  it("preserves online meeting HTML and does not replace unchanged guest lists", async () => {
    const { request } = mockGraph();
    request.get.mockResolvedValue({
      id: "event",
      isOrganizer: true,
      isOnlineMeeting: true,
      body: { contentType: "html", content: "<p>Notes</p>" },
      "@odata.etag": "v1",
    });
    request.patch.mockResolvedValue({ id: "event" });
    const provider = await createMonthProvider(
      { ...connection, provider: "microsoft" },
      logger,
    );
    await provider.save(calendar, { ...input, eventId: "event", etag: "v1" });
    expect(request.patch.mock.calls[0][0]).not.toHaveProperty("body");
    expect(request.patch.mock.calls[0][0]).not.toHaveProperty("attendees");
    await expect(
      provider.save(calendar, {
        ...input,
        description: "New notes",
        eventId: "event",
        etag: "v1",
      }),
    ).rejects.toThrow("meeting link");
  });
  it("keeps all-day dates in their original timezone rather than shifting them through UTC", async () => {
    const { request } = mockGraph();
    request.get
      .mockResolvedValueOnce({
        value: [
          {
            id: "all-day",
            isAllDay: true,
            originalStartTimeZone: "GMT Standard Time",
            start: { dateTime: "2026-07-29T23:00:00" },
            end: { dateTime: "2026-07-30T23:00:00" },
          },
        ],
      })
      .mockResolvedValueOnce({
        id: "all-day",
        isAllDay: true,
        originalStartTimeZone: "GMT Standard Time",
        start: { dateTime: "2026-07-30T00:00:00" },
        end: { dateTime: "2026-07-31T00:00:00" },
      });
    const provider = await createMonthProvider(
      { ...connection, provider: "microsoft" },
      logger,
    );
    const events = await provider.events(calendar, input.start, input.end);
    expect(events[0]).toMatchObject({
      allDay: true,
      start: "2026-07-30",
      end: "2026-07-31",
    });
    expect(request.header).toHaveBeenCalledWith(
      "Prefer",
      'outlook.timezone="GMT Standard Time"',
    );
  });
});
