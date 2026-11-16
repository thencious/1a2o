import "server-only";
import { randomUUID } from "node:crypto";
import type { BeeperContact } from "@/utils/beeper/contact-types";
import { updateSavedContacts } from "./local-store";
import { combineContactDetails } from "./combine";

export async function saveCombinedContacts(
  userId: string,
  sources: { accountId: string; contact: BeeperContact }[],
  name: string,
) {
  return updateSavedContacts(userId, async (stored) => {
    const localIds = new Set(
      sources
        .filter((source) => source.accountId === "zenro:contacts")
        .map((source) => source.contact.id),
    );
    const current = stored.filter((contact) => localIds.has(contact.id));
    const merged = combineContactDetails(
      [
        ...sources,
        ...current.map((contact) => ({ accountId: "zenro:contacts", contact })),
      ],
      name,
    );
    merged.id = current[0]?.id ?? `combined:${randomUUID()}`;
    return {
      contacts: [
        ...stored.filter((contact) => !localIds.has(contact.id)),
        merged,
      ],
      contact: merged,
    };
  });
}
