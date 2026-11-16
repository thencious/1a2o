import { describe, expect, it } from "vitest";
import { mentionQuery, nativeMentionText, rebaseMentions } from "./mentions";
const alex = { id: "@whatsapp_123:beeper.com", label: "Alex" },
  sam = { id: "@whatsapp_456:beeper.com", label: "Sam" };
const mention = { userId: alex.id, label: alex.label, start: 3, end: 8 };
describe("native mentions", () => {
  it("encodes selected participant IDs while leaving ordinary @ text and Markdown untouched", () => {
    const text = "Hi @Alex and @Sam — **thanks** @unknown";
    const result = nativeMentionText(
      text,
      [mention, { userId: sam.id, label: sam.label, start: 13, end: 17 }],
      [alex, sam],
    );
    expect(result).toBe(
      "Hi [@Alex](https://matrix.to/#/@whatsapp_123%3Abeeper.com) and [@Sam](https://matrix.to/#/@whatsapp_456%3Abeeper.com) — **thanks** @unknown",
    );
    expect(nativeMentionText("email@example.org", [], [])).toBe(
      "email@example.org",
    );
  });
  it("rejects participants from another chat, stale names, forged spans, and overlap", () => {
    for (const mentions of [
      [{ ...mention, userId: "@stranger:beeper.com" }],
      [{ ...mention, label: "Someone else" }],
      [{ ...mention, start: 0 }],
      [{ ...mention, end: 99 }],
      [mention, mention],
    ])
      expect(() => nativeMentionText("Hi @Alex", mentions, [alex])).toThrow(
        "selected mention changed",
      );
  });
  it("rebases intact mentions after prefix edits and discards altered or removed tokens", () => {
    expect(
      rebaseMentions("@Alex ", "H@Alex ", [{ ...mention, start: 0, end: 5 }]),
    ).toEqual([{ ...mention, start: 1, end: 6 }]);
    expect(rebaseMentions("Hi @Alex", "👋 Hi @Alex", [mention])).toEqual([
      { ...mention, start: 6, end: 11 },
    ]);
    expect(rebaseMentions("Hi @Alex", "Hi @Alex!", [mention])).toEqual([
      mention,
    ]);
    expect(rebaseMentions("Hi @Alex", "Hi @Alexs", [mention])).toEqual([]);
    expect(rebaseMentions("Hi @Alex", "Hi @A", [mention])).toEqual([]);
    expect(rebaseMentions("Hi @Alex", "Hi there", [mention])).toEqual([]);
  });
  it("opens at a real @ trigger but not within emails or an already chosen mention", () => {
    expect(mentionQuery("Hello @Al", 9)).toMatchObject({
      start: 6,
      query: "Al",
    });
    expect(mentionQuery("mail@example.org", 16)).toBeNull();
    expect(mentionQuery("Hi @Alex ", 9, [mention])).toBeNull();
    expect(mentionQuery("Hi @Alex", -1)).toBeNull();
  });
});
