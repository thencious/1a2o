"use client";

import { useCallback, useState, type SyntheticEvent } from "react";
import Image from "next/image";
import useSWR from "swr";
import { Globe } from "lucide-react";
import { linkifyPlainText } from "@inboxzero/mail-ui/linkify";
import { messagePreviewLinks } from "@/utils/beeper/message-links";
import type { ChatMessage, ChatLinkPreview } from "@/utils/beeper/types";

export function MessageText({ text }: { text: string }) {
  let offset = 0;
  return (
    <p className="whitespace-pre-wrap break-words">
      {linkifyPlainText(text).map((segment) => {
        const key = offset;
        offset += segment.text.length;
        return segment.type === "link" ? (
          <a
            key={key}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sky-300 underline underline-offset-2"
          >
            {segment.text}
          </a>
        ) : (
          segment.text
        );
      })}
    </p>
  );
}

export function MessageLinkCards({ message }: { message: ChatMessage }) {
  const [visible, setVisible] = useState(false);
  const initial = messagePreviewLinks(message.text, message.links);
  const needsMetadata = initial.some(
    (link) => !link.title || (!link.description && !link.image),
  );
  const observe = useCallback((node: HTMLDivElement | null) => {
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const params = new URLSearchParams({
    chatId: message.chatId,
    messageId: message.id,
  });
  const { data } = useSWR<{ previews: ChatLinkPreview[] }>(
    visible &&
      needsMetadata &&
      initial.length &&
      !message.id.startsWith("local:")
      ? [
          "beeper-message-link-previews",
          message.chatId,
          message.id,
          initial.map((link) => link.url).join("\n"),
        ]
      : null,
    async () => {
      const response = await fetch(
        `/api/user/messages/link-preview?${params}`,
        { cache: "no-store" },
      );
      if (!response.ok) throw new Error("Preview unavailable");
      return response.json();
    },
    {
      revalidateOnFocus: false,
      revalidateOnReconnect: false,
      dedupingInterval: 3_600_000,
      shouldRetryOnError: false,
    },
  );
  const previews = data?.previews ?? initial;
  if (!initial.length || message.deleted) return null;
  return (
    <div ref={observe} className="mt-2 space-y-2">
      {previews.map((preview, index) => (
        <a
          key={preview.url}
          href={preview.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Open link preview: ${preview.title || new URL(preview.url).hostname}`}
          className="block w-72 max-w-full overflow-hidden rounded-md border bg-background/40 no-underline"
        >
          {preview.image && !message.id.startsWith("local:") && (
            <Image
              unoptimized
              src={`/api/user/messages/link-preview/image?${params}&index=${index}&v=${encodeURIComponent(preview.image)}`}
              alt=""
              width={288}
              height={160}
              style={{ height: 160 }}
              loading="lazy"
              referrerPolicy="no-referrer"
              className="max-h-44 w-full object-cover"
              onError={(event: SyntheticEvent<HTMLImageElement>) => {
                event.currentTarget.style.display = "none";
              }}
            />
          )}
          <div className="space-y-1 p-2.5">
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
              <Globe className="size-3 shrink-0" />
              <span className="truncate">{new URL(preview.url).hostname}</span>
            </div>
            <p className="line-clamp-2 break-words font-medium text-sm">
              {preview.title || preview.url}
            </p>
            {preview.description && (
              <p className="line-clamp-3 break-words text-xs text-muted-foreground">
                {preview.description}
              </p>
            )}
          </div>
        </a>
      ))}
    </div>
  );
}
