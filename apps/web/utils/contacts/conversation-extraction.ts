import { z } from "zod";
import type {
  BeeperContact,
  ContactAccount,
} from "@/utils/beeper/contact-types";
import { mergeContacts, contactValues } from "./merge";
import type { InviteLine } from "@/utils/messages/invite";
import { phoneKey } from "./conversation-names";
import { normalizeContactIdentities } from "./identities";

type ConversationParticipant = {
  id: string;
  name: string;
  phoneNumber?: string;
  email?: string;
  username?: string;
  self?: boolean;
};

export const contactExtraction = z.object({
  contacts: z
    .array(
      z.object({
        name: z.string().min(1).max(200),
        participant_id: z.string().nullable(),
        facts: z
          .array(
            z.object({
              kind: z.enum([
                "email",
                "phone",
                "company",
                "position",
                "url",
                "address",
                "birthday",
                "username",
                "other",
              ]),
              label: z.string().max(100),
              value: z.string().min(1).max(2000),
              source_message_id: z.string(),
            }),
          )
          .max(50),
      }),
    )
    .max(50),
});
export function contactName(value: string) {
  return value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLowerCase();
}
export function applyContactExtraction(
  accounts: ContactAccount[],
  stored: BeeperContact[],
  extraction: z.infer<typeof contactExtraction>,
  lines: InviteLine[],
  participants: ConversationParticipant[],
  profileContext?: { title: string; type: string; accountId: string },
) {
  const contacts = structuredClone(stored).map(normalizeContactIdentities);
  const changes = new Map<string, "created" | "updated">();
  const warnings: string[] = [];
  const profiles: z.infer<typeof contactExtraction>["contacts"] = [];
  if (profileContext) {
    const others = participants.filter((person) => !person.self);
    const directPhone =
      profileContext.type === "single" && phoneKey(profileContext.title)
        ? profileContext.title
        : undefined;
    const sources = others.map((person) => ({
      ...person,
      phoneNumber:
        person.phoneNumber || (others.length === 1 ? directPhone : undefined),
    }));
    // A direct-chat title is a provider identity even before its peer has replied.
    if (!sources.length && directPhone)
      sources.push({
        id: phoneKey(directPhone)!,
        name: directPhone,
        phoneNumber: directPhone,
      });
    for (const person of sources) {
      const phone =
        person.phoneNumber ||
        [person.name, person.username].find(
          (value) => value && phoneKey(value),
        );
      const name =
        person.name === person.id && phone ? phone : person.name.trim();
      if (
        !name ||
        (!phone && !person.email && !person.username && name === person.id)
      )
        continue;
      profiles.push({
        name,
        participant_id: person.id,
        facts: [
          ...(phone ? [{ kind: "phone" as const, value: phone }] : []),
          ...(person.email
            ? [{ kind: "email" as const, value: person.email }]
            : []),
          ...(person.username
            ? [{ kind: "username" as const, value: person.username }]
            : []),
        ].map((fact) => ({ ...fact, label: "", source_message_id: "" })),
      });
    }
  }
  for (const record of [...extraction.contacts, ...profiles]) {
    const fromProfile = profiles.includes(record);
    const name = record.name.trim(),
      key = contactName(name);
    if (!key || key === "unnamed contact") continue;
    const participant = participants.find(
      (person) => person.id === record.participant_id,
    );
    if (
      !fromProfile &&
      !(participant && contactName(participant.name) === key) &&
      !lines.some((line) => contactName(line.text).includes(key))
    ) {
      warnings.push(`Could not confirm the name ${name}.`);
      continue;
    }
    const people = mergeContacts([
      ...accounts.filter((account) => account.id !== "zenro:contacts"),
      localContactAccount(contacts),
    ]);
    const phones = [
      participant?.phoneNumber,
      ...record.facts
        .filter((fact) => fact.kind === "phone" && fromProfile)
        .map((fact) => fact.value),
    ].filter((value): value is string => Boolean(value));
    const profileIdentity =
      profileContext && record.participant_id
        ? {
            accountId: profileContext.accountId,
            participantId: record.participant_id,
          }
        : undefined;
    const emails = fromProfile
      ? record.facts
          .filter((fact) => fact.kind === "email")
          .map((fact) => contactName(fact.value))
      : [];
    const matchesIdentity = (contact: BeeperContact) =>
      [contact.name, ...(contact.names ?? [])].some(
        (value) => contactName(value) === key,
      ) ||
      [contact.phoneNumber, ...(contact.phoneNumbers ?? [])].some(
        (value) =>
          value &&
          phones.some(
            (phone) => phoneKey(phone) && phoneKey(phone) === phoneKey(value),
          ),
      ) ||
      [contact.email, ...(contact.emails ?? [])].some(
        (value) => value && emails.includes(contactName(value)),
      ) ||
      Boolean(
        profileIdentity &&
          contact.messagingProfiles?.some(
            (profile) =>
              profile.accountId === profileIdentity.accountId &&
              profile.participantId === profileIdentity.participantId,
          ),
      );
    const matches = people.filter((person) =>
      person.profiles.some((profile) =>
        profile.sources.some((source) => matchesIdentity(source.contact)),
      ),
    );
    if (matches.length > 1 || matches[0]?.ambiguous) {
      warnings.push(
        `Multiple contacts match ${name}; no changes were made for that name.`,
      );
      continue;
    }
    const existing = contacts.find(matchesIdentity);
    const contact: BeeperContact = existing ?? {
      id: `name:${key}`,
      name: matches[0] && !phoneKey(matches[0].name) ? matches[0].name : name,
      details: {},
    };
    let changed = false;
    if (
      existing &&
      phoneKey(existing.name) &&
      !phoneKey(name) &&
      !name.startsWith("@")
    ) {
      contact.names = [...new Set([...(contact.names ?? []), contact.name])];
      contact.name = name;
      changed = true;
    }
    if (
      fromProfile &&
      profileIdentity &&
      !contact.messagingProfiles?.some(
        (profile) =>
          profile.accountId === profileIdentity.accountId &&
          profile.participantId === profileIdentity.participantId,
      )
    ) {
      contact.messagingProfiles = [
        ...(contact.messagingProfiles ?? []),
        profileIdentity,
      ];
      changed = true;
    }
    if (
      existing &&
      !phoneKey(name) &&
      contactName(contact.name) !== key &&
      !(contact.names ?? []).some((value) => contactName(value) === key)
    ) {
      contact.names = [...(contact.names ?? []), name];
      changed = true;
    }
    for (const fact of record.facts) {
      const line = lines.find(
        (line) =>
          line.id === fact.source_message_id &&
          contactName(line.text).includes(contactName(fact.value)),
      );
      if (!line && !fromProfile) continue;
      if (fact.kind === "email" && !z.email().safeParse(fact.value).success)
        continue;
      if (fact.kind === "url") {
        try {
          const url = new URL(fact.value);
          if (
            !["https:", "http:"].includes(url.protocol) ||
            url.username ||
            url.password
          )
            continue;
        } catch {
          continue;
        }
      }
      const arrays = {
        email: "emails",
        phone: "phoneNumbers",
        company: "companies",
        position: "positions",
        url: "profileUrls",
      } as const;
      if (fact.kind in arrays) {
        const field = arrays[fact.kind as keyof typeof arrays];
        const singular = {
          emails: "email",
          phoneNumbers: "phoneNumber",
          companies: "company",
          positions: "position",
          profileUrls: "profileUrl",
        } as const;
        const baseline = matches[0]
          ? contactValues(matches[0], singular[field])
          : [];
        const values = [...new Set([...baseline, ...(contact[field] ?? [])])];
        const sameValue = (value: string) =>
          fact.kind === "phone"
            ? Boolean(
                phoneKey(value) && phoneKey(value) === phoneKey(fact.value),
              )
            : contactName(value) === contactName(fact.value);
        if (values.some(sameValue)) {
          const saved = [
            contact[singular[field]],
            ...(contact[field] ?? []),
          ].filter((value): value is string => Boolean(value));
          if (!saved.some(sameValue)) {
            contact[field] = values;
            changed = true;
          }
          continue;
        }
        contact[field] = [...values, fact.value];
        changed = true;
      } else {
        const label =
          fact.kind === "other" ? fact.label.trim() || "Other" : fact.kind;
        const values = contact.details?.[label] ?? [];
        if (values.includes(fact.value)) continue;
        contact.details = {
          ...contact.details,
          [label]: [...values, fact.value],
        };
        changed = true;
      }
    }
    if (
      participant?.phoneNumber &&
      (contactName(participant.name) === key ||
        lines.some(
          (line) =>
            line.senderId === participant.id &&
            contactName(line.text).includes(key),
        ))
    ) {
      const phones = [
        ...new Set([
          ...(matches[0] ? contactValues(matches[0], "phoneNumber") : []),
          ...(contact.phoneNumbers ?? []),
        ]),
      ];
      if (
        !phones.some(
          (value) =>
            phoneKey(value) &&
            phoneKey(value) === phoneKey(participant.phoneNumber!),
        )
      ) {
        contact.phoneNumbers = [...phones, participant.phoneNumber];
        changed = true;
      }
    }
    if (!changed) continue;
    contact.email ??= contact.emails?.[0];
    contact.phoneNumber ??= contact.phoneNumbers?.[0];
    contact.company ??= contact.companies?.[0];
    contact.position ??= contact.positions?.[0];
    if (!existing) contacts.push(contact);
    if (!changes.has(contact.id))
      changes.set(contact.id, matches.length ? "updated" : "created");
  }
  return {
    contacts,
    created: [...changes.values()].filter((value) => value === "created")
      .length,
    updated: [...changes.values()].filter((value) => value === "updated")
      .length,
    warnings,
    profiles: profiles.length,
  };
}
export function localContactAccount(contacts: BeeperContact[]): ContactAccount {
  return {
    id: "zenro:contacts",
    name: "Saved from conversations",
    network: "Contacts",
    source: "conversation-extraction",
    contacts: contacts.map(normalizeContactIdentities),
    pages: 1,
    fetchedAt: null,
  };
}
