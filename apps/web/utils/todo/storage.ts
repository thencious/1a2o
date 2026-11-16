import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { z } from "zod";
import { encryptToken, decryptToken } from "@/utils/encryption";
import { SafeError } from "@/utils/error";
import { withFileLock } from "./cloud-sync-core.mjs";
import { todoTasks } from "@/utils/actions/todo.validation";

const locks = new Map<string, Promise<unknown>>();
export function assertTodoOwner(userId: string) {
  const owner =
    process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID;
  if (!userId || (owner && userId !== owner))
    throw new SafeError(
      "This checklist is available only to the installation's owner.",
    );
}
function path(userId: string, workspace: "tasks" | "notes" = "tasks") {
  assertTodoOwner(userId);
  const root = localWorkspaceRoot();
  return resolve(
    root,
    ".context/todo",
    `${createHash("sha256").update(userId).digest("hex")}${workspace === "notes" ? "-notes" : ""}.json`,
  );
}
export async function getTodoState(
  userId: string,
  workspace: "tasks" | "notes" = "tasks",
): Promise<{ revision: string; tasks: z.infer<typeof todoTasks> }> {
  try {
    const encrypted = await readFile(path(userId, workspace), "utf8"),
      plain = decryptToken(encrypted);
    if (!plain) throw new Error("Checklist backup cannot be decrypted.");
    const state = JSON.parse(plain);
    if (typeof state.revision !== "string")
      throw new Error("Invalid checklist backup.");
    return { revision: state.revision, tasks: todoTasks.parse(state.tasks) };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return { revision: "initial", tasks: [] };
  }
}
export async function saveTodoState(
  userId: string,
  revision: string,
  tasks: z.infer<typeof todoTasks>,
  workspace: "tasks" | "notes" = "tasks",
) {
  const file = path(userId, workspace),
    previous = locks.get(file) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(() =>
      withFileLock(file, async () => {
        const state = await getTodoState(userId, workspace);
        if (state.revision !== revision)
          throw new SafeError(
            "Checklist changed in another window. Your edits remain saved on this device; reload to reconcile them.",
          );
        const validated = todoTasks.parse(tasks);
        if (JSON.stringify(validated) === JSON.stringify(state.tasks))
          return { revision: state.revision };
        const updated = { revision: randomUUID(), tasks: validated };
        const encrypted = encryptToken(JSON.stringify(updated));
        if (!encrypted) throw new Error("Checklist encryption is unavailable.");
        await mkdir(resolve(file, ".."), { recursive: true });
        const temp = `${file}.${randomUUID()}.tmp`;
        await writeFile(temp, encrypted, { mode: 0o600 });
        if (state.revision !== "initial") {
          const history = resolve(
            dirname(file),
            "history",
            createHash("sha256").update(userId).digest("hex"),
          );
          await mkdir(history, { recursive: true });
          const previousEncrypted = encryptToken(JSON.stringify(state));
          if (previousEncrypted)
            await writeFile(
              resolve(
                history,
                `${workspace}-${Date.now()}-${state.revision}.json`,
              ),
              previousEncrypted,
              { mode: 0o600 },
            );
        }
        await rename(temp, file);
        return { revision: updated.revision };
      }),
    );
  locks.set(file, next);
  try {
    return await next;
  } finally {
    if (locks.get(file) === next) locks.delete(file);
  }
}

export async function appendWorkspaceItem(
  userId: string,
  item: z.infer<typeof todoTasks>[number],
  workspace: "tasks" | "notes",
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const state = await getTodoState(userId, workspace);
    if (state.tasks.some((existing) => existing.id === item.id))
      return { ...state, existing: true };
    try {
      const saved = await saveTodoState(
        userId,
        state.revision,
        [item, ...state.tasks],
        workspace,
      );
      return {
        revision: saved.revision,
        tasks: [item, ...state.tasks],
        existing: false,
      };
    } catch (error) {
      const latest = await getTodoState(userId, workspace);
      if (latest.revision === state.revision || attempt === 4) throw error;
    }
  }
  throw new SafeError("Could not add the item. Your original is unchanged.");
}
