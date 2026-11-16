import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, unlinkSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareRequest, requestRoute, failureDetails, createRouteHealth } from "./request-policy.mjs";

test("routes rejected Dots requests to a compatible free endpoint, preserves schemas and removes incompatible text cache parts", () => {
  const original = { model:"dots-studio/dots-3-note-preview:free", messages:[{role:"system",content:[{type:"text",text:"Private note",cache_control:{type:"ephemeral"}}]}], response_format:{type:"json_schema",json_schema:{schema:{type:"object"}}}, prompt_cache_key:"account" };
  const fixed = prepareRequest(original,true);
  assert.equal(fixed.model,"nvidia/nemotron-3.5-super-vl:free");assert.equal(fixed.messages[0].content,"Private note");
  assert.deepEqual(fixed.response_format,original.response_format);assert.equal(fixed.provider.require_parameters,true);assert.deepEqual(fixed.provider.max_price,{prompt:0,completion:0});assert.equal(fixed.max_tokens,8192);assert(!fixed.prompt_cache_key);
  assert(Array.isArray(original.messages[0].content));
});
test("preserves tool arguments, multimodal inputs and explicit output limits", () => {
  const input={model:"nvidia/nemotron-3.5-super-vl:free",max_tokens:1000,tools:[{function:{name:"reply",parameters:{type:"object"}}}],tool_choice:"required",messages:[{role:"user",content:[{type:"text",text:"Image"},{type:"image_url",image_url:{url:"data:image/png;base64,a"}}]}]};
  const fixed=prepareRequest(input,true);assert.equal(fixed.max_tokens,1000);assert.deepEqual(fixed.tools,input.tools);assert.deepEqual(fixed.messages,input.messages);assert.equal(fixed.tool_choice,"required");
  assert.deepEqual(prepareRequest(input,false),input);
});
test("circuit breaker stops repeated permanent rejections without blocking unrelated formats or features", () => {
  const health=createRouteHealth(":memory:"),route=requestRoute({model:"test:free",response_format:{type:"json_schema"}},"Choose rule");
  health.failed(route,400,{category:"invalid_request",provider:"AtlasCloud"},1000);assert.equal(health.paused(route.key,1000),null);
  health.failed(route,400,{category:"invalid_request",provider:"AtlasCloud"},2000);assert(health.paused(route.key,2001));
  assert.equal(health.paused(requestRoute({model:"test:free"},"Choose rule").key,2001),null);
  assert.equal(health.paused(requestRoute({model:"test:free",response_format:{type:"json_schema"}},"Draft reply").key,2001),null);
  assert.equal(health.pauses(2001).length,1);health.succeeded(route.key);assert.equal(health.pauses(2001).length,0);health.close();
});
test("expired circuits permit a bounded recovery probe and diagnostics never retain message text", () => {
  const health=createRouteHealth(":memory:"),route=requestRoute({model:"test:free",messages:[{role:"user",content:"private content"}]},"Choose rule");
  const details=failureDetails(400,{error:{message:"private content",metadata:{provider_name:"AtlasCloud",raw:"secret"}}});
  assert.deepEqual(details,{provider:"AtlasCloud",category:"invalid_request"});
  health.failed(route,400,details,1000);health.failed(route,400,details,1001);const until=health.paused(route.key,1002).until;
  assert.equal(health.paused(route.key,until),null);health.failed(route,400,details,until);assert.equal(health.paused(route.key,until),null);
  assert(!JSON.stringify(health.pauses(1002)).includes("private content"));health.close();
});

test("provider pauses survive a gateway restart", () => {
  const directory=mkdtempSync(join(tmpdir(),"zenro-route-health-")),file=join(directory,"routes.sqlite");
  const route=requestRoute({model:"test:free"},"Choose rule");
  let health=createRouteHealth(file);
  health.failed(route,400,{category:"invalid_request",provider:"AtlasCloud"},1000);
  health.failed(route,400,{category:"invalid_request",provider:"AtlasCloud"},1001);health.close();
  health=createRouteHealth(file);
  try { assert.equal(health.paused(route.key,1002).feature,"Choose rule"); }
  finally { health.close();unlinkSync(file);rmdirSync(directory); }
});
