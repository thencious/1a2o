import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { SafeError } from "@/utils/error";
import type { AttentionState } from "./types";

const locks = new Map<string, Promise<unknown>>();
export function attentionOwner() {
  return process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID;
}
function attentionPath(userId: string) {
  if (!attentionOwner() || userId !== attentionOwner())
    throw new SafeError(
      "Notifications are available only to this installation's owner.",
    );
  const root = localWorkspaceRoot();
  return resolve(
    root,
    ".context/attention",
    `${createHash("sha256").update(userId).digest("hex")}.json`,
  );
}
export async function readAttention(userId: string): Promise<AttentionState> {
  try {
    const value = await readFile(attentionPath(userId), "utf8");
    if (!value.startsWith("v1:"))
      throw new Error("Invalid encrypted notification state");
    const decoded = decryptToken(value);
    if (!decoded) throw new Error("Notification state cannot be decrypted");
    return JSON.parse(decoded);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { startedAt: Date.now(), checkpoints: {}, events: {}, agents: {} };
  }
}
export async function updateAttention<T>(
  userId: string,
  change: (state: AttentionState) => Promise<T> | T,
) {
  const file = attentionPath(userId);
  const previous = locks.get(file) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const state = await readAttention(userId);
      const result = await change(state);
      for (const [id, event] of Object.entries(state.events))
        if (
          event.readAt &&
          event.deliveredAt &&
          event.at < Date.now() - 7 * 86_400_000
        )
          delete state.events[id];
      const encrypted = encryptToken(JSON.stringify(state));
      if (!encrypted) throw new Error("Notification encryption is unavailable");
      await mkdir(resolve(file, ".."), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, encrypted, { mode: 0o600 });
      await rename(temporary, file);
      return result;
    });
  locks.set(file, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(file) === operation) locks.delete(file);
  }
}
