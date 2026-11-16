import { expect, it, vi, afterEach } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./conversation-group-store", () => ({
  conversationGroups: async () => [
    { id: "a", members: [{ id: "a" }, { id: "b" }] },
  ],
}));
vi.mock("@/utils/beeper/service", () => ({ listMessages: mocks.list }));
import { combinedHistory } from "./combined-history";
afterEach(() => vi.clearAllMocks());
it("paginates member histories independently and retains colliding message IDs and original chat IDs", async () => {
  mocks.list.mockImplementation(async (_user, id, cursor) => ({
    items: [
      {
        id: "same",
        chatId: id,
        time: id === "a" ? "2026-11-14T10:00:00Z" : "2026-11-14T11:00:00Z",
      },
    ],
    hasMore: id === "a" && !cursor,
    cursor: id === "a" && !cursor ? "older" : null,
  }));
  const first = await combinedHistory("owner", "a");
  expect(first.items.map((item) => item.chatId)).toEqual(["a", "b"]);
  expect(first.hasMore).toBe(true);
  mocks.list.mockClear();
  await combinedHistory("owner", "a", first.cursor!);
  expect(mocks.list).toHaveBeenCalledTimes(1);
  expect(mocks.list).toHaveBeenCalledWith("owner", "a", "older");
});
