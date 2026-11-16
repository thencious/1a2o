import test from 'node:test';import assert from 'node:assert/strict';import{DatabaseSync}from'node:sqlite';import{readFileSync}from'node:fs';import handler from '../../apps/sync-worker/src/index.mjs';
function createEnvironment(){const db=new DatabaseSync(':memory:');db.exec(readFileSync(new URL('../../apps/sync-worker/schema.sql',import.meta.url),'utf8'));return {db,env:{SYNC_TOKEN:'private-test-key',DB:{prepare(sql){return {bind(...params){const stmt=db.prepare(sql);return {async first(){return stmt.get(...params)||null;},async all(){return {results:stmt.all(...params)};},run(){return {meta:{changes:Number(stmt.run(...params).changes)}};}};} };},async batch(statements){db.exec('BEGIN');try{const results=statements.map(statement=>statement.run());db.exec('COMMIT');return results;}catch(error){db.exec('ROLLBACK');throw error;}}}}};}
const doc='a'.repeat(64),token='Bearer private-test-key';
function req(method='GET',body,authorization=token,path='/v1/documents/'+doc){return new Request('https://sync.example'+path,{method,headers:{Authorization:authorization,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
test('private API rejects unauthorized access, supports idempotent CAS, and chunks snapshots above 2MB',async()=>{const {env,db}=createEnvironment();try{
 assert.equal((await handler.fetch(req('GET',null,'Bearer wrong'),env)).status,401);
 const data={rev:'one',parent:null,payload:'sync1:'+'a'.repeat(2_100_000)};
 assert.equal((await handler.fetch(req('PUT',data),env)).status,200);
 assert.equal((await handler.fetch(req('GET'),env)).status,200);
 assert.equal((await (await handler.fetch(req('GET'),env)).json()).payload,data.payload);
 assert.equal(db.prepare('SELECT count(*) AS count FROM chunks').get().count,5);
 const again=await (await handler.fetch(req('PUT',data),env)).json();assert.equal(again.alreadySaved,true);
 assert.equal((await handler.fetch(req('PUT',{rev:'stale',parent:null,payload:'sync1:stale'}),env)).status,409);
 assert.equal((await handler.fetch(req('PUT',{rev:'two',parent:'one',payload:'sync1:new'}),env)).status,200);
 const history=await (await handler.fetch(req('GET',null,token,'/v1/documents/'+doc+'/history'),env)).json();assert.equal(history.versions.length,2);
}finally{db.close();}});
test('history retention keeps recent versions and daily recovery points while never pruning the head',async()=>{const {env,db}=createEnvironment();try{
 const now=Date.now();for(let index=0;index<350;index++)db.prepare('INSERT INTO versions(doc,rev,parent,payload,at) VALUES(?,?,?,?,?)').run(doc,'v'+index,null,'sync1:old',now-index*3600000);
 db.prepare('INSERT INTO heads(doc,rev,payload,at) VALUES(?,?,?,?)').run(doc,'v0','sync1:old',now);
 db.prepare('INSERT INTO chunks(doc,rev,seq,payload) VALUES(?,?,?,?)').run(doc,'v349',0,'old chunk');
 assert.equal((await handler.fetch(req('PUT',{rev:'latest',parent:'v0',payload:'sync1:new'}),env)).status,200);
 const count=db.prepare('SELECT count(*) AS count FROM versions').get().count;assert(count>=100&&count<=130,String(count));assert(db.prepare('SELECT 1 FROM versions WHERE rev=?').get('latest'));assert.equal(db.prepare('SELECT count(*) AS count FROM chunks').get().count,0);
}finally{db.close();}});

test('per-device capabilities stay scoped and revocation cannot be undone by replay',async()=>{const {env,db}=createEnvironment();try{
 const id='b'.repeat(64),deviceToken='c'.repeat(64),ownDoc='d'.repeat(64),secondDoc='e'.repeat(64);
 const deviceRequest=(method,body)=>req(method,body,token,'/v1/devices/'+id);
 assert.equal((await handler.fetch(deviceRequest('PUT',{token:deviceToken,docs:[ownDoc,secondDoc]}),env)).status,200);
 const scoped=(path,method='GET',body)=>req(method,body,'Bearer '+deviceToken,path);
 assert.equal((await handler.fetch(scoped('/v1/documents/'+ownDoc),env)).status,404);
 assert.equal((await handler.fetch(scoped('/v1/documents/'+doc),env)).status,403);
 assert.equal((await handler.fetch(scoped('/v1/devices/'+id,'DELETE'),env)).status,401);
 assert.equal((await handler.fetch(deviceRequest('DELETE'),env)).status,200);
 assert.equal((await handler.fetch(scoped('/v1/documents/'+ownDoc),env)).status,401);
 assert.equal((await handler.fetch(deviceRequest('PUT',{token:deviceToken,docs:[ownDoc,secondDoc]}),env)).status,409);
}finally{db.close();}});
test('CORS accepts loopback and configured HTTPS origins, rejects arbitrary origins',async()=>{const {env,db}=createEnvironment();try{
 const allowed=await handler.fetch(new Request('https://sync.example/v1/documents/'+doc,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:32100','Access-Control-Request-Headers':'authorization,content-type'}}),env);assert.equal(allowed.status,204);assert.equal(allowed.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:32100');
 const denied=await handler.fetch(new Request('https://sync.example/health',{headers:{Origin:'https://attacker.example'}}),env);assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
 const hosted=await handler.fetch(new Request('https://sync.example/health',{headers:{Origin:'https://my-host.example'}}),{...env,CLIENT_ORIGINS:'https://my-host.example'});assert.equal(hosted.status,200);assert.equal(hosted.headers.get('Access-Control-Allow-Origin'),'https://my-host.example');
}finally{db.close();}});
