import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import {
  calendarVisibility,
  applyCalendarVisibility,
  type CalendarVisibility,
  type changeCalendarVisibility,
} from "./visibility";
import type { z } from "zod";

const locks = new Map<string, Promise<unknown>>();
function path(userId: string) {
  const root = localWorkspaceRoot();
  return resolve(
    root,
    ".context/calendar-preferences",
    `${createHash("sha256").update(userId).digest("hex")}.json`,
  );
}
export async function getCalendarVisibility(
  userId: string,
): Promise<CalendarVisibility> {
  try {
    const plain = decryptToken(await readFile(path(userId), "utf8"));
    return calendarVisibility.parse(JSON.parse(plain ?? "null"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { visibleIds: null };
    throw error;
  }
}
export async function setCalendarVisibility(
  userId: string,
  change: z.infer<typeof changeCalendarVisibility>,
) {
  const file = path(userId);
  const operation = (locks.get(file) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = await getCalendarVisibility(userId);
      const next = applyCalendarVisibility(current, change);
      const encrypted = encryptToken(JSON.stringify(next));
      if (!encrypted)
        throw new Error("Calendar preference encryption is unavailable.");
      await mkdir(dirname(file), { recursive: true });
      const temporary = `${file}.${randomUUID()}.tmp`;
      await writeFile(temporary, encrypted, { mode: 0o600 });
      await rename(temporary, file);
      return next;
    });
  locks.set(file, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(file) === operation) locks.delete(file);
  }
}
