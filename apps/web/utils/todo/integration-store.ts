import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { assertTodoOwner } from "./storage";
import type { CalendarPrompt } from "./calendar-types";
import { defaultTaskRules, type TaskRule } from "./task-rules";

export type CalendarTarget = { connectionId: string; calendarId: string };
export type TodoIntegration = {
  taskRules: TaskRule[];
  rulesRevision: string;
  defaultCalendar: CalendarTarget | null;
  calendarMode?: "default" | "ask" | "off";
  taskCalendars?: Record<string, CalendarTarget>;
  ntfyTopic: string;
  ntfyToken: string;
  timezone: string;
  taskUrl: string;
  links: Record<
    string,
    {
      hash: string;
      eventId: string;
      target: CalendarTarget;
      start: string;
      allDay?: boolean;
    }
  >;
  requests: Record<string, string>;
  dismissed: Record<string, string>;
  pending: Record<string, CalendarPrompt>;
  reminders: Record<
    string,
    {
      topic: string;
      token?: string;
      at: number;
      signature: string;
      state: "queued" | "delivered";
    }
  >;
  ntfyStatus: {
    checkedAt: number;
    queued: number;
    waiting: number;
    errors: string[];
  };
};
const locks = new Map<string, Promise<unknown>>();
function file(userId: string) {
  assertTodoOwner(userId);
  const root = localWorkspaceRoot();
  return resolve(
    root,
    ".context/todo",
    `${createHash("sha256").update(userId).digest("hex")}-integration.json`,
  );
}
export async function getTodoIntegration(
  userId: string,
): Promise<TodoIntegration> {
  const initial: TodoIntegration = {
    taskRules: defaultTaskRules(),
    rulesRevision: "initial",
    defaultCalendar: null,
    ntfyTopic: "",
    ntfyToken: "",
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    taskUrl: "",
    links: {},
    requests: {},
    dismissed: {},
    pending: {},
    reminders: {},
    ntfyStatus: { checkedAt: 0, queued: 0, waiting: 0, errors: [] },
  };
  try {
    const plain = decryptToken(await readFile(file(userId), "utf8"));
    if (!plain) throw new Error("Task integrations cannot be decrypted.");
    return { ...initial, ...JSON.parse(plain) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return initial;
  }
}
export async function updateTodoIntegration<T>(
  userId: string,
  change: (
    state: TodoIntegration,
    checkpoint: () => Promise<void>,
  ) => Promise<T>,
) {
  const path = file(userId),
    previous = locks.get(path) ?? Promise.resolve();
  const operation = previous
    .catch(() => undefined)
    .then(async () => {
      const state = await getTodoIntegration(userId);
      const checkpoint = async () => {
        const encrypted = encryptToken(JSON.stringify(state));
        if (!encrypted)
          throw new Error("Task integration encryption is unavailable.");
        await mkdir(resolve(path, ".."), { recursive: true });
        const temp = `${path}.${randomUUID()}.tmp`;
        await writeFile(temp, encrypted, { mode: 0o600 });
        await rename(temp, path);
      };
      const result = await change(state, checkpoint);
      await checkpoint();
      return result;
    });
  locks.set(path, operation);
  try {
    return await operation;
  } finally {
    if (locks.get(path) === operation) locks.delete(path);
  }
}
