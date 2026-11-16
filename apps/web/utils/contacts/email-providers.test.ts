import type { people_v1 } from "@googleapis/people";
import { describe, expect, it } from "vitest";
import {
  loadGoogleContacts,
  loadOutlookContacts,
  refreshedEmailContacts,
} from "./email-providers";

describe("email address books", () => {
  it("reads every Google page, other contacts and all values", async () => {
    const saved = async (params: { pageToken?: string }) => {
      if (params.pageToken)
        return {
          data: {
            connections: [
              { resourceName: "people/last", names: [{ displayName: "Last" }] },
            ],
          },
        };
      return {
        data: {
          connections: Array.from({ length: 1000 }, (_, index) => ({
            resourceName: `people/${index}`,
            names: [{ displayName: `Person ${index}` }],
            emailAddresses: [
              { value: "a@example.org" },
              { value: "b@example.org" },
            ],
            phoneNumbers: [
              { value: "+15551111111" },
              { value: "+15552222222" },
            ],
          })),
          nextPageToken: "second",
        },
      };
    };
    const other = async () => ({
      data: {
        otherContacts: [
          {
            resourceName: "otherContacts/one",
            emailAddresses: [{ value: "other@example.org" }],
          },
        ],
      },
    });
    const client = {
      people: { connections: { list: saved } },
      otherContacts: { list: other },
    } as unknown as people_v1.People;
    const result = await loadGoogleContacts(client, "owner@example.org");
    expect(result.contacts).toHaveLength(1002);
    expect(result.pages).toBe(3);
    expect(result.contacts[0].emails).toEqual([
      "a@example.org",
      "b@example.org",
    ]);
    expect(result.contacts[0].phoneNumbers).toHaveLength(2);
    expect(result.failedSources).toEqual([]);
  });
  it("retains successful sources when another scope is denied", async () => {
    const result = await loadOutlookContacts(async (path) => {
      if (path.startsWith("/me/people"))
        throw Object.assign(new Error("Denied"), { statusCode: 403 });
      if (path.startsWith("/me/contacts"))
        return {
          value: [
            {
              id: "saved",
              displayName: "Alice",
              emailAddresses: [{ address: "alice@example.org" }],
            },
          ],
        };
      return { value: [] };
    });
    expect(result.contacts[0].email).toBe("alice@example.org");
    expect(result.failedSources).toEqual(["m:people:"]);
    expect(result.denied).toBe(true);
    const contacts = refreshedEmailContacts(
      [
        { id: "m:people:cached", name: "Cached" },
        { id: "m:saved:removed", name: "Removed" },
      ],
      result,
    );
    expect(contacts.map((contact) => contact.name)).toEqual([
      "Alice",
      "Cached",
    ]);
  });
  it("reads nested Outlook folders and paginated contacts", async () => {
    const result = await loadOutlookContacts(async (path) => {
      if (path.startsWith("/me/contactFolders?"))
        return { value: [{ id: "folder" }] };
      if (path.includes("/folder/childFolders"))
        return { value: [{ id: "child" }] };
      if (path.includes("/child/contacts"))
        return {
          value: [{ id: "nested", displayName: "Nested" }],
          "@odata.nextLink":
            "https://graph.microsoft.com/v1.0/me/contacts?$skiptoken=next",
        };
      if (path.startsWith("https://"))
        return { value: [{ id: "next", displayName: "Next" }] };
      return { value: [] };
    });
    expect(result.contacts.map((contact) => contact.name)).toEqual([
      "Nested",
      "Next",
    ]);
    expect(result.failedSources).toEqual([]);
  });
});
