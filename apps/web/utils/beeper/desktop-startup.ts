import "server-only";
import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

export async function ensureBeeperDesktop(autoStart: boolean) {
  const available = async () => {
    try {
      const response = await fetch("http://127.0.0.1:23373/v1/info", {
        signal: AbortSignal.timeout(1500),
        redirect: "error",
      });
      await response.body?.cancel();
      return response.ok;
    } catch {
      return false;
    }
  };
  if (await available()) return true;
  if (!autoStart || process.platform !== "win32" || !process.env.LOCALAPPDATA)
    return false;
  const executable = [
    "Programs/BeeperTexts/Beeper.exe",
    "Programs/Beeper/Beeper.exe",
  ]
    .map((path) => resolve(process.env.LOCALAPPDATA!, path))
    .find((path) => existsSync(path));
  if (!executable) return false;
  const allowedEnvironment = new Set([
    "systemroot",
    "windir",
    "path",
    "pathext",
    "localappdata",
    "appdata",
    "userprofile",
    "temp",
    "tmp",
    "comspec",
    "homedrive",
    "homepath",
  ]);
  const environment: NodeJS.ProcessEnv = {
    NODE_ENV: "production",
    ...Object.fromEntries(
      Object.entries(process.env).filter(([key]) =>
        allowedEnvironment.has(key.toLowerCase()),
      ),
    ),
  };
  try {
    const result = await promisify(execFile)(
      resolve(process.env.SystemRoot || "C:/Windows", "System32/tasklist.exe"),
      ["/FI", "IMAGENAME eq Beeper.exe", "/FO", "CSV", "/NH"],
      { windowsHide: true, timeout: 5000, env: environment, encoding: "utf8" },
    );
    if (!/^"Beeper\.exe"/im.test(result.stdout)) {
      await new Promise<void>((done, reject) => {
        const child = spawn(executable, [], {
          env: environment,
          detached: true,
          windowsHide: true,
          stdio: "ignore",
        });
        child.once("error", reject);
        child.once("spawn", () => {
          child.unref();
          done();
        });
      });
    }
    for (let attempt = 0; attempt < 12; attempt++) {
      if (await available()) return true;
      await new Promise((done) => setTimeout(done, 500));
    }
  } catch {
    return false;
  }
  return false;
}
