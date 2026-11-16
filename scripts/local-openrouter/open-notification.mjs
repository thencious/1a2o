import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { spawn, execFile } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";
import { queueDesktopActivation } from "../../apps/web/utils/attention/desktop-activation.mjs";
import { nativeEnvironment } from "./windows-notifications.mjs";

export function notificationPath(value) {
  const url = new URL(value);
  if (url.protocol !== "open-inbox-zero:" || url.hostname !== "open") throw new Error("Invalid notification link");
  const path = url.searchParams.get("path") || "";
  const target = new URL(path, "http://localhost:3000");
  if (!path.startsWith("/") || path.startsWith("//") || target.username || target.password || target.origin !== "http://localhost:3000" || !/^\/[a-zA-Z0-9_-]+\/(mail|messages|todo|agents)$/.test(target.pathname)) throw new Error("Invalid notification destination");
  return target.toString();
}
export function notificationArguments(configured, target) {
  const args = (configured.match(/(?:[^\s"]+|"[^"]*")+/g) || []).map(arg => arg.replaceAll('"', ''));
  const index = args.findIndex(arg => arg.startsWith("--app-launch-url-for-shortcuts-menu-item=") || arg.startsWith("--app="));
  if (index >= 0) args[index] = args[index].split("=", 1)[0] + "=" + target;
  else args.push("--app=" + target);
  return args;
}
export function readLauncherConfig(root) {
  return JSON.parse(readFileSync(resolve(root, ".context/desktop/launcher.json"), "utf8").replace(/^\uFEFF/, ""));
}
export function desktopLaunchTarget(mailto) {
  const target = new URL("http://localhost:3000/mail?accountScope=all&split=all");
  if (mailto) {
    if (!mailto.toLowerCase().startsWith("mailto:")) throw new Error("Invalid email link");
    target.searchParams.set("composeRequest", randomUUID());
    target.searchParams.set("mailto", mailto);
  }
  return target.toString();
}
export async function openDesktopTarget({root, config, target, focusExisting, launchBrowser}) {
  const activation=queueDesktopActivation(root,target);
  const existing=await focusExisting();
  if(existing.exists)return {reused:true,focused:existing.focused,activationId:activation.id};
  await launchBrowser(config.browser,notificationArguments(config.arguments,target));
  return {reused:false,activationId:activation.id};
}
async function main() {
  const target = process.argv[2] === "--app" ? desktopLaunchTarget(process.argv.slice(3).find(value => value.toLowerCase().startsWith("mailto:"))) : notificationPath(process.argv[2]);
  const root = resolve(import.meta.dirname, "../..");
  const config = readLauncherConfig(root);
  let ready = process.argv.includes("--services-ready");
  if (!ready) try { ready = (await fetch("http://127.0.0.1:3000/api/auth/ok", { signal: AbortSignal.timeout(2000) })).ok; } catch {}
  if (!ready) await promisify(execFile)(process.execPath, [resolve(root, "scripts/local-openrouter/local.mjs"), "ensure"], { windowsHide: true, timeout: 160_000 });
  await openDesktopTarget({root,config,target,
    focusExisting:async()=>{
      const python=process.env.LOCAL_AGENTS_PYTHON||resolve(process.env.LOCALAPPDATA||"", "Programs/Python/Python313/python.exe");
      const result=await promisify(execFile)(python,[resolve(root,"scripts/local-openrouter/open_notification.py"),"--focus-existing"],{windowsHide:true,timeout:5000,env:nativeEnvironment(process.env)});
      return JSON.parse(result.stdout);
    },
    launchBrowser:async(browser,args)=>{
      // A user activation must not hide/minimize the PWA while opening it.
      const child=spawn(browser,args,{detached:true,stdio:"ignore",windowsHide:false,env:nativeEnvironment(process.env)});
      await new Promise((done,reject)=>{child.once("spawn",done);child.once("error",reject)});
      child.unref();
    },
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(() => {
  const folder = resolve(import.meta.dirname, "../../.context/logs");
  mkdirSync(folder, { recursive: true });
  appendFileSync(resolve(folder, "notification-clicks.log"), `${new Date().toISOString()} Notification launch failed\n`);
  process.exitCode = 1;
});
