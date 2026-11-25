import { describe, expect, it } from "vitest";
import {
  noteTitle,
  noteDocument,
  mergeWorkspaceItems,
  taskFromNote,
} from "../../public/open-todo-zero/workspace-data.mjs";
describe("note documents and task copies", () => {
  it("makes the first line a heading and derives its title without changing body formatting", () => {
    expect(noteDocument("Meeting notes\n\n- **Follow up**")).toBe(
      "# Meeting notes\n\n- **Follow up**",
    );
    expect(noteTitle("# Meeting notes\n\nBody")).toBe("Meeting notes");
    expect(noteDocument("## Heading\nBody")).toBe("# Heading\nBody");
    expect(noteDocument("")).toBe("");
  });
  it("keeps a full note while generating a separate concise task with its extracted deadline", () => {
    const note = {
      id: "a",
      notes: "# Long meeting notes\nSend the proposal tomorrow",
    };
    const analysis = {
      deadline: { at: 123 },
      estimatedSeconds: 600,
      evidence: {
        arguments: { task_title: "Send proposal", calendar_kind: "deadline" },
      },
    };
    const task = taskFromNote(note, analysis, 10);
    expect(task).toMatchObject({
      title: "Send proposal",
      notes: note.notes,
      deadline: { at: 123 },
      sourceNoteId: "a",
    });
    expect(
      taskFromNote(note, { ...analysis, deadline: null }).deadline,
    ).toBeNull();
    expect(() => taskFromNote(note, { evidence: { arguments: {} } })).toThrow(
      "summary",
    );
  });
  it("retains dates for a calendar event even when no separate deadline was found", () => {
    const task = taskFromNote(
      { id: "a", notes: "Meeting tomorrow" },
      {
        deadline: null,
        evidence: {
          arguments: {
            task_title: "Attend meeting",
            calendar_kind: "event",
            calendar_start_local: "2026-11-08T15:00:00",
          },
        },
      },
    );
    expect(task.deadline.at).toBe(new Date("2026-11-08T15:00:00").getTime());
  });
});
describe("cross-tab imports preserve drafts", () => {
  const original = { id: "a", notes: "original" },
    edited = { id: "a", notes: "unsaved editing" },
    incoming = { id: "b", notes: "copied from Notes" };
  it("merges imported items without replacing unfinished edits", () => {
    expect(
      mergeWorkspaceItems([original], [edited], [original, incoming]),
    ).toEqual([edited, incoming]);
  });
  it("does not resurrect deleted items and catches conflicting edits", () => {
    expect(mergeWorkspaceItems([original], [], [original, incoming])).toEqual([
      incoming,
    ]);
    expect(mergeWorkspaceItems([original], [original], [])).toEqual([]);
    const merged = mergeWorkspaceItems(
      [original],
      [edited],
      [{ ...original, notes: "other edit" }],
    );
    expect(merged).toHaveLength(1);
    expect(
      new Set(
        [merged[0], ...merged[0].recoveredVersions].map((item) => item.notes),
      ),
    ).toEqual(new Set(["unsaved editing", "other edit"]));
    const deleted = mergeWorkspaceItems([original], [], [edited]);
    expect(deleted).toHaveLength(1);
    expect(deleted[0].id).not.toBe(original.id);
    expect(deleted[0].notes).toBe(edited.notes);
  });
});

describe("concurrent independent edits", () => {
  it("merges separate fields without making redundant recovery copies", () => {
    const base = { id: "x", title: "Before", notes: "Body", createdAt: 1 };
    expect(
      mergeWorkspaceItems(
        [base],
        [{ ...base, title: "New title" }],
        [{ ...base, notes: "New body" }],
      ),
    ).toEqual([{ ...base, title: "New title", notes: "New body" }]);
  });
});
