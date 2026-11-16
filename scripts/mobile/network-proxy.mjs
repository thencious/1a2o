import http from 'node:http';
import {networkInterfaces} from 'node:os';
import {pathToFileURL} from 'node:url';
import {isPrivateAddress,allowedRequest,rewriteLoopbackLocation,isAgentRequest} from './network-policy.mjs';

export function createMobileProxy({upstreamPort=3000,port=3012}={}) {
 const upstreamOrigin=`http://localhost:${upstreamPort}`;
 const hosts=()=>new Set(['127.0.0.1','localhost',...Object.values(networkInterfaces()).flatMap(entries=>(entries??[]).filter(entry=>entry.family==='IPv4'&&isPrivateAddress(entry.address)).map(entry=>entry.address))].map(address=>`${address}:${server.address()?.port??port}`));
 const server=http.createServer((request,response)=>{
  if(!allowedRequest(request,hosts())){response.writeHead(403);response.end('Use this computer\'s private network address.');return;}
  if(isAgentRequest(request.url)){response.writeHead(404);response.end();return;}
  const publicOrigin=`http://${request.headers.host}`;
  const headers={...request.headers,host:`localhost:${upstreamPort}`};
  for(const key of Object.keys(headers))if(key.startsWith('x-forwarded-')||['forwarded','connection','upgrade'].includes(key))delete headers[key];
  headers['x-forwarded-for']=request.socket.remoteAddress;
  if(headers.origin)headers.origin=upstreamOrigin;
  if(headers.referer){try{const url=new URL(headers.referer);headers.referer=upstreamOrigin+url.pathname+url.search;}catch{delete headers.referer;}}
  const proxy=http.request({hostname:'127.0.0.1',port:upstreamPort,path:request.url,method:request.method,headers,timeout:300_000},upstream=>{
   const result={...upstream.headers};
   if(result.location)result.location=rewriteLoopbackLocation(result.location,upstreamPort,publicOrigin);
   response.writeHead(upstream.statusCode??502,result);upstream.pipe(response);
  });
  proxy.on('timeout',()=>proxy.destroy());proxy.on('error',()=>{if(!response.headersSent)response.writeHead(503,{'Content-Type':'text/plain'});response.end('1a2o is unavailable. Keep the host computer on and try again.');});
  request.on('aborted',()=>proxy.destroy());request.pipe(proxy);
 });
 server.headersTimeout=15_000;server.requestTimeout=300_000;
 return server;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const port=Number(process.env.MOBILE_PROXY_PORT||3012);
 const server=createMobileProxy({port,upstreamPort:Number(process.env.MOBILE_UPSTREAM_PORT||3000)});
 server.on('error',error=>{if(error.code==='EADDRINUSE')process.exit(0);console.error('Mobile network service could not start.');process.exit(1);});
 server.listen(port,'0.0.0.0',()=>console.log('1a2o private-network companion enabled.'));
}
