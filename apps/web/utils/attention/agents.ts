import { localWorkspaceRoot } from "@/utils/local-workspace";
import "server-only";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { AgentAttentionSnapshot } from "./types";

export async function readAgentAttention(): Promise<AgentAttentionSnapshot[]> {
  const root = localWorkspaceRoot();
  let panels: { chat_id?: string; chat_title?: string }[];
  try {
    panels = JSON.parse(
      await readFile(resolve(root, ".context/agents/panels.json"), "utf8"),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const threadIds = [
    ...new Set(panels.map((panel) => panel.chat_id).filter(Boolean)),
  ];
  if (!threadIds.length) return [];
  const allowed = new Set([
    "systemroot",
    "windir",
    "path",
    "pathext",
    "temp",
    "tmp",
    "userprofile",
    "appdata",
    "localappdata",
    "programfiles",
    "programfiles(x86)",
    "comspec",
    "local_agents_timer_root",
    "local_agents_codex_path",
  ]);
  const env: NodeJS.ProcessEnv = {
    NODE_ENV: process.env.NODE_ENV,
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        allowed.has(key.toLowerCase()),
      ),
    ),
  };
  const agents = await new Promise<AgentAttentionSnapshot[]>(
    (resolveResult, reject) => {
      const child = spawn(
        /* turbopackIgnore: true */
        process.env.LOCAL_AGENTS_PYTHON || "python",
        [resolve(root, "scripts/local-agents/attention_probe.py")],
        { windowsHide: true, env, stdio: ["pipe", "pipe", "pipe"] },
      );
      let output = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error("Agent status lookup timed out"));
      }, 45_000);
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.resume();
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("Agent status helper is unavailable"));
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code !== 0) return reject(new Error("Agent status helper failed"));
        try {
          resolveResult(JSON.parse(output));
        } catch {
          reject(new Error("Invalid agent status response"));
        }
      });
      child.stdin.on("error", () => {});
      child.stdin.end(JSON.stringify({ threadIds }));
    },
  );
  return agents.map((agent) => ({
    ...agent,
    title:
      panels.find((panel) => panel.chat_id === agent.id)?.chat_title || "Agent",
  }));
}
