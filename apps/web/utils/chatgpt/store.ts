import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { localWorkspaceRoot } from "@/utils/local-workspace";

export type ChatGPTAccount = {
  hostId: string;
  enabled: boolean;
  clientId?: string;
  subject?: string;
  email?: string;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number;
  scopes: string[];
  model?: string;
  reasoningEffort?: string;
  models?: {
    id: string;
    name: string;
    defaultReasoning?: string;
    reasoningLevels?: { effort: string; description: string }[];
  }[];
  catalogAt?: number;
  pendingLogin?: { state: string; expiresAt: number };
  loginError?: string;
};
export type ChatGPTAttempt = {
  userId: string;
  state: string;
  nonce: string;
  verifier: string;
  redirectUri: string;
  expiresAt: number;
  clientId?: string;
  subject?: string;
};
const locks = new Map<string, Promise<unknown>>();
function file(key: string) {
  return resolve(
    localWorkspaceRoot(),
    ".context/chatgpt",
    `${createHash("sha256").update(key).digest("hex")}.json`,
  );
}
async function read<T>(key: string): Promise<T | null> {
  try {
    const raw = await readFile(file(key), "utf8");
    if (!raw.startsWith("v1:"))
      throw new Error("ChatGPT credentials are not encrypted.");
    return JSON.parse(decryptToken(raw) ?? "null");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
async function write(key: string, value: unknown) {
  const path = file(key),
    temp = `${path}.${randomUUID()}.tmp`;
  const encrypted = encryptToken(JSON.stringify(value));
  if (!encrypted) throw new Error("ChatGPT credential encryption unavailable.");
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(temp, encrypted, { mode: 0o600 });
  await rename(temp, path);
}
export const readChatGPTAccount = (userId: string) =>
  read<ChatGPTAccount>(`account:${userId}`);
export async function updateChatGPTAccount<T>(
  userId: string,
  update: (
    account: ChatGPTAccount,
  ) => Promise<{ account: ChatGPTAccount; result: T }>,
) {
  const previous = locks.get(userId) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      const current = (await readChatGPTAccount(userId)) ?? {
        hostId: `urn:uuid:${randomUUID()}`,
        enabled: false,
        scopes: [],
      };
      const { account, result } = await update(current);
      await write(`account:${userId}`, account);
      return result;
    });
  locks.set(userId, pending);
  try {
    return await pending;
  } finally {
    if (locks.get(userId) === pending) locks.delete(userId);
  }
}
export const saveChatGPTAttempt = (attempt: ChatGPTAttempt) =>
  write(`attempt:${attempt.state}`, attempt);
export async function consumeChatGPTAttempt(state: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(state))
    throw new Error("Invalid sign-in state.");
  const path = file(`attempt:${state}`),
    consumed = `${path}.${randomUUID()}.used`;
  await rename(path, consumed);
  try {
    const raw = await readFile(consumed, "utf8");
    if (!raw.startsWith("v1:")) throw new Error("Invalid sign-in state.");
    const attempt: ChatGPTAttempt = JSON.parse(decryptToken(raw) ?? "null");
    if (!attempt || attempt.state !== state || attempt.expiresAt < Date.now())
      throw new Error("Sign-in expired. Please try again.");
    return attempt;
  } finally {
    await unlink(consumed);
  }
}
