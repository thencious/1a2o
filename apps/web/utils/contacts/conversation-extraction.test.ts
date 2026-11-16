import { describe, expect, it } from "vitest";
import {
  applyContactExtraction,
  localContactAccount,
  type contactExtraction,
} from "./conversation-extraction";
import { mergeContacts, contactValues } from "./merge";
import type { InviteLine } from "@/utils/messages/invite";
import type { z } from "zod";
const lines: InviteLine[] = [
  {
    id: "m",
    senderId: "alice",
    sender: "Alice",
    text: "My email is new@example.org. Bob Jones: bob@example.org",
    time: "2026-11-09T10:00:00Z",
    outgoing: false,
  },
];
const participants = [{ id: "alice", name: "Alice Smith" }];
const extraction: z.infer<typeof contactExtraction> = {
  contacts: [
    {
      name: "Alice Smith",
      participant_id: "alice",
      facts: [
        {
          kind: "email",
          label: "work",
          value: "new@example.org",
          source_message_id: "m",
        },
      ],
    },
    {
      name: "Bob Jones",
      participant_id: null,
      facts: [
        {
          kind: "email",
          label: "",
          value: "bob@example.org",
          source_message_id: "m",
        },
      ],
    },
  ],
};
describe("conversation contacts", () => {
  it("persists identity fields already known in a provider cache so the saved contact remains usable without that cache", () => {
    const source = {
      ...localContactAccount([
        { id: "peer", name: "+15555550123", phoneNumber: "+15555550123" },
      ]),
      id: "whatsapp",
      network: "WhatsApp",
    };
    const result = applyContactExtraction(
      [source],
      [],
      { contacts: [] },
      [],
      [{ id: "peer", name: "+15555550123", phoneNumber: "+15555550123" }],
      { title: "+15555550123", type: "single", accountId: "whatsapp" },
    );
    expect(result.contacts[0]).toMatchObject({
      phoneNumber: "+15555550123",
      phoneNumbers: ["+15555550123"],
    });
  });
  it("imports a phone-only direct conversation with only an outgoing note, without assigning the local account identity", () => {
    const profile = {
      title: "+1 (555) 555-0199",
      type: "single",
      accountId: "whatsapp",
    };
    const transcript = [
      { ...lines[0], senderId: "me", outgoing: true, text: "Note to self" },
    ];
    const participants = [
      { id: "me", name: "Alex Rivera", email: "owner@example.org", self: true },
    ];
    const result = applyContactExtraction(
      [],
      [],
      { contacts: [] },
      transcript,
      participants,
      profile,
    );
    expect(result).toMatchObject({ created: 1, updated: 0, profiles: 1 });
    expect(result.contacts[0]).toMatchObject({
      name: profile.title,
      phoneNumber: profile.title,
    });
    expect(result.contacts[0].email).toBeUndefined();
    expect(
      applyContactExtraction(
        [],
        result.contacts,
        { contacts: [] },
        transcript,
        participants,
        profile,
      ),
    ).toMatchObject({ created: 0, updated: 0 });
    expect(
      applyContactExtraction(
        [],
        [],
        { contacts: [] },
        transcript,
        participants,
        { ...profile, type: "group" },
      ).contacts,
    ).toEqual([]);
  });
  it("imports provider names, phones and emails without requiring those facts in the transcript", () => {
    const people = [
      {
        id: "peer",
        name: "Alex",
        phoneNumber: "+15555550123",
        email: "alex@example.org",
        username: "alex.123",
      },
    ];
    const result = applyContactExtraction(
      [],
      [],
      { contacts: [] },
      [],
      people,
      { title: "Alex", type: "single", accountId: "messenger" },
    );
    expect(result.contacts[0]).toMatchObject({
      name: "Alex",
      phoneNumber: "+15555550123",
      email: "alex@example.org",
      details: { username: ["alex.123"] },
    });
  });
  it("uses the direct-chat phone for an unresolved peer and preserves its profile identity after the name changes", () => {
    const profile = {
      title: "+15555550123",
      type: "single",
      accountId: "whatsapp",
    };
    const first = applyContactExtraction(
      [],
      [],
      { contacts: [] },
      [],
      [{ id: "@peer:beeper.com", name: "@peer:beeper.com" }],
      profile,
    );
    expect(first.contacts[0]).toMatchObject({
      name: "+15555550123",
      phoneNumber: "+15555550123",
    });
    const next = applyContactExtraction(
      [],
      first.contacts,
      { contacts: [] },
      [],
      [{ id: "@peer:beeper.com", name: "Alex" }],
      { ...profile, title: "Alex" },
    );
    expect(next.contacts).toHaveLength(1);
    expect(next.contacts[0]).toMatchObject({
      name: "Alex",
      phoneNumber: "+15555550123",
    });
  });
  it("updates an existing identity by normalized phone, preserving its name and all unique information", () => {
    const stored = [
      {
        id: "known",
        name: "Alex",
        phoneNumber: "+1 555 555 0123",
        company: "Robotics",
        details: { Other: ["Keep me"] },
      },
    ];
    const result = applyContactExtraction(
      [],
      stored,
      { contacts: [] },
      [],
      [{ id: "peer", name: "+15555550123", phoneNumber: "+15555550123" }],
      { title: "+15555550123", type: "single", accountId: "whatsapp" },
    );
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({
      id: "known",
      name: "Alex",
      company: "Robotics",
      details: { Other: ["Keep me"] },
    });
    expect(result).toMatchObject({ created: 0, updated: 1 });
  });
  it("upgrades a previously saved phone-only identity after a self-introduction instead of creating a duplicate", () => {
    const people = [
      { id: "peer", name: "+15555550123", phoneNumber: "+15555550123" },
    ];
    const profile = { title: "+15555550123", type: "single", accountId: "sms" };
    const first = applyContactExtraction(
      [],
      [],
      { contacts: [] },
      [],
      people,
      profile,
    );
    const result = applyContactExtraction(
      [],
      first.contacts,
      { contacts: [{ name: "Marco", participant_id: "peer", facts: [] }] },
      [{ ...lines[0], senderId: "peer", text: "This is Marco" }],
      people,
      profile,
    );
    expect(result.contacts).toHaveLength(1);
    expect(result.contacts[0]).toMatchObject({
      name: "Marco",
      phoneNumber: "+15555550123",
      names: ["+15555550123"],
    });
    expect(result).toMatchObject({ created: 0, updated: 1 });
  });
  it("keeps a self-introduced first name and links the known sender phone rather than the local account email", () => {
    const transcript = [
      {
        ...lines[0],
        senderId: "sms-person",
        sender: "+15555550123",
        text: "Hey Sam, this is Marco, CEO of Daily’s Robotics",
      },
    ];
    const records = {
      contacts: [
        {
          name: "Marco",
          participant_id: "sms-person",
          facts: [
            {
              kind: "company" as const,
              label: "",
              value: "Daily’s Robotics",
              source_message_id: "m",
            },
            {
              kind: "position" as const,
              label: "",
              value: "CEO",
              source_message_id: "m",
            },
          ],
        },
      ],
    };
    const people = [
      { id: "sms-person", name: "+15555550123", phoneNumber: "+15555550123" },
    ];
    const result = applyContactExtraction([], [], records, transcript, people);
    expect(result.created).toBe(1);
    expect(result.contacts[0]).toMatchObject({
      name: "Marco",
      company: "Daily’s Robotics",
      position: "CEO",
      phoneNumber: "+15555550123",
    });
    expect(
      applyContactExtraction([], result.contacts, records, transcript, people),
    ).toMatchObject({ created: 0, updated: 0 });
  });
  it("adds details to an exact match, creates unmatched people, preserves old fields and is idempotent", () => {
    const original = {
      ...localContactAccount([
        {
          id: "alice",
          name: "Alice Smith",
          email: "old@example.org",
          phoneNumber: "+15551112222",
        },
      ]),
      id: "gmail",
      network: "Gmail",
    };
    const result = applyContactExtraction(
      [original],
      [],
      extraction,
      lines,
      participants,
    );
    expect(result).toMatchObject({ created: 1, updated: 1, warnings: [] });
    const people = mergeContacts([
      original,
      localContactAccount(result.contacts),
    ]);
    expect(people).toHaveLength(2);
    const alice = people.find((person) => person.name === "Alice Smith")!;
    expect(contactValues(alice, "email")).toEqual(
      expect.arrayContaining(["old@example.org", "new@example.org"]),
    );
    expect(contactValues(alice, "phoneNumber")).toEqual(["+15551112222"]);
    expect(
      applyContactExtraction(
        [original],
        result.contacts,
        extraction,
        lines,
        participants,
      ),
    ).toMatchObject({ created: 0, updated: 0 });
  });
  it("rejects unsupported values, absent message IDs and ambiguous same-name contacts", () => {
    const unsupported = structuredClone(extraction);
    unsupported.contacts[0].facts[0].value = "invented@example.org";
    unsupported.contacts[1].facts[0].source_message_id = "missing";
    expect(
      applyContactExtraction([], [], unsupported, lines, participants).contacts,
    ).toEqual([]);
    const duplicate = {
      ...localContactAccount([
        { id: "a", name: "Alice Smith" },
        { id: "b", name: "Alice Smith" },
      ]),
      id: "gmail",
      network: "Gmail",
    };
    const result = applyContactExtraction(
      [duplicate],
      [],
      extraction,
      lines,
      participants,
    );
    expect(result.created).toBe(1);
    expect(result.updated).toBe(0);
    expect(result.warnings).toHaveLength(1);
  });
});
