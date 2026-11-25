"use client";
import { combineConversationsAction } from "@/utils/actions/combine-conversations";
import {
  groupConversations,
  type ConversationGroup,
} from "@/utils/messages/conversation-groups";
import {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from "@/components/ui/context-menu";
import { BeeperRecoverySettings } from "./BeeperRecoverySettings";
import { PendingMessageAttachment } from "./PendingMessageAttachment";
import { MessageInviteDialog } from "./MessageInviteDialog";
import { prepareMessageInviteAction } from "@/utils/actions/message-invite";
import { addMessageContactsAction } from "@/utils/actions/message-add-contacts";
import { matchingMessageCommands } from "@/utils/messages/commands";
import {
  cancelScheduledMessageAction,
  runMessageCommandAction,
} from "@/utils/actions/message-command";
import { useChat } from "@/providers/ChatProvider";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useSidebar } from "@/components/ui/sidebar";
import { toastError, toastInfo } from "@/components/Toast";
import type { PreparedMessageInvite } from "@/utils/messages/invite";
import { SplitTabs } from "../mail/SplitTabs";
import { MailLabelChip } from "../mail/MailLabelChip";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import useSWR, { mutate as mutateCache } from "swr";
import { MessageMedia } from "./MessageMedia";
import { useSearchParams } from "next/navigation";
import {
  networkHue as hue,
  networkName,
  networkColor,
} from "@/utils/beeper/network";
import useSWRInfinite from "swr/infinite";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  Clock3,
  CircleAlert,
  Mail,
  MessageSquare,
  Paperclip,
  Search,
  Send,
  Settings,
  Users,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { MailListToolbarSurface } from "@inboxzero/mail-ui/MailListToolbarSurface";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { LoadingContent } from "@/components/LoadingContent";
import {
  connectBeeperAction,
  readBeeperChatAction,
  setBeeperGroupAction,
} from "@/utils/actions/beeper";
import { getActionErrorMessage } from "@/utils/error";
import { useMessageDrafts } from "@/hooks/useMessageDrafts";
import { useMessageHistory } from "@/hooks/useMessageHistory";
import {
  conversationsWithDrafts,
  messageDraftPrefix,
  saveMessageDraft,
  messageDraftEvent,
} from "@/utils/beeper/message-drafts";
import { uniqueConversations } from "@/utils/beeper/conversations";
import type {
  BeeperStatus,
  ChatMessage,
  Conversation,
  ConversationPage,
  MessagePage,
} from "@/utils/beeper/types";

import {
  mergeMessageOutbox,
  applyReadReceiptPositions,
  messageDelivery,
} from "@/utils/beeper/message-delivery";
import { useMessageOutbox } from "./useMessageOutbox";
import { MessageActions } from "./MessageActions";
import { MessageEditor } from "./MessageEditor";
import {
  MessageMentionPicker,
  useMessageMentions,
} from "./MessageMentionPicker";
import { ForwardMessageDialog } from "./ForwardMessageDialog";
import { canForwardMessage } from "@/utils/beeper/message-forward";
import { MessageText, MessageLinkCards } from "./MessageLinks";
import { messagePreviewLinks } from "@/utils/beeper/message-links";
import { useFocusedConversation } from "@/hooks/useFocusedConversation";

