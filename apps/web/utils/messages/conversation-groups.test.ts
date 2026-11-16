import { expect, it } from "vitest";
import { groupConversations } from "./conversation-groups";
import type { Conversation } from "@/utils/beeper/types";
const a: Conversation = {
  id: "a",
  title: "Alex",
  accountId: "wa",
  account: "Personal",
  network: "WhatsApp",
  group: false,
  unread: 1,
  time: "2026-11-14T10:00:00Z",
  preview: "First",
  readOnly: false,
};
const b: Conversation = {
  ...a,
  id: "b",
  network: "SMS",
  unread: 2,
  time: "2026-11-14T11:00:00Z",
  preview: "Newer",
};
it("shows a combined row once, newest preview and total unread while preserving ordered source identities", () => {
  const result = groupConversations(
    [b, a],
    [{ id: "a", title: "Alex Smith", members: [a, b] }],
  );
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({
    id: "a",
    title: "Alex Smith",
    unread: 3,
    preview: "Newer",
    members: [a, b],
  });
});
it("retains members not yet loaded in the current conversation page", () => {
  const result = groupConversations(
    [b],
    [{ id: "a", title: "Alex", members: [a, b] }],
  );
  expect(result[0].members).toEqual([a, b]);
});
