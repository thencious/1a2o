import { TZDate } from "@date-fns/tz";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { todoTask } from "@/utils/actions/todo.validation";
import type { MonthEvent } from "@/utils/calendar/month-types";
import type { CalendarProposal } from "./calendar-types";
import { taskPolicy } from "./task-rules";

const evidence = z.object({
  arguments: z.object({
    calendar_kind: z.enum(["event", "deadline"]),
    calendar_explicit_time: z.boolean(),
    calendar_title: z.string().max(512),
    calendar_start_local: z.string().nullable(),
    calendar_end_local: z.string().nullable(),
  }),
  timeContext: z.object({ sender_timezone: z.string() }),
});
export function taskCalendarProposal(
  task: z.infer<typeof todoTask>,
  policy = taskPolicy(),
  defaultTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
): CalendarProposal | null {
  const manual = task.deadlineOverride === true;
  if (task.completedAt || (!manual && task.aiState !== "success")) return null;
  const parsed = evidence.safeParse(
    manual
      ? {
          arguments: {
            calendar_kind: "deadline",
            calendar_explicit_time: true,
            calendar_title: task.title,
            calendar_start_local: null,
            calendar_end_local: null,
          },
          timeContext: { sender_timezone: defaultTimezone },
        }
      : task.aiEvidence,
  );
  if (!parsed.success) return null;
  const args = parsed.data.arguments,
    timezone = parsed.data.timeContext.sender_timezone;
  const allDay = !args.calendar_explicit_time;
  if (allDay ? !policy.calendarAllDay : !policy.calendarTimed) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    const fallback = z
      .object({ at: z.number().finite() })
      .safeParse(task.deadline);
    const start = args.calendar_start_local
      ? localInstant(args.calendar_start_local, timezone)
      : fallback.success
        ? new Date(fallback.data.at).toISOString()
        : null;
    if (!start) return null;
    const end = args.calendar_end_local
      ? localInstant(args.calendar_end_local, timezone)
      : new Date(
          Date.parse(start) +
            (args.calendar_kind === "deadline" ? 15 : 30) * 60_000,
        ).toISOString();
    if (
      !end ||
      Date.parse(end) <= Date.parse(start) ||
      Date.parse(end) - Date.parse(start) > 45 * 86_400_000
    )
      return null;
    const date = (instant: string) => new TZDate(new Date(instant), timezone);
    const dateString = (instant: string) => {
      const day = date(instant);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    };
    const calendarStart = allDay ? dateString(start) : start;
    let calendarEnd = end;
    if (allDay) {
      const day = date(start),
        next = new TZDate(
          day.getFullYear(),
          day.getMonth(),
          day.getDate() + 1,
          12,
          0,
          0,
          timezone,
        );
      calendarEnd =
        args.calendar_end_local && dateString(end) > calendarStart
          ? dateString(end)
          : `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}-${String(next.getDate()).padStart(2, "0")}`;
    }
    const title = args.calendar_title.trim() || task.title;
    const hash = createHash("sha256")
      .update(
        JSON.stringify([
          title,
          calendarStart,
          calendarEnd,
          allDay,
          timezone,
          args.calendar_kind,
        ]),
      )
      .digest("hex");
    return {
      taskId: task.id,
      title,
      start: calendarStart,
      end: calendarEnd,
      allDay,
      timezone,
      kind: args.calendar_kind,
      hash,
    };
  } catch {
    return null;
  }
}
function localInstant(value: string, timezone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(
    value,
  );
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match
    .slice(1)
    .map((part) => Number(part || 0));
  const date = new TZDate(year, month - 1, day, hour, minute, second, timezone);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  )
    return null;
  return new Date(date.getTime()).toISOString();
}
export function calendarDayRange(
  proposal: Pick<CalendarProposal, "start" | "end" | "timezone"> & {
    allDay?: boolean;
  },
) {
  if (proposal.allDay) {
    const [y, m, d] = proposal.start.split("-").map(Number),
      [ey, em, ed] = proposal.end.split("-").map(Number);
    return {
      start: new Date(
        new TZDate(y, m - 1, d, 0, 0, 0, proposal.timezone).getTime(),
      ).toISOString(),
      end: new Date(
        new TZDate(ey, em - 1, ed, 0, 0, 0, proposal.timezone).getTime(),
      ).toISOString(),
    };
  }
  const start = new TZDate(new Date(proposal.start), proposal.timezone),
    end = new TZDate(new Date(Date.parse(proposal.end) - 1), proposal.timezone);
  return {
    start: new Date(
      new TZDate(
        start.getFullYear(),
        start.getMonth(),
        start.getDate(),
        0,
        0,
        0,
        proposal.timezone,
      ).getTime(),
    ).toISOString(),
    end: new Date(
      new TZDate(
        end.getFullYear(),
        end.getMonth(),
        end.getDate() + 1,
        0,
        0,
        0,
        proposal.timezone,
      ).getTime(),
    ).toISOString(),
  };
}
export function possibleCalendarDuplicate(
  proposal: CalendarProposal,
  event: Pick<MonthEvent, "title" | "start" | "end">,
) {
  const normalize = (text: string) =>
    text
      .normalize("NFKC")
      .toLocaleLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ")
      .trim();
  const a = normalize(proposal.title),
    b = normalize(event.title);
  if (a && a === b) return true;
  const wordsA = new Set(a.split(" ").filter(Boolean)),
    wordsB = new Set(b.split(" ").filter(Boolean));
  const shared = [...wordsA].filter((word) => wordsB.has(word)).length;
  const similarity = (2 * shared) / Math.max(1, wordsA.size + wordsB.size);
  const overlap =
    Date.parse(proposal.start) < Date.parse(event.end) &&
    Date.parse(proposal.end) > Date.parse(event.start);
  return shared > 0 && (similarity >= 0.72 || (similarity >= 0.45 && overlap));
}

export function eventOnProposalDays(
  proposal: CalendarProposal,
  event: Pick<MonthEvent, "start" | "end" | "allDay">,
) {
  const range = calendarDayRange(proposal);
  if (event.allDay) {
    const localDate = (instant: string) => {
      const day = new TZDate(new Date(instant), proposal.timezone);
      return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    };
    const first = localDate(range.start),
      last = localDate(new Date(Date.parse(range.end) - 1).toISOString());
    return event.start <= last && event.end > first;
  }
  return (
    Date.parse(event.start) < Date.parse(range.end) &&
    Date.parse(event.end) > Date.parse(range.start)
  );
}
