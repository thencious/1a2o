import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const { running, spawnChild, execute } = vi.hoisted(() => ({
  running: { value: false },
  spawnChild: vi.fn(),
  execute: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("node:fs", () => ({ existsSync: () => true }));
vi.mock("node:child_process", () => ({ spawn: spawnChild, execFile: execute }));
vi.mock("node:util", () => ({
  promisify: () => async () => ({
    stdout: running.value ? '"Beeper.exe","100"' : "No tasks are running",
  }),
}));
import { ensureBeeperDesktop } from "./desktop-startup";
beforeEach(() => {
  vi.clearAllMocks();
  running.value = false;
  vi.stubGlobal("process", {
    ...process,
    platform: "win32",
    env: {
      ...process.env,
      LOCALAPPDATA: "C:/sample",
      OPENROUTER_API_KEY: "must-not-inherit",
      CRON_SECRET: "also-private",
    },
  });
  spawnChild.mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
    queueMicrotask(() => child.emit("spawn"));
    return child;
  });
});
afterEach(() => vi.unstubAllGlobals());
it("starts the installed app without command-line keys or inherited provider secrets", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(new Response("{}")),
  );
  expect(await ensureBeeperDesktop(true)).toBe(true);
  expect(spawnChild).toHaveBeenCalledTimes(1);
  const [path, args, options] = spawnChild.mock.calls[0];
  expect(path).toContain("BeeperTexts");
  expect(args).toEqual([]);
  expect(options.env).not.toHaveProperty("OPENROUTER_API_KEY");
  expect(options.env).not.toHaveProperty("CRON_SECRET");
  expect(options.windowsHide).toBe(true);
});
it("does not duplicate a running app while its API starts", async () => {
  running.value = true;
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockRejectedValueOnce(new Error("initializing"))
      .mockResolvedValue(new Response("{}")),
  );
  expect(await ensureBeeperDesktop(true)).toBe(true);
  expect(spawnChild).not.toHaveBeenCalled();
});
it("honors disabled startup and does not restart a healthy app", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  expect(await ensureBeeperDesktop(false)).toBe(false);
  expect(spawnChild).not.toHaveBeenCalled();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));
  expect(await ensureBeeperDesktop(true)).toBe(true);
  expect(spawnChild).not.toHaveBeenCalled();
});
