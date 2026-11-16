import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import type { BeeperContact } from "@/utils/beeper/contact-types";
import { normalizeContactIdentities } from "./identities";

const locks = new Map<string, Promise<unknown>>();
export async function savedContacts(userId: string): Promise<BeeperContact[]> {
  try {
    const raw = await readFile(path(userId), "utf8");
    if (!raw.startsWith("v1:"))
      throw new Error("Contact store is not encrypted.");
    return (JSON.parse(decryptToken(raw) ?? "[]") as BeeperContact[]).map(
      normalizeContactIdentities,
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function updateSavedContacts<
  T extends { contacts: BeeperContact[] },
>(userId: string, update: (contacts: BeeperContact[]) => Promise<T>) {
  const previous = locks.get(userId) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      const result = await update(await savedContacts(userId));
      const file = path(userId),
        temporary = `${file}.${randomUUID()}.tmp`;
      const encrypted = encryptToken(JSON.stringify(result.contacts));
      if (!encrypted) throw new Error("Contact encryption unavailable.");
      await mkdir(dirname(file), { recursive: true });
      await writeFile(temporary, encrypted, { mode: 0o600 });
      await rename(temporary, file);
      return result;
    });
  locks.set(userId, pending);
  try {
    return await pending;
  } finally {
    if (locks.get(userId) === pending) locks.delete(userId);
  }
}
function path(userId: string) {
  return resolve(
    localWorkspaceRoot(),
    ".context/saved-contacts",
    `${createHash("sha256").update(userId).digest("hex")}.json`,
  );
}
