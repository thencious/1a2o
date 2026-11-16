import { describe, expect, it, vi } from "vitest";
import type { NewsletterStatsResponse } from "@/app/api/user/stats/newsletters/route";
import { loadInboxNewsletters } from "./unified";
import { newsletterKey } from "./identity";
const accounts = [
  { id: "gmail", email: "a@example.com" },
  { id: "outlook", email: "b@example.com" },
];
const row = {
  name: "sender@example.com",
  fromName: "Sender",
  value: 10,
  readEmails: 1,
  inboxEmails: 8,
  lastEmailAt: Date.now(),
  unsubscribeLink: null,
  autoArchived: undefined,
  labelFilters: [],
  status: undefined,
};
const response = (
  newsletters: NewsletterStatsResponse["newsletters"],
): NewsletterStatsResponse => ({
  newsletters,
  nextCursor: null,
  searchedSenderStatus: undefined,
});
describe("unified unsubscribe sender list", () => {
  it("retains all senders beyond 500, including linkless senders, with distinct mailbox identities", async () => {
    const load = vi.fn(async () =>
      response(
        Array.from({ length: 620 }, (_, i) => ({
          ...row,
          name: `sender${i}@example.com`,
        })),
      ),
    );
    const result = await loadInboxNewsletters(accounts, load);
    expect(load.mock.calls).toEqual([["gmail"], ["outlook"]]);
    expect(result.newsletters).toHaveLength(1240);
    expect(new Set(result.newsletters.map(newsletterKey)).size).toBe(1240);
    expect(result.newsletters[620]).toMatchObject({
      emailAccountId: "outlook",
      userEmail: "b@example.com",
      unsubscribeLink: null,
    });
  });
  it("keeps successful inboxes and identifies failed accounts rather than silently showing an incomplete combined view", async () => {
    const result = await loadInboxNewsletters(accounts, async (id) => {
      if (id === "outlook") throw new Error("Provider unavailable");
      return response([row]);
    });
    expect(result.newsletters).toHaveLength(1);
    expect(result.accountErrors).toEqual([
      { id: "outlook", email: "b@example.com" },
    ]);
  });
});
