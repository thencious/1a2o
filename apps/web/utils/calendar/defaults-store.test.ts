import { beforeEach, expect, it, vi } from "vitest";
const { files } = vi.hoisted(() => ({ files: new Map<string, string>() }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:fs/promises", () => ({
  mkdir: async () => {},
  readFile: async (path: string) => {
    if (!files.has(path))
      throw Object.assign(new Error("missing"), { code: "ENOENT" });
    return files.get(path);
  },
  writeFile: async (path: string, data: string) => {
    files.set(path, data);
  },
  rename: async (old: string, path: string) => {
    files.set(path, files.get(old)!);
    files.delete(old);
  },
}));
vi.mock("@/utils/encryption", () => ({
  encryptToken: (value: string) =>
    `v1:${Buffer.from(value).toString("base64")}`,
  decryptToken: (value: string) =>
    Buffer.from(value.slice(3), "base64").toString(),
}));
import { getCalendarDefaults, setCalendarDefaults } from "./defaults-store";
import { initialCalendarDefaults } from "./defaults";
beforeEach(() => files.clear());
it("persists encrypted defaults per user without touching calendar visibility preferences", async () => {
  const selected = {
    defaultCalendarId: "chosen-calendar",
    meetingProvider: "zoom" as const,
    zoomMeetingUrl: "https://zoom.us/j/123?pwd=private",
  };
  await setCalendarDefaults("owner", selected);
  expect(await getCalendarDefaults("owner")).toEqual(selected);
  expect(await getCalendarDefaults("another-owner")).toEqual(
    initialCalendarDefaults,
  );
  expect([...files.values()][0]).not.toContain("pwd=private");
  expect(
    [...files.keys()].every((path) => path.includes("calendar-defaults")),
  ).toBe(true);
});
