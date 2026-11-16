"use client";

import { useRef, useState } from "react";
import {
  Forward,
  MoreHorizontal,
  Pencil,
  Reply,
  SmilePlus,
  Undo2,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  recallBeeperMessageAction,
  reactBeeperMessageAction,
} from "@/utils/actions/beeper";
import { getActionErrorMessage } from "@/utils/error";
import type { ChatMessage } from "@/utils/beeper/types";
import { canForwardMessage } from "@/utils/beeper/message-forward";

export function MessageActions({
  message,
  media = false,
  allowedReactions,
  onRecalled,
  onReaction,
  onReply,
  onForward,
  onEdit,
}: {
  message: ChatMessage;
  media?: boolean;
  allowedReactions?: string[];
  onRecalled: () => void;
  onReaction: (key: string, remove: boolean) => void;
  onReply?: () => void;
  onForward?: () => void;
  onEdit?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const pointerDismissed = useRef(false);
  const canForward = Boolean(onForward && canForwardMessage(message));
  const canEdit = Boolean(onEdit && message.canEdit && message.editRevision);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const react = async (key: string, remove = false) => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await reactBeeperMessageAction({
        chatId: message.chatId,
        messageId: message.id,
        reactionKey: key,
        remove,
        requestId: crypto.randomUUID(),
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      onReaction(key, remove);
      setOpen(false);
      setCustom("");
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not update the reaction.",
      );
    } finally {
      setBusy(false);
    }
  };
  const recall = async () => {
    if (busy) return;
    setBusy(true);
    setFailure("");
    try {
      const result = await recallBeeperMessageAction({
        chatId: message.chatId,
        messageId: message.id,
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      onRecalled();
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not recall the message.",
      );
    } finally {
      setBusy(false);
    }
  };
  if (
    message.deleted ||
    (!message.canReact &&
      !(message.canReply && onReply) &&
      !message.canRecall &&
      !canEdit &&
      !canForward &&
      !message.reactions?.length &&
      !failure)
  )
    return null;
  return (
    <div
      className={
        media
          ? "contents"
          : `${message.reactions?.length || failure ? "mt-1 " : ""}flex flex-wrap items-center gap-1`
      }
    >
      <div
        className={
          media ? "absolute bottom-2 left-2 flex flex-wrap gap-1" : "contents"
        }
      >
        {message.reactions?.map((reaction) => (
          <button
            key={reaction.key}
            type="button"
            disabled={busy || !message.canReact}
            aria-label={`${reaction.mine ? "Remove" : "Add"} reaction ${reaction.key}`}
            aria-pressed={reaction.mine}
            title={`${reaction.count} reaction${reaction.count === 1 ? "" : "s"}`}
            className={`rounded-full border px-1.5 py-0.5 text-xs ${reaction.mine ? "border-muted-foreground bg-muted" : "border-transparent bg-muted/50"}`}
            onClick={() => react(reaction.key, reaction.mine)}
          >
            {reaction.key}{" "}
            <span className="text-muted-foreground">{reaction.count}</span>
          </button>
        ))}
      </div>
      <div
        data-message-action-area=""
        className="absolute inset-y-0 flex w-max items-end pb-2"
        style={
          message.outgoing
            ? { right: "100%", paddingRight: 8 }
            : { left: "100%", paddingLeft: 8 }
        }
      >
        <div
          data-message-actions=""
          className={`flex items-center gap-1 opacity-0 pointer-events-none group-hover/message:opacity-100 group-hover/message:pointer-events-auto group-focus-within/message:opacity-100 group-focus-within/message:pointer-events-auto [@media(hover:none)]:opacity-100 [@media(hover:none)]:pointer-events-auto ${open || menuOpen ? "!opacity-100 !pointer-events-auto" : ""}`}
        >
          {message.canReply && onReply && (
            <Button
              size="icon"
              variant="ghost"
              className="size-6 text-muted-foreground"
              aria-label="Reply to message"
              title="Reply"
              onClick={onReply}
            >
              <Reply className="size-3.5" />
            </Button>
          )}
          {message.canReact && (
            <Popover open={open} onOpenChange={setOpen}>
              <PopoverTrigger asChild>
                <Button
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground"
                  aria-label="React to message"
                  title="React"
                >
                  <SmilePlus className="size-3.5" />
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-64 p-2" align="end">
                <div className="flex flex-wrap gap-1">
                  {(
                    allowedReactions ?? [
                      "👍",
                      "❤️",
                      "😂",
                      "😮",
                      "😢",
                      "🙏",
                      "🎉",
                      "👀",
                    ]
                  ).map((emoji) => (
                    <Button
                      key={emoji}
                      variant="ghost"
                      size="icon"
                      aria-label={`React ${emoji}`}
                      disabled={busy}
                      onClick={() => react(emoji)}
                    >
                      {emoji}
                    </Button>
                  ))}
                </div>
                {!allowedReactions && (
                  <form
                    className="mt-2 flex gap-1"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (custom.trim()) react(custom.trim());
                    }}
                  >
                    <input
                      aria-label="Other reaction"
                      placeholder="Another emoji"
                      maxLength={128}
                      className="min-w-0 flex-1 rounded border bg-background px-2 text-sm"
                      value={custom}
                      onChange={(event) => setCustom(event.target.value)}
                    />
                    <Button size="sm" disabled={busy || !custom.trim()}>
                      React
                    </Button>
                  </form>
                )}
              </PopoverContent>
            </Popover>
          )}
          {(canForward || message.canRecall || canEdit) && (
            <DropdownMenu
              open={menuOpen}
              onOpenChange={(next) => {
                if (next) pointerDismissed.current = false;
                setMenuOpen(next);
              }}
            >
              <DropdownMenuTrigger asChild>
                <Button
                  ref={menuTrigger}
                  size="icon"
                  variant="ghost"
                  className="size-6 text-muted-foreground"
                  aria-label="More message actions"
                  title="More actions"
                >
                  <MoreHorizontal className="size-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align={message.outgoing ? "end" : "start"}
                onPointerDownOutside={() => {
                  pointerDismissed.current = true;
                }}
                onCloseAutoFocus={(event) => {
                  if (!pointerDismissed.current) return;
                  event.preventDefault();
                  menuTrigger.current?.blur();
                  pointerDismissed.current = false;
                }}
              >
                {canEdit && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => requestAnimationFrame(() => onEdit?.())}
                  >
                    <Pencil className="mr-2 size-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canForward && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      requestAnimationFrame(() => onForward?.());
                    }}
                  >
                    <Forward className="mr-2 size-4" />
                    Forward
                  </DropdownMenuItem>
                )}
                {message.canRecall && (
                  <DropdownMenuItem
                    disabled={busy}
                    onSelect={() => {
                      recall();
                    }}
                    className="text-rose-400 focus:text-rose-300"
                  >
                    <Undo2 className="mr-2 size-4" />
                    Recall
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </div>
      {failure && (
        <p role="alert" className="w-full text-xs text-destructive">
          {failure}
        </p>
      )}
    </div>
  );
}
