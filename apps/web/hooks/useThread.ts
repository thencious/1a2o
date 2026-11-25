import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";
import { useQuerySnapshot } from "@inboxzero/mail-react/use-query-snapshot";
import type { QuerySnapshot } from "@inboxzero/mail-core/queries";
import type { ConversationView } from "@inboxzero/mail-core/ports/mail-store";
import { useOptionalMailClient } from "@inboxzero/mail-react/MailEngineProvider";
import type { ThreadResponse } from "@/app/api/threads/[id]/route";
import { useAccount } from "@/providers/EmailAccountProvider";
import { EMAIL_ACCOUNT_HEADER } from "@/utils/config";
import {
  readConversationPreview,
  saveConversationPreview,
} from "@/utils/mail-engine/conversation-view-cache";
import {
  CONVERSATION_PAGE_SIZE,
  conversationOutgoingMessages,
  conversationSendOperationIds,
  conversationViewToThreadResponse,
  missingConversationBodyIds,
  requestMissingMessageContent,
} from "@/utils/mail-engine/conversation-thread";

const EMPTY_SNAPSHOT: QuerySnapshot<ConversationView> = {
  status: "loading",
  revision: null,
  data: null,
  refreshing: false,
  error: null,
};

export function useThread(
  {
    id,
    emailAccountId: explicitEmailAccountId,
  }: { id: string | null; emailAccountId?: string },
  options?: {
    includeDrafts?: boolean;
    localMail?: boolean;
    parseReplies?: boolean;
    foreground?: boolean;
  },
) {
  const { emailAccountId: currentEmailAccountId } = useAccount();
  const emailAccountId = explicitEmailAccountId ?? currentEmailAccountId;
  const client = useOptionalMailClient();
  const includeDrafts = options?.includeDrafts;
  const [pagination, setPagination] = useState({
    accountId: emailAccountId,
    id,
    pageSize: CONVERSATION_PAGE_SIZE,
  });
  const pageSize =
    pagination.accountId === emailAccountId && pagination.id === id
      ? pagination.pageSize
      : CONVERSATION_PAGE_SIZE;
  const createHandle = useCallback(() => {
    if (!client || !emailAccountId || !id) {
      return {
        getSnapshot: () => EMPTY_SNAPSHOT,
        subscribe: () => () => undefined,
        close: () => undefined,
      };
    }
    return client.observeConversation(
      { accountId: emailAccountId, conversationId: id },
      { after: null, pageSize },
    );
  }, [client, emailAccountId, id, pageSize]);
  const snapshot = useQuerySnapshot(createHandle);
  const view = useStableConversationView(
    snapshot,
    emailAccountId,
    id,
    pageSize,
  );
  const foregroundKey =
    options?.foreground && id && emailAccountId
      ? JSON.stringify([emailAccountId, id])
      : null;
  const newestMessage = view?.messages.findLast(
    (message) => !message.metadata.roles.includes("draft"),
  );
  const needsBody = Boolean(
    newestMessage && newestMessage.content.status !== "available",
  );
  const needsConversation = Boolean(foregroundKey && !view?.messages.length);
  const [waitingConversation, setWaitingConversation] = useState<string>();
  useEffect(() => {
    if (!needsConversation || !foregroundKey) return;
    // Give the local observation time to publish its cached conversation.
    const timer = setTimeout(() => setWaitingConversation(foregroundKey), 150);
    return () => clearTimeout(timer);
  }, [foregroundKey, needsConversation]);
  const loadForeground =
    foregroundKey &&
    (needsBody || (needsConversation && waitingConversation === foregroundKey));
  const { data: remote, error: remoteError } = useSWR(
    loadForeground
      ? (["foreground-thread", emailAccountId, id!] as const)
      : null,
    readForegroundThread,
    {
      revalidateOnFocus: false,
      shouldRetryOnError: false,
    },
  );
  useEffect(() => {
    if (snapshot.status === "ready" && snapshot.data)
      saveConversationPreview(snapshot.data, pageSize);
  }, [snapshot.status, snapshot.data, pageSize]);
  const requestedContent = useRef({ createHandle, ids: new Set<string>() });

  useEffect(() => {
    if (!client || !view) return;
    // The view can republish several times before bodies arrive; one request
    // per message for each observation is enough.
    if (requestedContent.current.createHandle !== createHandle) {
      requestedContent.current = { createHandle, ids: new Set() };
    }
    requestMissingMessageContent(client, view, requestedContent.current.ids);
  }, [client, createHandle, view]);

  const localData = useMemo<ThreadResponse | undefined>(() => {
    if (!id || !view) return;
    return conversationViewToThreadResponse(view, { includeDrafts });
  }, [id, includeDrafts, view]);
  const missingBodies = useMemo(
    () => (view ? missingConversationBodyIds(view) : new Set<string>()),
    [view],
  );
  const { data, missingBodyIds } = useMemo(() => {
    if (!remote) return { data: localData, missingBodyIds: missingBodies };
    if (!view?.messages.length)
      return { data: remote, missingBodyIds: new Set<string>() };
    if (!localData) return { data: undefined, missingBodyIds: missingBodies };
    const messageId = newestMessage?.key.messageId;
    const body = remote.thread.messages.find((item) => item.id === messageId);
    if (!body || !messageId || !missingBodies.has(messageId))
      return { data: localData, missingBodyIds: missingBodies };
    const remaining = new Set(missingBodies);
    remaining.delete(messageId);
    const messages = localData.thread.messages.map((message) => {
      if (message.id !== messageId) return message;
      return {
        ...message,
        textHtml: body.textHtml,
        textPlain: body.textPlain,
        inline: body.inline,
        attachments: body.attachments,
        isMeetingInvitation: body.isMeetingInvitation,
      };
    });
    return {
      data: { thread: { ...localData.thread, messages } },
      missingBodyIds: remaining,
    };
  }, [
    localData,
    missingBodies,
    newestMessage?.key.messageId,
    remote,
    view?.messages.length,
  ]);

  const mutate = useCallback(async () => {
    if (!client || !emailAccountId) return data;
    await client.requestSync([emailAccountId]);
    if (view) {
      await Promise.all(
        view.messages.map((message) =>
          client.ensureMessageContent(message.key),
        ),
      );
    }
    return data;
  }, [client, data, emailAccountId, view]);

  const awaitingForeground = needsConversation && !remote && !remoteError;
  const isLoading =
    awaitingForeground ||
    (Boolean(id) && !data && snapshot.status !== "error" && !remoteError);
  const errorCode =
    data?.thread.messages.length || awaitingForeground
      ? undefined
      : (snapshot.error?.code ?? (remoteError ? "unavailable" : undefined));
  // Kept referentially stable so a memoized reader only re-renders when the
  // conversation actually changes.
  const error = useMemo(() => conversationQueryError(errorCode), [errorCode]);
  const loadingMore = snapshot.refreshing && pageSize > CONVERSATION_PAGE_SIZE;
  const localAvailability = useMemo(() => {
    if (!data || !view) return;
    return {
      missingBodyIds,
      outgoing: conversationOutgoingMessages(view),
      sendOperationIds: conversationSendOperationIds(view),
      hasMore: Boolean(view.nextPage),
      loadingMore,
      loadMore: () =>
        setPagination({
          accountId: emailAccountId,
          id,
          pageSize: pageSize + CONVERSATION_PAGE_SIZE,
        }),
    };
  }, [data, emailAccountId, id, loadingMore, missingBodyIds, pageSize, view]);

  return {
    data,
    error,
    isLoading,
    isValidating: snapshot.refreshing,
    mutate,
    localAvailability,
  };
}

