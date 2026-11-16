import type {
  BeeperContact,
  ContactAccount,
} from "@/utils/beeper/contact-types";
import { networkName } from "@/utils/beeper/network";

export type ContactSource = {
  key: string;
  account: Pick<ContactAccount, "id" | "name" | "network" | "source">;
  contact: BeeperContact;
};
export type ContactProfile = {
  key: string;
  network: string;
  sources: ContactSource[];
  links: string[];
};
export type UnifiedContact = {
  key: string;
  name: string;
  profiles: ContactProfile[];
  ambiguous: boolean;
};

export function mergeContacts(accounts: ContactAccount[]): UnifiedContact[] {
  const sources = accounts.flatMap(({ id, name, network, source, contacts }) =>
    contacts.map((contact) => ({
      key: JSON.stringify([id, contact.id]),
      account: { id, name, network, source },
      contact,
    })),
  );
  const identity = disjointSet(sources.length);
  const seenIdentity = new Map<string, number>();
  sources.forEach((source, index) => {
    const app = contactNetworkKey(source.account.network);
    const keys = [
      ...(source.contact.id
        ? [`id:${JSON.stringify([source.account.id, source.contact.id])}`]
        : []),
      ...contactLinks(source.contact, source.account.network)
        .filter(isIdentityLink)
        .map((link) => `url:${link}`),
      ...[source.contact.email, ...(source.contact.emails ?? [])]
        .filter(Boolean)
        .map(
          (email) =>
            `email:${normalizedContactName(source.contact)}:${email!.trim().toLowerCase()}`,
        ),
    ];
    for (const key of keys) {
      const scoped = JSON.stringify([app, key]);
      const previous = seenIdentity.get(scoped);
      if (previous !== undefined) identity.union(index, previous);
      else seenIdentity.set(scoped, index);
    }
  });
  const identities = new Map<number, ContactSource[]>();
  sources.forEach((source, index) => {
    const root = identity.find(index);
    const group = identities.get(root) ?? [];
    group.push(source);
    identities.set(root, group);
  });
  const profiles: ContactProfile[] = [...identities.values()].map((group) => {
    const sorted = [...group].sort((a, b) => a.key.localeCompare(b.key));
    return {
      key: sorted[0].key,
      network: networkName(sorted[0].account.network),
      sources: sorted,
      links: [
        ...new Set(
          sorted.flatMap((source) =>
            contactLinks(source.contact, source.account.network),
          ),
        ),
      ],
    };
  });
  const names = new Map<string, Set<number>>();
  profiles.forEach((profile, index) => {
    for (const source of profile.sources) {
      for (const name of [
        source.contact.name,
        ...(source.contact.names ?? []),
      ]) {
        const key = normalizedContactName({ ...source.contact, name });
        if (!key) continue;
        const matches = names.get(key) ?? new Set<number>();
        matches.add(index);
        names.set(key, matches);
      }
    }
  });
  const people = disjointSet(profiles.length);
  for (const matches of names.values()) {
    const ids = [...matches];
    if (
      new Set(ids.map((index) => contactNetworkKey(profiles[index].network)))
        .size < 2
    )
      continue;
    for (const index of ids.slice(1)) people.union(ids[0], index);
  }
  const explicit = disjointSet(profiles.length);
  const sourceProfiles = new Map<string, number>();
  profiles.forEach((profile, index) =>
    profile.sources.forEach((source) =>
      sourceProfiles.set(
        JSON.stringify([source.account.id, source.contact.id]),
        index,
      ),
    ),
  );
  profiles.forEach((profile, index) =>
    profile.sources.forEach((source) =>
      source.contact.messagingProfiles?.forEach((link) => {
        const target = sourceProfiles.get(
          JSON.stringify([link.accountId, link.participantId]),
        );
        if (target !== undefined) {
          people.union(index, target);
          explicit.union(index, target);
        }
      }),
    ),
  );
  const profileIndexes = new Map(
    profiles.map((profile, index) => [profile.key, index]),
  );
  const groups = new Map<number, ContactProfile[]>();
  profiles.forEach((profile, index) => {
    const root = people.find(index),
      group = groups.get(root) ?? [];
    group.push(profile);
    groups.set(root, group);
  });
  return [...groups.values()]
    .flatMap((group) => {
      const ambiguous =
        new Set(group.map((profile) => contactNetworkKey(profile.network)))
          .size !== group.length &&
        new Set(
          group.map((profile) =>
            explicit.find(profileIndexes.get(profile.key)!),
          ),
        ).size > 1;
      // A repeated app makes name-only matching ambiguous. Do not choose a person arbitrarily.
      return (ambiguous ? group.map((profile) => [profile]) : [group]).map(
        (profiles) => ({
          key: JSON.stringify(profiles.map((profile) => profile.key).sort()),
          name:
            profiles
              .flatMap((profile) => profile.sources)
              .find(
                (source) =>
                  source.account.source === "conversation-extraction" &&
                  source.contact.messagingProfiles?.length,
              )?.contact.name ?? profiles[0].sources[0].contact.name,
          profiles,
          ambiguous,
        }),
      );
    })
    .sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key));
}

