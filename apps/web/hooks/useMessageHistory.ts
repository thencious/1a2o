import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import useSWR from "swr";
import {
  mergeHistoryMessages,
  nextHistoryCursor,
  readRecentMessages,
  type MessageHistory,
} from "@/utils/beeper/message-history";
import type { ChatMessage, MessagePage } from "@/utils/beeper/types";

export function useMessageHistory(
  url: string,
  scope: string,
  read: (url: string, signal: AbortSignal) => Promise<MessagePage>,
) {
  const { data: history, mutate } = useSWR<MessageHistory>(
    ["message-history", url, scope],
    null,
  );
  const latest = useRef(history);
  useLayoutEffect(() => {
    latest.current = history;
  }, [history]);

  const refreshRequest = useRef<AbortController | null>(null);
  const olderRequest = useRef<AbortController | null>(null);
  const [refreshError, setRefreshError] = useState("");
  const [olderError, setOlderError] = useState("");
  const [loadingOlder, setLoadingOlder] = useState(false);
  const readPage = useCallback(
    (signal: AbortSignal, cursor?: string) =>
      read(
        cursor ? `${url}&cursor=${encodeURIComponent(cursor)}` : url,
        signal,
      ),
    [read, url],
  );

  const refresh = useCallback(async () => {
    if (refreshRequest.current) return;
    const request = new AbortController();
    refreshRequest.current = request;
    try {
      const recent = await readRecentMessages(
        (cursor) => readPage(request.signal, cursor),
        latest.current,
      );
      if (request.signal.aborted) return;
      await mutate(
        (current) => ({
          ...recent,
          ...(current && {
            olderCursor: current.olderCursor,
            olderCursors: current.olderCursors,
          }),
          items: mergeHistoryMessages(current?.items ?? [], recent.items),
        }),
        { revalidate: false },
      );
      setRefreshError("");
    } catch (error) {
      if (!request.signal.aborted) setRefreshError(historyError(error));
    } finally {
      if (refreshRequest.current === request) refreshRequest.current = null;
    }
  }, [mutate, readPage]);

  useEffect(() => {
    if (!olderRequest.current) setLoadingOlder(false);
    refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 2500);
    window.addEventListener("focus", refresh);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      refreshRequest.current?.abort();
      olderRequest.current?.abort();
      refreshRequest.current = null;
      olderRequest.current = null;
    };
  }, [refresh]);

  const loadOlder = useCallback(
    async (beforeAppend: () => void) => {
      const current = latest.current;
      const cursor = current?.olderCursor;
      if (!current || !cursor || olderRequest.current) return;
      const request = new AbortController();
      olderRequest.current = request;
      setLoadingOlder(true);
      setOlderError("");
      try {
        const page = await readPage(request.signal, cursor);
        if (request.signal.aborted) return;
        const next = nextHistoryCursor(page, current.olderCursors);
        beforeAppend();
        await mutate(
          (cached) =>
            cached && {
              ...cached,
              items: mergeHistoryMessages(page.items, cached.items),
              olderCursor: next,
              olderCursors: next
                ? [...cached.olderCursors, next]
                : cached.olderCursors,
            },
          { revalidate: false },
        );
      } catch (error) {
        if (!request.signal.aborted) setOlderError(historyError(error));
      } finally {
        if (olderRequest.current === request) {
          olderRequest.current = null;
          setLoadingOlder(false);
        }
      }
    },
    [mutate, readPage],
  );

  const updateMessage = (
    chatId: string,
    messageId: string,
    update: (message: ChatMessage) => ChatMessage,
  ) =>
    mutate(
      (current) =>
        current && {
          ...current,
          items: current.items.map((message) =>
            message.id === messageId && message.chatId === chatId
              ? update(message)
              : message,
          ),
        },
      { revalidate: false },
    );

  return {
    history,
    refresh,
    refreshError,
    loadOlder,
    olderError,
    loadingOlder,
    updateMessage,
  };
}

function historyError(error: unknown) {
  return error instanceof Error ? error.message : "Could not load messages.";
}
