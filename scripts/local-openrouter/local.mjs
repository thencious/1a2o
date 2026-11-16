import { spawn, execFileSync } from "node:child_process";
import { closeSync, openSync, existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, appendFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { connect } from "node:net";
import { delimiter, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { activeReleaseDirectory } from "./release-policy.mjs";

const root = resolve(import.meta.dirname, "../..");
const tools = resolve(root, "../tools");
const nodeDir = resolve(tools, "node-v24.22.1-win-x64");
const node = resolve(nodeDir, "node.exe");
const pnpm = resolve(tools, "pnpm/node_modules/pnpm/bin/pnpm.cjs");
const pg = resolve(tools, "postgresql16/pgsql/bin");
const data = resolve(root, ".context");
const statePath = resolve(data, "local-processes.json");
process.chdir(root);
process.loadEnvFile(resolve(root, "apps/web/.env.local"));
process.env.PATH = [nodeDir, resolve(tools, "pnpm"), "C:\\Program Files\\Git\\bin", process.env.PATH].join(delimiter);
process.env.NODE_ENV = "production";
process.env.NEXT_TELEMETRY_DISABLED = "1";
delete process.env.TSX_TSCONFIG_PATH;
mkdirSync(resolve(data, "logs"), { recursive: true });

function run(command, args, options = {}) {
  return execFileSync(command, args, { cwd: root, windowsHide: true, timeout: 60_000, stdio: "inherit", ...options });
}

function ensureDatabase() {
  const status = spawn(pgPath("pg_ctl"), ["-D", resolve(data, "postgres"), "status"], { windowsHide: true, stdio: "ignore" });
  return new Promise((done, reject) => {
    status.on("error", reject);
    status.on("exit", (code) => {
      try {
        if (code !== 0) run(pgPath("pg_ctl"), ["-D", resolve(data, "postgres"), "-l", resolve(data, "logs/postgres.log"), "-o", "-h 127.0.0.1 -p 5433", "-w", "start"]);
        done();
      } catch (error) { reject(error); }
    });
  });
}

function pgPath(name) { return resolve(pg, `${name}.exe`); }

async function listening(port) {
  return new Promise((done) => {
    const socket = connect({ port, host: "127.0.0.1" });
    socket.setTimeout(500);
    socket.once("connect", () => { socket.destroy(); done(true); });
    socket.once("error", () => done(false));
    socket.once("timeout", () => { socket.destroy(); done(false); });
  });
}

function workerRunning(statusFile, commandPattern) {
  try {
    const status = JSON.parse(readFileSync(resolve(data, statusFile), "utf8"));
    const pid = Number(status.pid);
    if (!Number.isSafeInteger(pid) || pid <= 0) return false;
    const started = new Date(status.startedAt).toISOString();
    const script = `$taskProcess=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (!$taskProcess) { exit 1 }; if ([Math]::Abs(($taskProcess.StartTime.ToUniversalTime()-[DateTime]::Parse('${started}').ToUniversalTime()).TotalSeconds) -ge 5) { exit 1 }; $taskDetails=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($taskDetails.CommandLine -notmatch '${commandPattern}') { exit 1 }; exit 0`;
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore", timeout: 10_000 });
    return true;
  } catch { return false; }
}

function stopRecordedService(name, pattern) {
  if (!existsSync(statePath)) return false;
  const entry = JSON.parse(readFileSync(statePath, "utf8")).children.findLast(child => child.name === name);
  if (!entry) return false;
  const pid = Number(entry.pid), started = new Date(entry.started).toISOString();
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", `$taskProcess=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (!$taskProcess) {exit 1}; if ([Math]::Abs(($taskProcess.StartTime.ToUniversalTime()-[DateTime]::Parse('${started}').ToUniversalTime()).TotalSeconds) -ge 5) {exit 1}; $taskDetails=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($taskDetails.CommandLine -notmatch '${pattern}') {exit 1}; Stop-Process -Id ${pid} -Force; $taskProcess.WaitForExit(5000) | Out-Null; exit 0`], {stdio:"ignore", timeout:10000});
    return true;
  } catch { return false; }
}

async function stop() {
  // Stop only processes whose PID and start timestamp match our saved instance.
  if (existsSync(statePath)) {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    for (const child of [...state.children].reverse()) {
      const script = `$p=Get-Process -Id ${Number(child.pid)} -ErrorAction SilentlyContinue; if ($p -and [Math]::Abs(($p.StartTime.ToUniversalTime()-[DateTime]::Parse('${child.started}').ToUniversalTime()).TotalSeconds) -lt 5) { Stop-Process -Id $p.Id -Force }; exit 0`;
      run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { stdio: "ignore" });
    }
    unlinkSync(statePath);
  }
  const pgStatus = spawn(pgPath("pg_ctl"), ["-D", resolve(data, "postgres"), "status"], { windowsHide: true, stdio: "ignore" });
  const pgRunning = await new Promise((done) => { pgStatus.on("exit", (code) => done(code === 0)); pgStatus.on("error", () => done(false)); });
  if (pgRunning) run(pgPath("pg_ctl"), ["-D", resolve(data, "postgres"), "-m", "fast", "-w", "stop"], { stdio: "ignore" });
  console.log("Inbox Zero local services stopped.");
}

