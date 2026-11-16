import { capture, basics, writeGalleryManifest } from './shared.mjs';
import { mocks as bulkMocks } from './fixtures/bulk-mocks.mjs';
import { mocks as messageMocks } from './fixtures/message-mocks.mjs';
import { mocks as chatMocks } from './fixtures/chat-mocks.mjs';

const mount = (component, importPath, props = '') => `import React from'react';import{createRoot}from'react-dom/client';import{${component}}from'${importPath}';createRoot(document.getElementById('root')).render(<${component} ${props}/>);`;
const calendarMocks = {
  ...basics,
  '@/hooks/useUser': 'export const useUser=()=>({data:{id:"showcase-user"}});',
  '@/utils/actions/calendar-visibility': 'export const saveCalendarVisibilityAction=async()=>({data:{}});',
  '@/utils/actions/calendar-month': 'export const saveMonthEventAction=async()=>({data:{id:"sample-event"}});export const deleteMonthEventAction=async()=>({data:{success:true}});',
  '@/providers/EmailAccountProvider': 'export const useAccount=()=>({emailAccountId:"showcase-account"});',
  '@/utils/fetch': 'export const fetchWithAccount=async()=>({ok:true,json:async()=>({url:"https://example.com/consent"})});',
  '@/utils/redirect': 'export const redirectToSafeUrl=()=>{};',
  '@/components/Toast': 'export const toastError=()=>{};',
  '@/hooks/useProductAnalytics': 'export const useProductAnalytics=()=>({captureAction(){}});',
};
async function calendarRoute(route, url) {
  if(url.pathname.endsWith('/visibility')) {await route.fulfill({json:{visibleIds:['work','outlook','holidays']}});return true;}
  if(url.pathname.endsWith('/defaults')) {await route.fulfill({json:{defaultCalendarId:'work',meetingProvider:'google_meet',zoomMeetingUrl:''}});return true;}
  return false;
}
const contactsData = { updatedAt: '2026-10-30T17:30:00Z', accounts: [
  { id: 'linkedin', name: 'Work connections', network: 'LinkedIn', source: 'linkedin-session', pages: 4, fetchedAt: '2026-10-30T17:30:00Z', contacts: [
    { id: 'li-morgan', name: 'Morgan Lee', email: 'morgan@example.com', company: 'Northstar Studio', profileUrl: 'https://www.linkedin.com/in/example-morgan' },
    { id: 'li-casey', name: 'Casey Rivera', email: 'casey@example.org', company: 'Fieldwork Labs', profileUrl: 'https://www.linkedin.com/in/example-casey' },
    { id: 'li-jamie', name: 'Jamie Carter', email: 'jamie@example.net', company: 'Harbor Design', profileUrl: 'https://www.linkedin.com/in/example-jamie' },
  ] },
  { id: 'whatsapp', name: 'Personal', network: 'WhatsApp', pages: 1, fetchedAt: '2026-10-30T17:30:00Z', contacts: [
    { id: 'wa-morgan', name: 'Morgan Lee', phoneNumber: '+12025550114', email: 'morgan.personal@example.org' },
    { id: 'wa-robin', name: 'Robin Taylor', phoneNumber: '+12025550118', email: 'robin@example.com' },
    { id: 'wa-avery', name: 'Avery Brooks', phoneNumber: '+12025550122' },
  ] },
  { id: 'gmail', name: 'Work mail', network: 'Gmail', pages: 1, fetchedAt: '2026-10-30T17:30:00Z', contacts: [
    { id: 'mail-morgan', name: 'Morgan Lee', email: 'morgan@example.com', company: 'Northstar Studio' },
    { id: 'mail-sam', name: 'Sam Chen', email: 'sam@example.net', company: 'Cedar Collective' },
  ] },
  { id: 'discord', name: 'Community', network: 'Discord', pages: 1, fetchedAt: '2026-10-30T17:30:00Z', contacts: [
    { id: '123456789012345678', name: 'Jordan Ellis', username: 'jordan.example' },
  ] },
] };

