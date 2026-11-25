import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import {
  ACCOUNT_DISCONNECTED_ERROR_TYPE,
  CALENDAR_DISCONNECTED_ERROR_TYPE,
} from "@/utils/config";
import { readConnectionWarnings } from "./connection-warnings";

vi.mock("server-only", () => ({}));
vi.mock("@/utils/prisma");

const updatedAt = new Date("2026-11-24T10:00:00Z");

describe("live connection warnings", () => {
  beforeEach(() => {
    prisma.emailAccount.findMany.mockResolvedValue([]);
    prisma.calendarConnection.findMany.mockResolvedValue([]);
  });

  it("does not keep a stored mailbox warning after reconnect", async () => {
    const warnings = await readConnectionWarnings("user", {
      message: "old@example.com needs to reconnect",
      actionUrl: "/old/permissions/consent",
    });
    expect(warnings).toEqual({});
  });

  it("points to the mailbox still disconnected after another is fixed", async () => {
    prisma.emailAccount.findMany.mockResolvedValue([
      {
        id: "active",
        email: "active@example.com",
        account: { disconnectedAt: updatedAt, updatedAt },
      },
    ] as never);
    const warnings = await readConnectionWarnings("user", {
      message: "old@example.com needs to reconnect",
      actionUrl: "/old/permissions/consent",
    });
    expect(warnings[ACCOUNT_DISCONNECTED_ERROR_TYPE]).toMatchObject({
      message: expect.stringContaining("active@example.com"),
      actionUrl: "/active/permissions/consent",
    });
  });

  it("clears a calendar warning when any copy of the same grant works", async () => {
    const expired = {
      email: "work@example.com",
      emailAccountId: "mail",
      provider: "google",
      isConnected: false,
      updatedAt,
      emailAccount: {
        email: "other@example.com",
        account: { provider: "google" },
      },
    };
    prisma.calendarConnection.findMany.mockResolvedValue([expired] as never);
    expect(
      (await readConnectionWarnings("user"))[CALENDAR_DISCONNECTED_ERROR_TYPE],
    ).toMatchObject({
      actionUrl: "/settings?calendarAccount=mail#calendar-settings",
    });

    prisma.calendarConnection.findMany.mockResolvedValue([
      expired,
      {
        ...expired,
        email: "WORK@example.com",
        emailAccountId: "duplicate",
        isConnected: true,
      },
    ] as never);
    expect(await readConnectionWarnings("user")).toEqual({});
  });

  it("uses one reconnect for the mailbox and its own calendar", async () => {
    const email = "mail@example.com";
    prisma.calendarConnection.findMany.mockResolvedValue([
      {
        email,
        emailAccountId: "mail",
        provider: "google",
        isConnected: false,
        updatedAt,
        emailAccount: { email, account: { provider: "google" } },
      },
    ] as never);
    expect(
      (await readConnectionWarnings("user"))[CALENDAR_DISCONNECTED_ERROR_TYPE],
    ).toMatchObject({ actionUrl: "/mail/permissions/consent" });

    prisma.emailAccount.findMany.mockResolvedValue([
      { id: "mail", email, account: { disconnectedAt: updatedAt, updatedAt } },
    ] as never);
    const warnings = await readConnectionWarnings("user");
    expect(Object.keys(warnings)).toEqual([ACCOUNT_DISCONNECTED_ERROR_TYPE]);
  });
});
