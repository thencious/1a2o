import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { runDesktopNotificationsOnce } from "./windows-notifications.mjs";

export async function runMailJobsOnce({ secret, fetchImpl = fetch }) {
  if (!secret) throw new Error("Local scheduled mail requires CRON_SECRET");
  const response = await fetchImpl("http://127.0.0.1:3000/api/cron/scheduled-actions", {
    headers: { authorization: `Bearer ${secret}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Scheduled mail check returned HTTP ${response.status}`);
  return response.json();
}

export async function runTodoJobsOnce({secret,fetchImpl=fetch}){
 if(!secret)throw new Error("Task reminders require CRON_SECRET");
 const response=await fetchImpl("http://127.0.0.1:3000/api/cron/todo-reminders",{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(90_000)});
 if(!response.ok)throw new Error(`Task reminders returned HTTP ${response.status}`);return response.json();
}

export async function runBeeperJobsOnce({secret,fetchImpl=fetch}){
 if(!secret)throw new Error("Beeper session checks require CRON_SECRET");
 const response=await fetchImpl("http://127.0.0.1:3000/api/cron/beeper-session",{headers:{authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(60_000)});
 if(!response.ok)throw new Error(`Beeper session check returned HTTP ${response.status}`);return response.json();
}

async function main() {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  process.chdir(root);
  process.loadEnvFile(resolve(root, "apps/web/.env.local"));
  const path = resolve(root, ".context/mail-jobs-status.json");
  mkdirSync(dirname(path), { recursive: true });
  const status = { pid: process.pid, startedAt: new Date().toISOString(), updatedAt: "", phase: "starting", lastError: null, lastRunAt: null };
  let stopping = false;
  function heartbeat() {
    status.updatedAt = new Date().toISOString();
    writeFileSync(path + ".tmp", JSON.stringify(status));
    renameSync(path + ".tmp", path);
  }
  process.on("SIGTERM", () => { stopping = true; });
  process.on("SIGINT", () => { stopping = true; });
  heartbeat();
  const timer = setInterval(heartbeat, 30_000);
  let notificationsRunning = false;
  let linkedInRunning = false;
  const linkedInTimer = setInterval(async () => {
    if (linkedInRunning || stopping) return;
    linkedInRunning = true;
    try {
      const response = await fetch("http://127.0.0.1:3000/api/cron/linkedin-contacts", { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` }, signal: AbortSignal.timeout(280_000) });
      if (!response.ok) throw new Error(`LinkedIn contacts check returned HTTP ${response.status}`);
      const result = await response.json();
      status.linkedInLastRunAt = new Date().toISOString();
      status.linkedInLastError = result.failures ? "A saved LinkedIn connection could not be checked" : null;
    } catch (error) { status.linkedInLastError = error.message; }
    finally { linkedInRunning = false; }
  }, 60_000);
  const notificationsTimer = setInterval(async () => {
    if (notificationsRunning || stopping) return;
    notificationsRunning = true;
    try {
      const result = await runDesktopNotificationsOnce({ secret: process.env.CRON_SECRET, root, python: process.env.LOCAL_AGENTS_PYTHON });
      status.notificationsLastRunAt = new Date().toISOString();
      status.notificationsLastError = result.errors[0] ?? null;
      status.taskbarAttention = result.attention ?? null;
    } catch (error) { status.notificationsLastError = error.message; }
    finally { notificationsRunning = false; }
  }, 15_000);
  try {
    while (!stopping) {
      const beeperCheck=runBeeperJobsOnce({secret:process.env.CRON_SECRET}).then(result=>{status.beeperLastRunAt=new Date().toISOString();status.beeperPhase=result.phase;status.beeperMessage=result.message??null;status.beeperLastError=null;}).catch(error=>{status.beeperLastError=error.message;});
      try {
        await runMailJobsOnce({ secret: process.env.CRON_SECRET });
        status.phase = "running";
        status.lastError = null;
        status.lastRunAt = new Date().toISOString();
      } catch (error) {
        status.phase = "retrying";
        status.lastError = error.message;
      }
      try { const result=await runTodoJobsOnce({secret:process.env.CRON_SECRET});status.todoLastRunAt=new Date().toISOString();status.todoLastError=result.errors?.[0]??null; }
      catch(error){status.todoLastError=error.message;}
      await beeperCheck;
      heartbeat();
      if (!stopping) await delay(15_000);
    }
  } finally {
    clearInterval(timer);
    clearInterval(notificationsTimer);
    clearInterval(linkedInTimer);
    status.phase = "stopped";
    heartbeat();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
