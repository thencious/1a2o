// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig } from "swr";
const state = vi.hoisted(() => ({ disconnected: true }));
vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => ({
    emailAccount: {
      id: "mailbox",
      account: {
        disconnectedAt: state.disconnected ? "2026-11-16T00:00:00Z" : null,
      },
    },
    isLoading: false,
    providerRateLimit: null,
  }),
}));
vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ data: undefined, isLoading: false }),
}));
import { useLabels } from "./useLabels";

describe("label requests across reconnects", () => {
  beforeEach(() => {
    state.disconnected = true;
  });
  it.each([
    undefined,
    "mailbox",
  ])("fetches previously uncached labels after reconnect (account=%s)", async (accountId) => {
    const fetcher = vi.fn(async () => ({
      labels: [{ id: "clients", name: "Clients", type: "user" }],
    }));
    const cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => cache,
            fetcher,
            dedupingInterval: 0,
            revalidateOnFocus: false,
          },
        },
        children,
      );
    const { result, rerender, unmount } = renderHook(
      () => useLabels(accountId),
      { wrapper },
    );
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.isLoading).toBe(false);
    act(() => {
      state.disconnected = false;
      rerender();
    });
    await waitFor(() =>
      expect(result.current.userLabels.map((label) => label.id)).toEqual([
        "clients",
      ]),
    );
    expect(fetcher).toHaveBeenCalledTimes(1);
    unmount();
  });
  it("keeps cached labels during disconnection, pauses manual refresh, and resumes on reconnect", async () => {
    state.disconnected = false;
    const fetcher = vi.fn(async () => ({
      labels: [{ id: "clients", name: "Clients", type: "user" }],
    }));
    const cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => cache,
            fetcher,
            dedupingInterval: 0,
            revalidateOnFocus: false,
          },
        },
        children,
      );
    const { result, rerender, unmount } = renderHook(() => useLabels(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.userLabels).toHaveLength(1));
    act(() => {
      state.disconnected = true;
      rerender();
    });
    await act(async () => {
      await result.current.mutate();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.userLabels).toHaveLength(1);
    act(() => {
      state.disconnected = false;
      rerender();
    });
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(result.current.userLabels).toHaveLength(1);
    unmount();
  });
});
