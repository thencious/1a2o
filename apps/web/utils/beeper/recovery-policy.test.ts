import { describe, expect, it, vi } from "vitest";
import { recoverBeeperSession } from "./recovery-policy";
import type { BeeperRecoverySettings } from "./recovery-settings";
const setup = {
  state: "needs-verification",
  matrix: { userID: "owner", deviceID: "session-one" },
  e2ee: { verified: false },
};
function settings(): BeeperRecoverySettings {
  return {
    autoStart: true,
    autoVerify: true,
    recoveryKey: "synthetic-recovery-key",
    accountId: "owner",
    blockedFingerprint: null,
  };
}
function dependencies() {
  return {
    setup: structuredClone(setup),
    settings: settings(),
    checkpoint: vi.fn(async () => undefined),
    verify: vi.fn(async () => ({
      session: { ...setup, state: "ready", e2ee: { verified: true } },
    })),
  };
}
describe("Beeper session recovery", () => {
  it("verifies a new session with the saved key and checkpoints before using it", async () => {
    const input = dependencies();
    input.checkpoint.mockImplementation(async () => {
      expect(input.settings.blockedFingerprint).toBeTruthy();
      expect(input.verify).not.toHaveBeenCalled();
    });
    const result = await recoverBeeperSession(input);
    expect(result.phase).toBe("verified");
    expect(input.verify).toHaveBeenCalledWith("synthetic-recovery-key");
    expect(input.settings.blockedFingerprint).toBeNull();
    expect(JSON.stringify(result)).not.toContain(input.settings.recoveryKey);
  });
  it("does not post any key on normal ready-session checks", async () => {
    const input = dependencies();
    input.setup.state = "ready";
    await recoverBeeperSession(input);
    expect(input.verify).not.toHaveBeenCalled();
  });
  it("does not submit keys to a signed-out or different account", async () => {
    for (const modified of [
      { state: "needs-login" },
      { matrix: { userID: "someone-else", deviceID: "other" } },
    ]) {
      const input = dependencies();
      Object.assign(input.setup, modified);
      await recoverBeeperSession(input);
      expect(input.verify).not.toHaveBeenCalled();
    }
  });
  it("requires a deliberate first verification to bind an unconfirmed key", async () => {
    const input = dependencies();
    input.settings.accountId = null;
    expect((await recoverBeeperSession(input)).phase).toBe("confirm-key");
    expect(input.verify).not.toHaveBeenCalled();
    expect((await recoverBeeperSession({ ...input, manual: true })).phase).toBe(
      "verified",
    );
    expect(input.settings.accountId).toBe("owner");
  });
  it("can verify and bind a newly saved key while the current session is already ready", async () => {
    const input = dependencies();
    input.setup.state = "ready";
    input.settings.accountId = null;
    expect((await recoverBeeperSession({ ...input, manual: true })).phase).toBe(
      "verified",
    );
    expect(input.settings.accountId).toBe("owner");
  });
  it("stops repeated failures across restarts and never exposes provider errors containing a key", async () => {
    const input = dependencies();
    input.verify.mockRejectedValue(
      new Error("secret payload synthetic-recovery-key"),
    );
    const result = await recoverBeeperSession(input);
    expect(result.phase).toBe("retry-required");
    expect(JSON.stringify(result)).not.toContain(input.settings.recoveryKey);
    const restarted = { ...input, settings: structuredClone(input.settings) };
    await recoverBeeperSession(restarted);
    expect(input.verify).toHaveBeenCalledTimes(1);
    await recoverBeeperSession({ ...restarted, manual: true });
    expect(input.verify).toHaveBeenCalledTimes(2);
  });
  it("honors disabled recovery and missing keys", async () => {
    const input = dependencies();
    input.settings.autoVerify = false;
    await recoverBeeperSession(input);
    expect(input.verify).not.toHaveBeenCalled();
    input.settings.recoveryKey = "";
    expect((await recoverBeeperSession(input)).phase).toBe("needs-key");
  });
  it("does not mark an unconfirmed or wrong-account response as verified", async () => {
    const input = dependencies();
    input.verify.mockResolvedValue({
      session: {
        ...setup,
        matrix: { userID: "other", deviceID: "other" },
        e2ee: { verified: true },
      },
    });
    expect((await recoverBeeperSession(input)).phase).toBe("retry-required");
    expect(input.settings.blockedFingerprint).toBeTruthy();
  });
});
