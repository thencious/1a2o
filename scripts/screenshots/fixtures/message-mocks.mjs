export const mocks={
 '@/utils/actions/combine-conversations':`export const combineConversationsAction=async input=>{window.fixture.lastCombine=input;const group={id:input.chatIds[0],title:'Combined Alex',members:window.fixture.conversations.filter(item=>input.chatIds.includes(item.id))};window.fixture.groups=[group];return {data:group};};`,
 '@/utils/actions/attention':'export const reportMessageViewAction=async()=>({data:{saved:true}});',
 'next/navigation':'export const useSearchParams=()=>new URLSearchParams();export const usePathname=()=>"/synthetic/messages";export const useRouter=()=>({push:()=>{},replace:()=>{}});',
 '@/providers/EmailAccountProvider':'export const useAccount=()=>({emailAccountId:"synthetic"});',
 '@/utils/actions/beeper':`export const editBeeperMessageAction=async()=>({data:{}});export const saveBeeperRecoveryAction=async()=>({data:{}});export const verifyBeeperRecoveryAction=async()=>({data:{}});export const sendBeeperMessageAction=input=>window.fixture.send(input);export const recallBeeperMessageAction=input=>window.fixture.recall(input);export const reactBeeperMessageAction=input=>window.fixture.reaction(input);export const readBeeperChatAction=async()=>({data:{read:true}});export const connectBeeperAction=async()=>({data:{}});export const setBeeperGroupAction=async()=>({data:{}});`,
 '@/utils/actions/message-invite':'export const prepareMessageInviteAction=()=>new Promise(resolve=>window.fixture.finishInvite=resolve);',
 '@/utils/actions/message-add-contacts':'export const addMessageContactsAction=()=>new Promise(resolve=>window.fixture.finishAdd=resolve);',
 '@/utils/actions/calendar-month':'export const saveMonthEventAction=async()=>({data:{}});export const deleteMonthEventAction=async()=>({data:{}});',
 '@/utils/error':'export const getActionErrorMessage=result=>result.serverError||"Operation failed";',
 '@/components/LoadingContent':'import React from"react";export const LoadingContent=({children})=>children;',
 'next/image':'import React from"react";export default function Image({unoptimized,...props}){return <img {...props}/>}',
};
