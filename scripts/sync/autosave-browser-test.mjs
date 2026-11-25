import assert from "node:assert/strict";
import { readFileSync, mkdirSync } from "node:fs";
import { resolve, extname, sep } from "node:path";
import { createHash } from "node:crypto";
import { chromium, expect } from "../../apps/web/node_modules/@playwright/test/index.mjs";
import { packCloudState, unpackCloudState } from "../../apps/web/utils/todo/cloud-sync-core.mjs";

const root = resolve(import.meta.dirname, "../..");
const assets = resolve(root, "apps/web/public/open-todo-zero");
const output = resolve(root, ".context/qa/autosave-races");
mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: "msedge", headless: true });
try {
  for (const [workspace, scenario] of [["notes", "save-snapshot"], ["notes", "stale-refresh"], ["notes", "recovery-visibility"], ["tasks", "stale-refresh"]]) {
    let remote = { revision: "base", tasks: [{ id: "item", title: "Autosave fixture", confirmedTitle: "Autosave fixture", createdAt: Date.now(), notes: "# Autosave fixture\n\nInitial text", priority: "important", completedAt: null, aiState: "success" }] };
    if(workspace==='notes') remote.tasks[0].recoveredVersions=[{...remote.tasks[0],notes:'# Autosave fixture\n\nRecovered text',updatedAt:1}];
    if(scenario==='recovery-visibility') remote.tasks.unshift({...remote.tasks[0],id:'orphan-recovery',title:'Autosave fixture (recovered edit)',notes:'Unique orphan content',recoveredFrom:'temporarily-missing',recoveredVersions:[]});
    let holdNext = false, release, revisionNumber = 0;
    const context = await browser.newContext({ viewport: { width: 1280, height: 850 }, colorScheme: "dark" });
    const page = await context.newPage();
    page.setDefaultTimeout(10_000);
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.pathname === "/test") return route.fulfill({ contentType: "text/html", body: `<iframe style="border:0;width:100%;height:95vh" src="/api/user/todo/app?workspace=${workspace}"></iframe><script>window.saves=[];window.sources=new Map();addEventListener('message',e=>{if(e.origin!==location.origin||e.data?.channel!=='inbox-todo')return;if(e.data.type==='save'){saves.push(e.data);sources.set(e.data.id,e.source)}else e.source.postMessage({channel:'inbox-todo-result',id:e.data.id,data:{}},location.origin)})</script>` });
      if (url.pathname === "/api/user/todo/app") {
        const bootstrap = { ...remote, workspace, aiAvailable: false, windowsNotifications: false, preferences: { policy: { autoAnalyze: false, estimateWork: false, remindersEnabled: false, calendarTimed: false, calendarAllDay: false } } };
        return route.fulfill({ contentType: "text/html", body: readFileSync(resolve(assets, workspace === "notes" ? "notes.html" : "index.html"), "utf8").replace("<!--INBOX_TODO_BOOTSTRAP-->", `<script id="inbox-todo-bootstrap" type="application/json">${JSON.stringify(bootstrap)}</script>`) });
      }
      if (url.pathname === "/api/user/todo/state") {
        const snapshot = structuredClone(remote);
        if (holdNext) { holdNext = false; await new Promise(resolve => { release = resolve; }); }
        return route.fulfill({ json: snapshot });
      }
      if (url.pathname.startsWith("/open-todo-zero/")) {
        const file = resolve(assets, url.pathname.slice("/open-todo-zero/".length));
        assert(file.startsWith(`${assets}${sep}`));
        return route.fulfill({ body: readFileSync(file), contentType: { ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css" }[extname(file)] ?? "application/octet-stream" });
      }
      return route.fulfill({ json: { enabled: false } });
    });
    await page.goto("http://localhost:3999/test", { waitUntil: "networkidle" });
    const frame = page.frameLocator("iframe");
    if (workspace === "tasks") await frame.getByRole("button", { name: "Autosave fixture", exact: true }).click();
    const editor = frame.locator(".cm-content");
    await editor.waitFor();
    if(workspace==='notes') {
      await frame.getByRole('button',{name:'Version history',exact:true}).click();
      await expect(frame.locator('dialog')).toContainText('Recovered text');
      await page.screenshot({path:resolve(output,`notes-history-${scenario}.png`)});
      await frame.getByRole('button',{name:'Close',exact:true}).click();
    }
    const storageKey = workspace === "notes" ? "zenro.notes.v1" : "still.tasks.v1";
    const baselineKey = workspace === "notes" ? "zenro.notes.baseline" : "zenro.tasks.saved-baseline";
    const revisionKey = workspace === "notes" ? "zenro.notes.revision" : "open-inbox-zero.todo.revision";
    const child = page.frames().find(frame => frame.url().includes("/api/user/todo/app"));
    const append = async text => { await editor.click(); await editor.press("Control+End"); await page.keyboard.insertText(text); };
    const acknowledge = async index => {
      await page.waitForFunction(index => window.saves.length > index, index);
      const save = await page.evaluate(index => window.saves[index], index);
      remote = { revision: `saved-${++revisionNumber}`, tasks: structuredClone(save.input.tasks) };
      await page.evaluate(({ id, revision }) => window.sources.get(id).postMessage({ channel: "inbox-todo-result", id, data: { revision } }, location.origin), { id: save.id, revision: remote.revision });
      await child.waitForFunction(({ key, revision }) => localStorage.getItem(key) === revision, { key: revisionKey, revision: remote.revision });
      return save;
    };
    // Task normalization may save once on opening a legacy-format fixture.
    // Finish that setup save before delaying requests for the edit scenario.
    await page.waitForTimeout(650);
    for (let index = 0; index < await page.evaluate(() => window.saves.length); index++) await acknowledge(index);
    await page.evaluate(() => { window.saves = []; window.sources.clear(); });
    if (scenario === "save-snapshot") {
      await append(" first");
      await page.waitForFunction(() => window.saves.length === 1);
      await append(" second");
      const sent = await acknowledge(0);
      const baseline = await child.evaluate(key => JSON.parse(localStorage.getItem(key)), baselineKey);
      assert.equal(baseline[0].notes, sent.input.tasks[0].notes, "A save acknowledgement must only acknowledge the text actually sent");
      assert(!baseline[0].notes.includes("second"));
      await acknowledge(1);
    } else if (scenario === 'recovery-visibility') {
      await expect(frame.locator('.note-row')).toHaveCount(1);
      await child.evaluate(() => {
        window.recoveryRowsSeen=[];
        window.recoveryObserver=new MutationObserver(records => {
          for(const record of records) for(const node of record.addedNodes) {
            if(node.nodeType===1 && (node.dataset?.noteId==='orphan-recovery' || node.textContent.includes('(recovered edit)'))) window.recoveryRowsSeen.push(node.textContent);
          }
        });
        window.recoveryObserver.observe(document.getElementById('note-list'),{childList:true,subtree:true});
      });
      for(let i=0;i<12;i++) {
        await append(' typing '+i);
        await child.evaluate(() => {
          const items=JSON.parse(localStorage.getItem('zenro.notes.v1'));
          window.dispatchEvent(new CustomEvent('zenro-notes-merge',{detail:items}));
        });
      }
      await expect(frame.locator('.note-row')).toHaveCount(1);
      assert.deepEqual(await child.evaluate(()=>window.recoveryRowsSeen),[], 'Recovery records must never enter the DOM, even for one render during typing');
      assert((await child.evaluate(()=>localStorage.getItem('zenro.notes.v1'))).includes('Unique orphan content'), 'Hidden recovery text must remain preserved');
    } else {
      holdNext = true;
      await child.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect.poll(() => Boolean(release)).toBe(true);
      await append(" newest typing");
      await acknowledge(0);
      release();
      await page.waitForTimeout(1100);
      const stored = await child.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      assert(stored[0].notes.includes("newest typing"), "A delayed older refresh must never roll back an acknowledged edit");
    }
    if(workspace === 'notes' && scenario === 'save-snapshot') {
      await frame.getByRole('button',{name:'Version history',exact:true}).click();
      await frame.getByRole('button',{name:'Restore',exact:true}).click();
      await expect(editor).toContainText('Recovered text');
      const restored = await child.evaluate(key => JSON.parse(localStorage.getItem(key)), storageKey);
      assert.equal(restored.length,1);
      assert(restored[0].recoveredVersions.some(version => version.notes.includes('second')), 'Restoring must preserve the current edited text in history');
    }
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(output, `${workspace}-${scenario}.png`) });
    console.log(JSON.stringify({ workspace, scenario, passed: true }));
    await context.close();
  }
  await verifyCloudSnapshot();
  await verifyBackendCoordinator();
} finally { await browser.close(); }

