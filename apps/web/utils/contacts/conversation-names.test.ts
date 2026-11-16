import { expect, it } from "vitest";
import {
  conversationNameResolver,
  messagingAccountContacts,
} from "./conversation-names";
import { localContactAccount } from "./conversation-extraction";
const chat = {
  type: "single",
  title: "(555) 555-0123",
  accountID: "sms",
  participants: {
    items: [
      { id: "remote", phoneNumber: "+15555550123" },
      { id: "self", isSelf: true, phoneNumber: "+15555559999" },
    ],
  },
};
it("derives names from the contact directory for existing conversations and reflects later edits", () => {
  const contacts = [
    { id: "marco", name: "Marco", phoneNumber: "+15555550123" },
  ];
  expect(conversationNameResolver([localContactAccount(contacts)])(chat)).toBe(
    "Marco",
  );
  contacts[0].name = "Marco Rossi";
  expect(conversationNameResolver([localContactAccount(contacts)])(chat)).toBe(
    "Marco Rossi",
  );
  expect(conversationNameResolver([])(chat)).toBe(chat.title);
});
it("does not rename groups, use the local user's identity or guess conflicting identities", () => {
  const accounts = [
    localContactAccount([
      { id: "a", name: "Marco", phoneNumber: "+15555550123" },
      { id: "b", name: "Different person", phoneNumber: "+15555550123" },
      { id: "c", name: "Owner", phoneNumber: "+15555559999" },
    ]),
  ];
  expect(conversationNameResolver(accounts)(chat)).toBe(chat.title);
  expect(conversationNameResolver(accounts)({ ...chat, type: "group" })).toBe(
    chat.title,
  );
  expect(
    conversationNameResolver([
      localContactAccount([
        { id: "c", name: "Owner", phoneNumber: "+15555559999" },
      ]),
    ])({
      ...chat,
      title: "Unknown",
      participants: { items: [chat.participants.items[1]] },
    }),
  ).toBe("Unknown");
});
it("resolves account-scoped participant identities without a phone number", () => {
  const account = {
    ...localContactAccount([{ id: "remote", name: "Marco" }]),
    id: "sms",
  };
  expect(conversationNameResolver([account])(chat)).toBe("Marco");
  expect(
    conversationNameResolver([{ ...account, id: "different" }])(chat),
  ).toBe(chat.title);
});
it("resolves persisted platform profile links even when the provider supplies no phone number", () => {
  const saved = localContactAccount([
    {
      id: "name:alex",
      name: "Alex",
      details: {
        "Messaging profiles": [
          JSON.stringify({ accountId: "sms", participantId: "remote" }),
          "invalid legacy data",
        ],
      },
    },
  ]);
  expect(
    conversationNameResolver([saved])({
      ...chat,
      title: "Unknown",
      participants: { items: [{ id: "remote" }] },
    }),
  ).toBe("Alex");
  expect(
    conversationNameResolver([saved])({
      ...chat,
      accountID: "different",
      title: "Unknown",
      participants: { items: [{ id: "remote" }] },
    }),
  ).toBe("Unknown");
});
it("recognizes note-to-self by the account's exact phone identity across platforms without assigning the account name to other peers", () => {
  const own = messagingAccountContacts([
    {
      accountID: "sms",
      network: "SMS",
      user: {
        id: "sms-owner",
        fullName: "Account Owner",
        phoneNumber: "+15555550123",
      },
    },
    {
      accountID: "whatsapp",
      network: "WhatsApp",
      user: {
        id: "15555550123",
        fullName: "Account Owner (WhatsApp)",
        phoneNumber: "+15555550123",
      },
    },
  ]);
  const resolve = conversationNameResolver(
    [
      localContactAccount([
        { id: "stale", name: "Old owner alias", phoneNumber: "+15555550123" },
      ]),
    ],
    own,
  );
  expect(resolve(chat)).toBe("Account Owner");
  expect(resolve({ ...chat, type: "group" })).toBe(chat.title);
  expect(
    resolve({
      ...chat,
      title: "+15555558888",
      participants: {
        items: [
          { id: "peer", phoneNumber: "+15555558888" },
          { id: "self", isSelf: true, phoneNumber: "+15555550123" },
        ],
      },
    }),
  ).toBe("+15555558888");
});
