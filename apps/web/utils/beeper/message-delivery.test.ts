import { describe, expect, it } from "vitest";
import {
  mergeMessageOutbox,
  applyReadReceiptPositions,
  messageDelivery,
  type OutgoingMessage,
} from "./message-delivery";
import type { ChatMessage } from "./types";

function message(id: string, extra: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id,
    chatId: "chat",
    sender: "You",
    text: "Hello",
    time: "2026-10-31T10:00:00Z",
    outgoing: true,
    deleted: false,
    attachments: [],
    ...extra,
  };
}

describe("message delivery", () => {
  it("applies recipient read positions to older messages, not newer ones or other chats", () => {
    const rows = applyReadReceiptPositions([
      message("newer", { time: "2026-10-31T10:03:00Z", readReceipts: true }),
      message("marker", {
        time: "2026-10-31T10:02:00Z",
        readReceipts: true,
        seen: { recipient: "2026-10-31T11:00:00Z" },
      }),
      message("older", { time: "2026-10-31T10:01:00Z", readReceipts: true }),
      message("other-chat", { chatId: "another", readReceipts: true }),
    ]);
    expect(rows.map(messageDelivery)).toEqual(["sent", "read", "read", "sent"]);
  });
  it("uses recipient markers on incoming messages, but never our scalar incoming read state", () => {
    const older = message("older", { readReceipts: true });
    const incoming = message("incoming", {
      outgoing: false,
      time: "2026-10-31T10:01:00Z",
      readReceipts: true,
    });
    expect(
      messageDelivery(
        applyReadReceiptPositions([older, { ...incoming, seen: true }])[0],
      ),
    ).toBe("sent");
    expect(
      messageDelivery(
        applyReadReceiptPositions([older, { ...incoming, seen: {} }])[0],
      ),
    ).toBe("sent");
    expect(
      messageDelivery(
        applyReadReceiptPositions([
          older,
          { ...incoming, seen: { recipient: true } },
        ])[0],
      ),
    ).toBe("read");
  });
  it("does not promote pending, failed, or unsupported messages to read", () => {
    const rows = applyReadReceiptPositions([
      message("pending", { status: "PENDING", seen: true, readReceipts: true }),
      message("failed", { status: "FAIL_PERMANENT", readReceipts: true }),
      message("unsupported", { readReceipts: false }),
      message("marker", {
        time: "2026-10-31T10:02:00Z",
        readReceipts: true,
        seen: true,
      }),
    ]);
    expect(rows.map(messageDelivery)).toEqual([
      "pending",
      "failed",
      "sent",
      "read",
    ]);
  });
  it.each([
    true,
    "2026-10-31T10:01:00Z",
    { a: false, b: true },
  ])("uses positive read receipts: %j", (seen) => {
    expect(messageDelivery(message("id", { seen, readReceipts: true }))).toBe(
      "read",
    );
  });
  it.each([
    undefined,
    false,
    "",
    "false",
    {},
    { a: false, b: "" },
  ])("does not invent a read receipt: %j", (seen) => {
    expect(
      messageDelivery(
        message("id", { status: "SUCCESS", seen, readReceipts: true }),
      ),
    ).toBe("sent");
  });
  it.each([
    false,
    undefined,
  ])("ignores seen flags when the app does not explicitly support read receipts: %s", (readReceipts) => {
    expect(
      messageDelivery(
        message("id", { status: "SUCCESS", seen: true, readReceipts }),
      ),
    ).toBe("sent");
  });
  it("keeps pending and failed delivery distinct from sent", () => {
    expect(messageDelivery(message("id", { status: "PENDING" }))).toBe(
      "pending",
    );
    expect(
      messageDelivery(message("id", { status: "FAIL_RETRIABLE", seen: true })),
    ).toBe("failed");
  });
  it("replaces pending and final IDs in place without deduplicating repeated text", () => {
    const local: OutgoingMessage = {
      requestId: "request",
      message: message("local", { status: "PENDING" }),
      pendingId: "pending",
    };
    expect(mergeMessageOutbox([], [local])).toHaveLength(1);
    expect(mergeMessageOutbox([message("pending")], [local])).toMatchObject([
      { id: "pending", renderKey: "outgoing:request" },
    ]);
    local.message = message("final", { status: "SUCCESS" });
    const result = mergeMessageOutbox(
      [message("final", { seen: true }), message("another")],
      [local],
    );
    expect(result).toHaveLength(2);
    expect(result.find((item) => item.id === "final")).toMatchObject({
      renderKey: "outgoing:request",
      seen: true,
    });
  });
  it("keeps the message and attachment visible when submission is unconfirmed", () => {
    const result = mergeMessageOutbox(
      [],
      [
        {
          requestId: "r",
          message: message("local"),
          error: "Unconfirmed",
          attachmentName: "photo.jpg",
        },
      ],
    );
    expect(result[0]).toMatchObject({
      text: "Hello",
      attachmentName: "photo.jpg",
      error: "Unconfirmed",
    });
  });
});
