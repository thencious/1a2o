import assert from "node:assert/strict";
import { test } from "node:test";
import { jobRetryAt } from "./retry-policy.mjs";
test("permanent errors and provider cooldowns do not become rapid inference retries", () => {
  const now=Date.parse("2026-11-08T08:00:00Z");
  assert.equal(jobRetryAt({status:400,priority:true,now}),now+3600000);
  assert.equal(jobRetryAt({status:503,retryAfter:"21600",priority:true,now}),now+21600000);
  assert.equal(jobRetryAt({status:429,retryAfter:"120",now}),now+120000);
  assert.equal(jobRetryAt({status:403,now}),Date.parse("2026-11-09T00:00:00Z"));
});
test("temporary failures back off while allowing fresh mail to be attempted independently", () => {
  assert.equal(jobRetryAt({attempts:0,priority:true,now:0}),30000);
  assert.equal(jobRetryAt({attempts:10,priority:true,now:0}),1800000);
  assert.equal(jobRetryAt({attempts:10,priority:false,now:0}),3600000);
});
test("three failed attempts pause the individual email until the next absolute UTC reset", () => {
  const now=Date.parse("2026-11-08T08:00:00Z");
  assert.equal(jobRetryAt({failuresToday:3,priority:true,now}),Date.parse("2026-11-09T00:00:00Z"));
  assert.equal(jobRetryAt({failuresToday:1,priority:true,now}),now+30000);
});
