// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConversationQuery,
  MailboxView,
} from "@inboxzero/mail-core/queries";

let cache: typeof import("./mailbox-preview-cache");
const query: ConversationQuery = {
  accountIds: ["account-a"],
  predicate: { kind: "mailbox", mailbox: "inbox" },
  order: "newest_first",
  pageSize: 50,
  after: null,
};

function view(count = 1): MailboxView {
  return {
    conversations: Array.from({ length: count }, (_, index) => ({
      key: { accountId: "account-a", conversationId: `thread-${index}` },
      subject: "Saved message",
      preview: "Preview",
      from: "sender@example.com",
      to: "me@example.com",
      senders: [],
      latestMessageAtMs: 1,
      unread: true,
      starred: false,
      hasAttachments: false,
      labelIds: [],
      roles: ["inbox"],
      pendingOperationIds: [],
    })),
    counts: {
      matchingConversations: count,
      unreadConversations: count,
      extent: "local_coverage",
    },
    nextPage: "next",
    coverage: [],
    connection: "ready",
  };
}

describe("mailbox startup previews", () => {
  it("restores tag counts including zero across restart and clears them on account removal", async () => {
    const identity = JSON.stringify({
      accountIds: ["account-a"],
      countSplits: ["all", "marketing"],
    });
    cache.saveTagCountPreview(
      identity,
      new Map([
        ["all", 42],
        ["marketing", 0],
      ]),
    );
    vi.resetModules();
    const restarted = await import("./mailbox-preview-cache");
    expect([...restarted.readTagCountPreview(identity)]).toEqual([
      ["all", 42],
      ["marketing", 0],
    ]);
    expect(
      restarted.readTagCountPreview(
        JSON.stringify({
          accountIds: ["account-b"],
          countSplits: ["all", "marketing"],
        }),
      ).size,
    ).toBe(0);
    restarted.clearMailboxPreviews("account-a");
    restarted.saveTagCountPreview(identity, new Map([["all", 99]]));
    expect(restarted.readTagCountPreview(identity).size).toBe(0);
  });

  beforeEach(async () => {
    vi.resetModules();
    window.localStorage.clear();
    cache = await import("./mailbox-preview-cache");
  });

  it("restores a saved list after a restart without mixing accounts or filters", async () => {
    cache.saveMailboxPreview(query, view());
    vi.resetModules();
    const restarted = await import("./mailbox-preview-cache");
    expect(restarted.readMailboxPreview(query)?.conversations).toHaveLength(1);
    expect(
      restarted.readMailboxPreview({ ...query, accountIds: ["account-b"] }),
    ).toBeNull();
    expect(
      restarted.readMailboxPreview({
        ...query,
        predicate: { kind: "mailbox", mailbox: "sent" },
      }),
    ).toBeNull();
  });

  it("bounds saved rows and query count and never exposes a stale pagination cursor", () => {
    for (let index = 0; index < 12; index++)
      cache.saveMailboxPreview({ ...query, pageSize: index + 1 }, view(120));
    expect(window.localStorage.length).toBe(8);
    const saved = cache.readMailboxPreview({ ...query, pageSize: 12 });
    expect(saved?.conversations).toHaveLength(50);
    expect(saved?.nextPage).toBeNull();
  });

  it("keeps inbox previews when tag counts for other views are saved", () => {
    cache.saveMailboxPreview(query, view());
    for (let index = 0; index < 12; index++)
      cache.saveTagCountPreview(
        JSON.stringify({
          accountIds: ["account-a"],
          countSplits: [String(index)],
        }),
        new Map([["all", index]]),
      );
    expect(cache.readMailboxPreview(query)?.conversations).toHaveLength(1);
  });

  it("shrinks oversized previews instead of silently losing the cache", () => {
    const large = view(100);
    for (const row of large.conversations) row.preview = "x".repeat(10_000);
    cache.saveMailboxPreview(query, large);
    expect(
      cache.readMailboxPreview(query)?.conversations.length,
    ).toBeGreaterThan(0);
    expect(
      cache.readMailboxPreview(query)?.conversations.length,
    ).toBeLessThanOrEqual(50);
  });

  it("replaces stale rows with a fresh empty result", () => {
    cache.saveMailboxPreview(query, view());
    cache.saveMailboxPreview(query, view(0));
    expect(cache.readMailboxPreview(query)?.conversations).toEqual([]);
  });

  it("removes combined previews on account removal and blocks stale writers", () => {
    const combined = { ...query, accountIds: ["account-a", "account-b"] };
    cache.saveMailboxPreview(combined, view());
    cache.clearMailboxPreviews("account-b");
    cache.saveMailboxPreview(combined, view());
    expect(cache.readMailboxPreview(combined)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it("ignores corrupt data and clears previews on logout", () => {
    cache.saveMailboxPreview(query, view());
    const key = Object.keys(window.localStorage)[0]!;
    window.localStorage.setItem(key, "invalid");
    expect(cache.readMailboxPreview(query)).toBeNull();
    cache.clearMailboxPreviews();
    cache.saveMailboxPreview(query, view());
    expect(cache.readMailboxPreview(query)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });
});
