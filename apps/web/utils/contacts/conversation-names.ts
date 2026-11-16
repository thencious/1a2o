import type { ContactAccount } from "@/utils/beeper/contact-types";
import type { Account } from "@beeper/desktop-api/resources/accounts/accounts";

/** Names are projections of contact identities, never a rewrite of provider chat IDs. */
export function conversationNameResolver(
  accounts: ContactAccount[],
  accountIdentities: ContactAccount[] = [],
) {
  const names = new Map<string, Set<string>>();
  const verified = new Map<string, Set<string>>();
  const add = (index: Map<string, Set<string>>, key: string, name: string) => {
    const values = index.get(key) ?? new Set<string>();
    values.add(name);
    index.set(key, values);
  };
  for (const [directory, index] of [
    [accounts, names],
    [accountIdentities, verified],
  ] as const)
    for (const account of directory)
      for (const contact of account.contacts) {
        const name = contact.name.trim();
        if (!name || phoneKey(name) || name.includes("@")) continue;
        if (contact.id) add(index, `profile:${account.id}:${contact.id}`, name);
        for (const profile of contact.messagingProfiles ?? [])
          add(
            index,
            `profile:${profile.accountId}:${profile.participantId}`,
            name,
          );
        for (const phone of [
          contact.phoneNumber,
          ...(contact.phoneNumbers ?? []),
        ]) {
          const key = phone && phoneKey(phone);
          if (key) {
            add(index, key, name);
            if (index === verified)
              add(index, `account:${account.id}:${key}`, name);
          }
        }
        for (const email of [contact.email, ...(contact.emails ?? [])])
          if (email) {
            const key = `email:${email.trim().toLowerCase()}`;
            add(index, key, name);
            if (index === verified)
              add(index, `account:${account.id}:${key}`, name);
          }
      }
  return (chat: {
    type: string;
    title: string;
    accountID: string;
    participants?: {
      items: readonly {
        id: string;
        isSelf?: boolean;
        phoneNumber?: string;
        email?: string;
        username?: string;
      }[];
    };
  }) => {
    if (chat.type !== "single") return chat.title;
    const identities = new Set<string>();
    const titlePhone = phoneKey(chat.title);
    if (titlePhone) identities.add(titlePhone);
    if (chat.title.includes("@"))
      identities.add(`email:${chat.title.trim().toLowerCase()}`);
    for (const participant of chat.participants?.items ?? []) {
      if (participant.isSelf) continue;
      identities.add(`profile:${chat.accountID}:${participant.id}`);
      for (const phone of [participant.phoneNumber, participant.username]) {
        const key = phone && phoneKey(phone);
        if (key) identities.add(key);
      }
      if (participant.email)
        identities.add(`email:${participant.email.trim().toLowerCase()}`);
    }
    const accountCandidates = new Set(
      [...identities].flatMap((key) => [
        ...(verified.get(`account:${chat.accountID}:${key}`) ?? []),
      ]),
    );
    if (accountCandidates.size === 1) return [...accountCandidates][0];
    const verifiedCandidates = new Set(
      [...identities].flatMap((key) => [...(verified.get(key) ?? [])]),
    );
    if (verifiedCandidates.size === 1) return [...verifiedCandidates][0];
    const candidates = new Set(
      [...identities].flatMap((key) => [...(names.get(key) ?? [])]),
    );
    return candidates.size === 1 ? [...candidates][0] : chat.title;
  };
}
export function messagingAccountContacts(
  accounts: readonly Pick<Account, "accountID" | "network" | "user">[],
): ContactAccount[] {
  return accounts.flatMap((account) =>
    account.user?.fullName
      ? [
          {
            id: account.accountID,
            name: account.user.fullName,
            network: account.network ?? "Messaging",
            contacts: [
              {
                id: account.user.id,
                name: account.user.fullName,
                phoneNumber: account.user.phoneNumber,
                email: account.user.email,
              },
            ],
            pages: 1,
            fetchedAt: null,
          },
        ]
      : [],
  );
}
export function phoneKey(value: string) {
  if (!/^\+?[\d\s().-]+$/.test(value.trim())) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  return digits.length >= 7 ? `phone:${digits}` : null;
}
