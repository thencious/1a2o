import type { MonthCalendar, MonthEvent } from "@/utils/calendar/month-types";
export type CalendarProposal = {
  allDay: boolean;
  taskId: string;
  title: string;
  start: string;
  end: string;
  timezone: string;
  kind: "event" | "deadline";
  hash: string;
};
export type CalendarCandidate = { calendar: MonthCalendar; event: MonthEvent };
export type CalendarPrompt = {
  taskId: string;
  taskTitle: string;
  proposal: CalendarProposal;
  candidates: CalendarCandidate[];
  otherTasks: string[];
};
export type TodoCalendarResult =
  | {
      kind: "created" | "unchanged" | "disabled" | "skipped";
      taskId: string;
      eventId?: string;
      reason?: "timing_or_rules" | "off";
    }
  | { kind: "needs-calendar"; taskId: string }
  | { kind: "duplicate"; taskId: string; prompt: CalendarPrompt };
