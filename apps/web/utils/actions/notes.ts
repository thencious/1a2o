"use server";
import { z } from "zod";
import { actionClientUser } from "./safe-action";
import { saveTodo, todoTask, analyzeTodo } from "./todo.validation";
import { requestTodoAnalysis } from "@/utils/todo/ai";
import { saveTodoState, appendWorkspaceItem } from "@/utils/todo/storage";

export const saveNotesAction = actionClientUser
  .metadata({ name: "saveNotes" })
  .inputSchema(saveTodo)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    saveTodoState(userId, parsedInput.revision, parsedInput.tasks, "notes"),
  );
export const noteToTaskAction = actionClientUser
  .metadata({ name: "noteToTask" })
  .inputSchema(z.object({ noteId: z.string().min(1).max(200), task: todoTask }))
  .action(async ({ ctx: { userId }, parsedInput }) =>
    appendWorkspaceItem(
      userId,
      {
        ...parsedInput.task,
        id: `note-task-${parsedInput.noteId}`,
        sourceNoteId: parsedInput.noteId,
      },
      "tasks",
    ),
  );
export const taskToNoteAction = actionClientUser
  .metadata({ name: "taskToNote" })
  .inputSchema(todoTask)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    appendWorkspaceItem(
      userId,
      {
        id: `task-note-${parsedInput.id}`,
        sourceTaskId: parsedInput.id,
        title: parsedInput.title,
        notes: `# ${parsedInput.title}\n\n${parsedInput.notes}`,
        createdAt: Date.now(),
        completedAt: null,
      },
      "notes",
    ),
  );

export const analyzeNotesAction = actionClientUser
  .metadata({ name: "analyzeNoteTask" })
  .inputSchema(analyzeTodo)
  .action(async ({ ctx: { userId }, parsedInput }) =>
    requestTodoAnalysis(userId, parsedInput.request, "notes"),
  );