async function read<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { cache: "no-store", signal });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Could not load messages.");
  return data;
}
function actionError(
  result: Parameters<typeof getActionErrorMessage>[0] | undefined,
) {
  if (!result || result.serverError || result.validationErrors)
    throw new Error(getActionErrorMessage(result ?? {}));
}
function shortTime(value: string, includeTimeForOlder = false) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleString([], {
        month: "short",
        day: "numeric",
        hour: includeTimeForOlder ? "2-digit" : undefined,
        minute: includeTimeForOlder ? "2-digit" : undefined,
        year:
          includeTimeForOlder && date.getFullYear() !== new Date().getFullYear()
            ? "numeric"
            : undefined,
      });
}
export function MessagesWorkspace() {
  const notificationParams = useSearchParams();
  const notificationChatId = notificationParams.get("chatId");
  const notificationKey = `${notificationChatId ?? ""}:${notificationParams.get("notification") ?? ""}`;
  const openedNotification = useRef("");
  const {
    data: status,
    error: statusError,
    mutate: refreshStatus,
  } = useSWR<BeeperStatus>("/api/user/messages/status", read, {
    refreshInterval: 15_000,
  });
  const [settings, setSettings] = useState(false);
  const [selected, setSelected] = useState<Conversation | null>(null);
  const { data: conversationGroups = [], mutate: refreshGroups } = useSWR<
    ConversationGroup[]
  >("/api/user/messages/groups", read);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [combining, setCombining] = useState(false);
  const [combineBusy, setCombineBusy] = useState(false);
  const [combineFailure, setCombineFailure] = useState("");
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null);
  const [query, setQuery] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [tag, setTag] = useState<string | null>(null);
  const [network, setNetwork] = useState<string | null>(null);
  const { data: rulesStatus } = useSWR<{
    enabled: boolean;
    working: boolean;
    lastError?: string;
    rules: { label: string; enabled: boolean }[];
  }>("/api/user/automation?domain=messages", read, { refreshInterval: 5000 });
  const { data, error, size, setSize, isLoading, isValidating, mutate } =
    useSWRInfinite<ConversationPage>(
      (index, previous) =>
        !status?.running || (previous && !previous.hasMore)
          ? null
          : `/api/user/messages/conversations${index ? `?cursor=${encodeURIComponent(previous!.cursor!)}` : ""}`,
      read,
      {
        refreshInterval: 5000,
        refreshWhenHidden: true,
        revalidateFirstPage: true,
        revalidateOnFocus: true,
      },
    );
  const drafts = useMessageDrafts();
  const all = conversationsWithDrafts(
    groupConversations(
      uniqueConversations((data ?? []).map((page) => page.items)),
      conversationGroups,
    ),
    drafts,
  );
  useEffect(() => {
    if (!notificationChatId || openedNotification.current === notificationKey)
      return;
    const conversation = all.find(
      (item) =>
        item.id === notificationChatId ||
        item.members?.some((member) => member.id === notificationChatId),
    );
    if (!conversation) return;
    openedNotification.current = notificationKey;
    setSelected(conversation);
  }, [all, notificationChatId, notificationKey]);
  const tagNames = [
    ...new Set([
      "Business",
      "Casual",
      "Notification",
      "Other",
      ...(rulesStatus?.rules
        .filter((rule) => rule.enabled)
        .map((rule) => rule.label) ?? []),
      ...all.map((item) => item.ruleLabel ?? "").filter(Boolean),
    ]),
  ];
  const networkNames = [
    ...new Set([
      ...(status?.accounts.map((item) => networkName(item.network)) ?? []),
      ...all.map((item) => networkName(item.network)),
    ]),
  ];
  const tagSplits = [
    { id: "all", name: "All", deletable: false },
    ...tagNames.map((name) => ({ id: `tag:${name}`, name, deletable: false })),
  ];
  const networkSplits = networkNames.map((name) => ({
    id: `app:${name}`,
    name,
    deletable: false,
    style: {
      backgroundColor: networkColor(name, 22, 22),
      color: networkColor(name, 50, 78),
      boxShadow:
        network === name
          ? `inset 0 0 0 1px ${networkColor(name, 50, 55)}`
          : undefined,
    },
  }));
  const tagCounts = new Map<string, number>([
    ["all", all.length],
    ...tagNames.map(
      (name) =>
        [
          `tag:${name}`,
          all.filter(
            (item) =>
              item.ruleLabel === name &&
              (!network ||
                (item.members ?? [item]).some(
                  (member) => networkName(member.network) === network,
                )),
          ).length,
        ] as const,
    ),
    ...networkNames.map(
      (name) =>
        [
          `app:${name}`,
          all.filter(
            (item) =>
              (item.members ?? [item]).some(
                (member) => networkName(member.network) === name,
              ) &&
              (!tag || item.ruleLabel === tag),
          ).length,
        ] as const,
    ),
  ]);
  const selectedTagIds = new Set([
    ...(tag ? [`tag:${tag}`] : []),
    ...(network ? [`app:${network}`] : []),
    ...(!tag && !network ? ["all"] : []),
  ]);
  const selectedTagId = tag ? `tag:${tag}` : network ? `app:${network}` : "all";
  const selectTag = (id: string, focus = false) => {
    if (id === "all") {
      setTag(null);
      setNetwork(null);
    } else if (id.startsWith("app:")) {
      setNetwork((current) =>
        !focus && current === id.slice(4) ? null : id.slice(4),
      );
      if (focus) setTag(null);
    } else {
      setTag((current) =>
        !focus && current === id.slice(4) ? null : id.slice(4),
      );
      if (focus) setNetwork(null);
    }
  };
  const items = all.filter(
    (item) =>
      (!unreadOnly || item.unread > 0) &&
      (!tag || item.ruleLabel === tag) &&
      (!network ||
        (item.members ?? [item]).some(
          (member) => networkName(member.network) === network,
        )) &&
      `${item.title} ${item.preview} ${networkName(item.network)} ${item.network} ${item.account}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  useEffect(() => {
    if (
      data?.at(-1)?.hasMore &&
      !data.at(-1)?.items.length &&
      !isValidating &&
      size < 50
    )
      setSize(size + 1);
  }, [data, isValidating, size, setSize]);
  const combineSelected = async (combineContacts: boolean) => {
    setCombineBusy(true);
    setCombineFailure("");
    try {
      const result = await combineConversationsAction({
        chatIds: [...selectedIds],
        combineContacts,
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      await refreshGroups();
      await mutate();
      await mutateCache("/api/user/messages/contacts");
      setSelectedIds(new Set());
      setSelected(result.data.members[0]);
      setCombining(false);
    } catch (error) {
      setCombineFailure(
        error instanceof Error
          ? error.message
          : "Could not combine conversations.",
      );
    } finally {
      setCombineBusy(false);
    }
  };
  const open = (item: Conversation) => {
    setSelected(item);
    Promise.all(
      (item.members ?? [item]).map((member) =>
        readBeeperChatAction({ chatId: member.id }),
      ),
    )
      .then((result) => {
        if (result.some((item) => item?.data)) mutate();
      })
      .catch(() => {});
  };
  const keyboard = (event: React.KeyboardEvent) => {
    if (
      event.defaultPrevented ||
      !["ArrowDown", "ArrowUp"].includes(event.key) ||
      (event.target instanceof HTMLElement &&
        event.target.closest(
          'input,textarea,select,[contenteditable=true],[role="menu"],[role="menuitem"]',
        ))
    )
      return;
    event.preventDefault();
    event.stopPropagation();
    const index = items.findIndex((item) => item.id === selected?.id);
    const next =
      index < 0
        ? 0
        : Math.max(
            0,
            Math.min(
              items.length - 1,
              index + (event.key === "ArrowDown" ? 1 : -1),
            ),
          );
    if (items[next]) open(items[next]);
  };
  const activeConversation =
    selected && (all.find((item) => item.id === selected.id) ?? selected);
  return (
    <section
      aria-label="Unified messages"
      onKeyDown={keyboard}
      className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
    >
      <Dialog
        open={combining}
        onOpenChange={(value) => {
          if (!combineBusy) setCombining(value);
        }}
      >
        <DialogContent>
          <DialogTitle>Combine contacts too?</DialogTitle>
          <DialogDescription>
            Combine the selected conversations into one history. Combining
            contacts also keeps all their unique details and profile links,
            using the most complete name.
          </DialogDescription>
          {combineFailure && (
            <p role="alert" className="text-sm text-destructive">
              {combineFailure}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              variant="ghost"
              disabled={combineBusy}
              onClick={() => setCombining(false)}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              disabled={combineBusy}
              onClick={() => combineSelected(false)}
            >
              No, conversations only
            </Button>
            <Button
              disabled={combineBusy}
              onClick={() => combineSelected(true)}
            >
              Yes, combine contacts too
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <h1 className="sr-only">Messages</h1>
      {statusError ? (
        <div role="alert" className="p-6 text-sm text-destructive">
          {statusError.message}
          <Button variant="ghost" onClick={() => refreshStatus()}>
            Retry
          </Button>
        </div>
      ) : status && !status.running ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center text-sm text-muted-foreground">
          <MessageSquare className="size-8" />
          <p>
            {status.error ||
              "Connect Beeper Desktop to see your WhatsApp, WeChat, Discord DMs, and SMS conversations here."}
          </p>
          <Button variant="outline" onClick={() => setSettings(true)}>
            {status.configured ? "Check connection" : "Connect Beeper"}
          </Button>
        </div>
      ) : (
        <ResizablePanelGroup
          direction="horizontal"
          autoSaveId="unified-messages-split"
          className="min-h-0 flex-1"
        >
          <ResizablePanel
            defaultSize={43}
            minSize={25}
            className={selected ? "hidden min-w-0 md:block" : "min-w-0"}
          >
            <div className="flex h-full min-h-0 flex-col">
              <MailListToolbarSurface>
                <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg border border-border bg-sidebar px-2.5 text-muted-foreground focus-within:ring-2 focus-within:ring-ring">
                  <Search className="size-3.5 shrink-0" />
                  <input
                    aria-label="Search conversations"
                    placeholder="Search messages"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    className="h-7 min-w-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm outline-none focus:ring-0"
                  />
                </div>
                <Button
                  variant="outline"
                  size="icon"
                  className={`size-8 shrink-0 rounded-lg ${unreadOnly ? "bg-accent text-foreground" : ""}`}
                  aria-label="Unread conversations"
                  aria-pressed={unreadOnly}
                  title="Unread conversations"
                  onClick={() => setUnreadOnly((value) => !value)}
                >
                  <Mail className="size-3.5" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="size-8 shrink-0 rounded-lg"
                  aria-label="Messages settings"
                  title="Messages settings"
                  onClick={() => setSettings(true)}
                >
                  <Settings className="size-3.5" />
                </Button>
              </MailListToolbarSurface>
              <div role="group" aria-label="Conversation tags">
                <div role="group" aria-label="Messaging apps">
                  <SplitTabs
                    splits={networkSplits}
                    activeSplitId={network ? `app:${network}` : null}
                    countsById={tagCounts}
                    selectedSplitIds={selectedTagIds}
                    onSelect={(id) => selectTag(id)}
                    onFocus={(id) => selectTag(id, true)}
                    canCreateSplits={false}
                    onNewSplit={() => {}}
                    className="border-b-0 pb-1"
                  />
                </div>
                <div role="group" aria-label="Message categories">
                  <SplitTabs
                    splits={tagSplits}
                    activeSplitId={selectedTagId}
                    countsById={tagCounts}
                    selectedSplitIds={selectedTagIds}
                    onSelect={(id) => selectTag(id)}
                    onFocus={(id) => selectTag(id, true)}
                    canCreateSplits={false}
                    onNewSplit={() => {}}
                    trailing={
                      <>
                        {rulesStatus?.working && (
                          <span
                            className="text-xs text-muted-foreground"
                            role="status"
                          >
                            Tagging...
                          </span>
                        )}
                        {rulesStatus?.lastError && (
                          <span
                            className="w-full text-xs text-muted-foreground"
                            role="status"
                          >
                            {rulesStatus.lastError}
                          </span>
                        )}
                      </>
                    }
                  />
                </div>
              </div>
              <div
                className="min-h-0 flex-1 overflow-y-auto"
                role="list"
                aria-label="Conversations"
              >
                <LoadingContent
                  loading={!status || isLoading}
                  error={error ? { error: error.message } : undefined}
                >
                  {!items.length && (
                    <p className="p-6 text-center text-sm text-muted-foreground">
                      {query || unreadOnly || tag || network
                        ? "No matching conversations."
                        : "No conversations yet. Link your accounts in Beeper Desktop."}
                    </p>
                  )}
                  {items.map((item) => (
                    <ContextMenu key={item.id}>
                      <ContextMenuTrigger asChild>
                        <div
                          role="listitem"
                          onContextMenu={() => {
                            if (!selectedIds.has(item.id))
                              setSelectedIds(new Set([item.id]));
                          }}
                        >
                          <button
                            type="button"
                            aria-label={`${item.title}: ${item.preview}`}
                            aria-current={
                              selected?.id === item.id ? "true" : undefined
                            }
                            aria-pressed={selectedIds.has(item.id)}
                            onClick={(event) => {
                              setSelectedIds((previous) => {
                                if (!event.ctrlKey && !event.metaKey)
                                  return new Set([item.id]);
                                const next = new Set(
                                  previous.size
                                    ? previous
                                    : selected
                                      ? [selected.id]
                                      : [],
                                );
                                if (next.has(item.id)) next.delete(item.id);
                                else next.add(item.id);
                                return next;
                              });
                              open(item);
                            }}
                            className={`relative block w-full border-b border-l-[3px] px-3 py-2 text-left hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${selectedIds.has(item.id) || selected?.id === item.id ? "bg-muted/60" : ""}`}
                            style={{
                              borderLeftWidth: item.members ? 0 : undefined,
                              borderLeftColor: item.members
                                ? "transparent"
                                : networkColor(item.network, 50, 52),
                              paddingLeft: item.members
                                ? 12 +
                                  3 *
                                    new Set(
                                      item.members.map((member) =>
                                        networkName(member.network),
                                      ),
                                    ).size
                                : undefined,
                            }}
                          >
                            {item.members && (
                              <span
                                aria-hidden="true"
                                className="absolute inset-y-0 left-0 flex"
                              >
                                {[
                                  ...new Set(
                                    item.members.map((member) =>
                                      networkName(member.network),
                                    ),
                                  ),
                                ].map((network) => (
                                  <span
                                    key={network}
                                    style={{
                                      width: 3,
                                      background: networkColor(network, 50, 52),
                                    }}
                                  />
                                ))}
                              </span>
                            )}
                            <div className="flex items-center gap-1.5">
                              {item.group && (
                                <Users className="size-3 shrink-0 text-muted-foreground" />
                              )}
                              {item.ruleLabel && (
                                <MailLabelChip
                                  name={item.ruleLabel}
                                  tone={messageTagTone(item.ruleLabel)}
                                  className="shrink-0 text-[10px]"
                                />
                              )}
                              <span
                                className={`min-w-0 flex-1 truncate text-sm ${item.unread ? "font-semibold" : "font-medium"}`}
                              >
                                {item.title}
                              </span>
                              <time className="shrink-0 text-[10px] text-muted-foreground">
                                {shortTime(item.time)}
                              </time>
                              {item.unread > 0 && (
                                <span className="rounded-full bg-muted px-1.5 text-[10px]">
                                  {item.unread}
                                </span>
                              )}
                            </div>
                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                              {item.draft && (
                                <span className="mr-1 text-rose-400">
                                  [Draft]
                                </span>
                              )}
                              {item.preview}
                            </p>
                          </button>
                        </div>
                      </ContextMenuTrigger>
                      <ContextMenuContent>
                        <ContextMenuItem
                          disabled={selectedIds.size < 2}
                          onSelect={() => {
                            setCombineFailure("");
                            setCombining(true);
                          }}
                        >
                          Combine conversations
                        </ContextMenuItem>
                      </ContextMenuContent>
                    </ContextMenu>
                  ))}
                </LoadingContent>
                {data?.at(-1)?.hasMore && (
                  <Button
                    variant="ghost"
                    className="w-full"
                    disabled={isValidating}
                    onClick={() => setSize(size + 1)}
                  >
                    Load more conversations
                  </Button>
                )}
              </div>
            </div>
          </ResizablePanel>
          <ResizableHandle
            aria-label="Resize messages columns"
            className="hidden w-1.5 cursor-col-resize bg-border/40 hover:bg-muted-foreground/40 dark:bg-border/40 dark:hover:bg-muted-foreground/40 md:flex"
          />
          <ResizablePanel
            defaultSize={57}
            minSize={30}
            className={selected ? "min-w-0" : "hidden min-w-0 md:block"}
          >
            {activeConversation ? (
              <ConversationThread
                key={conversationHistoryScope(activeConversation)}
                conversation={activeConversation}
                onBack={() => setSelected(null)}
                onSent={() => mutate()}
                onForward={setForwarding}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Select a conversation to read it here.
              </div>
            )}
          </ResizablePanel>
        </ResizablePanelGroup>
      )}
      <BeeperSettings
        open={settings}
        onClose={() => setSettings(false)}
        status={status}
        onConnected={() => {
          refreshStatus();
          mutate();
        }}
      />
      {forwarding && (
        <ForwardMessageDialog
          message={forwarding}
          conversations={all}
          hasMore={Boolean(data?.at(-1)?.hasMore)}
          loadingMore={isValidating}
          onLoadMore={() => {
            setSize(size + 1);
          }}
          onClose={() => setForwarding(null)}
          onSubmitted={() => {
            mutate();
          }}
          onForwarded={(conversation) => {
            setForwarding(null);
            setSelected(conversation);
          }}
        />
      )}
    </section>
  );
}

function conversationHistoryScope(conversation: Conversation) {
  return JSON.stringify([
    conversation.id,
    conversation.members?.map((member) => member.id).sort(),
  ]);
}

function ConversationThread({
  conversation,
  onBack,
  onSent,
  onForward,
}: {
  conversation: Conversation;
  onBack: () => void;
  onSent: () => void;
  onForward: (message: ChatMessage) => void;
}) {
  const [sendingVia, setSendingVia] = useState(conversation.id);
  const destination =
    conversation.members?.find((member) => member.id === sendingVia) ??
    conversation;
  const {
    history,
    refresh,
    refreshError,
    loadOlder,
    olderError,
    loadingOlder,
    updateMessage,
  } = useMessageHistory(
    `/api/user/messages/thread?chatId=${encodeURIComponent(conversation.id)}${conversation.members ? "&combined=1" : ""}`,
    conversationHistoryScope(conversation),
    read<MessagePage>,
  );
  const draftKey = `inbox-zero-message-draft:${conversation.id}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(draftKey) || "";
    } catch {
      return "";
    }
  });
  const [composerHeight, setComposerHeight] = useState(() => {
    try {
      return Math.max(
        40,
        Math.min(
          360,
          Number(localStorage.getItem("inbox-zero-message-composer-height")) ||
            40,
        ),
      );
    } catch {
      return 40;
    }
  });
  const composerDrag = useRef<{ y: number; height: number } | null>(null);
  const resizeComposer = (height: number) => {
    const next = Math.round(
      Math.max(
        40,
        Math.min(Math.min(360, Math.max(40, window.innerHeight * 0.5)), height),
      ),
    );
    setComposerHeight(next);
    try {
      localStorage.setItem("inbox-zero-message-composer-height", String(next));
    } catch {}
  };
  const [attachment, setAttachment] = useState<File | null>(null);
  const attachFile = (file: File) => {
    if (destination.readOnly) return;
    if (file.size > 17_000_000) {
      setFailure("Choose a file smaller than 17 MB.");
      return;
    }
    setAttachment(file);
    setFailure("");
  };
  const [replyTo, setReplyTo] = useState<ChatMessage | null>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const [failure, setFailure] = useState("");
  const [preparingInvite, setPreparingInvite] = useState(false);
  const [addingContacts, setAddingContacts] = useState(false);
  const addingContactsRef = useRef(false);
  const [contactResult, setContactResult] = useState("");
  const [assistantResult, setAssistantResult] = useState("");
  const [assistantRunning, setAssistantRunning] = useState(false);
  const assistantBusy = useRef(false);
  const commandRetry = useRef<{
    text: string;
    chatId: string;
    id: string;
  } | null>(null);
  const { emailAccountId } = useAccount();
  const { setChatId } = useChat();
  const { setOpen, setOpenMobile } = useSidebar();
  const { data: scheduledMessages = [], mutate: refreshScheduled } = useSWR<
    {
      id: string;
      text: string;
      sendAt: string;
      timezone: string;
      status: string;
      failure: string | null;
    }[]
  >(
    `/api/user/messages/scheduled?chatId=${encodeURIComponent(destination.id)}`,
    read,
    {
      refreshInterval: 15_000,
    },
  );
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandsClosed, setCommandsClosed] = useState(false);
  const commands = commandsClosed ? [] : matchingMessageCommands(text);
  const selectedCommand = Math.min(
    commandIndex,
    Math.max(0, commands.length - 1),
  );
  const invitePreparation = useRef(false);
  const [inviteDraft, setInviteDraft] = useState<PreparedMessageInvite | null>(
    null,
  );
  const [reviewingInvite, setReviewingInvite] = useState(false);
  const [emailRequestDraft, setEmailRequestDraft] = useState<string | null>(
    null,
  );
  const { outbox, submit } = useMessageOutbox(destination.id, () => {
    refresh();
    onSent();
  });
  const [recalled, setRecalled] = useState<Set<string>>(() => new Set());
  const [editing, setEditing] = useState<ChatMessage>();
  const messages = useMemo(
    () =>
      applyReadReceiptPositions(
        mergeMessageOutbox(history?.items ?? [], outbox),
      ).map((message) =>
        recalled.has(`${message.chatId}:${message.id}`)
          ? { ...message, deleted: true, attachments: [], reactions: [] }
          : message,
      ),
    [history?.items, outbox, recalled],
  );
  const forceFollow = useRef(false);
  const scroll = useRef<HTMLDivElement>(null);
  const olderTrigger = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const olderAnchor = useRef<{ element: HTMLElement; top: number } | null>(
    null,
  );
  const showOlder = useCallback(() => {
    loadOlder(() => {
      const node = scroll.current;
      if (!node) return;
      const top = node.getBoundingClientRect().top;
      for (const element of node.querySelectorAll<HTMLElement>(
        "article[data-message-id]",
      )) {
        const rect = element.getBoundingClientRect();
        if (rect.bottom > top) {
          olderAnchor.current = { element, top: rect.top };
          break;
        }
      }
    });
  }, [loadOlder]);
  const hasOlder = Boolean(history?.olderCursor);
  useEffect(() => {
    const node = scroll.current;
    const trigger = olderTrigger.current;
    if (!node || !trigger || !hasOlder || olderError || loadingOlder) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) showOlder();
      },
      { root: node, rootMargin: "120px 0px 0px" },
    );
    observer.observe(trigger);
    return () => observer.disconnect();
  }, [hasOlder, loadingOlder, olderError, showOlder]);
  useFocusedConversation(
    conversation.id,
    messages.findLast((message) => !message.outgoing && !message.deleted)?.id,
    scroll,
  );
  const last = messages.at(-1)?.renderKey;
  const previousLast = useRef<string | undefined>(undefined);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Older pages can shift the scroll anchor without changing the final message.
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    const anchor = olderAnchor.current;
    olderAnchor.current = null;
    if (anchor?.element.isConnected)
      node.scrollTop += anchor.element.getBoundingClientRect().top - anchor.top;
    if (!last || last === previousLast.current) return;
    const follow =
      forceFollow.current || !previousLast.current || nearBottom.current;
    previousLast.current = last;
    forceFollow.current = false;
    if (follow) node.scrollTop = node.scrollHeight;
  }, [history, last]);
  const updateText = (value: string) => {
    setText(value);
    setCommandsClosed(false);
    setCommandIndex(0);
    try {
      if (saveMessageDraft(localStorage, conversation.id, value))
        window.dispatchEvent(new Event(messageDraftEvent));
    } catch {}
  };
  const mentions = useMessageMentions(
    destination.id,
    text,
    updateText,
    composer,
  );
  const send = async () => {
    if (destination.readOnly || (!text.trim() && !attachment)) return;
    if (text.trim().toLowerCase() === "/add") {
      if (attachment) {
        setFailure("Remove the attachment before using /add.");
        return;
      }
      updateText("");
      composer.current?.focus();
      if (addingContactsRef.current) return;
      addingContactsRef.current = true;
      setAddingContacts(true);
      setContactResult("");
      setFailure("");
      setCommandsClosed(true);
      try {
        const result = await addMessageContactsAction({
          chatId: destination.id,
        });
        if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
        const { created, updated, warnings, lines, profiles } = result.data;
        setContactResult(
          `${created} new, ${updated} updated contacts from ${lines} lines.${!created && !updated ? (profiles ? " Participant contact information is already saved." : " No new attributable contact details found.") : ""}${warnings.length ? ` ${warnings.join(" ")}` : ""}`,
        );
        await mutateCache("/api/user/messages/contacts").catch(() => {});
        await mutateCache(
          (key) =>
            typeof key === "string" &&
            key.includes("/api/user/messages/conversations"),
        ).catch(() => {});
      } catch (error) {
        setFailure(
          error instanceof Error
            ? error.message
            : "Could not add contact information.",
        );
      } finally {
        addingContactsRef.current = false;
        setAddingContacts(false);
      }
      return;
    }
    if (text.trim().toLowerCase() === "/invite") {
      if (attachment) {
        setFailure("Remove the attachment before using /invite.");
        return;
      }
      updateText("");
      composer.current?.focus();
      if (invitePreparation.current) return;
      invitePreparation.current = true;
      setPreparingInvite(true);
      setFailure("");
      try {
        const result = await prepareMessageInviteAction({
          chatId: destination.id,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        });
        if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
        if (result.data.kind === "email_request") {
          setEmailRequestDraft(result.data.text);
        } else {
          setInviteDraft(result.data.proposal);
          setReviewingInvite(false);
        }
      } catch (error) {
        setFailure(
          error instanceof Error
            ? error.message
            : "Could not prepare the invitation.",
        );
      } finally {
        invitePreparation.current = false;
        setPreparingInvite(false);
      }
      return;
    }
    if (text.startsWith("/")) {
      if (attachment) {
        setFailure("Remove the attachment before using an AI command.");
        return;
      }
      if (assistantBusy.current) {
        setFailure("The previous AI command is still running.");
        return;
      }
      if (text.trim().length <= 1) return;
      const command = text;
      const chatId = destination.id;
      const pending = commandRetry.current;
      const requestId =
        pending?.text === command && pending.chatId === chatId
          ? pending.id
          : crypto.randomUUID();
      commandRetry.current = { text: command, chatId, id: requestId };
      assistantBusy.current = true;
      setAssistantRunning(true);
      setAssistantResult("");
      setContactResult("");
      setFailure("");
      updateText("");
      composer.current?.focus();
      try {
        const result = await runMessageCommandAction(emailAccountId, {
          command,
          chatId,
          title: conversation.title,
          network: destination.network,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          requestId,
        });
        if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
        commandRetry.current = null;
        if (result.data.scheduled) {
          const { status, sendAt, timezone } = result.data.scheduled;
          if (status === "PENDING" || status === "SENDING") {
            const description = `Scheduled for ${formatScheduledMessageTime(sendAt, timezone)}.`;
            if (composer.current) setAssistantResult(description);
            else toastInfo({ title: "Message scheduled", description });
          } else if (status === "SUBMITTED") {
            setAssistantResult("The scheduled message was submitted.");
          } else {
            setFailure("This scheduling request is no longer active.");
          }
          refreshScheduled();
        } else if (result.data.answer) {
          if (composer.current) setAssistantResult(result.data.answer);
          else
            toastInfo({ title: "AI command", description: result.data.answer });
        }
        if (result.data.assistantChatId) {
          const assistantChatId = result.data.assistantChatId;
          const openChat = () => {
            const showChat = (names: string[]) =>
              names.includes("chat-sidebar")
                ? names
                : [...names, "chat-sidebar"];
            setChatId(assistantChatId);
            setOpen(showChat);
            setOpenMobile(showChat);
          };
          if (composer.current) openChat();
          else
            toastInfo({
              title: "Continue in Chat",
              description: conversation.title,
              action: { label: "Open Chat", onClick: openChat },
            });
        }
      } catch (error) {
        const description =
          error instanceof Error
            ? error.message
            : "The AI command could not finish.";
        if (composer.current) setFailure(description);
        else toastError({ title: "AI command", description });
        try {
          if (!localStorage.getItem(messageDraftPrefix + conversation.id)) {
            if (composer.current) updateText(command);
            else if (saveMessageDraft(localStorage, conversation.id, command))
              window.dispatchEvent(new Event(messageDraftEvent));
          }
        } catch {}
      } finally {
        assistantBusy.current = false;
        setAssistantRunning(false);
      }
      return;
    }
    forceFollow.current = true;
    submit(text, attachment, replyTo, mentions.mentions);
    mentions.reset();
    setReplyTo(null);
    updateText("");
    setAttachment(null);
    setFailure("");
  };
  return (
    <div
      className="flex h-full min-h-0 flex-col bg-background"
      data-message-network={conversation.network}
      data-command-context={JSON.stringify({
        tab: "messages",
        chatId: destination.id,
        accountId: destination.accountId,
        title: conversation.title,
        network: destination.network,
      })}
      style={{
        ...conversationTheme(destination.network),
        ...(conversation.members
          ? {
              backgroundImage: conversationGradient(
                conversation.members,
                destination.network,
              ),
            }
          : {}),
      }}
    >
      {inviteDraft && reviewingInvite && (
        <MessageInviteDialog
          proposal={inviteDraft}
          onClose={() => {
            setInviteDraft(null);
            setReviewingInvite(false);
          }}
        />
      )}
      <header className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
        <Button
          variant="ghost"
          size="icon"
          aria-label="Back to conversations"
          className="md:hidden"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" />
        </Button>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold">
            {conversation.title}
          </h2>
          <p className="truncate text-xs text-muted-foreground">
            {networkName(conversation.network)} · {conversation.account}
            {conversation.group ? " · Group" : ""}
          </p>
        </div>
      </header>
      {refreshError && history && (
        <div className="shrink-0 border-b px-3 py-1 text-xs text-muted-foreground">
          Could not refresh messages. Retrying automatically.
        </div>
      )}
      <div
        ref={scroll}
        role="log"
        aria-label="Conversation messages"
        className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 [overflow-anchor:none]"
        onScroll={(event) => {
          const node = event.currentTarget;
          nearBottom.current =
            node.scrollHeight - node.scrollTop - node.clientHeight < 180;
        }}
      >
        {hasOlder && (
          <div ref={olderTrigger}>
            <Button
              variant="ghost"
              className="w-full"
              disabled={loadingOlder}
              onClick={showOlder}
            >
              {loadingOlder
                ? "Loading older messages…"
                : olderError
                  ? "Retry loading older messages"
                  : "Load older messages"}
            </Button>
            {olderError && (
              <p
                role="status"
                className="text-center text-xs text-muted-foreground"
              >
                {olderError}
              </p>
            )}
          </div>
        )}
        <LoadingContent
          loading={!history && !refreshError && !messages.length}
          error={
            refreshError && !history && !messages.length
              ? { error: refreshError }
              : undefined
          }
        >
          {messages.map((message) => {
            const mediaOnly =
              !message.deleted &&
              !message.text.trim() &&
              !message.replyToMessageId &&
              message.attachments.length === 1 &&
              message.attachments.every(
                (item) =>
                  item.type === "video" ||
                  (item.type === "img" &&
                    /image\/(png|jpeg|gif|webp|avif)/.test(item.mime)),
              );
            const inlineDelivery =
              message.outgoing &&
              !message.deleted &&
              !message.attachments.length &&
              !message.attachmentName &&
              !messagePreviewLinks(message.text, message.links).length;
            return (
              <article
                key={message.renderKey}
                data-message-id={message.id}
                data-message-chat-id={message.chatId}
                className={`group/message relative w-fit max-w-[92%] rounded-lg border text-sm ${mediaOnly ? "p-0" : "px-3 py-2"} ${message.outgoing ? "ml-auto bg-muted/60" : "mr-auto bg-background/70"}`}
                style={{
                  ...conversationTheme(
                    conversation.members?.find(
                      (member) => member.id === message.chatId,
                    )?.network ?? conversation.network,
                  ),
                  ...(!message.deleted &&
                  (message.canReact ||
                    message.canRecall ||
                    message.canReply ||
                    message.canEdit ||
                    canForwardMessage(message))
                    ? { maxWidth: "min(92%, calc(100% - 6rem))" }
                    : {}),
                }}
              >
                <header
                  className={`${mediaOnly ? "w-0 min-w-full overflow-hidden px-3 py-2" : "mb-1"} flex items-center gap-3 text-[10px] text-muted-foreground`}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {message.outgoing ? "You" : message.sender}
                  </span>
                  <time
                    className="shrink-0 whitespace-nowrap"
                    title={new Date(message.time).toLocaleString()}
                  >
                    {shortTime(message.time, true)}
                  </time>
                  {message.editedAt && (
                    <span
                      title={`Edited ${new Date(message.editedAt).toLocaleString()}`}
                      className="shrink-0"
                    >
                      edited
                    </span>
                  )}
                </header>
                {message.deleted ? (
                  <p>Message recalled or deleted</p>
                ) : (
                  <>
                    {message.replyToMessageId &&
                      (() => {
                        const original = messages.find(
                          (item) => item.id === message.replyToMessageId,
                        );
                        const quote = original ?? message.replyToPreview;
                        return (
                          <button
                            type="button"
                            aria-label="View replied-to message"
                            className="mb-2 block w-full border-l-2 border-muted-foreground/50 bg-muted/40 px-2 py-1 text-left text-xs text-muted-foreground"
                            onClick={() => {
                              scroll.current
                                ?.querySelector<HTMLElement>(
                                  `[data-message-chat-id="${CSS.escape(message.chatId)}"][data-message-id="${CSS.escape(message.replyToMessageId!)}"]`,
                                )
                                ?.scrollIntoView({
                                  block: "center",
                                  behavior: "smooth",
                                });
                            }}
                          >
                            <span className="block truncate font-medium">
                              {original?.outgoing
                                ? "You"
                                : quote?.sender || "Earlier message"}
                            </span>
                            <span className="block truncate">
                              {original?.deleted
                                ? "Message recalled or deleted"
                                : quote?.text ||
                                  (original?.attachments.length
                                    ? "Attachment"
                                    : "Original message is not loaded")}
                            </span>
                          </button>
                        );
                      })()}
                    {editing?.id === message.id &&
                    editing.chatId === message.chatId ? (
                      <MessageEditor
                        message={editing}
                        onCancel={() => setEditing(undefined)}
                        onSaved={(updated) => {
                          setEditing(undefined);
                          updateMessage(
                            updated.chatId,
                            updated.id,
                            () => updated,
                          );
                          onSent();
                        }}
                      />
                    ) : (
                      <>
                        <div className="flex items-end gap-3">
                          <div className="min-w-0">
                            <MessageText text={message.text} />
                          </div>
                          {inlineDelivery && (
                            <MessageDelivery message={message} inline />
                          )}
                        </div>
                        <MessageLinkCards message={message} />
                      </>
                    )}
                  </>
                )}
                {!message.deleted &&
                  message.attachments.map((item) => {
                    const url = `/api/user/messages/asset?${new URLSearchParams({ chatId: message.chatId, messageId: message.id, index: String(item.index) })}`;
                    return (
                      <div key={item.index} className={mediaOnly ? "" : "mt-2"}>
                        {item.type === "img" &&
                        /image\/(png|jpeg|gif|webp|avif)/.test(item.mime) ? (
                          <MessageMedia
                            url={url}
                            name={item.name}
                            withHeader={mediaOnly}
                          />
                        ) : item.type === "video" ? (
                          <MessageMedia
                            url={url}
                            name={item.name}
                            video
                            withHeader={mediaOnly}
                          />
                        ) : item.type === "audio" ? (
                          <audio
                            src={url}
                            controls
                            preload="metadata"
                            className="max-w-full"
                          >
                            <track kind="captions" />
                          </audio>
                        ) : null}
                        {!mediaOnly && (
                          <a
                            className="mt-1 block break-all text-xs text-muted-foreground underline"
                            href={url}
                            download={item.name}
                          >
                            {item.name}
                          </a>
                        )}
                      </div>
                    );
                  })}
                {message.attachmentName && (
                  <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
                    <Paperclip className="size-3" />
                    {message.attachmentName}
                  </p>
                )}
                <div
                  className={
                    mediaOnly
                      ? "contents"
                      : "flex items-end justify-between gap-2"
                  }
                >
                  {!message.deleted &&
                    (editing?.id !== message.id ||
                      editing.chatId !== message.chatId) && (
                      <MessageActions
                        media={mediaOnly}
                        message={message}
                        onEdit={() => setEditing(message)}
                        onForward={() => onForward(message)}
                        allowedReactions={history?.allowedReactions}
                        onReply={() => {
                          setSendingVia(message.chatId);
                          setReplyTo(message);
                          composer.current?.focus();
                        }}
                        onRecalled={() =>
                          setRecalled((previous) =>
                            new Set(previous).add(
                              `${message.chatId}:${message.id}`,
                            ),
                          )
                        }
                        onReaction={(key, remove) => {
                          updateMessage(message.chatId, message.id, (item) => {
                            const reactions = (item.reactions ?? []).map(
                              (reaction) => ({ ...reaction }),
                            );
                            const existing = reactions.find(
                              (reaction) => reaction.key === key,
                            );
                            if (existing) {
                              existing.count += remove
                                ? -1
                                : existing.mine
                                  ? 0
                                  : 1;
                              existing.mine = !remove;
                            } else if (!remove)
                              reactions.push({
                                key,
                                count: 1,
                                mine: true,
                              });
                            return {
                              ...item,
                              reactions: reactions.filter(
                                (reaction) => reaction.count > 0,
                              ),
                            };
                          });
                        }}
                      />
                    )}
                  {message.outgoing && !message.deleted && !inlineDelivery && (
                    <div
                      className={
                        mediaOnly
                          ? "absolute bottom-2 right-2 rounded bg-black/40 px-1"
                          : undefined
                      }
                    >
                      <MessageDelivery message={message} />
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </LoadingContent>
      </div>
      <div className="relative shrink-0 border-t bg-background p-3">
        {(addingContacts || preparingInvite || assistantRunning) && (
          <div
            role="progressbar"
            aria-label={
              assistantRunning
                ? "Running AI command"
                : addingContacts
                  ? "Adding contacts"
                  : "Preparing invitation"
            }
            aria-valuetext="In progress"
            className="message-command-progress"
          >
            <span />
          </div>
        )}
        {scheduledMessages.length > 0 && (
          <details className="mb-2 text-xs text-muted-foreground">
            <summary className="w-fit cursor-pointer">
              Scheduled messages ({scheduledMessages.length})
            </summary>
            {scheduledMessages.map((message) => (
              <div
                key={message.id}
                className="mt-1 flex min-w-0 items-center gap-2"
              >
                <time dateTime={message.sendAt}>
                  {formatScheduledMessageTime(message.sendAt, message.timezone)}
                </time>
                <span className="min-w-0 flex-1 truncate" title={message.text}>
                  {message.text}
                </span>
                {message.status === "PENDING" ? (
                  <button
                    type="button"
                    className="underline"
                    onClick={async () => {
                      const result = await cancelScheduledMessageAction({
                        id: message.id,
                      });
                      if (!result?.data)
                        setFailure(getActionErrorMessage(result ?? {}));
                      refreshScheduled();
                    }}
                  >
                    Cancel
                  </button>
                ) : message.status === "FAILED" ? (
                  <span
                    role="status"
                    className="text-destructive"
                    title={message.failure ?? undefined}
                  >
                    Failed
                  </span>
                ) : (
                  <span>Sending</span>
                )}
              </div>
            ))}
          </details>
        )}
        <div
          role="separator"
          aria-label="Resize message input"
          aria-orientation="horizontal"
          aria-valuemin={40}
          aria-valuemax={360}
          aria-valuenow={composerHeight}
          tabIndex={0}
          className="absolute -top-1 left-0 z-10 h-2 w-full cursor-row-resize touch-none hover:bg-muted-foreground/20 focus-visible:bg-muted-foreground/20 focus-visible:outline-none"
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.preventDefault();
            composerDrag.current = { y: event.clientY, height: composerHeight };
            event.currentTarget.setPointerCapture(event.pointerId);
          }}
          onPointerMove={(event) => {
            if (composerDrag.current)
              resizeComposer(
                composerDrag.current.height +
                  composerDrag.current.y -
                  event.clientY,
              );
          }}
          onPointerUp={(event) => {
            composerDrag.current = null;
            if (event.currentTarget.hasPointerCapture(event.pointerId))
              event.currentTarget.releasePointerCapture(event.pointerId);
          }}
          onLostPointerCapture={() => {
            composerDrag.current = null;
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp" || event.key === "ArrowDown") {
              event.preventDefault();
              event.stopPropagation();
              resizeComposer(
                composerHeight + (event.key === "ArrowUp" ? 8 : -8),
              );
            }
          }}
        />
        {inviteDraft && !reviewingInvite && (
          <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setReviewingInvite(true)}
            >
              Review invitation
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setInviteDraft(null)}
            >
              Dismiss
            </Button>
          </div>
        )}
        {emailRequestDraft && (
          <div className="mb-2 text-xs text-muted-foreground">
            An email address is needed.{" "}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                updateText(emailRequestDraft);
                setEmailRequestDraft(null);
                composer.current?.focus();
              }}
            >
              Use email request draft
            </Button>
          </div>
        )}
        {failure && (
          <p role="alert" className="mb-2 text-xs text-destructive">
            {failure}
          </p>
        )}
        {replyTo && (
          <div
            role="status"
            aria-label="Replying to message"
            className="mb-2 flex min-w-0 items-center gap-2 border-l-2 border-muted-foreground/50 bg-muted/40 px-2 py-1 text-xs text-muted-foreground"
          >
            <div className="min-w-0 flex-1">
              <span className="block truncate font-medium">
                Replying to {replyTo.outgoing ? "You" : replyTo.sender}
              </span>
              <span className="block truncate">
                {replyTo.text || "Attachment"}
              </span>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="size-6 shrink-0"
              aria-label="Cancel reply"
              onClick={() => {
                setReplyTo(null);
                composer.current?.focus();
              }}
            >
              <X className="size-3" />
            </Button>
          </div>
        )}
        {attachment && (
          <PendingMessageAttachment
            file={attachment}
            onRemove={() => setAttachment(null)}
          />
        )}
        <div
          className="relative flex items-stretch gap-2"
          style={{ height: composerHeight }}
        >
          {!addingContacts &&
            !assistantRunning &&
            (assistantResult || contactResult) && (
              <p
                role="status"
                className="absolute bottom-full left-0 right-0 mb-1 rounded border bg-background p-2 text-xs text-muted-foreground"
              >
                {assistantResult || contactResult}
              </p>
            )}
          {commands.length > 0 && (
            <div
              id="message-command-menu"
              role="listbox"
              aria-label="Message commands"
              className="absolute bottom-full left-12 right-12 z-30 mb-2 overflow-hidden rounded-md border bg-popover p-1 shadow-lg"
            >
              {commands.map((item, index) => (
                <button
                  key={item.command}
                  id={`message-command-${index}`}
                  type="button"
                  role="option"
                  aria-selected={index === selectedCommand}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setCommandIndex(index)}
                  onClick={() => {
                    updateText(item.command);
                    setCommandsClosed(true);
                    composer.current?.focus();
                  }}
                  className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm ${index === selectedCommand ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
                >
                  <span className="font-medium">{item.command}</span>
                  <span className="text-xs text-muted-foreground">
                    {item.description}
                  </span>
                </button>
              ))}
            </div>
          )}
          <MessageMentionPicker value={mentions} />
          {conversation.members && (
            <select
              aria-label="Send via"
              className="h-full w-28 shrink-0 rounded-md border bg-background px-2 text-xs"
              value={destination.id}
              onChange={(event) => {
                setSendingVia(event.target.value);
                setReplyTo(null);
              }}
            >
              {conversation.members.map((member) => (
                <option key={member.id} value={member.id}>
                  {networkName(member.network)}
                  {conversation.members!.filter(
                    (item) =>
                      networkName(item.network) === networkName(member.network),
                  ).length > 1
                    ? ` ? ${member.account}`
                    : ""}
                </option>
              ))}
            </select>
          )}
          <label
            className={`inline-flex h-full w-10 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground ${destination.readOnly ? "pointer-events-none opacity-40" : "hover:bg-muted"}`}
            title="Attach a file"
          >
            <Paperclip className="size-4" />
            <input
              type="file"
              aria-label="Attach a message file"
              className="sr-only"
              disabled={destination.readOnly}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                if (!file) return;
                attachFile(file);
              }}
            />
          </label>
          <textarea
            data-slash-native
            ref={composer}
            aria-label="Reply to conversation"
            placeholder={
              destination.readOnly
                ? "Read-only conversation"
                : "Write a message… (/ for commands)"
            }
            value={text}
            aria-autocomplete="list"
            aria-controls={
              mentions.visible
                ? "message-mention-menu"
                : commands.length
                  ? "message-command-menu"
                  : undefined
            }
            aria-activedescendant={
              mentions.visible && mentions.candidates.length
                ? `message-mention-${mentions.selected}`
                : commands.length
                  ? `message-command-${selectedCommand}`
                  : undefined
            }
            rows={1}
            disabled={destination.readOnly}
            onPaste={(event) => {
              if (destination.readOnly) return;
              const file =
                Array.from(event.clipboardData.items)
                  .find(
                    (item) =>
                      item.kind === "file" && item.type.startsWith("image/"),
                  )
                  ?.getAsFile() ??
                Array.from(event.clipboardData.files).find((file) =>
                  file.type.startsWith("image/"),
                );
              if (!file) return;
              event.preventDefault();
              attachFile(file);
            }}
            onChange={(event) =>
              mentions.change(event.target.value, event.target.selectionStart)
            }
            onSelect={(event) =>
              mentions.setCaret(
                event.currentTarget.selectionStart ===
                  event.currentTarget.selectionEnd
                  ? event.currentTarget.selectionStart
                  : -1,
              )
            }
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (mentions.handleKeyDown(event)) return;
              if (commands.length) {
                if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                  event.preventDefault();
                  setCommandIndex(
                    (selectedCommand +
                      (event.key === "ArrowDown" ? 1 : commands.length - 1)) %
                      commands.length,
                  );
                  return;
                }
                if (event.key === "Escape") {
                  event.preventDefault();
                  setCommandsClosed(true);
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  const command = commands[selectedCommand].command;
                  setCommandsClosed(true);
                  if (text.toLowerCase() === command) send();
                  else {
                    updateText(command);
                    setCommandsClosed(true);
                  }
                  return;
                }
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                send();
              }
            }}
            className="h-full min-h-0 min-w-0 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm leading-5"
          />
          <Button
            size="icon"
            aria-label="Send message"
            className="h-full w-10 shrink-0"
            disabled={destination.readOnly || (!text.trim() && !attachment)}
            onClick={send}
          >
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function formatScheduledMessageTime(sendAt: Date | string, timezone: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: timezone,
    timeZoneName: "short",
  }).format(new Date(sendAt));
}

