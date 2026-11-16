import { z } from "zod";

export const taskRule = z.object({
  id: z.string().min(1).max(100),
  name: z.string().trim().min(1).max(100),
  condition: z.string().max(8000),
  action: z.enum([
    "analyze",
    "estimate",
    "tomorrow",
    "instruction",
    "timed",
    "all_day",
    "duplicates",
    "urgent",
    "remind",
    "manual",
  ]),
  enabled: z.boolean(),
  value: z.number().min(0).max(10_080).default(0),
});
export const taskRuleList = z
  .array(taskRule)
  .max(100)
  .superRefine((rules, ctx) => {
    if (new Set(rules.map((rule) => rule.id)).size !== rules.length)
      ctx.addIssue({ code: "custom", message: "Rule IDs must be unique." });
    if (
      !rules.some(
        (rule) =>
          rule.id === "duplicates" &&
          rule.action === "duplicates" &&
          rule.enabled,
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "Duplicate review is required before adding calendar events.",
      });
    if (
      rules.some(
        (rule) =>
          rule.action === "tomorrow" &&
          (!Number.isInteger(rule.value) || rule.value > 23),
      )
    )
      ctx.addIssue({
        code: "custom",
        message: "The late-night cutoff must be a whole hour from 0 to 23.",
      });
  });
export type TaskRule = z.infer<typeof taskRule>;
export const taskActionNames: Record<TaskRule["action"], string> = {
  analyze: "Analyze confirmed tasks",
  estimate: "Use work estimates",
  tomorrow: "Late-night cutoff",
  instruction: "AI instruction",
  timed: "Add timed event",
  all_day: "Add all-day event",
  duplicates: "Review duplicates",
  urgent: "Mark urgent",
  remind: "Deadline alerts",
  manual: "Preserve manual deadlines",
};
export function defaultTaskRules(): TaskRule[] {
  return [
    {
      id: "analyze",
      name: "Analyze confirmed tasks",
      condition:
        "Analyze a new task or a changed title when confirmed with Enter. Editing notes, switching windows, opening the app or connecting AI never makes an AI call. Update AI remains available manually.",
      action: "analyze",
      enabled: true,
      value: 0,
    },
    {
      id: "estimate",
      name: "Estimate focused work",
      condition:
        "Use an explicit work-duration estimate when given; otherwise estimate focused work conservatively. Work duration is separate from time remaining until the deadline.",
      action: "estimate",
      enabled: true,
      value: 0,
    },
    {
      id: "tomorrow",
      name: "Late-night tomorrow",
      condition:
        "Before the cutoff hour, tomorrow/tmr/tmrw means the same calendar day as the task reference. From the cutoff onward it means the next day.",
      action: "tomorrow",
      enabled: true,
      value: 5,
    },
    {
      id: "date-language",
      name: "Calendar deadline language",
      condition:
        "Resolve relative phrases from the original task reference, in the sender timezone. Add compound relative durations. For calendar dates, before a weekday/date means 00:00 at its start; by/due means 23:59:59 at its end. By next week means next Monday 00:00. Weekdays and day-of-month mean the next occurrence, including today. A bare event without a clock time uses noon for its task deadline, but becomes an all-day calendar event. Date-only deadlines use end of day for the task and an all-day calendar event.",
      action: "instruction",
      enabled: true,
      value: 0,
    },
    {
      id: "explicit-times",
      name: "Honor explicit dates and times",
      condition:
        "Explicit dates and times take precedence over defaults. Respect morning, afternoon, evening and night; infer a plausible time within the stated part of day. A bare event tomorrow without a time uses noon for its task deadline. A by/due tomorrow deadline uses 23:59:59. These task defaults must not turn date-only calendar items into timed appointments.",
      action: "instruction",
      enabled: true,
      value: 0,
    },
    {
      id: "timed",
      name: "Timed tasks to calendar",
      condition:
        "Automatically add an AI-detected event or deadline with a stated clock time, part of day or relative hours/minutes to the default task calendar. Check existing events and tasks first.",
      action: "timed",
      enabled: true,
      value: 0,
    },
    {
      id: "all-day",
      name: "Date-only tasks to calendar",
      condition:
        "Automatically add an AI-detected date without a stated time as an all-day event in the default task calendar. Check existing events and tasks first.",
      action: "all_day",
      enabled: true,
      value: 0,
    },
    {
      id: "duplicates",
      name: "Review existing tasks and events",
      condition:
        "Before adding, check all connected calendars and other tasks on the affected days. A possible duplicate or changed linked event requires a dialog: update, keep existing, skip, or explicitly create a separate event. Repeated analyses must not create repeated events.",
      action: "duplicates",
      enabled: true,
      value: 0,
    },
    {
      id: "urgent",
      name: "Automatic urgency",
      condition:
        "Mark a task urgent when time remaining is at most the configured hours plus its estimated work time. Manual Urgent priority stays available.",
      action: "urgent",
      enabled: true,
      value: 12,
    },
    {
      id: "remind",
      name: "Start-work deadline alerts",
      condition:
        "Send browser and ntfy alerts before a deadline. Zero minutes uses the work estimate as lead time, or the deadline itself when no estimate is available. Positive minutes sets a fixed lead time. Cancel or replace queued ntfy alerts after task changes.",
      action: "remind",
      enabled: true,
      value: 0,
    },
    {
      id: "manual",
      name: "Respect manual deadlines",
      condition:
        "A manually edited deadline is preserved during automatic title analysis. Clicking Update AI explicitly requests a fresh AI deadline.",
      action: "manual",
      enabled: true,
      value: 0,
    },
  ];
}
export function taskPolicy(rules: TaskRule[] = defaultTaskRules()) {
  const first = (action: TaskRule["action"]) =>
    rules.find((rule) => rule.action === action && rule.enabled);
  const tomorrow = first("tomorrow");
  const instructions = rules
    .filter((rule) => rule.enabled)
    .flatMap((rule) =>
      rule.action === "instruction"
        ? [rule.condition]
        : rule.action === "tomorrow"
          ? [
              `Tomorrow, tmr and tmrw mean the same date as task_reference_sender_time before ${String(rule.value).padStart(2, "0")}:00 local time, and the next date from that hour onward. Use the task reference, not a later refresh time. Explicit dates take precedence.`,
            ]
          : rule.action === "estimate"
            ? [rule.condition]
            : [],
    );
  return {
    autoAnalyze: Boolean(first("analyze")),
    estimateWork: Boolean(first("estimate")),
    calendarTimed: Boolean(first("timed")),
    calendarAllDay: Boolean(first("all_day")),
    urgentEnabled: Boolean(first("urgent")),
    urgentHours: first("urgent")?.value ?? 12,
    remindersEnabled: Boolean(first("remind")),
    reminderLeadMinutes: first("remind")?.value ?? 0,
    manualOverrides: Boolean(first("manual")),
    lateNightHour: tomorrow?.value ?? 0,
    aiInstructions: instructions.join("\n\n"),
  };
}
