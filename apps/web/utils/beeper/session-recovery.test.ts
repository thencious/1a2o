import { beforeEach, expect, it, vi } from "vitest";
const { client, state, available } = vi.hoisted(() => ({
  client: {
    app: { setup: { retrieve: vi.fn(), recoveryKey: { verify: vi.fn() } } },
  },
  state: {
    autoStart: true,
    autoVerify: true,
    recoveryKey: "synthetic-key",
    accountId: "owner",
    blockedFingerprint: null as string | null,
  },
  available: vi.fn(async () => true),
}));
vi.mock("server-only", () => ({}));
vi.mock("./connection", () => ({
  assertBeeperOwner: (id: string) => {
    if (id !== "owner") throw new Error("Owner required");
  },
  beeperSession: async () => ({ client }),
}));
vi.mock("./desktop-startup", () => ({ ensureBeeperDesktop: available }));
vi.mock("./recovery-settings", () => ({
  getBeeperRecoverySettings: async () => state,
  updateBeeperRecoverySettings: async (
    _id: string,
    change: (settings: typeof state, save: () => Promise<void>) => unknown,
  ) => change(state, async () => undefined),
}));
import {
  ensureBeeperSession,
  saveBeeperRecoveryPreferences,
  beeperRecoveryPreferencesForUser,
} from "./session-recovery";
beforeEach(async () => {
  vi.clearAllMocks();
  Object.assign(state, {
    autoStart: true,
    autoVerify: true,
    recoveryKey: "synthetic-key",
    accountId: "owner",
    blockedFingerprint: null,
  });
  client.app.setup.retrieve.mockResolvedValue({
    state: "ready",
    matrix: { userID: "owner", deviceID: "a" },
    e2ee: { verified: true },
  });
  available.mockResolvedValue(true);
  await saveBeeperRecoveryPreferences("owner", { autoStart: true });
  vi.clearAllMocks();
});
it("reports invalid app tokens without submitting or exposing the saved key", async () => {
  client.app.setup.retrieve.mockRejectedValue(
    Object.assign(new Error("private synthetic-key"), { status: 401 }),
  );
  const result = await ensureBeeperSession("owner", true);
  expect(result.phase).toBe("connection-required");
  expect(client.app.setup.recoveryKey.verify).not.toHaveBeenCalled();
  expect(JSON.stringify(result)).not.toContain("synthetic-key");
});
it("coalesces repeated status and background checks", async () => {
  await ensureBeeperSession("owner", true);
  vi.clearAllMocks();
  await Promise.all([
    ensureBeeperSession("owner"),
    ensureBeeperSession("owner"),
  ]);
  expect(available).not.toHaveBeenCalled();
  expect(client.app.setup.retrieve).not.toHaveBeenCalled();
});
it("checks the local owner before launching Beeper or reading credentials", async () => {
  await expect(ensureBeeperSession("other")).rejects.toThrow("Owner required");
  expect(available).not.toHaveBeenCalled();
});
it("exposes only preference flags and permits forgetting the stored key", async () => {
  expect(await beeperRecoveryPreferencesForUser("owner")).not.toHaveProperty(
    "recoveryKey",
  );
  await saveBeeperRecoveryPreferences("owner", { clearKey: true });
  expect(state.recoveryKey).toBe("");
  expect(state.accountId).toBeNull();
});
