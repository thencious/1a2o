import { beforeEach, expect, it, vi } from "vitest";
import type { ConversationView } from "@inboxzero/mail-core/ports/mail-store";

let cache: typeof import("./conversation-view-cache");
beforeEach(async () => {
  vi.resetModules();
  cache = await import("./conversation-view-cache");
});

function view(id: string, accountId = "a"): ConversationView {
  return {
    key: { accountId, conversationId: id },
    messages: [],
    nextPage: null,
    coverage: [],
  };
}

it("restores earlier threads without mixing accounts or pagination", () => {
  const first = view("first");
  cache.saveConversationPreview(first, 50);
  cache.saveConversationPreview(view("second"), 50);
  expect(cache.readConversationPreview("a", "first", 50)).toBe(first);
  expect(cache.readConversationPreview("b", "first", 50)).toBeNull();
  expect(cache.readConversationPreview("a", "first", 100)).toBeNull();
  const fresh = view("first");
  cache.saveConversationPreview(fresh, 50);
  expect(cache.readConversationPreview("a", "first", 50)).toBe(fresh);
});

it("retains 50 recently opened threads instead of growing indefinitely", () => {
  for (let i = 0; i < 50; i++)
    cache.saveConversationPreview(view(String(i)), 50);
  cache.readConversationPreview("a", "0", 50);
  cache.saveConversationPreview(view("50"), 50);
  expect(cache.readConversationPreview("a", "0", 50)).not.toBeNull();
  expect(cache.readConversationPreview("a", "1", 50)).toBeNull();
});

it("clears removed accounts and logout, preventing late saves from restoring them", () => {
  cache.saveConversationPreview(view("first"), 50);
  cache.saveConversationPreview(view("first", "b"), 50);
  cache.clearConversationPreviews("a");
  cache.saveConversationPreview(view("first"), 50);
  expect(cache.readConversationPreview("a", "first", 50)).toBeNull();
  expect(cache.readConversationPreview("b", "first", 50)).not.toBeNull();
  cache.clearConversationPreviews();
  cache.saveConversationPreview(view("first", "b"), 50);
  expect(cache.readConversationPreview("b", "first", 50)).toBeNull();
});
