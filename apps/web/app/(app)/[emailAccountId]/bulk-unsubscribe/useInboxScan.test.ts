// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { fetcher } = vi.hoisted(() => ({ fetcher: vi.fn() }));
vi.mock("@/providers/swr-fetcher", () => ({ swrFetcher: fetcher }));
import { useInboxScan } from "./useInboxScan";
const accounts = [
  { id: "gmail", email: "a@example.com" },
  { id: "outlook", email: "b@example.com" },
];
beforeEach(() => {
  vi.clearAllMocks();
  fetcher.mockReset();
  localStorage.clear();
});

describe("resumable inbox scanning", () => {
  it("continues incomplete history scans and uses incremental sync after a complete walk", async () => {
    localStorage.setItem(
      "bulk-unsubscribe-history-v1:gmail",
      JSON.stringify({ pageToken: "saved-page", complete: false }),
    );
    localStorage.setItem(
      "bulk-unsubscribe-history-v1:outlook",
      JSON.stringify({ complete: true }),
    );
    fetcher.mockImplementation(async (_url, init, id) => {
      const body = JSON.parse(init.body);
      if (id === "outlook") return { loadedAfterMessages: 2 };
      return {
        loadedMessages: 1,
        nextPageToken: body.pageToken === "saved-page" ? "last-page" : null,
      };
    });
    const refresh = vi.fn(async () => {});
    const { result, unmount } = renderHook(() =>
      useInboxScan(accounts, refresh),
    );
    await waitFor(() => expect(result.current.loading).toBe(false), {
      timeout: 4000,
    });
    expect(
      fetcher.mock.calls.map((call) => [call[2], JSON.parse(call[1].body)]),
    ).toEqual([
      ["gmail", { fullScan: true, pageToken: "saved-page" }],
      ["gmail", { fullScan: true, pageToken: "last-page" }],
      ["outlook", { loadBefore: false }],
    ]);
    expect(result.current.loaded).toBe(4);
    expect(
      JSON.parse(localStorage.getItem("bulk-unsubscribe-history-v1:gmail")!),
    ).toEqual({ complete: true });
    unmount();
  });
  it("keeps a failed account's checkpoint and allows retry without rescanning earlier pages", async () => {
    fetcher
      .mockResolvedValueOnce({
        loadedMessages: 20,
        nextPageToken: "resume-here",
      })
      .mockRejectedValueOnce(new Error("Temporary provider failure"));
    const one = accounts.slice(0, 1);
    const { result, unmount } = renderHook(() =>
      useInboxScan(one, async () => {}),
    );
    await waitFor(
      () => expect(result.current.errors).toEqual(["a@example.com"]),
      { timeout: 4000 },
    );
    expect(
      JSON.parse(localStorage.getItem("bulk-unsubscribe-history-v1:gmail")!)
        .pageToken,
    ).toBe("resume-here");
    fetcher.mockResolvedValueOnce({ loadedMessages: 2, nextPageToken: null });
    await act(async () => {
      await result.current.scan(true);
    });
    expect(JSON.parse(fetcher.mock.calls.at(-1)![1].body)).toEqual({
      fullScan: true,
      pageToken: "resume-here",
    });
    expect(result.current.errors).toEqual([]);
    unmount();
  });
});

it("does not request a known disconnected mailbox and resumes it after reconnection", async () => {
  fetcher.mockResolvedValue({ loadedMessages: 1, nextPageToken: null });
  const account = {
    ...accounts[0],
    account: { disconnectedAt: "2026-11-17T00:00:00Z" as string | null },
  };
  const { result, rerender, unmount } = renderHook(
    ({ items }) => useInboxScan(items, async () => {}),
    { initialProps: { items: [account] } },
  );
  await act(async () => {});
  expect(fetcher).not.toHaveBeenCalled();
  rerender({ items: [{ ...account, account: { disconnectedAt: null } }] });
  await waitFor(() => expect(result.current.loaded).toBe(1));
  expect(fetcher).toHaveBeenCalledTimes(1);
  unmount();
});
it("retains the cursor while paused on rate limiting and retries the same page", async () => {
  vi.useFakeTimers();
  try {
    fetcher
      .mockRejectedValueOnce(
        Object.assign(new Error("Rate limited"), { status: 429 }),
      )
      .mockResolvedValueOnce({ loadedMessages: 3, nextPageToken: null });
    const one = accounts.slice(0, 1),
      { result, unmount } = renderHook(() => useInboxScan(one, async () => {}));
    await act(async () => {});
    expect(result.current.paused).toContain("retrying automatically");
    expect(result.current.errors).toEqual([]);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(result.current.loaded).toBe(3);
    expect(result.current.paused).toBe("");
    expect(fetcher.mock.calls[0][1].body).toBe(fetcher.mock.calls[1][1].body);
    unmount();
  } finally {
    vi.useRealTimers();
  }
});
