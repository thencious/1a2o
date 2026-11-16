
import {createRoot} from 'react-dom/client';
import {UsageDashboard} from '../../../apps/web/app/(app)/[emailAccountId]/usage/UsageDashboard';
const today=new Date().toISOString().slice(0,10);
const history=Array.from({length:35},(_,i)=>({day:new Date(Date.parse(`${today}T00:00:00Z`)-i*86_400_000).toISOString().slice(0,10),calls:i===0?91:100+i,tracked:90,failed:2,blocked:3}));
window.fetch=async(input)=>{
 const day=new URL(String(input),'http://fixture').searchParams.get('date')!;
 const groups=[{feature:'Messages classification',model:'openrouter/free',outcome:'succeeded',status:200,counted:1,calls:9,items:88},{feature:'Old email tagging',model:'openrouter/free',outcome:'succeeded',status:200,counted:1,calls:40,items:400},{feature:'Email draft generation',model:'openrouter/free',outcome:'failed',status:503,counted:1,calls:2,items:null},{feature:'Messages classification',model:'openrouter/free',outcome:'blocked',status:403,counted:0,calls:3,items:10}];
 const recent=groups.map((g,i)=>({...g,at:Date.parse(`${day}T12:00:00Z`)+i*1000,duration_ms:500}));
 return Response.json({day,generatedAt:new Date().toISOString(),total:day===today?91:101,counted:51,legacy:40,legacyBackfill:20,legacyUnattributed:20,groups,hourly:Array.from({length:24},(_,i)=>({hour:String(i).padStart(2,'0'),calls:[7,8,9,10,11,12,14,16].includes(i)?[4,6,12,5,8,9,4,3][[7,8,9,10,11,12,14,16].indexOf(i)]:0,failed:i===12?2:0,blocked:i===12?3:0})),history,recent,limits:{perDay:1000,perMinute:20,dailyUsed:91,nextResetAt:`${today}T00:00:00Z`}});
};
createRoot(document.getElementById('root')!).render(<UsageDashboard/>);
