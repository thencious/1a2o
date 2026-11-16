import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nativeEnvironment, runDesktopNotificationsOnce } from "./windows-notifications.mjs";
import { desktopLaunchTarget, notificationArguments, notificationPath, readLauncherConfig } from "./open-notification.mjs";

test("desktop startup opens all inboxes and preserves email-link contents as data", () => {
  const initial=new URL(desktopLaunchTarget());
  assert.equal(initial.pathname,"/mail");assert.equal(initial.searchParams.get("accountScope"),"all");
  const mailto="mailto:person@example.com?subject=Hello%20there&body=Some%20text";
  const compose=new URL(desktopLaunchTarget(mailto));
  assert.equal(compose.origin,"http://localhost:3000");assert.equal(compose.searchParams.get("mailto"),mailto);
  assert.match(compose.searchParams.get("composeRequest"),/^[0-9a-f-]{36}$/);
  assert.throws(()=>desktopLaunchTarget("https://example.com"));
});

test("notification clicks can read launcher configuration saved by Windows PowerShell", () => {
  const root = mkdtempSync(join(tmpdir(), "inbox-notification-"));
  try {
    mkdirSync(join(root, ".context/desktop"), {recursive:true});
    const config = {browser:"chrome_proxy.exe",arguments:'--profile-directory=Default --app-id=installed'};
    for (const prefix of ["", "\uFEFF"]) {
      writeFileSync(join(root,".context/desktop/launcher.json"),prefix+JSON.stringify(config));
      assert.deepEqual(readLauncherConfig(root),config);
    }
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test("native helpers never inherit provider credentials", () => {
  assert.deepEqual(nativeEnvironment({ SystemRoot: "Windows", PATH: "bin", OPENROUTER_API_KEY: "secret", CRON_SECRET: "secret", INTERNAL_API_KEY: "secret" }), { SystemRoot: "Windows", PATH: "bin" });
});
test("notification links only open local app views and retain the installed app identity", () => {
  const uri = "open-inbox-zero://open?path=" + encodeURIComponent("/account/messages?chatId=chat");
  assert.equal(notificationPath(uri), "http://localhost:3000/account/messages?chatId=chat");
  for (const path of [
    "/account/mail?accountScope=all&thread-account-id=mailbox&thread-id=email-thread",
    "/account/messages?chatId=chat%3Aroom&notification=message%3A123",
    "/account/todo",
    "/account/agents",
  ]) assert.equal(notificationPath("open-inbox-zero://open?path="+encodeURIComponent(path)),"http://localhost:3000"+path);
  for (const path of ["https://evil.test/account/mail", "//evil.test/account/mail", "//u:p@localhost:3000/account/mail", "/api/admin", "/account/../../login"]) assert.throws(() => notificationPath("open-inbox-zero://open?path="+encodeURIComponent(path)));
  assert.deepEqual(notificationArguments('--profile-directory=Default --app-id=installed --app-launch-url-for-shortcuts-menu-item="http://localhost:3000/mail"', "http://localhost:3000/account/messages?chatId=chat"), ["--profile-directory=Default", "--app-id=installed", "--app-launch-url-for-shortcuts-menu-item=http://localhost:3000/account/messages?chatId=chat"]);
});
test("delivery is acknowledged only after Windows accepted the alert", async () => {
  const calls=[];
  const result=await runDesktopNotificationsOnce({secret:"test",root:"fixture",syncAttention:async()=>({}),deliver:async events=>({ids:events.map(event=>event.id)}),fetchImpl:async(url,options)=>{calls.push(options);return Response.json(options.method&&!JSON.parse(options.body).prepare?{saved:true}:{events:[{id:"alert"}],errors:[]});}});
  assert.equal(result.delivered,1);assert.equal(calls.length,3);assert.deepEqual(JSON.parse(calls[1].body),{ids:["alert"],prepare:true});assert.deepEqual(JSON.parse(calls[2].body),{ids:["alert"]});
  let count=0;
  await assert.rejects(runDesktopNotificationsOnce({secret:"test",deliver:async()=>{throw new Error("unavailable");},fetchImpl:async()=>{count++;return Response.json({events:[{id:"alert"}]});}}),/unavailable/);
  assert.equal(count,2);
});

test("a chat opened during collection is rechecked before Windows delivery", async () => {
  const calls=[],states=[];
  const result=await runDesktopNotificationsOnce({secret:"test",deliver:async events=>{assert.deepEqual(events,[]);return {ids:[]}},syncAttention:async active=>{states.push(active);return {}},fetchImpl:async(_url,options)=>{calls.push(options.method||"GET");return Response.json(options.method?{events:[],counts:{messages:0}}:{events:[{id:"seen"}],counts:{messages:1}})}});
  assert.equal(result.delivered,0);assert.deepEqual(calls,["GET","POST"]);assert.deepEqual(states,[false]);
});

test("old unread attention never re-flashes on polling and clears when acknowledged", async () => {
  const states=[];
  for (const counts of [{mail:2,messages:1}, {}]) {
    await runDesktopNotificationsOnce({secret:"test",deliver:async()=>({ids:[]}),syncAttention:async(active)=>{states.push(active);return {matched:1};},fetchImpl:async()=>Response.json({events:[],counts,errors:[]})});
  }
  assert.deepEqual(states,[false]);
});

test("taskbar failure is reported without redelivering an accepted toast", async () => {
  const methods=[];
  const result=await runDesktopNotificationsOnce({secret:"test",deliver:async()=>({ids:["alert"]}),syncAttention:async()=>{throw new Error("Taskbar helper unavailable");},fetchImpl:async(_url,options)=>{methods.push(options.method||"GET");return Response.json({events:[{id:"alert"}],counts:{mail:1},errors:[]});}});
  assert.deepEqual(methods,["GET","POST","POST"]);
  assert.match(result.errors[0],/Taskbar helper unavailable/);
});
