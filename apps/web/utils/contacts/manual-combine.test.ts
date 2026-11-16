import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BeeperContact,
  ContactAccount,
} from "@/utils/beeper/contact-types";
import { combineDirectoryContacts } from "./manual-combine";
import { contactValues, mergeContacts } from "./merge";
import { localContactAccount } from "./conversation-extraction";

const state = vi.hoisted(() => ({
  accounts: [] as ContactAccount[],
  saved: [] as BeeperContact[],
}));
vi.mock("server-only", () => ({}));
vi.mock("./directory", () => ({
  contactDirectory: async (userId: string) => ({
    accounts: userId === "owner" ? state.accounts : [],
    updatedAt: "2026-01-01",
  }),
}));
vi.mock("./local-store", () => ({
  updateSavedContacts: async (
    _userId: string,
    update: (
      contacts: BeeperContact[],
    ) => Promise<{ contacts: BeeperContact[] }>,
  ) => {
    const result = await update(state.saved);
    state.saved = result.contacts;
    return result;
  },
}));

describe("manual contact combining", () => {
  beforeEach(() => {
    state.saved = [];
    state.accounts = [
      {
        id: "wa",
        name: "Personal",
        network: "WhatsApp",
        pages: 1,
        fetchedAt: null,
        contacts: [
          {
            id: "a",
            name: "Casey",
            phoneNumber: "+15555550123",
            details: { Address: ["One"] },
          },
          {
            id: "b",
            name: "Casey Chen",
            email: "casey@example.org",
            details: { Address: ["Two"] },
            profileUrl: "https://example.org/casey",
          },
        ],
      },
      {
        id: "li",
        name: "Work",
        network: "LinkedIn",
        pages: 1,
        fetchedAt: null,
        contacts: [{ id: "c", name: "Someone else" }],
      },
    ];
  });
  it("keeps a manual combination intact beside an unselected same-name profile", async () => {
    state.accounts[0].contacts.push({
      id: "different-person",
      name: "Casey Chen",
      email: "different@example.net",
    });
    const keys = mergeContacts(state.accounts)
      .filter((person) =>
        person.profiles.some((profile) =>
          profile.sources.some((source) =>
            ["a", "b"].includes(source.contact.id),
          ),
        ),
      )
      .map((person) => person.key);
    await combineDirectoryContacts("owner", keys);
    const people = mergeContacts([
      ...state.accounts,
      localContactAccount(state.saved),
    ]);
    expect(people).toHaveLength(3);
    const combined = people.find((person) =>
      contactValues(person, "phoneNumber").includes("+15555550123"),
    )!;
    expect(contactValues(combined, "email")).toContain("casey@example.org");
    expect(contactValues(combined, "email")).not.toContain(
      "different@example.net",
    );
  });
  it("persists explicit same-platform combinations without deleting provider data and preserves refreshed profiles", async () => {
    const selected = mergeContacts(state.accounts).filter((person) =>
      person.name.startsWith("Casey"),
    );
    const result = await combineDirectoryContacts(
      "owner",
      selected.map((person) => person.key),
    );
    expect(result.name).toBe("Casey Chen");
    expect(state.accounts[0].contacts).toHaveLength(2);
    state.accounts[0].contacts[0].company = "New company after sync";
    const people = mergeContacts([
      ...state.accounts,
      localContactAccount(state.saved),
    ]);
    expect(people).toHaveLength(2);
    const merged = people.find((person) => person.name === "Casey Chen")!;
    expect(contactValues(merged, "email")).toContain("casey@example.org");
    expect(contactValues(merged, "phoneNumber")).toContain("+15555550123");
    expect(contactValues(merged, "company")).toContain(
      "New company after sync",
    );
    expect(merged.profiles.flatMap((profile) => profile.links)).toContain(
      "https://example.org/casey",
    );
    expect(state.saved[0].details?.Address).toEqual(["One", "Two"]);
    expect(state.saved[0].messagingProfiles).toEqual(
      expect.arrayContaining([
        { accountId: "wa", participantId: "a" },
        { accountId: "wa", participantId: "b" },
      ]),
    );
  });
  it("rejects foreign, stale and repeated selections before saving", async () => {
    const keys = mergeContacts(state.accounts)
      .slice(0, 2)
      .map((person) => person.key);
    await expect(combineDirectoryContacts("other-user", keys)).rejects.toThrow(
      "changed",
    );
    await expect(
      combineDirectoryContacts("owner", [keys[0], "deleted"]),
    ).rejects.toThrow("changed");
    await expect(
      combineDirectoryContacts("owner", [keys[0], keys[0]]),
    ).rejects.toThrow("between 2 and 20");
    expect(state.saved).toEqual([]);
  });
  it("keeps concurrent unique edits and unrelated saved contacts when replacing an existing combination", async () => {
    const first = await combineDirectoryContacts(
      "owner",
      mergeContacts(state.accounts)
        .filter((person) => person.name.startsWith("Casey"))
        .map((person) => person.key),
    );
    state.saved[0].details = {
      ...state.saved[0].details,
      Notes: ["Concurrent saved detail"],
    };
    state.saved.push({
      id: "unrelated",
      name: "Unrelated",
      email: "unrelated@example.org",
    });
    state.accounts.push(localContactAccount(state.saved));
    const keys = mergeContacts(state.accounts)
      .filter((person) => person.name !== "Unrelated")
      .map((person) => person.key);
    const next = await combineDirectoryContacts("owner", keys);
    expect(next.id).toBe(first.id);
    expect(state.saved).toHaveLength(2);
    expect(
      state.saved.find((contact) => contact.id === next.id)?.details?.Notes,
    ).toContain("Concurrent saved detail");
    expect(
      state.saved.find((contact) => contact.id === "unrelated")?.email,
    ).toBe("unrelated@example.org");
  });
});