async function start() {
  const buildDirectory = activeReleaseDirectory(root);
  if (!existsSync(resolve(root, "apps/web", buildDirectory, "BUILD_ID"))) throw new Error("No installed production build is available. Run Build 1a2o.cmd.");
  let webRunning = await listening(3000);
  if (webRunning) {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/auth/ok", {signal:AbortSignal.timeout(45000)});
      await response.body?.cancel();
      if (!response.ok) throw new Error("Unhealthy web server");
    } catch {
      await delay(250);
      if (!(await listening(3000))) webRunning=false;
      else if (stopRecordedService("web", "next.*start")) webRunning=false;
      else throw new Error("Another app is using port 3000; no unrelated process was stopped.");
    }
  }
  if (!webRunning) {
    // Initialize auth before cron jobs can send competing cold-start requests.
    stopRecordedService("ai-worker", "ai-worker[.]mjs");
    stopRecordedService("mail-jobs", "mail-jobs[.]mjs");
  }
  if (!process.env.CRON_SECRET) {
    const secret = randomBytes(32).toString("hex");
    appendFileSync(resolve(root, "apps/web/.env.local"), `\nCRON_SECRET=${secret}\n`);
    process.env.CRON_SECRET = secret;
  }
  const previous = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")).children : [];
  // Retain one current owner per service, rather than every historical PID.
  const children = [...new Map(previous.filter(child=>child.name!=="launcher").map(child=>[child.name,child])).values()];
  const record = () => writeFileSync(statePath, JSON.stringify({ children }, null, 2));
  function service(name, command, args, cwd = root) {
    const out = openSync(resolve(data, `logs/${name}.log`), "a");
    const err = openSync(resolve(data, `logs/${name}.err.log`), "a");
    const environment = {...process.env};
    delete environment.LOCAL_NEXT_BUILD_DIR;
    if(name === "web" && buildDirectory !== ".next") environment.LOCAL_NEXT_BUILD_DIR=buildDirectory;
    const child = spawn(command, args, { cwd, env:environment, windowsHide: true, detached: true, stdio: ["ignore", out, err] });
    closeSync(out); closeSync(err);
    child.once("error", () => { console.error(`${name} failed to start; check .context/logs`); process.exitCode = 1; });
    const oldIndex = children.findIndex(entry=>entry.name===name);
    if (oldIndex>=0) children.splice(oldIndex,1);
    children.push({ name, pid: child.pid, started: new Date().toISOString() });
    record();
    child.unref();
    return child;
  }
  await ensureDatabase();
  if (existsSync(resolve(root, ".context/sync/config.enc"))) {
    let syncOwner;
    try {
      const lock = JSON.parse(readFileSync(resolve(data, "sync/worker.lock"), "utf8"));
      if (Number.isSafeInteger(lock.pid) && lock.pid > 0) {
        process.kill(lock.pid, 0);
        syncOwner = lock;
      }
    } catch {}
    if (syncOwner) {
      const index = children.findIndex(child => child.name === "workspace-sync");
      if (index >= 0) children.splice(index, 1);
      children.push({name:"workspace-sync",pid:syncOwner.pid,started:new Date(syncOwner.at).toISOString()});
      record();
    } else service("workspace-sync", node, ["scripts/sync/worker.mjs"]);
  }
  const mobileNetworkFile = resolve(root, ".context/mobile/network.json");
  if (existsSync(mobileNetworkFile) && JSON.parse(readFileSync(mobileNetworkFile, "utf8")).enabled && !(await listening(3012))) service("mobile-network", node, ["scripts/mobile/network-proxy.mjs"]);
  if (process.env.LOCAL_AGENTS_ENABLED === "true" && !(await listening(3011))) service("agents", node, ["scripts/local-agents/server.mjs"]);
  if (!(await listening(6380))) service("redis", resolve(tools, "garnet/net10.0/GarnetServer.exe"), ["--bind", "127.0.0.1", "--port", "6380", "--lua", "--memory", "256m", "--index", "16m"], data);
  if (!(await listening(3010))) service("openrouter", node, ["scripts/local-openrouter/gateway.mjs"]);
  if (!(await listening(8079))) service("redis-http", node, ["--import", "tsx", "apps/web/scripts/local-redis-http.ts"]);
  for (const port of [6380, 3010, 8079]) {
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      if (await listening(port)) { ready = true; break; }
      await delay(500);
    }
    if (!ready) throw new Error(`Service on port ${port} failed; check .context/logs`);
  }
  if (!webRunning) service("web", node, ["--import", "tsx", resolve(root, "apps/web/node_modules/next/dist/bin/next"), "start", "--hostname", "127.0.0.1", "--port", "3000"], resolve(root, "apps/web"));
  let webReady = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const response = await fetch("http://127.0.0.1:3000/api/auth/ok", { signal: AbortSignal.timeout(attempt === 0 ? 45_000 : 2000) });
      await response.body?.cancel();
      if (response.status === 200) { webReady = true; break; }
    } catch {}
    await delay(500);
  }
  if (!webReady) throw new Error("Web server failed to start; check .context/logs/web.err.log");
  if (process.env.OPENROUTER_API_KEY && !workerRunning("local-ai/status.json", "ai-worker[.]mjs")) service("ai-worker", node, ["scripts/local-openrouter/ai-worker.mjs"]);
  if (!workerRunning("mail-jobs-status.json", "mail-jobs[.]mjs")) service("mail-jobs", node, ["scripts/local-openrouter/mail-jobs.mjs"]);
  record();
  console.log("Inbox Zero ready at http://localhost:3000/login");
  console.log("Stop with Stop 1a2o.cmd. Logs are in .context/logs.");
}

