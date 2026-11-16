import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export function nativeEnvironment(env = process.env) {
  const allowed = new Set(["systemroot","windir","path","pathext","temp","tmp","userprofile","appdata","localappdata","programfiles","programfiles(x86)","programdata","comspec","username","userdomain"]);
  return Object.fromEntries(Object.entries(env).filter(([key]) => allowed.has(key.toLowerCase())));
}
function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"], env: nativeEnvironment() });
    let output = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error("Windows notifications timed out")); }, 20_000);
    child.stdout.on("data", chunk => { output += chunk; });
    child.stderr.resume();
    child.on("error", () => { clearTimeout(timer); reject(new Error("Windows notification helper is unavailable")); });
    child.on("close", code => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error("Windows notifications could not be displayed. Check Windows notification settings."));
      try { resolve(JSON.parse(output.replace(/^\uFEFF/, "").trim())); } catch { reject(new Error("Windows notification helper returned an invalid response")); }
    });
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}
export async function deliverWindowsNotifications(events, { root, python } = {}) {
  if (process.platform !== "win32" || !events.length) return { ids: [] };
  const script = readFileSync(resolve(root, "scripts/local-openrouter/windows-toasts.ps1"), "utf8");
  const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], JSON.stringify({ root, events, python }));
  return result;
}
async function syncWindowsAttention(active, { root, python }) {
  if (process.platform !== "win32") return { matched: 0 };
  return run(python || "python", [resolve(root, "scripts/local-openrouter/windows-attention.py"), ...(active ? [] : ["--clear"])], "");
}
export async function runDesktopNotificationsOnce({ secret, root, python, fetchImpl = fetch, deliver = deliverWindowsNotifications, syncAttention = syncWindowsAttention }) {
  if (!secret) throw new Error("Desktop notifications require CRON_SECRET");
  const url = "http://127.0.0.1:3000/api/cron/desktop-notifications";
  const headers = { Authorization: `Bearer ${secret}` };
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`Desktop notifications returned HTTP ${response.status}`);
  const data = await response.json();
  let events=data.events||[];
  if(events.length){
    const prepared=await fetchImpl(url,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:JSON.stringify({ids:events.map(event=>event.id),prepare:true}),signal:AbortSignal.timeout(15000)});
    if(!prepared.ok)throw new Error("Could not check whether notification targets are already being viewed");
    const latest=await prepared.json();
    if(!Array.isArray(latest.events))throw new Error("Invalid notification delivery check");
    events=latest.events;data.counts=latest.counts??data.counts;
  }
  const result = await deliver(events, { root, python });
  if (result.ids.length) {
    const ack = await fetchImpl(url, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify({ ids: result.ids }), signal: AbortSignal.timeout(15_000) });
    if (!ack.ok) throw new Error("Could not save Windows notification receipts");
  }
  const errors = [...(data.errors || [])];
  let attention;
  try {
    // Unread/pending state is not a new event. Re-flashing it after focus would
    // undo Windows' own acknowledgement and repeatedly demand attention.
    if (result.ids.length) attention = await syncAttention(true, { root, python });
    else if (!Object.values(data.counts || {}).some(count => count > 0)) attention = await syncAttention(false, { root, python });
  } catch (error) {
    errors.push(`Taskbar attention: ${error.message}`);
  }
  return { delivered: result.ids.length, errors, attention };
}
