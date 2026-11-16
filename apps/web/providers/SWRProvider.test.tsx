// @vitest-environment jsdom
import { cleanup, render, waitFor } from "@testing-library/react";
import type { Cache } from "swr";
import useSWR, { useSWRConfig } from "swr";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EMAIL_ACCOUNT_ID_REQUIRED_ERROR,
  NO_REFRESH_TOKEN_ERROR_CODE,
} from "@/utils/config";
import { useAccounts } from "@/hooks/useAccounts";
import { resetEmailAccountsInflight } from "@/utils/fetch-email-accounts";
import { SWRProvider } from "./SWRProvider";
import { resetSwrPersistenceBlocksForTesting } from "@/utils/swr-persistence";

const accountState = { emailAccountId: "account-a" };

vi.mock("@/providers/EmailAccountProvider", () => ({
  useAccount: () => accountState,
}));

vi.mock("@/utils/error", () => ({
  captureException: vi.fn(),
}));

let scopedCache: Cache | undefined;

function CacheProbe() {
  scopedCache = useSWRConfig().cache;
  return null;
}

function snapshotKey(accountId: string) {
  return `inbox-zero:swr:v2:${accountId}`;
}

describe("SWRProvider persisted cache", () => {
  beforeEach(() => {
    window.localStorage.clear();
    resetSwrPersistenceBlocksForTesting();
    accountState.emailAccountId = "account-a";
    scopedCache = undefined;
    resetEmailAccountsInflight();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    resetEmailAccountsInflight();
  });

  it("hydrates whitelisted entries into the live cache after mount", async () => {
    window.localStorage.setItem(
      snapshotKey("account-a"),
      JSON.stringify({ "/api/labels": { labels: ["a-label"] } }),
    );

    render(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );

    await waitFor(() => {
      expect(scopedCache?.get("/api/labels")?.data).toEqual({
        labels: ["a-label"],
      });
    });
  });

  it("clears a first-paint cache once an account id appears", async () => {
    accountState.emailAccountId = "";
    window.localStorage.setItem(
      snapshotKey("account-a"),
      JSON.stringify({ "/api/labels": { labels: ["a-label"] } }),
    );

    const view = render(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );

    await waitFor(() => {
      expect(scopedCache).toBeDefined();
    });
    scopedCache?.set("/api/labels", {
      data: { labels: ["stale-without-account"] },
    });

    accountState.emailAccountId = "account-a";
    view.rerender(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );

    await waitFor(() => {
      expect(scopedCache?.get("/api/labels")?.data).toEqual({
        labels: ["a-label"],
      });
    });
  });

  it("revalidates a cached missing-account 403 when the account id appears", async () => {
    accountState.emailAccountId = "";
    let shouldFail = true;
    const fetcher = vi.fn(async () => {
      if (shouldFail) {
        const error = new Error(EMAIL_ACCOUNT_ID_REQUIRED_ERROR) as Error & {
          status?: number;
        };
        error.status = 403;
        throw error;
      }
      return { emailAccount: { id: "account-a" } };
    });

    function EmailAccountProbe() {
      const { data, error } = useSWR("/api/user/email-account", fetcher, {
        shouldRetryOnError: false,
        revalidateOnFocus: false,
        revalidateOnReconnect: false,
      });
      return (
        <div data-testid="status">
          {error ? "error" : data ? "ok" : "loading"}
        </div>
      );
    }

    const view = render(
      <SWRProvider>
        <EmailAccountProbe />
      </SWRProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("status").textContent).toBe("error");
    });

    shouldFail = false;
    accountState.emailAccountId = "account-a";
    view.rerender(
      <SWRProvider>
        <EmailAccountProbe />
      </SWRProvider>,
    );

    await waitFor(() => {
      expect(view.getByTestId("status").textContent).toBe("ok");
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("replaces whitelisted entries on account switch instead of leaking them", async () => {
    window.localStorage.setItem(
      snapshotKey("account-a"),
      JSON.stringify({
        "/api/labels": { labels: ["a-label"] },
        "/api/labels/counts": { counts: ["a-counts"] },
      }),
    );
    window.localStorage.setItem(
      snapshotKey("account-b"),
      JSON.stringify({ "/api/labels": { labels: ["b-label"] } }),
    );

    const view = render(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );
    await waitFor(() => {
      expect(scopedCache?.get("/api/labels")?.data).toEqual({
        labels: ["a-label"],
      });
    });

    scopedCache?.set("/api/mail/settings", {
      data: { splits: [{ id: "a-split", values: ["a-label"] }] },
    });

    accountState.emailAccountId = "account-b";
    view.rerender(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );

    await waitFor(() => {
      expect(scopedCache?.get("/api/labels")?.data).toEqual({
        labels: ["b-label"],
      });
      // account-b has no counts snapshot: account-a's value must be gone.
      expect(scopedCache?.get("/api/labels/counts")?.data).toBeUndefined();
      expect(scopedCache?.get("/api/mail/settings")?.data).toBeUndefined();
    });
  });

  it("persists the active account's whitelisted entries on pagehide", async () => {
    window.localStorage.setItem(
      snapshotKey("account-a"),
      JSON.stringify({ "/api/labels": { labels: ["a-label"] } }),
    );

    render(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );
    await waitFor(() => {
      expect(scopedCache?.get("/api/labels")?.data).toBeDefined();
    });

    window.localStorage.clear();
    window.dispatchEvent(new Event("pagehide"));

    expect(
      JSON.parse(window.localStorage.getItem(snapshotKey("account-a")) ?? "{}"),
    ).toEqual({ "/api/labels": { labels: ["a-label"] } });
  });

  it("stops persisting an account after another tab removes its snapshot", async () => {
    window.localStorage.setItem(
      snapshotKey("account-a"),
      JSON.stringify({ "/api/labels": { labels: ["a-label"] } }),
    );

    render(
      <SWRProvider>
        <CacheProbe />
      </SWRProvider>,
    );
    await waitFor(() => {
      expect(scopedCache?.get("/api/labels")?.data).toBeDefined();
    });

    // Another tab logging out removes the snapshot and fires a storage event.
    window.localStorage.removeItem(snapshotKey("account-a"));
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: snapshotKey("account-a"),
        newValue: null,
      }),
    );
    window.dispatchEvent(new Event("pagehide"));

    expect(window.localStorage.getItem(snapshotKey("account-a"))).toBeNull();
  });

  it("refreshes connection status once without retrying failed mailbox requests", async () => {
    let disconnected = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/user/email-accounts") {
        return {
          ok: true,
          json: async () => ({
            emailAccounts: [
              {
                id: "account-a",
                account: { disconnectedAt: disconnected ? "2026-11-16" : null },
              },
            ],
          }),
        };
      }
      if (url === "/api/user/error-messages") {
        return {
          ok: true,
          json: async () => ({ warning: disconnected }),
        };
      }
      return {
        ok: false,
        status: 401,
        json: async () => ({
          error: "Reconnect your account",
          errorCode: NO_REFRESH_TOKEN_ERROR_CODE,
        }),
      };
    });
    vi.stubGlobal("fetch", fetchMock);

    function ConnectionProbe({ fail }: { fail: boolean }) {
      const { data: accounts } = useAccounts();
      const { data: errors } = useSWR("/api/user/error-messages");
      useSWR(fail ? ["/api/labels", "account-a"] : null, {
        errorRetryInterval: 10,
      });
      useSWR(fail ? ["/api/folders", "account-a"] : null, {
        errorRetryInterval: 10,
      });
      return (
        <div data-testid="connection">
          {accounts?.emailAccounts[0].account.disconnectedAt && errors?.warning
            ? "reconnect"
            : "connected"}
        </div>
      );
    }

    const view = render(
      <SWRProvider>
        <ConnectionProbe fail={false} />
      </SWRProvider>,
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));

    disconnected = true;
    view.rerender(
      <SWRProvider>
        <ConnectionProbe fail />
      </SWRProvider>,
    );
    await waitFor(() =>
      expect(view.getByTestId("connection").textContent).toBe("reconnect"),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/labels"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(([url]) => url === "/api/folders"),
    ).toHaveLength(1);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/user/email-accounts",
      ),
    ).toHaveLength(2);
    expect(
      fetchMock.mock.calls.filter(
        ([url]) => url === "/api/user/error-messages",
      ),
    ).toHaveLength(2);
  });
});
