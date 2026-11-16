import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,randomUUID} from 'node:crypto';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {seal,localKey} from '../../apps/web/utils/todo/cloud-sync-core.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
try{process.loadEnvFile(resolve(root,'apps/web/.env.local'));}catch{}
const args=process.argv.slice(2),option=name=>{const index=args.indexOf(name);return index<0?null:args[index+1];};
const recovery=option('--recovery');
let config;
if(recovery){config=JSON.parse(await readFile(recovery,'utf8'));if(config.format!=='1a2o-private-sync-recovery-v1')throw Error('Invalid recovery bundle');}
else{const url=new URL(option('--url')||'');if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Use an HTTPS worker origin');if(process.stdin.isTTY)process.stderr.write('Paste the private cloud bearer secret on standard input, then end input. It will not be printed.\n');let token='';for await(const part of process.stdin)token+=part;token=token.trim();if(token.length<32||token.length>512)throw Error('The bearer secret must contain at least 32 characters');config={url:url.origin,token,key:randomBytes(32).toString('hex'),namespace:randomUUID()};}
config.ownerId=option('--user')||process.env.LOCAL_BEEPER_OWNER_ID||process.env.LOCAL_AGENTS_OWNER_ID||config.ownerId;
if(!config.ownerId)throw Error('Provide --user with the authenticated local user ID to scope this backup.');
if(!/^[a-f0-9]{64}$/.test(config.key)||!config.token||!config.namespace||!config.url?.startsWith('https://'))throw Error('Invalid recovery settings');
const directory=resolve(root,'.context/sync');await mkdir(directory,{recursive:true});
await writeFile(resolve(directory,'config.enc'),seal(JSON.stringify(config),localKey(),'v1:'),{mode:0o600});
await writeFile(resolve(directory,'recovery.json'),JSON.stringify({format:'1a2o-private-sync-recovery-v1',...config,instructions:'Keep this private. Store a secure copy away from the host.'},null,2),{mode:0o600});
console.log('Private sync configured. Keep .context/sync/recovery.json in a separate secure location, then run scripts/sync/worker.mjs --once.');
