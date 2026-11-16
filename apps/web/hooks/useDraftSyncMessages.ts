"use client";

import { useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ThreadMessage } from "@/components/email-list/types";
import { GmailLabel } from "@/utils/gmail/label";
import {
  getDraftSessionMessageId,
  getLatestDraftMessageId,
} from "@/utils/mail-engine/reply-drafts";
import {
  isDraftSyncing,
  subscribeToDraftSync,
} from "@/utils/mail-engine/draft-sync-guard";

export function useDraftSyncMessages(
  emailAccountId: string,
  messages: ThreadMessage[],
  selectedThreadId?: string,
) {
  const committed = useRef({ emailAccountId, messages });
  const threadId =
    selectedThreadId ??
    messages[0]?.threadId ??
    committed.current.messages[0]?.threadId ??
    "";
  const syncing = useSyncExternalStore(
    subscribeToDraftSync,
    () => isDraftSyncing(emailAccountId, threadId),
    () => false,
  );
  const previous = committed.current;
  const sameThread =
    previous.emailAccountId === emailAccountId &&
    previous.messages[0]?.threadId === threadId;
  // Gmail can publish the deletion before the save returns the new message ID.
  // requestSync only schedules work. The old draft can disappear after the
  // save returns, before its replacement is observed. Keep that editor until
  // the replacement actually reaches this view, without hiding new replies.
  const pendingDrafts = sameThread
    ? previous.messages.filter((message) => {
        if (!message.labelIds?.includes(GmailLabel.DRAFT)) return false;
        const sessionId = getDraftSessionMessageId(emailAccountId, message.id);
        const latest = getLatestDraftMessageId(emailAccountId, sessionId);
        return (
          latest &&
          latest !== message.id &&
          !messages.some(
            (next) =>
              getDraftSessionMessageId(emailAccountId, next.id) === sessionId,
          )
        );
      })
    : [];
  const shown =
    syncing && sameThread
      ? previous.messages
      : pendingDrafts.length
        ? [...messages, ...pendingDrafts]
        : messages;
  useLayoutEffect(() => {
    if (!syncing || !sameThread)
      committed.current = { emailAccountId, messages: shown };
  }, [emailAccountId, shown, sameThread, syncing]);
  return shown;
}
