import type {
  BeeperContact,
  ContactAccount,
} from "@/utils/beeper/contact-types";
import { phoneKey } from "./conversation-names";
export function combinedContactName(names: string[]) {
  const values = [...new Set(names.map((name) => name.trim()).filter(Boolean))];
  const named = values.filter(
    (name) => !phoneKey(name) && !name.startsWith("@") && !name.includes("@"),
  );
  return (
    (named.length ? named : values).sort(
      (a, b) => b.length - a.length || a.localeCompare(b),
    )[0] || "Contact"
  );
}
export function combineContactDetails(
  sources: { accountId: string; contact: BeeperContact }[],
  name: string,
): BeeperContact {
  const contacts = sources.map((source) => source.contact);
  const details: Record<string, string[]> = {};
  for (const contact of contacts) {
    for (const [key, values] of Object.entries(contact.details ?? {}))
      details[key] = [...new Set([...(details[key] ?? []), ...values])];
    if (contact.username)
      details.Usernames = [
        ...new Set([...(details.Usernames ?? []), contact.username]),
      ];
    if (contact.connectedOn)
      details["Connected on"] = [
        ...new Set([...(details["Connected on"] ?? []), contact.connectedOn]),
      ];
  }
  const result: BeeperContact = {
    id: contacts[0]?.id ?? `combined:${crypto.randomUUID()}`,
    name,
    details,
    names: [
      ...new Set(
        contacts.flatMap((contact) => [contact.name, ...(contact.names ?? [])]),
      ),
    ],
    messagingProfiles: [
      ...new Map(
        sources
          .flatMap((source) => [
            { accountId: source.accountId, participantId: source.contact.id },
            ...(source.contact.messagingProfiles ?? []),
          ])
          .map((profile) => [JSON.stringify(profile), profile]),
      ).values(),
    ],
  };
  for (const [singular, plural] of [
    ["email", "emails"],
    ["phoneNumber", "phoneNumbers"],
    ["company", "companies"],
    ["position", "positions"],
    ["profileUrl", "profileUrls"],
  ] as const) {
    const values = [
      ...new Set(
        contacts.flatMap((contact) => [
          ...(contact[singular] ? [contact[singular]!] : []),
          ...(contact[plural] ?? []),
        ]),
      ),
    ];
    result[plural] = values;
    result[singular] = values[0];
  }
  return result;
}
export function conversationContacts(
  accounts: ContactAccount[],
  people: { id: string; name: string; phoneNumber?: string; email?: string }[],
  accountId: string,
) {
  return accounts.flatMap((account) =>
    account.contacts
      .filter((contact) =>
        people.some(
          (person) =>
            (account.id === accountId && contact.id === person.id) ||
            contact.messagingProfiles?.some(
              (profile) =>
                profile.accountId === accountId &&
                profile.participantId === person.id,
            ) ||
            [contact.phoneNumber, ...(contact.phoneNumbers ?? [])].some(
              (phone) =>
                phone &&
                person.phoneNumber &&
                phoneKey(phone) &&
                phoneKey(phone) === phoneKey(person.phoneNumber),
            ) ||
            [contact.email, ...(contact.emails ?? [])].some(
              (email) =>
                email &&
                person.email &&
                email.toLowerCase() === person.email.toLowerCase(),
            ) ||
            [contact.name, ...(contact.names ?? [])].some(
              (name) =>
                name.trim().toLowerCase() === person.name.trim().toLowerCase(),
            ),
        ),
      )
      .map((contact) => ({ accountId: account.id, contact })),
  );
}
