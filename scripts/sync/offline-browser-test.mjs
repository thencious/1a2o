import assert from 'node:assert/strict';import {readFileSync,existsSync,mkdirSync} from 'node:fs';import{resolve}from'node:path';import{chromium}from'../../apps/web/node_modules/@playwright/test/index.mjs';
const root=resolve('apps/web/public/open-todo-zero'),task={id:'local-task',title:'Offline task',notes:'Kept locally',createdAt:1,priority:'important',order:0},note={id:'local-note',title:'Private note',notes:'# Private note\n\nLocal body',createdAt:2,updatedAt:2};
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const context=await browser.newContext({viewport:{width:1150,height:800}});
 await context.addInitScript(({task,note})=>{if(!localStorage.getItem('still.tasks.v1'))localStorage.setItem('still.tasks.v1',JSON.stringify([task]));if(!localStorage.getItem('zenro.notes.v1'))localStorage.setItem('zenro.notes.v1',JSON.stringify([note]));},{task,note});
 await context.route('http://localhost:3998/**',async route=>{const path=new URL(route.request().url()).pathname;if(path.startsWith('/api/'))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Offline"}'});let file=path==='/account/todo'?resolve(root,'offline.html'):resolve(root,'.'+path.replace('/open-todo-zero',''));if(!file.startsWith(root)||!existsSync(file))return route.abort();const ext=file.split('.').pop();return route.fulfill({body:readFileSync(file),contentType:({html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',css:'text/css; charset=utf-8'})[ext]||'application/octet-stream'});});
 const page=await context.newPage();page.setDefaultTimeout(12000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3998/account/todo');const frame=page.frameLocator('#workspace');await frame.getByRole('button',{name:'Offline task',exact:true}).waitFor();
 await frame.getByRole('checkbox',{name:'Complete Offline task',exact:true}).click();
 assert(JSON.parse(await page.evaluate(()=>localStorage.getItem('still.tasks.v1')))[0].completedAt);
 await page.getByRole('button',{name:'Notes',exact:true}).click();await frame.getByRole('button',{name:/Private note/}).waitFor();await frame.getByRole('button',{name:'+ New note',exact:true}).click();
 const editor=frame.locator('.toastui-editor-ww-container [contenteditable="true"]');await editor.fill('Offline title\n\nWork while the server is disconnected.');await page.waitForTimeout(150);
 const before=await page.evaluate(()=>localStorage.getItem('zenro.notes.v1'));assert(before.includes('Work while'));
 await page.reload();await page.getByRole('button',{name:'Notes',exact:true}).click();await frame.getByRole('button',{name:/Offline title/}).waitFor();assert.equal(await page.evaluate(()=>localStorage.getItem('zenro.notes.v1')),before);
 assert.deepEqual(errors,[]);mkdirSync('.context/qa/offline-sync',{recursive:true});await page.screenshot({path:'.context/qa/offline-sync/notes.png'});
 console.log('PASS: cold offline fallback at /account/todo, local Tasks edit, Notes edit, reload persistence, no host/API required.');
}finally{await browser.close()}
