import { linkifyPlainText } from "@inboxzero/mail-ui/linkify";
import type { ChatLinkPreview } from "./types";

export function webLinkUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return null;
    return url.href;
  } catch {
    return null;
  }
}

export function messagePreviewLinks(
  text: string,
  supplied: ChatLinkPreview[] = [],
) {
  const links = new Map<string, ChatLinkPreview>();
  for (const preview of supplied) {
    const url = webLinkUrl(preview.url);
    if (url) links.set(url, { ...preview, url });
  }
  // Beeper already associates these cards with their source messages, including
  // shortened and tracking URLs. Mixing in detected URLs duplicates those cards.
  if (links.size) return [...links.values()].slice(0, 3);
  for (const segment of linkifyPlainText(text)) {
    if (segment.type !== "link") continue;
    const url = webLinkUrl(segment.href);
    if (url && !links.has(url)) links.set(url, { url, title: "" });
  }
  return [...links.values()].slice(0, 3);
}
