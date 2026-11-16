import { resolve } from "node:path";
import { beforeEach, expect, it, vi } from "vitest";
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("./connection", () => ({
  assertBeeperOwner: (id: string) => {
    if (id !== "owner") throw new Error("Owner required");
  },
  beeperDirectory: () => "/private/beeper",
}));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (plain: string) =>
    `sealed:${Buffer.from(plain).toString("base64")}`,
  decryptToken: (cipher: string) =>
    Buffer.from(cipher.slice(7), "base64").toString(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(async (path: string) => {
    if (!files.has(path))
      throw Object.assign(new Error("File not found"), { code: "ENOENT" });
    return files.get(path);
  }),
  writeFile: vi.fn(async (path: string, value: string) => {
    files.set(path, value);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  }),
}));
import {
  getBeeperRecoverySettings,
  updateBeeperRecoverySettings,
} from "./recovery-settings";
beforeEach(() => files.clear());
it("stores the recovery key only in an encrypted owner-bound file", async () => {
  await updateBeeperRecoverySettings("owner", async (value) => {
    value.recoveryKey = "private-synthetic-key";
  });
  expect([...files.values()].join()).not.toContain("private-synthetic-key");
  expect((await getBeeperRecoverySettings("owner")).recoveryKey).toBe(
    "private-synthetic-key",
  );
  await expect(getBeeperRecoverySettings("other")).rejects.toThrow(
    "Owner required",
  );
});
it("serializes concurrent preference changes without erasing the key", async () => {
  await Promise.all([
    updateBeeperRecoverySettings("owner", async (value) => {
      value.recoveryKey = "retained-key";
    }),
    updateBeeperRecoverySettings("owner", async (value) => {
      value.autoStart = false;
    }),
  ]);
  const value = await getBeeperRecoverySettings("owner");
  expect(value.recoveryKey).toBe("retained-key");
  expect(value.autoStart).toBe(false);
});
it("persists a pending attempt before an external write and avoids unchanged rewrites", async () => {
  await updateBeeperRecoverySettings("owner", async (value, checkpoint) => {
    value.blockedFingerprint = "pending-attempt";
    await checkpoint();
    expect((await getBeeperRecoverySettings("owner")).blockedFingerprint).toBe(
      "pending-attempt",
    );
  });
  const saved = [...files.values()][0];
  await updateBeeperRecoverySettings("owner", async () => undefined);
  expect([...files.values()][0]).toBe(saved);
});
it("fails closed on corrupt encrypted settings", async () => {
  files.set(resolve("/private/beeper", "recovery.json"), "invalid");
  await expect(getBeeperRecoverySettings("owner")).rejects.toThrow(
    "could not be read securely",
  );
});
