import { describe, expect, it, vi } from "vitest";
import {
  mergeHistoryMessages,
  nextHistoryCursor,
  readRecentMessages,
} from "./message-history";
import type { ChatMessage, MessagePage } from "./types";

describe("conversation history", () => {
  it("fills a burst of new messages without changing the older history cursor", async () => {
    const original = await readRecentMessages(async () =>
      page([message("wa", 4), message("wa", 3)], "older-3"),
    );
    const older = message("wa", 2);
    const cached = {
      ...original,
      items: [older, ...original.items],
      olderCursor: "older-2",
    };
    const readPage = vi
      .fn<(cursor?: string) => Promise<MessagePage>>()
      .mockResolvedValueOnce(
        page([message("wa", 8), message("wa", 7)], "new-7"),
      )
      .mockResolvedValueOnce(
        page([message("wa", 6), message("wa", 5)], "new-5"),
      )
      .mockResolvedValueOnce(
        page([message("wa", 4), message("wa", 3)], "older-3"),
      );

    const recent = await readRecentMessages(readPage, cached);

    expect(readPage.mock.calls).toEqual([[], ["new-7"], ["new-5"]]);
    expect(recent.olderCursor).toBe("older-2");
    expect(
      mergeHistoryMessages(cached.items, recent.items)
        .map((item) => Number(item.id))
        .sort((a, b) => a - b),
    ).toEqual([2, 3, 4, 5, 6, 7, 8]);
  });

  it("fills each source independently across a hidden-only provider page", async () => {
    const cached = await readRecentMessages(async () =>
      page([message("wa", 2), message("linkedin", 9)], "older"),
    );
    const readPage = vi
      .fn<(cursor?: string) => Promise<MessagePage>>()
      .mockResolvedValueOnce({
        ...page([message("linkedin", 9)], "hidden-wa"),
        scanned: [
          { chatId: "wa", oldestTime: message("wa", 6).time, hasMore: true },
          { chatId: "linkedin", oldestTime: null, hasMore: false },
        ],
      })
      .mockResolvedValueOnce(page([message("wa", 5), message("wa", 4)], "next"))
      .mockResolvedValueOnce(
        page([message("wa", 3), message("wa", 2)], "older"),
      );

    const recent = await readRecentMessages(readPage, cached);

    expect(readPage).toHaveBeenCalledTimes(3);
    expect(
      mergeHistoryMessages(cached.items, recent.items)
        .filter((item) => item.chatId === "wa")
        .map((item) => item.id)
        .sort(),
    ).toEqual(["2", "3", "4", "5"]);
  });

  it("reports a stalled cursor so it can be retried without dropping history", async () => {
    const cached = await readRecentMessages(async () =>
      page([message("wa", 2)], "older"),
    );
    const readPage = vi
      .fn<(cursor?: string) => Promise<MessagePage>>()
      .mockResolvedValueOnce(page([message("wa", 9)], "stalled"))
      .mockResolvedValueOnce(page([], "stalled"));

    await expect(readRecentMessages(readPage, cached)).rejects.toThrow(
      "Conversation history did not advance",
    );
    expect(cached.items).toEqual([message("wa", 2)]);
    expect(() => nextHistoryCursor(page([], "older"), ["older"])).toThrow();
    expect(nextHistoryCursor(page([], null), ["older"])).toBeNull();
  });
});

function page(items: ChatMessage[], cursor: string | null): MessagePage {
  return { items, cursor, hasMore: cursor !== null };
}

function message(chatId: string, id: number): ChatMessage {
  return {
    id: String(id),
    chatId,
    sender: chatId,
    text: String(id),
    time: new Date(id * 1000).toISOString(),
    attachments: [],
    outgoing: false,
    deleted: false,
  };
}
