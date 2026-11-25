import { describe, expect, it } from 'vitest';
import { manualNotes, moveNote, visibleNotes } from '../../public/open-todo-zero/notes-list.mjs';

const notes = [
  {id:'a', title:'Alpha', notes:'body', createdAt:new Date('2026-11-09T08:20:30').getTime()},
  {id:'b', title:'Beta', notes:'body', createdAt:new Date('2026-11-08T10:00:00').getTime(), updatedAt:new Date('2026-11-09T09:30:59').getTime()},
  {id:'c', title:'Gamma', notes:'body', createdAt:new Date('2026-11-09T09:00:00').getTime()},
];
describe('Notes list order and date filters', () => {
  it('retains manual order independently of creation and editing order', () => {
    const reordered = moveNote(notes, 'c', 'a');
    expect(reordered.map(note=>note.id)).toEqual(['c','a','b']);
    expect(visibleNotes(reordered,{sort:'created-desc'}).map(note=>note.id)).toEqual(['c','a','b']);
    expect(visibleNotes(reordered,{sort:'edited-desc'}).map(note=>note.id)).toEqual(['b','c','a']);
    expect(visibleNotes(reordered).map(note=>note.id)).toEqual(['c','a','b']);
    expect(manualNotes([...reordered].reverse()).map(note=>note.id)).toEqual(['c','a','b']);
    expect(reordered.find(note=>note.id==='b').updatedAt).toBe(notes[1].updatedAt);
    expect(notes[0].noteOrder).toBeUndefined();
  });
  it('moves between filtered rows without removing hidden notes, and puts imported notes first', () => {
    const reordered = moveNote(notes, 'c', 'a', true);
    expect(reordered.map(note=>note.id)).toEqual(['a','c','b']);
    expect(manualNotes([...reordered,{...notes[0],id:'new'}]).map(note=>note.id)).toEqual(['new','a','c','b']);
    expect(moveNote(notes,'missing','a')).toBe(notes);
  });
  it('filters local dates and times inclusively through the selected minute', () => {
    expect(visibleNotes(notes,{dateField:'edited',from:'2026-11-09T09:30',to:'2026-11-09T09:30'}).map(note=>note.id)).toEqual(['b']);
    expect(visibleNotes(notes,{dateField:'created',from:'2026-11-09T08:20',to:'2026-11-09T09:00',query:'AMMA'}).map(note=>note.id)).toEqual(['c']);
    expect(visibleNotes(notes,{from:'2026-11-10T00:00'})).toEqual([]);
  });
});

it('never lists recovery records, including orphans during sync, while retaining their text',()=>{
 const recovery={...notes[0],id:'recovery',title:'Alpha (recovered edit)',notes:'Unique recovered text',recoveredFrom:'temporarily-missing',noteOrder:-100};
 const items=[recovery,...notes];
 for(const sort of ['manual','created-desc','created-asc','edited-desc','edited-asc']){
  expect(visibleNotes(items,{sort}).map(item=>item.id)).not.toContain('recovery');
 }
 expect(visibleNotes(items,{query:'recovered'})).toEqual([]);
 expect(visibleNotes([recovery])).toEqual([]);
 expect(moveNote(items,'c','a').find(item=>item.id==='recovery')?.notes).toBe('Unique recovered text');
});
