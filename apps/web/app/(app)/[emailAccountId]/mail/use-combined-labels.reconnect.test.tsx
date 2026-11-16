// @vitest-environment jsdom
import { createElement, type ReactNode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SWRConfig, unstable_serialize } from "swr";
const mocks = vi.hoisted(() => ({
  catalog: {
    emailAccounts: [
      {
        id: "good",
        account: { disconnectedAt: null as string | null },
        providerRateLimit: null,
      },
      {
        id: "bad",
        account: { disconnectedAt: null as string | null },
        providerRateLimit: null,
      },
    ],
  },
  refreshAccounts: vi.fn(),
  refreshWarnings: vi.fn(),
}));
vi.mock("swr", async (importOriginal) => {
  const real = await importOriginal<typeof import("swr")>();
  return {
    ...real,
    useSWRConfig: () => ({
      ...real.useSWRConfig(),
      mutate: mocks.refreshWarnings,
    }),
  };
});
vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: () => ({ data: mocks.catalog, mutate: mocks.refreshAccounts }),
}));
vi.mock("@/app/(app)/[emailAccountId]/mail/use-engine-mail-threads", () => ({
  useEngineMailThreads: () => ({ isLoading: false, data: [] }),
}));
import { useCombinedMailThreads } from "./use-combined-mail-threads";
const accounts = [
  { id: "good", email: "good@example.com", provider: "google" },
  { id: "bad", email: "bad@example.com", provider: "microsoft" },
];
const args = {
  accounts,
  emailAccountId: "good",
  enabled: true,
  isUnread: false,
};

describe("combined label refresh after disconnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const account of mocks.catalog.emailAccounts)
      account.account.disconnectedAt = null;
  });
  it("refreshes reconnect status once while showing healthy and cached labels before slow status requests finish", async () => {
    mocks.refreshAccounts.mockImplementation(() => new Promise(() => {}));
    mocks.refreshWarnings.mockImplementation(() => new Promise(() => {}));
    const fetcher = vi.fn(async ([, id]: string[]) => {
      if (id === "bad")
        throw Object.assign(new Error("Reconnect required"), {
          retryable: false,
        });
      return { labels: [{ id: "fresh", name: "New clients", type: "user" }] };
    });
    const key = [
      "mail-labels-by-account",
      JSON.stringify([["bad", "good"], []]),
    ];
    const cache = new Map([
      [
        unstable_serialize(key),
        {
          data: {
            good: {
              old: { id: "old", name: "Previous clients", type: "user" },
            },
            bad: {
              saved: { id: "saved", name: "Cached category", type: "user" },
            },
          },
        },
      ],
    ]);
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        SWRConfig,
        {
          value: {
            provider: () => cache,
            fetcher,
            dedupingInterval: 0,
            revalidateOnMount: true,
          },
        },
        children,
      );
    const { result, unmount } = renderHook(() => useCombinedMailThreads(args), {
      wrapper,
    });
    await waitFor(() =>
      expect(Object.keys(result.current.labelsByAccount.good)).toEqual([
        "fresh",
      ]),
    );
    expect(Object.keys(result.current.labelsByAccount.bad)).toEqual(["saved"]);
    expect(mocks.refreshAccounts).toHaveBeenCalledTimes(1);
    expect(mocks.refreshWarnings).toHaveBeenCalledExactlyOnceWith(
      "/api/user/error-messages",
    );
    unmount();
  });
  it("does not request labels from an account already known to be disconnected", async () => {
    mocks.catalog.emailAccounts[1].account.disconnectedAt =
      "2026-11-16T00:00:00Z";
    const fetcher = vi.fn(async () => ({
      labels: [{ id: "clients", name: "Clients", type: "user" }],
    }));
    const cache = new Map();
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(
        SWRConfig,
        { value: { provider: () => cache, fetcher, dedupingInterval: 0 } },
        children,
      );
    const { result, unmount } = renderHook(() => useCombinedMailThreads(args), {
      wrapper,
    });
    await waitFor(() =>
      expect(result.current.labelsByAccount.good?.clients).toBeTruthy(),
    );
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual([
      ["/api/labels", "good"],
    ]);
    expect(mocks.refreshAccounts).not.toHaveBeenCalled();
    unmount();
  });
});
