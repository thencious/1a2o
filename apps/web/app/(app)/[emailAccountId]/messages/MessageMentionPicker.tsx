"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
  type KeyboardEvent,
} from "react";
import useSWR from "swr";
import { beeperMention } from "@/utils/actions/beeper.validation";
import {
  mentionQuery,
  rebaseMentions,
  type MessageMention,
} from "@/utils/beeper/mentions";
import type {
  ChatParticipant,
  MentionParticipants,
} from "@/utils/beeper/types";

export function useMessageMentions(
  chatId: string,
  text: string,
  onText: (text: string) => void,
  field: RefObject<HTMLTextAreaElement | null>,
) {
  const key = `zenro:message-mentions:${chatId}`;
  const selection = useRef<number | null>(null);
  const [stored, setStored] = useState<{
    text: string;
    mentions: MessageMention[];
  }>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "null"),
        parsed = beeperMention.array().max(100).safeParse(value?.mentions);
      if (value?.text === text && parsed.success)
        return { text, mentions: parsed.data };
    } catch {}
    return { text, mentions: [] };
  });
  useLayoutEffect(() => {
    if (selection.current === null) return;
    const position = Math.min(selection.current, stored.text.length);
    selection.current = null;
    field.current?.focus();
    field.current?.setSelectionRange(position, position);
  }, [stored, field]);
  const [caret, setCaret] = useState(text.length),
    [closed, setClosed] = useState(false),
    [index, setIndex] = useState(0);
  const mentions = rebaseMentions(stored.text, text, stored.mentions);
  const query =
    closed || text.startsWith("/") ? null : mentionQuery(text, caret, mentions);
  const { data, error, isLoading } = useSWR<MentionParticipants>(
    query
      ? `/api/user/messages/participants?${new URLSearchParams({ chatId })}`
      : null,
    async (url) => {
      const response = await fetch(url, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok)
        throw new Error(result.error || "Could not load participants.");
      return result;
    },
    { dedupingInterval: 60_000, revalidateOnFocus: false },
  );
  const candidates = (data?.participants ?? [])
    .filter((person) =>
      `${person.label} ${person.username ?? ""}`
        .toLocaleLowerCase()
        .includes(query?.query.trim().toLocaleLowerCase() ?? ""),
    )
    .slice(0, 50);
  const selected = Math.min(index, Math.max(0, candidates.length - 1));
  const visible = Boolean(query && (isLoading || error || data?.supported));
  const commit = (
    next: string,
    nextMentions: MessageMention[],
    position: number,
  ) => {
    const value = { text: next, mentions: nextMentions };
    setStored(value);
    onText(next);
    setCaret(position);
    setIndex(0);
    try {
      if (nextMentions.length) localStorage.setItem(key, JSON.stringify(value));
      else localStorage.removeItem(key);
    } catch {}
  };
  const change = (next: string, position = next.length) => {
    commit(next, rebaseMentions(text, next, mentions), position);
    setClosed(false);
  };
  const choose = (person: ChatParticipant) => {
    if (!query) return;
    const token = `@${person.label}`,
      next = `${text.slice(0, query.start) + token} ${text.slice(query.end)}`,
      position = query.start + token.length + 1;
    const nextMentions = [
      ...rebaseMentions(text, next, mentions),
      {
        userId: person.id,
        label: person.label,
        start: query.start,
        end: query.start + token.length,
      },
    ];
    selection.current = position;
    commit(next, nextMentions, position);
    setClosed(true);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!visible || event.nativeEvent.isComposing) return false;
    if (event.key === "Escape") {
      event.preventDefault();
      setClosed(true);
      return true;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (candidates.length)
        setIndex(
          (selected + (event.key === "ArrowDown" ? 1 : candidates.length - 1)) %
            candidates.length,
        );
      return true;
    }
    if ((event.key === "Enter" || event.key === "Tab") && !event.shiftKey) {
      event.preventDefault();
      if (candidates.length) choose(candidates[selected]);
      return true;
    }
    return false;
  };
  const reset = () => {
    setStored({ text: "", mentions: [] });
    setClosed(true);
    try {
      localStorage.removeItem(key);
    } catch {}
  };
  return {
    mentions,
    change,
    choose,
    handleKeyDown,
    reset,
    setCaret,
    setIndex,
    selected,
    candidates,
    visible,
    error: error?.message as string | undefined,
    isLoading,
  };
}

export function MessageMentionPicker({
  value,
}: {
  value: ReturnType<typeof useMessageMentions>;
}) {
  if (!value.visible) return null;
  return (
    <div
      id="message-mention-menu"
      role="listbox"
      aria-label="Mention participants"
      className="absolute bottom-full left-12 right-12 z-40 mb-2 max-h-64 overflow-y-auto rounded-md border bg-popover p-1 shadow-lg"
    >
      {value.error ? (
        <p role="status" className="px-3 py-2 text-xs text-rose-400">
          {value.error}
        </p>
      ) : value.isLoading ? (
        <p role="status" className="px-3 py-2 text-xs text-muted-foreground">
          Loading participants…
        </p>
      ) : !value.candidates.length ? (
        <p className="px-3 py-2 text-xs text-muted-foreground">
          No matching participants. Esc to dismiss.
        </p>
      ) : (
        value.candidates.map((person, index) => (
          <button
            key={person.id}
            id={`message-mention-${index}`}
            type="button"
            role="option"
            aria-selected={index === value.selected}
            className={`flex w-full items-center justify-between gap-3 rounded px-3 py-2 text-left text-sm ${index === value.selected ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            onMouseDown={(event) => event.preventDefault()}
            onMouseEnter={() => value.setIndex(index)}
            onClick={() => value.choose(person)}
          >
            <span className="truncate">{person.label}</span>
            {person.username && person.username !== person.label && (
              <span className="truncate text-xs text-muted-foreground">
                {person.username}
              </span>
            )}
          </button>
        ))
      )}
    </div>
  );
}
