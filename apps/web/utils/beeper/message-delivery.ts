import type { ChatMessage } from "./types";

export type OutgoingMessage = {
  requestId: string;
  message: ChatMessage;
  pendingId?: string;
  receiptChatId?: string;
  error?: string;
  attachmentName?: string;
};

export function messageDelivery(message: ChatMessage) {
  if (message.status?.startsWith("FAIL")) return "failed";
  if (message.status === "PENDING") return "pending";
  const seen = message.readReceipts === true ? message.seen : undefined;
  const read =
    typeof seen === "object" && seen !== null
      ? Object.values(seen).some(isReadReceipt)
      : isReadReceipt(seen);
  if (read) return "read";
  return "sent";
}

export function applyReadReceiptPositions<T extends ChatMessage>(
  messages: T[],
): T[] {
  const readThrough = new Map<string, number>();
  for (const message of messages) {
    if (
      !message.readReceipts ||
      message.deleted ||
      message.status === "PENDING" ||
      message.status?.startsWith("FAIL")
    )
      continue;
    // Incoming scalar receipts describe our own read state. Participant maps
    // have already had our own identities removed at the provider boundary.
    const recipientRead = message.outgoing
      ? messageDelivery(message) === "read"
      : typeof message.seen === "object" &&
        message.seen !== null &&
        Object.values(message.seen).some(isReadReceipt);
    const at = Date.parse(message.time);
    if (recipientRead && Number.isFinite(at))
      readThrough.set(
        message.chatId,
        Math.max(
          readThrough.get(message.chatId) ?? Number.NEGATIVE_INFINITY,
          at,
        ),
      );
  }
  return messages.map((message) => {
    const through = readThrough.get(message.chatId);
    if (
      through === undefined ||
      !message.outgoing ||
      message.readReceipts !== true ||
      message.deleted ||
      message.status === "PENDING" ||
      message.status?.startsWith("FAIL") ||
      Date.parse(message.time) > through ||
      !Number.isFinite(Date.parse(message.time))
    )
      return message;
    return { ...message, seen: true };
  });
}

export function mergeMessageOutbox(
  messages: ChatMessage[],
  outbox: OutgoingMessage[],
) {
  const remote = new Map(
    messages.map((message) => [`${message.chatId}:${message.id}`, message]),
  );
  const merged = outbox.map((local) => {
    const actual =
      remote.get(`${local.message.chatId}:${local.message.id}`) ??
      (local.pendingId
        ? remote.get(`${local.message.chatId}:${local.pendingId}`)
        : undefined);
    remote.delete(`${local.message.chatId}:${local.message.id}`);
    if (local.pendingId)
      remote.delete(`${local.message.chatId}:${local.pendingId}`);
    return {
      ...(actual ?? local.message),
      replyToMessageId:
        actual?.replyToMessageId ?? local.message.replyToMessageId,
      replyToPreview: actual?.replyToPreview ?? local.message.replyToPreview,
      renderKey: `outgoing:${local.requestId}`,
      error: actual ? undefined : local.error,
      attachmentName: (actual ?? local.message).attachments.length
        ? undefined
        : local.attachmentName,
    };
  });
  return [...remote.values()]
    .map((message) => ({
      ...message,
      renderKey: `${message.chatId}:${message.id}`,
      error: undefined as string | undefined,
      attachmentName: undefined as string | undefined,
    }))
    .concat(merged)
    .sort(
      (a, b) =>
        Date.parse(a.time) - Date.parse(b.time) ||
        a.renderKey.localeCompare(b.renderKey),
    );
}

function isReadReceipt(value: boolean | string | undefined) {
  return (
    value === true ||
    (typeof value === "string" && Number.isFinite(Date.parse(value)))
  );
}
