import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import prisma from "@/utils/prisma";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { createScopedLogger } from "@/utils/logger";
import {
  getGmailAndAccessTokenForEmail,
  getOutlookClientForEmail,
} from "@/utils/email-account-client";
import { getContactsClient } from "@/utils/gmail/client";
import type { ContactAccount } from "@/utils/beeper/contact-types";
import {
  loadGoogleContacts,
  loadOutlookContacts,
  refreshedEmailContacts,
  type ContactLoad,
} from "./email-providers";

type Stored = { accounts: ContactAccount[]; nextSyncAt: number };
const locks = new Map<string, Promise<ContactAccount[]>>();
const logger = createScopedLogger("email-contacts");
export async function emailContacts(userId: string): Promise<ContactAccount[]> {
  return (await read(userId))?.accounts ?? [];
}
export function syncEmailContacts(
  userId: string,
  force = false,
): Promise<ContactAccount[]> {
  const existing = locks.get(userId);
  if (existing) return existing;
  const pending = sync(userId, force).finally(() => locks.delete(userId));
  locks.set(userId, pending);
  return pending;
}
async function sync(userId: string, force: boolean) {
  const previous = await read(userId);
  if (!force && previous && previous.nextSyncAt > Date.now())
    return previous.accounts;
  const mailboxes = await prisma.emailAccount.findMany({
    where: { userId },
    select: { id: true, email: true, account: { select: { provider: true } } },
  });
  const accounts: ContactAccount[] = [];
  for (const mailbox of mailboxes) {
    const provider = mailbox.account.provider;
    if (provider !== "google" && provider !== "microsoft") continue;
    const old = previous?.accounts.find(
      (account) => account.emailAccountId === mailbox.id,
    );
    const account: ContactAccount = {
      ...old,
      id: `email:${mailbox.id}`,
      name: mailbox.email,
      network: provider === "google" ? "Gmail" : "Outlook",
      source: "email-contacts",
      emailAccountId: mailbox.id,
      emailProvider: provider,
      contacts: old?.contacts ?? [],
      pages: old?.pages ?? 0,
      fetchedAt: old?.fetchedAt ?? null,
    };
    try {
      let result: ContactLoad;
      if (provider === "google") {
        const { accessToken } = await getGmailAndAccessTokenForEmail({
          emailAccountId: mailbox.id,
          logger,
        });
        result = await loadGoogleContacts(
          getContactsClient({ accessToken }),
          mailbox.email,
        );
      } else {
        const client = await getOutlookClientForEmail({
          emailAccountId: mailbox.id,
          logger,
        });
        result = await loadOutlookContacts((path) =>
          client.getClient().api(path).get(),
        );
      }
      account.contacts = refreshedEmailContacts(old?.contacts ?? [], result);
      account.pages = result.pages;
      account.reconnectRequired = result.denied && !result.apiDisabled;
      account.apiDisabled = result.apiDisabled;
      account.error = result.apiDisabled
        ? "Enable Google People API to import contacts. Saved contacts are retained."
        : result.denied
          ? "Enable contacts access to import this address book. Saved contacts are retained."
          : result.failedSources.length
            ? "Some contact sources could not refresh. Saved contacts are retained; retrying automatically."
            : undefined;
      if (result.contacts.length || !result.failedSources.length)
        account.fetchedAt = new Date().toISOString();
    } catch {
      account.error =
        "Could not access this address book. Enable contacts or retry; saved contacts are retained.";
      account.reconnectRequired = true;
    }
    accounts.push(account);
  }
  const file = path(userId),
    temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(dirname(file), { recursive: true });
  const encrypted = encryptToken(
    JSON.stringify({
      accounts,
      nextSyncAt: Date.now() + 15 * 60_000,
    } satisfies Stored),
  );
  if (!encrypted) throw new Error("Contact encryption unavailable.");
  await writeFile(temporary, encrypted, { mode: 0o600 });
  await rename(temporary, file);
  return accounts;
}
export async function syncDueEmailContacts() {
  const owners = await prisma.emailAccount.findMany({
    distinct: ["userId"],
    select: { userId: true },
  });
  const results = await Promise.allSettled(
    owners.map((owner) => syncEmailContacts(owner.userId)),
  );
  return {
    users: results.length,
    failed: results.filter((result) => result.status === "rejected").length,
  };
}
async function read(userId: string): Promise<Stored | null> {
  try {
    const raw = await readFile(path(userId), "utf8");
    if (!raw.startsWith("v1:"))
      throw new Error("Contacts cache is not encrypted.");
    return JSON.parse(decryptToken(raw) ?? "null");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}
function path(userId: string) {
  const root = localWorkspaceRoot();
  return resolve(
    root,
    ".context/email-contacts",
    `${createHash("sha256").update(userId).digest("hex")}.json`,
  );
}
