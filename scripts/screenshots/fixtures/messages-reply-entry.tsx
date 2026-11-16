
import {createRoot} from 'react-dom/client';
import {MessagesWorkspace} from '../../../apps/web/app/(app)/[emailAccountId]/messages/MessagesWorkspace';
const now=Date.now();
const conversations=[
{id:'supported',network:'WhatsApp',title:'Morgan Lee',ruleLabel:'Business',preview:'The designs look great. Let us review the launch plan.'},
{id:'linkedin',network:'LinkedIn',title:'Casey Rivera',ruleLabel:'Business',preview:'Thanks for connecting! Happy to compare notes.'},
{id:'unsupported',network:'SMS',title:'Weekend plans',ruleLabel:'Casual',preview:'See you at the park on Saturday?'},
{id:'discord',network:'Discord',title:'Design team',ruleLabel:'Business',preview:'New prototypes are ready for feedback.'},
{id:'x',network:'X',title:'Jamie Carter',ruleLabel:'Casual',preview:'That was a great talk yesterday.'},
{id:'reminders',network:'WhatsApp',title:'Event reminders',ruleLabel:'Notification',preview:'Your workshop starts tomorrow at 10 AM.'},
].map((row,i)=>({...row,accountId:row.id,account:'Alex',group:i===2||i===3,unread:i===1?2:0,time:new Date(now-i*3_600_000).toISOString(),readOnly:false}));
const initial=(chatId:string)=>({id:`incoming-${chatId}`,chatId,sender:'Morgan Lee',text:'The designs look great. Let us review the launch plan.',time:new Date(now-3_600_000).toISOString(),outgoing:false,deleted:false,attachments:[],canReply:true,canReact:true,canRecall:false,reactions:[]});
const history:any=Object.fromEntries(conversations.map(c=>[c.id,[initial(c.id)]]));
history.supported=[
{...initial('supported'),id:'m1',text:'Hi Alex, I have uploaded the final mockups. The navigation is much clearer now.',time:new Date(now-5_400_000).toISOString()},
{...initial('supported'),id:'m2',sender:'You',outgoing:true,text:'These look excellent. Can we review the launch plan at 2 PM tomorrow?',time:new Date(now-4_800_000).toISOString(),status:'SUCCESS',seen:true,readReceipts:true,canRecall:true},
{...initial('supported'),id:'m3',text:'Absolutely. I will bring the updated timeline and the accessibility checklist.',time:new Date(now-4_200_000).toISOString()},
{...initial('supported'),id:'m4',sender:'You',outgoing:true,text:'Perfect, thank you! I will send a calendar invite.',time:new Date(now-3_600_000).toISOString(),status:'SUCCESS',seen:false,readReceipts:true,canRecall:true},
{...initial('supported'),id:'m5',text:'Great. The team is excited to get this into people’s hands.',time:new Date(now-3_000_000).toISOString()},
];
const sends:any[]=[];const receipts:any={};let reactions=0,recalls=0;
const fixture={sends,history,
 send:(input:any)=>new Promise(resolve=>{sends.push({input,resolve});}),
 release:(index:number,fail=false)=>{const row=sends[index];if(fail){row.resolve({serverError:'Delivery could not be confirmed.'});return;}const message={id:`final-${index}`,chatId:row.input.chatId,sender:'You',replyToMessageId:row.input.replyToMessageId,text:row.input.text,time:new Date().toISOString(),outgoing:true,deleted:false,attachments:[],status:'PENDING',canReact:false,canRecall:false};receipts[`pending-${index}`]=message;row.resolve({data:{pendingMessageID:`pending-${index}`,chatID:row.input.chatId}});},
 confirm:(index:number,seen?:boolean)=>{const message=receipts[`pending-${index}`];Object.assign(message,{status:'SUCCESS',seen,readReceipts:message.chatId==='supported',canReact:message.chatId==='supported',canRecall:message.chatId==='supported'});if(!history[message.chatId].some((m:any)=>m.id===message.id))history[message.chatId].push(message);},
 reaction:async(input:any)=>{reactions++;const message=history[input.chatId].find((m:any)=>m.id===input.messageId);if(message)message.reactions=input.remove?[]:[{key:input.reactionKey,count:1,mine:true}];return{data:{updated:true}};},
 recall:async(input:any)=>{recalls++;const message=history[input.chatId].find((m:any)=>m.id===input.messageId);if(message)message.deleted=true;return{data:{recalled:true}};},
 counts:()=>({reactions,recalls}),
};
Object.assign(window,{fixture});
window.fetch=async(input:any)=>{
 const url=new URL(String(input),'https://fixture.test');let data:any={};
 if(url.pathname.endsWith('/groups'))data=[];else if(url.pathname.endsWith('/participants'))data={supported:false,participants:[]};else if(url.pathname.endsWith('/status'))data={configured:true,running:true,accounts:conversations.map(c=>({id:c.id,name:c.account,network:c.network,status:'connected'}))};
 else if(url.pathname.endsWith('/conversations'))data={items:conversations,hasMore:false,cursor:null};
 else if(url.pathname.endsWith('/thread')){const chatId=url.searchParams.get('chatId')!;data={items:history[chatId].map((m:any)=>({...m})),hasMore:false,cursor:null};}
 else if(url.pathname.endsWith('/receipt'))data=receipts[url.searchParams.get('pendingId')!];
 else if(url.pathname.includes('/automation'))data={enabled:false,working:false,rules:[]};
 else data={items:[],accounts:[],contacts:[],enabled:false};
 return new Response(JSON.stringify(data),{status:data?200:404,headers:{'Content-Type':'application/json'}});
};
createRoot(document.getElementById('root')!).render(<MessagesWorkspace/>);
