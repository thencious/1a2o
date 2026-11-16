import { spawn, execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, copyFileSync, openSync, closeSync } from "node:fs";
import { resolve } from "node:path";
import { validateReleaseDirectory } from "./release-policy.mjs";

const root = resolve(import.meta.dirname, "../..");
const context = resolve(root, ".context"), app = resolve(root, "apps/web");
const status = JSON.parse(readFileSync(resolve(context, "update-status.json"), "utf8"));
const candidate = validateReleaseDirectory(status.candidate);
if (!existsSync(resolve(app, candidate, "BUILD_ID"))) throw new Error("No compiled release is available.");
const stateFile = resolve(context, "local-processes.json");
const state = JSON.parse(readFileSync(stateFile, "utf8"));
const web = state.children.findLast(child => child.name === "web");
if (web) {
  const pid = Number(web.pid), started = new Date(web.started).toISOString();
  if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error("Invalid web server identity.");
  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$taskProcess=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (!$taskProcess) {exit 0}; if ([Math]::Abs(($taskProcess.StartTime.ToUniversalTime()-[DateTime]::Parse('${started}').ToUniversalTime()).TotalSeconds) -ge 5) {throw 'Server identity changed'}; $taskDetails=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($taskDetails.CommandLine -notmatch 'next.*start') {throw 'Unexpected server process'}; Stop-Process -Id ${pid} -Force; $taskProcess.WaitForExit(5000) | Out-Null`], { timeout: 10000, windowsHide: true, stdio: "inherit" });
}
const pointer = resolve(context, "active-web-build.json");
copyFileSync(pointer, resolve(context, "previous-web-build.json"));
writeFileSync(pointer, JSON.stringify({ directory: candidate, installedAt: new Date().toISOString() }));
for (const name of ["sw.js", "sw.js.map"]) {
  const source = resolve(app, candidate, name);
  if (existsSync(source)) copyFileSync(source, resolve(app, "public", name));
}
const env = { ...process.env, NODE_ENV: "production", LOCAL_NEXT_BUILD_DIR: candidate };
delete env.TSX_TSCONFIG_PATH;
const out = openSync(resolve(context, "logs/web.log"), "a"), err = openSync(resolve(context, "logs/web.err.log"), "a");
const child = spawn(process.execPath, ["--env-file=.env.local", "--import", "tsx", resolve(app, "node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3000"], { cwd: app, env, detached: true, windowsHide: true, stdio: ["ignore", out, err] });
closeSync(out); closeSync(err);
await new Promise((done, reject) => { child.once("spawn", done); child.once("error", reject); });
child.unref();
state.children = state.children.filter(item => item.name !== "web");
state.children.push({ name: "web", pid: child.pid, started: new Date().toISOString() });
writeFileSync(stateFile, JSON.stringify(state, null, 2));
writeFileSync(resolve(context, "update-status.json"), JSON.stringify({ phase: "activated", candidate, at: new Date().toISOString(), checksSkipped: true }));
console.log("Switched to the compiled version. Extra startup checks were skipped. Refresh 1a2o.");
