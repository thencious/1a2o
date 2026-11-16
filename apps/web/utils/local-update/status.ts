import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { localWorkspaceRoot } from "@/utils/local-workspace";
import { buildProgress } from "./progress.mjs";

const statusSchema = z.object({
  pid: z.number().int().positive(),
  phase: z.enum([
    "building",
    "checking",
    "switching",
    "ready",
    "failed",
    "activated",
  ]),
  at: z.string().datetime(),
  progress: z
    .object({
      stage: z.enum([
        "prepare",
        "compile",
        "types",
        "pages",
        "package",
        "check",
        "install",
      ]),
      label: z.string().max(100),
      step: z.number().int().min(1).max(7),
      steps: z.literal(7),
      percent: z.number().min(0).max(100),
      detail: z.string().max(100).nullable(),
    })
    .optional(),
});

export async function readLocalUpdate(userId: string) {
  const owner =
    process.env.LOCAL_BEEPER_OWNER_ID || process.env.LOCAL_AGENTS_OWNER_ID;
  if (!owner || userId !== owner) return { enabled: false, progress: null };
  try {
    const result = statusSchema.safeParse(
      JSON.parse(
        await readFile(
          resolve(localWorkspaceRoot(), ".context/update-status.json"),
          "utf8",
        ),
      ),
    );
    if (!result.success) return { enabled: true, progress: null };
    const state = result.data;
    if (
      !["building", "checking", "switching"].includes(state.phase) ||
      Date.now() - Date.parse(state.at) > 45 * 60_000
    )
      return { enabled: true, progress: null };
    process.kill(state.pid, 0);
    const progress =
      state.progress ??
      buildProgress(
        state.phase === "switching"
          ? "install"
          : state.phase === "checking"
            ? "check"
            : "compile",
      );
    return { enabled: true, progress };
  } catch {
    return { enabled: true, progress: null };
  }
}
