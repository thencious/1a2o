import type { Conversation } from "./types";

export const messageDraftPrefix = "inbox-zero-message-draft:";
const updatedPrefix = "inbox-zero-message-draft-updated:";
export const messageDraftEvent = "1a2o-message-drafts-changed";
export type MessageDraft = { text: string; updatedAt: number };

export function readMessageDrafts(
  storage: Storage,
): Record<string, MessageDraft> {
  const result: Record<string, MessageDraft> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (!key?.startsWith(messageDraftPrefix)) continue;
    const id = key.slice(messageDraftPrefix.length);
    const text = storage.getItem(key) || "";
    if (!text.trim()) continue;
    const at = Number(storage.getItem(updatedPrefix + id));
    result[id] = { text, updatedAt: Number.isFinite(at) && at > 0 ? at : 0 };
  }
  return result;
}

export function saveMessageDraft(
  storage: Storage,
  id: string,
  text: string,
  now = Date.now(),
) {
  const key = messageDraftPrefix + id;
  if ((storage.getItem(key) || "") === text) return false;
  if (text) {
    storage.setItem(key, text);
    storage.setItem(updatedPrefix + id, String(now));
  } else {
    storage.removeItem(key);
    storage.removeItem(updatedPrefix + id);
  }
  return true;
}

export function conversationsWithDrafts(
  items: Conversation[],
  drafts: Record<string, MessageDraft>,
) {
  return items
    .map((item) => {
      const draft = drafts[item.id];
      const messageTime = Date.parse(item.time) || 0;
      return {
        ...item,
        draft,
        preview: draft?.text.replace(/\s+/g, " ").trim() || item.preview,
        time:
          draft && draft.updatedAt > messageTime
            ? new Date(draft.updatedAt).toISOString()
            : item.time,
      };
    })
    .sort(
      (a, b) =>
        (Date.parse(b.time) || 0) - (Date.parse(a.time) || 0) ||
        a.id.localeCompare(b.id),
    );
}
