import type { Conversation } from "@/utils/beeper/types";
import { combinedContactName } from "@/utils/contacts/combine";
export type ConversationGroup = {
  id: string;
  title: string;
  members: Conversation[];
};
export function groupConversations(
  items: Conversation[],
  groups: ConversationGroup[],
): Conversation[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const grouped = new Set(
    groups.flatMap((group) => group.members.map((member) => member.id)),
  );
  return [
    ...items.filter((item) => !grouped.has(item.id)),
    ...groups
      .filter((group) => group.members.some((member) => byId.has(member.id)))
      .map((group) => {
        const members = group.members.map(
          (member) => byId.get(member.id) ?? member,
        );
        const latest = [...members].sort(
          (a, b) => Date.parse(b.time) - Date.parse(a.time),
        )[0];
        return {
          ...latest,
          id: group.id,
          title: combinedContactName([
            ...members.map((member) => member.title),
            group.title,
          ]),
          unread: members.reduce((sum, item) => sum + item.unread, 0),
          members,
          group: members.some((item) => item.group),
        };
      }),
  ].sort((a, b) => Date.parse(b.time) - Date.parse(a.time));
}
