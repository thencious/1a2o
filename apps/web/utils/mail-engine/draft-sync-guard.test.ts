import { describe, expect, it } from "vitest";
import {
  beginDraftSync,
  isDraftSyncing,
  subscribeToDraftSync,
} from "./draft-sync-guard";

describe("draft sync guard", () => {
  it("holds a conversation until every overlapping save has published its replacement", async () => {
    const observed: boolean[] = [];
    const unsubscribe = subscribeToDraftSync(() =>
      observed.push(isDraftSyncing("account", "thread")),
    );
    const first = beginDraftSync("account", "thread");
    const second = beginDraftSync("account", "thread");
    expect(isDraftSyncing("account", "thread")).toBe(true);
    expect(isDraftSyncing("other", "thread")).toBe(false);
    expect(isDraftSyncing("account", "other")).toBe(false);
    first();
    expect(isDraftSyncing("account", "thread")).toBe(true);
    first();
    expect(isDraftSyncing("account", "thread")).toBe(true);
    second();
    expect(isDraftSyncing("account", "thread")).toBe(false);
    expect(observed).toEqual([true, false]);
    unsubscribe();
  });

  it("releases the conversation when saving fails", async () => {
    const release = beginDraftSync("failure-account", "thread");
    try {
      await Promise.reject(new Error("Mailbox unavailable"));
    } catch {
      // The caller keeps its local draft and resumes the live mailbox view.
    } finally {
      release();
    }
    expect(isDraftSyncing("failure-account", "thread")).toBe(false);
  });
});
