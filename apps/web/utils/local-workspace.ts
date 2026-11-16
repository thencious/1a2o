import "server-only";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export function localWorkspaceRoot() {
  const cwd = process.cwd();
  // Local account data and helper programs live outside the deployable app.
  // Following them during bundling would trace the entire checkout per route.
  return resolve(
    /* turbopackIgnore: true */
    existsSync(resolve(cwd, "scripts/local-openrouter/local.mjs"))
      ? cwd
      : resolve(/* turbopackIgnore: true */ cwd, "../.."),
  );
}
