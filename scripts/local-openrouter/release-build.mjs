import {spawn,execFileSync} from "node:child_process";
import {cpSync,existsSync,mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync,unlinkSync,openSync,closeSync} from "node:fs";
import {resolve,sep} from "node:path";
import {connect} from "node:net";
import {randomUUID} from "node:crypto";
import {setTimeout as delay} from "node:timers/promises";
import {activeReleaseDirectory,switchRelease,validateReleaseDirectory,availableProbePort} from "./release-policy.mjs";
import {compactRelease} from "./compact-release.mjs";
import {buildProgress} from "../../apps/web/utils/local-update/progress.mjs";
import {watchBuildOutput} from "./build-progress-output.mjs";

const root=resolve(import.meta.dirname,"../.."),app=resolve(root,"apps/web"),context=resolve(root,".context");
process.chdir(root);process.loadEnvFile(resolve(app,".env.local"));process.env.NODE_ENV="production";
delete process.env.TSX_TSCONFIG_PATH;delete process.env.LOCAL_NEXT_BUILD_DIR;
const node=process.execPath,pnpm=resolve(root,"../tools/pnpm/node_modules/pnpm/bin/pnpm.cjs");
process.env.PATH=[resolve(root,"../tools/node-v24.22.1-win-x64"),resolve(root,"../tools/pnpm"),"C:\\Program Files\\Git\\bin",process.env.PATH].join(sep==="\\"?";":":");
const updateLock=resolve(context,"update.lock"),statusFile=resolve(context,"update-status.json"),pointer=resolve(context,"active-web-build.json");
const resumeIndex=process.argv.indexOf('--install-candidate');
const resumeCandidate=resumeIndex>=0?validateReleaseDirectory(process.argv[resumeIndex+1]):null;
if(resumeCandidate&&!resumeCandidate.startsWith('.next-releases/'))throw new Error('Only packaged releases can be installed');
const id=`${Date.now()}-${randomUUID().slice(0,8)}`,candidate=resumeCandidate??`.next-releases/${id}`,stage=resolve(app,".next-candidate");
let locked=false,probe=null,progress=buildProgress("prepare");

function atomic(file,value){const temp=`${file}.${randomUUID()}.tmp`;writeFileSync(temp,value);renameSync(temp,file);}
function status(phase,error,stage){if(stage)progress=buildProgress(stage);else if(phase==="checking")progress=buildProgress("check");else if(phase==="switching")progress=buildProgress("install");writeStatus(phase,error);console.log(`Local update: ${phase}`);}
function writeStatus(phase,error){atomic(statusFile,JSON.stringify({pid:process.pid,phase,candidate,at:new Date().toISOString(),progress,error}));}
function reportBuildProgress(next){if(next.percent>=progress.percent){progress=next;try{writeStatus("building");}catch{/* A missed progress sample must not stop compilation. */}}}
function releasePath(directory){validateReleaseDirectory(directory);const result=resolve(app,directory);if(!result.startsWith(app+sep))throw new Error("Release escaped the application directory");return result;}
async function portOpen(port){return new Promise(done=>{const socket=connect({host:"127.0.0.1",port});socket.setTimeout(500);socket.once("connect",()=>{socket.destroy();done(true);});socket.once("error",()=>done(false));socket.once("timeout",()=>{socket.destroy();done(false);});});}
async function health(port){for(let attempt=0;attempt<30;attempt++){try{const response=await fetch(`http://127.0.0.1:${port}/api/auth/ok`,{signal:AbortSignal.timeout(attempt?2000:45000)});await response.body?.cancel();if(response.ok)return;}catch{}await delay(500);}throw new Error(`Release health check failed on port ${port}`);}
function stopWeb(){
 const state=JSON.parse(readFileSync(resolve(context,"local-processes.json"),"utf8"));const entry=state.children.findLast(child=>child.name==="web");if(!entry)return;
 const pid=Number(entry.pid),started=new Date(entry.started).toISOString();if(!Number.isSafeInteger(pid)||pid<=0)throw new Error("Invalid owned server PID");
 execFileSync("powershell.exe",["-NoProfile","-NonInteractive","-Command",`$taskProcess=Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (!$taskProcess) {exit 0}; if ([Math]::Abs(($taskProcess.StartTime.ToUniversalTime()-[DateTime]::Parse('${started}').ToUniversalTime()).TotalSeconds) -ge 5) {throw 'Server identity changed'}; $taskDetails=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; if ($taskDetails.CommandLine -notmatch 'next.*start') {throw 'Unexpected server process'}; Stop-Process -Id ${pid} -Force; $taskProcess.WaitForExit(5000) | Out-Null`],{windowsHide:true,timeout:10000,stdio:"ignore"});
}
function startWeb(){execFileSync(node,[resolve(root,"scripts/local-openrouter/local.mjs"),"ensure"],{cwd:root,env:process.env,windowsHide:true,timeout:165000,stdio:"inherit"});}

