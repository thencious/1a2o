import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {LocalRulesPanel} from '../../../apps/web/app/(app)/[emailAccountId]/automation/LocalRulesPanel';
import {TabSelect} from '../../../apps/web/components/TabSelect';
import {defaultRules,saveLocalRules} from '../../../apps/web/utils/automation/local-rules';
const stores:any={messages:{revision:'r1',enabled:true,rules:defaultRules('messages'),history:[{id:'item-1',title:'Example client conversation',ruleName:'Business conversations',label:'Business',at:new Date().toISOString()}]},calendars:{revision:'c1',enabled:true,rules:[],history:[]}};
let serial=1,failNext=false,testCalls=0;
Object.assign(window,{fixture:{stores,fail:()=>{failNext=true;},testCalls:()=>testCalls,
 save:async(input:any)=>{saveLocalRules.parse(input);if(failNext){failNext=false;return{serverError:'Settings changed in another window. Your edits are still here.'};}const previous=stores[input.domain];if(input.revision!==previous.revision)return{serverError:'Revision conflict'};stores[input.domain]={...previous,...input,revision:`r${++serial}`};return{data:{revision:stores[input.domain].revision}};},
 test:async()=>{testCalls++;return{data:{label:'Business',ruleName:'Business conversations'}};},
}});
window.fetch=async(input:any)=>{const url=new URL(String(input),'https://fixture.test');const data=stores[url.searchParams.get('domain')!];return new Response(JSON.stringify(data),{status:data?200:404,headers:{'Content-Type':'application/json'}});};
function Fixture(){const[domain,setDomain]=useState<'messages'|'calendars'>('messages');const[tab,setTab]=useState<'rules'|'test'|'history'|'settings'>('rules');return <main style={{padding:24,maxWidth:1200,margin:'auto'}}><h1 style={{fontSize:24,marginBottom:12}}>Rules</h1><TabSelect options={[{id:'mail',label:'Mail'},{id:'messages',label:'Messages'},{id:'calendars',label:'Calendars'},{id:'tasks',label:'Tasks'}]} selected={domain} onSelect={setDomain}/><TabSelect options={[{id:'rules',label:'Rules'},{id:'test',label:'Test'},{id:'history',label:'History'},{id:'settings',label:'Settings'}]} selected={tab} onSelect={setTab}/><div className="mt-2 mb-10"><LocalRulesPanel key={domain} domain={domain} tab={tab} onTabChange={setTab}/></div></main>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);
