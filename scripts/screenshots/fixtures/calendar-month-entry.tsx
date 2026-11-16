
import {createRoot} from 'react-dom/client';
import {SWRConfig} from '../../../apps/web/node_modules/swr';
import {UnifiedMonthCalendar} from '../../../apps/web/app/(app)/[emailAccountId]/calendars/UnifiedMonthCalendar';
const calendars=[
 {id:'work',connectionId:'google',calendarId:'work@example.com',name:'Work',accountEmail:'work@example.com',provider:'google',writable:true,primary:true},
 {id:'outlook',connectionId:'outlook',calendarId:'outlook-cal',name:'Personal',accountEmail:'personal@outlook.com',provider:'microsoft',writable:true,primary:true},
 {id:'holidays',connectionId:'google',calendarId:'holidays',name:'Holidays',accountEmail:'work@example.com',provider:'google',writable:false,primary:false},
];
let events=[
 {id:'gmail-generated',calendarKey:'work',title:'Email reservation',description:'Automatically generated reservation notes',location:'Reservation room',start:'2026-10-29T16:00:00Z',end:'2026-10-29T17:00:00Z',allDay:false,guests:['originalguest@example.com'],etag:'v1',editable:false,deletable:true,readOnlyReason:'Google created this event automatically from Gmail. Its title, time and notes cannot be edited by connected apps. Create an editable copy to make changes.',recurring:false,descriptionLocked:false},
 {id:'planning',calendarKey:'work',title:'Planning session',description:'Agenda and notes',location:'Riverside',start:'2026-10-30T17:00:00Z',end:'2026-10-30T18:00:00Z',allDay:false,guests:[],etag:'v1',editable:true,recurring:true,descriptionLocked:false},
 {id:'personal',calendarKey:'outlook',title:'Personal appointment',description:'',location:'',start:'2026-10-30T20:00:00Z',end:'2026-10-30T21:00:00Z',allDay:false,guests:[],etag:'v1',editable:true,recurring:false,descriptionLocked:false},
 {id:'holiday',calendarKey:'holidays',title:'Public holiday',description:'Read-only holiday',location:'',start:'2026-10-29',end:'2026-10-31',allDay:true,guests:[],etag:'v1',editable:false,recurring:false,descriptionLocked:false},
];
events = Array.from({length: 18}, (_,i)=>({id:`event-${i}`,calendarKey:['work','outlook','holidays'][i%3],title:['Weekly planning','Design review','Team workshop','Project milestone','Lunch with Morgan','Community meetup'][i%6],description:'Sample event for the public feature gallery',location:i%2?'Studio':'Video call',start:`2026-10-${String(2+i+Math.floor(i/3)).padStart(2,'0')}T17:00:00Z`,end:`2026-10-${String(2+i+Math.floor(i/3)).padStart(2,'0')}T18:00:00Z`,allDay:false,guests:[],etag:'v1',editable:i%3!==2,recurring:false,descriptionLocked:false})).concat(events);
function Fixture(){return <SWRConfig value={{fetcher:async()=>({calendars,events,warnings:[]}),dedupingInterval:0}}><UnifiedMonthCalendar userId="showcase-user"/></SWRConfig>;}
createRoot(document.getElementById('root')!).render(<Fixture/>);