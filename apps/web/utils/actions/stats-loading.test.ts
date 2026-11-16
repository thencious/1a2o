import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestLogger, getMockMessage } from "@/__tests__/helpers";
import { createMockEmailProvider } from "@/utils/__mocks__/email-provider";
import prisma from "@/utils/__mocks__/prisma";
import { loadEmails, scanEmailHistory } from "./stats-loading";

vi.mock("@/utils/prisma");

describe("loadEmails", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$executeRaw.mockResolvedValue(20);
  });

  it("reports older history as unloaded when newer mail uses the page budget", async () => {
    prisma.emailMessage.findFirst.mockResolvedValue({
      date: new Date("2026-10-01T00:00:00Z"),
    } as never);
    const messages = Array.from({ length: 20 }, (_, i) => ({
      ...getMockMessage({ id: `message-${i}` }),
      internalDate: "1700000000000",
    }));
    const getMessages = vi
      .fn()
      .mockResolvedValue({ messages, nextPageToken: "next-page" });

    const result = await loadEmails(
      {
        emailAccountId: "account-1",
        emailProvider: createMockEmailProvider({
          getMessagesWithPagination: getMessages,
        }),
        logger: createTestLogger(),
      },
      { loadBefore: true, maxPages: 2 },
    );

    expect(getMessages).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({
      pages: 2,
      loadedBeforeMessages: 0,
      hasMoreAfter: true,
      hasMoreBefore: true,
    });
  });
});

describe("provider cursor pagination", () => {
  it.each([
    false,
    true,
  ])("follows a short page with a continuation token (older=%s)", async (older) => {
    prisma.emailMessage.findFirst.mockResolvedValue({
      date: new Date("2026-10-01T00:00:00Z"),
    } as never);
    const message = {
      ...getMockMessage({ id: "short-page-message" }),
      internalDate: "1700000000000",
    };
    const getMessages = vi.fn();
    if (older) getMessages.mockResolvedValueOnce({ messages: [] });
    getMessages
      .mockResolvedValueOnce({
        messages: [message],
        nextPageToken: "short-next",
      })
      .mockResolvedValueOnce({ messages: [message] });
    const result = await loadEmails(
      {
        emailAccountId: "account-1",
        emailProvider: createMockEmailProvider({
          getMessagesWithPagination: getMessages,
        }),
        logger: createTestLogger(),
      },
      { loadBefore: older, maxPages: 5 },
    );
    expect(getMessages).toHaveBeenCalledTimes(older ? 3 : 2);
    expect(getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "short-next" }),
    );
    expect(result[older ? "loadedBeforeMessages" : "loadedAfterMessages"]).toBe(
      2,
    );
    expect(result.hasMoreAfter).toBe(false);
    expect(result.hasMoreBefore).toBe(false);
  });
});

describe("complete history scans", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prisma.$executeRaw.mockResolvedValue(1);
  });
  it("resumes the provider cursor without date bounds so holes within indexed dates are included", async () => {
    const message = {
      ...getMockMessage({ id: "gap-message" }),
      internalDate: "1700000000000",
    };
    const getMessages = vi
      .fn()
      .mockResolvedValueOnce({ messages: [message], nextPageToken: "continue" })
      .mockResolvedValueOnce({ messages: [], nextPageToken: "next-batch" });
    const provider = createMockEmailProvider({
      getMessagesWithPagination: getMessages,
    });
    const batch = await scanEmailHistory({
      emailAccountId: "account-1",
      emailProvider: provider,
      logger: createTestLogger(),
      pageToken: "saved-cursor",
      maxPages: 2,
    });
    expect(batch).toEqual({
      pages: 2,
      loadedMessages: 1,
      nextPageToken: "next-batch",
    });
    expect(prisma.emailMessage.findFirst).not.toHaveBeenCalled();
    expect(getMessages).toHaveBeenNthCalledWith(1, {
      maxResults: 20,
      pageToken: "saved-cursor",
      before: undefined,
      after: undefined,
    });
    getMessages.mockResolvedValueOnce({ messages: [message] });
    const finish = await scanEmailHistory({
      emailAccountId: "account-1",
      emailProvider: provider,
      logger: createTestLogger(),
      pageToken: batch.nextPageToken ?? undefined,
    });
    expect(getMessages).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "next-batch" }),
    );
    expect(finish.nextPageToken).toBeNull();
  });
  it("stops a provider repeating the same cursor rather than spinning forever", async () => {
    const provider = createMockEmailProvider({
      getMessagesWithPagination: vi
        .fn()
        .mockResolvedValue({ messages: [], nextPageToken: "stuck" }),
    });
    await expect(
      scanEmailHistory({
        emailAccountId: "account-1",
        emailProvider: provider,
        logger: createTestLogger(),
        pageToken: "stuck",
      }),
    ).rejects.toThrow("did not advance");
  });
});
