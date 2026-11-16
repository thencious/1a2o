import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("node:fs/promises", () => ({ readFile: mocks.read }));
vi.mock("@/utils/local-workspace", () => ({
  localWorkspaceRoot: () => "/fixture",
}));
import { readLocalUpdate } from "./status";
import { buildProgress } from "./progress.mjs";
beforeEach(() => {
  vi.stubEnv("LOCAL_BEEPER_OWNER_ID", "owner");
  mocks.read.mockReset().mockResolvedValue(
    JSON.stringify({
      pid: 123,
      phase: "building",
      at: new Date().toISOString(),
      progress: buildProgress("types"),
      candidate: "private-install-path",
      error: "private-details",
    }),
  );
  vi.spyOn(process, "kill").mockImplementation(() => true);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
it("shows the live build stage only to the owner, without process IDs or paths", async () => {
  expect(await readLocalUpdate("other")).toEqual({
    enabled: false,
    progress: null,
  });
  expect(mocks.read).not.toHaveBeenCalled();
  const status = await readLocalUpdate("owner");
  expect(status.progress).toMatchObject({ stage: "types", step: 3 });
  expect(JSON.stringify(status)).not.toMatch(/123|private/);
});
it.each([
  "ready",
  "failed",
  "activated",
])("hides the bar when the build is %s", async (phase) => {
  mocks.read.mockResolvedValue(
    JSON.stringify({ pid: 123, phase, at: new Date().toISOString() }),
  );
  expect((await readLocalUpdate("owner")).progress).toBeNull();
});
it("clears abandoned builds and tolerates missing or malformed status files", async () => {
  vi.mocked(process.kill).mockImplementation(() => {
    throw new Error("ESRCH");
  });
  expect((await readLocalUpdate("owner")).progress).toBeNull();
  mocks.read.mockResolvedValue("invalid JSON");
  expect((await readLocalUpdate("owner")).progress).toBeNull();
  mocks.read.mockRejectedValue(new Error("ENOENT"));
  expect((await readLocalUpdate("owner")).progress).toBeNull();
});
it("supports existing builders without detailed stages and rejects stale state", async () => {
  mocks.read.mockResolvedValue(
    JSON.stringify({
      pid: 123,
      phase: "switching",
      at: new Date().toISOString(),
    }),
  );
  expect((await readLocalUpdate("owner")).progress?.stage).toBe("install");
  mocks.read.mockResolvedValue(
    JSON.stringify({
      pid: 123,
      phase: "building",
      at: new Date(Date.now() - 46 * 60_000).toISOString(),
    }),
  );
  expect((await readLocalUpdate("owner")).progress).toBeNull();
});
