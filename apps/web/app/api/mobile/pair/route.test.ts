import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { SafeError } from "@/utils/error";

const mocks = vi.hoisted(() => ({ revoke: vi.fn() }));
vi.mock("@/utils/prisma");
vi.mock("@/utils/middleware", async () => {
  const { createWithAuthTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");
  return createWithAuthTestMiddleware({
    auth: { userId: "sample-owner" },
    handleSafeErrors: true,
  });
});
vi.mock("@/utils/todo/cloud-device", () => ({
  revokeCloudDevice: mocks.revoke,
}));
vi.mock("@/utils/mobile-pairing/tokens", () => ({
  createPairingCode: vi.fn(),
}));
vi.mock("@/utils/mobile-pairing/network", () => ({
  privateAddresses: () => [],
  enableMobileNetwork: vi.fn(),
}));
vi.mock("@/utils/rate-limit", () => ({
  checkRateLimit: async () => ({ limited: false }),
  createRateLimitKey: () => "sample-rate-key",
}));

import { DELETE } from "./route";

describe("disconnecting an Android device", () => {
  const record = {
    token: "android-device:sample-id",
    identifier: `android-device:sample-owner:${JSON.stringify({ sessionId: "sample-session", name: "Example tablet" })}`,
  };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.revoke.mockResolvedValue(undefined);
    prisma.verificationToken.findUnique.mockResolvedValue(record as never);
    prisma.session.deleteMany.mockResolvedValue({ count: 1 });
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
  });
  it("finishes remote grant revocation before deleting the owned local session and device record", async () => {
    let release = () => {};
    mocks.revoke.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const pending = DELETE(request(), {} as never);
    await vi.waitFor(() =>
      expect(mocks.revoke).toHaveBeenCalledWith(
        "sample-owner",
        "sample-session",
      ),
    );
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    expect(prisma.verificationToken.deleteMany).not.toHaveBeenCalled();
    release();
    const response = await pending;
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ removed: true });
    expect(prisma.session.deleteMany).toHaveBeenCalledWith({
      where: { id: "sample-session", userId: "sample-owner" },
    });
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: { token: record.token, identifier: record.identifier },
    });
  });
  it("keeps the session and device record when remote revocation fails so Disconnect can be retried", async () => {
    mocks.revoke.mockRejectedValue(
      new SafeError("Cloud revocation unavailable; try Disconnect again.", 503),
    );
    const response = await DELETE(request(), {} as never);
    expect(response.status).toBe(503);
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    expect(prisma.verificationToken.deleteMany).not.toHaveBeenCalled();
    mocks.revoke.mockResolvedValue(undefined);
    expect((await DELETE(request(), {} as never)).status).toBe(200);
  });
  it.each([
    null,
    "https://attacker.example",
  ])("rejects an absent or cross-site origin (%s) before looking up a device", async (origin) => {
    const response = await DELETE(request(origin), {} as never);
    expect(response.status).toBe(403);
    expect(prisma.verificationToken.findUnique).not.toHaveBeenCalled();
    expect(mocks.revoke).not.toHaveBeenCalled();
  });
  it("does not revoke another account's cloud grant or local session", async () => {
    prisma.verificationToken.findUnique.mockResolvedValue({
      ...record,
      identifier: `android-device:other-owner:${JSON.stringify({ sessionId: "other-session" })}`,
    } as never);
    expect((await DELETE(request(), {} as never)).status).toBe(404);
    expect(mocks.revoke).not.toHaveBeenCalled();
    expect(prisma.session.deleteMany).not.toHaveBeenCalled();
    expect(prisma.verificationToken.deleteMany).not.toHaveBeenCalled();
  });
});

function request(origin: string | null = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/mobile/pair", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      ...(origin ? { Origin: origin } : {}),
    },
    body: JSON.stringify({ id: "android-device:sample-id" }),
  }) as never;
}
