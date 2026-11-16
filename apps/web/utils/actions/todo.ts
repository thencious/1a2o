"use server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { taskRuleList } from "@/utils/todo/task-rules";
import { updateTodoIntegration } from "@/utils/todo/integration-store";
import { SafeError } from "@/utils/error";
import { actionClientUser } from "./safe-action";
import { saveTodo, analyzeTodo } from "./todo.validation";
import { saveTodoState } from "@/utils/todo/storage";
import { requestTodoAnalysis } from "@/utils/todo/ai";
import {
  getTodoPreferences,
  saveTodoPreferences,
} from "@/utils/todo/preferences";
import { syncTodoCalendar } from "@/utils/todo/calendar-service";
import { runTodoReminders } from "@/utils/todo/reminders";
import {
  todoPreferences,
  todoCalendarTask,
  todoCalendarChoice,
} from "./todo.validation";

export const saveTodoAction = actionClientUser
  .metadata({ name: "saveTodo" })
  .inputSchema(saveTodo)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    saveTodoState(userId, parsedInput.revision, parsedInput.tasks),
  );
export const analyzeTodoAction = actionClientUser
  .metadata({ name: "analyzeTodo" })
  .inputSchema(analyzeTodo)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    requestTodoAnalysis(userId, parsedInput.request),
  );
export const getTodoPreferencesAction = actionClientUser
  .metadata({ name: "getTodoPreferences" })
  .action(async ({ ctx: { userId } }) => getTodoPreferences(userId));
export const saveTodoPreferencesAction = actionClientUser
  .metadata({ name: "saveTodoPreferences" })
  .inputSchema(todoPreferences)
  .action(async ({ ctx: { userId, logger }, parsedInput }) =>
    saveTodoPreferences(userId, parsedInput, logger),
  );
export const syncTodoCalendarAction = actionClientUser
  .metadata({ name: "syncTodoCalendar" })
  .inputSchema(todoCalendarTask)
  .action(async ({ ctx: { userId, logger }, parsedInput }) =>
    syncTodoCalendar(userId, parsedInput.taskId, logger),
  );
export const resolveTodoCalendarAction = actionClientUser
  .metadata({ name: "resolveTodoCalendar" })
  .inputSchema(todoCalendarChoice)
  .action(async ({ ctx: { userId, logger }, parsedInput }) =>
    syncTodoCalendar(userId, parsedInput.taskId, logger, parsedInput),
  );
export const runTodoRemindersAction = actionClientUser
  .metadata({ name: "runTodoReminders" })
  .action(async ({ ctx: { userId } }) => runTodoReminders(userId));
export const saveTaskRulesAction = actionClientUser
  .metadata({ name: "saveTaskRules" })
  .inputSchema(z.object({ revision: z.string(), rules: taskRuleList }))
  .action(async ({ ctx: { userId }, parsedInput }) =>
    updateTodoIntegration(userId, async (state) => {
      if (state.rulesRevision !== parsedInput.revision)
        throw new SafeError(
          "Task rules changed in another window. Refresh before saving; your edits are still here.",
        );
      state.taskRules = parsedInput.rules;
      state.rulesRevision = randomUUID();
      return { saved: true };
    }),
  );
