import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createScopedLogger } from "@/utils/logger";
import { createMonthProvider } from "./month-provider";
import {
  getCalendarMonth,
  getCalendarCatalog,
  getMonthWriteTarget,
  saveMonthEvent,
} from "./month-service";
import type { MonthCalendar } from "./month-types";

vi.mock("@/utils/prisma");
vi.mock("./month-provider", () => ({ createMonthProvider: vi.fn() }));
const logger = createScopedLogger("calendar-month-test");
const calendar: MonthCalendar = {
  id: "cal",
  calendarId: "cal@example.com",
  connectionId: "c",
  name: "Work",
  accountEmail: "work@example.com",
  provider: "google",
  writable: true,
  primary: true,
};
const connection = {
  id: "c",
  email: "work@example.com",
  provider: "google",
  emailAccountId: "mailbox",
  accessToken: "private-token",
  refreshToken: "private-refresh",
  expiresAt: null,
};
const provider = {
  calendars: vi.fn(),
  calendar: vi.fn(),
  events: vi.fn(),
  save: vi.fn(),
  remove: vi.fn(),
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(createMonthProvider).mockResolvedValue(provider);
  provider.calendars.mockResolvedValue([calendar]);
  provider.calendar.mockResolvedValue(calendar);
  provider.events.mockResolvedValue([]);
});

describe("calendar month ownership and aggregation", () => {
  it("lists the archive checklist without reading event contents or exposing provider clients", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([connection] as never);
    const result = await getCalendarCatalog("user", logger);
    expect(result.calendars).toHaveLength(1);
    expect(result).not.toHaveProperty("providers");
    expect(result).not.toHaveProperty("events");
    expect(provider.events).not.toHaveBeenCalled();
  });
  it("loads all owned mailboxes and deduplicates repeated calendar-account connections", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      connection,
      { ...connection, id: "duplicate" },
    ] as never);
    const result = await getCalendarMonth(
      "user",
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
      logger,
    );
    expect(prisma.calendarConnection.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { emailAccount: { userId: "user" }, isConnected: true },
      }),
    );
    expect(createMonthProvider).toHaveBeenCalledTimes(1);
    expect(provider.events).toHaveBeenCalledTimes(1);
    expect(result.calendars).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("private-token");
  });
  it("falls back to a working copy when the newest saved connection has expired", async () => {
    const backup = { ...connection, id: "working" };
    prisma.calendarConnection.findMany.mockResolvedValue([
      connection,
      backup,
    ] as never);
    vi.mocked(createMonthProvider)
      .mockRejectedValueOnce(new Error("invalid_grant"))
      .mockResolvedValueOnce(provider);
    provider.calendars.mockResolvedValue([
      { ...calendar, connectionId: "working" },
    ]);
    const result = await getCalendarMonth(
      "user",
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
      logger,
    );
    expect(result.calendars).toHaveLength(1);
    expect(result.calendars[0].connectionId).toBe("working");
    expect(result.warnings).toEqual([]);
    expect(provider.events).toHaveBeenCalledTimes(1);
  });
  it("tries another copy when listing calendars fails after client creation", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      connection,
      { ...connection, id: "working" },
    ] as never);
    provider.calendars.mockRejectedValueOnce(new Error("permission denied"));
    const result = await getCalendarCatalog("user", logger);
    expect(result.calendars).toHaveLength(1);
    expect(result.warnings).toEqual([]);
    expect(provider.calendars).toHaveBeenCalledTimes(2);
  });
  it("returns available calendars and an explicit warning when another provider fails", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      connection,
      {
        ...connection,
        id: "outlook",
        email: "outlook@example.com",
        provider: "microsoft",
      },
    ] as never);
    vi.mocked(createMonthProvider)
      .mockResolvedValueOnce(provider)
      .mockRejectedValueOnce(new Error("Expired"));
    const result = await getCalendarMonth(
      "user",
      "2026-10-01T00:00:00Z",
      "2026-11-01T00:00:00Z",
      logger,
    );
    expect(result.calendars).toHaveLength(1);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain("outlook@example.com");
  });
  it("identifies a failed account only after every saved connection fails", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([
      connection,
      { ...connection, id: "backup" },
    ] as never);
    vi.mocked(createMonthProvider).mockRejectedValue(
      new Error("invalid_grant"),
    );
    const result = await getCalendarMonth(
      "user",
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      logger,
    );
    expect(createMonthProvider).toHaveBeenCalledTimes(2);
    expect(result.unavailableAccounts).toEqual([
      { provider: "google", email: connection.email },
    ]);
    expect(result.warnings).toHaveLength(1);
  });
  it("identifies failed event requests separately from a successfully loaded empty calendar", async () => {
    prisma.calendarConnection.findMany.mockResolvedValue([connection] as never);
    provider.events.mockRejectedValueOnce(new Error("timeout"));
    const failed = await getCalendarMonth(
      "user",
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      logger,
    );
    expect(failed.unavailableAccounts).toEqual([]);
    expect(failed.unavailableCalendarIds).toEqual([failed.calendars[0].id]);
    const empty = await getCalendarMonth(
      "user",
      "2026-11-01T00:00:00Z",
      "2026-12-01T00:00:00Z",
      logger,
    );
    expect(empty.unavailableCalendarIds).toEqual([]);
    expect(empty.events).toEqual([]);
  });
  it("does not create a provider or write through a foreign or disconnected connection", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue(null);
    await expect(
      saveMonthEvent(
        "user",
        { connectionId: "foreign", calendarId: "cal" } as never,
        logger,
      ),
    ).rejects.toThrow("Calendar connection not found");
    expect(prisma.calendarConnection.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "foreign",
          emailAccount: { userId: "user" },
          isConnected: true,
        },
      }),
    );
    expect(createMonthProvider).not.toHaveBeenCalled();
  });
  it("rejects read-only destinations using fresh provider permissions", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue(connection as never);
    provider.calendar.mockResolvedValue({ ...calendar, writable: false });
    await expect(
      getMonthWriteTarget("user", "c", "cal", logger),
    ).rejects.toThrow("read-only");
    expect(provider.save).not.toHaveBeenCalled();
  });
  it("reports a concurrent provider revision conflict without retrying over another edit", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue(connection as never);
    provider.calendar.mockResolvedValue(calendar);
    provider.save.mockRejectedValue({ statusCode: 412 });
    await expect(
      saveMonthEvent(
        "user",
        { connectionId: "c", calendarId: "cal" } as never,
        logger,
      ),
    ).rejects.toThrow("edits are still here");
    expect(provider.save).toHaveBeenCalledTimes(1);
  });
});
