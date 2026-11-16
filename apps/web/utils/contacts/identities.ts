import type { BeeperContact } from "@/utils/beeper/contact-types";

export function normalizeContactIdentities(
  contact: BeeperContact,
): BeeperContact {
  const profiles = [...(contact.messagingProfiles ?? [])];
  for (const value of contact.details?.["Messaging profiles"] ?? []) {
    try {
      const profile = JSON.parse(value);
      if (
        typeof profile.accountId === "string" &&
        typeof profile.participantId === "string" &&
        !profiles.some(
          (known) =>
            known.accountId === profile.accountId &&
            known.participantId === profile.participantId,
        )
      )
        profiles.push({
          accountId: profile.accountId,
          participantId: profile.participantId,
        });
    } catch {}
  }
  return profiles.length
    ? { ...contact, messagingProfiles: profiles }
    : contact;
}
