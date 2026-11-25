"use client";
import { useSyncExternalStore } from "react";
import {
  readMessageDrafts,
  messageDraftEvent,
  messageDraftPrefix,
  type MessageDraft,
} from "@/utils/beeper/message-drafts";
const empty: Record<string, MessageDraft> = {};
let snapshot = empty;
let serialized = "{}";
function getSnapshot() {
  try {
    const next = readMessageDrafts(localStorage);
    const value = JSON.stringify(next);
    if (value !== serialized) {
      serialized = value;
      snapshot = next;
    }
  } catch {}
  return snapshot;
}
function subscribe(changed: () => void) {
  const storageChanged = (event: StorageEvent) => {
    if (
      !event.key ||
      event.key.startsWith(messageDraftPrefix) ||
      event.key.startsWith("inbox-zero-message-draft-updated:")
    )
      changed();
  };
  window.addEventListener(messageDraftEvent, changed);
  window.addEventListener("storage", storageChanged);
  return () => {
    window.removeEventListener(messageDraftEvent, changed);
    window.removeEventListener("storage", storageChanged);
  };
}
export function useMessageDrafts() {
  return useSyncExternalStore(subscribe, getSnapshot, () => empty);
}