const configs = {
  'android-pairing': {
    source: mount('MobileDevicesSettings', './apps/web/app/(app)/settings/MobileDevicesSettings'),
    mocks: basics,
    style: 'body{padding:32px}#root{max-width:800px;margin:auto}',
    route: async (route,url)=>{
      if(url.pathname!=='/api/mobile/pair')return false;
      await route.fulfill({json:route.request().method()==='POST'?{code:'showcase-only-not-a-real-pairing-code',expiresAt:'2026-10-30T19:05:00Z'}:{devices:[],addresses:['https://onea2o.example.com']}});return true;
    },
    ready: async page=>{await page.getByLabel('Android server address').fill('https://onea2o.example.com');await page.getByRole('button',{name:'Create pairing code',exact:true}).click();await page.getByRole('img',{name:'Scan to pair Android with this installation'}).waitFor();},
  },
  'cloud-sync': {
    source: mount('CloudSyncSettings', './apps/web/app/(app)/settings/CloudSyncSettings'),
    mocks: basics,
    style: 'body{padding:32px}#root{max-width:820px;margin:auto}',
    viewport: {width:1100,height:560},
    route: async (route,url)=>{
      if(url.pathname!=='/api/user/todo/sync')return false;
      await route.fulfill({json:{enabled:true,localCopies:true,checkedAt:Date.parse('2026-10-30T19:00:00Z'),workspaces:{tasks:{syncedAt:Date.parse('2026-10-30T18:59:00Z'),pending:false},notes:{syncedAt:Date.parse('2026-10-30T18:55:00Z'),pending:true}}}});return true;
    },
    ready: async page=>{await page.getByRole('link',{name:'Download recovery key',exact:true}).waitFor();await page.getByText('Saved locally; sync will retry',{exact:true}).waitFor();},
  },
  mail: {
    entry: 'scripts/screenshots/fixtures/mail.tsx',
    mocks: basics,
    style: 'body{padding:24px}#root{min-height:calc(100vh - 48px)}',
    ready: page => page.getByText('Launch review and next steps', { exact: true }).first().waitFor(),
  },
  messages: {
    mobile: async page=>{await page.waitForTimeout(150);},
    entry: 'scripts/screenshots/fixtures/messages-reply-entry.tsx', mocks: { ...basics, ...messageMocks },
    style: '#root{height:100vh}',
    ready: async page => { await page.getByRole('list', { name: 'Conversations' }).getByRole('button').filter({ hasText: 'Morgan Lee' }).click(); await page.getByText(/Great. The team is excited/).waitFor(); },
  },
  calendar: {
    entry: 'scripts/screenshots/fixtures/calendar-month-entry.tsx', mocks: calendarMocks, route:calendarRoute,
    style: 'body{padding:24px}',
    init: page => page.clock.setFixedTime(new Date('2026-10-30T19:00:00Z')),
    ready: page => page.getByRole('button', { name: /Planning session/ }).waitFor(),
  },
  'calendar-day': {
    entry: 'scripts/screenshots/fixtures/calendar-month-entry.tsx', mocks: calendarMocks, route:calendarRoute,
    style: 'body{padding:24px}',
    init: page => page.clock.setFixedTime(new Date('2026-10-30T19:00:00Z')),
    ready: async page => { await page.getByRole('button', { name: 'Open day October 30, 2026', exact: true }).click(); await page.getByRole('region', { name: 'Day timeline' }).waitFor(); await page.getByRole('button', { name: /Planning session/ }).first().waitFor(); await page.getByRole('region', { name:'Day timeline' }).evaluate(el=>el.scrollTop=420); },
  },
  contacts: {
    source: mount('ContactsWorkspace', './apps/web/app/(app)/[emailAccountId]/contacts/ContactsWorkspace'),
    mocks: { ...basics,
      '@/utils/actions/linkedin-contacts': 'export const startLinkedInSignInAction=async()=>({data:{}}),cancelLinkedInSignInAction=startLinkedInSignInAction,disconnectLinkedInContactsAction=startLinkedInSignInAction,syncLinkedInContactsAction=startLinkedInSignInAction;',
      '@/utils/actions/beeper-contacts': 'export const refreshBeeperContactsAction=async()=>({data:{}});',
      '@/utils/account-linking': 'export const getAccountLinkingUrl=async()=>"/showcase";',
      '@/utils/redirect': 'export const redirectToSafeUrl=()=>{};',
    },
    route: async (route, url) => { if (!url.pathname.startsWith('/api/')) return false; await route.fulfill({ json: contactsData }); return true; },
    ready: async page => { await page.getByText('Morgan Lee', { exact: true }).first().waitFor(); await page.getByText('Morgan Lee', { exact: true }).first().click(); },
  },
  agents: {
    source: mount('AgentsWorkspace', './apps/web/app/(app)/[emailAccountId]/agents/AgentsWorkspace'),
    mocks: { ...basics,
      './agent-command': 'export const command=async()=>({});',
      './AgentTerminal': String.raw`import React,{forwardRef}from'react';export const AgentTerminal=forwardRef(function Terminal({threadId},ref){return <pre aria-label="Sample terminal output" style={{padding:18,margin:0,font:'13px/1.8 Consolas,monospace',color:'#c9c9c9',whiteSpace:'pre-wrap'}}><span style={{color:'#9bbedb'}}>codex · {threadId==='design'?'Website redesign':'Launch checklist'}</span>{'\n\n› '+(threadId==='design'?'Review the navigation and simplify the mobile layout.':'Prepare a concise release checklist. The draft is in notes.')+'\n\n'}<span style={{color:'#aaa'}}>• Read project instructions{'\n'}• Reviewed current implementation{'\n'}• Prepared changes and validation notes{'\n\n'}</span>{threadId==='design'?'The navigation now keeps the active section visible at narrow widths. The changes are ready for review.':'The checklist covers account connections, calendar permissions, notifications, and recovery. Ready for your feedback.'}{'\n\n'}<span style={{color:'#89a887'}}>✓ Completed</span>{'\n\n› '}</pre>});`,
    },
    route: async (route, url) => {
      if (!url.pathname.startsWith('/api/')) return false;
      const panels = ['design', 'launch'].map((id, i) => ({ id, chat_id: id, chat_title: i ? 'Launch checklist' : 'Website redesign', cwd: i ? '/projects/launch' : '/projects/design', model: '', effort: 'Default', message: i ? 'Continue the release checklist after the next reset.' : 'Review the next iteration and report any accessibility issues.', cwd_manual: false, taskId: `${id}-call` }));
      const data = url.pathname.endsWith('/metadata') ? { chats: panels.map(p => ({ id: p.id, title: p.chat_title, cwd: p.cwd, model: '' })), levels: {}, reset: null, resetError: '' } : { panels, tasks: panels.map(p => ({ id: p.taskId, status: 'scheduled', due: Date.parse('2026-10-30T20:00:00Z') / 1000, remaining: 3600, delay: '1:00', message: p.message, default_timer: false })) };
      await route.fulfill({ json: data }); return true;
    },
    ready: async page => { await page.getByRole('article', { name: 'Agent panel Website redesign', exact: true }).getByRole('button', { name: 'Timer and agent settings' }).click(); await page.getByRole('button', { name: 'Schedule', exact: true }).waitFor(); },
  },
  chat: {
    source: mount('Chat', './apps/web/components/assistant-chat/chat', 'open={true}'),
    mocks: { ...basics, ...chatMocks },
    style: '#root{height:100vh}',
    bootstrap: '<script>window.fixture={actions:[],submits:0,status:{connected:true,enabled:true,email:"alex@example.com",model:"gpt-6.1-sol",reasoningEffort:"high",models:[{id:"gpt-6.1-sol",name:"GPT-6.1 Sol",defaultReasoning:"high",reasoningLevels:[{effort:"low",description:"Quick"},{effort:"high",description:"Deeper"},{effort:"max",description:"Maximum"}]}],error:null,loginError:null,pendingUntil:null}}</script>',
    route: async (route, url) => { if (!url.pathname.startsWith('/api/')) return false; await route.fulfill({ json: await route.request().frame().evaluate(() => window.fixture.status) }); return true; },
    ready: async page => { await page.getByRole('combobox', { name: 'Thinking level' }).waitFor(); await page.getByTestId('chat-input').fill('Help me plan tomorrow using my mail, messages, calendar, tasks, and notes.'); },
  },
  rules: {
    entry: 'scripts/screenshots/fixtures/shared-rules-entry.tsx',
    mocks: { ...basics,
      '@/utils/actions/local-automation': 'export const saveLocalAutomationAction=input=>window.fixture.save(input);export const testLocalAutomationAction=input=>window.fixture.test(input);',
      '@/components/PlanBadge': 'export const getActionColor=()=>"blue";',
      '@/utils/action-display': 'import{TagIcon}from"lucide-react";export const getActionDisplay=action=>"Label as "+action.label;export const getVisibleActions=actions=>actions;export const getActionIcon=()=>TagIcon;',
    },
    ready: page => page.getByRole('columnheader', { name: 'Prompt', exact: true }).waitFor(),
  },
  usage: {
    entry: 'scripts/screenshots/fixtures/usage-entry.tsx',
    mocks: { ...basics, nuqs: 'import{useState}from"react";export const useQueryState=(name,options)=>useState(options.defaultValue);' },
    ready: async page => { await page.getByText('Messages classification', { exact: true }).first().waitFor(); await page.waitForTimeout(700); },
    fullPage: true,
  },
  'bulk-unsubscribe': {
    source: `import React from'react';import{createRoot}from'react-dom/client';import{TooltipProvider}from'./apps/web/components/ui/tooltip';import{BulkUnsubscribe}from'./apps/web/app/(app)/[emailAccountId]/bulk-unsubscribe/BulkUnsubscribeSection';createRoot(document.getElementById('root')).render(<TooltipProvider><BulkUnsubscribe/></TooltipProvider>);`,
    mocks: bulkMocks, style: 'body{padding:24px}',
    route: async (route, url) => {
      if (!url.pathname.startsWith('/api/')) return false;
      const account = route.request().headers()['x-email-account-id'];
      const names = ['Studio weekly', 'Product updates', 'Workshop announcements', 'The design digest', 'Community newsletter', 'Event round-up', 'Seasonal offers'];
      const data = url.pathname.endsWith('/load') ? { loadedMessages: 0, nextPageToken: null } : { newsletters: names.map((name, i) => ({ name: `${['studio','updates','workshop','digest','community','events','offers'][i]}@example.${account === 'gmail' ? 'com' : 'org'}`, fromName: name, value: 340 - i * 27, readEmails: 3 + i, inboxEmails: 20 + i * 4, lastEmailAt: Date.now(), unsubscribeLink: 'https://example.com/unsubscribe', labelFilters: [] })), nextCursor: null };
      await route.fulfill({ json: data }); return true;
    },
    ready: async page => { await page.getByText('14 senders', { exact: true }).waitFor(); await page.getByRole('checkbox', { name: 'Select Studio weekly', exact: true }).first().click(); await page.getByRole('checkbox', { name: 'Select Product updates', exact: true }).first().click(); },
  },
};

const selected = process.argv.slice(2);
for (const [name, config] of Object.entries(configs)) {
  if (!selected.length || selected.includes(name)) await capture(name, config);
}
writeGalleryManifest();
