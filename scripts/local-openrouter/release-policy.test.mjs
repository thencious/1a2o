import assert from "node:assert/strict";
import test from "node:test";
import {validateReleaseDirectory,switchRelease} from "./release-policy.mjs";

test("release paths cannot escape the owned build directory",()=>{
  for(const value of ["../outside",".next-releases/../outside","C:/outside",".next-candidate",null]) assert.throws(()=>validateReleaseDirectory(value));
  assert.equal(validateReleaseDirectory(".next"),".next");
  assert.equal(validateReleaseDirectory(".next-releases/release-123"),".next-releases/release-123");
});
test("an invalid candidate never stops the working app",async()=>{
  const calls=[];
  await assert.rejects(switchRelease({previous:".next",candidate:".next-releases/new",checkCandidate:async()=>{throw new Error("Incomplete build");},stopWeb:async()=>calls.push("stop")}),/Incomplete/);
  assert.deepEqual(calls,[]);
});
test("a healthy candidate is checked before the live app is switched",async()=>{
  const calls=[];
  await switchRelease({previous:".next",candidate:".next-releases/new",checkCandidate:async()=>calls.push("check"),stopWeb:async()=>calls.push("stop"),writeActive:async value=>calls.push(value),installAssets:async()=>calls.push("assets"),startWeb:async()=>calls.push("start")});
  assert.deepEqual(calls,["check","stop",".next-releases/new","assets","start"]);
});
test("failed startup restores the previous release and its service worker",async()=>{
  const calls=[];let starts=0;
  await assert.rejects(switchRelease({previous:".next",candidate:".next-releases/new",checkCandidate:async()=>{},stopWeb:async()=>calls.push("stop"),writeActive:async value=>calls.push(value),installAssets:async()=>calls.push("new assets"),restoreAssets:async()=>calls.push("restore assets"),startWeb:async()=>{calls.push("start");if(!starts++)throw new Error("Candidate failed");}}),/Candidate failed/);
  assert.deepEqual(calls,["stop",".next-releases/new","new assets","start","stop",".next","restore assets","start"]);
});
