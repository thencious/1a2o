export const mocks={
 '@/providers/ChatProvider':`import React,{useState}from'react';export function useChat(){const[input,setInput]=useState(''),[messages,setMessages]=useState([]);window.fixture.toMessages??=()=>setMessages([{id:'one',role:'assistant',parts:[{type:'text',text:'Example response'}]}]);return{chat:{messages,status:'ready',setMessages,regenerate:()=>{}},chatId:'fixture',persistedMessageIds:new Set(),input,setInput,handleSubmit:()=>{window.fixture.submits++},setNewChat:()=>{},context:null,setContext:()=>{},sourceContext:null,setSourceContext:()=>{},attachments:[],setAttachments:()=>{},submitTextMessage:async()=>{},stop:async()=>{},setChatId:()=>{}}}`,
 '@/hooks/useChats':'export const useChats=()=>({data:{chats:[]},mutate:async()=>{},isLoading:false});',
 '@/utils/auth-client':'export const useSession=()=>({data:{user:{name:"Alex"}}});',
 '@/hooks/useProductAnalytics':'export const useProductAnalytics=()=>({captureAction:()=>{}});',
 '@/components/Tooltip':'export const Tooltip=({children})=>children;',
 '@/components/LoadingContent':'export const LoadingContent=({children})=>children;',
 '@/components/voice/VoiceInput':`import React from'react';export const VoiceInput=()=> <button type="button" aria-label="Voice input" style={{width:36,height:36}}>🎙</button>;`,
 '@/components/assistant-chat/ChatHistoryItem':'export const ChatHistoryItem=()=>null;',
 '@/components/assistant-chat/RenameChatDialog':'export const RenameChatDialog=()=>null;',
 '@/components/assistant-chat/DeleteChatDialog':'export const DeleteChatDialog=()=>null;',
 '@/utils/actions/chatgpt':`export async function startChatGPTLoginAction(){return{data:{url:'https://auth.openai.com/fixture'}}};export async function configureChatGPTAction(input){window.fixture.actions.push(input);const s=window.fixture.status;if(input.mode==='disconnect'){s.connected=false;s.enabled=false}else if(input.mode==='model'){s.model=input.model;const m=s.models.find(x=>x.id===s.model);if(!m.reasoningLevels.some(x=>x.effort===s.reasoningEffort))s.reasoningEffort=m.defaultReasoning}else if(input.mode==='reasoning')s.reasoningEffort=input.reasoningEffort;else s.enabled=input.mode==='chatgpt';localStorage.setItem('fixture-status',JSON.stringify(s));return{data:{revocationConfirmed:true}}}`,
 '@/utils/error':'export const getActionErrorMessage=()=>"Failed";',
 './messages':`import React from'react';export const Messages=({footer})=><div className="flex min-h-0 flex-1 flex-col"><div className="flex-1 p-6">Example response</div><div className="mx-auto w-full max-w-[848px] px-6 pb-6">{footer}</div></div>;`,
 './preview-attachment':'export const PreviewAttachment=()=>null;'
};
