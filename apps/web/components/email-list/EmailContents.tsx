import { startTransition, useEffect, useMemo, useState } from "react";
import {
  BufferedMailHtmlFrame,
  MailPlainTextBody,
  buildMailHtmlDocument,
  getMailHtmlDocumentKey,
  shouldApplyDarkMailTheme,
} from "@inboxzero/mail-ui/MailBody";
import { useTheme } from "next-themes";
import { EllipsisIcon } from "lucide-react";
import { decodeHtmlEntities } from "@/utils/gmail/decode";
import {
  getPreparedEmailHtml,
  IMAGE_PROXY_BASE_URL,
  IMAGE_PROXY_ORIGIN,
  needsEmailImageProxy,
  prepareSanitizedEmailHtml,
  sanitizeEmailHtml,
} from "@/utils/email/prepare-html.client";
import type { ParsedMessage } from "@/utils/types";
import {
  getInlineImageContentIds,
  normalizeContentId,
  rewriteInlineImageSources,
} from "@inboxzero/mail-ui/inline-images";
import { linkifyPlainText } from "@inboxzero/mail-ui/linkify";
import { splitEmailContent } from "@/utils/email/split-email-content.client";
import {
  fetchAttachment,
  getAttachmentUrl,
} from "@/utils/attachments/download";
import { queueAttachmentDownload } from "@/utils/attachments/download-queue";
import { getAttachmentImagePreview } from "@inboxzero/mail-ui/image-preview";
import { useMailAccountTheme } from "@/providers/MailAccountThemeProvider";

const NO_INLINE_ATTACHMENTS: ParsedMessage["inline"] = [];
const INLINE_IMAGE_MAX_BYTES = 25 * 1024 * 1024;
const INLINE_IMAGE_CACHE_SIZE = 20;
// Loaded inline images outlive the component so a remount or a republished
// message object (e.g. a sync update without attachment metadata) repaints
// with them instead of dropping back to unresolved cid: sources.
const loadedInlineImages = new Map<string, Record<string, string>>();
const mountedInlineImageMessages = new Map<string, number>();

