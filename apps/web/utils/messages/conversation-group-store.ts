import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import type { ConversationGroup } from "./conversation-groups";
const locks = new Map<string, Promise<unknown>>();
function file(userId: string) {
  return resolve(
    localWorkspaceRoot(),
    ".context/conversation-groups",
    `${createHash("sha256").update(userId).digest("hex")}.json`,
  );
}
export async function conversationGroups(
  userId: string,
): Promise<ConversationGroup[]> {
  try {
    return JSON.parse(
      decryptToken(await readFile(file(userId), "utf8")) ?? "[]",
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export async function saveConversationGroup(
  userId: string,
  group: ConversationGroup,
) {
  const previous = locks.get(userId) ?? Promise.resolve();
  const pending = previous
    .catch(() => {})
    .then(async () => {
      const groups = await conversationGroups(userId);
      const ids = new Set(group.members.map((member) => member.id));
      const overlapping = groups.filter((item) =>
        item.members.some((member) => ids.has(member.id)),
      );
      const members = [
        ...new Map(
          [
            ...overlapping.flatMap((item) => item.members),
            ...group.members,
          ].map((member) => [member.id, member]),
        ).values(),
      ];
      if (members.length > 20)
        throw new Error(
          "A combined conversation can contain up to 20 conversations.",
        );
      const next = [
        ...groups.filter((item) => !overlapping.includes(item)),
        { ...group, members },
      ];
      const target = file(userId),
        temporary = `${target}.${randomUUID()}.tmp`;
      await mkdir(dirname(target), { recursive: true });
      const encrypted = encryptToken(JSON.stringify(next));
      if (!encrypted) throw new Error("Conversation encryption unavailable.");
      await writeFile(temporary, encrypted, { mode: 0o600 });
      await rename(temporary, target);
      return group;
    });
  locks.set(userId, pending);
  try {
    return await pending;
  } finally {
    if (locks.get(userId) === pending) locks.delete(userId);
  }
}
