import { beforeEach, describe, expect, it, vi } from "vitest";
import { after } from "next/server";
import prisma from "@/utils/__mocks__/prisma";
import {
  connectCalendarFromMailboxGrant,
  recoverCalendarFromMailbox,
} from "./mailbox-grant";
import { createMonthProvider } from "./month-provider";
import { createScopedLogger } from "@/utils/logger";
import { createGoogleCalendarProvider } from "./providers/google";
import { createMicrosoftCalendarProvider } from "./providers/microsoft";

vi.mock("@/utils/prisma");
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("./providers/google", () => ({
  createGoogleCalendarProvider: vi.fn(),
}));
vi.mock("./providers/microsoft", () => ({
  createMicrosoftCalendarProvider: vi.fn(),
}));
vi.mock("./month-provider", () => ({ createMonthProvider: vi.fn() }));

const googleRead = "https://www.googleapis.com/auth/calendar.readonly";
const googleWrite = "https://www.googleapis.com/auth/calendar.events";
const expiresAt = new Date("2027-01-01");
const mailbox = { id: "email-1", email: "Person@example.com" };
const syncCalendars = vi.fn().mockResolvedValue(undefined);

function grant(provider: string, scope: string, refreshToken = "refresh") {
  prisma.account.findUnique.mockResolvedValue({
    scope,
    provider,
    access_token: "access",
    refresh_token: refreshToken,
    expires_at: expiresAt,
    emailAccount: mailbox,
  } as never);
  return connectCalendarFromMailboxGrant({
    accountId: "account-1",
    provider,
    grantedScope: scope,
  });
}

describe("calendar access from mailbox consent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.calendarConnection.findFirst.mockResolvedValue(null);
    prisma.calendarConnection.create.mockResolvedValue({
      id: "cal-1",
    } as never);
    vi.mocked(createGoogleCalendarProvider).mockReturnValue({
      syncCalendars,
    } as never);
    vi.mocked(createMicrosoftCalendarProvider).mockReturnValue({
      syncCalendars,
    } as never);
  });

  it.each([
    [
      "google",
      `gmail,${googleRead},${googleWrite}`,
      createGoogleCalendarProvider,
    ],
    [
      "microsoft",
      "Mail.ReadWrite Calendars.ReadWrite",
      createMicrosoftCalendarProvider,
    ],
    [
      "microsoft",
      "Mail.ReadWrite https://graph.microsoft.com/Calendars.Read",
      createMicrosoftCalendarProvider,
    ],
  ])("provisions a %s calendar from the granted scopes", async (provider, scope, createProvider) => {
    await grant(provider, scope);

    expect(prisma.calendarConnection.create).toHaveBeenCalledWith({
      data: {
        provider,
        email: "person@example.com",
        emailAccountId: mailbox.id,
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt,
        isConnected: true,
      },
    });
    expect(createProvider).toHaveBeenCalledOnce();
    const [sync] = vi.mocked(after).mock.calls[0];
    if (typeof sync !== "function") throw new Error("Expected a calendar sync");
    await sync();
    expect(syncCalendars).toHaveBeenCalledWith(
      "cal-1",
      "access",
      "refresh",
      mailbox.id,
      expiresAt,
    );
  });

  it("leaves mail usable when Google calendar list permission is declined", async () => {
    await grant("google", `gmail.modify ${googleWrite}`);
    expect(prisma.calendarConnection.create).not.toHaveBeenCalled();
  });

  it("does not replace a working edit grant with read-only access", async () => {
    prisma.calendarConnection.findFirst.mockResolvedValue({
      id: "working",
      isConnected: true,
    } as never);
    await grant("google", googleRead);
    expect(prisma.calendarConnection.updateMany).not.toHaveBeenCalled();
    expect(prisma.calendarConnection.create).not.toHaveBeenCalled();
  });

  it("reconnects an existing calendar in place", async () => {
    const updatedAt = new Date("2026-01-01");
    prisma.calendarConnection.findFirst.mockResolvedValue({
      id: "same-calendar",
      isConnected: false,
      updatedAt,
    } as never);
    prisma.calendarConnection.updateMany.mockResolvedValue({ count: 1 });
    await grant("google", `${googleRead} ${googleWrite}`);
    expect(prisma.calendarConnection.updateMany).toHaveBeenCalledWith({
      where: { id: "same-calendar", updatedAt },
      data: {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt,
        isConnected: true,
      },
    });
    expect(prisma.calendarConnection.create).not.toHaveBeenCalled();
  });
});

describe("automatic calendar reconnection", () => {
  const connection = {
    id: "saved-calendar",
    email: mailbox.email,
    emailAccountId: mailbox.id,
    provider: "google",
    accessToken: "expired",
    refreshToken: "revoked",
    expiresAt: null,
    updatedAt: new Date("2026-01-01"),
  };
  const account = {
    provider: "google",
    scope: `${googleRead} ${googleWrite}`,
    access_token: "valid-access",
    refresh_token: "valid-refresh",
    expires_at: new Date(Date.now() + 60 * 60_000),
    disconnectedAt: null,
  };
  const logger = createScopedLogger("calendar-recovery-test");
  const calendars = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    calendars.mockReset().mockResolvedValue([]);
    vi.mocked(createMonthProvider).mockResolvedValue({ calendars } as never);
  });

  it("verifies the saved mailbox grant before reconnecting the same calendar", async () => {
    await recoverCalendarFromMailbox({
      connection,
      mailbox: { ...mailbox, account },
      logger,
    });
    expect(calendars).toHaveBeenCalledOnce();
    expect(prisma.calendarConnection.updateMany).toHaveBeenCalledWith({
      where: {
        id: connection.id,
        updatedAt: connection.updatedAt,
        isConnected: false,
      },
      data: {
        accessToken: "valid-access",
        refreshToken: "valid-refresh",
        expiresAt: account.expires_at,
        isConnected: true,
      },
    });
  });

  it("keeps the connection disconnected if the calendar API refuses the alternative grant", async () => {
    calendars.mockRejectedValue(new Error("insufficient permissions"));
    await expect(
      recoverCalendarFromMailbox({
        connection,
        mailbox: { ...mailbox, account },
        logger,
      }),
    ).rejects.toThrow("insufficient permissions");
    expect(prisma.calendarConnection.updateMany).not.toHaveBeenCalled();
  });

  it("does not use mailbox credentials for a different calendar account", async () => {
    await recoverCalendarFromMailbox({
      connection,
      mailbox: { ...mailbox, email: "someone-else@example.com", account },
      logger,
    });
    expect(createMonthProvider).not.toHaveBeenCalled();
  });
});