try{
 mkdirSync(context,{recursive:true});
 try{writeFileSync(updateLock,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:"wx"});locked=true;}catch(error){if(error.code!=="EEXIST")throw error;const holder=JSON.parse(readFileSync(updateLock,"utf8"));let alive=true;try{process.kill(holder.pid,0);}catch{alive=false;}if(alive)throw new Error("Another local update is already running");unlinkSync(updateLock);writeFileSync(updateLock,JSON.stringify({pid:process.pid,at:Date.now()}),{flag:"wx"});locked=true;}
 const previous=activeReleaseDirectory(root);
 const destination=releasePath(candidate);
 if(!resumeCandidate){
 status("building");
 const buildCode=await new Promise((done,reject)=>{const child=spawn(node,[pnpm,"--filter","inbox-zero-ai","build"],{cwd:root,env:{...process.env,LOCAL_NEXT_BUILD_DIR:".next-candidate"},windowsHide:true,stdio:["ignore","pipe","pipe"],timeout:1800000});watchBuildOutput(child.stdout,process.stdout,reportBuildProgress);watchBuildOutput(child.stderr,process.stderr,reportBuildProgress);child.once("error",reject);child.once("close",code=>done(code));});
 if(buildCode!==0)throw new Error("Compilation failed; the installed version was left running");
 status("building",undefined,"package");
 for(const file of ["BUILD_ID","routes-manifest.json","sw.js"])if(!existsSync(resolve(stage,file)))throw new Error(`Incomplete candidate: ${file}`);
 mkdirSync(resolve(app,".next-releases"),{recursive:true});
 if(stage!==resolve(app,".next-candidate")||!destination.startsWith(resolve(app,".next-releases")+sep))throw new Error("Unsafe release move");
 mkdirSync(destination);
 // Keep the reusable compiler cache in staging; only runtime artifacts become a release.
 for(const name of readdirSync(stage)) {
   if(name==="cache")continue;
   const source=resolve(stage,name),target=resolve(destination,name);
   if(!source.startsWith(stage+sep)||!target.startsWith(destination+sep))throw new Error("Unsafe build artifact move");
   renameSync(source,target);
 }
 const oldStatic=resolve(releasePath(previous),"static");if(existsSync(oldStatic))cpSync(oldStatic,resolve(destination,"static"),{recursive:true,force:false,errorOnExist:false});
 console.log("Compact production runtime:", compactRelease(root,candidate));
 }
 for(const file of ['BUILD_ID','routes-manifest.json','build-manifest.json','sw.js'])if(!existsSync(resolve(destination,file)))throw new Error('Incomplete packaged candidate: '+file);
 status("checking");
 const probePort=await availableProbePort();
 const probeOrigin=`http://127.0.0.1:${probePort}`;
 const out=openSync(resolve(context,"logs/update-probe.log"),"a"),err=openSync(resolve(context,"logs/update-probe.err.log"),"a");
 probe=spawn(node,["--import","tsx",resolve(app,"node_modules/next/dist/bin/next"),"start","--hostname","127.0.0.1","--port",String(probePort)],{cwd:app,env:{...process.env,LOCAL_NEXT_BUILD_DIR:candidate},windowsHide:true,stdio:["ignore",out,err]});closeSync(out);closeSync(err);
 await health(probePort);
 const login=await fetch(`${probeOrigin}/login`,{signal:AbortSignal.timeout(45000)});await login.body?.cancel();if(!login.ok)throw new Error("Candidate login page failed");
 // Workspace templates use public assets outside the Next bundle. Verify every
 // dependency against the candidate server before switching the installed app.
 const workspaceAssets=new Set();
 for(const template of ["index.html","notes.html"]){
  const html=readFileSync(resolve(app,"public/open-todo-zero",template),"utf8");
  for(const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)){
   const target=new URL(match[1],`${probeOrigin}/open-todo-zero/`);
   if(target.origin===probeOrigin&&!target.pathname.startsWith("/branding/"))workspaceAssets.add(target.href);
  }
 }
 for(const url of workspaceAssets){
  const response=await fetch(url,{signal:AbortSignal.timeout(10000)});await response.body?.cancel();
  if(!response.ok)throw new Error("Candidate workspace asset failed: "+new URL(url).pathname);
 }
 const manifest=JSON.parse(readFileSync(resolve(destination,"build-manifest.json"),"utf8"));
 const asset=manifest.rootMainFiles?.find(file=>file.endsWith(".js"));
 if(asset){const response=await fetch(`${probeOrigin}/_next/${asset}`,{signal:AbortSignal.timeout(10000)});await response.body?.cancel();if(!response.ok)throw new Error("Candidate static assets failed");}
 probe.kill();await delay(250);probe=null;
 const assets=["sw.js","sw.js.map"].map(name=>({name,old:existsSync(resolve(app,"public",name))?readFileSync(resolve(app,"public",name)):null}));
 status("switching");
 await switchRelease({previous,candidate,checkCandidate:async directory=>{if(!existsSync(resolve(releasePath(directory),"BUILD_ID")))throw new Error("Candidate disappeared");},stopWeb:async()=>stopWeb(),writeActive:async directory=>atomic(pointer,JSON.stringify({directory,installedAt:new Date().toISOString()})),installAssets:async()=>{for(const asset of assets){const source=resolve(destination,asset.name);if(existsSync(source))atomic(resolve(app,"public",asset.name),readFileSync(source));}},restoreAssets:async()=>{for(const asset of assets)if(asset.old)atomic(resolve(app,"public",asset.name),asset.old);},startWeb:async()=>startWeb()});
 status("ready");
}catch(error){if(locked)status("failed",error.message);console.error(error.message);process.exitCode=1;}
finally{if(probe)probe.kill();if(locked)try{unlinkSync(updateLock);}catch{}}
