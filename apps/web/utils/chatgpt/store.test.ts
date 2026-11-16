import { beforeEach, expect, it, vi } from "vitest";
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("@/utils/local-workspace", () => ({
  localWorkspaceRoot: () => process.cwd(),
}));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (text: string) => `v1:${Buffer.from(text).toString("base64")}`,
  decryptToken: (text: string) =>
    Buffer.from(text.slice(3), "base64").toString(),
}));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (file: string) => {
    if (!files.has(file))
      throw Object.assign(new Error("Missing"), { code: "ENOENT" });
    return files.get(file);
  },
  writeFile: async (file: string, text: string) => {
    files.set(file, text);
  },
  rename: async (from: string, to: string) => {
    if (!files.has(from))
      throw Object.assign(new Error("Missing"), { code: "ENOENT" });
    files.set(to, files.get(from)!);
    files.delete(from);
  },
  unlink: async (file: string) => {
    files.delete(file);
  },
}));
import {
  consumeChatGPTAttempt,
  saveChatGPTAttempt,
  updateChatGPTAccount,
  readChatGPTAccount,
} from "./store";
beforeEach(() => files.clear());
it("atomically consumes callback transactions once and rejects expired transactions", async () => {
  const attempt = {
    state: "a".repeat(43),
    nonce: "nonce",
    verifier: "verifier",
    userId: "owner",
    redirectUri: "http://127.0.0.1:3000/auth/callback",
    expiresAt: Date.now() + 10_000,
  };
  await saveChatGPTAttempt(attempt);
  expect(await consumeChatGPTAttempt(attempt.state)).toEqual(attempt);
  await expect(consumeChatGPTAttempt(attempt.state)).rejects.toThrow();
  await saveChatGPTAttempt({ ...attempt, expiresAt: 1 });
  await expect(consumeChatGPTAttempt(attempt.state)).rejects.toThrow("expired");
  expect(files.size).toBe(0);
});
it("serializes rotating-token updates and keeps account records separate", async () => {
  const operations = Array.from({ length: 4 }, () =>
    updateChatGPTAccount("owner", async (account) => {
      await Promise.resolve();
      return {
        account: {
          ...account,
          expiresAt: (account.expiresAt ?? 0) + 1,
          accessToken: "private-fixture",
        },
        result: undefined,
      };
    }),
  );
  await Promise.all(operations);
  expect((await readChatGPTAccount("owner"))?.expiresAt).toBe(4);
  expect(await readChatGPTAccount("someone-else")).toBeNull();
  expect(
    [...files.values()].every(
      (value) => value.startsWith("v1:") && !value.includes("private-fixture"),
    ),
  ).toBe(true);
});
