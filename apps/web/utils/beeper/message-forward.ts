import type { ChatMessage } from "./types";

const MAX_ATTACHMENT_BYTES = 18_000_000;

export function canForwardMessage(message: ChatMessage) {
  return (
    !message.deleted &&
    !message.id.startsWith("local:") &&
    message.status !== "PENDING" &&
    !message.status?.startsWith("FAIL") &&
    Boolean(message.text.trim() || message.attachments.length)
  );
}

export async function prepareMessageForward(
  message: ChatMessage,
  signal?: AbortSignal,
  fetcher: typeof fetch = fetch,
) {
  signal?.throwIfAborted();
  if (!canForwardMessage(message))
    throw new Error("This message is not available to forward.");
  if (message.text.length > 20_000)
    throw new Error("This message exceeds the 20,000 character limit.");
  const attachments: File[] = [];
  // Prepare all media before enqueueing any send, so a missing file can't be silently omitted.
  for (const attachment of message.attachments) {
    const response = await fetcher(
      `/api/user/messages/asset?${new URLSearchParams({ chatId: message.chatId, messageId: message.id, index: String(attachment.index) })}`,
      { signal, cache: "no-store" },
    );
    if (!response.ok)
      throw new Error(`Could not load attachment: ${attachment.name}`);
    if (Number(response.headers.get("content-length")) > MAX_ATTACHMENT_BYTES) {
      await response.body?.cancel();
      throw new Error("Forwarded attachments must be 18 MB or smaller.");
    }
    const blob = await response.blob();
    if (blob.size > MAX_ATTACHMENT_BYTES)
      throw new Error("Forwarded attachments must be 18 MB or smaller.");
    attachments.push(
      new File([blob], attachment.name.slice(0, 255) || "attachment", {
        type: attachment.mime || blob.type || "application/octet-stream",
      }),
    );
  }
  signal?.throwIfAborted();
  return { text: message.text, attachments };
}
