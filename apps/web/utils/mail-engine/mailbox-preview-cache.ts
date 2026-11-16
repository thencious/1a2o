import {
  canonicalizeQuery,
  mailboxViewSchema,
  type ConversationQuery,
  type MailboxView,
} from "@inboxzero/mail-core/queries";
import { clearConversationPreviews } from "./conversation-view-cache";

const PREFIX = "inbox-zero:mail-preview:v1:";
const COUNT_PREFIX = "inbox-zero:mail-tag-counts:v1:";
const MAX_ENTRIES = 8;
const MAX_ROWS = 50;
const MAX_BYTES = 250_000;
const parsed = new Map<string, { raw: string; view: MailboxView }>();
const listeners = new Set<() => void>();
const blockedAccounts = new Set<string>();
let blocked = false;

export function readMailboxPreview(
  query: ConversationQuery,
): MailboxView | null {
  if (typeof window === "undefined" || isBlocked(query)) return null;
  const key = PREFIX + canonicalizeQuery(query);
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const previous = parsed.get(key);
    if (previous?.raw === raw) return previous.view;
    const result = mailboxViewSchema.safeParse(JSON.parse(raw));
    if (
      !result.success ||
      result.data.conversations.some(
        (row) => !query.accountIds.includes(row.key.accountId),
      )
    )
      return null;
    parsed.set(key, { raw, view: result.data });
    return result.data;
  } catch {
    return null;
  }
}

export function saveMailboxPreview(
  query: ConversationQuery,
  view: MailboxView,
) {
  if (typeof window === "undefined" || isBlocked(query)) return;
  try {
    const key = PREFIX + canonicalizeQuery(query);
    const preview = {
      ...view,
      conversations: view.conversations.slice(0, MAX_ROWS),
      nextPage: null,
    };
    let raw = JSON.stringify(preview);
    while (raw.length > MAX_BYTES && preview.conversations.length > 1) {
      preview.conversations.pop();
      raw = JSON.stringify(preview);
    }
    if (raw.length > MAX_BYTES) return;
    if (window.localStorage.getItem(key) === raw) return;
    window.localStorage.removeItem(key);
    window.localStorage.setItem(key, raw);
    const keys = previewKeys();
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
      window.localStorage.removeItem(old);
      parsed.delete(old);
    }
    for (const listener of listeners) listener();
  } catch {
    // A full or unavailable cache must not prevent live mail from loading.
  }
}

export function subscribeMailboxPreviews(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function clearMailboxPreviews(accountId?: string) {
  clearConversationPreviews(accountId);
  if (accountId) blockedAccounts.add(accountId);
  else blocked = true;
  parsed.clear();
  if (typeof window === "undefined") return;
  try {
    for (const key of [...previewKeys(), ...previewKeys(COUNT_PREFIX)]) {
      const prefix = key.startsWith(COUNT_PREFIX) ? COUNT_PREFIX : PREFIX;
      const query = JSON.parse(key.slice(prefix.length)) as ConversationQuery;
      if (!accountId || query.accountIds.includes(accountId))
        window.localStorage.removeItem(key);
    }
  } catch {
    // Logout and mailbox removal must continue when storage is unavailable.
  }
  for (const listener of listeners) listener();
}

function isBlocked(query: ConversationQuery) {
  return blocked || query.accountIds.some((id) => blockedAccounts.has(id));
}

export function readTagCountPreview(identity: string): Map<string, number> {
  try {
    if (typeof window === "undefined" || blocked) return new Map();
    const query = JSON.parse(identity) as { accountIds: string[] };
    if (query.accountIds.some((id) => blockedAccounts.has(id)))
      return new Map();
    const entries = JSON.parse(
      window.localStorage.getItem(COUNT_PREFIX + identity) ??
        window.localStorage.getItem(PREFIX + identity) ??
        "[]",
    ) as unknown;
    if (
      !Array.isArray(entries) ||
      !entries.every(
        (entry) =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          Number.isSafeInteger(entry[1]) &&
          entry[1] >= 0,
      )
    )
      return new Map();
    return new Map(entries);
  } catch {
    return new Map();
  }
}

export function saveTagCountPreview(
  identity: string,
  counts: Map<string, number>,
) {
  try {
    if (typeof window === "undefined" || blocked) return;
    const query = JSON.parse(identity) as { accountIds: string[] };
    if (query.accountIds.some((id) => blockedAccounts.has(id))) return;
    const raw = JSON.stringify([...counts]);
    if (raw.length > MAX_BYTES) return;
    const key = COUNT_PREFIX + identity;
    window.localStorage.removeItem(PREFIX + identity);
    window.localStorage.removeItem(key);
    window.localStorage.setItem(key, raw);
    const keys = previewKeys(COUNT_PREFIX);
    for (const old of keys.slice(0, Math.max(0, keys.length - MAX_ENTRIES))) {
      window.localStorage.removeItem(old);
      parsed.delete(old);
    }
  } catch {
    /* Counts remain available in memory if storage is full. */
  }
}

function previewKeys(prefix = PREFIX) {
  return Object.keys(window.localStorage).filter((key) =>
    key.startsWith(prefix),
  );
}
