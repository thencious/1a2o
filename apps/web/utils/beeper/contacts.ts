import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { SafeError } from "@/utils/error";
import {
  assertBeeperOwner,
  beeperDirectory,
  beeperSession,
} from "./connection";
import { collectAccountContacts } from "./contact-pagination";
import type { ContactAccount, ContactsSnapshot } from "./contact-types";

const syncing = new Map<string, Promise<ContactsSnapshot>>();

export async function cachedBeeperContacts(
  userId: string,
): Promise<ContactsSnapshot | null> {
  assertBeeperOwner(userId);
  try {
    const encoded = await readFile(
      resolve(beeperDirectory(), "contacts.json"),
      "utf8",
    );
    if (!encoded.startsWith("v1:")) return null;
    const plain = decryptToken(encoded);
    if (!plain) return null;
    const value = JSON.parse(plain);
    return value.owner === userId ? value.snapshot : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new SafeError(
      "The saved contacts could not be read securely. Refresh contacts to rebuild the cache.",
    );
  }
}

export async function syncBeeperContacts(
  userId: string,
): Promise<ContactsSnapshot> {
  assertBeeperOwner(userId);
  const pending = syncing.get(userId);
  if (pending) return pending;
  const operation = sync(userId).finally(() => syncing.delete(userId));
  syncing.set(userId, operation);
  return operation;
}

async function sync(userId: string): Promise<ContactsSnapshot> {
  const { client } = await beeperSession(userId);
  const previous = await cachedBeeperContacts(userId).catch(() => null);
  let accounts: Awaited<ReturnType<typeof client.accounts.list>>;
  try {
    accounts = await client.accounts.list();
  } catch {
    throw new SafeError(
      "Could not read messaging accounts. Open Beeper and check the connection in Messages settings.",
    );
  }
  const results: ContactAccount[] = [];
  for (const account of accounts) {
    const saved = previous?.accounts.find(
      (item) => item.id === account.accountID,
    );
    const base = {
      id: account.accountID,
      name: account.user.fullName || account.user.username || "Account",
      network: account.network || account.bridge.type,
    };
    try {
      const result = await collectAccountContacts((cursor) =>
        client.accounts.contacts.list(account.accountID, {
          limit: 200,
          direction: "before",
          cursor,
        }),
      );
      results.push({ ...base, ...result, fetchedAt: new Date().toISOString() });
    } catch {
      results.push({
        ...base,
        contacts: saved?.contacts ?? [],
        pages: saved?.pages ?? 0,
        fetchedAt: saved?.fetchedAt ?? null,
        error:
          "Could not finish reading this account's contacts. Any previously saved contacts are shown. Check Beeper, then refresh.",
      });
    }
  }
  const snapshot = { updatedAt: new Date().toISOString(), accounts: results };
  const encrypted = encryptToken(JSON.stringify({ owner: userId, snapshot }));
  if (!encrypted)
    throw new SafeError("Contact-cache encryption is unavailable.");
  await mkdir(beeperDirectory(), { recursive: true });
  const temporary = resolve(beeperDirectory(), `contacts-${randomUUID()}.tmp`);
  await writeFile(temporary, encrypted, { mode: 0o600 });
  await rename(temporary, resolve(beeperDirectory(), "contacts.json"));
  return snapshot;
}
