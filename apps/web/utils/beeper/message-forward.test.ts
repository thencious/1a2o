import { describe, expect, it, vi } from "vitest";
import { canForwardMessage, prepareMessageForward } from "./message-forward";
import type { ChatMessage } from "./types";

const message: ChatMessage = {
  id: "original",
  chatId: "source/room",
  sender: "Sender",
  text: "See https://example.com",
  time: new Date().toISOString(),
  outgoing: false,
  deleted: false,
  attachments: [],
};
describe("message forwarding", () => {
  it("copies text and links without creating a reply to a message in another chat", async () => {
    const fetcher = vi.fn();
    const prepared = await prepareMessageForward(message, undefined, fetcher);
    expect(prepared).toEqual({ text: message.text, attachments: [] });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("prepares every attachment through the authenticated local asset endpoint", async () => {
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(new Blob(["file data"], { type: "image/png" })),
    );
    const prepared = await prepareMessageForward(
      {
        ...message,
        attachments: [
          { index: 0, name: "first.png", mime: "image/png", type: "img" },
          { index: 1, name: "second.png", mime: "image/png", type: "img" },
        ],
      },
      undefined,
      fetcher,
    );
    expect(prepared.attachments.map((file) => file.name)).toEqual([
      "first.png",
      "second.png",
    ]);
    const request = new URL(
      fetcher.mock.calls[0][0] as string,
      "http://localhost",
    );
    expect(request.pathname).toBe("/api/user/messages/asset");
    expect(request.searchParams.get("chatId")).toBe(message.chatId);
    expect(request.searchParams.get("messageId")).toBe(message.id);
  });
  it("rejects missing media instead of forwarding only part of a message", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      prepareMessageForward(
        {
          ...message,
          attachments: [
            {
              index: 0,
              name: "gone",
              mime: "application/octet-stream",
              type: "file",
            },
          ],
        },
        undefined,
        fetcher,
      ),
    ).rejects.toThrow(/attachment/i);
  });
  it("does not forward deleted, pending, failed, or empty messages", () => {
    for (const extra of [
      { deleted: true },
      { status: "PENDING" },
      { status: "FAIL_PERMANENT" },
      { id: "local:pending" },
      { text: "", attachments: [] },
    ])
      expect(canForwardMessage({ ...message, ...extra })).toBe(false);
    expect(canForwardMessage(message)).toBe(true);
  });
  it("rejects oversized media before it is read or sent", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("x", { headers: { "Content-Length": "19000000" } }),
    );
    await expect(
      prepareMessageForward(
        {
          ...message,
          attachments: [
            { index: 0, name: "large", mime: "video/mp4", type: "video" },
          ],
        },
        undefined,
        fetcher,
      ),
    ).rejects.toThrow(/18 MB/);
  });
});
