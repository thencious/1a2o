import { beforeEach, describe, expect, it, vi } from "vitest";
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("./cloud-sync-core.mjs", () => ({
  withFileLock: (_file: string, operation: () => Promise<unknown>) =>
    operation(),
}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(async () => undefined),
  readFile: vi.fn(async (file: string) => {
    if (!files.has(file))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(file);
  }),
  writeFile: vi.fn(async (file: string, text: string) => {
    files.set(file, text);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    files.set(to, files.get(from)!);
    files.delete(from);
  }),
}));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (text: string) => `encrypted:${text}`,
  decryptToken: (text: string) => text.slice(10),
}));
vi.mock("@/utils/error", () => ({ SafeError: class extends Error {} }));
import { getTodoState, saveTodoState, appendWorkspaceItem } from "./storage";

describe("private checklist snapshots", () => {
  beforeEach(() => {
    files.clear();
    vi.stubEnv("LOCAL_BEEPER_OWNER_ID", "owner");
  });
  const task = {
    id: "task-a",
    title: "Sample",
    notes: "## Notes",
    createdAt: 1,
    priority: "important",
    estimatedSeconds: 300,
  };
  it("preserves task metadata in encrypted snapshots and avoids revisions for unchanged saves", async () => {
    const saved = await saveTodoState("owner", "initial", [task]);
    expect(await getTodoState("owner")).toEqual({
      revision: saved.revision,
      tasks: [task],
    });
    expect(
      [...files.values()].every((text) => text.startsWith("encrypted:")),
    ).toBe(true);
    expect(await saveTodoState("owner", saved.revision, [task])).toEqual(saved);
    await expect(getTodoState("someone-else")).rejects.toThrow("owner");
  });
  it("serializes competing saves and preserves the accepted version", async () => {
    const saved = await saveTodoState("owner", "initial", [task]);
    const outcomes = await Promise.allSettled([
      saveTodoState("owner", saved.revision, [
        { ...task, notes: "First edit" },
      ]),
      saveTodoState("owner", saved.revision, [
        { ...task, notes: "Other edit" },
      ]),
    ]);
    expect(outcomes.map((result) => result.status)).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect((await getTodoState("owner")).tasks[0].notes).toBe("First edit");
    await expect(
      saveTodoState("owner", (await getTodoState("owner")).revision, [
        task,
        task,
      ]),
    ).rejects.toThrow();
    expect((await getTodoState("owner")).tasks).toHaveLength(1);
  });
  it("keeps notes separate from tasks and makes repeated transfers idempotent", async () => {
    await saveTodoState("owner", "initial", [task]);
    const note = { ...task, id: "note-a", notes: "# Note title\n\nBody" };
    await appendWorkspaceItem("owner", note, "notes");
    expect((await getTodoState("owner")).tasks).toEqual([task]);
    expect((await getTodoState("owner", "notes")).tasks).toEqual([note]);
    expect((await appendWorkspaceItem("owner", note, "notes")).existing).toBe(
      true,
    );
    expect((await getTodoState("owner", "notes")).tasks).toHaveLength(1);
  });
  it("preserves both items when simultaneous transfers race", async () => {
    await Promise.all([
      appendWorkspaceItem("owner", { ...task, id: "first" }, "tasks"),
      appendWorkspaceItem("owner", { ...task, id: "second" }, "tasks"),
      appendWorkspaceItem("owner", { ...task, id: "first" }, "tasks"),
    ]);
    expect(
      (await getTodoState("owner")).tasks.map((item) => item.id).sort(),
    ).toEqual(["first", "second"]);
  });
});
