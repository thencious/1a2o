import assert from "node:assert/strict";
import {test} from "node:test";
import {mkdtempSync,rmSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import {createQuota} from "./quota.mjs";
import {createUsage} from "./usage.mjs";
import {createGateway} from "./gateway.mjs";

test("retains historical totals and separates counted calls, batch items, failures and local blocks across restarts",()=>{
 const directory=mkdtempSync(join(tmpdir(),"inbox-usage-")),path=join(directory,"quota.sqlite");
 const at=Date.parse("2026-10-31T23:59:59Z");
 const quota=createQuota(path,{perDay:1000});quota.syncDailyFloor(15,at);
 let usage=createUsage(path);
 const good=usage.start({feature:"Messages classification",model:"test:free",counted:true,items:10},at);
 usage.finish(good,"succeeded",200,100);
 const failed=usage.start({feature:"Messages classification",model:"test:free",counted:true,items:10},at);
  usage.finish(failed,"failed",503,100,{provider:"AtlasCloud",category:"provider_unavailable"});
 usage.start({feature:"Messages classification",model:"test:free",counted:false,outcome:"blocked",status:403},at);
 usage.start({feature:"Messages classification",model:"test:free",counted:true,items:1},at+2000);
 usage.close();usage=createUsage(path);
 const report=usage.report("2026-10-31");
  assert.equal(report.recent.find(event=>event.outcome==="failed").provider,"AtlasCloud");
  assert.equal(report.recent.find(event=>event.outcome==="failed").error_category,"provider_unavailable");
 assert.equal(report.total,15);assert.equal(report.counted,2);assert.equal(report.legacyUnattributed,13);
 assert.equal(report.hourly[23].calls,2);assert.equal(report.hourly[23].failed,1);assert.equal(report.hourly[23].blocked,1);
 assert.equal(report.groups.reduce((n,g)=>n+(g.items??0),0),20);
 assert.equal(report.recent.length,3);assert.equal(usage.report("2026-11-01").counted,1);
 assert.throws(()=>usage.report("2026-02-30"));assert.throws(()=>usage.report("invalid"));
 usage.close();quota.close();rmSync(directory,{recursive:true});
});

test("gateway logs upstream rejection once and distinguishes local budget blocks without upstream calls",async()=>{
 const directory=mkdtempSync(join(tmpdir(),"inbox-usage-gateway-")),path=join(directory,"quota.sqlite");
 const quota=createQuota(path,{perDay:1}),usage=createUsage(path);let calls=0;
 const server=createGateway({apiKey:"test",quota,usage,fetchImpl:async()=>{calls++;return Response.json({error:"test rejection"},{status:503});}});
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const url=`http://127.0.0.1:${server.address().port}`;
 try{
  const request=()=>fetch(url+"/api/v1/chat/completions",{method:"POST",headers:{Authorization:"Bearer test","x-inbox-zero-feature":"Messages classification","x-inbox-zero-items":"10"},body:JSON.stringify({model:"test:free"})});
  assert.equal((await request()).status,503);assert.equal((await request()).status,403);assert.equal(calls,1);
  assert.equal((await fetch(url+"/usage?day=2026-10-31")).status,401);
  const day=new Date().toISOString().slice(0,10);
  const response=await fetch(url+"/usage?day="+day,{headers:{Authorization:"Bearer test"}});const report=await response.json();
  assert.equal(report.total,1);assert.equal(report.legacy,0);assert.equal(report.groups.find(g=>g.counted).outcome,"failed");
  assert.equal(report.groups.find(g=>!g.counted).outcome,"blocked");assert.equal(report.recent[0].feature,"Messages classification");
  assert(!JSON.stringify(report).includes("Bearer"));
 }finally{await new Promise(resolve=>server.close(resolve));usage.close();quota.close();rmSync(directory,{recursive:true});}
});
