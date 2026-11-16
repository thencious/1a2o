import { describe, expect, it } from "vitest";
import { messageActionCapabilities } from "./message-actions";

const now = Date.parse("2026-10-31T12:00:00Z");
const message = {
  timestamp: new Date(now - 30_000).toISOString(),
  isSender: true,
};
describe("Beeper message capabilities", () => {
  it("enables native replies only when supported and the target is available", () => {
    expect(
      messageActionCapabilities(message, { reply: 2 }, false, now).canReply,
    ).toBe(true);
    expect(
      messageActionCapabilities(message, { reply: 1 }, false, now).canReply,
    ).toBe(true);
    for (const reply of [-2, -1, 0] as const)
      expect(
        messageActionCapabilities(message, { reply }, false, now).canReply,
      ).toBe(false);
    expect(
      messageActionCapabilities(
        { ...message, isDeleted: true },
        { reply: 2 },
        false,
        now,
      ).canReply,
    ).toBe(false);
    expect(
      messageActionCapabilities(message, { reply: 2 }, true, now).canReply,
    ).toBe(false);
  });
  it("only enables actions positively supported by the current chat", () => {
    expect(messageActionCapabilities(message, undefined, false, now)).toEqual({
      canEdit: false,
      canReply: false,
      canReact: false,
      canRecall: false,
    });
    expect(
      messageActionCapabilities(
        message,
        { reaction: 2, delete: 1 },
        false,
        now,
      ),
    ).toEqual({
      canEdit: false,
      canReply: false,
      canReact: true,
      canRecall: true,
    });
    expect(
      messageActionCapabilities(
        message,
        { reaction: -1, delete: 0 },
        false,
        now,
      ),
    ).toEqual({
      canEdit: false,
      canReply: false,
      canReact: false,
      canRecall: false,
    });
  });
  it("respects ownership, the recall deadline, and read-only chats", () => {
    const capabilities = {
      delete: 2 as const,
      reaction: 2 as const,
      deleteMaxAge: 20,
    };
    expect(
      messageActionCapabilities(message, capabilities, false, now).canRecall,
    ).toBe(false);
    expect(
      messageActionCapabilities(
        { ...message, isSender: false },
        { delete: 2 },
        false,
        now,
      ).canRecall,
    ).toBe(false);
    expect(messageActionCapabilities(message, capabilities, true, now)).toEqual(
      { canEdit: false, canReply: false, canReact: false, canRecall: false },
    );
  });
  it("does not act on pending, failed or deleted messages", () => {
    for (const extra of [
      { isDeleted: true },
      {
        sendStatus: {
          status: "PENDING" as const,
          timestamp: message.timestamp,
        },
      },
      {
        sendStatus: {
          status: "FAIL_PERMANENT" as const,
          timestamp: message.timestamp,
        },
      },
    ]) {
      expect(
        messageActionCapabilities(
          { ...message, ...extra },
          { delete: 2, reaction: 2 },
          false,
          now,
        ),
      ).toEqual({
        canEdit: false,
        canReply: false,
        canReact: false,
        canRecall: false,
      });
    }
  });
  it("offers editing only for the sender's supported text, within the native edit window", () => {
    const own = { ...message, text: "Original" };
    expect(
      messageActionCapabilities(own, { edit: 2 }, false, now).canEdit,
    ).toBe(true);
    expect(
      messageActionCapabilities(own, { edit: 1, editMaxAge: 60 }, false, now)
        .canEdit,
    ).toBe(true);
    for (const edit of [-2, -1, 0] as const)
      expect(messageActionCapabilities(own, { edit }, false, now).canEdit).toBe(
        false,
      );
    for (const extra of [
      { isSender: false },
      { isDeleted: true },
      { isHidden: true },
      { text: "" },
      { attachments: [{}] },
      { sendStatus: { status: "PENDING" } },
    ])
      expect(
        messageActionCapabilities(
          { ...own, ...extra } as typeof own,
          { edit: 2 },
          false,
          now,
        ).canEdit,
      ).toBe(false);
    expect(messageActionCapabilities(own, { edit: 2 }, true, now).canEdit).toBe(
      false,
    );
    expect(
      messageActionCapabilities(own, { edit: 2, editMaxAge: 20 }, false, now)
        .canEdit,
    ).toBe(false);
    expect(
      messageActionCapabilities(own, { edit: 2, editMaxCount: 0 }, false, now)
        .canEdit,
    ).toBe(false);
  });
});
