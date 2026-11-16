// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { SWRConfig } from "swr";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMessageOutbox } from "./useMessageOutbox";

const { send } = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock("@/utils/actions/beeper", () => ({ sendBeeperMessageAction: send }));
vi.mock("@/utils/error", () => ({
  getActionErrorMessage: (result: { serverError?: string }) =>
    result.serverError || "Unconfirmed",
}));
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});
afterEach(() => vi.unstubAllGlobals());

function wrapper() {
  const cache = new Map();
  return ({ children }: { children: ReactNode }) => (
    <SWRConfig value={{ provider: () => cache, dedupingInterval: 0 }}>
      {children}
    </SWRConfig>
  );
}

describe("message outbox", () => {
  it("keeps readable mention text in the immediate bubble and passes the selected participant to the send action", async () => {
    send.mockResolvedValue({
      data: { pendingMessageID: "pending", chatID: "mention-chat" },
    });
    const view = renderHook(() => useMessageOutbox("mention-chat", () => {}), {
      wrapper: wrapper(),
    });
    const mentions = [
      { userId: "@whatsapp_123:beeper.com", label: "Alex", start: 3, end: 8 },
    ];
    act(() => view.result.current.submit("Hi @Alex", null, null, mentions));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(send.mock.calls[0][0]).toMatchObject({ text: "Hi @Alex", mentions });
    expect(view.result.current.outbox[0].message.text).toBe("Hi @Alex");
  });
  it("shows each bubble before network completion and queues sends without blocking typing", async () => {
    let finish!: (value: unknown) => void;
    send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    send.mockResolvedValueOnce({
      data: { pendingMessageID: "pending-2", chatID: "chat" },
    });
    const submitted = vi.fn();
    const view = renderHook(() => useMessageOutbox("chat", submitted), {
      wrapper: wrapper(),
    });
    act(() => {
      view.result.current.submit("First", null);
      view.result.current.submit("Second", null);
    });
    await waitFor(() =>
      expect(
        view.result.current.outbox.map((entry) => entry.message.text),
      ).toEqual(["First", "Second"]),
    );
    expect(
      view.result.current.outbox.every(
        (entry) => entry.message.status === "PENDING",
      ),
    ).toBe(true);
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    await act(async () =>
      finish({ data: { pendingMessageID: "pending-1", chatID: "chat" } }),
    );
    await waitFor(() => expect(submitted).toHaveBeenCalledTimes(2));
    expect(send.mock.calls.map(([input]) => input.text)).toEqual([
      "First",
      "Second",
    ]);
    expect(
      new Set(send.mock.calls.map(([input]) => input.requestId)).size,
    ).toBe(2);
    expect(view.result.current.outbox.map((entry) => entry.pendingId)).toEqual([
      "pending-1",
      "pending-2",
    ]);
  });

  it("retains unconfirmed content when navigating away and never retries automatically", async () => {
    send.mockRejectedValueOnce(new Error("Connection lost"));
    const Wrapper = wrapper();
    const first = renderHook(() => useMessageOutbox("failed-chat", vi.fn()), {
      wrapper: Wrapper,
    });
    act(() => first.result.current.submit("Keep my message", null));
    await waitFor(() =>
      expect(first.result.current.outbox[0]?.error).toBe("Connection lost"),
    );
    first.unmount();
    const reopened = renderHook(
      () => useMessageOutbox("failed-chat", vi.fn()),
      { wrapper: Wrapper },
    );
    expect(reopened.result.current.outbox[0]).toMatchObject({
      message: { text: "Keep my message" },
      error: "Connection lost",
    });
    expect(send).toHaveBeenCalledTimes(1);
  });
});
