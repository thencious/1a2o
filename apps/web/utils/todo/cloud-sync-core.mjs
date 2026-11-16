import {gzipSync,gunzipSync} from 'node:zlib';
import {readFile,writeFile,mkdir,rename,unlink,open} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createCipheriv,createDecipheriv,randomBytes,scryptSync,randomUUID} from 'node:crypto';

export async function atomicWrite(file,value){await mkdir(dirname(file),{recursive:true});const temporary=file+'.'+randomUUID()+'.tmp';await writeFile(temporary,value,{mode:0o600});await rename(temporary,file);}
export async function readJson(file,fallback=null){try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return fallback;throw error;}}
export function localKey(env=process.env){if(!env.EMAIL_ENCRYPT_SECRET||!env.EMAIL_ENCRYPT_SALT)throw Error('Local encryption is not configured');return scryptSync(env.EMAIL_ENCRYPT_SECRET,env.EMAIL_ENCRYPT_SALT,32);}
export function seal(value,key,prefix='sync1:'){const iv=randomBytes(16),cipher=createCipheriv('aes-256-gcm',key,iv);const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return prefix+Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('hex');}
export function unseal(value,key,prefix='sync1:'){if(!value.startsWith(prefix))throw Error('Invalid encrypted snapshot');const bytes=Buffer.from(value.slice(prefix.length),'hex');if(bytes.length<32)throw Error('Invalid encrypted snapshot');const decipher=createDecipheriv('aes-256-gcm',key,bytes.subarray(0,16));decipher.setAuthTag(bytes.subarray(16,32));return Buffer.concat([decipher.update(bytes.subarray(32)),decipher.final()]).toString('utf8');}
export async function withFileLock(file,operation){
 const lock=file+'.lock';await mkdir(dirname(file),{recursive:true});let handle;
 const deadline=Date.now()+10000;
 while(!handle){
  try{handle=await open(lock,'wx',0o600);await handle.writeFile(JSON.stringify({pid:process.pid,at:Date.now()}));}
  catch(error){if(error.code!=='EEXIST')throw error;let stale=false;try{const owner=JSON.parse(await readFile(lock,'utf8'));try{process.kill(owner.pid,0);}catch(failure){if(failure.code==='ESRCH')stale=true;}}catch{const stat=await import('node:fs/promises').then(fs=>fs.stat(lock)).catch(()=>null);stale=!!stat&&Date.now()-stat.mtimeMs>30000;}if(stale){await unlink(lock).catch(()=>{});continue;}if(Date.now()>deadline)throw Error('Local sync is busy; this edit remains on the device.');await new Promise(resolve=>setTimeout(resolve,40));}
 }
 try{return await operation();}finally{await handle.close();await unlink(lock).catch(()=>{});}
}

export function packCloudState(state,key){return seal('gzip1:'+gzipSync(JSON.stringify(state)).toString('base64'),key);}
export function unpackCloudState(payload,key){const plain=unseal(payload,key);return JSON.parse(plain.startsWith('gzip1:')?gunzipSync(Buffer.from(plain.slice(6),'base64')).toString('utf8'):plain);}
