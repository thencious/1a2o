import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { env } from "@/env";
import { SafeError } from "@/utils/error";
import { acceptLinkedInBrowserSession } from "./contacts";
import { linkedInBrowserSession } from "./voyager";

type SignInJob = {
  phase: "opening" | "waiting" | "saving" | "connected" | "cancelled" | "error";
  error: string | null;
  startedAt: number;
  child: ChildProcess;
};
const shared = globalThis as typeof globalThis & {
  zenroLinkedInSignIns?: Map<string, SignInJob>;
};
const jobs: Map<string, SignInJob> = shared.zenroLinkedInSignIns ?? new Map();
shared.zenroLinkedInSignIns = jobs;

export function linkedInSignInStatus(userId: string) {
  const job = jobs.get(userId);
  return job ? { phase: job.phase, error: job.error } : null;
}

export function cancelLinkedInSignIn(userId: string) {
  const job = jobs.get(userId);
  if (job && ["opening", "waiting"].includes(job.phase)) {
    job.phase = "cancelled";
    if (job.child.connected) job.child.disconnect();
  }
}

export function startLinkedInSignIn(userId: string) {
  if (userId !== (env.LOCAL_BEEPER_OWNER_ID || env.LOCAL_AGENTS_OWNER_ID))
    throw new SafeError(
      "LinkedIn sign-in is available only to this desktop installation’s owner.",
    );
  const previous = jobs.get(userId);
  if (
    previous &&
    ["opening", "waiting", "saving"].includes(previous.phase) &&
    Date.now() - previous.startedAt < 900_000
  )
    return { started: true };
  const root = localWorkspaceRoot();
  const script = resolve(root, "scripts/local-openrouter/linkedin-sign-in.mjs");
  if (!existsSync(script))
    throw new SafeError(
      "This 1a2o server does not have the desktop LinkedIn sign-in helper installed.",
    );
  const child = spawn(process.execPath, [script], {
    cwd: root,
    windowsHide: true,
    stdio: ["ignore", "ignore", "ignore", "ipc"],
  });
  const job: SignInJob = {
    phase: "opening",
    error: null,
    startedAt: Date.now(),
    child,
  };
  jobs.set(userId, job);
  child.on("message", async (message) => {
    if (
      jobs.get(userId) !== job ||
      !["opening", "waiting"].includes(job.phase) ||
      !message ||
      typeof message !== "object" ||
      !("type" in message)
    )
      return;
    if (message.type === "opened") job.phase = "waiting";
    if (message.type === "cancelled") job.phase = "cancelled";
    if (message.type === "error") {
      job.phase = "error";
      job.error =
        "LinkedIn sign-in could not finish. Try again and complete any verification.";
    }
    if (message.type === "session" && "session" in message) {
      job.phase = "saving";
      try {
        const session = linkedInBrowserSession.parse(message.session);
        await acceptLinkedInBrowserSession(userId, session);
        job.phase = "connected";
      } catch {
        job.phase = "error";
        job.error =
          "The LinkedIn session could not be saved. Please reconnect.";
      }
    }
  });
  child.on("error", () => {
    job.phase = "error";
    job.error = "Could not open the LinkedIn sign-in window.";
  });
  child.on("exit", () => {
    if (["opening", "waiting"].includes(job.phase)) job.phase = "cancelled";
  });
  return { started: true };
}