try {
  const command = process.argv[2];
  if (command === "build") {
    await ensureDatabase();
    run(node, ["scripts/local-openrouter/release-build.mjs"], { timeout: 1_800_000 });
  } else if (command === "stop") {
    await stop();
  } else if (command === "start" || command === "ensure" || command === "restart-ai" || command === "restart-mail-jobs") {
    // Concurrent clicks join one startup instead of spawning duplicate services.
    const lock = resolve(data,"startup.lock");
    let owned = false;
    const deadline = Date.now()+150_000;
    while (!owned) {
      try { writeFileSync(lock,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:"wx"}); owned=true; }
      catch(error) {
        if(error.code!=="EEXIST") throw error;
        let holder;
        try { holder=JSON.parse(readFileSync(lock,"utf8")); }
        catch {
          // A second click can arrive while the first process is writing its lock.
          try { if(Date.now()-statSync(lock).mtimeMs>5000) {unlinkSync(lock);continue;} } catch {continue;}
          if(Date.now()>deadline) throw new Error("Unreadable startup lock; see startup logs.");
          await delay(250); continue;
        }
        try { process.kill(holder.pid,0); if(Date.now()-holder.at>180_000) throw new Error("Expired startup"); }
        catch {try{unlinkSync(lock);}catch{} continue;}
        if(Date.now()>deadline) throw new Error("Another startup is still running; see startup logs.");
        await delay(250);
      }
    }
    try {
      if(command === "restart-ai") {
        stopRecordedService("ai-worker", "ai-worker[.]mjs");
        stopRecordedService("openrouter", "gateway[.]mjs");
      }
      if(command === "restart-mail-jobs") stopRecordedService("mail-jobs", "mail-jobs[.]mjs");
      await start();
    } finally { if(owned) unlinkSync(lock); }
  } else {
    throw new Error("Usage: local.mjs build|start|stop");
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
