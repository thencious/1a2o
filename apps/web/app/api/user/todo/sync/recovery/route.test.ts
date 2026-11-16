import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  status: vi.fn(),
  readFile: vi.fn(),
}));
vi.mock("@/utils/prisma");
vi.mock("@/utils/auth", () => ({ auth: mocks.auth }));
vi.mock("node:fs/promises", () => ({ readFile: mocks.readFile }));
vi.mock("@/utils/local-workspace", () => ({
  localWorkspaceRoot: () => "/isolated-test-workspace",
}));
vi.mock("@/utils/todo/cloud-sync", () => ({
  getCloudSyncStatus: mocks.status,
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

describe("private cloud recovery export", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.auth.mockResolvedValue({ session: { id: "sample-session" } });
    prisma.session.findFirst.mockResolvedValue({
      id: "sample-session",
    } as never);
    mocks.status.mockResolvedValue({ enabled: true });
    mocks.readFile.mockResolvedValue('{"sample":"synthetic-recovery-bundle"}');
  });
  it("rejects a revoked cached session before checking cloud state or reading the private recovery file", async () => {
    prisma.session.findFirst.mockResolvedValue(null);
    const response = await GET(request(), {} as never);
    expect(response.status).toBe(401);
    expect(prisma.session.findFirst).toHaveBeenCalledWith({
      where: {
        id: "sample-session",
        userId: "sample-owner",
        expires: { gt: expect.any(Date) },
      },
      select: { id: true },
    });
    expect(mocks.status).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it("requires an identifiable current session before touching the private file", async () => {
    mocks.auth.mockResolvedValue(null);
    expect((await GET(request(), {} as never)).status).toBe(401);
    expect(prisma.session.findFirst).not.toHaveBeenCalled();
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it("does not export another account's recovery bundle when cloud ownership is not enabled", async () => {
    mocks.status.mockResolvedValue({ enabled: false });
    expect((await GET(request(), {} as never)).status).toBe(404);
    expect(mocks.status).toHaveBeenCalledWith("sample-owner");
    expect(mocks.readFile).not.toHaveBeenCalled();
  });
  it("returns the owned bundle as a noncacheable attachment only after fresh session validation", async () => {
    const response = await GET(request(), {} as never);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(response.headers.get("Content-Disposition")).toBe(
      'attachment; filename="1a2o-recovery.json"',
    );
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(await response.json()).toEqual({
      sample: "synthetic-recovery-bundle",
    });
    expect(mocks.readFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]\.context[\\/]sync[\\/]recovery\.json$/),
      "utf8",
    );
    expect(prisma.session.findFirst.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.readFile.mock.invocationCallOrder[0],
    );
  });
});

function request() {
  return new Request(
    "http://localhost:3000/api/user/todo/sync/recovery",
  ) as never;
}