export function HtmlEmail({
  html,
  messageId,
  emailAccountId,
  inlineAttachments = NO_INLINE_ATTACHMENTS,
  onReplyMessage,
  onForwardMessage,
  onNavigateMessage,
  onFocusMessage,
}: {
  html: string;
  messageId: string;
  emailAccountId?: string;
  inlineAttachments?: ParsedMessage["inline"];
  onReplyMessage?: (quote?: string) => void;
  onForwardMessage?: () => void;
  onNavigateMessage?: (direction: -1 | 1) => void;
  onFocusMessage?: () => void;
}) {
  const sanitizedHtml = useMemo(() => sanitizeEmailHtml(html), [html]);
  // Message objects are rebuilt whenever the conversation republishes, so the
  // effect keys on the attachments' identity rather than the array or its
  // order. Re-running it would mint new object URLs and remount the frame
  // without its images.
  const inlineImageIds = useMemo(
    () => serializeInlineImageIds(inlineAttachments),
    [inlineAttachments],
  );
  const [showReplies, setShowReplies] = useState(false);
  const [prepared, setPrepared] = useState<{
    messageId: string;
    sourceHtml: string;
    html: string;
  }>();
  const needsProxy = needsEmailImageProxy(sanitizedHtml);
  const cachedHtml = useMemo(
    () => getPreparedEmailHtml({ messageId, sourceHtml: sanitizedHtml }),
    [messageId, sanitizedHtml],
  );
  const current =
    prepared?.messageId === messageId && prepared.sourceHtml === sanitizedHtml
      ? prepared
      : undefined;
  const readyHtml = current?.html ?? cachedHtml;
  const renderHtml = useMemo(
    () =>
      current?.html ??
      withLoadedInlineImages(messageId, cachedHtml ?? sanitizedHtml),
    [current, messageId, cachedHtml, sanitizedHtml],
  );
  // Until signed image URLs arrive, the iframe CSP prevents direct requests.
  const allowRemoteImages = !needsProxy || readyHtml !== undefined;
  const { resolvedTheme } = useTheme();
  const isDarkMode = resolvedTheme === "dark";
  const accountTheme = useMailAccountTheme(emailAccountId);
  const darkBackgroundHsl = `${accountTheme["--mail-hue"]} ${accountTheme["--mail-saturation"]} 16%`;

  useEffect(() => {
    mountedInlineImageMessages.set(
      messageId,
      (mountedInlineImageMessages.get(messageId) ?? 0) + 1,
    );
    return () => {
      const count = (mountedInlineImageMessages.get(messageId) ?? 1) - 1;
      if (count > 0) mountedInlineImageMessages.set(messageId, count);
      else mountedInlineImageMessages.delete(messageId);
      evictLoadedInlineImages();
    };
  }, [messageId]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const publish = (html: string) => {
      if (cancelled) return;
      startTransition(() =>
        setPrepared({
          messageId,
          sourceHtml: sanitizedHtml,
          html: withLoadedInlineImages(messageId, html),
        }),
      );
    };
    const preparedHtml = prepareSanitizedEmailHtml({
      messageId,
      sourceHtml: sanitizedHtml,
    });
    // Inline images download separately so a slow attachment doesn't hold
    // back the body.
    if (needsEmailImageProxy(sanitizedHtml)) preparedHtml.then(publish);
    Promise.all([
      preparedHtml,
      loadInlineImageSources({
        emailAccountId,
        signal: controller.signal,
        html: sanitizedHtml,
        inlineImageIds,
        messageId,
      }),
    ]).then(
      ([rewrittenHtml, loadedNewImages]) => {
        if (loadedNewImages) publish(rewrittenHtml);
      },
      () => {
        // The body is already readable even if its inline images fail.
      },
    );

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [emailAccountId, inlineImageIds, messageId, sanitizedHtml]);

  const { mainContent, quotedContent, hasQuotedContent } = useMemo(
    () => splitEmailContent(renderHtml),
    [renderHtml],
  );
  const applyDarkTheme = shouldApplyDarkMailTheme(mainContent, isDarkMode);
  const applyQuotedDarkTheme = shouldApplyDarkMailTheme(
    quotedContent,
    isDarkMode,
  );

  const documentKey = useMemo(
    () =>
      getMailHtmlDocumentKey(
        allowRemoteImages ? mainContent : `blocked:${mainContent}`,
        applyDarkTheme,
        darkBackgroundHsl,
      ),
    [mainContent, applyDarkTheme, darkBackgroundHsl, allowRemoteImages],
  );
  const srcDoc = useMemo(
    () =>
      buildMailHtmlDocument({
        html: mainContent,
        isDarkMode: applyDarkTheme,
        imageProxyBaseUrl: allowRemoteImages ? IMAGE_PROXY_BASE_URL : null,
        imageProxyOrigin: allowRemoteImages ? IMAGE_PROXY_ORIGIN : null,
        allowRemoteImages,
        documentKey,
        darkBackgroundHsl,
      }),
    [
      mainContent,
      applyDarkTheme,
      documentKey,
      darkBackgroundHsl,
      allowRemoteImages,
    ],
  );

  const quotedDocument = useMemo(() => {
    if (!hasQuotedContent || !showReplies) return null;
    const documentKey = getMailHtmlDocumentKey(
      allowRemoteImages ? quotedContent : `blocked:${quotedContent}`,
      applyQuotedDarkTheme,
      darkBackgroundHsl,
    );
    return {
      documentKey,
      srcDoc: buildMailHtmlDocument({
        html: quotedContent,
        isDarkMode: applyQuotedDarkTheme,
        imageProxyBaseUrl: allowRemoteImages ? IMAGE_PROXY_BASE_URL : null,
        imageProxyOrigin: allowRemoteImages ? IMAGE_PROXY_ORIGIN : null,
        allowRemoteImages,
        documentKey,
        darkBackgroundHsl,
      }),
    };
  }, [
    hasQuotedContent,
    showReplies,
    quotedContent,
    applyQuotedDarkTheme,
    darkBackgroundHsl,
    allowRemoteImages,
  ]);
  const callbacks = {
    onForwardMessage,
    onNavigateMessage,
    onReplyMessage,
    onFocusMessage,
  };

  return (
    <div className="relative min-w-0 overflow-x-hidden">
      <BufferedMailHtmlFrame
        srcDoc={srcDoc}
        documentKey={documentKey}
        isDarkMode={applyDarkTheme}
        callbacks={callbacks}
      />
      {hasQuotedContent && (
        <button
          type="button"
          aria-expanded={showReplies}
          aria-label={
            showReplies ? "Hide quoted content" : "Show quoted content"
          }
          className="mt-1 inline-flex h-5 items-center rounded-full bg-muted px-2 text-muted-foreground transition-colors hover:bg-muted/80 hover:text-foreground"
          onClick={() => setShowReplies(!showReplies)}
        >
          <EllipsisIcon className="size-4" />
        </button>
      )}
      {quotedDocument && (
        <BufferedMailHtmlFrame
          srcDoc={quotedDocument.srcDoc}
          documentKey={quotedDocument.documentKey}
          isDarkMode={applyQuotedDarkTheme}
          callbacks={callbacks}
        />
      )}
    </div>
  );
}

