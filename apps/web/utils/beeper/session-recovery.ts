import "server-only";
import type { z } from "zod";
import type { beeperRecoveryPreferences } from "@/utils/actions/beeper.validation";
import { assertBeeperOwner, beeperSession } from "./connection";
import { ensureBeeperDesktop } from "./desktop-startup";
import {
  getBeeperRecoverySettings,
  updateBeeperRecoverySettings,
} from "./recovery-settings";
import {
  recoverBeeperSession,
  type BeeperRecoveryStatus,
} from "./recovery-policy";
const checks = new Map<
  string,
  { at: number; promise: Promise<BeeperRecoveryStatus> }
>();

export async function ensureBeeperSession(userId: string, manual = false) {
  assertBeeperOwner(userId);
  const previous = checks.get(userId);
  if (!manual && previous && Date.now() - previous.at < 30_000)
    return previous.promise;
  const promise = updateBeeperRecoverySettings(
    userId,
    async (settings, checkpoint) => {
      const result = (
        phase: string,
        message: string,
      ): BeeperRecoveryStatus => ({
        phase,
        message,
        keyStored: Boolean(settings.recoveryKey),
        autoStart: settings.autoStart,
        autoVerify: settings.autoVerify,
      });
      if (!(await ensureBeeperDesktop(settings.autoStart)))
        return result(
          "offline",
          "Beeper is not available yet. Open Beeper and enable its Desktop API.",
        );
      try {
        const { client } = await beeperSession(userId);
        const setup = await client.app.setup.retrieve();
        return recoverBeeperSession({
          setup,
          settings,
          checkpoint,
          manual,
          verify: (key) =>
            client.app.setup.recoveryKey.verify({ recoveryKey: key }),
        });
      } catch (error) {
        const status = (error as { status?: number }).status;
        if (status === 404)
          return result(
            "unsupported",
            "This Beeper version does not expose session verification. Update Beeper to use automatic recovery.",
          );
        if (status === 401 || status === 403)
          return result(
            "connection-required",
            "Beeper rejected the app connection. Reconnect its access token below; your saved recovery key stays encrypted.",
          );
        return result(
          "offline",
          "Beeper is temporarily unavailable. 1a2o will check the connection again.",
        );
      }
    },
  );
  checks.set(userId, { at: Date.now(), promise });
  try {
    return await promise;
  } catch {
    checks.delete(userId);
    throw new Error("Beeper session check could not complete securely.");
  }
}
export function invalidateBeeperSessionStatus(userId: string) {
  checks.delete(userId);
}
export async function saveBeeperRecoveryPreferences(
  userId: string,
  input: z.infer<typeof beeperRecoveryPreferences>,
) {
  await updateBeeperRecoverySettings(userId, async (settings) => {
    if (input.autoStart !== undefined) settings.autoStart = input.autoStart;
    if (input.autoVerify !== undefined) settings.autoVerify = input.autoVerify;
    if (input.clearKey) {
      settings.recoveryKey = "";
      settings.accountId = null;
      settings.blockedFingerprint = null;
    }
    if (input.recoveryKey) {
      settings.recoveryKey = input.recoveryKey;
      settings.accountId = null;
      settings.blockedFingerprint = null;
    }
  });
  checks.delete(userId);
  // Saving a new key is an explicit verification request for the current account.
  return ensureBeeperSession(userId, Boolean(input.recoveryKey));
}
export async function beeperRecoveryPreferencesForUser(userId: string) {
  const settings = await getBeeperRecoverySettings(userId);
  return {
    autoStart: settings.autoStart,
    autoVerify: settings.autoVerify,
    keyStored: Boolean(settings.recoveryKey),
    accountBound: Boolean(settings.accountId),
  };
}