async function readForegroundThread([, emailAccountId, id]: readonly [
  string,
  string,
  string,
]): Promise<ThreadResponse> {
  const response = await fetch(`/api/threads/${encodeURIComponent(id)}`, {
    headers: { [EMAIL_ACCOUNT_HEADER]: emailAccountId },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("Could not fetch the email.");
  return response.json();
}

function conversationQueryError(
  code: string | undefined,
): { error: string; info: { error: string } } | undefined {
  if (!code) return;
  const message =
    code === "not_found"
      ? "This conversation isn't available yet."
      : "Couldn't open this conversation.";
  return { error: message, info: { error: message } };
}

// Writes elsewhere, such as saving a new draft, can republish this view with
// the same messages. Keeping the previous view spares the open reader a full
// re-render for them.
function useStableConversationView(
  snapshot: QuerySnapshot<ConversationView>,
  accountId: string,
  conversationId: string | null,
  pageSize: number,
) {
  const previous = useRef<{ key: string; view: ConversationView } | null>(null);
  return useMemo(() => {
    const view = snapshot.data;
    if (!view) {
      const cached = previous.current?.view;
      if (
        (snapshot.status === "loading" || snapshot.error?.retryable) &&
        cached?.key.accountId === accountId &&
        cached.key.conversationId === conversationId
      )
        return cached;
      previous.current = null;
      return snapshot.status === "loading" || snapshot.error?.retryable
        ? readConversationPreview(accountId, conversationId, pageSize)
        : null;
    }
    const key = JSON.stringify([
      view.key,
      view.messages,
      view.outgoing,
      view.nextPage,
    ]);
    if (previous.current?.key === key) return previous.current.view;
    previous.current = { key, view };
    return view;
  }, [snapshot, accountId, conversationId, pageSize]);
}