async function verifyCloudSnapshot() {
  const config = { url: "https://cloud.example.org", namespace: "autosave-fixture", key: "11".repeat(32), token: "22".repeat(32), deviceId: "33".repeat(32) };
  const base = { id: "note", title: "Original title", notes: "Original text", createdAt: 1, updatedAt: 1 };
  const local = { ...base, notes: "Local edit", updatedAt: 2 };
  const cloud = { revision: "remote", tasks: [{ ...base, title: "Remote title", updatedAt: 3 }] };
  const context = await browser.newContext();
  await context.addInitScript(({ config, base, local }) => {
    localStorage.setItem("1a2o.cloud.connection.v1", JSON.stringify(config));
    localStorage.setItem("zenro.notes.v1", JSON.stringify([local]));
    localStorage.setItem(`1a2o.cloud.meta:${config.namespace}:notes`, JSON.stringify({ revision: "base", baseline: [base] }));
  }, { config, base, local });
  let release, uploaded;
  const key = Buffer.from(config.key, "hex");
  const notesId = createHash("sha256").update(`${config.namespace}:notes`).digest("hex");
  await context.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === "/test") return route.fulfill({ contentType: "text/html", body: `<script>addEventListener('onea2o-cloud-merge',e=>{if(e.detail.workspace==='notes')window.buffer=e.detail.items})</script><script src="/open-todo-zero/browser-cloud-client.js"></script>` });
    if (url.pathname === "/api/user/todo/sync/connection") return route.fulfill({ json: { enabled: true, ...config } });
    if (url.origin === config.url) {
      const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization,Content-Type", "Access-Control-Allow-Methods": "GET,PUT,OPTIONS" };
      if (route.request().method() === "OPTIONS") return route.fulfill({ status: 200, headers });
      const isNotes = url.pathname.endsWith(notesId);
      if (route.request().method() === "GET") {
        const state = isNotes ? cloud : { revision: "empty", tasks: [] };
        return route.fulfill({ json: { rev: state.revision, payload: packCloudState(state, key) }, headers });
      }
      if (isNotes && !uploaded) {
        uploaded = route.request().postDataJSON();
        await new Promise(resolve => { release = resolve; });
      }
      return route.fulfill({ json: { saved: true }, headers });
    }
    if (url.pathname.startsWith("/open-todo-zero/")) return route.fulfill({ body: readFileSync(resolve(assets, url.pathname.slice("/open-todo-zero/".length))), contentType: "text/javascript" });
    return route.fulfill({ status: 404 });
  });
  const page = await context.newPage();
  await page.goto("http://localhost:3999/test");
  await expect.poll(() => Boolean(release)).toBe(true);
  await page.evaluate(() => { window.buffer[0].notes += " continued typing"; window.buffer[0].updatedAt = 4; localStorage.setItem("zenro.notes.v1", JSON.stringify(window.buffer)); window.Onea2oCloud.changed("notes"); });
  release();
  const metaKey = `1a2o.cloud.meta:${config.namespace}:notes`;
  await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key)).revision, metaKey)).toBe(uploaded.rev);
  const meta = await page.evaluate(key => JSON.parse(localStorage.getItem(key)), metaKey);
  assert.deepEqual(meta.baseline, unpackCloudState(uploaded.payload, key).tasks, "Cloud acknowledgement must not claim newer editor text was uploaded");
  assert((await page.evaluate(() => localStorage.getItem("zenro.notes.v1"))).includes("continued typing"));
  console.log(JSON.stringify({ workspace: "notes", scenario: "cloud-save-snapshot", passed: true }));
  await context.close();
}


