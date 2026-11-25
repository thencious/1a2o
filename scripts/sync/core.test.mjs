import test from 'node:test';import assert from 'node:assert/strict';import {mkdtemp,readFile,rm}from'node:fs/promises';import {tmpdir}from'node:os';import{join}from'node:path';import{randomBytes}from'node:crypto';import{atomicWrite,withFileLock,seal,unseal,packCloudState,unpackCloudState}from'../../apps/web/utils/todo/cloud-sync-core.mjs';import{mergeWorkspaceItems,consolidateRecoveryCopies}from'../../apps/web/public/open-todo-zero/workspace-data.mjs';import{authorized}from'../../apps/sync-worker/src/index.mjs';
test('authenticated encryption rejects wrong keys and corrupted ciphertext',()=>{const key=randomBytes(32),data=seal(JSON.stringify({notes:'private'}),key);assert(!data.includes('private'));assert.equal(JSON.parse(unseal(data,key)).notes,'private');assert.throws(()=>unseal(data,randomBytes(32)));assert.throws(()=>unseal(data.slice(0,-2)+'00',key));assert(authorized('Bearer '+ 'x'.repeat(64),'x'.repeat(64)));assert(!authorized('Bearer '+ 'y'.repeat(64),'x'.repeat(64)));assert(!authorized('',undefined));});
test('file locking serializes simultaneous local saves and cloud pulls',async()=>{const dir=await mkdtemp(join(tmpdir(),'onea2o-sync-')),file=join(dir,'snapshot');try{await atomicWrite(file,'0');await Promise.all(Array.from({length:12},()=>withFileLock(file,async()=>{const count=Number(await readFile(file,'utf8'));await new Promise(resolve=>setTimeout(resolve,5));await atomicWrite(file,String(count+1));})));assert.equal(await readFile(file,'utf8'),'12');}finally{await rm(dir,{recursive:true,force:true});}});
test('merge keeps both simultaneous edits, merges independent fields and never resurrects deleted IDs',()=>{const base={id:'note',title:'Title',notes:'Original',createdAt:1,updatedAt:1};const a={...base,notes:'Offline edit',updatedAt:2},b={...base,notes:'Another edit',updatedAt:3};const result=mergeWorkspaceItems([base],[a],[b]);assert.equal(result.find(x=>x.id==='note').notes,'Another edit');assert.equal(result.length,1);assert(result[0].recoveredVersions.some(x=>x.notes==='Offline edit'));assert.deepEqual(mergeWorkspaceItems([base],[{...base,title:'Title change'}],[{...base,notes:'Body change'}]),[{...base,title:'Title change',notes:'Body change'}]);const deleted=mergeWorkspaceItems([base],[],[a]);assert(!deleted.some(x=>x.id==='note'));assert(deleted.some(x=>x.notes==='Offline edit'));assert.deepEqual(mergeWorkspaceItems([base],[],[base]),[]);});

test('snapshots compress before encryption and older uncompressed snapshots remain readable',()=>{const key=randomBytes(32),data={revision:'x',tasks:[{id:'note',notes:'Large repeating fictional note. '.repeat(100000)}]};const payload=packCloudState(data,key);assert(payload.length<100000);assert.deepEqual(unpackCloudState(payload,key),data);assert.deepEqual(unpackCloudState(seal(JSON.stringify(data),key),key),data);});

test('repeated merges retain unique versions without creating rows or nested histories',()=>{
 const base={id:'n',title:'Note',notes:'base',createdAt:1,updatedAt:1};
 let local={...base,notes:'local',updatedAt:2};
 for(let n=3;n<25;n++){
  const merged=mergeWorkspaceItems([base],[local],[{...base,notes:'remote '+n,updatedAt:n}]);
  assert.equal(merged.length,1);local=merged[0];
 }
 assert.equal(local.recoveredVersions.length,22);
 assert(local.recoveredVersions.every(x=>!x.recoveredVersions));
 assert.deepEqual(mergeWorkspaceItems([local],[local],[local]),[local]);
});
test('legacy recovery rows are folded into their original with every unique text preserved',()=>{
 const original={id:'n',title:'Note',notes:'current',updatedAt:9};
 const older={...original,id:'r',recoveredFrom:'n',title:'Note (recovered edit)',notes:'older',updatedAt:2};
 const nested={...older,id:'r2',recoveredFrom:'r',title:'Note (recovered edit) (recovered edit)',notes:'oldest',updatedAt:1};
 const result=consolidateRecoveryCopies([original,older,nested,{...older,id:'r3',updatedAt:3}]);
 assert.equal(result.length,1);assert.equal(result[0].notes,'current');
 assert.deepEqual(new Set(result[0].recoveredVersions.map(x=>x.notes)),new Set(['older','oldest']));
 assert.deepEqual(consolidateRecoveryCopies(result),result);
 assert.equal(consolidateRecoveryCopies([older]).length,1);
});
