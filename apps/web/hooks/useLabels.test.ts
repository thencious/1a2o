// @vitest-environment jsdom

import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockUseSWR = vi.fn();
const mockUseAccount = vi.fn();
const mockUseAccounts = vi.fn();

vi.mock("swr", () => ({
  default: (...args: Parameters<typeof mockUseSWR>) => mockUseSWR(...args),
}));

vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => mockUseAccount(),
}));

vi.mock("@/hooks/useAccounts", () => ({
  useAccounts: (...args: unknown[]) => mockUseAccounts(...args),
}));

describe("useLabels", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAccounts.mockReturnValue({
      data: {
        emailAccounts: [
          {
            id: "account-2",
            account: { disconnectedAt: null },
            providerRateLimit: null,
          },
        ],
      },
      isLoading: false,
    });
    mockUseSWR.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });
  });

  it("waits for the selected email account before fetching labels", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: undefined,
      isLoading: true,
      providerRateLimit: null,
    });

    const { useLabels } = await import("./useLabels");
    const { result } = renderHook(() => useLabels());

    expect(mockUseSWR).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ shouldRetryOnError: false }),
    );
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(true);
    expect(result.current.userLabels).toEqual([]);
    expect(result.current.isLoading).toBe(true);
  });

  it("skips label fetches while the provider is rate limited", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: { id: "account-1" },
      isLoading: false,
      providerRateLimit: {
        provider: "google",
        retryAt: "2026-04-07T10:21:46.688Z",
        source: "google/webhook",
      },
    });

    const { useLabels } = await import("./useLabels");
    const { result } = renderHook(() => useLabels());

    expect(mockUseSWR).toHaveBeenCalledWith(
      "/api/labels",
      expect.objectContaining({ shouldRetryOnError: false }),
    );
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(true);
    expect(result.current.userLabels).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("scopes label requests to the conversation's account", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: { id: "account-1" },
      isLoading: false,
      providerRateLimit: null,
    });
    const { useLabels } = await import("./useLabels");
    renderHook(() => useLabels("account-2"));
    expect(mockUseSWR).toHaveBeenCalledWith(
      ["/api/labels", "account-2"],
      expect.objectContaining({ shouldRetryOnError: false }),
    );
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(false);
  });

  it("fetches labels once the selected account is clear", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: { id: "account-1" },
      isLoading: false,
      providerRateLimit: null,
    });
    mockUseSWR.mockReturnValue({
      data: {
        labels: [
          { id: "2", name: "[Later]", type: "user" },
          { id: "1", name: "Clients", type: "user" },
          { id: "3", name: "Inbox", type: "system" },
        ],
      },
      isLoading: false,
      error: undefined,
      mutate: vi.fn(),
    });

    const { useLabels } = await import("./useLabels");
    const { result } = renderHook(() => useLabels());

    expect(mockUseSWR).toHaveBeenCalledWith(
      "/api/labels",
      expect.objectContaining({ shouldRetryOnError: false }),
    );
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(false);
    expect(result.current.userLabels.map((label) => label.name)).toEqual([
      "Clients",
      "[Later]",
    ]);
  });
  it("pauses a disconnected account without dropping its cached labels", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: {
        id: "account-1",
        account: { disconnectedAt: "2026-11-16T00:00:00Z" },
      },
      isLoading: false,
      providerRateLimit: null,
    });
    mockUseSWR.mockReturnValue({
      data: { labels: [{ id: "clients", name: "Clients", type: "user" }] },
      isLoading: true,
      error: undefined,
      mutate: vi.fn(),
    });
    const { useLabels } = await import("./useLabels");
    const { result } = renderHook(() => useLabels());
    expect(mockUseSWR.mock.calls.at(-1)?.[0]).toBe("/api/labels");
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(true);
    expect(result.current.userLabels.map((label) => label.id)).toEqual([
      "clients",
    ]);
    expect(result.current.isLoading).toBe(false);
  });

  it("uses an explicitly selected connected mailbox even when the surrounding account is disconnected and rate limited", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: {
        id: "account-1",
        account: { disconnectedAt: "2026-11-16T00:00:00Z" },
      },
      isLoading: false,
      providerRateLimit: { provider: "google" },
    });
    const { useLabels } = await import("./useLabels");
    renderHook(() => useLabels("account-2"));
    expect(mockUseAccounts).toHaveBeenCalledWith(true);
    expect(mockUseSWR.mock.calls.at(-1)?.[0]).toEqual([
      "/api/labels",
      "account-2",
    ]);
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(false);
  });

  it("pauses the explicit mailbox's own disconnection without borrowing the connected context's status", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: { id: "account-1", account: { disconnectedAt: null } },
      isLoading: false,
      providerRateLimit: null,
    });
    mockUseAccounts.mockReturnValue({
      data: {
        emailAccounts: [
          {
            id: "account-2",
            account: { disconnectedAt: "2026-11-16T00:00:00Z" },
            providerRateLimit: null,
          },
        ],
      },
      isLoading: false,
    });
    const { useLabels } = await import("./useLabels");
    const { result } = renderHook(() => useLabels("account-2"));
    expect(mockUseSWR.mock.calls.at(-1)?.[0]).toEqual([
      "/api/labels",
      "account-2",
    ]);
    expect(mockUseSWR.mock.calls.at(-1)?.[1].isPaused()).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("waits for an explicit mailbox's catalog entry even if the current mailbox is already loaded", async () => {
    mockUseAccount.mockReturnValue({
      emailAccount: { id: "account-1" },
      isLoading: false,
      providerRateLimit: null,
    });
    mockUseAccounts.mockReturnValue({ data: undefined, isLoading: true });
    const { useLabels } = await import("./useLabels");
    const { result } = renderHook(() => useLabels("account-2"));
    expect(mockUseSWR.mock.calls.at(-1)?.[0]).toBeNull();
    expect(result.current.isLoading).toBe(true);
  });
});
