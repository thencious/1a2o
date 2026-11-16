import "server-only";
import { z } from "zod";
import { conversationGroups } from "./conversation-group-store";
import { listMessages } from "@/utils/beeper/service";
export async function combinedHistory(
  userId: string,
  chatId: string,
  cursor?: string,
) {
  const group = (await conversationGroups(userId)).find(
    (group) => group.id === chatId,
  );
  if (!group) return listMessages(userId, chatId, cursor);
  const positions: Record<string, string | null> = cursor
    ? z
        .record(z.string(), z.string().nullable())
        .parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")))
    : {};
  const pages = await Promise.all(
    group.members
      .filter((member) => positions[member.id] !== null)
      .map(async (member) => ({
        id: member.id,
        page: await listMessages(
          userId,
          member.id,
          positions[member.id] ?? undefined,
        ),
      })),
  );
  const next = { ...positions };
  for (const { id, page } of pages) {
    if (page.hasMore && (!page.cursor || page.cursor === positions[id]))
      throw new Error("Conversation history did not advance.");
    next[id] = page.hasMore ? page.cursor : null;
  }
  const hasMore = Object.values(next).some((value) => value !== null);
  return {
    items: pages
      .flatMap(({ page }) => page.items)
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time)),
    hasMore,
    cursor: hasMore
      ? Buffer.from(JSON.stringify(next)).toString("base64url")
      : null,
  };
}
