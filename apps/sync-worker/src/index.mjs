const headers={'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers});
export function authorized(value,secret){if(!secret||typeof value!=='string')return false;const expected='Bearer '+secret;let difference=value.length^expected.length;for(let i=0;i<expected.length;i++)difference|=(value.charCodeAt(i)||0)^expected.charCodeAt(i);return difference===0;}
async function handle(request,env){
 try{
 const url=new URL(request.url);
 if(url.pathname==='/health'&&request.method==='GET')return json({app:'1a2o-private-sync',encrypted:true});
 const master=authorized(request.headers.get('authorization'),env.SYNC_TOKEN);
 const devicePath=url.pathname.match(/^\/v1\/devices\/([a-f0-9]{64})$/);
 if(devicePath){
  if(!master)return json({error:'Unauthorized'},401);
  if(request.method==='DELETE'){await env.DB.prepare("INSERT INTO devices(id,token_hash,docs,revoked,at) VALUES(?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET revoked=1,at=excluded.at").bind(devicePath[1],'revoked:'+devicePath[1],'[]',Date.now()).run();return json({revoked:true});}
  if(request.method!=='PUT')return json({error:'Method not allowed'},405);
  const data=await request.json();if(!/^[a-f0-9]{64}$/.test(data.token)||!Array.isArray(data.docs)||data.docs.length!==2||data.docs.some(doc=>!/^[a-f0-9]{64}$/.test(doc)))return json({error:'Invalid device grant'},400);
  const hash=await tokenHash(data.token);
  const result=await env.DB.prepare("INSERT INTO devices(id,token_hash,docs,revoked,at) VALUES(?,?,?,0,?) ON CONFLICT(id) DO UPDATE SET docs=excluded.docs,at=excluded.at WHERE devices.revoked=0 AND devices.token_hash=excluded.token_hash").bind(devicePath[1],hash,JSON.stringify(data.docs),Date.now()).run();
  return result.meta.changes?json({registered:true}):json({error:'Device was revoked'},409);
 }
 let grant=null;
 if(!master){const supplied=request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];if(!supplied)return json({error:'Unauthorized'},401);grant=await env.DB.prepare('SELECT docs FROM devices WHERE token_hash=? AND revoked=0').bind(await tokenHash(supplied)).first();if(!grant)return json({error:'Unauthorized'},401);}

 const match=url.pathname.match(/^\/v1\/documents\/([a-f0-9]{64})(\/history)?$/);
 if(!match)return json({error:'Not found'},404);
 const doc=match[1];
 if(grant&&!JSON.parse(grant.docs).includes(doc))return json({error:'Forbidden'},403);
 if(request.method==='GET'){
  if(match[2])return json({versions:(await env.DB.prepare('SELECT rev, parent, at FROM versions WHERE doc=? ORDER BY at DESC LIMIT 200').bind(doc).all()).results});
  const revision=url.searchParams.get('revision');
  const row=revision?await env.DB.prepare('SELECT rev,payload,at FROM versions WHERE doc=? AND rev=?').bind(doc,revision).first():await env.DB.prepare('SELECT rev,payload,at FROM heads WHERE doc=?').bind(doc).first();
  if(row?.payload.startsWith('chunks1:')){const chunks=(await env.DB.prepare('SELECT payload FROM chunks WHERE doc=? AND rev=? ORDER BY seq').bind(doc,row.rev).all()).results;const expected=Number(row.payload.slice(8));if(chunks.length!==expected)return json({error:'Incomplete encrypted snapshot'},500);row.payload=chunks.map(chunk=>chunk.payload).join('');}
  return row?json(row):json({error:'Not found'},404);
 }
 if(request.method!=='PUT'||match[2])return json({error:'Method not allowed'},405);
 if(Number(request.headers.get('content-length')||0)>12_000_000)return json({error:'Snapshot too large'},413);
 const raw=await request.text();if(raw.length>12_000_000)return json({error:'Snapshot too large'},413);
 const body=JSON.parse(raw);
 if(typeof body.rev!=='string'||!/^[\w-]{1,128}$/.test(body.rev)||!(body.parent===null||typeof body.parent==='string'&&/^[\w-]{1,128}$/.test(body.parent))||typeof body.payload!=='string'||!body.payload.startsWith('sync1:'))return json({error:'Invalid encrypted snapshot'},400);
 const previous=await env.DB.prepare('SELECT rev,payload,at FROM heads WHERE doc=?').bind(doc).first();
 if(previous?.rev===body.rev)return json({rev:previous.rev,at:previous.at,alreadySaved:true});
 if((previous?.rev??null)!==body.parent)return json({error:'Revision conflict',head:previous},409);
 const at=Date.now();
 const chunks=[];if(body.payload.length>1_000_000)for(let offset=0;offset<body.payload.length;offset+=500_000)chunks.push(body.payload.slice(offset,offset+500_000));
 const storedPayload=chunks.length?'chunks1:'+chunks.length:body.payload;
 const statements=[
  env.DB.prepare('INSERT INTO heads(doc,rev,payload,at) SELECT ?,?,?,? WHERE (? IS NULL AND NOT EXISTS(SELECT 1 FROM heads WHERE doc=?)) OR EXISTS(SELECT 1 FROM heads WHERE doc=? AND rev=?) ON CONFLICT(doc) DO UPDATE SET rev=excluded.rev,payload=excluded.payload,at=excluded.at WHERE heads.rev=?').bind(doc,body.rev,storedPayload,at,body.parent,doc,doc,body.parent,body.parent),
  env.DB.prepare('INSERT OR IGNORE INTO versions(doc,rev,parent,payload,at) SELECT doc,rev,?,payload,at FROM heads WHERE doc=? AND rev=?').bind(body.parent,doc,body.rev),
 ];
 for(let seq=0;seq<chunks.length;seq++)statements.push(env.DB.prepare('INSERT OR IGNORE INTO chunks(doc,rev,seq,payload) SELECT doc,rev,?,? FROM heads WHERE doc=? AND rev=?').bind(seq,chunks[seq],doc,body.rev));
 statements.push(env.DB.prepare("DELETE FROM versions WHERE doc=? AND rev NOT IN (SELECT rev FROM versions WHERE doc=? ORDER BY at DESC LIMIT 100) AND rev NOT IN (SELECT rev FROM (SELECT rev,ROW_NUMBER() OVER (PARTITION BY date(at/1000,'unixepoch') ORDER BY at DESC) AS day_rank FROM versions WHERE doc=? AND at>=?) WHERE day_rank=1) AND rev<>(SELECT rev FROM heads WHERE doc=?)").bind(doc,doc,doc,at-30*86_400_000,doc));
 statements.push(env.DB.prepare('DELETE FROM chunks WHERE doc=? AND NOT EXISTS(SELECT 1 FROM versions WHERE versions.doc=chunks.doc AND versions.rev=chunks.rev) AND NOT EXISTS(SELECT 1 FROM heads WHERE heads.doc=chunks.doc AND heads.rev=chunks.rev)').bind(doc));
 const results=await env.DB.batch(statements);
 if(!results[0].meta.changes)return json({error:'Revision conflict'},409);
 return json({rev:body.rev,at});
 }catch{return json({error:'Sync service could not complete the request'},500);}
}


export function allowedOrigin(origin,env){if(!origin)return true;return /^http:\/\/(localhost|127\.0\.0\.1)(:[0-9]+)?$/.test(origin)||(env.CLIENT_ORIGINS||'').split(',').map(value=>value.trim()).filter(Boolean).includes(origin);}
async function tokenHash(token){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token)))).map(value=>value.toString(16).padStart(2,'0')).join('');}
export default {async fetch(request,env){
 const origin=request.headers.get('origin');if(!allowedOrigin(origin,env))return json({error:'Origin not allowed'},403);
 const response=request.method==='OPTIONS'?new Response(null,{status:204,headers:{'Cache-Control':'no-store'}}):await handle(request,env);
 if(origin){response.headers.set('Access-Control-Allow-Origin',origin);response.headers.set('Vary','Origin');response.headers.set('Access-Control-Allow-Methods','GET, PUT, DELETE, OPTIONS');response.headers.set('Access-Control-Allow-Headers','Authorization, Content-Type');response.headers.set('Access-Control-Max-Age','600');}
 return response;
}};
