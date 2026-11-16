import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MailThreadRow } from '../../../packages/mail-ui/src/MailThreadRow';
import { MailMessageBody } from '../../../packages/mail-ui/src/MailBody';
import { MailLabelChip } from '../../../apps/web/app/(app)/[emailAccountId]/mail/MailLabelChip';
import { SplitTabs } from '../../../apps/web/app/(app)/[emailAccountId]/mail/SplitTabs';
import { Button } from '../../../apps/web/components/ui/button';
import { Archive, Reply, Forward, Trash2, RefreshCw, PenSquare } from 'lucide-react';

const rows = [
  ['Morgan Lee', 'Launch review and next steps', 'The revised designs are ready. Let’s review the schedule tomorrow.', 'To Reply', 'work@example.com', '#44648c', '10:42 AM'],
  ['Casey Rivera', 'Workshop agenda', 'Here’s the outline for next week’s workshop, including the hands-on session.', 'Notification', 'alex@example.org', '#657459', '10:18 AM'],
  ['Northstar Studio', 'Project files shared with you', 'The final assets and handoff notes are in the shared folder.', 'Notification', 'work@example.com', '#44648c', '9:55 AM'],
  ['Jamie Carter', 'Lunch on Friday?', 'Would noon work for you? There’s a new place near the studio.', 'To Reply', 'alex@example.org', '#657459', '9:30 AM'],
  ['Design Digest', 'This week in product design', 'A selection of interface ideas, research notes, and useful tools.', 'Marketing', 'alex@example.org', '#657459', '8:52 AM'],
  ['Sam Chen', 'Proposal feedback', 'The scope looks good. I left a few comments on the timeline.', 'To Reply', 'work@example.com', '#44648c', 'Yesterday'],
  ['Community Workshop', 'Your seat is confirmed', 'You’re booked for the introduction to accessible design.', 'Notification', 'alex@example.org', '#657459', 'Yesterday'],
  ['Robin Taylor', 'Re: Notes from our call', 'Thanks — I’ll send the updated version after the team review.', 'Awaiting Reply', 'work@example.com', '#44648c', 'Yesterday'],
  ['Fieldwork Labs', 'A quick introduction', 'We help small teams improve how they work together.', 'Cold Email', 'work@example.com', '#44648c', 'Oct 28'],
  ['Avery Brooks', 'Weekend photos', 'A few photos from our walk. Such a beautiful afternoon!', '', 'alex@example.org', '#657459', 'Oct 28'],
];
const splits = ['All', 'To Reply', 'Awaiting Reply', 'Notification', 'Marketing', 'Cold Email'].map(name => ({ id: name, name, deletable: false }));

function Mail() {
  const [focused, setFocused] = useState(0);
  const current = rows[focused];
  return <main style={{ height: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
    <header className="mb-4 flex items-center justify-between"><h1 className="text-2xl font-semibold">Mail</h1><div className="flex items-center gap-3"><select aria-label="Mailboxes" className="h-9 rounded-md border bg-background px-3"><option>All inboxes</option><option>work@example.com</option><option>alex@example.org</option></select><Button aria-label="Refresh mail" variant="ghost" size="icon"><RefreshCw className="size-4"/></Button></div></header>
    <SplitTabs splits={splits} activeSplitId={null} selectedSplitIds={new Set(splits.map(s => s.id))} countsById={new Map([['All', 42], ['To Reply', 8], ['Awaiting Reply', 5], ['Notification', 14], ['Marketing', 12], ['Cold Email', 3]])} onSelect={() => {}} onFocus={() => {}} onNewSplit={() => {}} canCreateSplits={false}/>
    <section className="mt-3 flex min-h-0 flex-1 overflow-hidden rounded-lg border">
      <div style={{ flex: '0 0 47%', overflow: 'auto', borderRight: '1px solid #3a3a3a', background: '#232323' }}>
        {rows.map(([sender, subject, snippet, label, inbox, color, date], index) => <MailThreadRow key={subject} index={index} layout="split" participantSummary={sender} subject={subject} snippet={snippet} date={date} labels={label ? [<MailLabelChip key={label} name={label}/>] : []} accountLabel={inbox} accountEmail={inbox} isUnread={index < 4} isStarred={index === 0} isDraft={false} messageCount={index === 0 ? 3 : 1} isFocused={focused === index} isSelected={false} hasAnySelection={false} selectionEnabled={false} expandedPreview style={{ borderLeft: `4px solid ${color}`, background: focused === index ? '#2c3037' : undefined }} onOpen={setFocused} onToggleSelect={() => {}} onSelectRangeTo={() => {}}/>)}
      </div>
      <article className="min-w-0 flex-1" style={{ background: '#222831' }}>
        <div className="flex items-center gap-1 border-b px-4 py-2"><Button variant="ghost" size="icon" aria-label="Archive"><Archive className="size-4"/></Button><Button variant="ghost" size="icon" aria-label="Delete"><Trash2 className="size-4"/></Button><div className="flex-1"/><Button variant="ghost" size="icon" aria-label="Compose"><PenSquare className="size-4"/></Button></div>
        <div className="p-6"><h2 className="mb-5 text-xl font-semibold">{current[1]}</h2><div className="mb-6 flex items-start justify-between"><div><div className="font-medium">{current[0]} <span className="ml-2 text-xs font-normal text-muted-foreground">→ {current[4]}</span></div><div className="mt-1 text-xs text-muted-foreground">morgan@example.com</div></div><span className="text-xs text-muted-foreground">October 30, 10:42 AM</span></div>
          <MailMessageBody messageId="showcase-mail" isDarkMode text={'Hi Alex,\n\nThe revised designs are ready for review. I’ve included the updated navigation and the mobile layouts we discussed.\n\nCould we walk through the launch schedule tomorrow at 2 PM? The main items are:\n\n• Final accessibility review\n• Updated onboarding copy\n• Handoff of the release checklist\n\nThanks for all your feedback — it has made a real difference.\n\nBest,\nMorgan'}/>
          <div className="mt-8 flex gap-2"><Button variant="outline"><Reply className="mr-2 size-4"/>Reply</Button><Button variant="outline"><Forward className="mr-2 size-4"/>Forward</Button></div>
        </div>
      </article>
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Mail/>);
