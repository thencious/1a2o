import { describe, expect, it } from "vitest";
import { collectAccountContacts } from "./contact-pagination";

describe("contact pagination", () => {
  it("reads past 1000 contacts and deduplicates page overlaps", async () => {
    const cursors: Array<string | undefined> = [];
    const result = await collectAccountContacts(async (cursor) => {
      cursors.push(cursor);
      const page = cursor ? Number(cursor) : 0;
      return {
        items: [
          { id: "self", isSelf: true },
          { id: "overlap", fullName: "Shared" },
          ...Array.from({ length: 200 }, (_, index) => ({
            id: `${page}-${index}`,
            fullName: `Person ${page}-${index}`,
          })),
        ],
        hasMore: page < 5,
        oldestCursor: page < 5 ? String(page + 1) : null,
      };
    });
    expect(result.contacts).toHaveLength(1201);
    expect(result.pages).toBe(6);
    expect(cursors).toEqual([undefined, "1", "2", "3", "4", "5"]);
    expect(result.contacts.some((item) => item.id === "self")).toBe(false);
  });
  it("continues past an empty page when more data exists", async () => {
    const result = await collectAccountContacts(async (cursor) =>
      cursor
        ? {
            items: [{ id: "last", phoneNumber: "+15550000000" }],
            hasMore: false,
            oldestCursor: null,
          }
        : { items: [], hasMore: true, oldestCursor: "next" },
    );
    expect(result.contacts).toHaveLength(1);
    expect(result.pages).toBe(2);
  });
  it("reports a broken cursor instead of silently claiming a complete import", async () => {
    await expect(
      collectAccountContacts(async () => ({
        items: [],
        hasMore: true,
        oldestCursor: "stuck",
      })),
    ).rejects.toThrow("did not advance");
    await expect(
      collectAccountContacts(async () => ({
        items: [],
        hasMore: true,
        oldestCursor: null,
      })),
    ).rejects.toThrow("did not advance");
  });
});
