import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { env } from "@/env";
import { SafeError } from "@/utils/error";

export async function localAgentsRequest(
  userId: string,
  path: "/state" | "/metadata" | "/command",
  input?: unknown,
) {
  if (
    env.LOCAL_AGENTS_ENABLED !== "true" ||
    env.LOCAL_AGENTS_OWNER_ID !== userId
  )
    throw new SafeError(
      "Agents is available only to the configured owner of this local installation.",
    );
  let response: Response;
  const health = () =>
    fetch("http://127.0.0.1:3011/health", {
      headers: { Authorization: `Bearer ${env.INTERNAL_API_KEY}` },
      signal: AbortSignal.timeout(1000),
      cache: "no-store",
    })
      .then((response) => response.ok)
      .catch(() => false);
  if (!(await health())) {
    const root = localWorkspaceRoot();
    const child = spawn(
      process.execPath,
      [resolve(root, "scripts/local-agents/server.mjs")],
      { cwd: root, detached: true, windowsHide: true, stdio: "ignore" },
    );
    child.on("error", () => {});
    child.unref();
    for (let attempt = 0; attempt < 30; attempt++) {
      if (await health()) break;
      await delay(200);
    }
  }
  try {
    response = await fetch(`http://127.0.0.1:3011${path}`, {
      method: input === undefined ? "GET" : "POST",
      cache: "no-store",
      headers: {
        Authorization: `Bearer ${env.INTERNAL_API_KEY}`,
        "Content-Type": "application/json",
      },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }),
      signal: AbortSignal.timeout(50_000),
    });
  } catch {
    throw new SafeError(
      "The local Agents service is unavailable. Open 1a2o again to start it.",
    );
  }
  const result = await response.json();
  if (!response.ok)
    throw new SafeError(result.error || "The local agent request failed.");
  return result;
}
