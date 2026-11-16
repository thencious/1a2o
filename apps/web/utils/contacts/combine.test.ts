import { expect, it } from "vitest";
import { combineContactDetails, combinedContactName } from "./combine";
import { mergeContacts, contactValues } from "./merge";
import { localContactAccount } from "./conversation-extraction";
it("keeps every distinct detail, alias and profile when explicitly combining different names and same-app profiles", () => {
  const sources = [
    {
      accountId: "wa",
      contact: {
        id: "one",
        name: "Alex",
        email: "old@example.org",
        details: { Address: ["One"] },
        username: "alex",
      },
    },
    {
      accountId: "wa",
      contact: {
        id: "two",
        name: "Alex Smith",
        email: "work@example.org",
        phoneNumber: "+15555550123",
        profileUrl: "https://example.org/alex",
        details: { Address: ["Two"] },
      },
    },
  ];
  const merged = combineContactDetails(
    sources,
    combinedContactName(sources.map((source) => source.contact.name)),
  );
  merged.id = "combined";
  expect(merged).toMatchObject({
    name: "Alex Smith",
    emails: ["old@example.org", "work@example.org"],
    names: ["Alex", "Alex Smith"],
    details: { Address: ["One", "Two"], Usernames: ["alex"] },
    messagingProfiles: [
      { accountId: "wa", participantId: "one" },
      { accountId: "wa", participantId: "two" },
    ],
  });
  const people = mergeContacts([
    {
      ...localContactAccount(sources.map((source) => source.contact)),
      id: "wa",
      network: "WhatsApp",
    },
    localContactAccount([merged]),
  ]);
  expect(people).toHaveLength(1);
  expect(people[0].name).toBe("Alex Smith");
  expect(contactValues(people[0], "email")).toEqual(
    expect.arrayContaining(["old@example.org", "work@example.org"]),
  );
});
it("prefers a complete human name over a number or handle", () => {
  expect(
    combinedContactName([
      "+15555555555555",
      "@user:example.org",
      "Alex",
      "Alex Smith",
    ]),
  ).toBe("Alex Smith");
});
