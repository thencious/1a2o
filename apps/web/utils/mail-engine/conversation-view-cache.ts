import type { ConversationView } from "@inboxzero/mail-core/ports/mail-store";

const entries = new Map<string, { view: ConversationView; size: number }>();
const blockedAccounts = new Set<string>();
let blocked = false;
let totalSize = 0;
const MAX_SIZE = 10_000_000;

export function readConversationPreview(
  accountId: string,
  conversationId: string | null,
  pageSize: number,
) {
  if (blocked || blockedAccounts.has(accountId)) return null;
  const key = JSON.stringify([accountId, conversationId, pageSize]);
  const entry = entries.get(key);
  if (!entry) return null;
  entries.delete(key);
  entries.set(key, entry);
  return entry.view;
}

export function saveConversationPreview(
  view: ConversationView,
  pageSize: number,
) {
  if (blocked || blockedAccounts.has(view.key.accountId)) return;
  const key = JSON.stringify([
    view.key.accountId,
    view.key.conversationId,
    pageSize,
  ]);
  const previous = entries.get(key);
  if (previous?.view === view) return;
  const size = JSON.stringify(view).length;
  if (previous) totalSize -= previous.size;
  entries.delete(key);
  if (size <= MAX_SIZE) {
    entries.set(key, { view, size });
    totalSize += size;
  }
  while (entries.size > 50 || totalSize > MAX_SIZE) {
    const oldest = entries.entries().next().value;
    if (!oldest) break;
    entries.delete(oldest[0]);
    totalSize -= oldest[1].size;
  }
}

export function clearConversationPreviews(accountId?: string) {
  if (accountId) blockedAccounts.add(accountId);
  else blocked = true;
  for (const [key, entry] of entries) {
    if (!accountId || entry.view.key.accountId === accountId) {
      entries.delete(key);
      totalSize -= entry.size;
    }
  }
}
