import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), grant: vi.fn() }));
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({ auth: mocks.auth }));
vi.mock("@/utils/todo/cloud-device", () => ({
  getCloudDeviceConnection: mocks.grant,
}));
vi.mock("@/utils/middleware", async () => {
  const { createWithAuthTestMiddleware } = await vi.importActual<
    typeof import("@/__tests__/helpers")
  >("@/__tests__/helpers");
  return createWithAuthTestMiddleware({
    auth: { userId: "sample-owner" },
    handleSafeErrors: true,
  });
});

import { GET } from "./route";

describe("device-scoped cloud connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ session: { id: "sample-session" } });
    prisma.session.findFirst.mockResolvedValue({
      id: "sample-session",
    } as never);
    mocks.grant.mockResolvedValue({
      url: "https://sync.example.com",
      namespace: "sample-namespace",
      key: "synthetic-key",
      token: "synthetic-device-token",
      deviceId: "sample-device",
    });
  });
  it("cannot recreate a cloud grant through a cached but revoked local session", async () => {
    prisma.session.findFirst.mockResolvedValue(null);
    expect((await GET(request(), {} as never)).status).toBe(401);
    expect(prisma.session.findFirst).toHaveBeenCalledWith({
      where: {
        id: "sample-session",
        userId: "sample-owner",
        expires: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not issue a grant when authentication has no current session id", async () => {
    mocks.auth.mockResolvedValue({ session: {} });
    expect((await GET(request(), {} as never)).status).toBe(401);
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("issues only the validated owner's scoped grant with noncacheable headers", async () => {
    const response = await GET(request(), {} as never);
    expect(response.status).toBe(200);
    expect(mocks.grant).toHaveBeenCalledWith("sample-owner", "sample-session");
    expect(prisma.session.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.grant.mock.invocationCallOrder[0],
    );
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(await response.json()).toMatchObject({
      enabled: true,
      token: "synthetic-device-token",
      deviceId: "sample-device",
    });
  });
});

function request() {
  return new Request(
    "http://localhost:3000/api/user/todo/sync/connection",
  ) as never;
}
