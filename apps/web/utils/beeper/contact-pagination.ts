import type { User } from "@beeper/desktop-api/resources/shared";
import type { BeeperContact } from "./contact-types";

export async function collectAccountContacts(
  fetchPage: (cursor?: string) => Promise<{
    items: User[];
    hasMore: boolean;
    oldestCursor: string | null;
  }>,
) {
  const contacts = new Map<string, BeeperContact>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let pages = 0;
  while (true) {
    const page = await fetchPage(cursor);
    pages++;
    for (const item of page.items) {
      if (item.isSelf) continue;
      contacts.set(item.id, {
        id: item.id,
        name:
          item.fullName ||
          item.username ||
          item.phoneNumber ||
          item.email ||
          "Unnamed contact",
        username: item.username,
        phoneNumber: item.phoneNumber,
        email: item.email,
        cannotMessage: item.cannotMessage,
      });
    }
    if (!page.hasMore) break;
    if (!page.oldestCursor || cursors.has(page.oldestCursor))
      throw new Error("Contacts pagination did not advance.");
    cursors.add(page.oldestCursor);
    cursor = page.oldestCursor;
  }
  return {
    contacts: [...contacts.values()].sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    ),
    pages,
  };
}
