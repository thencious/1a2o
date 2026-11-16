import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const files = vi.hoisted(() => new Map<string, string>());
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(async (path: string) => {
    if (!files.has(path))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(path);
  }),
  writeFile: vi.fn(async (path: string, value: string) => {
    files.set(path, value);
  }),
  rename: vi.fn(async (source: string, destination: string) => {
    files.set(destination, files.get(source)!);
    files.delete(source);
  }),
}));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (text: string) => `encrypted:${text}`,
  decryptToken: (text: string) => text.slice(10),
}));
import {
  getCalendarVisibility,
  setCalendarVisibility,
} from "./visibility-store";
beforeEach(() => files.clear());
describe("account calendar preference persistence", () => {
  it("loads saved choices from storage and isolates different users", async () => {
    await setCalendarVisibility("owner", {
      operation: "initialize",
      ids: ["work", "holidays"],
    });
    await setCalendarVisibility("owner", {
      operation: "toggle",
      id: "holidays",
      visible: false,
    });
    expect(await getCalendarVisibility("owner")).toEqual({
      visibleIds: ["work"],
    });
    expect(await getCalendarVisibility("other")).toEqual({ visibleIds: null });
    expect([...files.values()][0]).toMatch(/^encrypted:/);
  });
  it("serializes concurrent updates without losing another calendar choice", async () => {
    await setCalendarVisibility("owner", {
      operation: "initialize",
      ids: ["work", "holidays"],
    });
    await Promise.all([
      setCalendarVisibility("owner", {
        operation: "toggle",
        id: "holidays",
        visible: false,
      }),
      setCalendarVisibility("owner", {
        operation: "toggle",
        id: "personal",
        visible: true,
      }),
      setCalendarVisibility("owner", {
        operation: "initialize",
        ids: ["unwanted"],
      }),
    ]);
    expect(await getCalendarVisibility("owner")).toEqual({
      visibleIds: ["work", "personal"],
    });
  });
  it("does not reset choices if saved data is unreadable", async () => {
    await setCalendarVisibility("owner", {
      operation: "initialize",
      ids: ["work"],
    });
    for (const key of files.keys()) files.set(key, "corrupt");
    await expect(getCalendarVisibility("owner")).rejects.toThrow();
    await expect(
      setCalendarVisibility("owner", {
        operation: "initialize",
        ids: ["unwanted"],
      }),
    ).rejects.toThrow();
  });
});
