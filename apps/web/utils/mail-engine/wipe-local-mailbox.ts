import { clearRecentSearchHistory } from "@/store/mail-search-history";
import { clearStoredSenderQueues } from "@/store/sender-queue";
import { getInboxZeroDesktopApp } from "@/utils/desktop-app";
import { wipeOpfsMailEngine } from "@/utils/mail-engine/wasm-sqlite";
import { clearMailboxPreviews } from "@/utils/mail-engine/mailbox-preview-cache";

export async function wipeLocalMailbox() {
  clearMailboxPreviews();
  clearStoredSenderQueues();
  clearRecentSearchHistory();
  const wipe = getInboxZeroDesktopApp()?.wipeMailbox;
  if (typeof wipe === "function") {
    await wipe();
    return;
  }
  await wipeOpfsMailEngine();
}
