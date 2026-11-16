import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeSignature } from "better-auth/crypto";
import prisma from "@/utils/__mocks__/prisma";
import { createTestLogger } from "@/__tests__/helpers";

const mocks = vi.hoisted(() => {
  const createSession = vi.fn();
  return {
    consume: vi.fn(),
    createSession,
    authContext: {
      secret: "isolated-pairing-test-secret",
      authCookies: {
        sessionToken: {
          name: "better-auth.session_token",
          attributes: {
            path: "/",
            httpOnly: true,
            sameSite: "Lax",
            secure: false,
            maxAge: 2_592_000,
          },
        },
      },
      internalAdapter: { createSession },
    },
  };
});
const { authContext } = mocks;
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({
  betterAuthConfig: { $context: Promise.resolve(mocks.authContext) },
}));
vi.mock("@/utils/middleware", () => ({
  withError: (_scope: string, handler: unknown) => handler,
}));
vi.mock("@/utils/mobile-pairing/tokens", () => ({
  consumePairingCode: mocks.consume,
}));
vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: async () => ({ limited: false }),
  createRateLimitKey: () => "test-key",
  getClientIp: () => "127.0.0.1",
  hashRateLimitValue: () => "test-ip",
}));

import { POST } from "./route";

describe("Android pairing exchange", () => {
  const expiresAt = new Date("2027-01-01T00:00:00Z");
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consume.mockResolvedValue({ userId: "sample-user" });
    mocks.createSession.mockResolvedValue({
      id: "device-session",
      token: "sample-session-token",
      expiresAt,
    });
    prisma.emailAccount.findFirst.mockResolvedValue({
      id: "sample-account",
    } as never);
    prisma.verificationToken.create.mockResolvedValue({} as never);
  });
  it("returns a correctly signed host-only cookie and records the mapped session id for revocation", async () => {
    const response = await POST(request());
    const result = await response.json();
    const first = result.cookie.split(";")[0];
    const value = decodeURIComponent(first.slice(first.indexOf("=") + 1));
    expect(value).toBe(
      `sample-session-token.${await makeSignature("sample-session-token", authContext.secret)}`,
    );
    expect(result.cookie).toContain("HttpOnly");
    expect(result.cookie).toContain("SameSite=lax");
    expect(result.cookie).not.toContain("Domain=");
    expect(result.redirectPath).toBe("/sample-account/mail?accountScope=all");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.createSession).toHaveBeenCalledWith("sample-user", false, {});
    const record = prisma.verificationToken.create.mock.calls[0][0].data;
    expect(record.token).toMatch(/^android-device:/);
    expect(record.expires).toEqual(expiresAt);
    expect(
      JSON.parse(record.identifier.slice("android-device:sample-user:".length)),
    ).toMatchObject({ sessionId: "device-session", name: "Example tablet" });
  });
  it("does not create a session after a rejected or replayed pairing code", async () => {
    mocks.consume.mockRejectedValue(new Error("Pairing code expired"));
    await expect(POST(request())).rejects.toThrow("expired");
    expect(mocks.createSession).not.toHaveBeenCalled();
    expect(prisma.verificationToken.create).not.toHaveBeenCalled();
  });
  it("opens account setup when the paired installation has no mailbox", async () => {
    prisma.emailAccount.findFirst.mockResolvedValue(null);
    const response = await POST(request());
    expect((await response.json()).redirectPath).toBe("/accounts");
  });
});

function request() {
  return Object.assign(
    new Request("http://localhost:3000/api/mobile/pair/exchange", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: "A".repeat(43),
        deviceName: "Example tablet",
      }),
    }),
    { logger: createTestLogger() },
  );
}
