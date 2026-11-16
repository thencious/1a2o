import { describe, expect, it, vi } from "vitest";
import { loadCombinedLabels } from "./load-combined-labels";

describe("combined mailbox label isolation", () => {
  it("keeps the other mailbox's successful labels when one provider fails", async () => {
    const labels = await loadCombinedLabels({
      accountIds: ["gmail", "outlook"],
      fetchLabels: async (id) => {
        if (id === "gmail") throw new Error("Reconnect required");
        return {
          labels: [
            { id: "work", name: "Clients", type: "user" },
            { id: "inbox", name: "Inbox", type: "system" },
          ],
        };
      },
    });
    expect(labels.gmail).toEqual({});
    expect(Object.keys(labels.outlook)).toEqual(["work"]);
  });
  it("retains each failed or intentionally skipped mailbox's previous labels", async () => {
    const previous = {
      gmail: { cached: { id: "cached", name: "Cached clients", type: "user" } },
      outlook: { old: { id: "old", name: "Cached categories", type: "user" } },
    };
    const fetchLabels = vi.fn(async (id) => {
      if (id === "gmail") throw new Error("Disconnected");
      return;
    });
    const labels = await loadCombinedLabels({
      accountIds: ["gmail", "outlook"],
      previous,
      fetchLabels,
    });
    expect(labels).toEqual(previous);
  });
  it("lets a successful empty response clear old labels without retaining unrelated mailbox data", async () => {
    const labels = await loadCombinedLabels({
      accountIds: ["gmail"],
      previous: {
        gmail: { old: { id: "old", name: "Removed", type: "user" } },
        outside: {
          other: { id: "other", name: "Other mailbox", type: "user" },
        },
      },
      fetchLabels: async () => ({ labels: [] }),
    });
    expect(labels).toEqual({ gmail: {} });
  });
});
