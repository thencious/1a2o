import "server-only";
import { taskPolicy } from "./task-rules";
import { getTodoState } from "./storage";
import { taskCalendarProposal } from "./calendar-matching";
import type { z } from "zod";
import type { Logger } from "@/utils/logger";
import { getMonthWriteTarget } from "@/utils/calendar/month-service";
import type { todoPreferences } from "@/utils/actions/todo.validation";
import { getTodoIntegration, updateTodoIntegration } from "./integration-store";

export async function getTodoPreferences(userId: string) {
  const state = await getTodoIntegration(userId);
  const tasks = (await getTodoState(userId)).tasks,
    policy = taskPolicy(state.taskRules);
  return {
    defaultCalendar: state.defaultCalendar,
    calendarMode:
      state.calendarMode ?? (state.defaultCalendar ? "default" : null),
    policy: taskPolicy(state.taskRules),
    ntfyTopic: state.ntfyTopic,
    ntfyTokenConfigured: Boolean(state.ntfyToken),
    timezone: state.timezone,
    ntfyStatus: state.ntfyStatus,
    pending: Object.values(state.pending).filter((prompt) => {
      const task = tasks.find((item) => item.id === prompt.taskId);
      return (
        task &&
        taskCalendarProposal(task, policy, state.timezone)?.hash ===
          prompt.proposal.hash
      );
    }),
  };
}
export async function saveTodoPreferences(
  userId: string,
  input: z.infer<typeof todoPreferences>,
  logger: Logger,
) {
  if (input.defaultCalendar)
    await getMonthWriteTarget(
      userId,
      input.defaultCalendar.connectionId,
      input.defaultCalendar.calendarId,
      logger,
    );
  return updateTodoIntegration(userId, async (state) => {
    if (input.defaultCalendar !== undefined)
      state.defaultCalendar = input.defaultCalendar;
    if (input.calendarMode !== undefined)
      state.calendarMode = input.calendarMode;
    if (input.ntfyTopic !== undefined) {
      const topic = input.ntfyTopic.replace(/\/$/, "");
      if (topic !== state.ntfyTopic) state.ntfyToken = "";
      state.ntfyTopic = topic;
    }
    if (input.ntfyToken) state.ntfyToken = input.ntfyToken;
    state.timezone = input.timezone;
    if (input.taskUrl) {
      const url = new URL(input.taskUrl);
      if (["localhost", "127.0.0.1"].includes(url.hostname))
        state.taskUrl = url.origin + url.pathname;
    }
    return { saved: true };
  });
}
