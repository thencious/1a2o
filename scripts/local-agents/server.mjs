import http from 'node:http';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {mkdirSync, readFileSync, writeFileSync, renameSync, existsSync, globSync} from 'node:fs';
import {resolve, dirname} from 'node:path';
import {childEnvironment, panelOptions, validOrigin} from './policy.mjs';
import {setTimeout as delay} from 'node:timers/promises';
import {panelTaskIds,nextScheduledCallDue} from './scheduled-calls.mjs';

const root=resolve(import.meta.dirname,'../..');
process.loadEnvFile(resolve(root,'apps/web/.env.local'));
if(process.env.LOCAL_AGENTS_ENABLED!=='true') throw new Error('Local Agents is disabled.');
const secret=process.env.INTERNAL_API_KEY;
if(!secret || !process.env.LOCAL_AGENTS_OWNER_ID || !process.env.LOCAL_AGENTS_TIMER_ROOT) throw new Error('Local Agents configuration is incomplete.');
let handler;
const server=http.createServer((request,response)=>{
 if(handler)handler(request,response);else{response.writeHead(503);response.end();}
});
await new Promise((resolve,reject)=>{
 server.once('error',error=>{if(error.code==='EADDRINUSE')process.exit(0);else reject(error);});
 server.listen(3011,'127.0.0.1',resolve);
});
const require=createRequire(resolve(root,'apps/web/package.json'));
const pty=require('node-pty');
const {WebSocketServer}=require('ws');
const baseUrl=new URL(process.env.NEXT_PUBLIC_BASE_URL).origin;
const port=3011;
const data=resolve(root,'.context/agents');
mkdirSync(data,{recursive:true});
const file=resolve(data,'panels.json');
let panels=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):[];
panels=panels.map(panel=>({...panel,taskIds:panelTaskIds(panel)}));
const terminals=new Map(), tickets=new Map(), clients=new Map();
const cleanEnv=childEnvironment(process.env);
const executable=process.env.LOCAL_AGENTS_CODEX_PATH || resolve(process.env.LOCALAPPDATA,'Programs/OpenAI/Codex/bin/codex.exe');
const python=spawn(process.env.LOCAL_AGENTS_PYTHON || 'python',['-u',resolve(import.meta.dirname,'timer_bridge.py')],{
 windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...cleanEnv,LOCAL_AGENTS_TIMER_ROOT:process.env.LOCAL_AGENTS_TIMER_ROOT,LOCAL_AGENTS_CODEX_PATH:executable,LOCAL_AGENTS_DATA:data},
});
python.stderr.on('data',chunk=>process.stderr.write(chunk));
const pending=new Map();let counter=0;
createInterface({input:python.stdout}).on('line',line=>{
 try{const message=JSON.parse(line);if(message.event==='terminal_delivery'){deliverFirstPrompt(message);return;}const job=pending.get(message.id);if(job){clearTimeout(job.timeout);pending.delete(message.id);message.error?job.reject(new Error(message.error)):job.resolve(message.result);}}catch{}
});
async function deliverFirstPrompt(message){
 let error='';
 try{
  const panel=panels.find(panel=>panel.chat_id===message.chatId);
  const entry=panel&&terminals.get(panel.id);
  if(!entry || entry.exited)throw new Error('Open the new chat terminal before sending its first message.');
  if(!/^[0-9a-f-]{36}$/i.test(message.deliveryId))throw new Error('Invalid delivery identity.');
  const receipt=resolve(data,`delivery-${message.deliveryId}.json`);
  if(existsSync(receipt))throw new Error('This terminal delivery was already attempted. Check the terminal before retrying.');
  writeFileSync(receipt,JSON.stringify({phase:'attempted',chatId:message.chatId,time:Date.now()}),{flag:'wx'});
  entry.pty.write('\x1b[200~'+message.message.replaceAll('\x1b','')+'\x1b[201~');
  await delay(250);
  if(entry.exited)throw new Error('The CLI exited before submission. Check the terminal before retrying.');
  entry.pty.write('\r');
  writeFileSync(receipt,JSON.stringify({phase:'submitted',chatId:message.chatId,time:Date.now()}));
 }catch(failure){error=failure.message;}
 rpc('terminal_result',{deliveryId:message.deliveryId,error}).catch(()=>{});
}
python.on('exit',()=>{for(const job of pending.values()){clearTimeout(job.timeout);job.reject(new Error('Timer bridge stopped. Restart Local Agents.'));}pending.clear();});
function rpc(method,args={}){
 return new Promise((resolve,reject)=>{
  const id=++counter;
  const timeout=setTimeout(()=>{pending.delete(id);reject(new Error('Codex task request timed out. Check its status before retrying.'));},45000);
  pending.set(id,{resolve,reject,timeout});
  python.stdin.write(JSON.stringify({id,method,args})+'\n',error=>{if(error){clearTimeout(timeout);pending.delete(id);reject(error);}});
 });
}
function save(){writeFileSync(file+'.tmp',JSON.stringify(panels));renameSync(file+'.tmp',file);}
function emit(id,message){for(const client of clients.get(id)??[])if(client.readyState===1)client.send(JSON.stringify(message));}
function stopTerminal(id){const entry=terminals.get(id);if(entry){if(!entry.exited)entry.pty.kill();terminals.delete(id);}}
function startTerminal(panel,cols=80,rows=24){
 if(terminals.has(panel.id))return terminals.get(panel.id);
 if(!panel.chat_id && !panel.new_chat)throw new Error('Choose a chat or create a new one first.');
 if(!panel.cwd || !existsSync(panel.cwd))throw new Error('The working folder is missing.');
 const codexHome=process.env.CODEX_HOME||resolve(process.env.USERPROFILE,'.codex');
 const hasHistory=panel.chat_id && globSync(`**/*${panel.chat_id}*.jsonl`,{cwd:resolve(codexHome,'sessions')}).length>0;
 const fresh=panel.new_chat&&!hasHistory;
 const args=[...(fresh?[]:['resume',panel.chat_id]),'--remote','unix://','--cd',panel.cwd,...(fresh?['-c','tui.status_line=["model-with-reasoning","session-id"]']:[])];
 // Preserve the user's native keymap, approval settings and sandbox.
 const child=pty.spawn(executable,args,{name:'xterm-256color',cols:fresh?120:cols,rows,cwd:panel.cwd,env:{...cleanEnv,TERM:'xterm-256color',COLORTERM:'truecolor'},useConpty:true});
 const entry={pty:child,buffer:'',exited:false,detectSession:fresh,pendingSize:null};terminals.set(panel.id,entry);
 child.onData(chunk=>{
  entry.buffer=(entry.buffer+chunk).slice(-2_000_000);
  if(entry.detectSession){const id=entry.buffer.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)?.[0];if(id){panel.chat_id=id;entry.detectSession=false;save();emit(panel.id,{type:'session',panel});if(entry.pendingSize)entry.pty.resize(...entry.pendingSize);}}
  emit(panel.id,{type:'output',data:chunk});
 });
 child.onExit(({exitCode})=>{entry.exited=true;emit(panel.id,{type:'exit',code:exitCode});});
 return entry;
}
async function command(input){
 if(input.op==='add'){
  if(panels.length>=32)throw new Error('Close an agent panel before adding another.');
  const panel={id:randomUUID(),chat_id:'',chat_title:'Choose agent',cwd:process.env.USERPROFILE,model:'',effort:'Default',message:'',cwd_manual:false,taskId:null};
  panels.push(panel);save();return panel;
 }
 const panel=panels.find(item=>item.id===input.id);
 if(!panel)throw new Error('Agent panel not found.');
 if(input.op==='configure'){
  const settings=panelOptions(input.settings??{},panel);
  if(settings.chat_id==='' && panel.new_chat && panel.chat_id)settings.chat_id=panel.chat_id;
  if(settings.chat_id!==panel.chat_id){
   const tasks=await rpc('state');
   if(tasks.some(task=>panelTaskIds(panel).includes(task.id) && ['running','scheduled','paused','resuming'].includes(task.status)))throw new Error('Cancel scheduled calls or wait for delivery before changing chats.');
   const meta=await rpc('metadata');const chat=meta.chats.find(chat=>chat.id===settings.chat_id);
   if(!chat)throw new Error('Select a chat from your local history.');
   settings.chat_title=chat.title;settings.cwd=chat.cwd;settings.model=chat.model;settings.effort='Default';settings.cwd_manual=false;
   stopTerminal(panel.id);settings.taskId=null;settings.taskIds=[];settings.new_chat=false;
  }
  Object.assign(panel,settings);save();
  return panel;
 }
 if(input.op==='new'){
  if(panel.chat_id)throw new Error('Add a new panel to create another chat.');
  Object.assign(panel,{new_chat:true,chat_title:'New Codex chat'});save();return panel;
 }
 if(input.op==='remove'){
  const tasks=await rpc('state');
  if(tasks.some(task=>panelTaskIds(panel).includes(task.id) && ['running','resuming'].includes(task.status)))throw new Error('Wait for the running delivery before closing this panel.');
  for(const taskId of panelTaskIds(panel))await rpc('cancel',{taskId});
  stopTerminal(panel.id);panels=panels.filter(item=>item.id!==panel.id);save();return {removed:true};
 }
 if(input.op==='connect'){
  await rpc('ensure_server');
  const token=randomBytes(32).toString('hex');
  for(const [key,ticket] of tickets)if(ticket.expires<Date.now())tickets.delete(key);
  tickets.set(token,{panelId:panel.id,expires:Date.now()+60000});
  return {url:`ws://127.0.0.1:${port}/terminal?ticket=${token}`};
 }
 if(input.op==='restart'){stopTerminal(panel.id);return {restarted:true};}
 if(input.op==='cancel_all'){
  const tasks=await rpc('state');if(tasks.some(task=>panelTaskIds(panel).includes(task.id)&&['running','resuming'].includes(task.status)))throw new Error('A call is already delivering. Wait before closing its scheduler.');
  for(const taskId of panelTaskIds(panel))await rpc('cancel',{taskId});panel.taskIds=[];panel.taskId=null;save();return {cancelled:true};
 }
 if(input.taskId&&!panelTaskIds(panel).includes(input.taskId))throw new Error('Scheduled call not found in this agent.');
 if(input.op==='edit_schedule'){const task=(await rpc('state')).find(task=>task.id===input.taskId);if(!task)throw new Error('Scheduled call not found.');return rpc('edit',{...panelOptions(input.settings??{},task),taskId:input.taskId});}
 if(['send','timer'].includes(input.op)){
  const all=await rpc('state'),ids=panelTaskIds(panel),previous=ids.map(id=>all.find(task=>task.id===id)).filter(Boolean);
  if(!panel.chat_id)throw new Error('Wait for the CLI to connect before scheduling a call.');
  const taskId=input.append?null:(input.taskId??panel.taskId);
  const existing=all.find(task=>task.id===taskId);
  const appendAfterPrevious=input.append&&previous.some(task=>['scheduled','paused'].includes(task.status));
  const task=await rpc(input.op,{...panelOptions(existing??{},panel),message:input.append?(previous.at(-1)?.message??panel.message):(existing?.message??panel.message),taskId,delay:input.delay,...(appendAfterPrevious&&!input.delay?{due:nextScheduledCallDue(previous)}:{})});
  panel.taskIds=[...new Set([...ids,task.id])];panel.taskId=panel.taskIds[0]??null;save();return task;
 }
 if(['pause','cancel','editing'].includes(input.op)){
  const taskId=input.taskId??panel.taskId;const result=await rpc(input.op,{taskId,active:input.active});
  if(input.op==='cancel'){panel.taskIds=panelTaskIds(panel).filter(id=>id!==taskId);panel.taskId=panel.taskIds[0]??null;save();}return result;
 }
 throw new Error('Unknown agent operation.');
}
const mutations=new Map();
function dispatch(input){
 const key=input.id??'add';
 const previous=mutations.get(key)??Promise.resolve();
 const next=previous.catch(()=>{}).then(()=>command(input));
 mutations.set(key,next);
 const clear=()=>{if(mutations.get(key)===next)mutations.delete(key);};
 next.then(clear,clear);
 return next;
}
function authorized(request){
 const supplied=Buffer.from(request.headers.authorization??''),expected=Buffer.from('Bearer '+secret);
 return supplied.length===expected.length && timingSafeEqual(supplied,expected) && !request.headers.origin;
}
handler=async(request,response)=>{
 response.setHeader('Cache-Control','no-store');
 if(!authorized(request)){response.writeHead(401);return response.end();}
 try{
  let result;
  if(request.method==='GET' && request.url==='/health')result={ok:true};
  else if(request.method==='GET' && request.url==='/state')result={panels,tasks:await rpc('state')};
  else if(request.method==='GET' && request.url==='/metadata')result=await rpc('metadata');
  else if(request.method==='POST' && request.url==='/command'){
   let body='';for await(const chunk of request){body+=chunk;if(body.length>300000)throw new Error('Agent request is too large.');}
   result=await dispatch(JSON.parse(body));
  }else{response.writeHead(404);return response.end();}
  response.setHeader('Content-Type','application/json');response.end(JSON.stringify(result));
 }catch(error){response.writeHead(400,{'Content-Type':'application/json'});response.end(JSON.stringify({error:error.message}));}
};
const ws=new WebSocketServer({noServer:true,maxPayload:300000});
server.on('upgrade',(request,socket,head)=>{
 const url=new URL(request.url,'http://127.0.0.1');const ticket=tickets.get(url.searchParams.get('ticket'));
 if(url.pathname!=='/terminal'||!validOrigin(request.headers.origin,baseUrl)||!ticket||ticket.expires<Date.now()){socket.destroy();return;}
 tickets.delete(url.searchParams.get('ticket'));
 ws.handleUpgrade(request,socket,head,client=>{
  const id=ticket.panelId;const panel=panels.find(item=>item.id===id);
  if(!panel){client.close();return;}
  let entry;
  try{entry=startTerminal(panel);}catch(error){client.send(JSON.stringify({type:'error',message:error.message}));client.close();return;}
  if(!clients.has(id))clients.set(id,new Set());clients.get(id).add(client);
  client.send(JSON.stringify({type:'output',data:entry.buffer}));
  if(panel.chat_id)client.send(JSON.stringify({type:'session',panel}));
  if(entry.exited)client.send(JSON.stringify({type:'exit',code:0}));
  client.on('message',raw=>{
   try{const message=JSON.parse(raw.toString());
    if(message.type==='input'&&typeof message.data==='string'&&message.data.length<=200000)entry.pty.write(message.data);
    if(message.type==='resize'&&Number.isInteger(message.cols)&&Number.isInteger(message.rows)&&message.cols>=10&&message.cols<=500&&message.rows>=4&&message.rows<=300){if(entry.detectSession)entry.pendingSize=[message.cols,message.rows];else entry.pty.resize(message.cols,message.rows);}
   }catch(error){client.send(JSON.stringify({type:'error',message:error.message}));}
  });
  client.on('close',()=>{clients.get(id)?.delete(client);if(!clients.get(id)?.size)for(const taskId of panelTaskIds(panel))rpc('editing',{taskId,active:false}).catch(()=>{});});
 });
});
console.log('Local Agents listening on loopback.');
