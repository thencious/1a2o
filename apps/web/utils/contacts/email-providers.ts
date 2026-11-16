import type { people_v1 } from "@googleapis/people";
import type { Contact, Person } from "@microsoft/microsoft-graph-types";
import type { BeeperContact } from "@/utils/beeper/contact-types";

export type ContactLoad = {
  contacts: BeeperContact[];
  pages: number;
  failedSources: string[];
  denied: boolean;
  apiDisabled: boolean;
};

export function refreshedEmailContacts(
  previous: BeeperContact[],
  result: ContactLoad,
) {
  return [
    ...result.contacts,
    ...previous.filter((contact) =>
      result.failedSources.some((prefix) => contact.id.startsWith(prefix)),
    ),
  ];
}

export async function loadGoogleContacts(
  client: people_v1.People,
  mailbox: string,
): Promise<ContactLoad> {
  const saved = async () => {
    const contacts: BeeperContact[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    const seen = new Set<string>();
    do {
      const { data } = await client.people.connections.list(
        {
          resourceName: "people/me",
          pageSize: 1000,
          pageToken,
          personFields:
            "names,emailAddresses,phoneNumbers,organizations,urls,addresses,birthdays,biographies",
        },
        { timeout: 20_000 },
      );
      contacts.push(
        ...(data.connections ?? [])
          .filter((person) => !person.metadata?.deleted)
          .map((person) => googleContact(person, "g:saved:", mailbox)),
      );
      pages++;
      pageToken = data.nextPageToken ?? undefined;
      if (pageToken && seen.has(pageToken))
        throw new Error("Google contacts pagination did not advance.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return { contacts, pages };
  };
  const other = async () => {
    const contacts: BeeperContact[] = [];
    let pageToken: string | undefined;
    let pages = 0;
    const seen = new Set<string>();
    do {
      const { data } = await client.otherContacts.list(
        {
          pageSize: 1000,
          pageToken,
          readMask: "names,emailAddresses,phoneNumbers",
        },
        { timeout: 20_000 },
      );
      contacts.push(
        ...(data.otherContacts ?? [])
          .filter((person) => !person.metadata?.deleted)
          .map((person) => googleContact(person, "g:other:", mailbox)),
      );
      pages++;
      pageToken = data.nextPageToken ?? undefined;
      if (pageToken && seen.has(pageToken))
        throw new Error("Google Other Contacts pagination did not advance.");
      if (pageToken) seen.add(pageToken);
    } while (pageToken);
    return { contacts, pages };
  };
  return collectSources([
    ["g:saved:", saved],
    ["g:other:", other],
  ]);
}

export async function loadOutlookContacts(
  get: (
    path: string,
  ) => Promise<{ value?: unknown[]; "@odata.nextLink"?: string }>,
): Promise<ContactLoad> {
  const pages = async (first: string) => {
    const items: unknown[] = [];
    let path: string | undefined = first,
      count = 0;
    const seen = new Set<string>();
    while (path) {
      const url = new URL(path, "https://graph.microsoft.com");
      if (
        url.origin !== "https://graph.microsoft.com" ||
        (!path.startsWith("/me/") && !url.pathname.startsWith("/v1.0/"))
      )
        throw new Error("Unexpected Graph contacts pagination URL.");
      if (seen.has(path) || count >= 1000)
        throw new Error("Outlook contacts pagination did not finish.");
      seen.add(path);
      const page = await get(path);
      items.push(...(page.value ?? []));
      count++;
      path = page["@odata.nextLink"];
    }
    return { items, pages: count };
  };
  const select =
    "id,displayName,givenName,surname,emailAddresses,businessPhones,homePhones,mobilePhone,companyName,jobTitle,businessHomePage,personalNotes,birthday,homeAddress,businessAddress,otherAddress";
  const saved = async () => {
    const root = await pages(`/me/contacts?$top=200&$select=${select}`);
    const contacts = new Map(
      root.items.map((item) => {
        const contact = outlookContact(item as Contact, "m:saved:");
        return [contact.id, contact];
      }),
    );
    const folders = await pages("/me/contactFolders?$top=100&$select=id");
    const queue = [...folders.items] as { id?: string }[],
      visited = new Set<string>();
    let pageCount = root.pages + folders.pages;
    for (const folder of queue) {
      const id = folder.id;
      if (!id || visited.has(id)) continue;
      if (visited.size >= 1000)
        throw new Error("Too many Outlook contact folders.");
      visited.add(id);
      const path = `/me/contactFolders/${encodeURIComponent(id)}`;
      const data = await pages(`${path}/contacts?$top=200&$select=${select}`);
      for (const item of data.items) {
        const contact = outlookContact(item as Contact, "m:saved:");
        contacts.set(contact.id, contact);
      }
      const children = await pages(`${path}/childFolders?$top=100&$select=id`);
      queue.push(...(children.items as { id?: string }[]));
      pageCount += data.pages + children.pages;
    }
    return { contacts: [...contacts.values()], pages: pageCount };
  };
  const people = async () => {
    const data = await pages(
      "/me/people?$top=200&$select=id,displayName,givenName,surname,scoredEmailAddresses,phones,companyName,jobTitle",
    );
    return {
      contacts: data.items.map((item) => outlookPerson(item as Person)),
      pages: data.pages,
    };
  };
  return collectSources([
    ["m:saved:", saved],
    ["m:people:", people],
  ]);
}

async function collectSources(
  sources: [
    string,
    () => Promise<{ contacts: BeeperContact[]; pages: number }>,
  ][],
): Promise<ContactLoad> {
  const results = await Promise.allSettled(sources.map(([, load]) => load()));
  const result: ContactLoad = {
    contacts: [],
    pages: 0,
    failedSources: [],
    denied: false,
    apiDisabled: false,
  };
  results.forEach((response, index) => {
    if (response.status === "fulfilled") {
      result.contacts.push(...response.value.contacts);
      result.pages += response.value.pages;
    } else {
      result.failedSources.push(sources[index][0]);
      const error = response.reason as {
        code?: unknown;
        statusCode?: number;
        response?: { status?: number; data?: unknown };
      };
      const code = Number(
        error.statusCode ?? error.response?.status ?? error.code,
      );
      result.denied ||= code === 401 || code === 403;
      result.apiDisabled ||= JSON.stringify(
        error.response?.data ?? {},
      ).includes("SERVICE_DISABLED");
    }
  });
  return result;
}
function strings(values: (string | null | undefined)[]) {
  return [
    ...new Set(
      values.filter((value): value is string => Boolean(value?.trim())),
    ),
  ];
}
function googleContact(
  person: people_v1.Schema$Person,
  prefix: string,
  mailbox: string,
): BeeperContact {
  if (!person.resourceName)
    throw new Error("A Google contact has no identity.");
  const names = strings((person.names ?? []).map((name) => name.displayName));
  const emails = strings(
    (person.emailAddresses ?? []).map((email) => email.value),
  );
  const phones = strings(
    (person.phoneNumbers ?? []).map((phone) => phone.value),
  );
  const companies = strings(
      (person.organizations ?? []).map((item) => item.name),
    ),
    positions = strings((person.organizations ?? []).map((item) => item.title));
  return {
    id: prefix + person.resourceName,
    name: names[0] || emails[0] || phones[0] || "Unnamed contact",
    names,
    emails,
    email: emails[0],
    phoneNumbers: phones,
    phoneNumber: phones[0],
    companies,
    company: companies[0],
    positions,
    position: positions[0],
    profileUrl:
      prefix === "g:saved:"
        ? `https://contacts.google.com/person/${encodeURIComponent(person.resourceName.split("/").at(-1)!)}?authuser=${encodeURIComponent(mailbox)}`
        : undefined,
    profileUrls: strings((person.urls ?? []).map((url) => url.value)),
    details: {
      Addresses: strings(
        (person.addresses ?? []).map(
          (address) =>
            address.formattedValue ||
            [
              address.streetAddress,
              address.city,
              address.region,
              address.postalCode,
              address.country,
            ]
              .filter(Boolean)
              .join(", "),
        ),
      ),
      Notes: strings((person.biographies ?? []).map((note) => note.value)),
      Birthdays: strings(
        (person.birthdays ?? []).map(
          (birthday) =>
            birthday.text ||
            (birthday.date ? JSON.stringify(birthday.date) : ""),
        ),
      ),
    },
  };
}
function outlookContact(contact: Contact, prefix: string): BeeperContact {
  if (!contact.id) throw new Error("An Outlook contact has no identity.");
  const names = strings([
    contact.displayName,
    [contact.givenName, contact.surname].filter(Boolean).join(" "),
  ]);
  const emails = strings(
      (contact.emailAddresses ?? []).map((email) => email.address),
    ),
    phones = strings([
      ...(contact.businessPhones ?? []),
      ...(contact.homePhones ?? []),
      contact.mobilePhone,
    ]);
  return {
    id: prefix + contact.id,
    name: names[0] || emails[0] || phones[0] || "Unnamed contact",
    names,
    emails,
    email: emails[0],
    phoneNumbers: phones,
    phoneNumber: phones[0],
    company: contact.companyName ?? undefined,
    position: contact.jobTitle ?? undefined,
    profileUrls: strings([contact.businessHomePage]),
    details: {
      Notes: strings([contact.personalNotes]),
      Birthday: strings([contact.birthday]),
      Addresses: [
        contact.homeAddress,
        contact.businessAddress,
        contact.otherAddress,
      ]
        .filter(Boolean)
        .map((address) =>
          [
            address!.street,
            address!.city,
            address!.state,
            address!.postalCode,
            address!.countryOrRegion,
          ]
            .filter(Boolean)
            .join(", "),
        ),
    },
  };
}
function outlookPerson(person: Person): BeeperContact {
  if (!person.id) throw new Error("An Outlook person has no identity.");
  const names = strings([
    person.displayName,
    [person.givenName, person.surname].filter(Boolean).join(" "),
  ]);
  const emails = strings(
      (person.scoredEmailAddresses ?? []).map((email) => email.address),
    ),
    phones = strings((person.phones ?? []).map((phone) => phone.number));
  return {
    id: `m:people:${person.id}`,
    name: names[0] || emails[0] || phones[0] || "Unnamed contact",
    names,
    emails,
    email: emails[0],
    phoneNumbers: phones,
    phoneNumber: phones[0],
    company: person.companyName ?? undefined,
    position: person.jobTitle ?? undefined,
  };
}
