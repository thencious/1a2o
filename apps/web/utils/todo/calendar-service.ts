import "server-only";
import { taskPolicy } from "./task-rules";
import { randomUUID, createHash } from "node:crypto";
import type { Logger } from "@/utils/logger";
import { SafeError } from "@/utils/error";
import {
  getCalendarMonth,
  getMonthWriteTarget,
  saveMonthEvent,
} from "@/utils/calendar/month-service";
import { getTodoState } from "./storage";
import { updateTodoIntegration } from "./integration-store";
import {
  calendarDayRange,
  possibleCalendarDuplicate,
  taskCalendarProposal,
  eventOnProposalDays,
} from "./calendar-matching";
import type { CalendarCandidate, TodoCalendarResult } from "./calendar-types";

export async function syncTodoCalendar(
  userId: string,
  taskId: string,
  logger: Logger,
  choice?: {
    hash: string;
    decision: "update" | "keep" | "skip" | "create";
    eventId?: string;
    calendarKey?: string;
    etag?: string;
  },
): Promise<TodoCalendarResult> {
  return updateTodoIntegration(userId, async (state, checkpoint) => {
    const policy = taskPolicy(state.taskRules);
    const tasks = (await getTodoState(userId)).tasks,
      task = tasks.find((item) => item.id === taskId),
      proposal = task && taskCalendarProposal(task, policy);
    if (!proposal || !state.defaultCalendar) {
      if (choice)
        throw new SafeError(
          "The task, its rules, or its default calendar changed. Check the suggestion again; nothing was updated.",
        );
      delete state.pending[taskId];
      return { kind: "disabled", taskId };
    }
    if (choice && proposal.hash !== choice.hash)
      throw new SafeError(
        "The task changed. Check its calendar suggestion again.",
      );
    if (
      state.links[taskId]?.hash === proposal.hash ||
      state.dismissed[taskId] === proposal.hash
    )
      return { kind: "unchanged", taskId };
    const range = calendarDayRange(proposal),
      loaded = await getCalendarMonth(userId, range.start, range.end, logger);
    const link = state.links[taskId];
    if (
      link &&
      (Date.parse(link.start) < Date.parse(range.start) ||
        Date.parse(link.start) >= Date.parse(range.end))
    ) {
      const oldRange = calendarDayRange({
        ...proposal,
        start: link.start,
        allDay: link.allDay ?? false,
        end: link.allDay
          ? new Date(Date.parse(link.start) + 86_400_000)
              .toISOString()
              .slice(0, 10)
          : new Date(Date.parse(link.start) + 60_000).toISOString(),
      });
      const old = await getCalendarMonth(
        userId,
        oldRange.start,
        oldRange.end,
        logger,
      );
      loaded.events.push(...old.events);
      loaded.warnings.push(...old.warnings);
    }
    if (loaded.warnings.length)
      throw new SafeError(
        "Could not check every connected calendar for duplicates. Nothing was added. Check calendar access and retry.",
      );
    const candidates: CalendarCandidate[] = loaded.events
      .flatMap((event) => {
        const calendar = loaded.calendars.find(
          (item) => item.id === event.calendarKey,
        );
        if (!calendar) return [];
        return (link?.eventId === event.id &&
          link.target.calendarId === calendar.calendarId) ||
          (eventOnProposalDays(proposal, event) &&
            possibleCalendarDuplicate(proposal, event))
          ? [{ calendar, event }]
          : [];
      })
      .filter(
        (candidate, index, all) =>
          all.findIndex(
            (other) =>
              other.calendar.calendarId === candidate.calendar.calendarId &&
              other.event.id === candidate.event.id,
          ) === index,
      );
    const otherTasks = tasks
      .filter((other) => {
        if (other.id === taskId || other.completedAt) return false;
        const otherProposal = taskCalendarProposal(other, policy),
          deadline = other.deadline as { at?: number } | undefined;
        const start =
          (otherProposal?.allDay
            ? calendarDayRange(otherProposal).start
            : otherProposal?.start) ||
          (Number.isFinite(deadline?.at)
            ? new Date(deadline!.at!).toISOString()
            : null);
        if (!start) return false;
        return (
          Date.parse(start) >= Date.parse(range.start) &&
          Date.parse(start) < Date.parse(range.end) &&
          possibleCalendarDuplicate(proposal, {
            title: otherProposal?.title || other.title,
            start,
            end:
              otherProposal?.end ||
              new Date(Date.parse(start) + 60_000).toISOString(),
          })
        );
      })
      .map((other) => other.title);
    if ((candidates.length || otherTasks.length) && !choice) {
      const prompt = {
        taskId,
        taskTitle: task!.title,
        proposal,
        candidates,
        otherTasks,
      };
      state.pending[taskId] = prompt;
      return { kind: "duplicate", taskId, prompt };
    }
    if (choice?.decision === "skip") {
      state.dismissed[taskId] = proposal.hash;
      delete state.pending[taskId];
      return { kind: "skipped", taskId };
    }
    if (choice && !state.pending[taskId])
      throw new SafeError(
        "This calendar suggestion has expired. Check again before saving.",
      );
    const candidate = choice?.eventId
      ? candidates.find(
          (item) =>
            item.event.id === choice.eventId &&
            item.calendar.id === choice.calendarKey,
        )
      : undefined;
    if (
      choice &&
      (choice.decision === "update" || choice.decision === "keep")
    ) {
      if (!candidate || candidate.event.etag !== choice.etag)
        throw new SafeError(
          "The existing event changed. Check the suggestion again before updating it.",
        );
      if (choice.decision === "keep") {
        state.links[taskId] = {
          hash: proposal.hash,
          eventId: candidate.event.id,
          target: {
            connectionId: candidate.calendar.connectionId,
            calendarId: candidate.calendar.calendarId,
          },
          start: candidate.event.start,
          allDay: candidate.event.allDay,
        };
        delete state.pending[taskId];
        return { kind: "unchanged", taskId, eventId: candidate.event.id };
      }
      if (!candidate.calendar.writable || !candidate.event.editable)
        throw new SafeError(
          "This existing event is read-only. Choose another event or keep it unchanged.",
        );
    }
    const target =
      candidate && choice?.decision === "update"
        ? {
            connectionId: candidate.calendar.connectionId,
            calendarId: candidate.calendar.calendarId,
          }
        : state.defaultCalendar;
    await getMonthWriteTarget(
      userId,
      target.connectionId,
      target.calendarId,
      logger,
    );
    const key = createHash("sha256")
      .update(JSON.stringify([taskId, proposal.hash, target]))
      .digest("hex");
    const requestId = state.requests[key] ?? randomUUID();
    state.requests[key] = requestId;
    await checkpoint();
    const latest = (await getTodoState(userId)).tasks.find(
      (item) => item.id === taskId,
    );
    if (!latest || taskCalendarProposal(latest, policy)?.hash !== proposal.hash)
      throw new SafeError(
        "The task changed while calendars were being checked. Nothing was added; retry the suggestion.",
      );
    const existing =
      choice?.decision === "update" ? candidate?.event : undefined;
    const result = await saveMonthEvent(
      userId,
      {
        ...target,
        requestId,
        eventId: existing?.id,
        etag: existing?.etag,
        title: proposal.title,
        start: proposal.start,
        end: proposal.end,
        timezone: proposal.timezone,
        allDay: proposal.allDay,
        description:
          existing?.description ??
          `${proposal.kind === "deadline" ? "Task deadline" : "Task event"} from 1a2o.\n\n${task!.notes}`.slice(
            0,
            20_000,
          ),
        location: existing?.location ?? "",
        guests: existing?.guests ?? [],
      },
      logger,
    );
    state.links[taskId] = {
      hash: proposal.hash,
      eventId: result.id,
      target,
      start: proposal.start,
      allDay: proposal.allDay,
    };
    delete state.pending[taskId];
    return { kind: "created", taskId, eventId: result.id };
  });
}