async function verifyBackendCoordinator() {
 const context = await browser.newContext();
 const state = {revision:'host-revision', tasks:[{id:'n',title:'Fixture',notes:'Host text',createdAt:1}]};
 let cloudRequests=0;
 await context.addInitScript(state=>{
  localStorage.setItem('zenro.notes.v1',JSON.stringify(state.tasks));
 },state);
 await context.route('**/*', async route=>{
  const url=new URL(route.request().url());
  if(url.pathname==='/test')return route.fulfill({contentType:'text/html',body:'<script src="/open-todo-zero/browser-cloud-client.js"></script>'});
  if(url.pathname==='/api/user/todo/sync')return route.fulfill({json:{enabled:true,checkedAt:Date.now(),workspaces:{notes:{revision:state.revision,pending:false}}}});
  if(url.pathname==='/api/user/todo/state')return route.fulfill({json:state});
  if(url.pathname==='/api/user/todo/sync/connection')return route.fulfill({json:{enabled:true,url:'https://cloud.example.org',namespace:'fixture',key:'11'.repeat(32),token:'22'.repeat(32),deviceId:'33'.repeat(32)}});
  if(url.origin==='https://cloud.example.org'){cloudRequests++;return route.fulfill({status:503});}
  if(url.pathname.startsWith('/open-todo-zero/'))return route.fulfill({contentType:'text/javascript',body:readFileSync(resolve(assets,url.pathname.slice('/open-todo-zero/'.length)))});
  return route.fulfill({status:404});
 });
 const page=await context.newPage();await page.goto('http://localhost:3999/test');
 await expect.poll(()=>page.evaluate(()=>window.Onea2oCloud.status('notes')?.state)).toBe('synced');
 await page.evaluate(()=>{const items=JSON.parse(localStorage.getItem('zenro.notes.v1'));items[0].notes+=' typing';localStorage.setItem('zenro.notes.v1',JSON.stringify(items));});
 await page.evaluate(()=>window.Onea2oCloud.sync('notes'));
 assert.equal(await page.evaluate(()=>window.Onea2oCloud.status('notes').state),'pending');
 assert.equal(cloudRequests,0,'An active backend worker must be the sole cloud writer');
 console.log(JSON.stringify({scenario:'single-backend-cloud-writer',passed:true}));
 await context.close();
}
