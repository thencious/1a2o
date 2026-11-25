import { expect, it } from "vitest";
import {
  conversationsWithDrafts,
  readMessageDrafts,
  saveMessageDraft,
} from "./message-drafts";
import type { Conversation } from "./types";
function storage() {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    key: (i: number) => [...values.keys()][i] ?? null,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  } satisfies Storage;
}
it("retains draft text and last edit time across reloads without bumping unchanged drafts", () => {
  const local = storage();
  saveMessageDraft(local, "a", "Unfinished reply", 1000);
  expect(saveMessageDraft(local, "a", "Unfinished reply", 2000)).toBe(false);
  expect(readMessageDrafts(local).a).toEqual({
    text: "Unfinished reply",
    updatedAt: 1000,
  });
  saveMessageDraft(local, "a", "Unfinished reply continued", 3000);
  expect(readMessageDrafts(local).a.updatedAt).toBe(3000);
});
it("raises a draft above older conversations and restores message order when cleared", () => {
  const a = {
    id: "a",
    time: new Date(1000).toISOString(),
    preview: "Old message",
  } as Conversation;
  const b = { ...a, id: "b", time: new Date(2000).toISOString() };
  const local = storage();
  saveMessageDraft(local, "a", "Draft\nreply", 3000);
  const items = conversationsWithDrafts([b, a], readMessageDrafts(local));
  expect(items.map((x) => x.id)).toEqual(["a", "b"]);
  expect(items[0].preview).toBe("Draft reply");
  expect(items[0].time).toBe(new Date(3000).toISOString());
  expect(a.preview).toBe("Old message");
  saveMessageDraft(local, "a", "");
  expect(
    conversationsWithDrafts([a, b], readMessageDrafts(local)).map((x) => x.id),
  ).toEqual(["b", "a"]);
  expect(readMessageDrafts(local)).toEqual({});
});
it("keeps newer received messages ahead of older draft timestamps and recognizes legacy drafts", () => {
  const local = storage();
  local.setItem("inbox-zero-message-draft:a", "Existing draft");
  const item = {
    id: "a",
    time: new Date(5000).toISOString(),
    preview: "Received",
  } as Conversation;
  const [legacy] = conversationsWithDrafts([item], readMessageDrafts(local));
  expect(legacy.draft?.text).toBe("Existing draft");
  expect(legacy.time).toBe(item.time);
  saveMessageDraft(local, "a", "  ", 6000);
  expect(readMessageDrafts(local)).toEqual({});
});
