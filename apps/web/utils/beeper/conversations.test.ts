import { describe, it, expect } from "vitest";
import { allowedConversation, uniqueConversations } from "./conversations";
import type { Conversation } from "./types";

describe("unified conversations", () => {
  it("keeps DMs and ordinary groups while rejecting unapproved Discord groups", () => {
    const base = { id: "chat", accountID: "account", type: "group" as const };
    for (const network of ["WhatsApp", "WeChat", "Google Messages"])
      expect(allowedConversation({ ...base, network })).toBe(true);
    expect(allowedConversation({ ...base, network: "Discord" })).toBe(false);
    expect(
      allowedConversation({ ...base, network: "Discord", type: "single" }),
    ).toBe(true);
    expect(allowedConversation({ ...base, network: "Discord" }, ["chat"])).toBe(
      true,
    );
    expect(
      allowedConversation({ ...base, network: "Discord" }, ["other"]),
    ).toBe(false);
    expect(
      allowedConversation({
        ...base,
        accountID: "discordgo",
        network: "Personal account",
      }),
    ).toBe(false);
  });
  it("shows each conversation only once across pages, retaining its newest preview", () => {
    const a = {
      id: "a",
      title: "Shared group",
      time: "2026-10-30T15:00:00Z",
      preview: "Old",
    } as Conversation;
    const latest = { ...a, time: "2026-10-30T17:00:00Z", preview: "Newest" };
    const b = { ...a, id: "b", time: "2026-10-30T16:00:00Z" };
    expect(uniqueConversations([[a, b], [latest, b], [a]])).toEqual([
      latest,
      b,
    ]);
    expect(uniqueConversations([[latest], [a]])).toEqual([latest]);
  });
  it("does not merge unrelated people with the same display name", () => {
    const base = {
      title: "Alex",
      time: "2026-10-30T16:00:00Z",
    } as Conversation;
    expect(
      uniqueConversations([
        [
          { ...base, id: "first" },
          { ...base, id: "second" },
        ],
      ]),
    ).toHaveLength(2);
  });
});
