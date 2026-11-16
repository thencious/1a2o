import {isIP} from 'node:net';
export function isPrivateAddress(value='') {
 const ip=value.replace(/^::ffff:/,'');
 if(!isIP(ip))return false;
 if(ip==='::1')return true;
 if(!/^\d+\./.test(ip))return false;
 const [a,b]=ip.split('.').map(Number);
 return a===127||a===10||(a===192&&b===168)||(a===172&&b>=16&&b<=31)||(a===100&&b>=64&&b<=127);
}
export function allowedRequest(request,hosts) {
 if(!isPrivateAddress(request.socket.remoteAddress))return false;
 const host=request.headers.host;
 if(!hosts.has(host))return false;
 const origin=request.headers.origin;
 return !origin||origin===`http://${host}`;
}

export function rewriteLoopbackLocation(location,upstreamPort,publicOrigin) {
 if(typeof location!=='string')return location;
 try {
  const url=new URL(location);
  if(![`http://localhost:${upstreamPort}`,`http://127.0.0.1:${upstreamPort}`].includes(url.origin))return location;
  return publicOrigin+url.pathname+url.search+url.hash;
 } catch {return location;}
}

export function isAgentRequest(value) {
 try {
  const path=decodeURIComponent(new URL(value,'http://localhost').pathname).replace(/\/{2,}/g,'/');
  return /^\/api\/user\/agents(?:\/|$)/.test(path);
 } catch {return true;}
}