export function contactValues(
  person: Pick<UnifiedContact, "profiles">,
  field: keyof BeeperContact,
): string[] {
  return [
    ...new Set(
      person.profiles
        .flatMap((profile) =>
          profile.sources.flatMap((source) => {
            const arrays: Partial<
              Record<keyof BeeperContact, keyof BeeperContact>
            > = {
              name: "names",
              email: "emails",
              phoneNumber: "phoneNumbers",
              company: "companies",
              position: "positions",
              profileUrl: "profileUrls",
            };
            const additional = arrays[field]
              ? source.contact[arrays[field]!]
              : undefined;
            return [
              ...(Array.isArray(source.contact[field])
                ? (source.contact[field] as string[])
                : [source.contact[field]]),
              ...(Array.isArray(additional) ? additional : []),
            ];
          }),
        )
        .filter(
          (value): value is string =>
            typeof value === "string" && Boolean(value.trim()),
        ),
    ),
  ];
}

export function contactNetworkKey(network: string) {
  const name = networkName(network).normalize("NFKC").trim().toLowerCase();
  for (const app of ["linkedin", "whatsapp", "wechat", "discord"])
    if (name.includes(app)) return app;
  return name;
}

function normalizedContactName(contact: BeeperContact) {
  if (contact.profileUnavailable) return "";
  const name = contact.name
    .normalize("NFKC")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
  return name === "unnamed contact" ? "" : name;
}
function contactLinks(contact: BeeperContact, network: string) {
  const links: string[] = [];
  for (const link of [contact.profileUrl, ...(contact.profileUrls ?? [])]) {
    if (link) {
      try {
        const url = new URL(link);
        if (
          ["https:", "http:"].includes(url.protocol) &&
          !url.username &&
          !url.password
        )
          links.push(url.href);
      } catch {}
    }
  }
  const app = contactNetworkKey(network),
    username = contact.username?.replace(/^@/, "");
  if (app === "linkedin" && username && /^[\p{L}\p{N}_-]+$/u.test(username))
    links.push(`https://www.linkedin.com/in/${encodeURIComponent(username)}`);
  if (app === "x" && username && /^[a-zA-Z0-9_]{1,15}$/.test(username))
    links.push(`https://x.com/${username}`);
  if (app === "discord" && /^\d{15,22}$/.test(contact.id))
    links.push(`https://discord.com/users/${contact.id}`);
  if (
    app === "whatsapp" &&
    contact.phoneNumber &&
    /^\+[1-9]\d{6,14}$/.test(contact.phoneNumber.replace(/[\s()-]/g, ""))
  )
    links.push(`https://wa.me/${contact.phoneNumber.replace(/\D/g, "")}`);
  return [...new Set(links)];
}
function isIdentityLink(link: string) {
  const url = new URL(link);
  return (
    ((url.hostname === "linkedin.com" || url.hostname === "www.linkedin.com") &&
      url.pathname.startsWith("/in/")) ||
    (url.hostname === "contacts.google.com" &&
      url.pathname.startsWith("/person/")) ||
    (url.hostname === "discord.com" && url.pathname.startsWith("/users/")) ||
    url.hostname === "wa.me" ||
    (url.hostname === "x.com" && /^\/[a-zA-Z0-9_]{1,15}\/?$/.test(url.pathname))
  );
}
function disjointSet(size: number) {
  const parents = Array.from({ length: size }, (_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parents[root] !== root) root = parents[root];
    let cursor = index;
    while (parents[cursor] !== cursor) {
      const next = parents[cursor];
      parents[cursor] = root;
      cursor = next;
    }
    return root;
  };
  return {
    find,
    union: (a: number, b: number) => {
      parents[find(b)] = find(a);
    },
  };
}
