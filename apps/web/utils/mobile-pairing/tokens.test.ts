import { beforeEach, describe, expect, it, vi } from "vitest";
import prisma from "@/utils/__mocks__/prisma";
import { createPairingCode, consumePairingCode } from "./tokens";
vi.mock("@/utils/prisma");
describe("single-use Android pairing", () => {
  beforeEach(() => vi.clearAllMocks());
  it("stores only a hash and expires five minutes after creation", async () => {
    prisma.verificationToken.upsert.mockResolvedValue({} as never);
    const result = await createPairingCode("owner");
    expect(result.code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const record = prisma.verificationToken.upsert.mock.calls[0][0].create;
    expect(record.identifier).not.toContain(result.code);
    expect(record.token).toBe("android-pair:owner");
    expect(new Date(result.expiresAt).getTime() - Date.now()).toBeGreaterThan(
      295_000,
    );
  });
  it("claims the code atomically before creating a session", async () => {
    prisma.verificationToken.findFirst.mockResolvedValue({
      token: "android-pair:owner",
      expires: new Date(Date.now() + 60_000),
    } as never);
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 1 });
    await expect(consumePairingCode("A".repeat(43))).resolves.toEqual({
      userId: "owner",
    });
    expect(prisma.verificationToken.deleteMany).toHaveBeenCalledWith({
      where: {
        token: "android-pair:owner",
        identifier: expect.stringMatching(/^android-pair-code:[0-9a-f]{64}$/),
        expires: { gt: expect.any(Date) },
      },
    });
  });
  it("rejects an expired code without consuming it", async () => {
    prisma.verificationToken.findFirst.mockResolvedValue({
      token: "android-pair:owner",
      expires: new Date(0),
    } as never);
    await expect(consumePairingCode("A".repeat(43))).rejects.toThrow("expired");
    expect(prisma.verificationToken.deleteMany).not.toHaveBeenCalled();
  });
  it("rejects concurrent replay and unrelated verification tokens", async () => {
    prisma.verificationToken.findFirst.mockResolvedValue({
      token: "android-pair:owner",
      expires: new Date(Date.now() + 60_000),
    } as never);
    prisma.verificationToken.deleteMany.mockResolvedValue({ count: 0 });
    await expect(consumePairingCode("A".repeat(43))).rejects.toThrow(
      "already been used",
    );
    prisma.verificationToken.findFirst.mockResolvedValue({
      token: "some-other-purpose:owner",
      expires: new Date(Date.now() + 60_000),
    } as never);
    await expect(consumePairingCode("A".repeat(43))).rejects.toThrow("invalid");
  });
  it("replaces an owner's old code and only consumes the current hash", async () => {
    let stored: { token: string; identifier: string; expires: Date } | null =
      null;
    prisma.verificationToken.upsert.mockImplementation(async (input) => {
      stored = input.create as typeof stored;
      return stored as never;
    });
    prisma.verificationToken.findFirst.mockImplementation(async (input) =>
      stored?.identifier === input?.where?.identifier
        ? (stored as never)
        : null,
    );
    prisma.verificationToken.deleteMany.mockImplementation(async (input) => {
      if (!stored || stored.identifier !== input?.where?.identifier)
        return { count: 0 };
      stored = null;
      return { count: 1 };
    });
    const first = await createPairingCode("owner");
    const second = await createPairingCode("owner");
    expect(first.code).not.toBe(second.code);
    expect(
      prisma.verificationToken.upsert.mock.calls.map(([input]) => input.where),
    ).toEqual([
      { token: "android-pair:owner" },
      { token: "android-pair:owner" },
    ]);
    await expect(consumePairingCode(first.code)).rejects.toThrow("expired");
    await expect(consumePairingCode(second.code)).resolves.toEqual({
      userId: "owner",
    });
    await expect(consumePairingCode(second.code)).rejects.toThrow("expired");
  });
});
