"use client";

import useSWR, { useSWRConfig } from "swr";
import { sendBeeperMessageAction } from "@/utils/actions/beeper";
import { getActionErrorMessage } from "@/utils/error";
import {
  messageDelivery,
  type OutgoingMessage,
} from "@/utils/beeper/message-delivery";
import type { ChatMessage } from "@/utils/beeper/types";
import type { MessageMention } from "@/utils/beeper/mentions";

const queues = new Map<string, Promise<void>>();

export function useMessageOutbox(chatId: string, onSubmitted: () => void) {
  const { mutate } = useSWRConfig();
  const key = ["beeper-message-outbox", chatId];
  const { data: outbox = [] } = useSWR<OutgoingMessage[]>(key, null, {
    fallbackData: [],
  });
  const update = (change: (entries: OutgoingMessage[]) => OutgoingMessage[]) =>
    mutate<OutgoingMessage[]>(key, (entries) => change(entries ?? []), {
      revalidate: false,
    });
  const pending = outbox.filter(
    (entry) => entry.pendingId && messageDelivery(entry.message) === "pending",
  );
  useSWR(
    pending.length
      ? [
          "beeper-message-receipts",
          chatId,
          JSON.stringify(
            pending.map((entry) => [
              entry.requestId,
              entry.pendingId,
              entry.receiptChatId,
            ]),
          ),
        ]
      : null,
    async () =>
      Promise.all(
        pending.map(async (entry) => {
          try {
            const response = await fetch(
              `/api/user/messages/receipt?${new URLSearchParams({ chatId: entry.receiptChatId ?? chatId, pendingId: entry.pendingId! })}`,
              { cache: "no-store", signal: AbortSignal.timeout(10_000) },
            );
            if (!response.ok) return null;
            return {
              requestId: entry.requestId,
              message: (await response.json()) as ChatMessage,
            };
          } catch {
            return null;
          }
        }),
      ),
    {
      refreshInterval: 2500,
      onSuccess: (receipts) => {
        const resolved = new Map(
          receipts
            .filter((receipt) => receipt !== null)
            .map((receipt) => [receipt.requestId, receipt.message]),
        );
        if (resolved.size)
          update((entries) =>
            entries.map((entry) => {
              const message = resolved.get(entry.requestId);
              return message ? { ...entry, message, error: undefined } : entry;
            }),
          );
      },
    },
  );

  const submit = (
    text: string,
    attachment: File | null,
    replyTo?: Pick<ChatMessage, "id" | "sender" | "text"> | null,
    mentions?: MessageMention[],
  ) => {
    const requestId = crypto.randomUUID();
    const message: ChatMessage = {
      id: `local:${requestId}`,
      chatId,
      sender: "You",
      text,
      replyToMessageId: replyTo?.id,
      replyToPreview: replyTo
        ? { sender: replyTo.sender, text: replyTo.text.slice(0, 500) }
        : undefined,
      time: new Date().toISOString(),
      outgoing: true,
      deleted: false,
      status: "PENDING",
      attachments: [],
    };
    // The bubble is committed before file encoding or any network request.
    update((entries) => [
      ...entries,
      { requestId, message, attachmentName: attachment?.name },
    ]);
    const task = (queues.get(chatId) ?? Promise.resolve()).then(async () => {
      try {
        const file = attachment
          ? {
              name: attachment.name,
              mime: attachment.type,
              content: await fileBase64(attachment),
            }
          : undefined;
        const result = await sendBeeperMessageAction({
          chatId,
          requestId,
          text,
          replyToMessageId: replyTo?.id,
          attachment: file,
          ...(mentions?.length ? { mentions } : {}),
        });
        if (!result?.data || result.serverError || result.validationErrors)
          throw new Error(getActionErrorMessage(result ?? {}));
        await update((entries) =>
          entries.map((entry) =>
            entry.requestId === requestId
              ? {
                  ...entry,
                  pendingId: result.data!.pendingMessageID,
                  receiptChatId: result.data!.chatID,
                }
              : entry,
          ),
        );
      } catch (error) {
        await update((entries) =>
          entries.map((entry) =>
            entry.requestId === requestId
              ? {
                  ...entry,
                  error:
                    error instanceof Error
                      ? error.message
                      : "Delivery could not be confirmed.",
                }
              : entry,
          ),
        );
        return;
      }
      onSubmitted();
    });
    // A failed submission must not block the following messages or retry itself.
    const settled = task.catch(() => {});
    queues.set(chatId, settled);
    settled.finally(() => {
      if (queues.get(chatId) === settled) queues.delete(chatId);
    });
  };
  return { outbox, submit };
}

function fileBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = () => reject(new Error("Could not read this attachment."));
    reader.readAsDataURL(file);
  });
}
