"use client";

import { useEffect, useRef, useState } from "react";
import { Forward, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ChatMessage, Conversation } from "@/utils/beeper/types";
import { prepareMessageForward } from "@/utils/beeper/message-forward";
import { networkName, networkColor } from "@/utils/beeper/network";
import { useMessageOutbox } from "./useMessageOutbox";

export function ForwardMessageDialog({
  message,
  conversations,
  hasMore,
  loadingMore,
  onLoadMore,
  onClose,
  onForwarded,
  onSubmitted,
}: {
  message: ChatMessage;
  conversations: Conversation[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onClose: () => void;
  onForwarded: (conversation: Conversation) => void;
  onSubmitted: () => void;
}) {
  const [query, setQuery] = useState("");
  const [target, setTarget] = useState<Conversation | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const abort = useRef<AbortController | null>(null);
  const { submit } = useMessageOutbox(target?.id ?? "", onSubmitted);
  useEffect(() => () => abort.current?.abort(), []);
  const items = conversations.filter(
    (item) =>
      !item.readOnly &&
      `${item.title} ${item.account} ${networkName(item.network)}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  const forward = async () => {
    if (!target || busy) return;
    setBusy(true);
    setFailure("");
    const controller = new AbortController();
    abort.current = controller;
    try {
      const prepared = await prepareMessageForward(message, controller.signal);
      if (prepared.attachments.length)
        prepared.attachments.forEach((file, index) =>
          submit(index === 0 ? prepared.text : "", file),
        );
      else submit(prepared.text, null);
      onForwarded(target);
    } catch (error) {
      if (!controller.signal.aborted)
        setFailure(
          error instanceof Error
            ? error.message
            : "Could not prepare this message.",
        );
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) {
          abort.current?.abort();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Forward message</DialogTitle>
          <DialogDescription>
            Choose a conversation to send a copy of this message and its
            attachments.
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-24 overflow-y-auto rounded border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <p className="whitespace-pre-wrap break-words">{message.text}</p>
          {message.attachments.length > 0 && (
            <p className="mt-1 text-xs">
              {message.attachments.map((item) => item.name).join(", ")}
            </p>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input
            autoFocus
            aria-label="Search forwarding conversations"
            placeholder="Search conversations"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="pl-9"
          />
        </div>
        <div
          role="listbox"
          aria-label="Forward to conversation"
          className="max-h-72 overflow-y-auto space-y-1"
        >
          {items.map((item) => (
            <button
              type="button"
              role="option"
              aria-selected={target?.id === item.id}
              key={item.id}
              disabled={busy}
              onClick={() => setTarget(item)}
              className={`flex w-full items-center gap-3 rounded px-3 py-2 text-left hover:bg-muted ${target?.id === item.id ? "bg-muted ring-1 ring-border" : ""}`}
            >
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ backgroundColor: networkColor(item.network, 60, 65) }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{item.title}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {networkName(item.network)} · {item.account}
                </span>
              </span>
            </button>
          ))}
          {!items.length && (
            <p className="p-3 text-center text-sm text-muted-foreground">
              No matching conversations.
            </p>
          )}
          {hasMore && (
            <Button
              variant="ghost"
              className="w-full"
              disabled={loadingMore || busy}
              onClick={onLoadMore}
            >
              {loadingMore ? "Loading…" : "Load more conversations"}
            </Button>
          )}
        </div>
        {failure && (
          <p role="alert" className="text-sm text-destructive">
            {failure}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button
            variant="ghost"
            onClick={() => {
              abort.current?.abort();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button disabled={!target || busy} onClick={forward}>
            <Forward className="mr-2 size-4" />
            {busy ? "Preparing…" : "Forward"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
