import assert from "node:assert/strict";
import test from "node:test";
import {PassThrough} from "node:stream";
import {once} from "node:events";
import {watchBuildOutput} from "./build-progress-output.mjs";

test("forwards build logs unchanged and reads progress across chunk boundaries, carriage returns and final unterminated lines",async()=>{
  const stream=new PassThrough(),reports=[],chunks=[];
  watchBuildOutput(stream,{write:chunk=>chunks.push(chunk)},progress=>reports.push(progress));
  stream.write("Creating an optimized pro");
  stream.write("duction build ...\r\nRunning Type");
  stream.write("Script ...\rGenerating static pages (5/");
  stream.end("10)");
  await once(stream,"end");
  assert.equal(chunks.join(""),"Creating an optimized production build ...\r\nRunning TypeScript ...\rGenerating static pages (5/10)");
  assert.deepEqual(reports.map(progress=>progress.stage),["compile","types","pages"]);
  assert.equal(reports.at(-1).detail,"5 / 10 pages");
});
