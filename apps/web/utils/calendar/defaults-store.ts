import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import {
  calendarDefaults,
  initialCalendarDefaults,
  type CalendarDefaults,
} from "./defaults";

export async function getCalendarDefaults(
  userId: string,
): Promise<CalendarDefaults> {
  try {
    const raw = await readFile(path(userId), "utf8");
    if (!raw.startsWith("v1:"))
      throw new Error("Calendar defaults are not encrypted.");
    return calendarDefaults.parse(JSON.parse(decryptToken(raw) ?? "null"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      return { ...initialCalendarDefaults };
    throw error;
  }
}
export async function setCalendarDefaults(
  userId: string,
  value: CalendarDefaults,
) {
  const parsed = calendarDefaults.parse(value),
    file = path(userId);
  const encrypted = encryptToken(JSON.stringify(parsed));
  if (!encrypted)
    throw new Error("Calendar preference encryption is unavailable.");
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, encrypted, { mode: 0o600 });
  await rename(temporary, file);
  return parsed;
}
function path(userId: string) {
  const root = localWorkspaceRoot();
  return resolve(
    root,
    ".context/calendar-defaults",
    `${createHash("sha256").update(userId).digest("hex")}.json`,
  );
}
