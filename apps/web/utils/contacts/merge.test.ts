import { describe, expect, it } from "vitest";
import type {
  BeeperContact,
  ContactAccount,
} from "@/utils/beeper/contact-types";
import { contactValues, mergeContacts } from "./merge";

const account = (
  network: string,
  contacts: BeeperContact[],
  id = network,
): ContactAccount => ({
  id,
  name: `${network} account`,
  network,
  contacts,
  pages: 1,
  fetchedAt: null,
});
describe("unified contact matching", () => {
  it("rechecks newly added email contacts and preserves all returned values", () => {
    const messaging = account("WhatsApp", [
      { id: "wa", name: "Alice Smith", phoneNumber: "+15553333333" },
    ]);
    expect(mergeContacts([messaging])).toHaveLength(1);
    const people = mergeContacts([
      messaging,
      account("Gmail", [
        {
          id: "g:saved:one",
          name: "Alice Smith",
          email: "first@example.org",
          emails: ["first@example.org", "second@example.org"],
          phoneNumbers: ["+15551111111", "+15552222222"],
        },
      ]),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].profiles).toHaveLength(2);
    expect(contactValues(people[0], "email")).toEqual([
      "first@example.org",
      "second@example.org",
    ]);
    expect(contactValues(people[0], "phoneNumber")).toHaveLength(3);
  });
  it("does not merge different people who share a company website", () => {
    const people = mergeContacts([
      account("Outlook", [
        { id: "one", name: "Alice", profileUrls: ["https://example.org"] },
        { id: "two", name: "Bob", profileUrls: ["https://example.org"] },
      ]),
    ]);
    expect(people).toHaveLength(2);
  });
  it("merges matching names across apps and preserves every original profile and distinct field", () => {
    const input = [
      account("LinkedIn", [
        {
          id: "li",
          name: " Alice  Smith ",
          email: "work@example.org",
          company: "Company A",
          profileUrl: "https://www.linkedin.com/in/alice",
        },
      ]),
      account("WhatsApp", [
        {
          id: "wa",
          name: "alice smith",
          email: "personal@example.org",
          phoneNumber: "+15551234567",
          company: "Company B",
        },
      ]),
    ];
    const before = structuredClone(input),
      people = mergeContacts(input);
    expect(people).toHaveLength(1);
    expect(people[0].profiles).toHaveLength(2);
    expect(contactValues(people[0], "email")).toEqual([
      "work@example.org",
      "personal@example.org",
    ]);
    expect(contactValues(people[0], "company")).toEqual([
      "Company A",
      "Company B",
    ]);
    expect(people[0].profiles.flatMap((profile) => profile.links)).toContain(
      "https://www.linkedin.com/in/alice",
    );
    expect(people[0].profiles.flatMap((profile) => profile.links)).toContain(
      "https://wa.me/15551234567",
    );
    expect(
      people[0].profiles
        .flatMap((profile) => profile.sources)
        .map((source) => source.contact),
    ).toEqual(input.flatMap((account) => account.contacts));
    expect(input).toEqual(before);
  });
  it("never merges two different profiles from the same app, or arbitrarily matches an ambiguous name", () => {
    const linkedIn = account("LinkedIn", [
      { id: "one", name: "Alex Smith" },
      { id: "two", name: "Alex Smith" },
    ]);
    expect(mergeContacts([linkedIn])).toHaveLength(2);
    const ambiguous = mergeContacts([
      linkedIn,
      account("X", [{ id: "x", name: "Alex Smith" }]),
    ]);
    expect(ambiguous).toHaveLength(3);
    expect(ambiguous.every((person) => person.ambiguous)).toBe(true);
  });
  it("combines multiple sources of the exact same app profile without losing their data", () => {
    const people = mergeContacts([
      account(
        "LinkedIn",
        [
          {
            id: "li",
            name: "Alice Smith",
            profileUrl: "https://www.linkedin.com/in/alice",
            position: "Engineer",
          },
        ],
        "direct",
      ),
      account(
        "linkedin",
        [
          {
            id: "beeper-id",
            name: "Alice Smith",
            profileUrl: "https://www.linkedin.com/in/alice",
            email: "alice@example.org",
          },
        ],
        "beeper",
      ),
      account("X", [{ id: "x", name: "Alice Smith", username: "alice" }]),
    ]);
    expect(people).toHaveLength(1);
    expect(people[0].profiles).toHaveLength(2);
    expect(
      people[0].profiles.flatMap((profile) => profile.sources),
    ).toHaveLength(3);
    expect(contactValues(people[0], "position")).toEqual(["Engineer"]);
    expect(contactValues(people[0], "email")).toEqual(["alice@example.org"]);
  });
  it("does not fuzzy-match different names or merge unavailable and unnamed placeholders", () => {
    const input = [
      account("LinkedIn", [
        { id: "1", name: "José Smith" },
        { id: "2", name: "LinkedIn member", profileUnavailable: true },
        { id: "3", name: "Unnamed contact" },
      ]),
      account("X", [
        { id: "4", name: "Jose Smith" },
        { id: "5", name: "LinkedIn member", profileUnavailable: true },
        { id: "6", name: "Unnamed contact" },
      ]),
    ];
    expect(mergeContacts(input)).toHaveLength(6);
  });
  it("normalizes Unicode and whitespace while preserving raw names and ignores unsafe links", () => {
    const people = mergeContacts([
      account("LinkedIn", [
        { id: "one", name: "Ａlice Smith", profileUrl: "javascript:alert(1)" },
      ]),
      account("twitter", [
        { id: "two", name: "Alice\u00a0Smith", username: "alice" },
      ]),
    ]);
    expect(people).toHaveLength(1);
    expect(contactValues(people[0], "name")).toEqual([
      "Ａlice Smith",
      "Alice\u00a0Smith",
    ]);
    expect(people[0].profiles.flatMap((profile) => profile.links)).toEqual([
      "https://x.com/alice",
    ]);
  });
});
