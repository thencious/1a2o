import { createHash } from "node:crypto";
import type { BeeperRecoverySettings } from "./recovery-settings";
export type BeeperSetupState = {
  state: string;
  matrix?: { userID: string; deviceID: string };
  e2ee?: { verified: boolean };
};
export type BeeperRecoveryStatus = {
  phase: string;
  message: string;
  keyStored: boolean;
  autoStart: boolean;
  autoVerify: boolean;
};
export async function recoverBeeperSession({
  setup,
  settings,
  verify,
  checkpoint,
  manual = false,
}: {
  setup: BeeperSetupState;
  settings: BeeperRecoverySettings;
  verify: (key: string) => Promise<{ session: BeeperSetupState }>;
  checkpoint: () => Promise<void>;
  manual?: boolean;
}): Promise<BeeperRecoveryStatus> {
  const result = (phase: string, message: string) => ({
    phase,
    message,
    keyStored: Boolean(settings.recoveryKey),
    autoStart: settings.autoStart,
    autoVerify: settings.autoVerify,
  });
  if (setup.state === "needs-login")
    return result(
      "needs-login",
      "Sign in to Beeper first. The recovery key verifies encryption after sign-in.",
    );
  if (
    settings.accountId &&
    setup.matrix?.userID &&
    settings.accountId !== setup.matrix.userID
  )
    return result(
      "account-mismatch",
      "Beeper is signed into a different account. Save that account's recovery key before verification.",
    );
  if (setup.state === "ready" && !(manual && settings.recoveryKey)) {
    settings.blockedFingerprint = null;
    return result("ready", "Beeper is ready.");
  }
  if (
    !["needs-verification", "needs-secrets"].includes(setup.state) &&
    !(manual && settings.recoveryKey && setup.state === "ready")
  )
    return result(
      "syncing",
      "Beeper is initializing or syncing. Waiting for its session to be ready.",
    );
  if (!settings.recoveryKey)
    return result(
      "needs-key",
      "Save your existing Beeper recovery key below to enable automatic verification.",
    );
  if (!manual && !settings.autoVerify)
    return result(
      "verification-disabled",
      "Automatic verification is turned off.",
    );
  if (!setup.matrix?.userID || !setup.matrix.deviceID)
    return result(
      "waiting",
      "Waiting for Beeper to identify its signed-in session.",
    );
  if (!manual && !settings.accountId)
    return result(
      "confirm-key",
      "Verify the saved key once to associate it with this Beeper account.",
    );
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([
        setup.matrix.userID,
        setup.matrix.deviceID,
        settings.recoveryKey,
      ]),
    )
    .digest("hex");
  if (!manual && settings.blockedFingerprint === fingerprint)
    return result(
      "retry-required",
      "The last key verification was unsuccessful or could not be confirmed. Check the key and choose Verify saved key to retry.",
    );
  settings.blockedFingerprint = fingerprint;
  await checkpoint();
  try {
    const response = await verify(settings.recoveryKey);
    if (
      !response.session.e2ee?.verified ||
      response.session.matrix?.userID !== setup.matrix.userID
    )
      return result(
        "retry-required",
        "Beeper has not confirmed verification. Check the key and try again.",
      );
    settings.accountId = setup.matrix.userID;
    settings.blockedFingerprint = null;
    return result(
      "verified",
      "Beeper recovery key verified. Future sessions will be verified automatically when needed.",
    );
  } catch {
    return result(
      "retry-required",
      "Beeper could not verify the saved key. Check the key and choose Verify saved key to retry.",
    );
  }
}
