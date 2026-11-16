import {readFile,mkdir,readdir,writeFile,unlink} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {atomicWrite,readJson,localKey,seal,unseal,withFileLock,packCloudState,unpackCloudState} from '../../apps/web/utils/todo/cloud-sync-core.mjs';
import {mergeWorkspaceItems} from '../../apps/web/public/open-todo-zero/workspace-data.mjs';

const rootOption=process.argv.indexOf('--root');
const root=rootOption>=0?resolve(process.argv[rootOption+1]):resolve(dirname(fileURLToPath(import.meta.url)),'../..');
try{process.loadEnvFile(resolve(root,'apps/web/.env.local'));}catch{}
const directory=resolve(root,'.context/sync'),localDirectory=resolve(root,'.context/todo');
const once=process.argv.includes('--once');
const hostKey=localKey();
const encryptedConfig=await readFile(resolve(directory,'config.enc'),'utf8');
const config=JSON.parse(unseal(encryptedConfig,hostKey,'v1:'));
if(!config.url?.startsWith('https://')||!config.ownerId||!config.token||!config.key)throw Error('Private cloud sync is not configured.');
const cloudKey=Buffer.from(config.key,'hex');
const ownerHash=createHash('sha256').update(config.ownerId).digest('hex');
const statusFile=resolve(directory,'status.json');
const status=await readJson(statusFile,{workspaces:{}});
const request=async(path,init)=>{const response=await fetch(config.url+path,{...init,headers:{Authorization:'Bearer '+config.token,'Content-Type':'application/json'},signal:AbortSignal.timeout(15000)});const data=await response.json();return {response,data};};
const lock=resolve(directory,'worker.lock');
await mkdir(directory,{recursive:true});
if(!once){
 const owner=await readJson(lock,null);let live=false;if(owner?.pid)try{process.kill(owner.pid,0);live=true;}catch{}
 if(live)process.exit(0);await atomicWrite(lock,JSON.stringify({pid:process.pid,at:Date.now()}));
}
let stopping=false;for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{stopping=true;});
async function run(workspace){
 const localFile=resolve(localDirectory,ownerHash+(workspace==='notes'?'-notes':'')+'.json');
 const cloudDoc=createHash('sha256').update(config.namespace+':'+workspace).digest('hex');
 const metaFile=resolve(directory,cloudDoc+'.enc');
 let meta;try{meta=JSON.parse(unseal(await readFile(metaFile,'utf8'),hostKey,'v1:'));}catch(error){if(error.code!=='ENOENT')throw error;meta={revision:null,baseline:{revision:'initial',tasks:[]}};}
 let local;try{local=JSON.parse(unseal(await readFile(localFile,'utf8'),hostKey,'v1:'));}catch(error){if(error.code!=='ENOENT')throw error;local=null;}
 const dirty=local&&local.revision!==meta.revision;
 if(!dirty&&Date.now()-(status.workspaces[workspace]?.checkedAt||0)<15000)return;
 const {response,data:remote}=await request('/v1/documents/'+cloudDoc);
 if(!response.ok&&response.status!==404)throw Error('Cloud sync temporarily unavailable ('+response.status+'). Local copies are safe.');
 const cloudState=response.ok?unpackCloudState(remote.payload,cloudKey):null;
 if(cloudState&&(!Array.isArray(cloudState.tasks)||cloudState.revision!==remote.rev))throw Error('Cloud backup validation failed. Local copies are unchanged.');
 await withFileLock(localFile,async()=>{
  try{local=JSON.parse(unseal(await readFile(localFile,'utf8'),hostKey,'v1:'));}catch(error){if(error.code!=='ENOENT')throw error;local=null;}
  if(!local&&cloudState){await atomicWrite(localFile,seal(JSON.stringify(cloudState),hostKey,'v1:'));local=cloudState;}
  if(!local)return;
  if(cloudState&&cloudState.revision!==meta.revision&&local.revision!==cloudState.revision){
   const merged=mergeWorkspaceItems(meta.baseline?.tasks??[],local.tasks,cloudState.tasks);
   const updated={revision:randomUUID(),tasks:merged};
   await archive(localFile,local);
   await atomicWrite(localFile,seal(JSON.stringify(updated),hostKey,'v1:'));local=updated;
  }
 });
 const candidate=local;
 if(candidate&&cloudState?.revision!==candidate.revision){
  const result=await request('/v1/documents/'+cloudDoc,{method:'PUT',body:JSON.stringify({rev:candidate.revision,parent:remote.rev??null,payload:packCloudState(candidate,cloudKey)})});
  if(!result.response.ok)throw Error(result.response.status===409?'Cloud revision changed; reconciliation will retry.':'Cloud upload will retry ('+result.response.status+').');
 }
 if(candidate){meta={revision:candidate.revision,baseline:candidate};await atomicWrite(metaFile,seal(JSON.stringify(meta),hostKey,'v1:'));}
 status.workspaces[workspace]={syncedAt:Date.now(),checkedAt:Date.now(),revision:meta.revision,pending:false,error:null};
}
async function archive(file,state){const archiveDirectory=resolve(localDirectory,'history',ownerHash);await mkdir(archiveDirectory,{recursive:true});await atomicWrite(resolve(archiveDirectory,(file.includes('-notes.')?'notes-':'tasks-')+Date.now()+'-'+state.revision+'.json'),seal(JSON.stringify(state),hostKey,'v1:'));}
try{
 do{
  for(const workspace of ['tasks','notes'])try{await run(workspace);}catch(error){status.workspaces[workspace]={...status.workspaces[workspace],checkedAt:Date.now(),pending:true,error:error.message};}
  if(Date.now()-(status.prunedAt||0)>60_000){try{await pruneLocalHistory();status.prunedAt=Date.now();}catch{}}
  status.at=Date.now();await atomicWrite(statusFile,JSON.stringify(status));
  if(once||stopping)break;await new Promise(resolve=>setTimeout(resolve,2000));
 }while(!stopping);
}finally{if(!once){const current=await readJson(lock,null);if(current?.pid===process.pid)await unlink(lock).catch(()=>{});}}
console.log('Private Tasks and Notes sync check completed.');

async function pruneLocalHistory(){
 const folder=resolve(localDirectory,'history',ownerHash);let files;try{files=await readdir(folder);}catch(error){if(error.code==='ENOENT')return;throw error;}
 for(const workspace of ['tasks','notes']){
  const records=files.flatMap(name=>{const match=name.match(new RegExp('^'+workspace+'-([0-9]+)-'));return match?[{name,at:Number(match[1])}]:[];}).sort((a,b)=>b.at-a.at);
  const keep=new Set(records.slice(0,100).map(record=>record.name)),days=new Set();
  for(const record of records){if(record.at<Date.now()-30*86_400_000)continue;const day=new Date(record.at).toISOString().slice(0,10);if(!days.has(day)){days.add(day);keep.add(record.name);}}
  for(const record of records)if(!keep.has(record.name))await unlink(resolve(folder,record.name)).catch(()=>{});
 }
}
