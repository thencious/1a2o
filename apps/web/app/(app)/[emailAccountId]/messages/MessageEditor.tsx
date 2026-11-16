"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { ChatMessage } from "@/utils/beeper/types";
import { editBeeperMessageAction } from "@/utils/actions/beeper";
import { getActionErrorMessage } from "@/utils/error";

export function MessageEditor({
  message,
  onSaved,
  onCancel,
}: {
  message: ChatMessage;
  onSaved: (message: ChatMessage) => void;
  onCancel: () => void;
}) {
  const key = `zenro:message-edit:${message.chatId}:${message.id}:${message.editRevision}`;
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? message.text;
    } catch {
      return message.text;
    }
  });
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const pending = useRef(false);
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
    field.current?.setSelectionRange(
      field.current.value.length,
      field.current.value.length,
    );
  }, []);
  const clear = () => {
    try {
      localStorage.removeItem(key);
    } catch {}
  };
  const cancel = () => {
    if (pending.current) return;
    clear();
    onCancel();
  };
  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || !text.trim()) return;
    if (text === message.text) {
      cancel();
      return;
    }
    pending.current = true;
    setBusy(true);
    setFailure("");
    try {
      const result = await editBeeperMessageAction({
        chatId: message.chatId,
        messageId: message.id,
        text,
        revision: message.editRevision ?? "",
      });
      if (!result?.data) throw new Error(getActionErrorMessage(result ?? {}));
      clear();
      onSaved(result.data);
    } catch (error) {
      setFailure(
        error instanceof Error
          ? error.message
          : "Could not save this edit. Your text is still here.",
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  return (
    <form
      onSubmit={save}
      aria-label="Edit message"
      className="w-[min(24rem,65vw)] max-w-full space-y-2"
    >
      <Textarea
        ref={field}
        data-slash-native
        aria-label="Edit message text"
        value={text}
        disabled={busy}
        maxLength={20_000}
        rows={3}
        className="min-h-20 resize-none bg-background text-foreground"
        onChange={(event) => {
          setText(event.target.value);
          try {
            localStorage.setItem(key, event.target.value);
          } catch {}
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            cancel();
          } else if (event.key === "Enter" && !event.shiftKey) {
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {failure && (
        <p role="alert" className="text-xs text-rose-400">
          {failure}
        </p>
      )}
      <div className="flex items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={cancel}
        >
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Saving…" : "Save edit"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Enter to save · Shift+Enter for a new line · Esc to cancel
      </p>
    </form>
  );
}
