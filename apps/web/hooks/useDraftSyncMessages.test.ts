// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ThreadMessage } from "@/components/email-list/types";
import { beginDraftSync } from "@/utils/mail-engine/draft-sync-guard";
import { useDraftSyncMessages } from "./useDraftSyncMessages";
import { rememberReplacedDraftMessage } from "@/utils/mail-engine/reply-drafts";
import { GmailLabel } from "@/utils/gmail/label";

describe("useDraftSyncMessages", () => {
  it("does not duplicate an editor when an intermediate save arrives before the newest one", () => {
    const original = {
      id: "overlap-old",
      threadId: "overlap",
      labelIds: [GmailLabel.DRAFT],
    } as ThreadMessage;
    const intermediate = { ...original, id: "overlap-middle" };
    const newest = { ...original, id: "overlap-newest" };
    const view = renderHook(
      ({ messages }) => useDraftSyncMessages("account", messages, "overlap"),
      { initialProps: { messages: [original] } },
    );
    rememberReplacedDraftMessage("account", original.id, intermediate.id);
    rememberReplacedDraftMessage("account", intermediate.id, newest.id);
    view.rerender({ messages: [] });
    expect(view.result.current).toEqual([original]);
    view.rerender({ messages: [intermediate] });
    expect(view.result.current).toEqual([intermediate]);
    view.rerender({ messages: [newest] });
    expect(view.result.current).toEqual([newest]);
    view.unmount();
  });
  it("keeps an edited mailbox draft when sync arrives after the save returns", () => {
    const parent = { id: "parent", threadId: "late-sync" } as ThreadMessage;
    const original = {
      id: "late-old",
      threadId: "late-sync",
      labelIds: [GmailLabel.DRAFT],
    } as ThreadMessage;
    const replacement = { ...original, id: "late-new" };
    const view = renderHook(
      ({ messages }) => useDraftSyncMessages("account", messages, "late-sync"),
      {
        initialProps: { messages: [parent, original] },
      },
    );
    let release!: () => void;
    act(() => {
      release = beginDraftSync("account", "late-sync");
    });
    rememberReplacedDraftMessage("account", original.id, replacement.id);
    act(() => release());
    // requestSync schedules work; its deletion and replacement arrive later.
    view.rerender({ messages: [parent] });
    expect(view.result.current).toEqual([parent, original]);
    view.rerender({ messages: [parent, replacement] });
    expect(view.result.current).toEqual([parent, replacement]);
    view.rerender({ messages: [parent] });
    expect(view.result.current).toEqual([parent]);
    view.unmount();
  });
  it("keeps a draft-only conversation through a deletion gap and publishes the latest replacement after saving", () => {
    const original = [{ id: "old", threadId: "draft-only" }] as ThreadMessage[];
    const replacement = [
      { id: "new", threadId: "draft-only" },
    ] as ThreadMessage[];
    const view = renderHook(
      ({ messages }) => useDraftSyncMessages("account", messages),
      { initialProps: { messages: original } },
    );
    let release!: () => void;
    act(() => {
      release = beginDraftSync("account", "draft-only");
    });
    view.rerender({ messages: [] });
    expect(view.result.current).toBe(original);
    view.rerender({ messages: replacement });
    expect(view.result.current).toBe(original);
    act(() => release());
    expect(view.result.current).toBe(replacement);
    view.unmount();
  });

  it("never retains another mailbox or a conversation the user navigated away from", () => {
    const original = [{ id: "old", threadId: "selected" }] as ThreadMessage[];
    const view = renderHook(
      ({ account, messages, selected }) =>
        useDraftSyncMessages(account, messages, selected),
      {
        initialProps: {
          account: "account",
          messages: original,
          selected: "selected",
        },
      },
    );
    let release!: () => void;
    act(() => {
      release = beginDraftSync("account", "selected");
    });
    view.rerender({
      account: "account",
      messages: [],
      selected: "another-thread",
    });
    expect(view.result.current).toEqual([]);
    view.rerender({
      account: "another-account",
      messages: [],
      selected: "selected",
    });
    expect(view.result.current).toEqual([]);
    act(() => release());
    view.unmount();
  });
});