export function PlainEmail({ text }: { text: string }) {
  const segments = useMemo(
    () => linkifyPlainText(decodeHtmlEntities(text)),
    [text],
  );

  return <MailPlainTextBody segments={segments} />;
}

function withLoadedInlineImages(messageId: string, html: string) {
  const sources = loadedInlineImages.get(messageId);
  if (!sources) return html;
  loadedInlineImages.delete(messageId);
  loadedInlineImages.set(messageId, sources);
  return rewriteInlineImageSources(html, sources);
}

function storeLoadedInlineImage({
  messageId,
  contentId,
  objectUrl,
}: {
  messageId: string;
  contentId: string;
  objectUrl: string;
}) {
  const sources = loadedInlineImages.get(messageId) ?? {};
  if (sources[contentId]) {
    URL.revokeObjectURL(objectUrl);
    return;
  }
  sources[contentId] = objectUrl;
  loadedInlineImages.delete(messageId);
  loadedInlineImages.set(messageId, sources);
  evictLoadedInlineImages();
}

// Mounted messages are skipped because their frames may still be showing the
// object URLs; they become evictable once their last reader unmounts.
function evictLoadedInlineImages() {
  for (const [oldestMessageId, oldestSources] of loadedInlineImages) {
    if (loadedInlineImages.size <= INLINE_IMAGE_CACHE_SIZE) break;
    if (mountedInlineImageMessages.has(oldestMessageId)) continue;
    loadedInlineImages.delete(oldestMessageId);
    for (const url of Object.values(oldestSources)) URL.revokeObjectURL(url);
  }
}

async function loadInlineImageSources({
  emailAccountId,
  signal,
  html,
  inlineImageIds,
  messageId,
}: {
  emailAccountId: string | undefined;
  signal: AbortSignal;
  html: string;
  inlineImageIds: string;
  messageId: string;
}): Promise<boolean> {
  const attachmentIdByContentId = new Map<string, string>(
    JSON.parse(inlineImageIds),
  );
  if (!emailAccountId || !attachmentIdByContentId.size) return false;
  const loadedSources = loadedInlineImages.get(messageId);

  const loaded = await Promise.all(
    getInlineImageContentIds(html).map(async (contentId) => {
      const attachmentId = attachmentIdByContentId.get(contentId);
      if (!attachmentId || loadedSources?.[contentId]) return false;

      try {
        // Body images are content the user opened, so they skip the
        // speculative attachment-preview budget.
        const blob = await queueAttachmentDownload({
          priority: "requested",
          signal,
          download: (transferSignal) =>
            fetchAttachment({
              url: getAttachmentUrl({
                accountId: emailAccountId,
                messageId,
                attachmentId,
              }),
              emailAccountId,
              maxBytes: INLINE_IMAGE_MAX_BYTES,
              signal: transferSignal,
            }),
        }).then(getAttachmentImagePreview);
        if (!blob || signal.aborted) return false;
        storeLoadedInlineImage({
          messageId,
          contentId,
          objectUrl: URL.createObjectURL(blob),
        });
        return true;
      } catch {
        return false;
      }
    }),
  );

  return loaded.some(Boolean);
}

function serializeInlineImageIds(inlineAttachments: ParsedMessage["inline"]) {
  const entries: [contentId: string, attachmentId: string][] = [];
  for (const attachment of inlineAttachments) {
    const contentId = normalizeContentId(attachment.headers["content-id"]);
    if (contentId && attachment.attachmentId)
      entries.push([contentId, attachment.attachmentId]);
  }
  return JSON.stringify(entries.sort(([a], [b]) => a.localeCompare(b)));
}
