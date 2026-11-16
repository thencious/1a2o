import "server-only";
import {
  cachedBeeperContacts,
  syncBeeperContacts,
} from "@/utils/beeper/contacts";
import { linkedInContactsStatus } from "@/utils/linkedin/contacts";
import { emailContacts, syncEmailContacts } from "./email-store";
import type { ContactsSnapshot } from "@/utils/beeper/contact-types";
import { savedContacts } from "./local-store";
import { localContactAccount } from "./conversation-extraction";
import { normalizeContactIdentities } from "./identities";

export async function contactDirectory(
  userId: string,
  initializeBeeper = false,
): Promise<ContactsSnapshot> {
  const [beeper, linkedIn, email, saved] = await Promise.all([
    cachedBeeperContacts(userId)
      .then(
        (data) =>
          data ??
          (initializeBeeper
            ? syncBeeperContacts(userId).catch(() => null)
            : null),
      )
      .catch(() => null),
    linkedInContactsStatus(userId),
    initializeBeeper ? syncEmailContacts(userId) : emailContacts(userId),
    savedContacts(userId),
  ]);
  return {
    updatedAt:
      beeper?.updatedAt ?? linkedIn.lastSyncAt ?? new Date().toISOString(),
    accounts: [
      ...(beeper?.accounts ?? []),
      ...(linkedIn.account ? [linkedIn.account] : []),
      ...email,
      ...(saved.length ? [localContactAccount(saved)] : []),
    ].map((account) => ({
      ...account,
      contacts: account.contacts.map(normalizeContactIdentities),
    })),
  };
}