function BeeperSettings({
  open,
  onClose,
  status,
  onConnected,
}: {
  open: boolean;
  onClose: () => void;
  status?: BeeperStatus;
  onConnected: () => void;
}) {
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [groupsOpen, setGroupsOpen] = useState(false);
  const {
    data: groupPages,
    error: groupsError,
    mutate: refreshGroups,
    size: groupSize,
    setSize: setGroupSize,
    isValidating: groupsLoading,
  } = useSWRInfinite<{
    items: { id: string; title: string; approved: boolean }[];
    hasMore: boolean;
    cursor: string | null;
  }>(
    (index, previous) =>
      !open ||
      !groupsOpen ||
      !status?.running ||
      (previous && !previous.hasMore)
        ? null
        : `/api/user/messages/discord-groups${index ? `?cursor=${encodeURIComponent(previous!.cursor!)}` : ""}`,
    read,
  );
  const groups = groupPages?.flatMap((page) => page.items);
  const connect = async () => {
    setBusy(true);
    setFailure("");
    try {
      const result = await connectBeeperAction({ token });
      actionError(result);
      setToken("");
      onConnected();
    } catch (error) {
      setFailure((error as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!value) {
          setToken("");
          onClose();
        }
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogTitle>Messages settings</DialogTitle>
        <DialogDescription>
          Connect the Beeper Desktop app running on this computer. Your access
          token is encrypted and stays on this installation.
        </DialogDescription>
        <ol className="list-inside list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            Sign in to Beeper and link WhatsApp, WeChat, Discord, and Google
            Messages.
          </li>
          <li>In Beeper Settings → Integrations, enable the Desktop API.</li>
          <li>
            Add an approved connection, then paste its access token below.
          </li>
        </ol>
        <label className="space-y-1 text-sm">
          Beeper access token
          <input
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="block h-9 w-full rounded-md border bg-background px-2"
          />
        </label>
        <Button disabled={busy || !token.trim()} onClick={connect}>
          {busy
            ? "Connecting…"
            : status?.configured
              ? "Update connection"
              : "Connect Beeper"}
        </Button>
        {failure && (
          <p role="alert" className="text-xs text-destructive">
            {failure}
          </p>
        )}
        {status?.accounts.map((item) => (
          <p key={item.id} className="text-xs text-muted-foreground">
            {networkName(item.network)} · {item.name} ·{" "}
            {item.status.replaceAll("_", " ")}
          </p>
        ))}
        <p className="text-xs text-muted-foreground">
          Discord one-to-one DMs are included. Server channels stay excluded.
          WhatsApp, WeChat, and SMS groups appear normally.
        </p>
        {open && <BeeperRecoverySettings open={open} onUpdated={onConnected} />}
        {status?.running && (
          <>
            <Button
              variant="outline"
              onClick={() => setGroupsOpen((value) => !value)}
            >
              Choose private Discord groups
            </Button>
            {groupsOpen && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">
                  Beeper does not distinguish server channels from group DMs
                  here. Only check conversations you recognize as private group
                  DMs; leave every server channel unchecked.
                </p>
                {groupsError && (
                  <p role="alert" className="text-xs text-destructive">
                    Could not load Discord groups.{" "}
                    <button type="button" onClick={() => refreshGroups()}>
                      Retry
                    </button>
                  </p>
                )}
                {!groups && !groupsError && (
                  <p className="text-xs text-muted-foreground">
                    Loading Discord groups…
                  </p>
                )}
                {groups?.map((item) => (
                  <label
                    key={item.id}
                    className="flex items-start gap-2 text-xs"
                  >
                    <input
                      type="checkbox"
                      checked={item.approved}
                      onChange={async (event) => {
                        const include = event.target.checked;
                        setBusy(true);
                        setFailure("");
                        try {
                          const result = await setBeeperGroupAction({
                            chatId: item.id,
                            include,
                          });
                          actionError(result);
                          refreshGroups();
                          onConnected();
                        } catch (error) {
                          setFailure((error as Error).message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    />
                    {item.title}
                  </label>
                ))}
                {groupPages?.at(-1)?.hasMore && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={groupsLoading}
                    onClick={() => setGroupSize(groupSize + 1)}
                  >
                    Load more Discord groups
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function MessageDelivery({
  message,
  inline = false,
}: {
  message: ReturnType<typeof mergeMessageOutbox>[number];
  inline?: boolean;
}) {
  const state = message.error ? "failed" : messageDelivery(message);
  const Icon =
    state === "read"
      ? CheckCheck
      : state === "sent"
        ? Check
        : state === "pending"
          ? Clock3
          : CircleAlert;
  const label = message.error
    ? "Delivery unconfirmed"
    : state === "read"
      ? "Read"
      : state === "sent"
        ? "Sent"
        : state === "pending"
          ? "Sending"
          : "Delivery failed";
  return (
    <div
      className={
        inline
          ? "ml-auto flex shrink-0 justify-end"
          : "ml-auto mt-1 flex justify-end"
      }
      style={inline ? { paddingBottom: 2 } : undefined}
    >
      <span
        role="img"
        aria-label={label}
        title={message.error || label}
        className={
          state === "failed" ? "text-destructive" : "text-muted-foreground"
        }
      >
        <Icon className="size-3.5" aria-hidden="true" />
      </span>
    </div>
  );
}

function conversationGradient(
  members: Conversation[],
  sendingNetwork: string,
): string {
  const selected = networkName(sendingNetwork);
  const networks = [
    ...new Set(members.map((member) => networkName(member.network))),
  ].filter((network) => network !== selected);
  networks.push(selected);
  const colors = networks.map((network) => networkColor(network, 18, 12));
  if (colors.length === 1) colors.push(colors[0]);
  return `linear-gradient(to bottom, ${colors.join(", ")})`;
}

function conversationTheme(network: string): CSSProperties {
  const h = hue(network);
  const saturation = networkName(network) === "SMS" ? 0 : 18;
  return {
    "--background": `${h} ${saturation}% 12%`,
    "--muted": `${h} ${saturation * 0.75}% 19%`,
    "--border": `${h} ${saturation * 0.75}% 24%`,
    "--input": `${h} ${saturation * 0.75}% 24%`,
    "--accent": `${h} ${saturation * 0.75}% 22%`,
  } as CSSProperties;
}

function messageTagTone(label: string) {
  switch (label.trim().toLowerCase()) {
    case "business":
      return "blue" as const;
    case "casual":
      return "green" as const;
    default:
      return "gray" as const;
  }
}
