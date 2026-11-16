import { expect, it } from "vitest";
import {
  calendarDayRange,
  possibleCalendarDuplicate,
  taskCalendarProposal,
} from "./calendar-matching";
const task = {
  id: "one",
  title: "Interview tomorrow 2pm",
  notes: "",
  createdAt: 1,
  aiState: "success",
  aiEvidence: {
    arguments: {
      calendar_kind: "event",
      calendar_explicit_time: true,
      calendar_title: "Interview",
      calendar_start_local: "2026-11-02T14:00:00",
      calendar_end_local: "2026-11-02T15:00:00",
    },
    timeContext: { sender_timezone: "America/Los_Angeles" },
  },
};
it("converts task wall times in the sender timezone and scans the correct local days across DST", () => {
  const proposal = taskCalendarProposal(task)!;
  expect(proposal.start).toBe("2026-11-02T22:00:00.000Z");
  expect(proposal.end).toBe("2026-11-02T23:00:00.000Z");
  expect(
    calendarDayRange({
      ...proposal,
      start: "2026-11-01T08:30:00Z",
      end: "2026-11-02T07:00:00Z",
    }),
  ).toEqual({
    start: "2026-11-01T07:00:00.000Z",
    end: "2026-11-02T08:00:00.000Z",
  });
});
it("uses all-day dates and rejects completed, malformed or manually overridden tasks", () => {
  expect(taskCalendarProposal({ ...task, completedAt: 2 })).toBeNull();
  expect(taskCalendarProposal({ ...task, deadlineOverride: true })).toBeNull();
  expect(
    taskCalendarProposal({
      ...task,
      aiEvidence: {
        ...task.aiEvidence,
        arguments: {
          ...task.aiEvidence.arguments,
          calendar_explicit_time: false,
        },
      },
    }),
  ).toMatchObject({ allDay: true, start: "2026-11-02", end: "2026-11-03" });
  expect(
    taskCalendarProposal({
      ...task,
      aiEvidence: {
        ...task.aiEvidence,
        arguments: {
          ...task.aiEvidence.arguments,
          calendar_start_local: "2026-02-30T14:00:00",
        },
      },
    }),
  ).toBeNull();
});
it("matches normalized and reordered titles without treating unrelated overlapping appointments as duplicates", () => {
  const proposal = { ...taskCalendarProposal(task)!, title: "Interview Glenn" };
  expect(
    possibleCalendarDuplicate(proposal, {
      title: "Glenn — interview",
      start: proposal.start,
      end: proposal.end,
    }),
  ).toBe(true);
  expect(
    possibleCalendarDuplicate(proposal, {
      title: "Gym session",
      start: proposal.start,
      end: proposal.end,
    }),
  ).toBe(false);
});
