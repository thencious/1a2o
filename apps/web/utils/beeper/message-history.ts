import type { ChatMessage, MessagePage } from "./types";

export type MessageHistory = {
  items: ChatMessage[];
  allowedReactions?: string[];
  initialScan?: MessagePage["scanned"];
  olderCursor: string | null;
  olderCursors: string[];
};

export function nextHistoryCursor(
  page: MessagePage,
  visited: readonly string[],
) {
  if (!page.hasMore) return null;
  if (!page.cursor || visited.includes(page.cursor))
    throw new Error("Conversation history did not advance. Try again.");
  return page.cursor;
}

export function mergeHistoryMessages(
  existing: ChatMessage[],
  updates: ChatMessage[],
) {
  const messages = new Map(
    existing.map((message) => [messageKey(message), message]),
  );
  for (const message of updates) messages.set(messageKey(message), message);
  return [...messages.values()];
}

export async function readRecentMessages(
  readPage: (cursor?: string) => Promise<MessagePage>,
  previous?: MessageHistory,
) {
  const first = await readPage();
  if (!previous) {
    const olderCursor = nextHistoryCursor(first, []);
    return {
      ...first,
      olderCursor,
      olderCursors: olderCursor ? [olderCursor] : [],
      initialScan: first.scanned,
    };
  }

  const anchors = new Map<string, { id?: string; time: number }>();
  for (const slice of previous.initialScan ?? []) {
    anchors.set(slice.chatId, {
      time: slice.oldestTime
        ? Date.parse(slice.oldestTime)
        : Number.NEGATIVE_INFINITY,
    });
  }
  for (const message of previous.items) {
    const time = Date.parse(message.time);
    const anchor = anchors.get(message.chatId);
    if (!anchor?.id || time >= anchor.time)
      anchors.set(message.chatId, { id: message.id, time });
  }

  // A match in one source cannot close a gap in another source of a combined chat.
  const pages = [first];
  const cursors: string[] = [];
  let page = first;
  while (anchors.size) {
    for (const item of page.items) {
      const anchor = anchors.get(item.chatId);
      if (
        anchor &&
        (item.id === anchor.id || Date.parse(item.time) < anchor.time)
      )
        anchors.delete(item.chatId);
    }
    for (const slice of page.scanned ?? []) {
      const anchor = anchors.get(slice.chatId);
      if (
        anchor &&
        (!slice.hasMore ||
          (slice.oldestTime && Date.parse(slice.oldestTime) < anchor.time))
      )
        anchors.delete(slice.chatId);
    }
    if (!anchors.size) break;
    const next = nextHistoryCursor(page, cursors);
    if (!next) break;
    cursors.push(next);
    page = await readPage(next);
    pages.push(page);
  }
  return {
    allowedReactions: first.allowedReactions,
    items: pages.reverse().flatMap((entry) => entry.items),
    initialScan: previous.initialScan,
    olderCursor: previous.olderCursor,
    olderCursors: previous.olderCursors,
  };
}

function messageKey(message: ChatMessage) {
  return JSON.stringify([message.chatId, message.id]);
}
