import "server-only";
import { readFile, mkdir, writeFile, rename } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { SafeError } from "@/utils/error";
import { assertBeeperOwner, beeperDirectory } from "./connection";

export type BeeperRecoverySettings = {
  autoStart: boolean;
  autoVerify: boolean;
  recoveryKey: string;
  accountId: string | null;
  blockedFingerprint: string | null;
};
const locks = new Map<string, Promise<unknown>>();
export async function getBeeperRecoverySettings(
  userId: string,
): Promise<BeeperRecoverySettings> {
  assertBeeperOwner(userId);
  try {
    const plain = decryptToken(
      await readFile(resolve(beeperDirectory(), "recovery.json"), "utf8"),
    );
    if (!plain) throw new Error("Recovery settings cannot be decrypted");
    const value = JSON.parse(plain);
    if (value.owner !== userId)
      throw new Error("Recovery settings belong to another owner");
    return {
      autoStart: value.autoStart !== false,
      autoVerify: value.autoVerify !== false,
      recoveryKey:
        typeof value.recoveryKey === "string" ? value.recoveryKey : "",
      accountId: typeof value.accountId === "string" ? value.accountId : null,
      blockedFingerprint:
        typeof value.blockedFingerprint === "string"
          ? value.blockedFingerprint
          : null,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
      throw new SafeError(
        "Beeper recovery settings could not be read securely.",
      );
    return {
      autoStart: true,
      autoVerify: true,
      recoveryKey: "",
      accountId: null,
      blockedFingerprint: null,
    };
  }
}
export async function updateBeeperRecoverySettings<T>(
  userId: string,
  change: (
    settings: BeeperRecoverySettings,
    checkpoint: () => Promise<void>,
  ) => Promise<T>,
) {
  assertBeeperOwner(userId);
  const previous = locks.get(userId) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const settings = await getBeeperRecoverySettings(userId);
      let persisted = JSON.stringify(settings);
      const checkpoint = async () => {
        const serialized = JSON.stringify(settings);
        if (serialized === persisted) return;
        const encrypted = encryptToken(
          JSON.stringify({ owner: userId, ...settings }),
        );
        if (!encrypted)
          throw new SafeError("Recovery-key encryption is unavailable.");
        await mkdir(beeperDirectory(), { recursive: true });
        const temporary = resolve(
          beeperDirectory(),
          `recovery-${randomUUID()}.tmp`,
        );
        await writeFile(temporary, encrypted, { mode: 0o600 });
        await rename(temporary, resolve(beeperDirectory(), "recovery.json"));
        persisted = serialized;
      };
      const result = await change(settings, checkpoint);
      await checkpoint();
      return result;
    });
  locks.set(userId, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(userId) === operation) locks.delete(userId);
  }
}
