import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swrFetcher } from "./swr-fetcher";
import {
  EMAIL_ACCOUNT_HEADER,
  MICROSOFT_AUTH_EXPIRED_ERROR_CODE,
  NO_REFRESH_TOKEN_ERROR_CODE,
} from "@/utils/config";

const mocks = vi.hoisted(() => ({
  navigate: vi.fn(),
  captureException: vi.fn(),
}));
vi.mock("@/utils/redirect", () => ({ redirectToSafeUrl: mocks.navigate }));
vi.mock("@/utils/error", () => ({ captureException: mocks.captureException }));

beforeEach(() => vi.clearAllMocks());

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("swrFetcher", () => {
  it("replaces the browser's opaque network error with a readable one", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await expect(swrFetcher("/api/user/email-account")).rejects.toThrow(
      "Couldn't connect to Inbox Zero. Check your internet connection and try again.",
    );
  });

  it("lets aborted requests through unchanged", async () => {
    const abort = new DOMException("The operation was aborted.", "AbortError");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(abort));

    await expect(swrFetcher("/api/user/email-account")).rejects.toBe(abort);
  });

  it.each([
    NO_REFRESH_TOKEN_ERROR_CODE,
    MICROSOFT_AUTH_EXPIRED_ERROR_CODE,
  ])("keeps a disconnected account's %s error inside the request instead of navigating the whole app", async (errorCode) => {
    const payload = { error: "Reconnect this mailbox to continue.", errorCode };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(payload, { status: 401 })),
    );
    vi.stubGlobal("window", {
      location: {
        assign: mocks.navigate,
        replace: mocks.navigate,
        reload: mocks.navigate,
      },
    });
    await expect(
      swrFetcher("/api/labels", undefined, "disconnected-account"),
    ).rejects.toMatchObject({
      message: payload.error,
      status: 401,
      info: payload,
      errorCode,
      retryable: false,
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("keeps a provider-auth failure rejected even without an account header", async () => {
    const payload = {
      error: "Mailbox permissions expired",
      errorCode: MICROSOFT_AUTH_EXPIRED_ERROR_CODE,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(payload, { status: 403 })),
    );
    await expect(swrFetcher("/api/labels")).rejects.toMatchObject({
      status: 403,
      errorCode: payload.errorCode,
      retryable: false,
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.captureException).not.toHaveBeenCalled();
  });

  it("allows a healthy mailbox request to succeed independently of a disconnected mailbox", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        const account = new Headers(init.headers).get(EMAIL_ACCOUNT_HEADER);
        return account === "healthy-account"
          ? Response.json({ labels: [{ id: "work", name: "Work" }] })
          : Response.json(
              {
                error: "Mailbox disconnected",
                errorCode: NO_REFRESH_TOKEN_ERROR_CODE,
              },
              { status: 401 },
            );
      }),
    );
    const [failed, healthy] = await Promise.allSettled([
      swrFetcher("/api/labels", undefined, "disconnected-account"),
      swrFetcher("/api/labels", undefined, "healthy-account"),
    ]);
    expect(failed.status).toBe("rejected");
    expect(healthy).toEqual({
      status: "fulfilled",
      value: { labels: [{ id: "work", name: "Work" }] },
    });
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("preserves ordinary failure reporting and retry behavior for unrelated server errors", async () => {
    const payload = {
      error: "Provider temporarily unavailable",
      errorCode: "TEMPORARY_PROVIDER_FAILURE",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(payload, { status: 503 })),
    );
    await expect(
      swrFetcher("/api/labels", undefined, "account"),
    ).rejects.toMatchObject({
      status: 503,
      info: payload,
      errorCode: payload.errorCode,
    });
    expect(mocks.captureException).toHaveBeenCalledTimes(1);
    const error = mocks.captureException.mock.calls[0][0] as Error & {
      retryable?: boolean;
    };
    expect(error.retryable).not.toBe(false);
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it("continues suppressing capture for other server-marked known errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { error: "Expected failure", isKnownError: true },
            { status: 400 },
          ),
        ),
    );
    await expect(swrFetcher("/api/labels")).rejects.toMatchObject({
      status: 400,
      message: "Expected failure",
    });
    expect(mocks.captureException).not.toHaveBeenCalled();
  });
});
