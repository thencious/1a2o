import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {chromium,expect} from '../../apps/web/node_modules/@playwright/test/index.mjs';
const assets=resolve('apps/web/public/open-todo-zero'),out=resolve('.context/qa/task-calendar-setup');mkdirSync(out,{recursive:true});
const browser=await chromium.launch({channel:'msedge',headless:true});
try {
 for(const scenario of ['default','ask','empty','links']) {
  const task={id:'fixture',title:'Send project proposal',confirmedTitle:'Send project proposal',createdAt:Date.now(),notes:'Fictional task',aiState:'success',completedAt:null,priority:'important',aiEvidence:{arguments:{calendar_kind:'deadline',calendar_explicit_time:true,calendar_title:'Send project proposal',calendar_start_local:'2026-11-20T14:00:00',calendar_end_local:null},timeContext:{sender_timezone:'America/Los_Angeles'}}};
  const bootstrap={revision:'base',tasks:[task],workspace:'tasks',aiAvailable:false,preferences:{defaultCalendar:null,calendarMode:null,policy:{autoAnalyze:false,estimateWork:false,calendarTimed:true,calendarAllDay:true,remindersEnabled:false}}};
  const context=await browser.newContext({viewport:{width:1280,height:850},colorScheme:'dark'});
  await context.route('**/*',async route=>{
   const url=new URL(route.request().url());
   if(url.pathname==='/owner/todo')return route.fulfill({contentType:'text/html',body:`<iframe style="width:100%;height:95vh;border:0" src="/api/user/todo/app"></iframe><script>window.requests=[];addEventListener('message',event=>{if(event.origin!==location.origin||event.data?.channel!=='inbox-todo')return;requests.push(event.data);let data={};if(event.data.type==='save')data={revision:'saved'};if(event.data.type==='calendar')data=${JSON.stringify(scenario)}==='links'?{kind:'disabled',reason:'timing_or_rules'}:event.data.input.target?{kind:'created'}:{kind:'needs-calendar'};event.source.postMessage({channel:'inbox-todo-result',id:event.data.id,data},location.origin)})</script>`});
   if(url.pathname==='/api/user/todo/app')return route.fulfill({contentType:'text/html',body:readFileSync(resolve(assets,'index.html'),'utf8').replace('<!--INBOX_TODO_BOOTSTRAP-->',`<script id="inbox-todo-bootstrap" type="application/json">${JSON.stringify(bootstrap)}</script>`)});
   if(url.pathname==='/api/user/todo/state')return route.fulfill({json:bootstrap});
   if(url.pathname==='/api/user/calendar/catalog')return route.fulfill({json:{calendars:scenario==='empty'?[]:[{name:'Personal',accountEmail:'owner@example.com',connectionId:'connected',calendarId:'primary',writable:true},{name:'Read only',writable:false}],warnings:[]}});
   if(url.pathname.startsWith('/open-todo-zero/'))return route.fulfill({body:readFileSync(resolve(assets,url.pathname.slice('/open-todo-zero/'.length))),contentType:{'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css'}[extname(url.pathname)]||'application/octet-stream'});
   return route.fulfill({json:{enabled:false}});
  });
  const page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('http://localhost:3999/owner/todo');const frame=page.frameLocator('iframe');
  if(scenario==='links'){
   const warning=frame.locator('#todo-calendar-status');await expect(warning).toContainText('No calendar event was added');
   await warning.getByRole('link',{name:'task timing',exact:true}).click();await expect(frame.locator('#due-date')).toBeFocused();
   await warning.getByRole('link',{name:'default calendar',exact:true}).click();await expect(frame.locator('#settings-dialog')).toBeVisible();await expect(frame.locator('#todo-calendar-mode')).toBeFocused();
  }else{
   const dialog=frame.getByRole('dialog',{name:'Choose a calendar for this task'});await expect(dialog).toBeVisible();
   if(scenario==='empty'){
    await expect(dialog).toContainText('No editable calendars found');await expect(dialog.getByRole('button',{name:'Add to calendar',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Not now',exact:true}).click();
   }else{
    const select=dialog.getByRole('combobox',{name:'Calendar for this task'});await expect(select.locator('option')).toHaveCount(2);
    await select.selectOption({index:1});if(scenario==='ask')await dialog.getByRole('checkbox').uncheck();
    await page.screenshot({path:resolve(out,`${scenario}.png`)});
    await dialog.getByRole('button',{name:'Add to calendar',exact:true}).click();await expect(dialog).not.toBeVisible();
    await expect(frame.locator('#todo-calendar-status')).toHaveText('Calendar event saved.');
    const requests=await page.evaluate(()=>window.requests),prefs=requests.find(x=>x.type==='preferences-save').input;
    assert.equal(prefs.calendarMode,scenario);if(scenario==='default')assert.equal(prefs.defaultCalendar.calendarId,'primary');else assert.equal(prefs.defaultCalendar,undefined);
    assert.equal(requests.filter(x=>x.type==='calendar').at(-1).input.target.calendarId,'primary');
   }
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify({scenario,passed:true}));await context.close();
 }
}finally{await browser.close();}
