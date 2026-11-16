import assert from "node:assert/strict";
import test from "node:test";
import { runMailJobsOnce,runTodoJobsOnce,runBeeperJobsOnce } from "./mail-jobs.mjs";

test("uses the authenticated local scheduler independently of AI requests", async () => {
  let calls = 0;
  const result = await runMailJobsOnce({ secret: "test-secret", fetchImpl: async (url, options) => {
    calls++;
    assert.equal(url, "http://127.0.0.1:3000/api/cron/scheduled-actions");
    assert.equal(options.headers.authorization, "Bearer test-secret");
    assert(options.signal instanceof AbortSignal);
    return Response.json({ processed: 1 });
  }});
  assert.equal(calls, 1);
  assert.deepEqual(result, { processed: 1 });
});

test("never starts anonymous scheduler requests", async () => {
  await assert.rejects(runMailJobsOnce({ secret: "", fetchImpl: () => { throw new Error("must not request"); } }), /requires CRON_SECRET/);
});

test("reports a wrong app or unavailable server for retry", async () => {
  await assert.rejects(runMailJobsOnce({ secret: "test-secret", fetchImpl: async () => new Response(null, { status: 404 }) }), /HTTP 404/);
});
test("task reminders use their own authenticated background endpoint without any AI calls",async()=>{
 const result=await runTodoJobsOnce({secret:"test-secret",fetchImpl:async(url,options)=>{assert.equal(url,"http://127.0.0.1:3000/api/cron/todo-reminders");assert.equal(options.headers.authorization,"Bearer test-secret");return Response.json({configured:true,queued:0});}});assert.equal(result.configured,true);
 await assert.rejects(runTodoJobsOnce({secret:"",fetchImpl:()=>{throw new Error("must not call");}}),/CRON_SECRET/);
});

test("Beeper starts and verifies through the authenticated background endpoint",async()=>{
 const result=await runBeeperJobsOnce({secret:"test-secret",fetchImpl:async(url,options)=>{assert.equal(url,"http://127.0.0.1:3000/api/cron/beeper-session");assert.equal(options.headers.authorization,"Bearer test-secret");return Response.json({phase:"ready"});}});assert.equal(result.phase,"ready");
 await assert.rejects(runBeeperJobsOnce({secret:"",fetchImpl:()=>{throw new Error("must not call");}}),/CRON_SECRET/);
});
