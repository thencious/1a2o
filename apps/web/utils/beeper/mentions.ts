import type { z } from "zod";
import type { beeperMention } from "@/utils/actions/beeper.validation";
import type { ChatParticipant } from "./types";
export type MessageMention = z.infer<typeof beeperMention>;

export function mentionQuery(
  text: string,
  caret: number,
  mentions: MessageMention[] = [],
) {
  if (caret < 0 || caret > text.length) return null;
  const start = text.lastIndexOf("@", caret - 1);
  if (
    start < 0 ||
    (start > 0 && /[\p{L}\p{N}_@/]/u.test(text[start - 1])) ||
    mentions.some((item) => item.start === start)
  )
    return null;
  const query = text.slice(start + 1, caret);
  if (query.length > 80 || /[\r\n@]/.test(query)) return null;
  return { start, end: caret, query };
}
export function rebaseMentions(
  before: string,
  after: string,
  mentions: MessageMention[],
) {
  if (before === after) return mentions;
  let start = 0,
    suffix = 0;
  while (
    start < before.length &&
    start < after.length &&
    before[start] === after[start]
  )
    start++;
  while (
    suffix < before.length - start &&
    suffix < after.length - start &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++;
  const end = before.length - suffix,
    delta = after.length - before.length;
  return mentions.flatMap((item) => {
    let next = item;
    if (end <= item.start)
      next = { ...item, start: item.start + delta, end: item.end + delta };
    else if (start < item.end) return [];
    if (
      after.slice(next.start, next.end) !== `@${next.label}` ||
      /[\p{L}\p{N}_]/u.test(after[next.end] ?? "")
    )
      return [];
    return [next];
  });
}
export function nativeMentionText(
  text: string,
  mentions: MessageMention[],
  participants: ChatParticipant[],
) {
  let previous = 0,
    result = "";
  for (const mention of [...mentions].sort((a, b) => a.start - b.start)) {
    const person = participants.find((person) => person.id === mention.userId);
    if (
      !person ||
      person.label !== mention.label ||
      mention.start < previous ||
      mention.end <= mention.start ||
      mention.end > text.length ||
      text.slice(mention.start, mention.end) !== `@${mention.label}`
    )
      throw new Error(
        "A selected mention changed. Remove it and choose the participant again.",
      );
    const label = `@${person.label}`.replace(/[\\`*_[\]()<>]/g, "\\$&");
    const id = encodeURIComponent(person.id)
      .replace(/^%40/, "@")
      .replaceAll("(", "%28")
      .replaceAll(")", "%29");
    result +=
      text.slice(previous, mention.start) +
      `[${label}](https://matrix.to/#/${id})`;
    previous = mention.end;
  }
  return result + text.slice(previous);
}
