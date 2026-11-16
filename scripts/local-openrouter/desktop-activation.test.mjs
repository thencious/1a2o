import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {openDesktopTarget} from './open-notification.mjs';
import {acknowledgeDesktopActivation,desktopActivationPath,queueDesktopActivation,readDesktopActivation} from '../../apps/web/utils/attention/desktop-activation.mjs';
const config={browser:'chrome_proxy.exe',arguments:'--profile-directory=Default --app-id=installed --app-launch-url-for-shortcuts-menu-item="http://localhost:3000/mail"'};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'zenro-activation-'));
 return {root,close(){assert(resolve(root).startsWith(resolve(tmpdir(),'zenro-activation-')));rmSync(root,{recursive:true,force:true})}};
}
test('notification destinations reach an existing window without starting another browser process',async()=>{
 const f=fixture();try{
  let launches=0;
  for(const path of ['/account/mail?accountScope=all&thread-id=thread&thread-account-id=other','/account/messages?chatId=chat%3Aroom&notification=message%3A123','/account/todo','/account/agents']){
   const result=await openDesktopTarget({root:f.root,config,target:'http://localhost:3000'+path,focusExisting:async()=>{assert.equal(readDesktopActivation(f.root).path,path);return{exists:true,focused:true}},launchBrowser:async()=>{launches++}});
   assert.equal(result.reused,true);assert.equal(acknowledgeDesktopActivation(f.root,result.activationId),true);assert.equal(readDesktopActivation(f.root),null);
  }
  assert.equal(launches,0);
 }finally{f.close()}
});
test('an existing but unfocused window never causes a duplicate; only a closed app launches one',async()=>{
 const f=fixture();try{
  const calls=[];const base={root:f.root,config,target:'http://localhost:3000/account/messages?chatId=chat',launchBrowser:async(...args)=>calls.push(args)};
  assert.equal((await openDesktopTarget({...base,focusExisting:async()=>({exists:true,focused:false})})).reused,true);assert.equal(calls.length,0);
  assert.equal((await openDesktopTarget({...base,focusExisting:async()=>({exists:false,focused:false})})).reused,false);assert.equal(calls.length,1);assert.equal(calls[0][0],config.browser);assert(calls[0][1].includes('--app-id=installed'));assert(calls[0][1].includes('--app-launch-url-for-shortcuts-menu-item='+base.target));
 }finally{f.close()}
});
test('old claims cannot consume a newer click, consumed clicks do not replay, and stale clicks expire',()=>{
 const f=fixture();try{
  const first=queueDesktopActivation(f.root,'/account/mail',1000),second=queueDesktopActivation(f.root,'/account/messages?chatId=new',2000);
  assert.equal(acknowledgeDesktopActivation(f.root,first.id,3000),false);assert.equal(readDesktopActivation(f.root,3000).id,second.id);
  assert.equal(acknowledgeDesktopActivation(f.root,second.id,3000),true);assert.equal(readDesktopActivation(f.root,3000),null);
  queueDesktopActivation(f.root,'/account/todo',1000);assert.equal(readDesktopActivation(f.root,602000),null);
 }finally{f.close()}
});
test('activation only accepts local app locations and retains exact conversation query values',()=>{
 assert.equal(desktopActivationPath('http://localhost:3000/account/messages?chatId=a%26b'),'/account/messages?chatId=a%26b');
 for(const path of ['https://example.com/account/mail','//example.com/account/mail','http://user:password@localhost:3000/account/mail','/api/user/me','/account/../../login'])assert.throws(()=>desktopActivationPath(path));
});
