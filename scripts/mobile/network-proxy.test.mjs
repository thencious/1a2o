import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {createMobileProxy} from './network-proxy.mjs';
import {rewriteLoopbackLocation,isAgentRequest} from './network-policy.mjs';

test('redirects preserve path, query, and fragment without rewriting external OAuth providers',()=>{
 const origin='http://192.168.1.2:3012';
 for(const host of ['localhost','127.0.0.1'])assert.equal(rewriteLoopbackLocation(`http://${host}:3000/callback?code=sample&state=state#done`,3000,origin),origin+'/callback?code=sample&state=state#done');
 assert.equal(rewriteLoopbackLocation('https://accounts.example.com/auth?state=sample',3000,origin),'https://accounts.example.com/auth?state=sample');
 assert.equal(rewriteLoopbackLocation('/accounts?next=mail',3000,origin),'/accounts?next=mail');
});

test('agent exclusion checks the normalized route rather than a raw query string',()=>{
 for(const path of ['/api/user/agents','/api/user/agents?scope=all','/api/user/%61gents/metadata','/api/user/agents/connect','/api/user/x/../agents'])assert(isAgentRequest(path),path);
 for(const path of ['/api/mobile/pair','/api/user/messages','/api/user/agents-help'])assert(!isAgentRequest(path),path);
});

test('private proxy preserves cookies and POST bodies, rewrites only allowed origins, and rejects cross-site requests',async t=>{
 const seen=[];
 const upstream=http.createServer(async(req,res)=>{
  let body='';for await(const chunk of req)body+=chunk;
  seen.push({headers:req.headers,path:req.url,body});
  if(req.url==='/redirect'){res.writeHead(302,{Location:`http://127.0.0.1:${upstream.address().port}/mail?accountScope=all#thread`, 'Set-Cookie':'sample=value; HttpOnly; Path=/'});res.end();return;}
  res.setHeader('Content-Type','application/json');res.end(JSON.stringify({ok:true}));
 });
 await listen(upstream);
 const proxy=createMobileProxy({port:0,upstreamPort:upstream.address().port});
 await listen(proxy);
 t.after(async()=>{await Promise.all([close(proxy),close(upstream)]);});
 const base=`http://127.0.0.1:${proxy.address().port}`;
 const response=await fetch(base+'/api/user/todo',{method:'POST',headers:{Origin:base,Referer:base+'/settings?tab=android',Cookie:'better-auth.session_token=sample-token','Content-Type':'application/json','Next-Action':'sample-action','X-Forwarded-For':'8.8.8.8','X-Forwarded-Host':'attacker.example','Forwarded':'for=8.8.8.8'},body:'{"message":"sample"}'});
 assert.equal(response.status,200);await response.arrayBuffer();
 assert.equal(seen.length,1);
 assert.equal(seen[0].headers.origin,`http://localhost:${upstream.address().port}`);
 assert.equal(seen[0].headers.referer,`http://localhost:${upstream.address().port}/settings?tab=android`);
 assert.equal(seen[0].headers.cookie,'better-auth.session_token=sample-token');
 assert.equal(seen[0].headers['next-action'],'sample-action');
 assert.equal(seen[0].headers['x-forwarded-for'],'127.0.0.1');
 assert.equal(seen[0].headers['x-forwarded-host'],undefined);
 assert.equal(seen[0].headers.forwarded,undefined);
 assert.equal(seen[0].body,'{"message":"sample"}');
 const rejected=await fetch(base+'/api/user/todo',{method:'POST',headers:{Origin:'https://attacker.example'},body:'blocked'});
 assert.equal(rejected.status,403);await rejected.arrayBuffer();assert.equal(seen.length,1);
 const noOrigin=await fetch(base+'/api/mobile/pair/status');assert.equal(noOrigin.status,200);await noOrigin.arrayBuffer();
 const excluded=await fetch(base+'/api/user/agents?scope=all');assert.equal(excluded.status,404);await excluded.arrayBuffer();
 const redirect=await fetch(base+'/redirect',{redirect:'manual'});
 assert.equal(redirect.headers.get('location'),base+'/mail?accountScope=all#thread');
 assert.equal(redirect.headers.get('set-cookie'),'sample=value; HttpOnly; Path=/');await redirect.arrayBuffer();
});

function listen(server){return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});}
function close(server){return new Promise(resolve=>{server.closeAllConnections();server.close(resolve);});}
